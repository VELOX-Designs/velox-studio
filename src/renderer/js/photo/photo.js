// VELOX Foto – Photoshop-style photo editor inside VELOX Studio.
// Layers, selections (rect/ellipse/lasso/magic wand/AI subject), brush/eraser/clone/heal/fill/gradient,
// text + shapes, crop/rotate/resize, GPU adjustments + all video filters/effects, AI (Neural Rendering, DLSS5,
// upscaling, faces, background removal, generative fill).
import { el, $, bus, fileUrl, clamp } from '../core/util.js';
import { L } from '../core/i18n.js';
import { settings, paths } from '../core/settings.js';
import { registerCommands } from '../core/commands.js';
import { modal, toast, confirmBox, promptBox, contextMenu } from '../ui/dialogs.js';
import { EFFECTS, EFFECT_CATS, defaultParams } from '../render/effects.js';
import { BUILTIN_PRESETS } from '../ui/presets.js';
import { doc, BLENDS, canvas, ctx2d, cloneCanvas, changed, newDoc, docFromImage, pushUndo, undo, redo, beginPixelEdit, structural, addLayer, mergeDown, drawLayer, flatten, layerInDoc, normalizeLayer,
  selRect, selPath, combineSel, invertSel, featherSel, growSel, selBounds, selOutline, maskBySel, floodMask, diffuseFill, resizeCanvas, rotateCanvas, flipCanvas, renderText, serialize, deserialize, layerIndex } from './doc.js';
import { applyFx } from './gpufx.js';
import { AI, fileToCanvas } from './photoai.js';
import { NR_LEVELS, NR_SCENES, levelName } from '../ai/nrlevels.js';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'tif', 'tiff'];
const photosDir = () => { const d = path.join(paths.velox, 'Fotos'); fs.mkdirSync(d, { recursive: true }); return d; };

// ------------------------------------------------------------------ state
const ui = {
  tool: 'move', fg: '#ffffff', bg: '#000000', size: 40, hardness: 0.7, opacity: 1, tol: 32, contiguous: true, shape: 'rect', shapeFill: true, shapeStroke: 6,
  view: { s: 1, ox: 0, oy: 0 }, root: null, cv: null, g: null, dpr: 1, comp: null, compDirty: true, outline: null, outlineFor: null,
  preview: null, // { layerId, effects, amt } – live adjustment preview on the active layer
  drag: null, cropRect: null, cloneSrc: null, lasso: null, hover: null, spaceDown: false, tab: 'adjust', fxSel: 0,
};
const TOOLS = [
  ['move', '✥', L('Verschieben', 'Move'), 'V'], ['marquee', '⬚', L('Rechteck-Auswahl', 'Rectangle select'), 'M'], ['ellipse', '◯', L('Ellipsen-Auswahl', 'Ellipse select'), ''], ['lasso', '➰', L('Lasso', 'Lasso'), 'L'],
  ['wand', '✨', L('Zauberstab', 'Magic wand'), 'W'], ['crop', '⛶', L('Zuschneiden', 'Crop'), 'C'], ['brush', '🖌', L('Pinsel', 'Brush'), 'B'], ['eraser', '⌫', L('Radiergummi', 'Eraser'), 'E'],
  ['clone', '⎘', L('Kopierstempel (Alt+Klick = Quelle)', 'Clone stamp (Alt+click = source)'), 'S'], ['heal', '✚', L('Bereichsreparatur', 'Spot healing'), 'J'], ['fill', '🪣', L('Füllen', 'Fill'), 'G'],
  ['gradient', '◐', L('Verlauf', 'Gradient'), ''], ['text', 'T', L('Text', 'Text'), 'T'], ['shape', '■', L('Form', 'Shape'), 'U'], ['picker', '💧', L('Pipette', 'Eyedropper'), 'I'], ['hand', '✋', L('Hand', 'Hand'), 'H'], ['zoom', '🔍', 'Zoom', 'Z'],
];

// ------------------------------------------------------------------ open / close
export function openPhotoMode(file = null) {
  if (!ui.root) build();
  ui.root.style.display = 'flex';
  window.__photoKey = onKey;
  if (file) openFile(file);
  else if (!doc.layers.length) newDoc(1920, 1080);
  requestAnimationFrame(() => { resize(); fit(); });
}
export function closePhotoMode() { if (ui.root) ui.root.style.display = 'none'; window.__photoKey = null; }
export const photoOpen = () => ui.root && ui.root.style.display !== 'none';

