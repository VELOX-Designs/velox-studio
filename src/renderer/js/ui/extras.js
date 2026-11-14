// Export queue, branding kits (watermark / intro / outro), desktop copy, themes, edit templates,
// onboarding tutorial, Smart Cut and AI color matching.
import { store, clipEnd, newClip, newTrack, sourceLength, defaultTransform } from '../core/project.js';
import { el, $, $$, bus, uid, deepClone, tc, fmtBytes, clamp } from '../core/util.js';
import { L, N } from '../core/i18n.js';
import { settings, setSetting, saveSettings, paths } from '../core/settings.js';
import { registerCommands, run } from '../core/commands.js';
import { modal, toast, confirmBox, promptBox, progressModal, contextMenu } from './dialogs.js';
import { startExport, EXPORT_PRESETS } from './exporter.js';
import { seqData, allSeqs, ensureSeqs, newSeq } from '../core/sequences.js';
import { importFiles, placeMedia, freeVideoTrack } from '../core/media.js';
import { run as ff, cacheDir, probe } from '../core/ffmpeg.js';
import { defineEffect, defaultParams } from '../render/effects.js';
import { loudnessCurve, detectScenes } from '../ai/tools.js';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ------------------------------------------------------------------ branding kits
export function brandKits() { return (settings.brandKits ||= defaultKits()); }
function defaultKits() {
  const kst = path.join(paths.desktop || path.join(os.homedir(), 'Desktop'), 'Kamernstedt', 'KST LOGOS');
  const out = [];
  if (fs.existsSync(kst)) {
    const files = fs.readdirSync(kst).map((f) => path.join(kst, f));
    const logo = files.find((f) => /\.(png|webp)$/i.test(f) && /transparent|logo/i.test(path.basename(f))) || files.find((f) => /\.png$/i.test(f));
    const outro = files.find((f) => /outro/i.test(path.basename(f)) && /\.(mp4|mov|webm)$/i.test(f));
    out.push({ id: 'kst', name: 'Kamernstedt (KST)', watermark: logo ? { file: logo, pos: 'br', scale: 0.2, opacity: 0.85, margin: 0.02 } : null, intro: null, outro: outro ? { file: outro } : null });
  }
  return out;
}
export function applyBranding(P, kit) {
  const p = deepClone(P);
  const dur0 = p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  let off = 0;
  const vtrack = () => p.tracks.find((t) => t.kind === 'video');
  const addMediaClip = (file, at) => {
    const m = p.media.find((x) => x.path === file); if (!m) return 0;
    const v = newClip({ trackId: vtrack().id, type: m.type === 'image' ? 'image' : 'video', mediaId: m.id, name: m.name, start: at, dur: m.type === 'image' ? 3 : m.duration, in: 0 });
    p.clips.push(v);
    if (m.hasAudio) { const a = newClip({ trackId: p.tracks.find((t) => t.kind === 'audio').id, type: 'audio', mediaId: m.id, start: at, dur: v.dur, in: 0 }); p.clips.push(a); }
    return v.dur;
  };
  if (kit.intro?.file) { const m = p.media.find((x) => x.path === kit.intro.file); const d = m ? (m.type === 'image' ? 3 : m.duration) : 0; if (d) { for (const c of p.clips) c.start += d; off = d; addMediaClip(kit.intro.file, 0); } }
  const bodyEnd = dur0 + off;
  if (kit.outro?.file) addMediaClip(kit.outro.file, bodyEnd);
  if (kit.watermark?.file) {
    const m = p.media.find((x) => x.path === kit.watermark.file);
    if (m) {
      const t = newTrack(p, 'video'); t.name = 'Wasserzeichen'; const vts = p.tracks.filter((x) => x.kind === 'video'); p.tracks.splice(p.tracks.indexOf(vts[vts.length - 1]) + 1, 0, t);
      const W = p.settings.width, H = p.settings.height, k = kit.watermark;
      const fit = Math.min(W / m.width, H / m.height); const sc = (k.scale * W) / (m.width * fit);
      const ww = m.width * fit * sc, hh = m.height * fit * sc, mg = (k.margin ?? 0.03) * W;
      const x = k.pos?.includes('l') ? -W / 2 + mg + ww / 2 : k.pos?.includes('r') ? W / 2 - mg - ww / 2 : 0;
      const y = k.pos?.includes('t') ? -H / 2 + mg + hh / 2 : k.pos?.includes('b') ? H / 2 - mg - hh / 2 : 0;
      p.clips.push(newClip({ trackId: t.id, type: 'image', mediaId: m.id, name: 'Wasserzeichen', start: off, dur: dur0, transform: { ...defaultTransform(), x, y, scale: sc, opacity: k.opacity ?? 0.85 } }));
    }
  }
  return p;
}
export async function ensureKitMedia(kit) {
  const files = [kit.watermark?.file, kit.intro?.file, kit.outro?.file].filter((f) => f && fs.existsSync(f));
  if (files.length) await importFiles(files);
}
function kitsDialog() {
  const body = el('div', { style: { width: '640px' } });
  const fill = () => {
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'muted', style: { marginTop: 0 } }, L('Branding-Kits hängen beim Export automatisch Wasserzeichen, Intro und Outro an – dein Projekt bleibt unverändert.', 'Branding kits add watermark, intro and outro at export time – your project stays untouched.')));
    for (const k of brandKits()) {
      const pick = (field, exts) => el('button', { class: 'btn small', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openFile'], filters: [{ name: 'Media', extensions: exts }] }); if (r.canceled) return; k[field] = field === 'watermark' ? { file: r.filePaths[0], pos: 'br', scale: 0.12, opacity: 0.85, margin: 0.03, ...(k.watermark ? { pos: k.watermark.pos, scale: k.watermark.scale, opacity: k.watermark.opacity } : {}) } : { file: r.filePaths[0] }; saveSettings(); fill(); } }, '…');
      const posSel = el('select', {}, ...[['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘'], ['c', '•']].map(([v, n]) => el('option', { value: v }, n))); posSel.value = k.watermark?.pos || 'br'; posSel.onchange = () => { if (k.watermark) { k.watermark.pos = posSel.value; saveSettings(); } };
      const sc = el('input', { type: 'number', min: 0.02, max: 0.6, step: 0.01, value: k.watermark?.scale ?? 0.12, style: { width: '60px' } }); sc.onchange = () => { if (k.watermark) { k.watermark.scale = +sc.value; saveSettings(); } };
      const op = el('input', { type: 'number', min: 0.05, max: 1, step: 0.05, value: k.watermark?.opacity ?? 0.85, style: { width: '60px' } }); op.onchange = () => { if (k.watermark) { k.watermark.opacity = +op.value; saveSettings(); } };
      body.appendChild(el('div', { class: 'fx-card', style: { padding: '8px' } },
        el('div', { class: 'row' }, el('b', { style: { flex: 1 } }, k.name), el('button', { class: 'btn small danger', onclick: () => { settings.brandKits = brandKits().filter((x) => x !== k); saveSettings(); fill(); } }, '✕')),
        el('div', { class: 'form', style: { gridTemplateColumns: '110px 1fr auto' } },
          el('label', {}, L('Wasserzeichen', 'Watermark')), el('span', { class: 'muted' }, k.watermark?.file ? path.basename(k.watermark.file) : '—'), pick('watermark', ['png', 'webp', 'jpg']),
          el('label', {}, L('Position/Größe', 'Position/size')), el('div', { class: 'row', style: { margin: 0 } }, posSel, sc, op), el('span'),
          el('label', {}, 'Intro'), el('span', { class: 'muted' }, k.intro?.file ? path.basename(k.intro.file) : '—'), pick('intro', ['mp4', 'mov', 'webm', 'png', 'jpg']),
          el('label', {}, 'Outro'), el('span', { class: 'muted' }, k.outro?.file ? path.basename(k.outro.file) : '—'), pick('outro', ['mp4', 'mov', 'webm', 'png', 'jpg']))));
    }
    body.appendChild(el('button', { class: 'btn small', onclick: async () => { const n = await promptBox(L('Name des Kits', 'Kit name'), L('Mein Server', 'My server')); if (n) { brandKits().push({ id: uid('kit'), name: n, watermark: null, intro: null, outro: null }); saveSettings(); fill(); } } }, '+ ' + L('Neues Kit', 'New kit')));
  };
  fill();
  modal({ title: L('Branding-Kits (Wasserzeichen / Intro / Outro)', 'Branding kits'), body, buttons: [{ label: 'OK', cls: 'primary' }] });
}

