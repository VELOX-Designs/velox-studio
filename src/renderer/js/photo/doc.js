// VELOX Foto – document model: layers (2D canvases), selection mask, undo, pixel algorithms.
import { bus } from '../core/util.js';

export const BLENDS = [
  ['source-over', 'Normal', 'Normal'], ['multiply', 'Multiplizieren', 'Multiply'], ['screen', 'Negativ multiplizieren', 'Screen'], ['overlay', 'Ineinanderkopieren', 'Overlay'],
  ['soft-light', 'Weiches Licht', 'Soft light'], ['hard-light', 'Hartes Licht', 'Hard light'], ['darken', 'Abdunkeln', 'Darken'], ['lighten', 'Aufhellen', 'Lighten'],
  ['color-dodge', 'Farbig abwedeln', 'Color dodge'], ['color-burn', 'Farbig nachbelichten', 'Color burn'], ['difference', 'Differenz', 'Difference'], ['exclusion', 'Ausschluss', 'Exclusion'],
  ['hue', 'Farbton', 'Hue'], ['saturation', 'Sättigung', 'Saturation'], ['color', 'Farbe', 'Color'], ['luminosity', 'Luminanz', 'Luminosity'],
];

let nid = 1;
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
export function ctx2d(c) { return c.getContext('2d', { willReadFrequently: false }); }
export function cloneCanvas(src) { const c = canvas(src.width, src.height); ctx2d(c).drawImage(src, 0, 0); return c; }
export function newLayer(name, cv, extra = {}) { return { id: 'L' + nid++, name, cv, x: 0, y: 0, visible: true, opacity: 1, blend: 'source-over', locked: false, ...extra }; }

// ------------------------------------------------------------------ document
export const doc = {
  w: 1920, h: 1080, layers: [], active: null, sel: null, name: 'Unbenannt', file: null, dirty: false,
  undoStack: [], redoStack: [],
  get layer() { return this.layers.find((l) => l.id === this.active) || this.layers[this.layers.length - 1] || null; },
};
export function changed(what = 'pixels') { doc.dirty = true; bus.emit('photo:changed', what); }