// ------------------------------------------------------------------ layout
function build() {
  ui.cv = el('canvas', { class: 'ph-canvas' }); ui.g = ui.cv.getContext('2d');
  const toolbar = el('div', { class: 'ph-tools' }, ...TOOLS.map(([id, ic, nm, key]) => el('button', { class: 'ph-tool', dataset: { tool: id }, title: nm + (key ? ` (${key})` : ''), onclick: () => setTool(id) }, ic)),
    el('div', { class: 'ph-colors' }, colorSwatch('fg'), colorSwatch('bg'), el('button', { class: 'ph-swap', title: L('Farben tauschen (X)', 'Swap colours (X)'), onclick: () => { [ui.fg, ui.bg] = [ui.bg, ui.fg]; refreshColors(); } }, '⇄')));
  const top = el('div', { class: 'ph-top' },
    el('div', { class: 'brand', style: { gap: '8px' } }, el('span', { class: 'logo' }, 'V'), el('div', { class: 'brand-name' }, 'VELOX', el('b', {}, 'Foto'))),
    ...[[L('Datei', 'File'), fileMenu], [L('Bearbeiten', 'Edit'), editMenu], [L('Bild', 'Image'), imageMenu], [L('Ebene', 'Layer'), layerMenu], [L('Auswahl', 'Select'), selectMenu], ['KI', aiMenu]].map(([n, fn]) =>
      el('button', { class: 'ph-menu', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, fn()); } }, n)),
    el('div', { class: 'ph-drag' }),
    el('button', { class: 'nr-btn small', onclick: () => neuralDialog() }, '✦ Neural Rendering'),
    el('button', { class: 'btn small', onclick: () => exportDialog() }, '⇩ ' + L('Exportieren', 'Export')),
    el('button', { class: 'btn small', title: L('Zum Video-Schnitt', 'Back to video editor'), onclick: () => closePhotoMode() }, '🎬 ' + L('Video-Modus', 'Video mode')),
    el('div', { class: 'win-buttons' }, ...[['min', '—'], ['max', '▢'], ['close', '✕']].map(([k, t]) => el('button', { onclick: () => ipcRenderer.send('win:' + k) }, t))));
  ui.opts = el('div', { class: 'ph-opts' });
  const stage = el('div', { class: 'ph-stage' }, ui.cv);
  ui.info = el('div', { class: 'ph-info muted' });
  ui.side = el('div', { class: 'ph-side' });
  ui.layersBox = el('div', { class: 'ph-layers' });
  ui.root = el('div', { id: 'photo' }, top, ui.opts, el('div', { class: 'ph-body' }, toolbar, el('div', { class: 'ph-center' }, stage, ui.info), el('div', { class: 'ph-right' }, ui.side, el('div', { class: 'ph-lhead' }, el('b', {}, L('Ebenen', 'Layers')), el('span', { class: 'spacer' }),
    ...[['＋', L('Neue Ebene', 'New layer'), () => structural(L('Neue Ebene', 'New layer'), () => addLayer(L('Ebene ', 'Layer ') + (doc.layers.length + 1)))], ['⧉', L('Duplizieren', 'Duplicate'), dupLayer], ['⤓', L('Nach unten zusammenführen', 'Merge down'), () => doc.layer && structural('Merge', () => mergeDown(doc.layer))], ['🗑', L('Löschen', 'Delete'), delLayer]].map(([t, ti, fn]) => el('button', { class: 'tl-btn', title: ti, onclick: fn }, t))), ui.layersBox)));
  document.body.appendChild(ui.root);
  // canvas events
  ui.cv.addEventListener('mousedown', onDown); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  ui.cv.addEventListener('wheel', onWheel, { passive: false });
  ui.cv.addEventListener('dblclick', onDbl);
  ui.cv.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, editMenu()); });
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', async (e) => { e.preventDefault(); const { webUtils } = require('electron'); for (const f of e.dataTransfer.files) { const p = webUtils.getPathForFile(f); if (p) await placeImage(p); } });
  window.addEventListener('paste', (e) => { if (!photoOpen()) return; const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/')); if (it) { const f = it.getAsFile(); const img = new Image(); img.onload = () => structural(L('Einfügen', 'Paste'), () => { const c = canvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0); const l = addLayer(L('Eingefügt', 'Pasted'), c); l.x = Math.round((doc.w - c.width) / 2); l.y = Math.round((doc.h - c.height) / 2); }); img.src = URL.createObjectURL(f); } });
  window.addEventListener('resize', () => photoOpen() && resize());
  window.addEventListener('keyup', (e) => { if (photoOpen() && e.key === ' ') ui.spaceDown = false; });
  new ResizeObserver(() => photoOpen() && resize()).observe(stage);
  bus.on('photo:changed', (what) => { ui.compDirty = true; if (what === 'doc') { ui.preview = null; buildSide(); } buildLayers(); draw(); });
  setTool('move'); refreshColors(); buildSide();
  setInterval(() => { if (photoOpen() && doc.sel) draw(); }, 400); // marching ants refresh
}
function colorSwatch(k) {
  const i = el('input', { type: 'color', value: ui[k] }); i.oninput = () => { ui[k] = i.value; };
  return el('label', { class: 'ph-sw ph-sw-' + k, title: k === 'fg' ? L('Vordergrundfarbe', 'Foreground') : L('Hintergrundfarbe', 'Background') }, i);
}
function refreshColors() { ui.root?.querySelectorAll('.ph-sw input').forEach((i, n) => { i.value = n ? ui.bg : ui.fg; i.parentElement.style.background = i.value; }); }

// ------------------------------------------------------------------ view
function resize() {
  const st = ui.cv.parentElement.getBoundingClientRect(); ui.dpr = window.devicePixelRatio || 1;
  ui.cv.width = Math.max(1, st.width * ui.dpr); ui.cv.height = Math.max(1, st.height * ui.dpr); ui.cv.style.width = st.width + 'px'; ui.cv.style.height = st.height + 'px'; draw();
}
function fit() { const W = ui.cv.width / ui.dpr, H = ui.cv.height / ui.dpr; const s = Math.min((W - 40) / doc.w, (H - 40) / doc.h, 4); ui.view = { s, ox: (W - doc.w * s) / 2, oy: (H - doc.h * s) / 2 }; draw(); }
function zoomAt(f, cx, cy) { const v = ui.view; const ns = clamp(v.s * f, 0.02, 64); v.ox = cx - ((cx - v.ox) * ns) / v.s; v.oy = cy - ((cy - v.oy) * ns) / v.s; v.s = ns; draw(); }
const toDoc = (e) => { const r = ui.cv.getBoundingClientRect(); return [(e.clientX - r.left - ui.view.ox) / ui.view.s, (e.clientY - r.top - ui.view.oy) / ui.view.s]; };
let checker = null;
function composite() {
  if (!ui.comp || ui.comp.width !== doc.w || ui.comp.height !== doc.h) ui.comp = canvas(doc.w, doc.h);
  const g = ctx2d(ui.comp); g.clearRect(0, 0, doc.w, doc.h);
  for (const l of doc.layers) {
    let over = null;
    if (ui.preview && ui.preview.layerId === l.id) over = applyFx(l.cv, ui.preview.effects, { amt: ui.preview.amt });
    if (ui.stroke && ui.stroke.layer === l) over = ui.stroke.view;
    drawLayer(g, l, over);
  }
  ui.compDirty = false;
}
function draw() {
  if (!ui.cv || !photoOpen()) return;
  const g = ui.g, v = ui.view, d = ui.dpr; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#16181d'; g.fillRect(0, 0, ui.cv.width, ui.cv.height);
  composite();
  g.setTransform(d, 0, 0, d, 0, 0);
  if (!checker) { const c = canvas(16, 16); const cg = ctx2d(c); cg.fillStyle = '#ccc'; cg.fillRect(0, 0, 16, 16); cg.fillStyle = '#fff'; cg.fillRect(0, 0, 8, 8); cg.fillRect(8, 8, 8, 8); checker = g.createPattern(c, 'repeat'); }
  g.fillStyle = checker; g.fillRect(v.ox, v.oy, doc.w * v.s, doc.h * v.s);
  g.imageSmoothingEnabled = v.s < 2; g.imageSmoothingQuality = 'high';
  g.drawImage(ui.comp, v.ox, v.oy, doc.w * v.s, doc.h * v.s);
  g.strokeStyle = 'rgba(255,255,255,.15)'; g.strokeRect(v.ox - 0.5, v.oy - 0.5, doc.w * v.s + 1, doc.h * v.s + 1);
  // active layer bounds (move tool)
  const l = doc.layer;
  if (l && ui.tool === 'move' && (l.cv.width !== doc.w || l.cv.height !== doc.h || l.x || l.y)) { g.setLineDash([4, 4]); g.strokeStyle = '#22d3ee'; g.strokeRect(v.ox + l.x * v.s, v.oy + l.y * v.s, l.cv.width * v.s, l.cv.height * v.s); g.setLineDash([]); }
  // selection
  if (doc.sel) {
    if (ui.outlineFor !== doc.sel) { ui.outline = selOutline(doc.sel); ui.outlineFor = doc.sel; }
    g.imageSmoothingEnabled = false; g.globalAlpha = 1; g.drawImage(ui.outline, v.ox, v.oy, doc.w * v.s, doc.h * v.s);
    const t = (Date.now() / 120) % 8; g.save(); g.globalCompositeOperation = 'difference'; g.globalAlpha = 0.35; g.lineDashOffset = t; g.restore();
  }
  // tool overlays
  const dr = ui.drag;
  if (dr && ['marquee', 'ellipse', 'crop', 'shape', 'gradient'].includes(dr.tool)) {
    const [x0, y0] = dr.start, [x1, y1] = dr.cur; const X = v.ox + Math.min(x0, x1) * v.s, Y = v.oy + Math.min(y0, y1) * v.s, W = Math.abs(x1 - x0) * v.s, H = Math.abs(y1 - y0) * v.s;
    g.setLineDash([5, 4]); g.strokeStyle = '#fff'; g.lineWidth = 1;
    if (dr.tool === 'ellipse' || (dr.tool === 'shape' && ui.shape === 'ellipse')) { g.beginPath(); g.ellipse(X + W / 2, Y + H / 2, W / 2, H / 2, 0, 0, 7); g.stroke(); }
    else if (dr.tool === 'gradient' || (dr.tool === 'shape' && ui.shape === 'line')) { g.beginPath(); g.moveTo(v.ox + x0 * v.s, v.oy + y0 * v.s); g.lineTo(v.ox + x1 * v.s, v.oy + y1 * v.s); g.stroke(); }
    else g.strokeRect(X, Y, W, H);
    g.setLineDash([]);
  }
  if (ui.cropRect) {
    const c = ui.cropRect; g.fillStyle = 'rgba(0,0,0,.55)'; const X = v.ox + c.x * v.s, Y = v.oy + c.y * v.s, W = c.w * v.s, H = c.h * v.s;
    g.fillRect(v.ox, v.oy, doc.w * v.s, Y - v.oy); g.fillRect(v.ox, Y + H, doc.w * v.s, v.oy + doc.h * v.s - Y - H); g.fillRect(v.ox, Y, X - v.ox, H); g.fillRect(X + W, Y, v.ox + doc.w * v.s - X - W, H);
    g.strokeStyle = '#fff'; g.strokeRect(X, Y, W, H); g.strokeStyle = 'rgba(255,255,255,.35)'; for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(X + (W * i) / 3, Y); g.lineTo(X + (W * i) / 3, Y + H); g.moveTo(X, Y + (H * i) / 3); g.lineTo(X + W, Y + (H * i) / 3); g.stroke(); }
  }
  if (ui.lasso) { g.strokeStyle = '#fff'; g.setLineDash([4, 3]); g.beginPath(); ui.lasso.forEach(([x, y], i) => (i ? g.lineTo(v.ox + x * v.s, v.oy + y * v.s) : g.moveTo(v.ox + x * v.s, v.oy + y * v.s))); g.stroke(); g.setLineDash([]); }
  if (ui.hover && ['brush', 'eraser', 'clone', 'heal'].includes(ui.tool)) { g.strokeStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(v.ox + ui.hover[0] * v.s, v.oy + ui.hover[1] * v.s, Math.max(1, (ui.size / 2) * v.s), 0, 7); g.stroke(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.arc(v.ox + ui.hover[0] * v.s, v.oy + ui.hover[1] * v.s, Math.max(1, (ui.size / 2) * v.s) + 1, 0, 7); g.stroke(); }
  if (ui.cloneSrc && ui.tool === 'clone') { const [x, y] = ui.drag?.cloneCur || ui.cloneSrc; g.strokeStyle = '#ffb547'; g.beginPath(); g.moveTo(v.ox + x * v.s - 8, v.oy + y * v.s); g.lineTo(v.ox + x * v.s + 8, v.oy + y * v.s); g.moveTo(v.ox + x * v.s, v.oy + y * v.s - 8); g.lineTo(v.ox + x * v.s, v.oy + y * v.s + 8); g.stroke(); }
  ui.info.textContent = `${doc.name} · ${doc.w}×${doc.h}px · ${Math.round(v.s * 100)}%${ui.hover ? ` · x ${Math.round(ui.hover[0])} y ${Math.round(ui.hover[1])}` : ''}${doc.sel ? ' · ' + L('Auswahl aktiv', 'selection active') : ''}`;
}

// ------------------------------------------------------------------ tools
function setTool(t) {
  if (ui.cropRect && t !== 'crop') ui.cropRect = null;
  ui.tool = t; ui.root.querySelectorAll('.ph-tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  ui.cv.style.cursor = { hand: 'grab', move: 'move', text: 'text', zoom: 'zoom-in', picker: 'crosshair' }[t] || (['brush', 'eraser', 'clone', 'heal'].includes(t) ? 'none' : 'crosshair');
  buildOpts(); draw();
}
function buildOpts() {
  const o = ui.opts; o.innerHTML = '';
  const num = (label, k, min, max, step = 1, fmt = (v) => v) => { const s = el('input', { type: 'range', min, max, step, value: ui[k], style: { width: '110px' } }); const v = el('span', { class: 'tc', style: { minWidth: '38px' } }, fmt(ui[k])); s.oninput = () => { ui[k] = +s.value; v.textContent = fmt(ui[k]); draw(); }; return el('label', { class: 'ph-opt' }, label, s, v); };
  const chk = (label, k) => { const c = el('input', { type: 'checkbox', checked: ui[k] }); c.onchange = () => (ui[k] = c.checked); return el('label', { class: 'ph-opt' }, c, label); };
  const t = ui.tool; const name = TOOLS.find((x) => x[0] === t)?.[2] || '';
  o.append(el('b', { style: { marginRight: '10px' } }, name));
  if (['brush', 'eraser', 'clone', 'heal'].includes(t)) o.append(num(L('Größe', 'Size'), 'size', 1, 800, 1, (v) => v + 'px'), num(L('Härte', 'Hardness'), 'hardness', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'), t !== 'heal' ? num(L('Deckkraft', 'Opacity'), 'opacity', 0.01, 1, 0.01, (v) => Math.round(v * 100) + '%') : '');
  if (t === 'clone') o.append(el('span', { class: 'muted' }, L('Alt + Klick setzt die Quelle', 'Alt + click sets the source')));
  if (t === 'heal') o.append(el('span', { class: 'muted' }, L('Über Störendes malen – wird mit der Umgebung gefüllt. Für große Objekte: Auswahl + KI → Generativ entfernen', 'Paint over blemishes. For big objects: selection + AI → Generative remove')));
  if (t === 'fill' || t === 'wand') o.append(num(L('Toleranz', 'Tolerance'), 'tol', 0, 255), chk(L('Benachbart', 'Contiguous'), 'contiguous'));
  if (['marquee', 'ellipse', 'lasso', 'wand'].includes(t)) o.append(el('span', { class: 'muted' }, L('Umschalt = hinzufügen · Alt = abziehen', 'Shift = add · Alt = subtract')));
  if (t === 'shape') { const s = el('select', {}, ...[['rect', L('Rechteck', 'Rectangle')], ['round', L('Abgerundet', 'Rounded')], ['ellipse', 'Ellipse'], ['line', L('Linie', 'Line')], ['arrow', L('Pfeil', 'Arrow')]].map(([v, n]) => el('option', { value: v }, n))); s.value = ui.shape; s.onchange = () => (ui.shape = s.value); o.append(s, chk(L('Füllen', 'Fill'), 'shapeFill'), num(L('Kontur', 'Stroke'), 'shapeStroke', 0, 60)); }
  if (t === 'crop') o.append(el('button', { class: 'btn small primary', onclick: applyCrop }, '✓ ' + L('Zuschneiden (Enter)', 'Crop (Enter)')), el('button', { class: 'btn small', onclick: () => { ui.cropRect = null; draw(); } }, L('Abbrechen', 'Cancel')),
    ...[['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9], ['9:16', 9 / 16]].map(([n, r]) => el('span', { class: 'chip', onclick: () => { const w = Math.min(doc.w, doc.h * r), h = w / r; ui.cropRect = { x: (doc.w - w) / 2, y: (doc.h - h) / 2, w, h }; draw(); } }, n)));
  if (t === 'move') o.append(el('span', { class: 'muted' }, L('Ebene ziehen · Pfeiltasten = 1px (Umschalt 10px)', 'Drag layer · arrows = 1px (Shift 10px)')));
}
function brushDab(g, x, y, size, hard, color) {
  const r = size / 2; const gr = g.createRadialGradient(x, y, r * hard * 0.999, x, y, r);
  gr.addColorStop(0, color); gr.addColorStop(1, color.length === 7 ? color + '00' : 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}
function strokeTo(x, y) {
  const s = ui.stroke; const [px, py] = s.last; const dist = Math.hypot(x - px, y - py); const step = Math.max(1, ui.size * 0.12); const n = Math.max(1, Math.ceil(dist / step));
  const sg = ctx2d(s.paint);
  for (let i = 1; i <= n; i++) {
    const X = px + ((x - px) * i) / n, Y = py + ((y - py) * i) / n;
    if (s.tool === 'clone') {
      const dx = s.off[0], dy = s.off[1]; const r = ui.size / 2; const dab = canvas(ui.size + 2, ui.size + 2); const dg = ctx2d(dab);
      dg.drawImage(s.source, -(X + dx - r), -(Y + dy - r)); dg.globalCompositeOperation = 'destination-in'; brushDab(dg, r, r, ui.size, ui.hardness, '#000000');
      sg.drawImage(dab, X - r, Y - r);
    } else brushDab(sg, X, Y, ui.size, ui.hardness, s.tool === 'brush' ? ui.fg : '#000000');
  }
  s.last = [x, y];
  // compose view = base (+/-) paint, masked by selection
  const v = ctx2d(s.view); v.globalCompositeOperation = 'copy'; v.drawImage(s.base, 0, 0); v.globalCompositeOperation = 'source-over';
  let paint = s.paint; if (doc.sel && s.tool !== 'heal') paint = maskBySel(paint);
  v.globalAlpha = s.tool === 'heal' ? 0.5 : ui.opacity; v.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  if (s.tool === 'heal') { v.globalCompositeOperation = 'source-over'; v.globalAlpha = 0.45; const red = cloneCanvas(paint); const rg = ctx2d(red); rg.globalCompositeOperation = 'source-in'; rg.fillStyle = '#ff3355'; rg.fillRect(0, 0, red.width, red.height); v.drawImage(red, 0, 0); }
  else v.drawImage(paint, 0, 0);
  v.globalAlpha = 1; v.globalCompositeOperation = 'source-over';
}
function onDown(e) {
  const l = doc.layer; const [x, y] = toDoc(e);
  if (e.button === 1 || ui.tool === 'hand' || ui.spaceDown) { ui.drag = { tool: 'pan', sx: e.clientX, sy: e.clientY, ox: ui.view.ox, oy: ui.view.oy }; ui.cv.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  const mode = e.shiftKey ? 'add' : e.altKey ? 'sub' : 'new';
  switch (ui.tool) {
    case 'zoom': { const r = ui.cv.getBoundingClientRect(); zoomAt(e.altKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top); return; }
    case 'move': if (!l) return; pushUndo(L('Verschieben', 'Move')); ui.drag = { tool: 'move', start: [x, y], lx: l.x, ly: l.y }; return;
    case 'marquee': case 'ellipse': case 'crop': case 'shape': case 'gradient': ui.drag = { tool: ui.tool, start: [x, y], cur: [x, y], mode }; return;
    case 'lasso': ui.lasso = [[x, y]]; ui.drag = { tool: 'lasso', mode }; return;
    case 'wand': { const src = flatten(); const m = floodMask(src, x, y, ui.tol, ui.contiguous); if (m) { pushUndo(L('Zauberstab', 'Magic wand')); combineSel(m, mode); changed('sel'); } return; }
    case 'picker': { const c = ctx2d(ui.comp).getImageData(Math.floor(x), Math.floor(y), 1, 1).data; const hex = '#' + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join(''); if (e.altKey) ui.bg = hex; else ui.fg = hex; refreshColors(); return; }
    case 'fill': {
      if (!l) return; normalizeLayer(l); const m = floodMask(l.cv, x, y, ui.tol, ui.contiguous); if (!m) return;
      const cv = beginPixelEdit(l, L('Füllen', 'Fill')); const fill = canvas(doc.w, doc.h); const fg = ctx2d(fill); fg.fillStyle = ui.fg; fg.fillRect(0, 0, doc.w, doc.h); fg.globalCompositeOperation = 'destination-in'; fg.drawImage(m, 0, 0);
      ctx2d(cv).drawImage(maskBySel(fill), 0, 0); changed(); return;
    }
    case 'text': { const hit = [...doc.layers].reverse().find((q) => q.text && q.visible && x >= q.x && y >= q.y && x <= q.x + q.cv.width && y <= q.y + q.cv.height); textDialog(hit, [x, y]); return; }
    case 'brush': case 'eraser': case 'clone': case 'heal': {
      if (!l) return;
      if (ui.tool === 'clone' && e.altKey) { ui.cloneSrc = [x, y]; toast(L('Quelle gesetzt', 'Source set')); draw(); return; }
      if (ui.tool === 'clone' && !ui.cloneSrc) { toast(L('Erst mit Alt + Klick eine Quelle setzen', 'Alt + click to set a source first'), 'err'); return; }
      normalizeLayer(l); beginPixelEdit(l, TOOLS.find((t) => t[0] === ui.tool)[2]);
      const base = cloneCanvas(l.cv);
      ui.stroke = { tool: ui.tool, layer: l, base, paint: canvas(doc.w, doc.h), view: cloneCanvas(base), last: [x, y], source: ui.tool === 'clone' ? flatten() : null, off: ui.cloneSrc ? [ui.cloneSrc[0] - x, ui.cloneSrc[1] - y] : null };
      ui.drag = { tool: 'stroke' }; strokeTo(x + 0.01, y); ui.compDirty = true; draw(); return;
    }
  }
}
function onMove(e) {
  if (!photoOpen()) return;
  const [x, y] = toDoc(e); const inside = e.target === ui.cv; ui.hover = inside ? [x, y] : null;
  const d = ui.drag;
  if (!d) { if (inside) draw(); return; }
  if (d.tool === 'pan') { ui.view.ox = d.ox + e.clientX - d.sx; ui.view.oy = d.oy + e.clientY - d.sy; }
  else if (d.tool === 'move') { const l = doc.layer; l.x = Math.round(d.lx + x - d.start[0]); l.y = Math.round(d.ly + y - d.start[1]); }
  else if (d.tool === 'lasso') ui.lasso.push([x, y]);
  else if (d.tool === 'stroke') { strokeTo(x, y); if (ui.stroke.off) d.cloneCur = [x + ui.stroke.off[0], y + ui.stroke.off[1]]; }
  else if (d.start) { let [x1, y1] = [x, y]; if (e.shiftKey && d.tool !== 'gradient') { const s = Math.max(Math.abs(x - d.start[0]), Math.abs(y - d.start[1])); x1 = d.start[0] + Math.sign(x - d.start[0]) * s; y1 = d.start[1] + Math.sign(y - d.start[1]) * s; } d.cur = [x1, y1]; }
  draw();
}
function onUp() {
  const d = ui.drag; if (!d) return; ui.drag = null;
  if (d.tool === 'pan') { setTool(ui.tool); return; }
  if (d.tool === 'move') { changed(); return; }
  if (d.tool === 'lasso') { const pts = ui.lasso; ui.lasso = null; if (pts.length > 2) { pushUndo('Lasso'); combineSel(selPath(pts), d.mode); } else { pushUndo(L('Auswahl aufheben', 'Deselect')); doc.sel = null; } changed('sel'); return; }
  if (d.tool === 'stroke') {
    const s = ui.stroke; ui.stroke = null;
    if (s.tool === 'heal') { const cv = s.layer.cv; ctx2d(cv).drawImage(s.base, 0, 0); diffuseFill(cv, s.paint); }
    else s.layer.cv = s.view;
    changed(); return;
  }
  if (!d.start) return;
  const [x0, y0] = d.start, [x1, y1] = d.cur; const rx = Math.min(x0, x1), ry = Math.min(y0, y1), rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
  if (d.tool === 'marquee' || d.tool === 'ellipse') { pushUndo(L('Auswahl', 'Selection')); if (rw < 2 || rh < 2) { if (d.mode === 'new') doc.sel = null; } else combineSel(selRect(rx, ry, rw, rh, d.tool === 'ellipse'), d.mode); changed('sel'); }
  else if (d.tool === 'crop') { if (rw > 4 && rh > 4) ui.cropRect = { x: Math.max(0, rx), y: Math.max(0, ry), w: Math.min(doc.w - Math.max(0, rx), rw), h: Math.min(doc.h - Math.max(0, ry), rh) }; draw(); }
  else if (d.tool === 'gradient') {
    const l = doc.layer; if (!l || Math.hypot(x1 - x0, y1 - y0) < 2) return; normalizeLayer(l);
    const cv = beginPixelEdit(l, L('Verlauf', 'Gradient')); const gc = canvas(doc.w, doc.h); const gg = ctx2d(gc); const gr = gg.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, ui.fg); gr.addColorStop(1, ui.bg); gg.fillStyle = gr; gg.fillRect(0, 0, doc.w, doc.h);
    ctx2d(cv).drawImage(maskBySel(gc), 0, 0); changed();
  } else if (d.tool === 'shape') {
    if (rw < 2 && rh < 2) return;
    structural(L('Form', 'Shape'), () => {
      const pad = ui.shapeStroke + 4; const c = canvas(rw + pad * 2, rh + pad * 2); const g = ctx2d(c); g.fillStyle = ui.fg; g.strokeStyle = ui.shapeFill ? ui.bg : ui.fg; g.lineWidth = ui.shapeStroke; g.lineCap = 'round'; g.lineJoin = 'round';
      const X = pad, Y = pad; g.beginPath();
      if (ui.shape === 'ellipse') g.ellipse(X + rw / 2, Y + rh / 2, rw / 2, rh / 2, 0, 0, 7);
      else if (ui.shape === 'round') g.roundRect(X, Y, rw, rh, Math.min(rw, rh) * 0.15);
      else if (ui.shape === 'line' || ui.shape === 'arrow') { const ax = x0 - rx + X, ay = y0 - ry + Y, bx = x1 - rx + X, by = y1 - ry + Y; g.moveTo(ax, ay); g.lineTo(bx, by); g.strokeStyle = ui.fg; g.lineWidth = Math.max(2, ui.shapeStroke); g.stroke();
        if (ui.shape === 'arrow') { const a = Math.atan2(by - ay, bx - ax), hl = Math.max(14, ui.shapeStroke * 4); g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - hl * Math.cos(a - 0.45), by - hl * Math.sin(a - 0.45)); g.lineTo(bx - hl * Math.cos(a + 0.45), by - hl * Math.sin(a + 0.45)); g.closePath(); g.fillStyle = ui.fg; g.fill(); } }
      else g.rect(X, Y, rw, rh);
      if (ui.shape !== 'line' && ui.shape !== 'arrow') { if (ui.shapeFill) g.fill(); if (ui.shapeStroke) g.stroke(); }
      const l = addLayer(L('Form', 'Shape'), c); l.x = Math.round(rx - pad); l.y = Math.round(ry - pad);
    });
  }
}
function onWheel(e) {
  e.preventDefault(); const r = ui.cv.getBoundingClientRect();
  if (e.ctrlKey || e.altKey || !e.shiftKey) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  else { ui.view.ox -= e.deltaY; draw(); }
}
function onDbl(e) { if (ui.tool === 'move' || ui.tool === 'text') { const [x, y] = toDoc(e); const hit = [...doc.layers].reverse().find((q) => q.text && x >= q.x && y >= q.y && x <= q.x + q.cv.width && y <= q.y + q.cv.height); if (hit) textDialog(hit); } }
function onKey(e) {
  if (!photoOpen()) return false;
  const tag = (e.target.tagName || '').toLowerCase();
  if ((tag === 'input' && !['range', 'checkbox', 'color'].includes(e.target.type)) || tag === 'textarea' || tag === 'select') return true;
  if ($('.modal-bg')) return e.key !== 'Escape' ? true : false;
  const k = e.key.toLowerCase(); const c = e.ctrlKey || e.metaKey;
  const act = () => { e.preventDefault(); e.stopPropagation(); return true; };
  if (e.type === 'keyup') { if (k === ' ') ui.spaceDown = false; return true; }
  if (k === ' ') { ui.spaceDown = true; return act(); }
  if (c && k === 'z' && !e.shiftKey) { const l = undo(); if (l) toast(L('Rückgängig: ', 'Undo: ') + l); return act(); }
  if (c && (k === 'y' || (k === 'z' && e.shiftKey))) { redo(); return act(); }
  if (c && k === 's') { saveProject(e.shiftKey); return act(); }
  if (c && k === 'o') { openDialog(); return act(); }
  if (c && k === 'n') { newDialog(); return act(); }
  if (c && k === 'e' && e.shiftKey) { structural(L('Auf eine Ebene reduzieren', 'Flatten'), () => { const f = flatten(); doc.layers = []; addLayer(L('Hintergrund', 'Background'), f); }); return act(); }
  if (c && k === 'e') { exportDialog(); return act(); }
  if (c && k === 'a') { pushUndo(L('Alles auswählen', 'Select all')); doc.sel = selRect(0, 0, doc.w, doc.h); changed('sel'); return act(); }
  if (c && k === 'd') { pushUndo(L('Auswahl aufheben', 'Deselect')); doc.sel = null; changed('sel'); return act(); }
  if (c && e.shiftKey && k === 'i') { pushUndo(L('Auswahl umkehren', 'Invert')); invertSel(); changed('sel'); return act(); }
  if (c && k === 'j') { dupLayer(); return act(); }
  if (c && k === 'c') { copySel(); return act(); }
  if (c && k === 'v') return false; // paste event handles it
  if (c && k === '0') { fit(); return act(); }
  if (c && k === '1') { const W = ui.cv.width / ui.dpr, H = ui.cv.height / ui.dpr; ui.view = { s: 1, ox: (W - doc.w) / 2, oy: (H - doc.h) / 2 }; draw(); return act(); }
  if (c && (k === '+' || k === '=')) { zoomAt(1.25, ui.cv.width / ui.dpr / 2, ui.cv.height / ui.dpr / 2); return act(); }
  if (c && k === '-') { zoomAt(0.8, ui.cv.width / ui.dpr / 2, ui.cv.height / ui.dpr / 2); return act(); }
  if (c && e.shiftKey && k === 'n') { neuralDialog(); return act(); }
  if (c) return act();
  if (k === 'enter' && ui.cropRect) { applyCrop(); return act(); }
  if (k === 'escape') { if (ui.cropRect) { ui.cropRect = null; draw(); } else if (doc.sel) { pushUndo(L('Auswahl aufheben', 'Deselect')); doc.sel = null; changed('sel'); } return act(); }
  if ((k === 'delete' || k === 'backspace') && doc.layer) { const l = doc.layer; if (doc.sel) { normalizeLayer(l); const cv = beginPixelEdit(l, L('Löschen', 'Delete')); const g = ctx2d(cv); g.globalCompositeOperation = 'destination-out'; g.drawImage(doc.sel, 0, 0); changed(); } else delLayer(); return act(); }
  if (k.startsWith('arrow') && doc.layer && ui.tool === 'move') { const n = e.shiftKey ? 10 : 1; pushUndo(L('Verschieben', 'Move')); const l = doc.layer; if (k === 'arrowleft') l.x -= n; if (k === 'arrowright') l.x += n; if (k === 'arrowup') l.y -= n; if (k === 'arrowdown') l.y += n; changed(); return act(); }
  if (k === '[') { ui.size = Math.max(1, Math.round(ui.size * 0.85)); buildOpts(); draw(); return act(); }
  if (k === ']') { ui.size = Math.min(800, Math.round(ui.size * 1.18) + 1); buildOpts(); draw(); return act(); }
  if (k === 'x') { [ui.fg, ui.bg] = [ui.bg, ui.fg]; refreshColors(); return act(); }
  if (k === 'd') { ui.fg = '#ffffff'; ui.bg = '#000000'; refreshColors(); return act(); }
  const t = TOOLS.find((q) => q[3].toLowerCase() === k); if (t) { setTool(t[0]); return act(); }
  return act(); // never let video shortcuts fire in photo mode
}

// ------------------------------------------------------------------ layers panel
function buildLayers() {
  const box = ui.layersBox; if (!box) return; box.innerHTML = '';
  const l = doc.layer;
  if (l) {
    const op = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: l.opacity, style: { flex: 1 } });
    op.onchange = () => { pushUndo(L('Deckkraft', 'Opacity')); l.opacity = +op.value; changed(); }; op.oninput = () => { l.opacity = +op.value; ui.compDirty = true; draw(); };
    const bl = el('select', {}, ...BLENDS.map(([v, de, en]) => el('option', { value: v }, L(de, en)))); bl.value = l.blend; bl.onchange = () => { pushUndo(L('Füllmethode', 'Blend')); l.blend = bl.value; changed(); };
    box.append(el('div', { class: 'row', style: { margin: '0 0 6px', gap: '6px' } }, bl, el('span', { class: 'muted' }, '◐'), op));
  }
  [...doc.layers].reverse().forEach((q) => {
    const th = canvas(44, 30); const tg = ctx2d(th); const k = Math.min(44 / doc.w, 30 / doc.h); tg.fillStyle = '#555'; tg.fillRect(0, 0, 44, 30); tg.drawImage(q.cv, q.x * k + (44 - doc.w * k) / 2, q.y * k + (30 - doc.h * k) / 2, q.cv.width * k, q.cv.height * k);
    const row = el('div', { class: 'ph-layer' + (q.id === doc.active ? ' on' : ''), draggable: true, onclick: () => { doc.active = q.id; buildLayers(); buildSide(); draw(); }, ondblclick: async () => { const n = await promptBox(L('Ebenen-Name', 'Layer name'), q.name); if (n) { pushUndo('Name'); q.name = n; changed(); } } },
      el('button', { class: 'ph-eye', title: L('Sichtbar', 'Visible'), onclick: (e) => { e.stopPropagation(); pushUndo(L('Sichtbarkeit', 'Visibility')); q.visible = !q.visible; changed(); } }, q.visible ? '👁' : '—'),
      th, el('span', { class: 'ph-lname' }, (q.text ? 'T  ' : '') + q.name), q.opacity < 1 ? el('span', { class: 'muted' }, Math.round(q.opacity * 100) + '%') : null);
    row.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/layer', q.id));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/layer'); if (!id || id === q.id) return; structural(L('Ebene verschieben', 'Reorder'), () => { const a = layerIndex(id); const [m] = doc.layers.splice(a, 1); doc.layers.splice(layerIndex(q.id) + 1, 0, m); }); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); doc.active = q.id; contextMenu(e.clientX, e.clientY, layerMenu()); });
    box.appendChild(row);
  });
}
function dupLayer() { const l = doc.layer; if (!l) return; structural(L('Ebene duplizieren', 'Duplicate layer'), () => { const n = addLayer(l.name + L(' Kopie', ' copy'), cloneCanvas(l.cv), null, { x: l.x, y: l.y, opacity: l.opacity, blend: l.blend, text: l.text ? { ...l.text } : undefined }); return n; }); }
function delLayer() { const l = doc.layer; if (!l || doc.layers.length < 2) { toast(L('Die letzte Ebene kann nicht gelöscht werden', 'Cannot delete the last layer'), 'err'); return; } structural(L('Ebene löschen', 'Delete layer'), () => { const i = layerIndex(l.id); doc.layers.splice(i, 1); doc.active = doc.layers[Math.max(0, i - 1)].id; }); }
function copySel() { const l = doc.layer; if (!l) return; const src = maskBySel(layerInDoc(l)); const b = selBounds() || { x: 0, y: 0, w: doc.w, h: doc.h }; const c = canvas(b.w, b.h); ctx2d(c).drawImage(src, -b.x, -b.y); c.toBlob((blob) => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => toast(L('Kopiert', 'Copied'))).catch(() => {})); }

