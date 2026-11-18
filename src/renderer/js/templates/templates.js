// CapCut-style templates: gallery (Vorlagen tab), "use template" dialog (pick a clip per slot, trim/zoom/position
// before it goes in, choose music with beat-sync), builder (new sequence), and creating templates from a finished
// edit (timeline snapshot or a rendered video file) – also usable by Claude through the command API.
import { store, newClip, sourceLength, clipEnd, dropBrokenTransitions } from '../core/project.js';
import { el, $, bus, uid, deepClone, fileUrl, tc } from '../core/util.js';
import { L, N } from '../core/i18n.js';
import { paths, settings, setSetting } from '../core/settings.js';
import { registerCommands, run } from '../core/commands.js';
import { modal, toast, progressModal, promptBox, confirmBox, contextMenu } from '../ui/dialogs.js';
import { importFiles, thumbs, addTextClip, freeVideoTrack, ALL_EXT } from '../core/media.js';
import { BUILTIN_PRESETS, VELOCITY_PRESETS } from '../ui/presets.js';
import { defaultParams, EFFECTS } from '../render/effects.js';
import { TRANSITIONS } from '../render/transitions.js';
import { run as ff, FFMPEG } from '../core/ffmpeg.js';
import { BUILTIN_TEMPLATES, TEMPLATE_CATS } from './builtin.js';
import { HANDMADE_TEMPLATES } from './handmade.js';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------ storage
export const tplRoot = () => { const d = path.join(paths.velox, 'Vorlagen'); fs.mkdirSync(d, { recursive: true }); return d; };
export function userTemplates() {
  const out = [];
  for (const n of fs.readdirSync(tplRoot())) {
    const f = path.join(tplRoot(), n, 'template.json');
    try { if (fs.existsSync(f)) { const t = JSON.parse(fs.readFileSync(f, 'utf8')); t.dir = path.dirname(f); t.cat = !t.cat || t.cat === 'mine' ? 'eigene' : t.cat; t.mine = true; out.push(t); } } catch (e) { console.warn('template', n, e); }
  }
  return out.sort((a, b) => (b.created || 0) - (a.created || 0));
}
export const allTemplates = () => { const mine = userTemplates(); const ids = new Set(mine.map((t) => t.id)); return [...mine, ...[...HANDMADE_TEMPLATES, ...BUILTIN_TEMPLATES].filter((t) => !ids.has(t.id))]; };
function saveUserTemplate(t) {
  const id = t.id || 'u_' + Date.now().toString(36);
  const dir = path.join(tplRoot(), (t.name || 'Vorlage').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '_' + id.slice(-5));
  fs.mkdirSync(dir, { recursive: true });
  const o = { ...t, id, created: t.created || Date.now() }; delete o.dir; delete o.mine;
  fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify(o, null, 1));
  bus.emit('templates'); return dir;
}
const ASPECT = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const totalOf = (t) => t.total || t.slots.reduce((s, x) => s + x.dur, 0);

