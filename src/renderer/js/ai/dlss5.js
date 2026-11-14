// "DLSS5" – one-button AI realism overhaul: neural texture/detail reconstruction (SPAN), face restoration
// (YOLOface + GFPGAN), temporal anti-flicker, plus the GPU realism look (light, depth, colour) – strength adjustable.
import { store, clipEnd } from '../core/project.js';
import { el, bus, fileUrl, uid, deepClone } from '../core/util.js';
import { L } from '../core/i18n.js';
import { registerCommands, run } from '../core/commands.js';
import { modal, toast, progressModal } from '../ui/dialogs.js';
import { BUILTIN_PRESETS } from '../ui/presets.js';
import { defaultParams } from '../render/effects.js';
import { pickClip, ensureModels, modelPath, runWorker } from './neural.js';
import { run as ff, cacheDir } from '../core/ffmpeg.js';
import { paths } from '../core/settings.js';
const fs = require('fs');
const path = require('path');

export const DLSS_LEVELS = [
  { id: 'natural', name: { de: 'Natürlich', en: 'Natural' }, s: 0.3, hint: { de: 'Dezent, fast unsichtbar – nur schärfer und sauberer', en: 'Subtle – just cleaner and sharper' } },
  { id: 'gta', name: { de: 'GTA', en: 'GTA' }, s: 0.55, hint: { de: 'Für GTA/FiveM-Clips: realistischer, aber nicht übertrieben', en: 'For GTA/FiveM clips: more real, not overdone' } },
  { id: 'strong', name: { de: 'Stark', en: 'Strong' }, s: 0.8, hint: { de: 'Deutlich realistischer – Licht, Texturen, Gesichter', en: 'Clearly more realistic' } },
  { id: 'ultra', name: { de: 'Ultra', en: 'Ultra' }, s: 1, hint: { de: 'Maximum – kann bei manchen Szenen zu krass sein', en: 'Maximum – may be too much for some scenes' } },
];
// GPU part of the look (added as a filter whose strength = slider)
BUILTIN_PRESETS.push({ id: 'dlss5', kind: 'realism', name: 'DLSS5 Look', effects: [{ type: 'realism', params: { preset: 1, strength: 1, detail: 1.1, sharpen: 0.55, lighting: 0.8, depth: 0.7, bloom: 0.4, color: 0.8, dehaze: 0.35, grain: 0.15, lens: 0.3 } }, { type: 'clarity', params: { amount: 0.5, radius: 18 } }] });

const MODELS = ['span', 'yoloface', 'gfpgan'];
function cfgFor(o) { return { strength: o.s, faces: o.faces, detail: o.detail, temporal: o.temporal, models: { sr: modelPath('span'), yoloface: modelPath('yoloface'), gfpgan: modelPath('gfpgan') } }; }

async function previewFrame(c, o) {
  const m = store.media(c.mediaId);
  const { sourceTime } = await import('../core/project.js');
  const st = m.type === 'image' ? 0 : sourceTime(c, Math.max(0, Math.min(c.dur - 0.01, store.time - c.start)));
  const dir = cacheDir('preview'); const inp = path.join(dir, 'dl_in_' + Date.now() + '.png'); const out = path.join(dir, 'dl_out_' + Date.now() + '.png');
  await ff(['-ss', String(st), '-i', m.path, '-frames:v', '1', '-vf', "scale='min(1920,iw)':-2", inp]);
  await runWorker({ task: 'dlss5', input: inp, output: out, ...cfgFor(o) });
  return { inp, out, w: m.width || 16, h: m.height || 9 };
}