// ------------------------------------------------------------------ right panel: Anpassen / Filter / Effekte / KI
const ADJ = [['exposure', 'color'], ['brightness', 'color'], ['contrast', 'color'], ['highlights', 'color'], ['shadows', 'color'], ['whites', 'color'], ['blacks', 'color'], ['saturation', 'color'], ['vibrance', 'color'], ['temperature', 'color'], ['tint', 'color'], ['hue', 'color']];
const adjState = { color: defaultParams('color'), sharp: 0, clarity: 0, vignette: 0, grain: 0, filter: null, filterAmt: 1, extra: [] };
function previewEffects() {
  const list = [];
  const dc = defaultParams('color'); if (Object.keys(dc).some((k) => adjState.color[k] !== dc[k])) list.push({ type: 'color', params: { ...adjState.color } });
  if (adjState.clarity && EFFECTS.clarity) list.push({ type: 'clarity', params: { ...defaultParams('clarity'), amount: adjState.clarity } });
  if (adjState.sharp && EFFECTS.sharpen) list.push({ type: 'sharpen', params: { ...defaultParams('sharpen'), amount: adjState.sharp } });
  if (adjState.vignette && EFFECTS.vignette) list.push({ type: 'vignette', params: { ...defaultParams('vignette'), amount: adjState.vignette } });
  if (adjState.grain && EFFECTS.grain) list.push({ type: 'grain', params: { ...defaultParams('grain'), amount: adjState.grain } });
  return list;
}
function updatePreview() {
  const l = doc.layer; if (!l) return;
  const base = previewEffects(); const filt = adjState.filter ? BUILTIN_PRESETS.find((p) => p.id === adjState.filter) : null;
  const effects = [...base, ...(filt ? filt.effects.map((f) => ({ ...f, params: { ...defaultParams(f.type), ...f.params } })) : []), ...adjState.extra];
  ui.preview = effects.length ? { layerId: l.id, effects, amt: filt && !base.length && !adjState.extra.length ? adjState.filterAmt : 1 } : null;
  if (filt && (base.length || adjState.extra.length) && adjState.filterAmt < 1) ui.preview.amt = 1; // mixing only for pure filters
  ui.compDirty = true; draw();
}
function resetAdj() { adjState.color = defaultParams('color'); adjState.sharp = adjState.clarity = adjState.vignette = adjState.grain = 0; adjState.filter = null; adjState.filterAmt = 1; adjState.extra = []; ui.preview = null; }
function commitAdj() {
  const l = doc.layer; if (!l || !ui.preview) { toast(L('Nichts zum Anwenden', 'Nothing to apply')); return; }
  const res = applyFx(l.cv, ui.preview.effects, { amt: ui.preview.amt, copy: true });
  let out = res;
  if (doc.sel) { const before = cloneCanvas(l.cv); const tmp = canvas(l.cv.width, l.cv.height); const tg = ctx2d(tmp); tg.drawImage(res, 0, 0); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(doc.sel, -l.x, -l.y); const bg = ctx2d(before); bg.drawImage(tmp, 0, 0); out = before; }
  beginPixelEdit(l, L('Anpassung', 'Adjustment')); l.cv = out; resetAdj(); changed('doc');
  toast(L('Angewendet', 'Applied'), 'ok');
}
function buildSide() {
  const s = ui.side; if (!s) return; s.innerHTML = '';
  const tabs = [['adjust', L('Anpassen', 'Adjust')], ['filter', 'Filter'], ['fx', L('Effekte', 'Effects')], ['ai', 'KI']];
  s.append(el('div', { class: 'ph-tabs' }, ...tabs.map(([k, n]) => el('button', { class: 'ph-tab' + (ui.tab === k ? ' on' : ''), onclick: () => { ui.tab = k; buildSide(); } }, n))));
  const body = el('div', { class: 'ph-tabbody' }); s.append(body);
  const slider = (label, get, set, min, max, step = 0.01) => { const i = el('input', { type: 'range', min, max, step, value: get() }); const v = el('span', { class: 'tc' }, (+get()).toFixed(step < 1 ? 2 : 0)); i.oninput = () => { set(+i.value); v.textContent = (+i.value).toFixed(step < 1 ? 2 : 0); updatePreview(); }; i.ondblclick = () => { i.value = 0; i.oninput(); }; return el('div', { class: 'ph-slider' }, el('label', {}, label), i, v); };
  const applyRow = () => el('div', { class: 'row', style: { marginTop: '10px' } }, el('button', { class: 'btn primary', onclick: commitAdj }, '✓ ' + L('Anwenden', 'Apply')), el('button', { class: 'btn', onclick: () => { resetAdj(); buildSide(); ui.compDirty = true; draw(); } }, L('Zurücksetzen', 'Reset')),
    el('span', { class: 'muted', style: { fontSize: '11px' } }, doc.sel ? L('nur auf Auswahl', 'selection only') : L('auf aktive Ebene', 'active layer')));
  if (ui.tab === 'adjust') {
    const cp = EFFECTS.color.params;
    for (const [k] of ADJ) { const q = cp.find((p) => p.k === k); if (q) body.append(slider(L(q.de, q.en), () => adjState.color[k], (v) => (adjState.color[k] = v), q.min, q.max, q.step)); }
    body.append(el('div', { class: 'ph-sep' }),
      slider(L('Klarheit', 'Clarity'), () => adjState.clarity, (v) => (adjState.clarity = v), 0, 1.5), slider(L('Schärfen', 'Sharpen'), () => adjState.sharp, (v) => (adjState.sharp = v), 0, 2),
      slider('Vignette', () => adjState.vignette, (v) => (adjState.vignette = v), 0, 1), slider(L('Körnung', 'Grain'), () => adjState.grain, (v) => (adjState.grain = v), 0, 1),
      el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } }, L('Doppelklick auf Regler = 0. Vorschau live, „Anwenden“ schreibt es fest.', 'Double-click a slider = 0. Live preview, "Apply" bakes it.')), applyRow());
  } else if (ui.tab === 'filter') {
    const list = BUILTIN_PRESETS.filter((p) => ['color', 'cinematic', 'gaming', 'realism'].includes(p.kind));
    const grid = el('div', { class: 'ph-fgrid' });
    const thumbSrc = doc.layers.length ? resizeCanvas(flatten(), 120, Math.max(1, Math.round((120 * doc.h) / doc.w))) : null;
    for (const p of [{ id: null, name: L('Keiner', 'None'), effects: [] }, ...list]) {
      const th = canvas(120, thumbSrc ? thumbSrc.height : 68); if (thumbSrc) { const r = p.effects.length ? applyFx(thumbSrc, p.effects.map((f) => ({ ...f, params: { ...defaultParams(f.type), ...f.params } }))) : thumbSrc; ctx2d(th).drawImage(r, 0, 0); }
      grid.append(el('div', { class: 'ph-filter' + (adjState.filter === p.id ? ' on' : ''), onclick: () => { adjState.filter = p.id; updatePreview(); buildSide(); } }, th, el('span', {}, p.name)));
    }
    body.append(slider(L('Stärke', 'Strength'), () => adjState.filterAmt, (v) => (adjState.filterAmt = v), 0, 1), grid, applyRow());
  } else if (ui.tab === 'fx') {
    const cats = Object.entries(EFFECT_CATS).filter(([k]) => !['motion', '3d'].includes(k));
    const sel = el('select', { style: { width: '100%' } }, ...cats.map(([k, n]) => el('optgroup', { label: L(n.de, n.en) }, ...Object.values(EFFECTS).filter((d) => d.cat === k && !d.mod && d.special !== 'motionblur').map((d) => el('option', { value: d.id }, L(d.name.de, d.name.en))))));
    body.append(el('div', { class: 'row', style: { margin: '0 0 8px' } }, sel, el('button', { class: 'btn small', onclick: () => { adjState.extra.push({ type: sel.value, params: defaultParams(sel.value), enabled: true }); ui.fxSel = adjState.extra.length - 1; updatePreview(); buildSide(); } }, '＋')));
    adjState.extra.forEach((fx, i) => {
      const d = EFFECTS[fx.type];
      const params = el('div', {}, ...(d.params || []).filter((q) => ['range', 'color', 'bool', 'select'].includes(q.type)).map((q) => {
        if (q.type === 'range') return slider(L(q.de, q.en), () => fx.params[q.k], (v) => (fx.params[q.k] = v), q.min, q.max, q.step);
        if (q.type === 'color') { const c = el('input', { type: 'color', value: fx.params[q.k] }); c.oninput = () => { fx.params[q.k] = c.value; updatePreview(); }; return el('div', { class: 'ph-slider' }, el('label', {}, L(q.de, q.en)), c); }
        if (q.type === 'bool') { const c = el('input', { type: 'checkbox', checked: !!fx.params[q.k] }); c.onchange = () => { fx.params[q.k] = c.checked ? 1 : 0; updatePreview(); }; return el('div', { class: 'ph-slider' }, el('label', {}, L(q.de, q.en)), c); }
        const s2 = el('select', {}, ...(q.options || []).map((o, j) => el('option', { value: j }, typeof o === 'string' ? o : L(o.de || o[0], o.en || o[1])))); s2.value = fx.params[q.k]; s2.onchange = () => { fx.params[q.k] = +s2.value; updatePreview(); }; return el('div', { class: 'ph-slider' }, el('label', {}, L(q.de, q.en)), s2);
      }));
      body.append(el('div', { class: 'ph-fxcard' }, el('div', { class: 'row', style: { margin: 0 } }, el('b', { style: { flex: 1 } }, L(d.name.de, d.name.en)), el('button', { class: 'tl-btn', onclick: () => { adjState.extra.splice(i, 1); updatePreview(); buildSide(); } }, '✕')), params));
    });
    if (!adjState.extra.length) body.append(el('div', { class: 'muted' }, L('Alle Video-Effekte gehen auch für Fotos: Effekt wählen → ＋. Mehrere stapelbar, Vorschau live.', 'All video effects work on photos: pick → ＋. Stackable, live preview.')));
    body.append(applyRow());
  } else if (ui.tab === 'ai') {
    const big = (t, sub, fn, cls = '') => el('button', { class: 'ph-aibtn ' + cls, onclick: fn }, el('b', {}, t), el('span', {}, sub));
    body.append(
      big('✦ Neural Rendering', L('KI malt das Bild realistischer – Gesichter, Autos, Umgebung. Stärke einstellbar (auch GTA).', 'AI repaints the image more realistically. Adjustable strength (incl. GTA).'), () => neuralDialog(), 'nr'),
      big('⚡ DLSS5', L('Schnelle KI-Details + Gesichter, bleibt nah am Original', 'Fast AI detail + faces, stays close to the original'), () => aiLayer('dlss5')),
      big('🪄 ' + L('Generatives Füllen', 'Generative fill'), L('Auswahl machen → beschreiben, was dort sein soll', 'Make a selection → describe what should be there'), () => genFill(false)),
      big('🧽 ' + L('Generativ entfernen', 'Generative remove'), L('Auswahl um ein Objekt → KI füllt den Hintergrund', 'Select an object → AI fills the background'), () => genFill(true)),
      big('🧍 ' + L('Motiv auswählen', 'Select subject'), L('KI erkennt Person/Auto/Objekt als Auswahl', 'AI turns the subject into a selection'), selectSubject),
      big('✂ ' + L('Hintergrund entfernen', 'Remove background'), L('Transparenter Hintergrund (RMBG)', 'Transparent background (RMBG)'), () => aiLayer('bgremove')),
      big('🙂 ' + L('Gesichter verbessern', 'Enhance faces'), 'GFPGAN', () => aiLayer('faces')),
      big('🔎 ' + L('KI-Hochskalieren ×2 / ×4', 'AI upscale ×2 / ×4'), L('Ganzes Bild größer + schärfer', 'Whole image bigger and sharper'), () => upscaleDoc()));
  }
}