// ------------------------------------------------------------------ gallery (Vorlagen tab)
const CAT_STYLE = { eigene: ['#1ec8d4', '⭐'], mine: ['#1ec8d4', '⭐'], car: ['#ff5a1f', '🏎'], cinematic: ['#c9a25a', '🎬'], hype: ['#ff2d6f', '⚡'], blaulicht: ['#2f6bff', '🚨'], gaming: ['#26c281', '🎮'], trend: ['#e85cff', '✨'], story: ['#ffb547', '📷'], sport: ['#ff7a00', '🏀'], party: ['#b04dff', '🪩'], retro: ['#ff6fa8', '📼'] };
let cat = 'all', q = '', fmt = '9:16';
const fmtOf = (t) => (t.aspect === '9:16' || t.aspect === '4:5' ? '9:16' : '16:9');
export function templatesTab(body) {
  const list = allTemplates();
  const root = el('div', { class: 'tpl-root' });
  const search = el('input', { type: 'text', class: 'tpl-search', placeholder: '🔍  ' + L('Vorlagen suchen…', 'Search templates…'), value: q }); search.addEventListener('keydown', (e) => e.stopPropagation());
  search.oninput = () => { q = search.value; drawBody(); };
  const seg = el('div', { class: 'tpl-seg' }, ...[['9:16', L('Hochformat', 'Vertical')], ['16:9', L('Querformat', 'Landscape')]].map(([k, n]) => el('button', { class: fmt === k ? 'on' : '', onclick: () => { fmt = k; templatesTabRefresh(body); } }, n)));
  const chips = el('div', { class: 'tpl-cats' });
  const avail = list.filter((t) => fmtOf(t) === fmt || t.mine || t.cat === 'eigene');
  for (const [k, n] of Object.entries(TEMPLATE_CATS)) { const cnt = k === 'all' ? avail.length : avail.filter((t) => t.cat === k).length; if (!cnt && k !== 'all') continue; chips.append(el('button', { class: 'tpl-chip' + (cat === k ? ' on' : ''), onclick: () => { cat = k; templatesTabRefresh(body); } }, N(n))); }
  const tools = el('div', { class: 'tpl-tools' },
    el('button', { class: 'tpl-make', title: L('Aus deinem aktuellen Edit eine Vorlage machen', 'Make a template from your current edit'), onclick: () => run('templateFromTimeline') }, el('b', {}, '＋ ' + L('Aus meinem Edit', 'From my edit')), el('span', {}, L('Timeline als Vorlage', 'Timeline as template'))),
    el('button', { class: 'tpl-make', title: L('Aus einem fertigen Video (Schnitte + Übergänge 1:1)', 'From a finished video'), onclick: () => run('templateFromVideo') }, el('b', {}, '🎞 ' + L('Aus fertigem Video', 'From finished video')), el('span', {}, L('Schnitte + Effekte 1:1', 'Cuts + effects 1:1'))));
  const content = el('div', { class: 'tpl-content' });
  const drawBody = () => {
    content.innerHTML = '';
    const items = avail.filter((t) => (cat === 'all' || t.cat === cat) && (!q || (t.name + ' ' + (N(TEMPLATE_CATS[t.cat]) || '')).toLowerCase().includes(q.toLowerCase())));
    if (!items.length) { content.append(el('div', { class: 'tpl-empty' }, cat === 'eigene' ? L('Noch keine eigenen Vorlagen – „Aus meinem Edit“ oder „Aus fertigem Video“.', 'No own templates yet.') : L('Nichts gefunden', 'Nothing found'))); return; }
    if (cat === 'all' && !q) {
      // one tidy section per category (like CapCut): 6 cards + "Alle ›"
      // "Vorlagen Eigene" always on top and complete; below: the generated ones by category
      const own = items.filter((t) => t.cat === 'eigene');
      content.append(el('div', { class: 'tpl-sec-h own' }, el('b', {}, '⭐ ' + L('Vorlagen Eigene', 'Own templates')), el('span', { class: 'muted' }, String(own.length))),
        own.length ? el('div', { class: 'tpl-grid' }, ...own.map(card)) : el('div', { class: 'tpl-empty' }, L('Noch keine – „Aus meinem Edit“ oder „Aus fertigem Video“.', 'None yet.')),
        el('div', { class: 'tpl-divider' }, el('span', {}, L('Weitere Vorlagen', 'More templates'))));
      const order = ['car', 'cinematic', 'hype', 'blaulicht', 'gaming', 'trend', 'story', 'sport', 'party', 'retro'];
      for (const k of order) {
        const sec = items.filter((t) => t.cat === k); if (!sec.length) continue;
        content.append(el('div', { class: 'tpl-sec-h' }, el('b', {}, N(TEMPLATE_CATS[k]) || k), el('span', { class: 'muted' }, String(sec.length)), el('span', { class: 'spacer' }), sec.length > 6 ? el('button', { class: 'tpl-more', onclick: () => { cat = k; templatesTabRefresh(body); } }, L('Alle', 'All') + ' ›') : null),
          el('div', { class: 'tpl-grid' }, ...sec.slice(0, 6).map(card)));
      }
    } else content.append(el('div', { class: 'tpl-grid' }, ...items.slice(0, 300).map(card)));
  };
  drawBody();
  root.append(search, seg, chips, tools, content);
  body.append(root);
}
function templatesTabRefresh(body) { const st = body.scrollTop; body.innerHTML = ''; templatesTab(body); body.scrollTop = st; }
function card(t) {
  const [color, icon] = CAT_STYLE[t.cat] || CAT_STYLE.mine;
  const thumb = t.dir && fs.existsSync(path.join(t.dir, 'thumb.jpg')) ? `url("${fileUrl(path.join(t.dir, 'thumb.jpg'))}")` : t.thumbAsset ? `url("${t.thumbAsset}")` : null;
  const tot = totalOf(t);
  const bars = el('div', { class: 'tpl-bars' }); t.slots.slice(0, 30).forEach((s) => bars.append(el('i', { style: { flex: s.dur / tot } })));
  const cover = el('div', { class: 'tpl-cover' + (thumb ? ' img' : '') },
    thumb ? null : el('div', { class: 'tpl-art' }, el('span', {}, icon)),
    el('span', { class: 'tpl-badge' }, t.aspect), t.music ? el('span', { class: 'tpl-badge r' }, '♪') : null,
    el('div', { class: 'tpl-title' }, t.name.replace(/ \((Quer|Hoch)\)$/, '')), bars);
  cover.style.setProperty('--c', color); if (thumb) cover.style.backgroundImage = `linear-gradient(180deg, transparent 45%, rgba(0,0,0,.85)), ${thumb}`;
  if (t.reference && fs.existsSync(t.reference)) {
    let v = null;
    cover.onmouseenter = () => { v = el('video', { src: fileUrl(t.reference), muted: true, autoplay: true, loop: true, class: 'tpl-hover' }); v.muted = true; cover.append(v); };
    cover.onmouseleave = () => { v?.remove(); v = null; };
  }
  const c = el('div', { class: 'tpl-card', onclick: () => useTemplate(t), title: t.desc || t.name }, cover, el('div', { class: 'tpl-meta' }, `${t.slots.length} Clips · ${tot.toFixed(0)} s`));
  if (t.mine) c.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
    { label: L('Ordner öffnen', 'Open folder'), action: () => ipcRenderer.invoke('shell:open', t.dir) },
    { label: L('Umbenennen…', 'Rename…'), action: async () => { const n = await promptBox(L('Name', 'Name'), t.name); if (n) { const j = JSON.parse(fs.readFileSync(path.join(t.dir, 'template.json'), 'utf8')); j.name = n; fs.writeFileSync(path.join(t.dir, 'template.json'), JSON.stringify(j, null, 1)); bus.emit('templates'); } } },
    { label: L('Löschen', 'Delete'), action: async () => { if (await confirmBox(L(`Vorlage „${t.name}“ löschen?`, `Delete template "${t.name}"?`), { danger: true })) { fs.rmSync(t.dir, { recursive: true, force: true }); bus.emit('templates'); } } },
  ]); });
  return c;
}

