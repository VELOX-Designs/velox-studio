// Program monitor: GPU preview canvas, quality, on-canvas transform gizmo, safe zones, scopes feed.
import { store, clipEnd } from '../core/project.js';
import { bus, el, $, tc, clamp } from '../core/util.js';
import { settings, setSetting } from '../core/settings.js';
import { Compositor, evalTransform, layerVerts } from '../render/compositor.js';
import { engine } from '../playback/engine.js';
import { L } from '../core/i18n.js';
import { evalParam, isKf, setKeyframe } from '../core/keyframes.js';

export let compositor = null;
let canvas, wrap, stage;
let showSafe = false;
export const viewer = { overlayMode: 'gizmo', trackRect: null, onTrackRect: null };

// GPU reset / context loss (driver reset, heavy AI load…): rebuild the canvas + compositor automatically
function watchContext(cv) {
  cv.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    setTimeout(() => {
      const fresh = document.createElement('canvas'); fresh.id = 'preview-canvas';
      cv.replaceWith(fresh); canvas = fresh;
      try { compositor = new Compositor(fresh, { preserve: true }); engine.compositor = compositor; watchContext(fresh); layout(); engine.needsRender = true;
        import('./dialogs.js').then((d) => d.toast(L('Grafikkarte wurde kurz zurückgesetzt – Vorschau wiederhergestellt', 'GPU was reset – preview restored'), 'ok')); }
      catch (err) { console.error(err); }
    }, 300);
  }, { once: true });
}

export function initViewer() {
  canvas = $('#preview-canvas'); wrap = $('#canvas-wrap'); stage = $('#viewer-stage');
  compositor = new Compositor(canvas, { preserve: true });
  watchContext(canvas);
  engine.init(compositor);
  engine.onRender = (t) => renderNow(t);
  const q = $('#preview-quality');
  q.innerHTML = '';
  [['auto', 'Auto'], ['full', L('Voll', 'Full')], ['half', '1/2'], ['quarter', '1/4']].forEach(([v, n]) => q.appendChild(el('option', { value: v }, L('Vorschau: ', 'Preview: ') + n)));
  q.value = settings.previewQuality;
  q.onchange = () => { setSetting('previewQuality', q.value); layout(); };
  $('#preview-zoom').onchange = layout;
  $('#btn-safe').onclick = () => { showSafe = !showSafe; $('#btn-safe').classList.toggle('on', showSafe); drawOverlay(); };
  $('#btn-fullscreen').onclick = () => { const v = $('#viewer'); document.fullscreenElement ? document.exitFullscreen() : v.requestFullscreen(); };
  new ResizeObserver(layout).observe(stage);
  let lastFmt = '';
  bus.on('changed', (l) => { const f = store.p.settings.width + 'x' + store.p.settings.height; if (l === 'load' || l === 'settings' || f !== lastFmt) { lastFmt = f; layout(); } engine.needsRender = true; drawOverlay(); });
  bus.on('selection', drawOverlay);
  bus.on('time', () => { $('#tc-current').textContent = tc(store.time, store.fps); drawOverlay(); });
  bus.on('play', (p) => { $('#btn-play').innerHTML = p ? '&#x23F8;' : '&#x25B6;'; });
  $('#tc-current').addEventListener('dblclick', async () => {
    const { promptBox } = await import('./dialogs.js'); const { parseTc } = await import('../core/util.js');
    const v = await promptBox(L('Gehe zu Timecode', 'Go to timecode'), tc(store.time, store.fps)); const t = parseTc(v || '', store.fps); if (t != null) engine.seek(t);
  });
  setInterval(() => {
    $('#tc-duration').textContent = tc(store.duration(), store.fps);
    const [l, r] = engine.playing ? engine.levels() : [0, 0];
    $('#meter-l').style.height = Math.min(100, l * 100) + '%'; $('#meter-r').style.height = Math.min(100, r * 100) + '%';
  }, 60);
  layout();
}