async function applyToClip(c, o) {
  const m = store.media(c.mediaId); const isImg = m.type === 'image';
  const { sourceLength } = await import('../core/project.js');
  const start = isImg ? 0 : Math.max(0, c.in - 0.1), dur = isImg ? 0 : Math.min(m.duration - start, sourceLength(c) + 0.2);
  const out = path.join(paths.velox, 'KI-Ergebnisse', `${m.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}_DLSS5_${Math.round(o.s * 100)}_${start.toFixed(2)}_${dur.toFixed(2)}${isImg ? '.png' : '.mp4'}`);
  const pm = progressModal('DLSS5 · ' + (c.name || ''));
  const ac = new AbortController(); pm.onCancel(() => ac.abort());
  try {
    if (!fs.existsSync(out)) await runWorker({ task: 'dlss5', input: m.path, output: out, start, duration: dur, ...cfgFor(o) }, (p, t) => pm.set(p, t), ac.signal);
  } catch (e) { pm.close(); if (ac.signal.aborted) return false; throw e; }
  pm.close();
  const { importFiles } = await import('../core/media.js');
  const [nm] = await importFiles([out]); nm.folder = m.folder;
  const preset = BUILTIN_PRESETS.find((p) => p.id === 'dlss5');
  store.edit('DLSS5', () => {
    for (const x of [c, ...store.linked(c)]) {
      if (x.type !== 'video' && x.type !== 'image') continue;
      x.mediaId = nm.id; if (!isImg) x.in = Math.max(0, x.in - start); x.name = m.name + ' · DLSS5';
      if (o.look) { x.effects = x.effects.filter((f) => !f.fromFilter); x.filter = 'dlss5'; x.filterAmt = o.s; x.effects.push(...preset.effects.map((f) => ({ id: uid('fx'), type: f.type, enabled: true, fromFilter: 'dlss5', params: Object.assign(defaultParams(f.type), deepClone(f.params)) }))); }
    }
  });
  return true;
}