// ------------------------------------------------------------------ AI actions
async function aiTarget() { const l = doc.layer; if (!l) throw new Error(L('Keine Ebene', 'No layer')); normalizeLayer(l); return l; }
async function aiLayer(kind) {
  try {
    const l = await aiTarget(); let res;
    if (kind === 'dlss5') { const s = await levelPick('DLSS5', [['Natürlich', 0.3], ['GTA', 0.55], ['Stark', 0.8], ['Ultra', 1]], 1); if (s == null) return; res = await AI.dlss5(l.cv, s); }
    else res = await AI[kind](l.cv);
    if (!res) return;
    if (res.width !== doc.w || res.height !== doc.h) res = resizeCanvas(res, doc.w, doc.h);
    if (kind === 'bgremove') { beginPixelEdit(l, L('Hintergrund entfernen', 'Remove background')); l.cv = doc.sel ? mixSel(l.cv, res) : res; changed('doc'); }
    else structural(kind === 'dlss5' ? 'DLSS5' : L('Gesichter', 'Faces'), () => addLayer((kind === 'dlss5' ? 'DLSS5' : L('Gesichter', 'Faces')) + ' · ' + l.name, doc.sel ? maskBySel(res) : res));
    toast(L('Fertig – als neue Ebene (Deckkraft regelbar)', 'Done – added as new layer'), 'ok');
  } catch (e) { toast(e.message, 'err', 8000); }
}
function mixSel(base, res) { const out = cloneCanvas(base); const g = ctx2d(out); const t = maskBySel(res); g.globalCompositeOperation = 'destination-out'; g.drawImage(doc.sel, 0, 0); g.globalCompositeOperation = 'source-over'; g.drawImage(t, 0, 0); return out; }
async function selectSubject() {
  try { const src = flatten(); const res = await AI.bgremove(src); if (!res) return; const m = canvas(doc.w, doc.h); const g = ctx2d(m); g.drawImage(res, 0, 0, doc.w, doc.h); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, doc.w, doc.h); pushUndo(L('Motiv auswählen', 'Select subject')); doc.sel = m; changed('sel'); toast(L('Motiv ausgewählt', 'Subject selected'), 'ok'); }
  catch (e) { toast(e.message, 'err', 8000); }
}
async function upscaleDoc() {
  const f = await levelPick(L('KI-Hochskalieren', 'AI upscale'), [['×2', 2], ['×4', 4]], 0); if (!f) return;
  if (doc.w * f > 16000 || doc.h * f > 16000) { toast(L('Zu groß (max. 16000 px)', 'Too large (max 16000 px)'), 'err'); return; }
  try {
    const out = [];
    for (const l of doc.layers) { if (l.text) { out.push({ l, cv: renderText({ ...l.text, size: l.text.size * f, stroke: (l.text.stroke || 0) * f }) }); continue; } const r = await AI.upscale(l.cv, f); if (!r) return; out.push({ l, cv: r }); }
    structural(L('Hochskalieren', 'Upscale'), () => { for (const { l, cv } of out) { l.cv = cv.width === l.cv.width * f ? cv : resizeCanvas(cv, l.cv.width * f, l.cv.height * f); l.x *= f; l.y *= f; if (l.text) l.text = { ...l.text, size: l.text.size * f, stroke: (l.text.stroke || 0) * f }; } doc.w *= f; doc.h *= f; doc.sel = null; });
    fit(); toast(`${doc.w}×${doc.h}`, 'ok');
  } catch (e) { toast(e.message, 'err', 8000); }
}
function levelPick(title, opts, def) {
  return new Promise((res) => { let v = opts[def][1]; const chips = el('div', { class: 'chips' }); const drawC = () => { chips.innerHTML = ''; opts.forEach(([n, x]) => chips.append(el('span', { class: 'chip' + (x === v ? ' on' : ''), style: { padding: '6px 16px' }, onclick: () => { v = x; drawC(); } }, n))); }; drawC();
    modal({ title, body: chips, buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('Start', 'Start'), cls: 'primary', value: 1 }], onClose: (r) => res(r ? v : null) }); });
}
// Neural Rendering (generative img2img), whole image or selection
export async function neuralDialog() {
  const l = doc.layer; if (!l) return;
  const o = { s: NR_LEVELS[1].s, level: 'gta', scene: 'all', prompt: '', faces: true, newLayer: true };
  const lvl = el('div', { class: 'chips' }), scn = el('div', { class: 'chips' }); const hint = el('div', { class: 'muted', style: { fontSize: '11.5px', minHeight: '16px' } });
  const val = el('b', { class: 'tc' }); const sl = el('input', { type: 'range', min: 0.05, max: 0.5, step: 0.01, value: o.s, style: { flex: 1 } });
  const drawL = () => { lvl.innerHTML = ''; NR_LEVELS.forEach((x) => lvl.append(el('span', { class: 'chip' + (o.level === x.id ? ' on' : ''), style: { padding: '6px 14px', fontSize: '13px' }, onclick: () => { o.level = x.id; o.s = x.s; sl.value = x.s; hint.textContent = L(x.hint.de, x.hint.en); drawL(); } }, levelName(x)))); val.textContent = Math.round((o.s / 0.5) * 100) + '%'; };
  const drawS = () => { scn.innerHTML = ''; NR_SCENES.forEach((x) => scn.append(el('span', { class: 'chip' + (o.scene === x.id ? ' on' : ''), onclick: () => { o.scene = x.id; drawS(); } }, L(x.name.de, x.name.en)))); };
  sl.oninput = () => { o.s = +sl.value; o.level = 'custom'; hint.textContent = L('Eigene Stärke', 'Custom strength'); drawL(); };
  hint.textContent = L(NR_LEVELS[1].hint.de, NR_LEVELS[1].hint.en); drawL(); drawS();
  const pr = el('input', { type: 'text', placeholder: L('Optional: was genau? z. B. „nasse Straße, Regen“', 'Optional: what exactly? e.g. "wet street, rain"'), style: { width: '100%' } }); pr.oninput = () => (o.prompt = pr.value);
  const cb = (k, t) => { const i = el('input', { type: 'checkbox', checked: o[k] }); i.onchange = () => (o[k] = i.checked); return el('label', { class: 'chip' }, i, ' ' + t); };
  const body = el('div', { style: { width: '560px' } },
    el('div', { class: 'muted', style: { marginBottom: '10px' } }, L('Generative KI (lokal auf deiner Grafikkarte) malt das Bild neu – echte Hauttexturen, Lack, Asphalt, Licht. ', 'Generative AI (local on your GPU) repaints the image – real skin, paint, asphalt, light. ') + (doc.sel ? L('Nur die Auswahl wird verändert.', 'Only the selection is changed.') : '')),
    el('div', { class: 'row' }, el('b', {}, L('Stärke', 'Strength')), lvl, el('span', { class: 'spacer' }), val), el('div', { class: 'row' }, sl), hint,
    el('div', { class: 'row', style: { marginTop: '8px' } }, el('b', {}, L('Was?', 'What?')), scn), pr,
    el('div', { class: 'chips', style: { marginTop: '8px' } }, cb('faces', L('Gesichter extra scharf', 'Extra sharp faces')), cb('newLayer', L('Als neue Ebene', 'As new layer'))));
  modal({ title: '✦ Neural Rendering', body, width: 600, buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('Rendern', 'Render'), cls: 'primary', onClick: () => { setTimeout(() => runNeural(o), 30); } }] });
}
async function runNeural(o) {
  try {
    const l = await aiTarget(); const scene = NR_SCENES.find((x) => x.id === o.scene) || NR_SCENES[0];
    const res = await AI.neural(l.cv, { prompt: (o.prompt ? o.prompt + ', ' : '') + scene.p, strength: o.s, faces: o.faces, mask: doc.sel || null, maxSide: 1024, label: 'Neural Rendering' });
    if (!res) return;
    const r = res.width !== doc.w || res.height !== doc.h ? resizeCanvas(res, doc.w, doc.h) : res;
    if (o.newLayer) structural('Neural Rendering', () => addLayer('Neural Rendering · ' + l.name, doc.sel ? maskBySel(r) : r));
    else { beginPixelEdit(l, 'Neural Rendering'); l.cv = doc.sel ? mixSel(l.cv, r) : r; changed('doc'); }
    toast(L('Neural Rendering fertig – Deckkraft der Ebene regelt die Stärke', 'Neural Rendering done – layer opacity controls the strength'), 'ok', 5000);
  } catch (e) { toast(e.message, 'err', 9000); }
}
async function genFill(remove) {
  if (!doc.sel) { toast(L('Erst einen Bereich auswählen (Lasso / Rechteck / Pinsel-Auswahl)', 'Select an area first'), 'err', 5000); setTool('lasso'); return; }
  let prompt = '';
  if (!remove) { prompt = await promptBox(L('Was soll in der Auswahl entstehen? (Englisch klappt am besten, z. B. „red sports car“)', 'What should appear in the selection?'), ''); if (prompt == null) return; }
  try {
    const l = await aiTarget(); const src = flatten();
    const saved = doc.sel; if (remove) growSel(10); const sel = doc.sel; doc.sel = saved; // removal: include the object's halo
    const m = canvas(doc.w, doc.h); const g = ctx2d(m); g.filter = 'blur(6px)'; g.drawImage(sel, 0, 0); // soft edge
    let base = src;
    if (remove) { base = cloneCanvas(src); diffuseFill(base, sel); }
    const res = await AI.neural(base, { prompt: remove ? 'empty background, seamless, photorealistic, matching surroundings, high detail' : prompt + ', photorealistic, matching lighting and perspective, high detail', strength: remove ? 0.85 : 0.95, steps: 4, mask: m, faces: false, maxSide: 1024, label: remove ? L('Generativ entfernen', 'Generative remove') : L('Generatives Füllen', 'Generative fill') });
    if (!res) return;
    const r = resizeCanvas(res, doc.w, doc.h); const lay = cloneCanvas(r); const lg = ctx2d(lay); lg.globalCompositeOperation = 'destination-in'; lg.drawImage(m, 0, 0);
    structural(remove ? L('Entfernt', 'Removed') : L('Generativ: ', 'Generative: ') + prompt, () => addLayer(remove ? L('Entfernt', 'Removed') : '🪄 ' + prompt.slice(0, 30), lay, layerIndex(l.id) + 1));
  } catch (e) { toast(e.message, 'err', 9000); }
}