// ------------------------------------------------------------------ use template dialog
const vidMedia = () => store.p.media.filter((m) => m.type === 'video' || m.type === 'image');
function autoAssign(t, assign) {
  const vids = vidMedia(); if (!vids.length) return;
  const used = new Map();
  t.slots.forEach((s, i) => {
    if (assign[i]?.mediaId) return;
    const m = vids[i % vids.length]; const need = slotSourceLen(s);
    const k = used.get(m.id) || 0; used.set(m.id, k + 1);
    const span = Math.max(0, (m.duration || 0) - need - 0.05);
    const inP = m.type === 'image' ? 0 : Math.min(span, ((k * 0.37 + 0.15) % 1) * span);
    assign[i] = { mediaId: m.id, in: inP, zoom: 1, x: 0, y: 0 };
  });
}
// ---- AI clip analysis: motion/scene score every 0.1 s (low-res decode) → best windows, no jump cuts inside a window
const ANALYSIS = new Map();
async function analyseMedia(m) {
  if (ANALYSIS.has(m.id)) return ANALYSIS.get(m.id);
  let scores = [], cuts = [];
  if (m.type === 'video') {
    try {
      const log = await ff(['-i', m.proxyPath || m.path, '-an', '-vf', "fps=10,scale=96:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score", '-f', 'null', '-']);
      scores = [...log.matchAll(/scene_score=([\d.]+)/g)].map((x) => +x[1]);
      scores.forEach((v, i) => { if (v > 0.32) cuts.push(i / 10); });
    } catch (e) { console.warn('analyse', e); }
  }
  const r = { scores, cuts }; ANALYSIS.set(m.id, r); return r;
}
const hash01 = (x) => { const v = Math.sin(x * 12.9898) * 43758.5453; return v - Math.floor(v); };
function bestWindow(m, an, need, lo, hi, taken) {
  const D = m.duration || 0; if (m.type !== 'video' || D <= need + 0.05) return 0;
  lo = Math.max(0, lo); hi = Math.min(D - need - 0.02, hi); if (hi < lo) { lo = 0; hi = D - need - 0.02; }
  let best = lo, bestV = -1e9;
  for (let st = lo; st <= hi; st += 0.1) {
    const i0 = Math.floor(st * 10), i1 = Math.ceil((st + need) * 10);
    let v = 0; for (let i = i0; i < i1; i++) v += Math.min(0.3, an.scores[i] || 0);
    v = v / Math.max(1, i1 - i0);
    if (an.cuts.some((c) => c > st + 0.08 && c < st + need - 0.08)) v -= 0.5; // a hard cut inside a slot looks broken
    if (taken.some(([a, b]) => st < b && st + need > a)) v -= 1; // avoid repeating the same moment
    v += (hash01(st) - 0.5) * 0.002;
    if (v > bestV) { bestV = v; best = st; }
  }
  return best;
}
// distribute ALL slots over the given clips: each clip gets a share proportional to its length, slots stay chronological
export async function smartAssign(t, assign, mediaList, onStatus = () => {}) {
  const vids = mediaList.filter((m) => m && (m.type === 'video' || m.type === 'image')); if (!vids.length) return;
  for (const [i, m] of vids.entries()) { onStatus(L(`KI analysiert Clip ${i + 1}/${vids.length}…`, `AI analysing clip ${i + 1}/${vids.length}…`)); await analyseMedia(m); }
  const N = t.slots.length; const weights = vids.map((m) => (m.type === 'image' ? 2 : Math.max(1, m.duration || 1)));
  const W = weights.reduce((a, b) => a + b, 0); const counts = weights.map((w) => Math.max(1, Math.round((w / W) * N)));
  while (counts.reduce((a, b) => a + b, 0) > N) counts[counts.indexOf(Math.max(...counts))]--;
  while (counts.reduce((a, b) => a + b, 0) < N) counts[counts.indexOf(Math.max(...counts))]++;
  let k = 0;
  vids.forEach((m, vi) => {
    const n = counts[vi]; const an = ANALYSIS.get(m.id) || { scores: [], cuts: [] }; const taken = []; const D = m.duration || 0;
    for (let j = 0; j < n && k < N; j++, k++) {
      const need = slotSourceLen(t.slots[k]);
      const lo = (j / n) * D, hi = ((j + 1) / n) * D - need;
      const st = bestWindow(m, an, need, lo, Math.max(lo, hi), taken);
      taken.push([st, st + need]);
      assign[k] = { mediaId: m.id, in: st, zoom: 1, x: 0, y: 0 };
    }
  });
}
function slotSourceLen(s) { const c = newClip({ dur: s.dur, ramp: s.ramp && VELOCITY_PRESETS[s.ramp] ? deepClone(VELOCITY_PRESETS[s.ramp].ramp) : null, speed: s.speed || 1 }); return sourceLength(c); }

