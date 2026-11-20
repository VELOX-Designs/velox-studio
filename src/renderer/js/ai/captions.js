// Animated TikTok captions: local Whisper transcription → short word-timed caption clips with
// CapCut-style highlight styles (pop, box, karaoke, reveal …). Every caption stays a normal text clip.
import { store, clipEnd, sourceLength } from '../core/project.js';
import { el } from '../core/util.js';
import { L } from '../core/i18n.js';
import { settings } from '../core/settings.js';
import { registerCommands } from '../core/commands.js';
import { addTextClip, freeVideoTrack } from '../core/media.js';
import { modal, toast, progressModal } from '../ui/dialogs.js';
import { transcribe } from './tools.js';

const base = { font: 'Bahnschrift', weight: 900, size: 84, color: '#ffffff', color2: '', stroke: 0, strokeColor: '#000000', shadow: 0.5, shadowColor: '#000000', glow: 0, bg: '', anim: 'pop', animOut: 'none', animDur: 0.12, upper: true, letter: 0, lineHeight: 1.08, boxW: 0.82, loop: 'none', italic: false, extrude: 0 };
export const CAPTION_PRESETS = [
  { id: 'cap_pop', name: 'Pop Gelb', words: 3, text: { ...base, stroke: 7, cap: 'pop', hiColor: '#ffe14d' } },
  { id: 'cap_box', name: 'Box Grün', words: 3, text: { ...base, shadow: 0.35, cap: 'box', hiBg: '#22c55e', hiText: '#ffffff' } },
  { id: 'cap_boxlila', name: 'Box Lila', words: 3, text: { ...base, font: 'Segoe UI Black', shadow: 0.35, cap: 'box', hiBg: '#7c5cff', hiText: '#ffffff' } },
  { id: 'cap_karaoke', name: 'Karaoke', words: 5, text: { ...base, weight: 800, stroke: 5, cap: 'karaoke', hiColor: '#1ec8d4', upper: false } },
  { id: 'cap_reveal', name: 'Wort für Wort', words: 4, text: { ...base, stroke: 6, cap: 'reveal', hiColor: '#ffd400', anim: 'none' } },
  { id: 'cap_one', name: 'Ein Wort groß', words: 1, text: { ...base, font: 'Impact', weight: 400, size: 120, stroke: 8, cap: 'pop', hiColor: '#ffffff', animDur: 0.08 } },
  { id: 'cap_neon', name: 'Neon', words: 3, text: { ...base, weight: 800, glow: 22, glowColor: '#ff2bd6', shadow: 0, cap: 'highlight', hiColor: '#ff7ae8' } },
  { id: 'cap_bounce', name: 'Bounce Rot', words: 3, text: { ...base, stroke: 7, cap: 'bounce', hiColor: '#ff3b3b' } },
  { id: 'cap_clean', name: 'Clean', words: 6, text: { ...base, font: 'Segoe UI', weight: 700, size: 66, upper: false, shadow: 0.7, cap: 'dim', hiColor: '#ffffff', anim: 'fade', animDur: 0.15 } },
  { id: 'cap_classic', name: 'Klassisch', words: 8, text: { ...base, font: 'Arial', weight: 700, size: 58, upper: false, shadow: 0, bg: 'rgba(0,0,0,0.6)', bgPad: 14, bgRadius: 8, cap: 'none', anim: 'none' } },
];

window.__capPresets = CAPTION_PRESETS.map((p) => ({ id: p.id, name: p.name }));