// ------------------------------------------------------------------ text
function textDialog(layer, at) {
  const t = layer?.text ? { ...layer.text } : { text: '', font: 'Segoe UI', size: Math.round(Math.max(24, doc.h / 12)), color: ui.fg, bold: true, italic: false, stroke: 0, strokeColor: '#000000', shadow: true, align: 'left' };
  const ta = el('textarea', { rows: 3, style: { width: '100%', fontSize: '16px' } }); ta.value = t.text; ta.addEventListener('keydown', (e) => e.stopPropagation());
  const fonts = ['Segoe UI', 'Bahnschrift', 'Impact', 'Arial Black', 'Georgia', 'Consolas', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Comic Sans MS'];
  const fsel = el('select', {}, ...fonts.map((f) => el('option', { value: f }, f))); fsel.value = t.font;
  const size = el('input', { type: 'number', value: t.size, min: 6, max: 2000 }); const col = el('input', { type: 'color', value: t.color }); const st = el('input', { type: 'number', value: t.stroke, min: 0, max: 100 }); const stc = el('input', { type: 'color', value: t.strokeColor });
  const ck = (k, n) => { const i = el('input', { type: 'checkbox', checked: t[k] }); i.onchange = () => (t[k] = i.checked); return el('label', { class: 'chip' }, i, ' ' + n); };
  const al = el('select', {}, ...[['left', L('Links', 'Left')], ['center', L('Mitte', 'Center')], ['right', L('Rechts', 'Right')]].map(([v, n]) => el('option', { value: v }, n))); al.value = t.align;
  const body = el('div', { style: { width: '480px' } }, ta, el('div', { class: 'form', style: { gridTemplateColumns: '90px 1fr', marginTop: '8px' } }, el('label', {}, 'Schrift'), fsel, el('label', {}, L('Größe', 'Size')), size, el('label', {}, L('Farbe', 'Colour')), col, el('label', {}, L('Kontur', 'Stroke')), el('div', { class: 'row', style: { margin: 0 } }, st, stc), el('label', {}, L('Ausrichtung', 'Align')), al), el('div', { class: 'chips' }, ck('bold', L('Fett', 'Bold')), ck('italic', L('Kursiv', 'Italic')), ck('shadow', L('Schatten', 'Shadow'))));
  setTimeout(() => ta.focus(), 50);
  modal({ title: layer ? L('Text bearbeiten', 'Edit text') : L('Neuer Text', 'New text'), body, buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: 'OK', cls: 'primary', onClick: () => {
    Object.assign(t, { text: ta.value, font: fsel.value, size: +size.value, color: col.value, stroke: +st.value, strokeColor: stc.value, align: al.value }); if (!t.text.trim()) return;
    const cv = renderText(t);
    if (layer) structural(L('Text', 'Text'), () => { layer.cv = cv; layer.text = t; });
    else structural(L('Text', 'Text'), () => { const nl = addLayer(t.text.split('\n')[0].slice(0, 24), cv, null, { text: t }); nl.x = Math.round((at ? at[0] : doc.w / 2) - (at ? 0 : cv.width / 2)); nl.y = Math.round((at ? at[1] : doc.h / 2) - cv.height / 2); });
  } }] });
}