export async function useTemplate(t) {
  const assign = t.slots.map(() => null);
  let sel = 0; let music = { kind: t.music ? 'template' : 'none', mediaId: null }; let beatSync = true; let keepAudio = false;
  let logoFile = t.logo ? (settings.templateLogo && fs.existsSync(settings.templateLogo) ? settings.templateLogo : null) : null;
  const [W, H] = ASPECT[t.aspect] || ASPECT['9:16'];
  const strip = el('div', { class: 'tp-strip' });
  const editor = el('div', { class: 'tp-editor' });
  const musicRow = el('div', { class: 'row', style: { margin: '8px 0 0', flexWrap: 'wrap' } });
  const drawStrip = () => {
    strip.innerHTML = '';
    t.slots.forEach((s, i) => {
      const a = assign[i]; const m = a && store.media(a.mediaId); const poster = m && thumbs.get(m.id)?.poster;
      strip.append(el('div', { class: 'tp-slot' + (i === sel ? ' on' : '') + (a ? ' filled' : ''), onclick: () => { sel = i; drawStrip(); drawEditor(); } },
        el('div', { class: 'tp-sthumb', style: poster ? { backgroundImage: `url("${fileUrl(poster)}")` } : {} }, a ? '' : '＋'),
        el('div', { class: 'tp-slabel' }, `${i + 1} · ${s.dur.toFixed(1)}s${s.ramp ? ' ⚡' : ''}`)));
    });
    const sl = strip.children[sel]; sl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  let vid = null;
  const drawEditor = () => {
    editor.innerHTML = ''; vid?.pause(); vid = null;
    const s = t.slots[sel]; const a = assign[sel]; const need = slotSourceLen(s);
    const pickBtn = el('button', { class: 'btn small primary', onclick: () => chooseMedia() }, a ? L('Clip tauschen', 'Replace clip') : L('Clip wählen', 'Choose clip'));
    const pcBtn = el('button', { class: 'btn small', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Medien', extensions: ALL_EXT }] }); if (r.canceled) return; const ms = await importFiles(r.filePaths); let k = sel; for (const m of ms.filter((x) => x.type !== 'audio')) { if (k >= t.slots.length) break; assign[k] = { mediaId: m.id, in: 0, zoom: 1, x: 0, y: 0 }; k++; } drawStrip(); drawEditor(); } }, '💻 ' + L('Vom PC…', 'From PC…'));
    const info = el('div', { class: 'muted' }, L(`Platz ${sel + 1} von ${t.slots.length} · ${s.dur.toFixed(2)} s im Edit`, `Slot ${sel + 1}/${t.slots.length} · ${s.dur.toFixed(2)} s`) + (s.ramp ? ' · ' + L('Tempo-Rampe: ', 'speed ramp: ') + (VELOCITY_PRESETS[s.ramp]?.name || s.ramp) : '') + (s.fx?.length ? ' · FX: ' + s.fx.map((f) => N(EFFECTS[f.type]?.name) || f.type).join(', ') : ''));
    const prev = el('div', { class: 'tp-prev', style: { aspectRatio: `${W}/${H}` } });
    if (!a) { prev.append(el('div', { class: 'tp-empty' }, L('Noch kein Clip – „Clip wählen“', 'No clip yet'))); editor.append(el('div', { class: 'tp-ed-l' }, prev), el('div', { class: 'tp-ed-r' }, info, el('div', { class: 'row' }, pickBtn, pcBtn))); return; }
    const m = store.media(a.mediaId);
    const media = m.type === 'image' ? el('img', { src: fileUrl(m.path) }) : (vid = el('video', { src: fileUrl(m.proxyPath || m.path), muted: true, autoplay: true }));
    const apply = () => { media.style.transform = `translate(${a.x * 100}%, ${a.y * 100}%) scale(${a.zoom})`; };
    apply(); prev.append(media, el('div', { class: 'tp-frame' }));
    if (vid) { vid.muted = true; vid.currentTime = a.in; vid.ontimeupdate = () => { if (vid.currentTime > a.in + need || vid.currentTime < a.in - 0.2) vid.currentTime = a.in; }; vid.onended = () => { vid.currentTime = a.in; vid.play(); }; }
    const rng = (label, min, max, step, get, set, fmt = (v) => v.toFixed(2)) => { const i = el('input', { type: 'range', min, max, step, value: get() }); const v = el('span', { class: 'tc' }, fmt(get())); i.oninput = () => { set(+i.value); v.textContent = fmt(+i.value); apply(); }; return el('div', { class: 'tp-rng' }, el('label', {}, label), i, v); };
    const maxIn = Math.max(0, (m.duration || 0) - need - 0.02);
    const trim = m.type === 'video' ? (() => {
      // source bar with the used window (drag = choose the part of the clip)
      const bar = el('div', { class: 'tp-src' }); const win = el('div', { class: 'tp-win' }); bar.append(win);
      const th = thumbs.get(m.id); if (th?.strip) bar.style.backgroundImage = `url("${fileUrl(th.strip)}")`;
      const place = () => { win.style.left = (a.in / (m.duration || 1)) * 100 + '%'; win.style.width = Math.min(100, (need / (m.duration || 1)) * 100) + '%'; lbl.textContent = `${tc(a.in, 30)} – ${tc(a.in + need, 30)}`; };
      const lbl = el('span', { class: 'tc' });
      bar.onmousedown = (e) => { const r = bar.getBoundingClientRect(); const mv = (ev) => { a.in = Math.max(0, Math.min(maxIn, ((ev.clientX - r.left) / r.width) * m.duration - need / 2)); place(); if (vid) vid.currentTime = a.in; }; mv(e); const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); };
      place();
      return el('div', {}, el('div', { class: 'row', style: { margin: '6px 0 2px' } }, el('b', {}, L('Welcher Teil des Clips?', 'Which part of the clip?')), el('span', { class: 'spacer' }), lbl), bar, el('div', { class: 'muted', style: { fontSize: '11px' } }, L('Auf den Balken klicken/ziehen – der helle Bereich kommt ins Edit.', 'Click/drag the bar – the bright window goes into the edit.')));
    })() : null;
    editor.append(el('div', { class: 'tp-ed-l' }, prev), el('div', { class: 'tp-ed-r' }, info, el('div', { class: 'row' }, pickBtn, pcBtn, el('button', { class: 'btn small', onclick: () => { assign[sel] = null; drawStrip(); drawEditor(); } }, L('Leeren', 'Clear'))),
      trim, rng(L('Zoom', 'Zoom'), 1, 3, 0.01, () => a.zoom, (v) => (a.zoom = v)), rng(L('Links/Rechts', 'Left/right'), -0.5, 0.5, 0.005, () => a.x, (v) => (a.x = v)), rng(L('Hoch/Runter', 'Up/down'), -0.5, 0.5, 0.005, () => a.y, (v) => (a.y = v)),
      el('div', { class: 'row' }, el('button', { class: 'btn small', disabled: sel === 0, onclick: () => { sel--; drawStrip(); drawEditor(); } }, '◀ ' + L('Vorheriger', 'Previous')), el('button', { class: 'btn small', disabled: sel >= t.slots.length - 1, onclick: () => { sel++; drawStrip(); drawEditor(); } }, L('Nächster', 'Next') + ' ▶'))));
  };
  const chooseMedia = () => {
    const vids = vidMedia();
    const g = el('div', { class: 'tp-pick' }, ...vids.map((m) => { const p = thumbs.get(m.id)?.poster; return el('div', { class: 'tp-pitem', onclick: () => { const s = t.slots[sel]; const need = slotSourceLen(s); assign[sel] = { mediaId: m.id, in: Math.max(0, Math.min((m.duration || 0) - need - 0.05, (m.duration || 0) * 0.3)), zoom: 1, x: 0, y: 0 }; mm.close(); if (sel < t.slots.length - 1 && assign.slice(sel + 1).some((x) => !x)) {} drawStrip(); drawEditor(); } }, el('div', { class: 'tp-sthumb', style: p ? { backgroundImage: `url("${fileUrl(p)}")` } : {} }), el('span', {}, m.name)); }));
    const mm = modal({ title: L('Clip für Platz ', 'Clip for slot ') + (sel + 1), body: vids.length ? g : el('div', { class: 'muted' }, L('Medien-Bibliothek ist leer – „Vom PC…“ nutzen', 'Media pool empty – use "From PC…"')), buttons: [{ label: L('Schließen', 'Close'), value: null }], width: 720 });
  };
  // pick one or more clips (e.g. ONE 40 s video) – the AI cuts the best moments into every slot
  const aiFill = () => {
    const vids = vidMedia(); const chosen = new Set(assign.filter(Boolean).map((a) => a.mediaId));
    if (!chosen.size) vids.forEach((m) => chosen.add(m.id));
    const grid = el('div', { class: 'tp-pick' });
    const draw = () => { grid.innerHTML = ''; for (const m of vids) { const p = thumbs.get(m.id)?.poster; grid.append(el('div', { class: 'tp-pitem' + (chosen.has(m.id) ? ' on' : ''), onclick: () => { if (chosen.has(m.id)) chosen.delete(m.id); else chosen.add(m.id); draw(); } }, el('div', { class: 'tp-sthumb', style: p ? { backgroundImage: `url("${fileUrl(p)}")` } : {} }, chosen.has(m.id) ? '✓' : ''), el('span', {}, m.name + (m.duration ? ` · ${m.duration.toFixed(0)}s` : '')))); } };
    draw();
    const pc = el('button', { class: 'btn small', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Video/Bild', extensions: ALL_EXT }] }); if (r.canceled) return; const ms = await importFiles(r.filePaths); ms.filter((x) => x.type !== 'audio').forEach((m) => { vids.push(m); chosen.add(m.id); }); draw(); } }, '💻 ' + L('Vom PC…', 'From PC…'));
    modal({ title: L('Welche Clips soll die KI benutzen?', 'Which clips should the AI use?'), width: 760,
      body: el('div', {}, el('p', { class: 'muted', style: { marginTop: 0 } }, L(`Auch nur EIN langes Video geht – die KI sucht die besten, bewegtesten Stellen für alle ${t.slots.length} Plätze, ohne harte Schnitte mitten im Platz. Danach kannst du jeden Platz noch ändern.`, `Even ONE long video works – the AI picks the best moments for all ${t.slots.length} slots.`)), el('div', { class: 'row' }, pc), vids.length ? grid : el('div', { class: 'muted' }, L('Noch keine Clips – „Vom PC…“', 'No clips yet'))),
      buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('KI schneiden lassen', 'Let AI cut'), cls: 'primary', onClick: () => {
        const list = vids.filter((m) => chosen.has(m.id)); if (!list.length) { toast(L('Mindestens einen Clip wählen', 'Choose at least one clip'), 'err'); return false; }
        setTimeout(async () => { const pm = progressModal(L('KI schneidet…', 'AI cutting…')); try { await smartAssign(t, assign, list, (x) => pm.set(0.5, x)); } finally { pm.close(); } drawStrip(); drawEditor(); toast(L('Fertig – jeden Platz kannst du noch anpassen', 'Done – adjust any slot'), 'ok'); }, 30);
      } }] });
  };
  const logoRow = el('div', { class: 'row', style: { margin: '8px 0 0', flexWrap: 'wrap' } });
  const drawLogo = () => {
    logoRow.innerHTML = ''; if (!t.logo) return;
    const imgs = store.p.media.filter((m) => m.type === 'image');
    const s2 = el('select', {}, el('option', { value: '' }, L('— ohne Logo —', '— no logo —')), ...imgs.map((m) => el('option', { value: m.path }, m.name)), logoFile && !imgs.some((m) => m.path === logoFile) ? el('option', { value: logoFile }, path.basename(logoFile)) : null);
    s2.value = logoFile || ''; s2.onchange = () => { logoFile = s2.value || null; if (logoFile) setSetting('templateLogo', logoFile); drawLogo(); };
    const pick = el('button', { class: 'btn small', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openFile'], filters: [{ name: 'Bild', extensions: ['png', 'webp', 'jpg', 'jpeg', 'svg'] }] }); if (r.canceled) return; logoFile = r.filePaths[0]; setSetting('templateLogo', logoFile); drawLogo(); } }, L('Logo vom PC…', 'Logo from PC…'));
    const prev = logoFile ? el('img', { src: fileUrl(logoFile), style: { height: '28px', borderRadius: '4px', background: '#000', padding: '2px' } }) : null;
    logoRow.append(el('b', {}, 'Logo'), s2, pick, prev, el('span', { class: 'muted', style: { fontSize: '11px' } }, L('kommt ins Intro, in die Blitzer und ins Outro (PNG mit transparentem Hintergrund am besten)', 'used for intro, flashes and outro (transparent PNG works best)')));
  };
  const drawMusic = () => {
    musicRow.innerHTML = '';
    const auds = store.p.media.filter((m) => m.type === 'audio');
    const s = el('select', {}, t.music ? el('option', { value: 'template' }, '♪ ' + L('Sound der Vorlage (1:1)', 'Template sound (1:1)')) : null, el('option', { value: 'none' }, L('— ohne Musik —', '— no music —')), ...auds.map((m) => el('option', { value: m.id }, '♪ ' + m.name)));
    s.value = music.kind === 'media' ? music.mediaId : music.kind; s.onchange = () => { music = s.value === 'template' || s.value === 'none' ? { kind: s.value } : { kind: 'media', mediaId: s.value }; };
    const add = el('button', { class: 'btn small', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'mp4'] }] }); if (r.canceled) return; const [m] = await importFiles(r.filePaths); if (m) { music = { kind: 'media', mediaId: m.id }; drawMusic(); } } }, L('Song vom PC…', 'Song from PC…'));
    const bs = el('input', { type: 'checkbox', checked: beatSync }); bs.onchange = () => (beatSync = bs.checked);
    const ka = el('input', { type: 'checkbox', checked: keepAudio }); ka.onchange = () => (keepAudio = ka.checked);
    musicRow.append(el('b', {}, L('Musik', 'Music')), s, add, t.bpm ? el('label', { class: 'chip' }, bs, ' ' + L('Schnitte auf die Beats legen', 'Snap cuts to beats')) : null, el('label', { class: 'chip' }, ka, ' ' + L('Originalton der Clips', 'Original clip sound')));
  };
  const body = el('div', { class: 'tp-dialog' },
    el('div', { class: 'row', style: { margin: '0 0 8px' } }, el('span', { class: 'muted' }, `${t.aspect} · ${t.slots.length} Clips · ${totalOf(t).toFixed(1)} s${t.bpm ? ' · ' + t.bpm + ' BPM' : ''}${t.look ? ' · Look: ' + (BUILTIN_PRESETS.find((p) => p.id === t.look)?.name || t.look) : ''}`), el('span', { class: 'spacer' }),
      el('button', { class: 'btn small primary', onclick: () => aiFill() }, '✨ ' + L('KI füllt alle Plätze', 'AI fills all slots'))),
    strip, editor, musicRow, logoRow);
  drawStrip(); drawEditor(); drawMusic(); drawLogo();
  modal({ title: (t.emoji || '✦') + ' ' + t.name, body, width: 1080, onClose: () => vid?.pause(), buttons: [
    { label: L('Abbrechen', 'Cancel'), value: null },
    { label: L('Edit erstellen', 'Create edit'), cls: 'primary', onClick: () => {
      const missing = assign.map((x, i) => (x ? null : i + 1)).filter(Boolean);
      if (missing.length === assign.length) { toast(L('Wähle mindestens einen Clip (oder „Alle automatisch füllen“)', 'Choose at least one clip'), 'err', 5000); return false; }
      if (missing.length) { const used = [...new Set(assign.filter(Boolean).map((a) => a.mediaId))].map((id) => store.media(id)); const tmp = t.slots.map(() => null); vid?.pause(); setTimeout(async () => { const pm = progressModal(L('KI füllt leere Plätze…', 'AI filling empty slots…')); try { await smartAssign(t, tmp, used.length ? used : vidMedia()); } finally { pm.close(); } missing.forEach((x) => (assign[x - 1] = tmp[x - 1])); buildTemplate(t, assign, { music, beatSync, keepAudio, logoFile }).catch((e) => toast(e.message, 'err', 8000)); }, 30); return; }
      vid?.pause();
      setTimeout(() => buildTemplate(t, assign, { music, beatSync, keepAudio, logoFile }).catch((e) => toast(e.message, 'err', 8000)), 30);
    } },
  ] });
}

