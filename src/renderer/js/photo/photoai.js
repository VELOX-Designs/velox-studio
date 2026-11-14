// VELOX Foto – AI tools on layers (runs the same GPU worker as the video AI).
import { L } from '../core/i18n.js';
import { fileUrl } from '../core/util.js';
import { cacheDir } from '../core/ffmpeg.js';
import { ensureModels, runWorker, modelPath } from '../ai/neural.js';
import { progressModal } from '../ui/dialogs.js';
import { canvas, ctx2d } from './doc.js';
const fs = require('fs');
const path = require('path');

export async function canvasToFile(cv, name = 'in') {
  const f = path.join(cacheDir('photo'), `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  const buf = await new Promise((r) => cv.toBlob((b) => b.arrayBuffer().then((a) => r(Buffer.from(a))), 'image/png'));
  fs.writeFileSync(f, buf); return f;
}
export function fileToCanvas(f) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => { const c = canvas(i.naturalWidth, i.naturalHeight); ctx2d(c).drawImage(i, 0, 0); res(c); }; i.onerror = () => rej(new Error('Bild nicht lesbar: ' + f)); i.src = fileUrl(f) + '?' + Date.now(); });
}
// run one worker task on a canvas; returns result canvas
export async function aiOnCanvas(cv, task, cfg, models, label) {
  if (!(await ensureModels(['ort', ...models]))) return null;
  const inp = await canvasToFile(cv, 'in'); const out = inp.replace(/in_(\d+)/, 'out_$1');
  const pm = progressModal(label); const ac = new AbortController(); pm.onCancel(() => ac.abort());
  try { await runWorker({ task, input: inp, output: out, ...cfg }, (p, t) => pm.set(p, t), ac.signal); }
  catch (e) { if (ac.signal.aborted) return null; throw e; }
  finally { pm.close(); }
  return fileToCanvas(out);
}
export const AI = {
  dlss5: (cv, s = 0.55) => aiOnCanvas(cv, 'dlss5', { strength: s, faces: true, detail: true, temporal: false, models: { sr: modelPath('span'), yoloface: modelPath('yoloface'), gfpgan: modelPath('gfpgan') } }, ['span', 'yoloface', 'gfpgan'], 'DLSS5'),
  upscale: (cv, f = 2, quality = false) => { const model = quality ? (f >= 4 ? 'esrgan_x4' : 'esrgan_x2') : 'span'; return aiOnCanvas(cv, 'upscale', { scale: quality ? (f >= 4 ? 4 : 2) : 4, outW: Math.min(16000, cv.width * f) & ~1, outH: Math.min(16000, cv.height * f) & ~1, models: { esrgan: modelPath(model) } }, [model], L('KI-Hochskalieren ×', 'AI upscale ×') + f); },
  faces: (cv) => aiOnCanvas(cv, 'face', { strength: 1, models: { yoloface: modelPath('yoloface'), gfpgan: modelPath('gfpgan') } }, ['yoloface', 'gfpgan'], L('Gesichter verbessern', 'Enhance faces')),
  bgremove: (cv) => aiOnCanvas(cv, 'bgremove', { matteKind: 'rmbg', models: { matte: modelPath('rmbg') } }, ['rmbg'], L('Hintergrund entfernen', 'Remove background')),
  // generative: o = { prompt, strength, steps, mask (canvas, optional), faces }
  neural: async (cv, o) => {
    const extra = {};
    if (o.mask) extra.mask = await canvasToFile(o.mask, 'mask');
    return aiOnCanvas(cv, 'neural', { prompt: o.prompt, negative: o.negative, strength: o.strength, steps: o.steps || 2, seed: o.seed ?? 42, faces: !!o.faces, detail: o.detail !== false, maxSide: o.maxSide || 1024, ...extra, models: { sd: modelPath('sdturbo'), sr: modelPath('span'), yoloface: modelPath('yoloface'), gfpgan: modelPath('gfpgan') } }, ['sdturbo', 'span', ...(o.faces ? ['yoloface', 'gfpgan'] : [])], o.label || 'Neural Rendering');
  },
};