// ------------------------------------------------------------------ word timing (Whisper gives segments → estimate words by syllables)
const syl = (w) => Math.max(1, (w.toLowerCase().match(/[aeiouyäöüéèàáíóú]+/g) || []).length) + (/[.,!?;:]$/.test(w) ? 0.6 : 0);
export function wordsFromSegments(segs) {
  const out = [];
  for (const s of segs) {
    const ws = String(s.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); if (!ws.length) continue;
    const wt = ws.map((w) => syl(w) + 0.35); const sum = wt.reduce((a, b) => a + b, 0);
    let t = s.start; const len = Math.max(0.05, s.end - s.start);
    ws.forEach((w, i) => { const d = (wt[i] / sum) * len; out.push({ w, t0: t, t1: t + d, endSeg: i === ws.length - 1 }); t += d; });
  }
  return out;
}
export function chunkWords(words, perCap) {
  const caps = []; let cur = [];
  const flush = () => { if (cur.length) caps.push(cur); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]; const prev = cur[cur.length - 1];
    if (prev && (w.t0 - prev.t1 > 0.6)) flush(); // pause → new caption
    cur.push(w);
    const chars = cur.reduce((a, x) => a + x.w.length + 1, 0);
    if (cur.length >= perCap || (perCap > 3 && chars > 28) || (w.endSeg && perCap > 1 && /[.!?]$/.test(w.w))) flush();
  }
  flush();
  return caps;
}

function sourceClip() {
  const s = store.selectedClips(); let c = s.find((x) => x.type === 'audio') || s.find((x) => x.type === 'video');
  if (!c) { const t = store.time; c = store.p.clips.find((x) => (x.type === 'audio' || x.type === 'video') && x.start <= t && clipEnd(x) > t && store.media(x.mediaId)?.hasAudio !== false); }
  if (!c) c = store.p.clips.find((x) => x.type === 'video' && store.media(x.mediaId)?.hasAudio) || store.p.clips.find((x) => x.type === 'audio');
  if (!c) throw new Error(L('Kein Clip mit Sprache gefunden – Clip auswählen', 'No clip with speech found – select one'));
  return c;
}
const posY = (pos, H, vertical) => (pos === 'top' ? -H * (vertical ? 0.26 : 0.3) : pos === 'center' ? 0 : H * (vertical ? 0.2 : 0.3));
function textFor(preset, opt) {
  const P = store.p.settings; const k = Math.min(P.width, P.height) / 1080;
  const t = { ...preset.text, size: Math.round(preset.text.size * k * (opt.sizeMul || 1)) };
  if (opt.upper != null) t.upper = opt.upper;
  if (opt.hiColor) { if (t.cap === 'box') t.hiBg = opt.hiColor; else t.hiColor = opt.hiColor; }
  return t;
}