// ------------------------------------------------------------------ image ops
function applyCrop() {
  const c = ui.cropRect; if (!c) return; ui.cropRect = null;
  const x = Math.round(c.x), y = Math.round(c.y), w = Math.round(c.w), h = Math.round(c.h);
  structural(L('Zuschneiden', 'Crop'), () => { for (const l of doc.layers) { l.x -= x; l.y -= y; } doc.w = w; doc.h = h; doc.sel = null; });
  fit();
}
async function resizeDialog(canvasOnly = false) {
  const w = el('input', { type: 'number', value: doc.w }), h = el('input', { type: 'number', value: doc.h }); const lock = el('input', { type: 'checkbox', checked: true }); const r = doc.w / doc.h;
  w.oninput = () => { if (lock.checked) h.value = Math.round(+w.value / r); }; h.oninput = () => { if (lock.checked) w.value = Math.round(+h.value * r); };
  const body = el('div', { class: 'form', style: { gridTemplateColumns: '90px 1fr' } }, el('label', {}, L('Breite', 'Width')), w, el('label', {}, L('Höhe', 'Height')), h, el('label', {}, ''), el('label', { class: 'chip' }, lock, ' ' + L('Seitenverhältnis', 'Keep ratio')));
  modal({ title: canvasOnly ? L('Arbeitsfläche', 'Canvas size') : L('Bildgröße', 'Image size'), body, buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: 'OK', cls: 'primary', onClick: () => {
    const W = Math.max(1, Math.min(16000, +w.value)), H = Math.max(1, Math.min(16000, +h.value));
    structural(canvasOnly ? L('Arbeitsfläche', 'Canvas') : L('Bildgröße', 'Resize'), () => {
      if (canvasOnly) { const dx = Math.round((W - doc.w) / 2), dy = Math.round((H - doc.h) / 2); doc.layers.forEach((l) => { l.x += dx; l.y += dy; }); }
      else { const kx = W / doc.w, ky = H / doc.h; doc.layers.forEach((l) => { l.cv = resizeCanvas(l.cv, Math.max(1, l.cv.width * kx), Math.max(1, l.cv.height * ky)); l.x = Math.round(l.x * kx); l.y = Math.round(l.y * ky); }); }
      doc.w = W; doc.h = H; doc.sel = null;
    }); fit();
  } }] });
}
function rotateDoc(deg) {
  structural(L('Drehen', 'Rotate'), () => {
    const flat = deg % 180 !== 0;
    doc.layers.forEach((l) => { normalizeLayer(l); l.cv = rotateCanvas(l.cv, deg); });
    if (flat) [doc.w, doc.h] = [doc.h, doc.w]; doc.sel = null;
  }); fit();
}
function flipDoc(horiz) { structural(L('Spiegeln', 'Flip'), () => { doc.layers.forEach((l) => { normalizeLayer(l); l.cv = flipCanvas(l.cv, horiz); }); doc.sel = null; }); }
async function transformLayer() {
  const l = doc.layer; if (!l) return;
  const sc = el('input', { type: 'number', value: 100, min: 1, max: 2000 }), rot = el('input', { type: 'number', value: 0, min: -360, max: 360 });
  modal({ title: L('Ebene transformieren', 'Transform layer'), body: el('div', { class: 'form', style: { gridTemplateColumns: '110px 1fr' } }, el('label', {}, L('Skalierung %', 'Scale %')), sc, el('label', {}, L('Drehung °', 'Rotation °')), rot), buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: 'OK', cls: 'primary', onClick: () => {
    structural(L('Transformieren', 'Transform'), () => { const cx = l.x + l.cv.width / 2, cy = l.y + l.cv.height / 2; let c = resizeCanvas(l.cv, Math.max(1, (l.cv.width * +sc.value) / 100), Math.max(1, (l.cv.height * +sc.value) / 100)); if (+rot.value) c = rotateCanvas(c, +rot.value); l.cv = c; l.x = Math.round(cx - c.width / 2); l.y = Math.round(cy - c.height / 2); delete l.text; });
  } }] });
}