export function previewScale() {
  const q = settings.previewQuality;
  const P = store.p.settings;
  const r = stage.getBoundingClientRect();
  const fit = Math.min((r.width - 20) / P.width, (r.height - 20) / P.height);
  const disp = fit * (devicePixelRatio || 1);
  if (q === 'full') return 1;
  if (q === 'half') return 0.5;
  if (q === 'quarter') return 0.25;
  // auto: render at display resolution (max 1), lower during playback for 4K
  return clamp(disp, 0.1, 1);
}

function layout() {
  if (!stage) return;
  const P = store.p.settings;
  const r = stage.getBoundingClientRect();
  const z = $('#preview-zoom').value;
  let s = z === 'fit' ? Math.min((r.width - 20) / P.width, (r.height - 20) / P.height) : +z / (devicePixelRatio || 1);
  s = Math.max(0.02, s);
  wrap.style.width = Math.round(P.width * s) + 'px'; wrap.style.height = Math.round(P.height * s) + 'px';
  const sc = previewScale();
  compositor.setSize(P.width * sc, P.height * sc);
  engine.needsRender = true;
  drawOverlay();
}

let lastFrameMs = 0;
function renderNow(t) {
  const t0 = performance.now();
  try { compositor.renderFrame(store.p, t, engine); } catch (e) { console.error(e); }
  lastFrameMs = performance.now() - t0;
  bus.emit('frame', t);
}
export const frameTime = () => lastFrameMs;

// ------------------------------------------------------------------ overlay (gizmo / safe zones / tracking)
function drawOverlay() {
  const ov = $('#viewer-overlay'); if (!ov) return;
  ov.innerHTML = '';
  const P = store.p.settings;
  const W = wrap.clientWidth, H = wrap.clientHeight; if (!W) return;
  const k = W / P.width;
  if (showSafe) {
    ov.appendChild(el('div', { class: 'safe', style: { left: W * 0.05 + 'px', top: H * 0.05 + 'px', width: W * 0.9 + 'px', height: H * 0.9 + 'px' } }));
    ov.appendChild(el('div', { class: 'safe', style: { left: W * 0.1 + 'px', top: H * 0.1 + 'px', width: W * 0.8 + 'px', height: H * 0.8 + 'px' } }));
    if (P.height > P.width) ov.appendChild(el('div', { class: 'safe', style: { left: W * 0.08 + 'px', top: H * 0.12 + 'px', width: W * 0.72 + 'px', height: H * 0.68 + 'px', borderColor: 'rgba(255,84,112,.6)' } }));
  }
  if (viewer.trackRect) { drawTrackBox(ov, W, H); return; }
  if (viewer.customOverlay && viewer.customOverlay(ov, W, H)) return;
  const c = store.primaryClip();
  if (!c || c.type === 'audio' || c.type === 'adjust' || engine.playing) return;
  const t = store.time; if (t < c.start || t >= clipEnd(c)) return;
  const lt = t - c.start;
  const m = c.mediaId ? store.media(c.mediaId) : null;
  const mw = m?.width || P.width, mh = m?.height || P.height;
  const T = evalTransform(c, lt);
  const v = layerVerts(T, mw, mh, P.width, P.height, c.type === 'text' || c.type === 'solid').data;
  const pts = [0, 1, 3, 2].map((i) => [((v[i * 6] / v[i * 6 + 3]) * 0.5 + 0.5) * W, (0.5 - (v[i * 6 + 1] / v[i * 6 + 3]) * 0.5) * H]);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H); svg.style.position = 'absolute'; svg.style.left = 0; svg.style.top = 0; svg.style.pointerEvents = 'none';
  const poly = document.createElementNS(svg.namespaceURI, 'polygon');
  poly.setAttribute('points', pts.map((p) => p.join(',')).join(' ')); poly.setAttribute('fill', 'rgba(34,211,238,0.04)'); poly.setAttribute('stroke', '#22d3ee'); poly.setAttribute('stroke-width', '1.5');
  poly.style.pointerEvents = 'auto'; poly.style.cursor = 'move';
  svg.appendChild(poly);
  ov.appendChild(svg);
  // drag to move
  poly.addEventListener('mousedown', (e) => dragTransform(e, c, lt, 'move', k));
  // corner handles: scale ; top handle: rotate
  pts.forEach((p) => { const h = el('div', { class: 'h', style: { left: p[0] + 'px', top: p[1] + 'px', position: 'absolute', width: '10px', height: '10px', background: '#fff', border: '1px solid #22d3ee', transform: 'translate(-50%,-50%)', pointerEvents: 'auto', cursor: 'nwse-resize', borderRadius: '2px' } }); h.addEventListener('mousedown', (e) => dragTransform(e, c, lt, 'scale', k)); ov.appendChild(h); });
  const topMid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  const rh = el('div', { style: { position: 'absolute', left: topMid[0] + 'px', top: topMid[1] - 24 + 'px', width: '12px', height: '12px', borderRadius: '50%', background: '#22d3ee', transform: 'translate(-50%,-50%)', pointerEvents: 'auto', cursor: 'grab' } });
  rh.addEventListener('mousedown', (e) => dragTransform(e, c, lt, 'rotate', k));
  ov.appendChild(rh);
}