export function newDoc(w, h, { bg = '#ffffff', name = 'Unbenannt' } = {}) {
  doc.w = Math.round(w); doc.h = Math.round(h); doc.layers = []; doc.sel = null; doc.name = name; doc.file = null; doc.undoStack = []; doc.redoStack = [];
  const c = canvas(w, h); if (bg) { const g = ctx2d(c); g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  const l = newLayer(bg ? 'Hintergrund' : 'Ebene 1', c); doc.layers.push(l); doc.active = l.id; doc.dirty = false;
  changed('doc');
}
export function docFromImage(img, name) {
  newDoc(img.naturalWidth || img.width, img.naturalHeight || img.height, { bg: null, name });
  const l = doc.layers[0]; l.name = 'Hintergrund'; ctx2d(l.cv).drawImage(img, 0, 0); doc.dirty = false; changed('doc');
}

// ------------------------------------------------------------------ undo (snapshots share canvases; pixel edits copy-on-write)
function snapshot() { return { w: doc.w, h: doc.h, active: doc.active, sel: doc.sel, layers: doc.layers.map((l) => ({ ...l, text: l.text ? { ...l.text } : undefined })) }; }
function restore(s) { doc.w = s.w; doc.h = s.h; doc.active = s.active; doc.sel = s.sel; doc.layers = s.layers.map((l) => ({ ...l })); }
export function pushUndo(label = '') { doc.undoStack.push({ label, s: snapshot() }); if (doc.undoStack.length > 40) doc.undoStack.shift(); doc.redoStack = []; }
export function undo() { const e = doc.undoStack.pop(); if (!e) return null; doc.redoStack.push({ label: e.label, s: snapshot() }); restore(e.s); changed('doc'); return e.label; }
export function redo() { const e = doc.redoStack.pop(); if (!e) return null; doc.undoStack.push({ label: e.label, s: snapshot() }); restore(e.s); changed('doc'); return e.label; }
// call before mutating a layer's pixels: records undo and gives the layer its own fresh canvas
export function beginPixelEdit(layer, label) { pushUndo(label); layer.cv = cloneCanvas(layer.cv); delete layer.text; return layer.cv; }
export function structural(label, fn) { pushUndo(label); const r = fn(); changed('doc'); return r; }

// ------------------------------------------------------------------ layers
export function addLayer(name, cv, at = null, extra = {}) {
  const l = newLayer(name, cv || canvas(doc.w, doc.h), extra);
  const i = at ?? doc.layers.findIndex((x) => x.id === doc.active) + 1;
  doc.layers.splice(Math.max(0, Math.min(doc.layers.length, i)), 0, l); doc.active = l.id; return l;
}
export function layerIndex(id) { return doc.layers.findIndex((l) => l.id === id); }
export function mergeDown(l) {
  const i = layerIndex(l.id); if (i <= 0) return;
  const below = doc.layers[i - 1];
  const c = canvas(doc.w, doc.h); const g = ctx2d(c);
  drawLayer(g, below); drawLayer(g, l);
  below.cv = c; below.x = 0; below.y = 0; below.opacity = 1; below.blend = 'source-over'; delete below.text;
  doc.layers.splice(i, 1); doc.active = below.id;
}
export function drawLayer(g, l, override = null) {
  if (!l.visible) return;
  g.save(); g.globalAlpha = l.opacity; g.globalCompositeOperation = l.blend || 'source-over';
  g.drawImage(override || l.cv, l.x, l.y); g.restore();
}
export function flatten(bg = null) {
  const c = canvas(doc.w, doc.h); const g = ctx2d(c);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  for (const l of doc.layers) drawLayer(g, l);
  return c;
}
// layer pixels expanded to document space (for algorithms working in doc coordinates)
export function layerInDoc(l) { const c = canvas(doc.w, doc.h); ctx2d(c).drawImage(l.cv, l.x, l.y); return c; }
export function normalizeLayer(l) { if (l.x || l.y || l.cv.width !== doc.w || l.cv.height !== doc.h) { l.cv = layerInDoc(l); l.x = 0; l.y = 0; } }

// ------------------------------------------------------------------ selection (mask canvas in document space, alpha = selected)
export function selRect(x, y, w, h, ellipse = false) {
  const m = canvas(doc.w, doc.h); const g = ctx2d(m); g.fillStyle = '#fff';
  if (ellipse) { g.beginPath(); g.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); g.fill(); } else g.fillRect(x, y, w, h);
  return m;
}
export function selPath(pts) { const m = canvas(doc.w, doc.h); const g = ctx2d(m); g.fillStyle = '#fff'; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); return m; }
// mode: 'new' | 'add' | 'sub' | 'inter'
export function combineSel(mask, mode = 'new') {
  if (mode === 'new' || !doc.sel) { if (mode === 'sub') return; doc.sel = mask; return; }
  const m = cloneCanvas(doc.sel); const g = ctx2d(m);
  g.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'sub' ? 'destination-out' : 'destination-in';
  g.drawImage(mask, 0, 0); doc.sel = m;
}
export function invertSel() {
  const m = canvas(doc.w, doc.h); const g = ctx2d(m); g.fillStyle = '#fff'; g.fillRect(0, 0, doc.w, doc.h);
  if (doc.sel) { g.globalCompositeOperation = 'destination-out'; g.drawImage(doc.sel, 0, 0); }
  doc.sel = m;
}
export function featherSel(px) {
  if (!doc.sel || px <= 0) return;
  const m = canvas(doc.w, doc.h); const g = ctx2d(m); g.filter = `blur(${px}px)`; g.drawImage(doc.sel, 0, 0); doc.sel = m;
}
export function growSel(px) {
  if (!doc.sel) return;
  const m = canvas(doc.w, doc.h); const g = ctx2d(m);
  if (px > 0) { for (let a = 0; a < 16; a++) g.drawImage(doc.sel, Math.cos((a / 16) * Math.PI * 2) * px, Math.sin((a / 16) * Math.PI * 2) * px); }
  else { g.drawImage(doc.sel, 0, 0); g.globalCompositeOperation = 'destination-in'; for (let a = 0; a < 16; a++) g.drawImage(doc.sel, Math.cos((a / 16) * Math.PI * 2) * -px, Math.sin((a / 16) * Math.PI * 2) * -px); }
  doc.sel = m;
}
export function selBounds(mask = doc.sel) {
  if (!mask) return { x: 0, y: 0, w: doc.w, h: doc.h };
  const d = ctx2d(mask).getImageData(0, 0, mask.width, mask.height).data; let x0 = mask.width, y0 = mask.height, x1 = -1, y1 = -1;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (d[(y * mask.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// marching-ants outline image of the selection mask
export function selOutline(mask) {
  const W = mask.width, H = mask.height; const src = ctx2d(mask).getImageData(0, 0, W, H).data;
  const out = new ImageData(W, H); const o = out.data;
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src[(y * W + x) * 4 + 3] > 127;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = on(x, y); if (!a) continue;
    if (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)) { const i = (y * W + x) * 4; const v = ((x + y) >> 2) & 1 ? 255 : 0; o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255; }
  }
  const c = canvas(W, H); ctx2d(c).putImageData(out, 0, 0); return c;
}
// keep only the selected part of `src` (doc-space canvas)
export function maskBySel(src, mask = doc.sel) { if (!mask) return src; const c = cloneCanvas(src); const g = ctx2d(c); g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0); return c; }

// ------------------------------------------------------------------ pixel algorithms
export function floodMask(srcCanvas, sx, sy, tol = 32, contiguous = true) {
  const W = srcCanvas.width, H = srcCanvas.height; const d = ctx2d(srcCanvas).getImageData(0, 0, W, H).data;
  sx = Math.floor(sx); sy = Math.floor(sy); if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const i0 = (sy * W + sx) * 4; const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
  const match = (i) => Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) + Math.abs(d[i + 3] - a0) <= tol * 3;
  const out = new ImageData(W, H); const o = out.data;
  if (!contiguous) { for (let p = 0; p < W * H; p++) if (match(p * 4)) o[p * 4 + 3] = o[p * 4] = o[p * 4 + 1] = o[p * 4 + 2] = 255; }
  else {
    const seen = new Uint8Array(W * H); const stack = [sy * W + sx]; seen[sy * W + sx] = 1;
    while (stack.length) { const p = stack.pop(); if (!match(p * 4)) continue; o[p * 4 + 3] = o[p * 4] = o[p * 4 + 1] = o[p * 4 + 2] = 255; const x = p % W, y = (p / W) | 0;
      if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); } if (x < W - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); } if (y < H - 1 && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); } }
  }
  const c = canvas(W, H); ctx2d(c).putImageData(out, 0, 0); return c;
}
// content-aware-ish fill: diffuse surrounding colours into the masked area (multi-scale), plus a little grain
export function diffuseFill(cv, mask) {
  const W = cv.width, H = cv.height; const g = ctx2d(cv);
  const md = ctx2d(mask).getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (md[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return;
  const pad = 24; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1; const img = g.getImageData(x0, y0, w, h); const d = img.data;
  const known = new Float32Array(w * h); const col = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; const m = md[((y + y0) * W + x + x0) * 4 + 3] / 255; known[p] = m > 0.08 ? 0 : 1; for (let c = 0; c < 3; c++) col[p * 3 + c] = d[p * 4 + c]; }
  const iters = Math.min(600, Math.max(60, Math.max(w, h) * 1.2));
  for (let it = 0; it < iters; it++) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x; if (known[p]) continue;
      for (let c = 0; c < 3; c++) col[p * 3 + c] = (col[(p - 1) * 3 + c] + col[(p + 1) * 3 + c] + col[(p - w) * 3 + c] + col[(p + w) * 3 + c]) * 0.25; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; const m = md[((y + y0) * W + x + x0) * 4 + 3] / 255; if (m <= 0) continue; const n = (Math.random() - 0.5) * 6;
    for (let c = 0; c < 3; c++) d[p * 4 + c] = d[p * 4 + c] * (1 - m) + (col[p * 3 + c] + n) * m; d[p * 4 + 3] = Math.max(d[p * 4 + 3], 255 * m); }
  g.putImageData(img, x0, y0);
}
export function resizeCanvas(src, w, h) { const c = canvas(w, h); const g = ctx2d(c); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h); return c; }
export function rotateCanvas(src, deg) {
  const r = (deg * Math.PI) / 180; const s = Math.abs(Math.sin(r)), co = Math.abs(Math.cos(r));
  const w = Math.round(src.width * co + src.height * s), h = Math.round(src.width * s + src.height * co);
  const c = canvas(w, h); const g = ctx2d(c); g.imageSmoothingQuality = 'high'; g.translate(w / 2, h / 2); g.rotate(r); g.drawImage(src, -src.width / 2, -src.height / 2); return c;
}
export function flipCanvas(src, horiz) { const c = canvas(src.width, src.height); const g = ctx2d(c); if (horiz) { g.translate(c.width, 0); g.scale(-1, 1); } else { g.translate(0, c.height); g.scale(1, -1); } g.drawImage(src, 0, 0); return c; }

