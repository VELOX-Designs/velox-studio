// Live previews for effects / transitions / presets in the library (rendered with the real compositor).
import { Compositor } from '../render/compositor.js';
import { newClip, defaultTransform } from '../core/project.js';
import { defaultParams } from '../render/effects.js';

const PW = 320, PH = 180;
let comp = null, sampleA = null, sampleB = null;

function makeSample(variant) {
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, PH);
  if (variant === 0) { sky.addColorStop(0, '#1d3b6e'); sky.addColorStop(0.55, '#e0805a'); sky.addColorStop(1, '#2a1a2e'); }
  else { sky.addColorStop(0, '#0d4f4a'); sky.addColorStop(0.6, '#5fd3a5'); sky.addColorStop(1, '#10261f'); }
  g.fillStyle = sky; g.fillRect(0, 0, PW, PH);
  g.fillStyle = variant === 0 ? '#ffd27a' : '#fff6c8'; g.beginPath(); g.arc(variant ? 70 : 230, 70, 24, 0, 7); g.fill();
  g.fillStyle = variant === 0 ? '#120d1c' : '#0a1f19';
  g.beginPath(); g.moveTo(0, PH); for (let x = 0; x <= PW; x += 16) g.lineTo(x, 120 + Math.sin(x * 0.05 + variant) * 18 + (x % 48 === 0 ? -14 : 0)); g.lineTo(PW, PH); g.fill();
  for (let i = 0; i < 6; i++) { g.fillStyle = variant ? '#1b3a32' : '#241a33'; g.fillRect(20 + i * 50, 95 - (i % 3) * 18, 26, 90); g.fillStyle = '#ffe9a8'; for (let w = 0; w < 6; w++) if ((i + w) % 3) g.fillRect(25 + i * 50 + (w % 2) * 10, 100 - (i % 3) * 18 + Math.floor(w / 2) * 14, 5, 6); }
  g.fillStyle = '#fff'; g.font = '900 34px Segoe UI'; g.textAlign = 'center'; g.fillText(variant ? 'B' : 'A', PW / 2, 60);
  return c;
}

function init() {
  if (comp && !comp.g.gl.isContextLost()) return;
  const cv = document.createElement('canvas');
  comp = new Compositor(cv, { preserve: true });
  comp.setSize(PW, PH);
  comp.bicubic = false;
  sampleA = makeSample(0); sampleB = makeSample(1);
}
const provider = { source: (clip) => ({ key: 'pv_' + clip.mediaId, img: clip.mediaId === 'A' ? sampleA : sampleB, w: PW, h: PH, version: clip.mediaId }) };

function project(clips, transitions = []) {
  return { settings: { width: PW, height: PH, fps: 30, bg: '#000' }, tracks: [{ id: 'v1', kind: 'video' }, { id: 'v2', kind: 'video' }], clips, transitions, markers: [] };
}

export function renderEffectPreview(type, target, t = 0.8, params = null) {
  init();
  const c = newClip({ id: 'pc', trackId: 'v1', type: 'image', mediaId: 'A', start: 0, dur: 2, transform: defaultTransform(), effects: [{ id: 'f', type, enabled: true, params: params || defaultParams(type) }] });
  comp.renderFrame(project([c]), t, provider);
  blit(target);
}
export function renderPresetPreview(preset, target, t = 0.8) {
  init();
  const c = newClip({ id: 'pc', trackId: 'v1', type: 'image', mediaId: 'A', start: 0, dur: 2, transform: defaultTransform(), effects: (preset.effects || []).map((f, i) => ({ id: 'f' + i, type: f.type, enabled: true, params: Object.assign(defaultParams(f.type), f.params || {}) })) });
  comp.renderFrame(project([c]), t, provider);
  blit(target);
}
export function renderTransitionPreview(type, target, p = 0.5) {
  init();
  const a = newClip({ id: 'a', trackId: 'v1', type: 'image', mediaId: 'A', start: 0, dur: 1 });
  const b = newClip({ id: 'b', trackId: 'v1', type: 'image', mediaId: 'B', start: 1, dur: 1 });
  comp.renderFrame(project([a, b], [{ id: 'tr', a: 'a', b: 'b', type, dur: 1, params: { intensity: 1, dir: 0 } }]), 0.5 + p, provider);
  blit(target);
}
function blit(target) {
  const g = target.getContext('2d');
  if (target.width !== PW / 2) { target.width = PW / 2; target.height = PH / 2; }
  g.drawImage(comp.canvas, 0, 0, target.width, target.height);
}

// hover animation helper
export function animateOnHover(tile, canvas, drawFn, period = 1.6) {
  let raf = 0, t0 = 0;
  const loop = (ts) => { if (!t0) t0 = ts; const k = (((ts - t0) / 1000) % period) / period; drawFn(canvas, k); raf = requestAnimationFrame(loop); };
  tile.addEventListener('mouseenter', () => { t0 = 0; raf = requestAnimationFrame(loop); });
  tile.addEventListener('mouseleave', () => { cancelAnimationFrame(raf); drawFn(canvas, 0.5); });
}