// ------------------------------------------------------------------ files
async function openDialog() {
  const r = await ipcRenderer.invoke('dialog:open', { title: L('Foto öffnen', 'Open photo'), defaultPath: photosDir(), properties: ['openFile'], filters: [{ name: L('Bilder & VELOX Foto', 'Images & VELOX photo'), extensions: [...IMG_EXT, 'vxfoto'] }] });
  if (!r.canceled) openFile(r.filePaths[0]);
}
export async function openFile(f) {
  try {
    if (/\.vxfoto$/i.test(f)) { await deserialize(fs.readFileSync(f, 'utf8'), f); }
    else { const img = await loadImg(f); docFromImage(img, path.basename(f).replace(/\.[^.]+$/, '')); doc.source = f; }
    addRecent(f); fit(); resetAdj(); buildSide();
  } catch (e) { toast(L('Öffnen fehlgeschlagen: ', 'Open failed: ') + e.message, 'err'); }
}
const loadImg = (f) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(path.basename(f))); i.src = fileUrl(f); });
async function placeImage(f) {
  if (!IMG_EXT.includes(path.extname(f).slice(1).toLowerCase())) return;
  const img = await loadImg(f);
  structural(L('Bild platzieren', 'Place image'), () => { const c = canvas(img.naturalWidth, img.naturalHeight); ctx2d(c).drawImage(img, 0, 0); let cv = c; const k = Math.min(1, doc.w / c.width, doc.h / c.height); if (k < 1) cv = resizeCanvas(c, c.width * k, c.height * k); const l = addLayer(path.basename(f).replace(/\.[^.]+$/, ''), cv); l.x = Math.round((doc.w - cv.width) / 2); l.y = Math.round((doc.h - cv.height) / 2); });
}
function addRecent(f) { const r = (settings.photoRecent || []).filter((x) => x !== f); r.unshift(f); settings.photoRecent = r.slice(0, 12); import('../core/settings.js').then((s) => s.setSetting('photoRecent', settings.photoRecent)); }
async function saveProject(as = false) {
  let f = doc.file;
  if (!f || as) { const r = await ipcRenderer.invoke('dialog:save', { title: L('Foto-Projekt speichern', 'Save photo project'), defaultPath: path.join(photosDir(), (doc.name || 'Foto') + '.vxfoto'), filters: [{ name: 'VELOX Foto', extensions: ['vxfoto'] }] }); if (r.canceled) return; f = r.filePath; }
  fs.writeFileSync(f, await serialize()); doc.file = f; doc.dirty = false; addRecent(f);
  try { const t = resizeCanvas(flatten(), 320, Math.max(1, Math.round((320 * doc.h) / doc.w))); fs.writeFileSync(f + '.jpg', Buffer.from(t.toDataURL('image/jpeg', 0.8).split(',')[1], 'base64')); } catch {}
  toast(L('Gespeichert: ', 'Saved: ') + path.basename(f), 'ok');
}
function exportDialog() {
  const fmt = el('select', {}, ...[['png', 'PNG (verlustfrei, Transparenz)'], ['jpg', 'JPG'], ['webp', 'WebP']].map(([v, n]) => el('option', { value: v }, n)));
  const q = el('input', { type: 'range', min: 0.5, max: 1, step: 0.01, value: 0.95 }); const scale = el('select', {}, ...[[1, '100 %'], [0.5, '50 %'], [0.25, '25 %'], [2, '200 %']].map(([v, n]) => el('option', { value: v }, n)));
  const name = el('input', { type: 'text', value: doc.name || 'Foto', style: { width: '100%' } }); name.addEventListener('keydown', (e) => e.stopPropagation());
  const desk = el('input', { type: 'checkbox', checked: settings.copyToDesktop !== false });
  const body = el('div', { class: 'form', style: { gridTemplateColumns: '110px 1fr', width: '440px' } }, el('label', {}, 'Name'), name, el('label', {}, 'Format'), fmt, el('label', {}, L('Qualität', 'Quality')), q, el('label', {}, L('Größe', 'Size')), scale, el('label', {}, ''), el('label', { class: 'chip' }, desk, ' ' + L('Kopie auf den Desktop', 'Copy to desktop')),
    el('label', {}, L('Ordner', 'Folder')), el('span', { class: 'muted' }, photosDir()));
  modal({ title: L('Foto exportieren', 'Export photo'), body, buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('Exportieren', 'Export'), cls: 'primary', onClick: () => doExport({ fmt: fmt.value, q: +q.value, scale: +scale.value, name: name.value, desk: desk.checked }) }] });
}
async function doExport({ fmt, q, scale, name, desk }) {
  let c = flatten(fmt === 'jpg' ? '#ffffff' : null); if (scale !== 1) c = resizeCanvas(c, Math.round(doc.w * scale), Math.round(doc.h * scale));
  const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[fmt];
  const buf = await new Promise((r) => c.toBlob((b) => b.arrayBuffer().then((a) => r(Buffer.from(a))), mime, q));
  const safe = (name || 'Foto').replace(/[\\/:*?"<>|]/g, '_'); let out = path.join(photosDir(), `${safe}.${fmt}`); let n = 2; while (fs.existsSync(out)) out = path.join(photosDir(), `${safe} (${n++}).${fmt}`);
  fs.writeFileSync(out, buf);
  if (desk) try { fs.copyFileSync(out, path.join(paths.desktop, path.basename(out))); } catch {}
  toast(L('Exportiert: ', 'Exported: ') + path.basename(out) + (desk ? L(' (+ Desktop)', ' (+ desktop)') : ''), 'ok', 5000);
  return out;
}
async function toTimeline() {
  const out = await doExport({ fmt: 'png', q: 1, scale: 1, name: doc.name || 'Foto', desk: false });
  closePhotoMode();
  const { importFiles, appendToMain } = await import('../core/media.js'); const { store } = await import('../core/project.js');
  const ms = await importFiles([out]); store.edit(L('Foto einfügen', 'Insert photo'), (p) => appendToMain(p, ms));
  toast(L('Foto in die Timeline gelegt', 'Photo added to the timeline'), 'ok');
}
async function newDialog() {
  const w = el('input', { type: 'number', value: 1920 }), h = el('input', { type: 'number', value: 1080 });
  const bgSel = el('select', {}, ...[['#ffffff', L('Weiß', 'White')], ['#000000', L('Schwarz', 'Black')], ['', L('Transparent', 'Transparent')]].map(([v, n]) => el('option', { value: v }, n)));
  const pre = el('div', { class: 'chips' }, ...[['1080p', 1920, 1080], ['4K', 3840, 2160], ['TikTok 9:16', 1080, 1920], ['Insta 4:5', 1080, 1350], ['1:1', 2048, 2048], ['Thumbnail', 1280, 720]].map(([n, a, b]) => el('span', { class: 'chip', onclick: () => { w.value = a; h.value = b; } }, n)));
  modal({ title: L('Neues Foto', 'New photo'), body: el('div', {}, pre, el('div', { class: 'form', style: { gridTemplateColumns: '90px 1fr', marginTop: '8px' } }, el('label', {}, L('Breite', 'Width')), w, el('label', {}, L('Höhe', 'Height')), h, el('label', {}, L('Hintergrund', 'Background')), bgSel)),
    buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('Erstellen', 'Create'), cls: 'primary', onClick: () => { newDoc(Math.min(16000, +w.value), Math.min(16000, +h.value), { bg: bgSel.value || null }); fit(); } }] });
}
async function grabVideoFrame() {
  const { store } = await import('../core/project.js'); const { Compositor } = await import('../render/compositor.js');
  const S = store.p.settings; const c = document.createElement('canvas'); const comp = new Compositor(c, { preserve: true }); comp.setSize(S.width, S.height);
  const src = $('#preview-canvas'); const img = canvas(S.width, S.height); ctx2d(img).drawImage(src, 0, 0, S.width, S.height);
  docFromImage(img, (store.p.name || 'Standbild') + ' ' + store.time.toFixed(2) + 's'); fit();
}