// ------------------------------------------------------------------ build timeline from a template
async function beatTimes(t, musicMedia) {
  const { detectBeats } = await import('../ai/tools.js');
  const r = await detectBeats(musicMedia.path, 0, Math.min(musicMedia.duration, totalOf(t) * 1.6 + 10));
  return r.beats || [];
}
export async function buildTemplate(t, assign, { music = { kind: 'none' }, beatSync = true, keepAudio = false, logoFile = null } = {}) {
  const pm = progressModal(L('Vorlage wird gebaut…', 'Building template…'));
  try {
    // music
    let musicMedia = null; let logoMedia = null;
    if (t.logo && logoFile && fs.existsSync(logoFile)) [logoMedia] = await importFiles([logoFile]);
    if (music.kind === 'template' && t.music?.file) { const f = path.isAbsolute(t.music.file) ? t.music.file : path.join(t.dir, t.music.file); [musicMedia] = await importFiles([f]); }
    else if (music.kind === 'media') musicMedia = store.media(music.mediaId);
    // slot timing (template grid, optionally snapped to the beats of the chosen song)
    let durs = t.slots.map((s) => s.dur);
    if (musicMedia && beatSync && music.kind === 'media' && t.slots.every((s) => s.beats)) {
      pm.set(0.2, L('Beats der Musik erkennen…', 'Detecting beats…'));
      const bt = await beatTimes(t, musicMedia);
      if (bt.length > 8) {
        const at = (k) => { const i = Math.floor(k), f = k - i; if (i + 1 < bt.length) return bt[i] + (bt[i + 1] - bt[i]) * f; const d = bt[bt.length - 1] - bt[bt.length - 2]; return bt[bt.length - 1] + (k - bt.length + 1) * d; };
        let k = 0; const b0 = at(0); const bounds = [0];
        for (const s of t.slots) { k += s.beats; bounds.push(at(k) - b0); }
        durs = bounds.slice(1).map((b, i) => Math.max(0.12, b - bounds[i]));
        music.offset = b0;
      }
    }
    pm.set(0.5, L('Timeline wird gebaut…', 'Building timeline…'));
    const [W, H] = ASPECT[t.aspect] || [store.p.settings.width, store.p.settings.height];
    const { newSeq } = await import('../core/sequences.js');
    newSeq({ name: t.name, width: W, height: H, fps: store.p.settings.fps || 30 });
    const total = durs.reduce((a, b) => a + b, 0) + (t.tail || 0); // tail = logo outro after the last clip
    store.edit(L('Vorlage: ', 'Template: ') + t.name, (p) => {
      p.clips = []; p.transitions = []; p.markers = [];
      const vTrack = p.tracks.find((x) => x.kind === 'video');
      let aTrack = p.tracks.find((x) => x.kind === 'audio');
      const created = []; let start = 0;
      t.slots.forEach((s, i) => {
        const a = assign[i]; const m = a && store.media(a.mediaId); const d = durs[i];
        if (!m) { start += d; created.push(null); return; }
        const ramp = s.ramp && VELOCITY_PRESETS[s.ramp] ? deepClone(VELOCITY_PRESETS[s.ramp].ramp) : null;
        const c = newClip({ trackId: vTrack.id, type: m.type === 'image' ? 'image' : 'video', mediaId: m.id, name: m.name, start, dur: d, in: a.in || 0, ramp, speed: s.speed || 1 });
        if (m.type === 'video') { let need = sourceLength(c); if (need > m.duration - 0.02) { c.ramp = null; c.speed = Math.max(0.1, (m.duration - 0.05) / d); need = sourceLength(c); } if (c.in + need > m.duration) c.in = Math.max(0, m.duration - need - 0.02); }
        // cover the frame (vertical template + landscape clip) × user zoom/position
        const mw = m.width || W, mh = m.height || H; const fit = Math.min(W / mw, H / mh), cover = Math.max(W / mw, H / mh) / fit;
        c.transform.scale = (s.fit ? 1 : cover) * (a.zoom || 1); c.transform.x = (a.x || 0) * W; c.transform.y = (a.y || 0) * H;
        if (s.fadeIn) c.fadeIn = s.fadeIn; if (s.fadeOut) c.fadeOut = s.fadeOut;
        for (const f of s.fx || []) if (EFFECTS[f.type]) c.effects.push({ id: uid('fx'), type: f.type, enabled: true, params: Object.assign(defaultParams(f.type), deepClone(f.params || {})) });
        if (ramp && VELOCITY_PRESETS[s.ramp]?.fx && EFFECTS.motionblur && !c.effects.some((f) => f.type === 'motionblur')) c.effects.push({ id: uid('fx'), type: 'motionblur', enabled: true, params: defaultParams('motionblur') });
        if (keepAudio && m.type === 'video' && m.hasAudio) { c.linkId = uid('lnk'); p.clips.push(newClip({ trackId: aTrack.id, type: 'audio', mediaId: m.id, name: m.name, start, dur: d, in: c.in, ramp: c.ramp ? deepClone(c.ramp) : null, speed: c.speed, linkId: c.linkId, volume: musicMedia ? 0.35 : 1 })); }
        p.clips.push(c); created.push(c); start += d;
      });
      // transitions: start on the cut (beat), clip A runs on under clip B
      for (const tr of t.trans || []) {
        const A = created[tr.after], B = created[tr.after + 1]; if (!A || !B) continue;
        const type = TRANSITIONS[tr.type] ? tr.type : 'dissolve';
        const d = Math.max(0.08, Math.min(tr.dur, B.dur * 0.6, 2));
        const m = store.media(A.mediaId);
        const extra = d * (A.speed || 1);
        if (m?.type === 'video' && A.in + sourceLength(A) + extra > m.duration) A.in = Math.max(0, A.in - extra);
        A.dur += d;
        p.transitions.push({ id: uid('tr'), a: A.id, b: B.id, type, dur: d, overlap: true, params: { intensity: 1, dir: tr.dir ?? 0 } });
      }
      // look over everything
      if (t.look) { const pr = BUILTIN_PRESETS.find((x) => x.id === t.look); if (pr) { const vt2 = freeVideoTrack(p, 0, total, 1); p.clips.push(newClip({ trackId: vt2.id, type: 'adjust', name: pr.name, start: 0, dur: total, effects: pr.effects.filter((f) => EFFECTS[f.type]).map((f) => ({ id: uid('fx'), type: f.type, enabled: true, params: Object.assign(defaultParams(f.type), deepClone(f.params)) })) })); } }
      for (const g of t.adjust || []) if (EFFECTS[g.type]) { const vt2 = freeVideoTrack(p, g.t || 0, (g.t || 0) + (g.dur || total), 1); p.clips.push(newClip({ trackId: vt2.id, type: 'adjust', name: N(EFFECTS[g.type].name), start: g.t || 0, dur: g.dur || total, effects: [{ id: uid('fx'), type: g.type, enabled: true, params: Object.assign(defaultParams(g.type), deepClone(g.params || {})) }] })); }
      // texts (scaled when the grid was re-timed)
      const k = total / Math.max(0.01, totalOf(t));
      for (const x of t.texts || []) { const pr = BUILTIN_PRESETS.find((q) => q.id === x.preset); const tc0 = addTextClip(p, x.t * k, { ...(pr?.text || {}), ...(x.style || {}), content: x.content }, Math.max(0.03, x.dur * k)); if (x.pos) { tc0.transform.x = x.pos[0] * W; tc0.transform.y = x.pos[1] * H; } }
      // logo overlays (intro watermark, flash frames, outro)
      if (logoMedia) for (const it of t.logo.items || []) {
        const st = it.t * k, du = Math.max(0.05, it.dur * k); const vt4 = freeVideoTrack(p, st, st + du, 1);
        const lc = newClip({ trackId: vt4.id, type: 'image', mediaId: logoMedia.id, name: 'Logo', start: st, dur: du, fadeIn: it.fadeIn || 0, fadeOut: it.fadeOut || 0 });
        lc.transform.scale = it.scale || 0.3; lc.transform.x = (it.pos?.[0] || 0) * W; lc.transform.y = (it.pos?.[1] || 0) * H; if (it.opacity != null) lc.transform.opacity = it.opacity;
        p.clips.push(lc);
      }
      // colour flashes / solids (e.g. white flash frames)
      for (const x of t.solids || []) { const vt3 = freeVideoTrack(p, x.t * k, (x.t + x.dur) * k, 1); p.clips.push(newClip({ trackId: vt3.id, type: 'solid', name: L('Blitz', 'Flash'), start: x.t * k, dur: Math.max(0.03, x.dur * k), solid: { color: x.color || '#ffffff', gradient: '' }, fadeIn: x.fadeIn || 0, fadeOut: x.fadeOut || 0 })); }
      // music
      if (musicMedia) {
        let mt = p.tracks.filter((x) => x.kind === 'audio').find((tr) => !p.clips.some((c) => c.trackId === tr.id));
        if (!mt) { mt = { id: uid('trk'), kind: 'audio', name: 'A' + (p.tracks.filter((x) => x.kind === 'audio').length + 1), muted: false, locked: false, hidden: false, solo: false, volume: 1, height: 48 }; p.tracks.push(mt); }
        const inM = music.kind === 'template' ? t.music.start || 0 : music.offset || 0;
        p.clips.push(newClip({ trackId: mt.id, type: 'audio', mediaId: musicMedia.id, name: musicMedia.name, start: 0, dur: Math.min(total, musicMedia.duration - inM), in: inM, fadeOut: Math.min(1.5, total / 6) }));
      }
      dropBrokenTransitions(p);
    });
    const { zoomFit } = await import('../ui/timeline.js'); zoomFit();
    toast(L('Edit aus Vorlage erstellt – jetzt alles frei weiter bearbeiten', 'Edit created – now edit freely'), 'ok', 5000);
  } finally { pm.close(); }
}