export async function createCaptions({ clipId, lang = 'auto', preset = 'cap_pop', words: perCap, pos = 'bottom', upper, hiColor, segments } = {}) {
  const c = (clipId && store.clip(clipId)) || sourceClip(); const m = store.media(c.mediaId);
  const pr = CAPTION_PRESETS.find((x) => x.id === preset) || CAPTION_PRESETS[0];
  perCap = perCap || pr.words;
  let segs = segments;
  if (!segs) {
    const pm = progressModal(L('Erkenne Sprache (lokal)…', 'Transcribing (local)…'));
    try { segs = await transcribe(m.path, c.in, sourceLength(c), lang, (p) => pm.set(p)); } finally { pm.close(); }
  }
  const words = wordsFromSegments(segs);
  if (!words.length) { toast(L('Keine Sprache erkannt', 'No speech detected'), 'err'); return 0; }
  const caps = chunkWords(words, perCap);
  const sp = c.speed || 1; const tl = (s) => c.start + s / sp; // segment times are relative to c.in
  const P = store.p.settings; const vertical = P.height > P.width;
  let n = 0;
  store.edit(L('Animierte Untertitel', 'Animated captions'), (p) => {
    const a0 = tl(caps[0][0].t0), b0 = tl(caps[caps.length - 1].slice(-1)[0].t1);
    const tr = freeVideoTrack(p, a0, b0 + 0.5, 1);
    caps.forEach((cw, i) => {
      const a = tl(cw[0].t0); let b = tl(cw[cw.length - 1].t1);
      const next = caps[i + 1] ? tl(caps[i + 1][0].t0) : Infinity;
      if (next - b < 0.35) b = next; // no flicker between captions
      b = Math.min(b, next, clipEnd(c));
      if (b - a < 0.08) return;
      const content = cw.map((x) => x.w).join(' ');
      const text = { ...textFor(pr, { upper, hiColor }), content, words: cw.map((x) => [+(tl(x.t0) - a).toFixed(3), +(tl(x.t1) - a).toFixed(3)]) };
      const tc = addTextClip(p, Math.round(a * store.fps) / store.fps, text, Math.max(0.1, b - a), tr.id);
      tc.caption = { preset: pr.id, pos }; tc.name = '💬 ' + content.slice(0, 26);
      tc.transform.y = posY(pos, P.height, vertical);
      n++;
    });
  });
  toast(L(`${n} animierte Untertitel erstellt – Stil jederzeit im Inspector änderbar`, `${n} animated captions created`), 'ok', 6000);
  return n;
}
export function restyleCaptions({ preset, pos, upper, hiColor, all = true } = {}) {
  const pr = CAPTION_PRESETS.find((x) => x.id === preset);
  const sel = new Set(store.selectedClips().map((c) => c.id));
  const list = store.p.clips.filter((c) => c.type === 'text' && c.caption && (all || sel.has(c.id)));
  if (!list.length) throw new Error(L('Keine automatischen Untertitel in der Timeline', 'No auto captions on the timeline'));
  const P = store.p.settings; const vertical = P.height > P.width;
  store.edit(L('Untertitel-Stil', 'Caption style'), () => {
    for (const c of list) {
      if (pr) { const keep = { content: c.text.content, words: c.text.words }; c.text = { ...c.text, ...textFor(pr, { upper, hiColor }), ...keep }; c.caption.preset = pr.id; }
      else { if (upper != null) c.text.upper = upper; if (hiColor) { if (c.text.cap === 'box') c.text.hiBg = hiColor; else c.text.hiColor = hiColor; } }
      if (pos) { c.caption.pos = pos; c.transform.y = posY(pos, P.height, vertical); }
    }
  });
  return list.length;
}