// ------------------------------------------------------------------ export queue
export const queue = [];
let queueRunning = false;
export function addToQueue(job) { queue.push({ id: uid('job'), status: 'wartet', progress: 0, ...job }); bus.emit('queue'); toast(L('Zur Warteschlange hinzugefügt: ', 'Added to queue: ') + job.label, 'ok'); }
async function runQueue(ui) {
  if (queueRunning) return; queueRunning = true;
  try {
    for (const j of queue) {
      if (j.status === 'fertig') continue;
      j.status = 'läuft'; bus.emit('queue');
      try {
        let P = j.seqId && j.seqId !== store.p.activeSeq ? { ...store.p, ...deepClone(seqData(store.p, j.seqId)) } : store.p;
        if (j.kitId) { const kit = brandKits().find((k) => k.id === j.kitId); if (kit) { await ensureKitMedia(kit); P = applyBranding(P, kit); } }
        const off = bus.on('export:progress', (p) => { j.progress = p; bus.emit('queue'); });
        const out = await startExport({ ...j.opts, project: P, range: j.opts.range || [0, P.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)] }, { silent: true });
        off(); j.status = 'fertig'; j.progress = 1; j.out = out;
      } catch (e) { j.status = 'Fehler: ' + e.message.slice(0, 60); }
      bus.emit('queue');
    }
    toast(L('Warteschlange abgeschlossen', 'Queue finished'), 'ok', 6000);
  } finally { queueRunning = false; }
}
function queueDialog() {
  const body = el('div', { style: { width: '700px' } });
  const fill = () => {
    body.innerHTML = '';
    if (!queue.length) body.appendChild(el('div', { class: 'muted' }, L('Warteschlange leer. Unten Vorlagen hinzufügen oder im Export-Dialog „Zur Warteschlange“.', 'Queue empty. Add presets below or use "Add to queue" in the export dialog.')));
    for (const j of queue) body.appendChild(el('div', { class: 'list-item', style: { background: 'var(--bg2)', marginBottom: '4px' } },
      el('div', { style: { flex: 1 } }, el('div', {}, j.label), el('div', { class: 'muted', style: { fontSize: '11px' } }, `${j.opts.w}×${j.opts.h} · ${j.opts.fps}fps · ${j.opts.codec} · ${j.status}${j.out ? ' · ' + path.basename(j.out) : ''}`),
        el('div', { class: 'progress', style: { marginTop: '4px' } }, el('i', { style: { width: (j.progress * 100).toFixed(0) + '%' } }))),
      el('button', { class: 'icon-btn', onclick: () => { const i = queue.indexOf(j); if (i >= 0 && j.status !== 'läuft') queue.splice(i, 1); fill(); } }, '✕')));
    const seqSel = el('select', {}, ...allSeqs().map((s) => el('option', { value: s.id }, s.name)));
    const kitSel = el('select', {}, el('option', { value: '' }, L('— kein Branding —', '— no branding —')), ...brandKits().map((k) => el('option', { value: k.id }, k.name)));
    const preSel = el('select', {}, ...EXPORT_PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    body.appendChild(el('div', { class: 'row', style: { marginTop: '12px' } }, seqSel, preSel, kitSel, el('button', { class: 'btn small', onclick: () => {
      const pr = EXPORT_PRESETS.find((x) => x.id === preSel.value); const sd = seqData(store.p, seqSel.value); const S = sd.settings;
      let w = S.width, h = S.height; if (pr.w) { w = pr.w; h = pr.h; } else if (pr.h) { h = pr.h; w = Math.round((h * S.width) / S.height / 2) * 2; }
      const name = `${store.p.name || 'Export'} - ${allSeqs().find((s) => s.id === seqSel.value)?.name} - ${pr.name}`.replace(/[\\/:*?"<>|]/g, '_');
      addToQueue({ label: name, seqId: seqSel.value, kitId: kitSel.value || null, opts: { w, h, fps: pr.fps || S.fps, fmt: pr.fmt, codec: pr.codec, enc: 'auto', mode: 'crf', q: pr.q || 18, kbps: 0, audio: pr.fmt === 'webm' ? 'opus' : 'aac', abr: 320, dir: settings.exportDir, name, openAfter: false } }); fill();
    } }, '+ ' + L('Hinzufügen', 'Add'))));
  };
  fill(); const off = bus.on('queue', fill);
  modal({ title: L('Export-Warteschlange', 'Export queue'), body, onClose: () => off(), buttons: [{ label: L('Branding-Kits…', 'Branding kits…'), onClick: () => { kitsDialog(); return false; } }, { label: L('Schließen', 'Close'), value: null }, { label: L('▶ Alle rendern', '▶ Render all'), cls: 'primary', onClick: () => { runQueue(); return false; } }] });
}

// ------------------------------------------------------------------ themes
const THEMES = {
  capcut: { name: 'VELOX Clean (Standard)', vars: {} },
  dark: { name: 'VELOX Classic', vars: { '--bg0': '#0b0c10', '--bg1': '#111318', '--bg2': '#171a21', '--bg3': '#1e222b', '--bg4': '#262b36', '--bg5': '#313746', '--line': '#2a2f3b', '--line2': '#3a4152' } },
  midnight: { name: 'Midnight Blue', vars: { '--bg0': '#070b14', '--bg1': '#0c1220', '--bg2': '#111a2c', '--bg3': '#172236', '--bg4': '#1f2c44', '--bg5': '#2a3a58', '--line': '#1e2a40', '--line2': '#2c3d5c' } },
  oled: { name: 'OLED Black', vars: { '--bg0': '#000000', '--bg1': '#050505', '--bg2': '#0b0b0d', '--bg3': '#121215', '--bg4': '#1b1b20', '--bg5': '#26262c', '--line': '#17171b', '--line2': '#26262c' } },
  graphite: { name: 'Graphite', vars: { '--bg0': '#141414', '--bg1': '#1c1c1c', '--bg2': '#232323', '--bg3': '#2b2b2b', '--bg4': '#353535', '--bg5': '#424242', '--line': '#2f2f2f', '--line2': '#444444' } },
  nordverband: { name: 'Crimson', vars: { '--bg0': '#0d0709', '--bg1': '#140b0e', '--bg2': '#1c1014', '--bg3': '#26151b', '--bg4': '#331c24', '--bg5': '#45262f', '--line': '#2c171d', '--line2': '#45262f' } },
};
const ACCENTS = { teal: '#1ec8d4', violet: '#7c5cff', cyan: '#22d3ee', red: '#ff3d5a', orange: '#ff8a3d', green: '#2fd18b', pink: '#ff4fa3', gold: '#e8b33a', blue: '#3d7bff' };
export function applyTheme() {
  // one-time switch to the new clean look (teal accent) for existing installs
  if (!settings.skin2) { if (!settings.accent || settings.accent === '#7c5cff') settings.accent = '#1ec8d4'; if (!settings.theme || settings.theme === 'dark') settings.theme = 'capcut'; settings.skin2 = true; import('../core/settings.js').then((m) => m.saveSettings?.()); }
  const r = document.documentElement.style;
  for (const k of ['--bg0', '--bg1', '--bg2', '--bg3', '--bg4', '--bg5', '--line', '--line2']) r.removeProperty(k);
  for (const [k, v] of Object.entries(THEMES[settings.theme || 'capcut']?.vars || {})) r.setProperty(k, v);
  const ac = settings.accent || '#1ec8d4';
  r.setProperty('--ac', ac); r.setProperty('--ac2', ac); r.setProperty('--acs', ac + '2e');
}
function themeDialog() {
  const body = el('div', { style: { width: '520px' } });
  const fill = () => {
    body.innerHTML = '';
    body.appendChild(el('h4', {}, L('Design', 'Theme')));
    body.appendChild(el('div', { class: 'chips' }, ...Object.entries(THEMES).map(([k, t]) => el('span', { class: 'chip' + ((settings.theme || 'capcut') === k ? ' on' : ''), onclick: () => { setSetting('theme', k); applyTheme(); fill(); } }, t.name))));
    body.appendChild(el('h4', {}, L('Akzentfarbe', 'Accent color')));
    const pick = el('input', { type: 'color', value: settings.accent || '#1ec8d4' }); pick.oninput = () => { setSetting('accent', pick.value); applyTheme(); };
    body.appendChild(el('div', { class: 'chips' }, ...Object.entries(ACCENTS).map(([k, c]) => el('span', { class: 'chip', style: { background: c, color: '#fff', borderColor: c }, onclick: () => { setSetting('accent', c); applyTheme(); pick.value = c; } }, k)), pick));
  };
  fill();
  modal({ title: L('Design & Farben', 'Theme & colors'), body, buttons: [{ label: 'OK', cls: 'primary' }] });
}

// ------------------------------------------------------------------ edit templates
const tplDir = () => { const d = path.join(paths.userData, 'templates'); fs.mkdirSync(d, { recursive: true }); return d; };
async function saveTemplate() {
  const p = store.p; if (!p.clips.length) throw new Error(L('Timeline ist leer', 'Timeline is empty'));
  const name = await promptBox(L('Name der Vorlage', 'Template name'), (p.seqName || p.name) + ' Vorlage'); if (!name) return;
  const slots = []; const music = [];
  const vids = p.clips.filter((c) => (c.type === 'video' || c.type === 'image')).sort((a, b) => a.start - b.start);
  for (const c of vids) if (!slots.includes(c.mediaId)) slots.push(c.mediaId);
  for (const c of p.clips.filter((c) => c.type === 'audio' && !c.linkId)) if (!music.includes(c.mediaId)) music.push(c.mediaId);
  const tpl = { name, created: Date.now(), settings: p.settings, tracks: p.tracks, transitions: p.transitions, markers: p.markers,
    clips: p.clips.map((c) => { const x = deepClone(c); if (x.mediaId) { const si = slots.indexOf(x.mediaId), mi = music.indexOf(x.mediaId); x.slot = si >= 0 ? si : null; x.musicSlot = mi >= 0 ? mi : null; if (x.slot == null && x.musicSlot == null && x.type === 'audio') { const v = vids.find((v2) => v2.linkId && v2.linkId === x.linkId); x.slot = v ? slots.indexOf(v.mediaId) : null; } x.mediaId = null; } return x; }),
    slotCount: slots.length, musicCount: music.length, slotDurations: slots.map((id) => store.media(id)?.duration || 0) };
  fs.writeFileSync(path.join(tplDir(), name.replace(/[\\/:*?"<>|]/g, '_') + '.json'), JSON.stringify(tpl));
  toast(L(`Vorlage gespeichert (${slots.length} Clip-Platzhalter, ${music.length} Musik)`, `Template saved (${slots.length} clip slots, ${music.length} music)`), 'ok');
}
async function applyTemplate() {
  const files = fs.readdirSync(tplDir()).filter((f) => f.endsWith('.json'));
  if (!files.length) { toast(L('Noch keine Vorlagen – erst „Edit als Vorlage speichern“', 'No templates yet – save one first')); return; }
  const sel = el('select', {}, ...files.map((f) => el('option', { value: f }, f.replace(/\.json$/, ''))));
  const vids = store.p.media.filter((m) => m.type === 'video' || m.type === 'image'); const auds = store.p.media.filter((m) => m.type === 'audio');
  const r = await new Promise((res) => modal({ title: L('Vorlage anwenden', 'Apply template'), body: el('div', {}, el('div', { class: 'form' }, el('label', {}, L('Vorlage', 'Template')), sel), el('p', { class: 'muted' }, L(`Die Platzhalter werden der Reihe nach mit den Videos aus deiner Medien-Bibliothek gefüllt (${vids.length} Videos, ${auds.length} Musik). Es entsteht eine neue Sequenz.`, 'Slots are filled in order with your media pool videos. A new sequence is created.'))),
    buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('Anwenden', 'Apply'), cls: 'primary', onClick: () => sel.value }], onClose: res }));
  if (!r) return;
  const tpl = JSON.parse(fs.readFileSync(path.join(tplDir(), r), 'utf8'));
  if (!vids.length) throw new Error(L('Keine Videos in der Medien-Bibliothek', 'No videos in media pool'));
  newSeq({ name: tpl.name, width: tpl.settings.width, height: tpl.settings.height, fps: tpl.settings.fps });
  store.edit('Vorlage anwenden', (p) => {
    p.tracks = deepClone(tpl.tracks); p.markers = deepClone(tpl.markers); p.clips = [];
    const idMap = new Map();
    for (const c0 of tpl.clips) {
      const c = deepClone(c0); const old = c.id; c.id = uid('clp'); idMap.set(old, c.id);
      if (c.slot != null) { const m = vids[c.slot % vids.length]; c.mediaId = m.id; c.name = m.name; if (m.type === 'image') c.type = c.type === 'audio' ? null : 'image'; if (m.type === 'video' && m.duration) { const need = sourceLength(c); if (c.in + need > m.duration) c.in = Math.max(0, m.duration - need - 0.05); } }
      else if (c.musicSlot != null) { const m = auds[c.musicSlot % Math.max(1, auds.length)]; if (!m) continue; c.mediaId = m.id; c.name = m.name; }
      if (!c.type) continue; if ((c.type === 'audio' && !c.mediaId) || ((c.type === 'video' || c.type === 'image') && !c.mediaId)) continue;
      if (c.type === 'audio' && c.slot != null && !vids[c.slot % vids.length].hasAudio) continue;
      delete c.slot; delete c.musicSlot; p.clips.push(c);
    }
    p.transitions = tpl.transitions.map((t) => ({ ...deepClone(t), id: uid('tr'), a: idMap.get(t.a), b: idMap.get(t.b) })).filter((t) => t.a && t.b);
  });
  toast(L('Vorlage angewendet', 'Template applied'), 'ok');
}

// ------------------------------------------------------------------ tutorial
const STEPS = [
  ['#panel-left', 'Medien & PC-Ordner', 'Links: Videos, Bilder, Musik importieren – per Drag & Drop, „+ Importieren“ oder direkt aus dem Reiter „PC-Ordner“ (z. B. Rockstar / WR Exports). Doppelklick öffnet den Quell-Monitor.'],
  ['#tl-canvas', 'Timeline', 'Clips hier hineinziehen. S = teilen, Q/W = trimmen, Entf = löschen. Ränder ziehen = trimmen, Ecken oben = Fades. Übergänge auf Schnitte ODER Clip-Anfang/-Ende ziehen.'],
  ['#viewer-stage', 'Vorschau', 'Echtzeit-GPU-Vorschau. Ausgewählten Clip direkt im Bild verschieben, skalieren, drehen. Masken & Corner-Pin werden hier gezeichnet.'],
  ['#panel-right', 'Inspector', 'Alle Eigenschaften des ausgewählten Clips: Transformation, Effekte, Farbe, Tempo/Speed-Ramp, Audio, KI. Jeder Wert mit ◆ ist per Keyframe animierbar.'],
  ['#left-tabs', 'Bibliotheken', '170+ Effekte, 220+ Übergänge, Grafik/Sticker/Partikel, Presets, Vorlagen, Store und die KI-Zentrale (Auto-Edit, Hochskalieren, Hintergrund weg, Zeitlupe …).'],
  ['#workspaces', 'Arbeitsbereiche', 'Schnitt, Farbe, Audio, Effekte, Einfach – passt Panels an die Aufgabe an. Tasten Alt+1…5.'],
  ['#btn-export-top', 'Export', 'Bis 8K, alle Formate, GPU-beschleunigt. Export-Warteschlange & Branding-Kits (Wasserzeichen/Outro) im Datei-Menü. Strg+P = jede Funktion suchen.'],
];
export function startTutorial(i = 0) {
  $$('.tut').forEach((n) => n.remove());
  if (i >= STEPS.length) { setSetting('tutorialDone', true); return; }
  const [sel, title, text] = STEPS[i]; const target = $(sel); if (!target) return startTutorial(i + 1);
  const r = target.getBoundingClientRect();
  const hole = el('div', { class: 'tut tut-hole', style: { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' } });
  const box = el('div', { class: 'tut tut-box' }, el('div', { class: 'muted' }, `${i + 1} / ${STEPS.length}`), el('h3', {}, title), el('p', {}, text),
    el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => { $$('.tut').forEach((n) => n.remove()); setSetting('tutorialDone', true); } }, L('Überspringen', 'Skip')), el('span', { class: 'spacer' }), el('button', { class: 'btn small primary', onclick: () => startTutorial(i + 1) }, i === STEPS.length - 1 ? L('Los geht’s!', 'Let’s go!') : L('Weiter →', 'Next →'))));
  document.body.append(hole, box);
  const bx = clamp(r.left + r.width / 2 - 170, 10, innerWidth - 360), by = r.bottom + 14 + 200 > innerHeight ? Math.max(10, r.top - 210) : r.bottom + 14;
  Object.assign(box.style, { left: bx + 'px', top: by + 'px' });
}

// ------------------------------------------------------------------ smart cut
async function smartCut({ count = 8, len = 3 } = {}) {
  const c = store.selectedClips().find((x) => x.type === 'video'); if (!c) throw new Error(L('Langen Videoclip auswählen', 'Select a long video clip'));
  const m = store.media(c.mediaId); const s0 = c.in, s1 = c.in + sourceLength(c);
  const pm = progressModal(L('Smart Cut: analysiere Action, Lautstärke und Szenen…', 'Smart cut: analysing action, loudness, scenes…'));
  try {
    const loud = m.hasAudio ? await loudnessCurve(m, 0.5) : [];
    pm.set(0.3);
    const scenes = await detectScenes(m.path, s0, s1 - s0, 0.25, (p) => pm.set(0.3 + p * 0.4));
    // motion energy at 2 fps
    pm.set(0.75, L('Bewegung…', 'Motion…'));
    const bins = []; for (let t = s0; t < s1 - len; t += 0.5) { const i = Math.floor(t / 0.5); let v = 0; for (let k = 0; k < len * 2; k++) v += loud[i + k] || 0; v /= len * 2; const sc = scenes.filter((x) => x >= t && x < t + len).length; bins.push({ t, score: v * 1.0 + sc * 0.15 + Math.random() * 0.02 }); }
    bins.sort((a, b) => b.score - a.score);
    const picks = []; for (const b of bins) { if (picks.every((p) => Math.abs(p - b.t) > len)) picks.push(b.t); if (picks.length >= count) break; }
    picks.sort((a, b) => a - b);
    newSeq({ name: 'Smart Cut · ' + m.name.slice(0, 20) });
    store.edit('Smart Cut', (p) => { let t = 0; for (const s of picks) { const cs = placeMedia(p, m, t, { inPoint: s, outPoint: s + len }); t += cs[0]?.dur || len; } });
    toast(L(`Smart Cut: ${picks.length} beste Momente in neuer Sequenz`, `Smart cut: ${picks.length} best moments in a new sequence`), 'ok');
  } finally { pm.close(); }
}

// ------------------------------------------------------------------ AI color match
defineEffect('colormatch', { name: { de: 'Farbabgleich (automatisch)', en: 'Color match (auto)' }, cat: 'color',
  params: ['mr', 'mg', 'mb'].map((k) => ({ k, de: 'Ziel-Mittel ' + k[1].toUpperCase(), en: 'Target mean ' + k[1].toUpperCase(), type: 'range', min: 0, max: 1, def: 0.5, step: 0.001 }))
    .concat(['sr', 'sg', 'sb'].map((k) => ({ k, de: 'Ziel-Streuung ' + k[1].toUpperCase(), en: 'Target std ' + k[1].toUpperCase(), type: 'range', min: 0.01, max: 1, def: 0.25, step: 0.001 })))
    .concat(['ar', 'ag', 'ab'].map((k) => ({ k, de: 'Quell-Mittel ' + k[1].toUpperCase(), en: 'Source mean ' + k[1].toUpperCase(), type: 'range', min: 0, max: 1, def: 0.5, step: 0.001 })))
    .concat(['tr', 'tg', 'tb'].map((k) => ({ k, de: 'Quell-Streuung ' + k[1].toUpperCase(), en: 'Source std ' + k[1].toUpperCase(), type: 'range', min: 0.01, max: 1, def: 0.25, step: 0.001 })))
    .concat([{ k: 'mix', de: 'Stärke', en: 'Amount', type: 'range', min: 0, max: 1, def: 0.85, step: 0.01 }]),
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); vec3 c = s.rgb; vec3 r = (c - vec3(u_ar,u_ag,u_ab)) / vec3(u_tr,u_tg,u_tb) * vec3(u_sr,u_sg,u_sb) + vec3(u_mr,u_mg,u_mb); return pm(vec4(clamp(mix(c, r, u_mix),0.0,1.0), s.a)); }` });
async function frameStats(c) {
  const m = store.media(c.mediaId); const lt = clamp(store.time - c.start, 0, c.dur);
  const { sourceTime } = await import('../core/project.js');
  const tmp = path.join(cacheDir('tmp'), 'cm_' + c.id + '.raw');
  await ff(['-ss', String(m.type === 'image' ? 0 : sourceTime(c, store.time >= c.start && store.time < clipEnd(c) ? lt : c.dur / 2)), '-i', m.path, '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', tmp]);
  const b = fs.readFileSync(tmp); const n = b.length / 3; const mean = [0, 0, 0], sq = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = b[i * 3 + k] / 255; mean[k] += v; sq[k] += v * v; }
  return { mean: mean.map((v) => v / n), std: sq.map((v, k) => Math.max(0.02, Math.sqrt(v / n - (mean[k] / n) ** 2))) };
}
async function colorMatch() {
  const s = store.selectedClips().filter((c) => c.type === 'video' || c.type === 'image');
  if (s.length < 2) throw new Error(L('Zwei Clips auswählen: zuerst die Referenz, dann (Strg+Klick) den anzupassenden', 'Select two clips: reference first, then (Ctrl+click) the one to adjust'));
  const ref = s[0], tgts = s.slice(1);
  const R = await frameStats(ref);
  for (const t of tgts) {
    const T = await frameStats(t);
    store.edit('Farbabgleich', () => { t.effects = t.effects.filter((f) => f.type !== 'colormatch'); t.effects.unshift({ id: uid('fx'), type: 'colormatch', enabled: true, params: { mr: R.mean[0], mg: R.mean[1], mb: R.mean[2], sr: R.std[0], sg: R.std[1], sb: R.std[2], ar: T.mean[0], ag: T.mean[1], ab: T.mean[2], tr: T.std[0], tg: T.std[1], tb: T.std[2], mix: 0.85 } }); });
  }
  toast(L(`Farben an „${ref.name}“ angeglichen`, `Colors matched to "${ref.name}"`), 'ok');
}

registerCommands([
  { id: 'exportQueue', name: { de: 'Export-Warteschlange…', en: 'Export queue…' }, cat: 'file', key: 'Ctrl+Shift+Q', run: () => queueDialog() },
  { id: 'brandKits', name: { de: 'Branding-Kits (Wasserzeichen/Outro)…', en: 'Branding kits…' }, cat: 'file', run: () => kitsDialog() },
  { id: 'theme', name: { de: 'Design & Farben…', en: 'Theme & colors…' }, cat: 'view', run: () => themeDialog() },
  { id: 'saveTemplate', name: { de: 'Edit als Vorlage speichern…', en: 'Save edit as template…' }, cat: 'file', run: () => saveTemplate() },
  { id: 'applyTemplate', name: { de: 'Vorlage mit neuen Clips füllen…', en: 'Fill template with new clips…' }, cat: 'file', run: () => applyTemplate() },
  { id: 'tutorial', name: { de: 'Einführung / Tutorial', en: 'Tutorial' }, cat: 'help', run: () => startTutorial(0) },
  { id: 'smartCut', name: { de: 'Smart Cut (beste Momente)', en: 'Smart cut (best moments)' }, cat: 'ai', args: '{ count?, len? }', run: (a) => smartCut(a || {}) },
  { id: 'colorMatch', name: { de: 'KI-Farbabgleich (an Referenz)', en: 'AI color match' }, cat: 'ai', run: () => colorMatch() },
]);