// ------------------------------------------------------------------ create templates
// from the current timeline: main video track becomes the slots, everything else (fx, ramps, transitions, texts, music) is kept
async function fromTimeline({ name, cat = 'eigene' } = {}) {
  const p = store.p;
  const vt = p.tracks.find((x) => x.kind === 'video');
  const main = p.clips.filter((c) => c.trackId === vt.id && (c.type === 'video' || c.type === 'image')).sort((a, b) => a.start - b.start);
  if (!main.length) throw new Error(L('Keine Clips auf der Haupt-Videospur', 'No clips on the main video track'));
  name = name || (await promptBox(L('Name der Vorlage', 'Template name'), (p.seqName || p.name || 'Mein Edit') + ' Vorlage')); if (!name) return;
  const slots = []; const trans = [];
  main.forEach((c, i) => {
    const nx = main[i + 1]; const tr = nx && p.transitions.find((x) => x.a === c.id && x.b === nx.id);
    const dur = nx ? nx.start - c.start : c.dur;
    const ramp = c.ramp ? Object.keys(VELOCITY_PRESETS).find((k) => JSON.stringify(VELOCITY_PRESETS[k].ramp) === JSON.stringify(c.ramp)) : null;
    slots.push({ dur: +dur.toFixed(3), ramp: ramp || null, speed: c.ramp ? 1 : c.speed, fx: c.effects.filter((f) => f.enabled !== false).map((f) => ({ type: f.type, params: deepClone(f.params) })), zoom: 1 });
    if (tr) trans.push({ after: i, type: tr.type, dur: tr.dur, dir: tr.params?.dir || 0 });
  });
  const total = slots.reduce((s, x) => s + x.dur, 0);
  const texts = p.clips.filter((c) => c.type === 'text').map((c) => ({ t: c.start, dur: c.dur, content: c.text?.content || '', style: deepClone(c.text) }));
  const adjust = p.clips.filter((c) => c.type === 'adjust').flatMap((c) => c.effects.map((f) => ({ type: f.type, params: deepClone(f.params), t: c.start, dur: c.dur })));
  const musicClip = p.clips.filter((c) => c.type === 'audio' && !c.linkId).sort((a, b) => b.dur - a.dur)[0];
  const t = { name, cat, aspect: Math.abs(p.settings.width / p.settings.height - 9 / 16) < 0.05 ? '9:16' : Math.abs(p.settings.width / p.settings.height - 1) < 0.05 ? '1:1' : '16:9', slots, trans, texts, adjust, total, emoji: '⭐', desc: L('Aus deinem Edit', 'From your edit') };
  const dir = saveUserTemplate(t);
  void musicClip; // the song is not stored in templates
  try { const c = $('#preview-canvas'); const th = document.createElement('canvas'); th.width = 360; th.height = Math.round((360 * c.height) / c.width); th.getContext('2d').drawImage(c, 0, 0, th.width, th.height); fs.writeFileSync(path.join(dir, 'thumb.jpg'), Buffer.from(th.toDataURL('image/jpeg', 0.85).split(',')[1], 'base64')); } catch {}
  fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify({ ...t, id: JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8')).id, created: Date.now() }, null, 1));
  bus.emit('templates'); toast(L(`Vorlage „${name}“ gespeichert (${slots.length} Clips)`, `Template "${name}" saved`), 'ok'); return dir;
}
// from a finished video: cuts (scene detection) → slots with exact lengths, sound 1:1, flashes/dips → transitions
async function fromVideo({ file, name, cat = 'eigene', threshold = 0.3 } = {}) {
  if (!file) { const r = await ipcRenderer.invoke('dialog:open', { title: L('Fertiges Edit wählen', 'Choose a finished edit'), properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm'] }] }); if (r.canceled) return; file = r.filePaths[0]; }
  name = name || (await promptBox(L('Name der Vorlage', 'Template name'), path.basename(file).replace(/\.[^.]+$/, ''))); if (!name) return;
  const { detectScenes } = await import('../ai/tools.js');
  const { probe } = await import('../core/ffmpeg.js');
  const pm = progressModal(L('Analysiere Edit…', 'Analysing edit…'));
  try {
    const info = await probe(file); const dur = info.duration || 0; const w = info.width || 1080, h = info.height || 1920;
    const cuts = (await detectScenes(file, 0, dur, threshold, (x) => pm.set(x * 0.6, L('Schnitte finden…', 'Finding cuts…')))).filter((x) => x > 0.08 && x < dur - 0.08);
    // brightness per frame (flash / dip detection)
    pm.set(0.65, L('Blitze & Abblenden erkennen…', 'Detecting flashes & dips…'));
    let luma = []; let fps = info.fps || 30;
    try { const log = await ff(['-i', file, '-vf', 'scale=64:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an', '-f', 'null', '-']); luma = [...log.matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]); } catch {}
    const at = (t) => luma[Math.max(0, Math.min(luma.length - 1, Math.round(t * fps)))] ?? 100;
    const bounds = [0, ...cuts, dur]; const slots = []; const trans = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const d = bounds[i + 1] - bounds[i]; if (d < 0.04) continue;
      slots.push({ dur: +d.toFixed(3), ramp: null, fx: [], zoom: 1 });
      if (i < bounds.length - 2) { const c = bounds[i + 1]; let mx = 0, mn = 255; for (let k = -3; k <= 3; k++) { const v = at(c + k / fps); mx = Math.max(mx, v); mn = Math.min(mn, v); } const base = (at(c - 0.4) + at(c + 0.4)) / 2; if (mx > 200 && mx > base + 60) trans.push({ after: slots.length - 1, type: 'flash', dur: 0.2 }); else if (mn < 18 && base > 50) trans.push({ after: slots.length - 1, type: 'dipblack', dur: 0.3 }); }
    }
    const t = { name, cat, aspect: Math.abs(w / h - 9 / 16) < 0.06 ? '9:16' : Math.abs(w / h - 1) < 0.06 ? '1:1' : '16:9', slots, trans, texts: [], total: dur, emoji: '🎞', desc: L('Aus fertigem Video: Schnitte 1:1', 'From a finished video: cuts 1:1') };
    const dir = saveUserTemplate(t);
    pm.set(0.85, L('Sound & Vorschau speichern…', 'Saving sound & preview…'));
    // templates never carry the song – only cuts/effects/transitions; the user picks the music when using it
    try { await ff(['-ss', String(Math.min(dur / 3, 2)), '-i', file, '-frames:v', '1', '-vf', 'scale=360:-2', path.join(dir, 'thumb.jpg')]); } catch {}
    try { await ff(['-i', file, '-t', String(Math.min(dur, 12)), '-an', '-vf', 'scale=360:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', path.join(dir, 'preview.mp4')]); t.reference = path.join(dir, 'preview.mp4'); } catch {}
    const id = JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8')).id;
    fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify({ ...t, id, created: Date.now(), source: file }, null, 1));
    bus.emit('templates');
    toast(L(`Vorlage „${name}“: ${slots.length} Clips, ${trans.length} Übergänge`, `Template "${name}": ${slots.length} clips`), 'ok', 6000);
    return dir;
  } finally { pm.close(); }
}

registerCommands([
  { id: 'templateFromTimeline', name: { de: 'Aktuelles Edit als Vorlage speichern…', en: 'Save current edit as template…' }, cat: 'file', args: '{ name?, cat? }', run: (a = {}) => fromTimeline(a) },
  { id: 'templateFromVideo', name: { de: 'Vorlage aus fertigem Video erstellen…', en: 'Create template from finished video…' }, cat: 'file', args: '{ file?, name?, cat?, threshold? }', run: (a = {}) => fromVideo(a) },
  { id: 'templateCreate', name: { de: 'Vorlage aus JSON anlegen (API/Claude)', en: 'Create template from JSON (API)' }, cat: 'file', hidden: true,
    args: '{ template: { name, cat?, aspect:"9:16"|"16:9", bpm?, slots:[{dur, beats?, ramp?, speed?, fx:[{type,params}]}], trans:[{after,type,dur}], texts:[{t,dur,content,preset?,style?}], look?, adjust?:[{type,params,t?,dur?}], music?:{file(abs path),start} }, musicFile? }',
    run: ({ template, musicFile } = {}) => { const t = deepClone(template); t.total = t.slots.reduce((s, x) => s + x.dur, 0); const dir = saveUserTemplate(t); if (musicFile || t.music?.file) { const src = musicFile || t.music.file; const out = path.join(dir, 'music' + path.extname(src)); fs.copyFileSync(src, out); t.music = { ...(t.music || {}), file: path.basename(out) }; const j = JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8')); fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify({ ...j, music: t.music }, null, 1)); } bus.emit('templates'); return dir; } },
  { id: 'templateList', name: { de: 'Vorlagen auflisten (API)', en: 'List templates (API)' }, cat: 'file', hidden: true, run: () => allTemplates().map((t) => ({ id: t.id, name: t.name, cat: t.cat, aspect: t.aspect, slots: t.slots.length, total: +totalOf(t).toFixed(2), mine: !!t.mine })) },
  { id: 'templateUse', name: { de: 'Vorlage verwenden (API)', en: 'Use template (API)' }, cat: 'file', hidden: true, args: '{ id, mediaIds?: [], musicMediaId?, beatSync? }',
    run: async ({ id, mediaIds = [], musicMediaId, beatSync = true }) => { const t = allTemplates().find((x) => x.id === id || x.name === id); if (!t) throw new Error('Vorlage nicht gefunden'); const assign = t.slots.map(() => null); await smartAssign(t, assign, (mediaIds.length ? mediaIds.map((id) => store.media(id)) : vidMedia())); await buildTemplate(t, assign, { music: musicMediaId ? { kind: 'media', mediaId: musicMediaId } : t.music ? { kind: 'template' } : { kind: 'none' }, beatSync }); return true; } },
  { id: 'templatesOpen', name: { de: 'Vorlagen öffnen', en: 'Open templates' }, cat: 'file', run: () => bus.emit('library:tab', 'templates') },
]);