// ------------------------------------------------------------------ dialog
function presetTile(p, on, onClick) {
  const t = p.text; const sample = el('div', { style: { font: `${t.italic ? 'italic ' : ''}${t.weight} 13px "${t.font}", Arial`, textTransform: t.upper ? 'uppercase' : 'none', color: t.color, textShadow: t.stroke ? '0 0 2px #000, 1px 1px 0 #000, -1px -1px 0 #000' : t.glow ? `0 0 8px ${t.glowColor}` : '0 1px 3px #000', whiteSpace: 'nowrap' } },
    'das ', t.cap === 'box' ? el('span', { style: { background: t.hiBg, borderRadius: '4px', padding: '0 4px' } }, 'ist') : el('span', { style: { color: t.cap === 'none' ? t.color : t.hiColor || t.color, display: 'inline-block', transform: t.cap === 'pop' ? 'scale(1.15)' : 'none' } }, 'ist'), ' krass');
  return el('div', { class: 'cap-tile' + (on ? ' on' : ''), onclick: onClick, style: { background: t.bg ? '#2a2f3a' : 'linear-gradient(135deg,#2b3446,#151a22)', borderRadius: '10px', padding: '12px 8px 8px', cursor: 'pointer', border: on ? '2px solid var(--accent, #1ec8d4)' : '2px solid transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', overflow: 'hidden', minWidth: 0 } },
    t.bg ? el('div', { style: { background: t.bg, padding: '2px 6px', borderRadius: '4px' } }, sample) : sample, el('div', { class: 'muted', style: { fontSize: '11px' } }, p.name));
}
export async function captionsDialog() {
  let src; try { src = sourceClip(); } catch (e) { toast(e.message, 'err'); return; }
  const st = { preset: 'cap_pop', lang: settings.lang === 'en' ? 'en' : 'de', words: 0, pos: 'bottom', upper: '', hiColor: '' };
  const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px', margin: '8px 0 12px' } });
  const drawGrid = () => { grid.innerHTML = ''; for (const p of CAPTION_PRESETS) grid.appendChild(presetTile(p, st.preset === p.id, () => { st.preset = p.id; drawGrid(); })); };
  drawGrid();
  const sel = (opts, key) => { const s = el('select', {}, ...opts.map(([v, n]) => el('option', { value: v }, n))); s.value = String(st[key]); s.onchange = () => (st[key] = isNaN(+s.value) || s.value === '' ? s.value : +s.value); return s; };
  const ok = await new Promise((res) => modal({ title: '💬 ' + L('Animierte Untertitel', 'Animated captions'), width: 640, body: el('div', {},
    el('p', { class: 'muted', style: { marginTop: 0 } }, L('VELOX hört zu (Whisper, lokal), schreibt mit und animiert jedes Wort im Takt der Sprache. Alles bleibt danach bearbeitbar.', 'VELOX listens (Whisper, local), transcribes and animates every word in time with the speech. Everything stays editable.') + ' · ' + (src.name || '')),
    grid,
    el('div', { class: 'form' },
      el('label', {}, L('Sprache', 'Language')), sel([['de', 'Deutsch'], ['en', 'English'], ['auto', 'Automatisch'], ['tr', 'Türkçe'], ['fr', 'Français'], ['es', 'Español'], ['pl', 'Polski'], ['ru', 'Русский'], ['ar', 'العربية']], 'lang'),
      el('label', {}, L('Wörter pro Untertitel', 'Words per caption')), sel([[0, L('Wie Stil', 'Per style')], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [6, '6'], [10, L('Ganze Sätze', 'Sentences')]], 'words'),
      el('label', {}, L('Position', 'Position')), sel([['bottom', L('Unten', 'Bottom')], ['center', L('Mitte', 'Center')], ['top', L('Oben', 'Top')]], 'pos'),
      el('label', {}, L('Großbuchstaben', 'Uppercase')), sel([['', L('Wie Stil', 'Per style')], ['1', L('Ja', 'Yes')], ['0', L('Nein', 'No')]], 'upper'),
      el('label', {}, L('Highlight-Farbe', 'Highlight colour')), (() => { const i = el('input', { type: 'color', value: '#ffe14d' }); const cb = el('input', { type: 'checkbox' }); const upd = () => (st.hiColor = cb.checked ? i.value : ''); i.oninput = () => { cb.checked = true; upd(); }; cb.onchange = upd; return el('div', { class: 'row', style: { margin: 0, alignItems: 'center', gap: '6px' } }, cb, i, el('span', { class: 'muted' }, L('eigene Farbe', 'custom'))); })())),
    buttons: [{ label: L('Abbrechen', 'Cancel'), value: false }, { label: L('Untertitel erstellen', 'Create captions'), cls: 'primary', value: true }], onClose: res }));
  if (!ok) return;
  return createCaptions({ clipId: src.id, lang: st.lang, preset: st.preset, words: st.words || undefined, pos: st.pos, upper: st.upper === '' || st.upper == null ? undefined : st.upper === 1 || st.upper === '1', hiColor: st.hiColor || undefined });
}

registerCommands([
  { id: 'aiCaptions', name: { de: 'Animierte Untertitel…', en: 'Animated captions…' }, cat: 'ai', key: 'Ctrl+Alt+U', run: () => captionsDialog() },
  { id: 'aiCaptionsApi', name: { de: 'Animierte Untertitel (API)', en: 'Animated captions (API)' }, cat: 'ai', hidden: true, args: '{ clipId?, lang?, preset?, words?, pos?: "bottom"|"center"|"top", upper?, hiColor?, segments?: [{start,end,text}] }', run: (a = {}) => createCaptions(a) },
  { id: 'captionStyle', name: { de: 'Untertitel-Stil ändern (alle)', en: 'Change caption style (all)' }, cat: 'ai', hidden: true, args: '{ preset?, pos?, upper?, hiColor?, all? }', run: (a = {}) => restyleCaptions(a) },
]);
