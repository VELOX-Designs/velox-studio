// Neural Rendering for video clips – generative AI (SD-Turbo img2img, fixed seed + anti-flicker) re-renders
// every frame more realistically. Strength levels incl. "GTA". Same engine as the photo mode button.
import { store } from '../core/project.js';
import { el, fileUrl } from '../core/util.js';
import { L } from '../core/i18n.js';
import { registerCommands } from '../core/commands.js';
import { modal, toast, progressModal } from '../ui/dialogs.js';
import { pickClip, ensureModels, modelPath, runWorker, processClip } from './neural.js';
import { run as ff, cacheDir } from '../core/ffmpeg.js';
import { NR_LEVELS, NR_SCENES, levelName } from './nrlevels.js';
const path = require('path');

const need = (o) => ['sdturbo', 'span', ...(o.faces ? ['yoloface', 'gfpgan'] : [])];
function cfgFor(o) {
  const scene = NR_SCENES.find((x) => x.id === o.scene) || NR_SCENES[0];
  return { prompt: (o.prompt ? o.prompt + ', ' : '') + scene.p, strength: o.s, seed: 42, faces: o.faces, temporal: o.temporal, detail: o.quality !== 'fast', maxSide: o.quality === 'fast' ? 512 : o.quality === 'max' ? 1024 : 768,
    models: { sd: modelPath('sdturbo'), sr: modelPath('span'), yoloface: modelPath('yoloface'), gfpgan: modelPath('gfpgan') } };
}
async function previewFrame(c, o) {
  const m = store.media(c.mediaId);
  const { sourceTime } = await import('../core/project.js');
  const st = m.type === 'image' ? 0 : sourceTime(c, Math.max(0, Math.min(c.dur - 0.01, store.time - c.start)));
  const dir = cacheDir('preview'); const inp = path.join(dir, 'nr_in_' + Date.now() + '.png'); const out = path.join(dir, 'nr_out_' + Date.now() + '.png');
  await ff(['-ss', String(st), '-i', m.path, '-frames:v', '1', '-vf', "scale='min(1920,iw)':-2", inp]);
  await runWorker({ task: 'neural', input: inp, output: out, ...cfgFor(o) });
  return { inp, out, w: m.width || 16, h: m.height || 9 };
}
export async function neuralVideoDialog() {
  let c; try { c = pickClip(); } catch (e) { toast(e.message, 'err'); return; }
  const o = { s: NR_LEVELS[1].s, level: 'gta', scene: 'all', prompt: '', faces: true, temporal: true, quality: 'normal', all: false };
  if (!(await ensureModels(['ort', ...need(o)]))) return;
  const view = el('div', { style: { position: 'relative', width: '860px', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden' } }, el('div', { class: 'muted', style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' } }, L('KI rechnet die Vorschau…', 'AI is rendering the preview…')));
  const lvl = el('div', { class: 'chips' }), scn = el('div', { class: 'chips' }), qual = el('div', { class: 'chips' });
  const val = el('b', { class: 'tc' }); const hint = el('div', { class: 'muted', style: { fontSize: '11.5px', minHeight: '16px' } });
  const sl = el('input', { type: 'range', min: 0.05, max: 0.5, step: 0.01, value: o.s, style: { flex: 1 } });
  const drawL = () => { lvl.innerHTML = ''; NR_LEVELS.forEach((x) => lvl.append(el('span', { class: 'chip' + (o.level === x.id ? ' on' : ''), style: { fontSize: '13px', padding: '5px 14px' }, onclick: () => { o.level = x.id; o.s = x.s; sl.value = x.s; hint.textContent = L(x.hint.de, x.hint.en); drawL(); } }, levelName(x)))); val.textContent = Math.round((o.s / 0.5) * 100) + '%'; };
  const drawS = () => { scn.innerHTML = ''; NR_SCENES.forEach((x) => scn.append(el('span', { class: 'chip' + (o.scene === x.id ? ' on' : ''), onclick: () => { o.scene = x.id; drawS(); } }, L(x.name.de, x.name.en)))); };
  const drawQ = () => { qual.innerHTML = ''; [['fast', L('Schnell', 'Fast')], ['normal', L('Normal', 'Normal')], ['max', L('Maximal', 'Max')]].forEach(([k, n]) => qual.append(el('span', { class: 'chip' + (o.quality === k ? ' on' : ''), onclick: () => { o.quality = k; drawQ(); } }, n))); };
  sl.oninput = () => { o.s = +sl.value; o.level = 'custom'; hint.textContent = L('Eigene Stärke', 'Custom strength'); drawL(); };
  hint.textContent = L(NR_LEVELS[1].hint.de, NR_LEVELS[1].hint.en); drawL(); drawS(); drawQ();
  const pr = el('input', { type: 'text', placeholder: L('Optional: Zusatz-Beschreibung (Englisch), z. B. „rainy night“', 'Optional: extra description, e.g. "rainy night"'), style: { flex: 1 } }); pr.oninput = () => (o.prompt = pr.value); pr.addEventListener('keydown', (e) => e.stopPropagation());
  const cb = (k, label) => { const i = el('input', { type: 'checkbox', checked: o[k] }); i.onchange = () => (o[k] = i.checked); return el('label', { class: 'chip' }, i, ' ' + label); };
  const show = (r) => {
    view.innerHTML = ''; view.style.aspectRatio = `${r.w}/${r.h}`;
    const after = el('img', { src: fileUrl(r.out), style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } });
    const beforeWrap = el('div', { style: { position: 'absolute', inset: 0, width: '50%', overflow: 'hidden' } }, el('img', { src: fileUrl(r.inp), style: { position: 'absolute', left: 0, top: 0, width: '860px', height: '100%', objectFit: 'contain' } }));
    const line = el('div', { style: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: '2px', background: '#fff', boxShadow: '0 0 6px #000' } });
    view.append(after, beforeWrap, line, el('span', { class: 'chip', style: { position: 'absolute', left: '8px', top: '8px' } }, L('Original', 'Original')), el('span', { class: 'chip on', style: { position: 'absolute', right: '8px', top: '8px' } }, 'Neural ' + Math.round((o.s / 0.5) * 100) + '%'));
    view.onmousemove = (e) => { const b = view.getBoundingClientRect(); const k = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)); beforeWrap.style.width = k * 100 + '%'; line.style.left = k * 100 + '%'; };
  };
  const doPreview = async () => {
    view.innerHTML = ''; view.appendChild(el('div', { class: 'muted', style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' } }, L('KI rechnet die Vorschau… (erstes Mal ca. 10 s)', 'AI rendering preview… (first time ~10 s)')));
    try { if (!(await ensureModels(['ort', ...need(o)]))) return; show(await previewFrame(c, o)); } catch (e) { view.innerHTML = ''; view.appendChild(el('div', { style: { color: 'var(--err)', padding: '20px' } }, e.message)); }
  };
  const body = el('div', {},
    el('div', { class: 'muted', style: { marginBottom: '8px' } }, L('Generative KI malt jedes Bild realistischer neu – Gesichter, Autos, Umgebung. Läuft lokal auf deiner Grafikkarte (ca. 1 Bild/s). Clip: ', 'Generative AI repaints every frame more realistically – locally on your GPU (~1 frame/s). Clip: ') + (c.name || '')),
    view,
    el('div', { class: 'row', style: { marginTop: '10px' } }, el('b', {}, L('Stärke', 'Strength')), lvl, el('span', { class: 'spacer' }), val), el('div', { class: 'row' }, sl), hint,
    el('div', { class: 'row', style: { marginTop: '6px' } }, el('b', {}, L('Was?', 'What?')), scn),
    el('div', { class: 'row' }, pr),
    el('div', { class: 'row' }, el('b', {}, L('Qualität', 'Quality')), qual, el('span', { class: 'spacer' }), cb('faces', L('Gesichter', 'Faces')), cb('temporal', L('Flimmer-Schutz', 'Anti-flicker')), cb('all', L('ALLE Clips', 'ALL clips'))));
  modal({ title: '✦ Neural Rendering', width: 900, body, buttons: [
    { label: L('Vorschau', 'Preview'), onClick: () => { doPreview(); return false; } },
    { label: L('Abbrechen', 'Cancel'), value: null },
    { label: L('Rendern', 'Render'), cls: 'primary', onClick: () => {
      const list = o.all ? store.p.clips.filter((x) => x.type === 'video' || x.type === 'image') : [c];
      setTimeout(async () => {
        let n = 0;
        for (const x of list) { try { if (await processClip('neural', 'Neural Rendering', cfgFor(o), { models: need(o), clip: store.clip(x.id) || x })) n++; else break; } catch (e) { toast('Neural Rendering: ' + e.message, 'err', 9000); break; } }
        if (n) toast(L(`Neural Rendering auf ${n} Clip(s) fertig`, `Neural Rendering done on ${n} clip(s)`), 'ok', 6000);
      }, 50);
    } },
  ] });
  doPreview();
}

registerCommands([
  { id: 'neuralRender', name: { de: 'Neural Rendering (generativ realistischer)…', en: 'Neural Rendering (generative realism)…' }, cat: 'ai', key: 'Ctrl+Shift+N', run: () => neuralVideoDialog() },
  { id: 'neuralRenderApply', name: { de: 'Neural Rendering anwenden (API)', en: 'Apply Neural Rendering (API)' }, cat: 'ai', hidden: true, args: '{ strength?: 0.05–0.5, scene?, prompt?, quality?: fast|normal|max, faces? }',
    run: async (a = {}) => { const c = pickClip(); const o = { s: a.strength ?? 0.18, scene: a.scene || 'all', prompt: a.prompt || '', faces: a.faces !== false, temporal: true, quality: a.quality || 'normal' }; return !!(await processClip('neural', 'Neural Rendering', cfgFor(o), { models: need(o), clip: c })); } },
]);