function setProp(c, key, v, lt) {
  const cur = c.transform[key];
  if (isKf(cur)) c.transform[key] = setKeyframe(cur, lt, v);
  else c.transform[key] = v;
}
function dragTransform(e, c, lt, mode, k) {
  e.preventDefault(); e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  const T0 = { x: evalParam(c.transform.x, lt), y: evalParam(c.transform.y, lt), scale: evalParam(c.transform.scale, lt), rotation: evalParam(c.transform.rotation, lt) };
  const r = wrap.getBoundingClientRect();
  const cx = r.left + r.width / 2 + T0.x * k, cy = r.top + r.height / 2 + T0.y * k;
  const d0 = Math.hypot(sx - cx, sy - cy) || 1, a0 = Math.atan2(sy - cy, sx - cx);
  store.begin('Transformieren');
  const mv = (ev) => {
    if (mode === 'move') {
      let nx = T0.x + (ev.clientX - sx) / k, ny = T0.y + (ev.clientY - sy) / k;
      if (!ev.shiftKey) { if (Math.abs(nx) < 12 / k) nx = 0; if (Math.abs(ny) < 12 / k) ny = 0; }
      setProp(c, 'x', Math.round(nx), lt); setProp(c, 'y', Math.round(ny), lt);
    } else if (mode === 'scale') {
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      setProp(c, 'scale', Math.max(0.01, +(T0.scale * d / d0).toFixed(3)), lt);
    } else {
      let a = T0.rotation + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI;
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      setProp(c, 'rotation', +a.toFixed(1), lt);
    }
    store.touch(); drawOverlay();
  };
  const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); store.end(); drawOverlay(); };
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
}

// tracking region editor (normalised rect)
function drawTrackBox(ov, W, H) {
  const r = viewer.trackRect;
  const box = el('div', { class: 'trackbox', style: { left: r.x * W + 'px', top: r.y * H + 'px', width: r.w * W + 'px', height: r.h * H + 'px' } });
  const handle = el('div', { style: { position: 'absolute', right: '-6px', bottom: '-6px', width: '12px', height: '12px', background: '#ffb547', cursor: 'nwse-resize' } });
  box.appendChild(handle);
  const drag = (e, resize) => {
    e.preventDefault(); e.stopPropagation(); const sx = e.clientX, sy = e.clientY, o = { ...r };
    const mv = (ev) => { const dx = (ev.clientX - sx) / W, dy = (ev.clientY - sy) / H; if (resize) { r.w = clamp(o.w + dx, 0.02, 1); r.h = clamp(o.h + dy, 0.02, 1); } else { r.x = clamp(o.x + dx, 0, 1 - r.w); r.y = clamp(o.y + dy, 0, 1 - r.h); } drawOverlay(); viewer.onTrackRect?.(r); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  box.addEventListener('mousedown', (e) => drag(e, false));
  handle.addEventListener('mousedown', (e) => drag(e, true));
  ov.appendChild(box);
}
export function setTrackRect(r, cb) { viewer.trackRect = r; viewer.onTrackRect = cb; drawOverlay(); }
export { drawOverlay, layout as layoutViewer };

// grab current preview pixels (for scopes / snapshots)
export function grabPreview(w = 320) {
  const P = store.p.settings; const h = Math.round(w * P.height / P.width);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(canvas, 0, 0, w, h);
  return c;
}