// ------------------------------------------------------------------ menus
function fileMenu() {
  const rec = (settings.photoRecent || []).filter((f) => fs.existsSync(f));
  return [{ label: L('Neu…', 'New…') + '   Strg+N', action: newDialog }, { label: L('Öffnen…', 'Open…') + '   Strg+O', action: openDialog }, { label: L('Zuletzt geöffnet', 'Recent'), sub: rec.length ? rec.map((f) => ({ label: path.basename(f), action: () => openFile(f) })) : [{ label: '—', disabled: true }] },
    { label: L('Bild als Ebene platzieren…', 'Place image as layer…'), action: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Bilder', extensions: IMG_EXT }] }); if (!r.canceled) for (const f of r.filePaths) await placeImage(f); } },
    { label: L('Standbild aus dem Video holen', 'Grab frame from video'), action: grabVideoFrame }, '-',
    { label: L('Speichern (.vxfoto)', 'Save (.vxfoto)') + '   Strg+S', action: () => saveProject() }, { label: L('Speichern unter…', 'Save as…') + '   Strg+Umschalt+S', action: () => saveProject(true) },
    { label: L('Exportieren (PNG/JPG/WebP)…', 'Export (PNG/JPG/WebP)…') + '   Strg+E', action: exportDialog }, { label: L('In die Video-Timeline legen', 'Send to video timeline'), action: toTimeline }, '-',
    { label: L('Fotos-Ordner öffnen', 'Open photos folder'), action: () => ipcRenderer.invoke('shell:open', photosDir()) }, { label: L('Zurück zum Video-Modus', 'Back to video mode'), action: closePhotoMode }];
}
function editMenu() {
  return [{ label: L('Rückgängig', 'Undo') + '   Strg+Z', action: () => undo() }, { label: L('Wiederholen', 'Redo') + '   Strg+Y', action: () => redo() }, '-',
    { label: L('Kopieren', 'Copy') + '   Strg+C', action: copySel }, { label: L('Auswahl löschen', 'Clear selection area') + '   Entf', action: () => onKey({ key: 'Delete', target: document.body, preventDefault() {}, stopPropagation() {} }) },
    { label: L('Auswahl mit Vordergrundfarbe füllen', 'Fill selection with foreground'), action: () => { const l = doc.layer; if (!l || !doc.sel) return; normalizeLayer(l); const cv = beginPixelEdit(l, L('Füllen', 'Fill')); const f = canvas(doc.w, doc.h); const g = ctx2d(f); g.fillStyle = ui.fg; g.fillRect(0, 0, doc.w, doc.h); ctx2d(cv).drawImage(maskBySel(f), 0, 0); changed(); } },
    { label: L('Inhaltsbasiert füllen (schnell, ohne KI)', 'Content-aware fill (fast, no AI)'), action: () => { const l = doc.layer; if (!l || !doc.sel) return toast(L('Erst auswählen', 'Select first'), 'err'); normalizeLayer(l); const cv = beginPixelEdit(l, L('Inhaltsbasiert füllen', 'Content-aware fill')); diffuseFill(cv, doc.sel); changed(); } },
    { label: L('Ebene transformieren (Größe/Drehung)…', 'Transform layer…'), action: transformLayer }];
}
function imageMenu() {
  return [{ label: L('Bildgröße…', 'Image size…'), action: () => resizeDialog(false) }, { label: L('Arbeitsfläche…', 'Canvas size…'), action: () => resizeDialog(true) }, { label: L('Zuschneiden-Werkzeug', 'Crop tool') + '   C', action: () => setTool('crop') },
    { label: L('Auf Auswahl zuschneiden', 'Crop to selection'), action: () => { const b = selBounds(); if (b) { ui.cropRect = b; applyCrop(); } } }, '-',
    { label: L('90° rechts drehen', 'Rotate 90° CW'), action: () => rotateDoc(90) }, { label: L('90° links drehen', 'Rotate 90° CCW'), action: () => rotateDoc(-90) }, { label: '180°', action: () => rotateDoc(180) },
    { label: L('Horizontal spiegeln', 'Flip horizontal'), action: () => flipDoc(true) }, { label: L('Vertikal spiegeln', 'Flip vertical'), action: () => flipDoc(false) }, '-',
    { label: L('Auf eine Ebene reduzieren', 'Flatten') + '   Strg+Umschalt+E', action: () => structural(L('Reduzieren', 'Flatten'), () => { const f = flatten(); doc.layers = []; addLayer(L('Hintergrund', 'Background'), f); }) }];
}
function layerMenu() {
  return [{ label: L('Neue Ebene', 'New layer'), action: () => structural(L('Neue Ebene', 'New layer'), () => addLayer(L('Ebene ', 'Layer ') + (doc.layers.length + 1))) }, { label: L('Duplizieren', 'Duplicate') + '   Strg+J', action: dupLayer }, { label: L('Löschen', 'Delete'), action: delLayer },
    { label: L('Auswahl als neue Ebene', 'Selection to new layer'), action: () => { const l = doc.layer; if (!l || !doc.sel) return; structural(L('Ebene aus Auswahl', 'Layer via copy'), () => addLayer(l.name + L(' Ausschnitt', ' cut'), maskBySel(layerInDoc(l)))); } },
    { label: L('Nach unten zusammenführen', 'Merge down'), action: () => doc.layer && structural('Merge', () => mergeDown(doc.layer)) }, '-',
    { label: L('Nach oben', 'Bring forward'), action: () => moveLayer(1) }, { label: L('Nach unten', 'Send backward'), action: () => moveLayer(-1) }, { label: L('Transformieren…', 'Transform…'), action: transformLayer },
    { label: L('Umbenennen…', 'Rename…'), action: async () => { const l = doc.layer; const n = l && (await promptBox(L('Name', 'Name'), l.name)); if (n) { pushUndo('Name'); l.name = n; changed(); } } }];
}
function moveLayer(d) { const i = layerIndex(doc.active); const j = i + d; if (j < 0 || j >= doc.layers.length) return; structural(L('Reihenfolge', 'Order'), () => { const [m] = doc.layers.splice(i, 1); doc.layers.splice(j, 0, m); }); }
function selectMenu() {
  return [{ label: L('Alles', 'All') + '   Strg+A', action: () => { pushUndo('Sel'); doc.sel = selRect(0, 0, doc.w, doc.h); changed('sel'); } }, { label: L('Aufheben', 'Deselect') + '   Strg+D', action: () => { pushUndo('Sel'); doc.sel = null; changed('sel'); } },
    { label: L('Umkehren', 'Invert') + '   Strg+Umschalt+I', action: () => { pushUndo('Sel'); invertSel(); changed('sel'); } }, '-',
    { label: L('Motiv auswählen (KI)', 'Select subject (AI)'), action: selectSubject },
    { label: L('Weiche Kante…', 'Feather…'), action: async () => { const v = await promptBox(L('Weiche Kante in Pixel', 'Feather radius px'), '8'); if (v) { pushUndo('Feather'); featherSel(+v); changed('sel'); } } },
    { label: L('Erweitern…', 'Expand…'), action: async () => { const v = await promptBox(L('Erweitern um Pixel', 'Expand by px'), '6'); if (v) { pushUndo('Grow'); growSel(+v); changed('sel'); } } },
    { label: L('Verkleinern…', 'Contract…'), action: async () => { const v = await promptBox(L('Verkleinern um Pixel', 'Contract by px'), '6'); if (v) { pushUndo('Shrink'); growSel(-v); changed('sel'); } } },
    { label: L('Ebenen-Inhalt auswählen', 'Select layer pixels'), action: () => { const l = doc.layer; if (!l) return; const m = layerInDoc(l); const g = ctx2d(m); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, doc.w, doc.h); pushUndo('Sel'); doc.sel = m; changed('sel'); } }];
}
function aiMenu() {
  return [{ label: '✦ Neural Rendering…   Strg+Umschalt+N', action: neuralDialog }, { label: '⚡ DLSS5…', action: () => aiLayer('dlss5') }, '-',
    { label: L('Generatives Füllen…', 'Generative fill…'), action: () => genFill(false) }, { label: L('Generativ entfernen', 'Generative remove'), action: () => genFill(true) }, '-',
    { label: L('Motiv auswählen', 'Select subject'), action: selectSubject }, { label: L('Hintergrund entfernen', 'Remove background'), action: () => aiLayer('bgremove') }, { label: L('Gesichter verbessern', 'Enhance faces'), action: () => aiLayer('faces') },
    { label: L('KI-Hochskalieren…', 'AI upscale…'), action: upscaleDoc }];
}

registerCommands([
  { id: 'photoMode', name: { de: 'Foto-Modus öffnen', en: 'Open photo mode' }, cat: 'file', key: 'Ctrl+Alt+F', run: ({ file } = {}) => openPhotoMode(file) },
  { id: 'photoFromFrame', name: { de: 'Standbild im Foto-Modus bearbeiten', en: 'Edit frame in photo mode' }, cat: 'file', run: async () => { openPhotoMode(); await grabVideoFrame(); } },
]);