// ------------------------------------------------------------------ text layers
export function renderText(t) {
  const fs = t.size || 96; const font = `${t.italic ? 'italic ' : ''}${t.bold ? '800 ' : '500 '}${fs}px "${t.font || 'Segoe UI'}"`;
  const lines = String(t.text || '').split('\n');
  const m = ctx2d(canvas(1, 1)); m.font = font;
  const lh = fs * 1.2; const pad = Math.ceil((t.stroke || 0) + (t.shadow ? fs * 0.25 : 0) + 4);
  const w = Math.ceil(Math.max(1, ...lines.map((l) => m.measureText(l).width))) + pad * 2, h = Math.ceil(lh * lines.length) + pad * 2;
  const c = canvas(w, h); const g = ctx2d(c); g.font = font; g.textBaseline = 'top'; g.textAlign = t.align || 'left';
  const ax = t.align === 'center' ? w / 2 : t.align === 'right' ? w - pad : pad;
  if (t.shadow) { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = fs * 0.15; g.shadowOffsetY = fs * 0.05; }
  lines.forEach((l, i) => {
    const y = pad + i * lh + (lh - fs) / 2;
    if (t.stroke) { g.lineJoin = 'round'; g.lineWidth = t.stroke * 2; g.strokeStyle = t.strokeColor || '#000'; g.strokeText(l, ax, y); }
    g.fillStyle = t.color || '#fff'; g.fillText(l, ax, y);
  });
  return c;
}

// ------------------------------------------------------------------ project file (.vxfoto)
export async function serialize() {
  const toB64 = (c) => new Promise((r) => c.toBlob((b) => b.arrayBuffer().then((a) => r(Buffer.from(a).toString('base64'))), 'image/png'));
  const layers = [];
  for (const l of doc.layers) layers.push({ name: l.name, x: l.x, y: l.y, visible: l.visible, opacity: l.opacity, blend: l.blend, text: l.text, png: await toB64(l.cv) });
  return JSON.stringify({ app: 'VELOX Foto', version: 1, w: doc.w, h: doc.h, name: doc.name, layers });
}
export async function deserialize(json, file) {
  const j = JSON.parse(json);
  const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64; });
  const layers = [];
  for (const L of j.layers) { const img = await load(L.png); const c = canvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0); layers.push(newLayer(L.name, c, { x: L.x, y: L.y, visible: L.visible, opacity: L.opacity, blend: L.blend, text: L.text })); }
  doc.w = j.w; doc.h = j.h; doc.name = j.name || 'Foto'; doc.layers = layers; doc.active = layers[layers.length - 1]?.id; doc.sel = null; doc.file = file; doc.undoStack = []; doc.redoStack = []; doc.dirty = false;
  changed('doc');
}