export async function dlss5Dialog() {
  let c; try { c = pickClip(); } catch (e) { toast(e.message, 'err'); return; }
  if (!(await ensureModels(['ort', ...MODELS]))) return;
  const o = { s: 0.55, level: 'gta', faces: true, detail: true, temporal: true, look: true, all: false };
  const view = el('div', { style: { position: 'relative', width: '860px', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden' } }, el('div', { class: 'muted', style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' } }, L('Stärke wählen → „Vorschau“', 'Pick a strength → "Preview"')));
  const lvl = el('div', { class: 'chips' });
  const val = el('b', { class: 'tc' }, Math.round(o.s * 100) + '%');
  const sl = el('input', { type: 'range', min: 0.1, max: 1, step: 0.01, value: o.s, style: { flex: 1 } });
  const hint = el('div', { class: 'muted', style: { fontSize: '11.5px' } });
  const drawLvl = () => { lvl.innerHTML = ''; for (const l of DLSS_LEVELS) lvl.appendChild(el('span', { class: 'chip' + (o.level === l.id ? ' on' : ''), style: { fontSize: '13px', padding: '5px 14px' }, onclick: () => { o.level = l.id; o.s = l.s; sl.value = l.s; val.textContent = Math.round(l.s * 100) + '%'; hint.textContent = L(l.hint.de, l.hint.en); drawLvl(); } }, L(l.name.de, l.name.en))); };
  sl.oninput = () => { o.s = +sl.value; o.level = 'custom'; val.textContent = Math.round(o.s * 100) + '%'; hint.textContent = L('Eigene Stärke', 'Custom strength'); drawLvl(); };
  hint.textContent = L(DLSS_LEVELS[1].hint.de, DLSS_LEVELS[1].hint.en); drawLvl();
  const cb = (k, label) => { const i = el('input', { type: 'checkbox', checked: o[k] }); i.onchange = () => (o[k] = i.checked); return el('label', { class: 'chip' }, i, ' ' + label); };
  const show = (r) => {
    view.innerHTML = '';
    view.style.aspectRatio = `${r.w}/${r.h}`;
    const after = el('img', { src: fileUrl(r.out), style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', filter: o.look ? `contrast(${1 + 0.12 * o.s}) saturate(${1 + 0.15 * o.s})` : '' } });
    const beforeWrap = el('div', { style: { position: 'absolute', inset: 0, width: '50%', overflow: 'hidden' } }, el('img', { src: fileUrl(r.inp), style: { position: 'absolute', left: 0, top: 0, width: '860px', height: '100%', objectFit: 'contain' } }));
    const line = el('div', { style: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: '2px', background: '#fff', boxShadow: '0 0 6px #000' } });
    view.append(after, beforeWrap, line, el('span', { class: 'chip', style: { position: 'absolute', left: '8px', top: '8px' } }, L('Original', 'Original')), el('span', { class: 'chip on', style: { position: 'absolute', right: '8px', top: '8px' } }, 'DLSS5 ' + Math.round(o.s * 100) + '%'));
    view.onmousemove = (e) => { const b = view.getBoundingClientRect(); const k = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)); beforeWrap.style.width = k * 100 + '%'; line.style.left = k * 100 + '%'; };
  };
  const doPreview = async () => {
    view.innerHTML = ''; view.appendChild(el('div', { class: 'muted', style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' } }, L('KI rechnet…', 'AI working…')));
    try { show(await previewFrame(c, o)); } catch (e) { view.innerHTML = ''; view.appendChild(el('div', { style: { color: 'var(--err)', padding: '20px' } }, e.message)); }
  };
  const body = el('div', {},
    el('div', { class: 'muted', style: { marginBottom: '8px' } }, L('Macht Gesichter, Autos und Umgebung realistischer – komplett lokal auf deiner Grafikkarte. Clip: ', 'Makes faces, cars and surroundings more realistic – locally on your GPU. Clip: ') + (c.name || '')),
    view,
    el('div', { class: 'row', style: { marginTop: '10px' } }, el('b', {}, L('Stärke', 'Strength')), lvl, el('span', { class: 'spacer' }), val),
    el('div', { class: 'row' }, sl), hint,
    el('div', { class: 'chips', style: { marginTop: '6px' } }, cb('detail', L('Texturen & Details', 'Textures & detail')), cb('faces', L('Gesichter', 'Faces')), cb('temporal', L('Flimmer-Schutz', 'Anti-flicker')), cb('look', L('Licht & Farbe (Echtzeit)', 'Light & color (real-time)')), cb('all', L('Auf ALLE Clips der Timeline', 'Apply to ALL clips'))));
  modal({ title: '⚡ DLSS5 – KI-Realismus', width: 900, body, buttons: [
    { label: L('Vorschau', 'Preview'), onClick: () => { doPreview(); return false; } },
    { label: L('Abbrechen', 'Cancel'), value: null },
    { label: L('Anwenden', 'Apply'), cls: 'primary', onClick: async () => {
      const list = o.all ? store.p.clips.filter((x) => x.type === 'video' || x.type === 'image') : [c];
      setTimeout(async () => {
        let n = 0;
        for (const x of list) { try { if (await applyToClip(store.clip(x.id) || x, o)) n++; else break; } catch (e) { toast('DLSS5: ' + e.message, 'err', 8000); break; } }
        if (n) toast(L(`DLSS5 auf ${n} Clip(s) angewendet`, `DLSS5 applied to ${n} clip(s)`), 'ok', 5000);
      }, 50);
    } },
  ] });
  doPreview();
}

registerCommands([
  { id: 'dlss5', name: { de: 'DLSS5 – KI-Realismus', en: 'DLSS5 – AI realism' }, cat: 'ai', key: 'Ctrl+Shift+X', run: () => dlss5Dialog() },
  { id: 'dlss5Apply', name: { de: 'DLSS5 anwenden (API)', en: 'Apply DLSS5 (API)' }, cat: 'ai', hidden: true, args: '{ strength?: 0.1–1, all?, faces?, detail?, temporal?, look? }', run: async (a = {}) => {
    if (!(await ensureModels(['ort', ...MODELS]))) return;
    const o = { s: a.strength ?? 0.55, faces: a.faces !== false, detail: a.detail !== false, temporal: a.temporal !== false, look: a.look !== false };
    const list = a.all ? store.p.clips.filter((x) => x.type === 'video' || x.type === 'image') : [pickClip()];
    for (const x of list) await applyToClip(store.clip(x.id) || x, o);
    return list.length;
  } },
]);
