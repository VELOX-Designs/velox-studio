// Canvas timeline: multi-track editing, trimming, snapping, magnetic main track, transitions,
// keyframe markers, waveforms, filmstrips, drag & drop from libraries and Explorer.
import { trWindow, setTransitionOverlap } from '../core/project.js';
import { store, clipEnd, clearRange, splitAt, splitClipAt, trimClipStart, trimClipEnd, removeClip, rippleTrack, maxDurFor, sourceLength, dropBrokenTransitions, newTrack, speedAt } from '../core/project.js';
import { bus, el, $, clamp, tc, throttleRaf, uid } from '../core/util.js';
import { settings, setSetting } from '../core/settings.js';
import { thumbs, peaks, stripImages, placeMedia, importFiles, addTextClip, freeVideoTrack, freeAudioTrack } from '../core/media.js';
import { engine } from '../playback/engine.js';
import { L, N } from '../core/i18n.js';
import { run, keyOf } from '../core/commands.js';
import { isKf } from '../core/keyframes.js';
import { contextMenu, toast } from './dialogs.js';
import { EFFECTS, defaultParams } from '../render/effects.js';
import { TRANSITIONS } from '../render/transitions.js';

const RULER = 30;
const EDGE = 7;
const COLORS = { video: '#1d7f8a', audio: '#2a8f6a', text: '#b0503f', image: '#2f7d95', solid: '#a0763a', adjust: '#7b8090', compound: '#2f8f9d', multicam: '#c45d2a', shape: '#4f9d3a', camera: '#d6a43d' };

export const tl = {
  zoom: 60, // px per second
  scrollX: 0, scrollY: 0,
  tool: 'select',
  hover: null,
  drag: null,
  snapLine: null, hoverTr: null,
  linkedSel: true,
  targetVideo: null, targetAudio: null,
};

let canvas, ctx, W = 0, H = 0, dpr = 1;
let rows = []; // [{track, y, h}]

export function initTimeline() {
  canvas = $('#tl-canvas');
  ctx = canvas.getContext('2d');
  buildToolbar();
  const ro = new ResizeObserver(() => resize()); ro.observe(canvas);
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onHover);
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('mouseleave', () => { tl.hover = null; tl.hoverTr = null; draw(); });
  canvas.addEventListener('dragover', onDragOver);
  canvas.addEventListener('drop', onDrop);
  canvas.addEventListener('dragleave', () => { tl.dropGhost = null; draw(); });
  $('#tl-scroll-h').addEventListener('scroll', (e) => { if (!tl._syncScroll) { tl.scrollX = e.target.scrollLeft; draw(); } });
  bus.on('changed', () => { layoutRows(); draw(); renderHeaders(); });
  bus.on('time', () => { followPlayhead(); draw(); });
  bus.on('selection', draw);
  bus.on('thumbs', draw);
  bus.on('lang', () => { buildToolbar(); renderHeaders(); });
  bus.on('keymap', buildToolbar);
  resize();
}

function resize() {
  dpr = devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  layoutRows(); draw(); renderHeaders();
}

// ------------------------------------------------------------------ geometry
const x2t = (x) => (x + tl.scrollX) / tl.zoom;
const t2x = (t) => t * tl.zoom - tl.scrollX;
function layoutRows() {
  const vt = store.p.tracks.filter((t) => t.kind === 'video').reverse();
  const at = store.p.tracks.filter((t) => t.kind === 'audio');
  rows = []; let y = RULER - tl.scrollY;
  for (const t of vt) { rows.push({ track: t, y, h: t.height || 58 }); y += t.height || 58; }
  tl.divider = y; y += 6;
  for (const t of at) { rows.push({ track: t, y, h: t.height || 48 }); y += t.height || 48; }
  tl.contentH = y + tl.scrollY - RULER + 40;
  if (!tl.targetVideo || !store.track(tl.targetVideo)) tl.targetVideo = store.p.tracks.find((t) => t.kind === 'video')?.id;
  if (!tl.targetAudio || !store.track(tl.targetAudio)) tl.targetAudio = store.p.tracks.find((t) => t.kind === 'audio')?.id;
  const sh = $('#tl-scroll-h > div');
  if (sh) { sh.style.width = Math.max(W, (store.duration() + 30) * tl.zoom) + 'px'; tl._syncScroll = true; $('#tl-scroll-h').scrollLeft = tl.scrollX; tl._syncScroll = false; }
}
const rowAt = (y) => rows.find((r) => y >= r.y && y < r.y + r.h);
const rowOf = (trackId) => rows.find((r) => r.track.id === trackId);

function clipAt(x, y) {
  const r = rowAt(y); if (!r) return null;
  const t = x2t(x);
  const c = store.p.clips.find((c) => c.trackId === r.track.id && t >= c.start && t < clipEnd(c));
  if (!c) return { row: r };
  const x0 = t2x(c.start), x1 = t2x(clipEnd(c));
  let part = 'body';
  const w = x1 - x0;
  const edge = Math.min(EDGE, w / 4);
  if (x - x0 < edge) part = 'left'; else if (x1 - x < edge) part = 'right';
  if (part === 'body' && y - r.y < 10 && c.type !== 'adjust') {
    const fi = t2x(c.start + (c.fadeIn || 0)), fo = t2x(clipEnd(c) - (c.fadeOut || 0));
    if (Math.abs(x - fi) < 7) part = 'fadeIn'; else if (Math.abs(x - fo) < 7) part = 'fadeOut';
  }
  return { clip: c, row: r, part };
}
function transitionAt(x, y) {
  const r = rowAt(y); if (!r || r.track.kind !== 'video') return null;
  const t = x2t(x);
  for (const tr of store.p.transitions) {
    const a = store.clip(tr.a); if (!a || a.trackId !== r.track.id) continue;
    const b = store.clip(tr.b); if (!b) continue;
    const cut = clipEnd(a); const [w0, w1] = trWindow(tr, a, b);
    const minW = 14 / tl.zoom;
    if (t >= w0 - minW / 2 && t <= w1 + minW / 2 && true) {
      const xl = t2x(w0), xr = t2x(w1);
      return { tr, part: x - xl < 7 ? 'left' : xr - x < 7 ? 'right' : 'body', cut, w0, w1 };
    }
  }
  return null;
}

// ------------------------------------------------------------------ snapping
function snapPoints(exclude = new Set()) {
  const pts = [store.time, 0];
  for (const c of store.p.clips) if (!exclude.has(c.id)) pts.push(c.start, clipEnd(c));
  for (const m of store.p.markers) pts.push(m.t);
  for (const tr of store.p.transitions) { const a = store.clip(tr.a), b = store.clip(tr.b); if (a && b && !exclude.has(a.id)) { const [w0, w1] = trWindow(tr, a, b); pts.push(w0, w1); } }
  if (store.p.inPoint != null) pts.push(store.p.inPoint);
  if (store.p.outPoint != null) pts.push(store.p.outPoint);
  return pts;
}
function snap(t, exclude, extraTimes = []) {
  if (!settings.snapping) return { t, line: null };
  const thr = 10 / tl.zoom;
  let best = null;
  for (const p of snapPoints(exclude)) {
    for (const off of [0, ...extraTimes]) {
      const d = Math.abs(t + off - p);
      if (d < thr && (!best || d < best.d)) best = { d, t: p - off, line: p };
    }
  }
  return best ? { t: best.t, line: best.line } : { t, line: null };
}
const frame = (t) => Math.round(t * store.fps) / store.fps;

// ------------------------------------------------------------------ drawing
export const draw = throttleRaf(drawNow);
function drawNow() {
  if (!ctx) return;
  layoutRowsLight();
  const g = ctx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#161618'; g.fillRect(0, 0, W, H);
  // track backgrounds
  for (const r of rows) {
    if (r.y > H || r.y + r.h < RULER) continue;
    g.fillStyle = r.track.kind === 'video' ? '#1a1a1c' : '#181a1a';
    if (r.track.id === tl.targetVideo || r.track.id === tl.targetAudio) g.fillStyle = r.track.kind === 'video' ? '#1d1f22' : '#1a1e1d';
    g.fillRect(0, r.y, W, r.h - 1);
    g.fillStyle = '#222225'; g.fillRect(0, r.y + r.h - 1, W, 1);
  }
  g.fillStyle = '#111112'; g.fillRect(0, tl.divider, W, 6);
  // in/out range
  const P = store.p;
  if (P.inPoint != null || P.outPoint != null) {
    const a = t2x(P.inPoint ?? 0), b = t2x(P.outPoint ?? store.duration());
    g.fillStyle = 'rgba(30,200,212,0.07)'; g.fillRect(a, RULER, b - a, H);
  }
  // clips
  g.save(); g.beginPath(); g.rect(0, RULER, W, H - RULER); g.clip();
  const t0 = x2t(0), t1 = x2t(W);
  for (const c of P.clips) {
    if (clipEnd(c) < t0 || c.start > t1) continue;
    const r = rowOf(c.trackId); if (!r || r.y > H || r.y + r.h < RULER) continue;
    drawClip(g, c, r);
  }
  // transitions
  for (const tr of P.transitions) {
    const a = store.clip(tr.a); if (!a) continue;
    const r = rowOf(a.trackId); if (!r) continue;
    const bb = store.clip(tr.b); if (!bb) continue;
    const [w0, w1] = trWindow(tr, a, bb);
    const x0 = t2x(w0), x1 = t2x(w1);
    const y0 = r.y + 2, h = r.h - 5;
    const sel = store.selTransition === tr.id, hov = tl.hoverTr === tr.id;
    const w = Math.max(14, x1 - x0), xs = x1 - x0 < 14 ? (x0 + x1) / 2 - 7 : x0;
    roundRect(g, xs, y0, w, h, 4);
    g.fillStyle = sel ? 'rgba(255,255,255,0.30)' : hov ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.16)'; g.fill();
    g.strokeStyle = sel ? '#ffb547' : 'rgba(255,255,255,0.9)'; g.lineWidth = sel ? 2 : 1.25; g.stroke();
    // bow-tie icon ⋈
    const cx = xs + w / 2, cy = y0 + h / 2, s2 = Math.min(7, h / 4, w / 3);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx - s2 * 1.3, cy - s2); g.lineTo(cx, cy); g.lineTo(cx - s2 * 1.3, cy + s2); g.closePath(); g.moveTo(cx + s2 * 1.3, cy - s2); g.lineTo(cx, cy); g.lineTo(cx + s2 * 1.3, cy + s2); g.closePath(); g.fill();
    // length only while selected/hovered and if there is room
    if ((sel || hov) && w > 60) { g.font = '600 10px Segoe UI'; g.textBaseline = 'bottom'; g.fillStyle = '#fff'; const t = tr.dur.toFixed(1) + 's'; g.fillText(t, cx - g.measureText(t).width / 2, y0 + h - 3); }
  }
  // drop ghost
  if (tl.dropGhost) {
    const d = tl.dropGhost; const r = rowOf(d.trackId);
    if (r) { g.fillStyle = 'rgba(30,200,212,0.35)'; g.strokeStyle = '#5fe0e8'; roundRect(g, t2x(d.t), r.y + 2, Math.max(4, d.dur * tl.zoom), r.h - 5, 5); g.fill(); g.stroke(); }
  }
  // marquee
  if (tl.drag?.type === 'marquee') {
    const d = tl.drag; g.fillStyle = 'rgba(30,200,212,0.12)'; g.strokeStyle = '#1ec8d4';
    g.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    g.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
  }
  g.restore();
  // markers on tracks
  for (const m of P.markers) { const x = t2x(m.t); g.fillStyle = (m.color || '#ffb547') + '55'; g.fillRect(x, RULER, 1, H); }
  // razor hover
  if (tl.tool === 'razor' && tl.hover?.x != null) { g.fillStyle = '#ff5470'; g.fillRect(tl.hover.x, RULER, 1, H); }
  // snap line
  drawRuler(g);
  if (tl.snapLine != null) {
    const sx = Math.round(t2x(tl.snapLine));
    g.fillStyle = 'rgba(255,214,10,0.25)'; g.fillRect(sx - 3, RULER, 6, H);
    g.fillStyle = '#ffd60a'; g.fillRect(sx - 1, RULER, 2, H);
    g.beginPath(); g.moveTo(sx, RULER - 1); g.lineTo(sx - 6, RULER - 8); g.lineTo(sx + 6, RULER - 8); g.closePath(); g.fill();
  }
  // playhead
  const px = t2x(store.time);
  g.fillStyle = '#f2f2f2'; g.fillRect(px - 0.75, 4, 1.5, H);
  roundRect(g, px - 6, 3, 12, 14, 3); g.fill(); g.fillStyle = '#161618'; g.fillRect(px - 0.75, 7, 1.5, 7);
}
function layoutRowsLight() { if (!rows.length) layoutRows(); }

function drawRuler(g) {
  g.fillStyle = '#1c1c1e'; g.fillRect(0, 0, W, RULER);
  g.fillStyle = '#2c2c2f'; g.fillRect(0, RULER - 1, W, 1);
  const fps = store.fps;
  const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  let major = steps.find((s) => s * tl.zoom >= 90) || 600;
  const minor = major / (major >= 1 ? 5 : 2);
  const t0 = Math.floor(x2t(0) / minor) * minor;
  g.font = '10.5px Consolas, monospace'; g.textBaseline = 'top';
  for (let t = t0; t < x2t(W) + minor; t += minor) {
    const x = Math.round(t2x(t)) + 0.5;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    g.fillStyle = isMajor ? '#5d6577' : '#363c4a';
    g.fillRect(x, isMajor ? 14 : 21, 1, isMajor ? 15 : 8);
    if (isMajor && t >= 0) { g.fillStyle = '#8a92a4'; g.fillText(major < 1 ? tc(t, fps) : tc(t, fps).slice(0, 8), x + 4, 4); }
  }
  const P = store.p;
  if (P.inPoint != null) { const x = t2x(P.inPoint); g.fillStyle = '#1ec8d4'; g.fillRect(x, 0, 2, RULER); g.fillText('IN', x + 4, 17); }
  if (P.outPoint != null) { const x = t2x(P.outPoint); g.fillStyle = '#1ec8d4'; g.fillRect(x - 2, 0, 2, RULER); g.fillText('OUT', x - 26, 17); }
  for (const m of P.markers) {
    const x = t2x(m.t); g.fillStyle = m.color || '#ffb547';
    g.beginPath(); g.moveTo(x - 5, 18); g.lineTo(x + 5, 18); g.lineTo(x + 5, 25); g.lineTo(x, 29); g.lineTo(x - 5, 25); g.closePath(); g.fill();
    if (m.name) { g.fillStyle = '#ffd9a0'; g.fillText(m.name, x + 7, 18); }
  }
}

function drawClip(g, c, r) {
  const x0 = t2x(c.start), x1 = t2x(clipEnd(c));
  const y = r.y + 2, h = r.h - 5, w = Math.max(2, x1 - x0);
  const sel = store.selection.has(c.id);
  const col = c.color || COLORS[c.type] || '#555';
  const disabled = c.disabled || c.muted;
  g.save();
  roundRect(g, x0, y, w, h, 5); g.clip();
  g.fillStyle = shade(col, disabled ? -0.55 : -0.25); g.fillRect(x0, y, w, h);
  // filmstrip
  const m = c.mediaId ? store.media(c.mediaId) : null;
  if (settings.showFilmstrip && m && (c.type === 'video' || c.type === 'image')) {
    const im = stripImages.get(m.id); const th = thumbs.get(m.id);
    if (im && im.complete && im.naturalWidth && th) {
      const tw = (h - 14) * 16 / 9, n = th.count || 1;
      const start = Math.max(x0, 0), end = Math.min(x1, W);
      for (let x = x0 + Math.floor((start - x0) / tw) * tw; x < end; x += tw) {
        const lt = (x - x0) / tl.zoom;
        const src = m.type === 'image' ? 0 : clamp(Math.floor(((c.reverse ? c.in + sourceLength(c) - lt * (c.speed || 1) : c.in + lt * (c.speed || 1)) / Math.max(0.01, m.duration)) * n), 0, n - 1);
        g.globalAlpha = disabled ? 0.3 : 0.85;
        g.drawImage(im, src * 96, 0, 96, 54, x, y + 14, tw, h - 14);
      }
      g.globalAlpha = 1;
    }
  }
  // waveform
  if (settings.showWaveforms && m && c.type === 'audio') {
    const pk = peaks.get(m.id);
    if (pk) {
      g.fillStyle = disabled ? '#2c5a4a' : '#5ff0bd';
      const mid = y + h / 2 + 5, amp = (h - 16) / 2;
      const vol = typeof c.volume === 'number' ? c.volume : 1;
      const a = Math.max(x0, 0), b = Math.min(x1, W);
      for (let x = a; x < b; x += 2) {
        const lt = (x - x0) / tl.zoom;
        const st = c.reverse ? c.in + sourceLength(c) - lt * (c.speed || 1) : c.in + lt * (c.speed || 1);
        const i = Math.floor(st * 100);
        let v = 0; for (let k = 0; k < 3; k++) v = Math.max(v, pk[i + k] || 0);
        v = Math.min(1, v * vol);
        g.fillRect(x, mid - v * amp, 1.5, v * amp * 2);
      }
    }
  }
  if (c.type === 'text') { g.fillStyle = '#ffffffcc'; g.font = `700 ${Math.min(16, h - 18)}px Segoe UI`; g.fillText('T  ' + (c.text?.content || '').replace(/\n/g, ' '), x0 + 8, y + h - 8); }
  if (c.type === 'solid') { g.fillStyle = c.solid?.color || '#000'; g.fillRect(x0 + 6, y + 18, 22, h - 24); }
  // header bar
  g.fillStyle = shade(col, disabled ? -0.4 : 0); g.fillRect(x0, y, w, 14);
  g.fillStyle = '#fff'; g.font = '600 10.5px Segoe UI'; g.textBaseline = 'middle';
  let label = c.name || c.type;
  const badges = [];
  if (c.ramp) badges.push('⚡'); else if (c.speed !== 1) badges.push(c.speed.toFixed(2).replace(/\.?0+$/, '') + 'x');
  if (c.reverse) badges.push('◀◀'); if (c.freeze) badges.push('❄');
  if (c.effects?.length) badges.push('fx' + c.effects.length);
  if (c.linkId) badges.push('🔗');
  g.fillText((badges.length ? badges.join(' ') + '  ' : '') + label, x0 + 5, y + 7.5);
  // intro / outro transitions
  for (const [t, atStart] of [[c.tIn, true], [c.tOut, false]]) {
    if (!t?.type) continue;
    const w2 = Math.max(6, t.dur * tl.zoom); const xs = atStart ? x0 : x1 - w2;
    g.fillStyle = 'rgba(255,181,71,0.85)'; g.fillRect(xs, y + h - 9, w2, 7);
    g.fillStyle = '#111'; g.font = '700 8px Segoe UI'; if (w2 > 26) g.fillText(atStart ? '▶ IN' : 'OUT ◀', xs + 3, y + h - 5);
  }
  // fades
  g.fillStyle = 'rgba(0,0,0,0.45)';
  if (c.fadeIn > 0) { const fx = c.fadeIn * tl.zoom; g.beginPath(); g.moveTo(x0, y + 14); g.lineTo(x0 + fx, y + 14); g.lineTo(x0, y + h); g.closePath(); g.fill(); }
  if (c.fadeOut > 0) { const fx = c.fadeOut * tl.zoom; g.beginPath(); g.moveTo(x1, y + 14); g.lineTo(x1 - fx, y + 14); g.lineTo(x1, y + h); g.closePath(); g.fill(); }
  // keyframes of selected clip
  if (sel) {
    const times = new Set();
    for (const v of Object.values(c.transform)) if (isKf(v)) v.kf.forEach((k) => times.add(k.t));
    for (const f of c.effects) for (const v of Object.values(f.params)) if (isKf(v)) v.kf.forEach((k) => times.add(k.t));
    if (isKf(c.volume)) c.volume.kf.forEach((k) => times.add(k.t));
    g.fillStyle = '#ffb547';
    for (const t of times) { const kx = x0 + t * tl.zoom; g.save(); g.translate(kx, y + h - 6); g.rotate(Math.PI / 4); g.fillRect(-3, -3, 6, 6); g.restore(); }
  }
  g.restore();
  // border
  g.lineWidth = sel ? 2 : 1;
  g.strokeStyle = sel ? '#ffffff' : shade(col, 0.15);
  roundRect(g, x0 + 0.5, y + 0.5, w - 1, h - 1, 5); g.stroke();
  // fade handles when hovered
  if (tl.hover?.clip === c) {
    g.fillStyle = '#fff';
    const fi = t2x(c.start + (c.fadeIn || 0)), fo = t2x(clipEnd(c) - (c.fadeOut || 0));
    g.beginPath(); g.arc(fi, y + 7, 3.5, 0, 7); g.fill(); g.beginPath(); g.arc(fo, y + 7, 3.5, 0, 7); g.fill();
  }
}
function roundRect(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// ------------------------------------------------------------------ interaction
function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

function onHover(e) {
  if (tl.drag) return;
  const { x, y } = pos(e);
  const hit = y > RULER ? clipAt(x, y) : null;
  const th = y > RULER ? transitionAt(x, y) : null;
  tl.hover = { x, y, clip: hit?.clip };
  const ht = th?.tr.id || null; if (ht !== tl.hoverTr) { tl.hoverTr = ht; draw(); }
  let cur = 'default';
  if (y < RULER) cur = 'col-resize';
  else if (tl.tool === 'razor') cur = 'crosshair';
  else if (th) cur = th.part === 'body' ? 'pointer' : 'ew-resize';
  else if (hit?.clip) cur = hit.part === 'left' || hit.part === 'right' ? 'ew-resize' : hit.part.startsWith('fade') ? 'col-resize' : 'grab';
  canvas.style.cursor = cur;
  draw();
}

function onDown(e) {
  canvas.focus();
  if (e.button === 1) { startPan(e); return; }
  if (e.button !== 0) return;
  const { x, y } = pos(e);
  if (y < RULER) { // scrub
    engine.pause();
    const scrub = (ev) => { const p = pos(ev); let t = Math.max(0, x2t(p.x)); if (settings.snapping && ev.shiftKey) t = snap(t, new Set()).t; engine.seek(frame(t)); engine.scrubAudio(store.time); };
    scrub(e);
    window.addEventListener('mousemove', scrub);
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', scrub), { once: true });
    return;
  }
  const th = transitionAt(x, y);
  if (th && tl.tool !== 'razor') {
    store.selTransition = th.tr.id; store.selection.clear(); bus.emit('selection');
    if (th.part !== 'body') {
      store.begin('Übergang Dauer');
      tl.drag = { type: 'trdur', tr: th.tr, cut: th.cut, side: th.part };
      bindDrag();
    }
    return;
  }
  const hit = clipAt(x, y);
  const row = hit?.row;
  if (row) { if (row.track.kind === 'video') tl.targetVideo = row.track.id; else tl.targetAudio = row.track.id; renderHeaders(); }
  if (!hit?.clip) {
    if (!e.ctrlKey && !e.shiftKey) store.select([]);
    tl.drag = { type: 'marquee', x0: x, y0: y, x1: x, y1: y, base: new Set(store.selection) };
    bindDrag(); return;
  }
  const c = hit.clip;
  if (store.track(c.trackId)?.locked) { toast(L('Spur ist gesperrt', 'Track is locked')); return; }
  if (tl.tool === 'razor') {
    const t = frame(x2t(x));
    store.edit('Schneiden', (p) => { const ids = new Set([c.id, ...(tl.linkedSel && !e.altKey ? store.linked(c).map((l) => l.id) : [])]); splitAt(p, t, ids); });
    if (!e.shiftKey) setTool('select');
    return;
  }
  // selection
  const linked = tl.linkedSel && !e.altKey ? store.linked(c).map((l) => l.id) : [];
  if (e.ctrlKey || e.shiftKey) {
    if (store.selection.has(c.id)) { store.selection.delete(c.id); linked.forEach((i) => store.selection.delete(i)); bus.emit('selection'); }
    else store.select([c.id, ...linked], true);
  } else if (!store.selection.has(c.id)) store.select([c.id, ...linked]);
  else { store.selection.delete(c.id); store.selection.add(c.id); bus.emit('selection'); } // make primary
  const t = x2t(x);
  if (hit.part === 'left' || hit.part === 'right') {
    store.begin('Trimmen');
    const targets = [c, ...(tl.linkedSel && !e.altKey ? store.linked(c) : [])].map((cc) => ({ c: cc, orig: JSON.parse(JSON.stringify(cc)) }));
    tl.drag = { type: 'trim', side: hit.part, clip: c, t0: t, targets, ripple: e.ctrlKey || (settings.magnet && isMain(c.trackId)) };
  } else if (hit.part === 'fadeIn' || hit.part === 'fadeOut') {
    store.begin('Fade');
    tl.drag = { type: hit.part, clip: c };
  } else {
    store.begin('Verschieben');
    const sel = store.selectedClips().filter((s) => !store.track(s.trackId)?.locked);
    tl.drag = { type: 'move', clip: c, t0: t, y0: y, started: false, items: sel.map((s) => ({ c: s, start: s.start, trackId: s.trackId })), alt: e.altKey };
  }
  bindDrag();
}
const isMain = (trackId) => store.p.tracks.find((t) => t.kind === 'video')?.id === trackId;

function bindDrag() {
  const mv = (ev) => onDragMove(ev);
  const up = (ev) => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); onDragEnd(ev); };
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
}
function onDragMove(e) {
  const d = tl.drag; if (!d) return;
  const { x, y } = pos(e);
  const P = store.p;
  if (d.type === 'marquee') {
    d.x1 = x; d.y1 = y;
    const ta = x2t(Math.min(d.x0, d.x1)), tb = x2t(Math.max(d.x0, d.x1));
    const ya = Math.min(d.y0, d.y1), yb = Math.max(d.y0, d.y1);
    store.selection = new Set(d.base);
    for (const c of P.clips) { const r = rowOf(c.trackId); if (!r) continue; if (c.start < tb && clipEnd(c) > ta && r.y < yb && r.y + r.h > ya) store.selection.add(c.id); }
    bus.emit('selection'); draw(); return;
  }
  if (d.type === 'move') {
    if (!d.started && Math.abs(x2t(x) - d.t0) * tl.zoom < 3 && Math.abs(y - d.y0) < 4) return;
    d.started = true;
    let dt = x2t(x) - d.t0;
    const ids = new Set(d.items.map((i) => i.c.id));
    // snap leading clip start/end
    const lead = d.items.find((i) => i.c.id === d.clip.id);
    const sn = snap(lead.start + dt, ids, [d.clip.dur]);
    dt = sn.t - lead.start; tl.snapLine = sn.line;
    const minStart = Math.min(...d.items.map((i) => i.start));
    if (minStart + dt < 0) dt = -minStart;
    dt = frame(dt);
    // vertical track change (same kind only, keep relative offsets)
    const r = rowAt(y);
    let trackShift = 0;
    if (r && !d.alt) {
      const kind = d.clip.type === 'audio' ? 'audio' : 'video';
      if (r.track.kind === kind) {
        const list = P.tracks.filter((t) => t.kind === kind);
        trackShift = list.indexOf(r.track) - list.findIndex((t) => t.id === d.items.find((i) => i.c.id === d.clip.id).trackId);
      }
    }
    for (const it of d.items) {
      it.c.start = it.start + dt;
      const kind = it.c.type === 'audio' ? 'audio' : 'video';
      const list = P.tracks.filter((t) => t.kind === kind);
      const leadKind = d.clip.type === 'audio' ? 'audio' : 'video';
      if (kind === leadKind && trackShift) {
        const idx = clamp(list.findIndex((t) => t.id === it.trackId) + trackShift, 0, list.length - 1);
        it.c.trackId = list[idx].id;
      } else it.c.trackId = it.trackId;
    }
    store.touch(); draw(); return;
  }
  if (d.type === 'trim') {
    let t = x2t(x);
    const sn = snap(t, new Set(d.targets.map((x) => x.c.id))); t = frame(sn.t); tl.snapLine = sn.line;
    for (const tg of d.targets) {
      Object.assign(tg.c, JSON.parse(JSON.stringify(tg.orig)));
      const c = tg.c, m = c.mediaId ? store.media(c.mediaId) : null;
      if (d.side === 'right') {
        let nd = Math.max(1 / store.fps, t - c.start);
        nd = Math.min(nd, maxDurFor(c, m));
        if (!d.ripple) { const next = P.clips.filter((o) => o.trackId === c.trackId && o.id !== c.id && o.start >= tg.orig.start + tg.orig.dur - 1e-4 && !d.targets.some((x) => x.c.id === o.id)).sort((a, b) => a.start - b.start)[0]; if (next) nd = Math.min(nd, next.start - c.start); }
        const delta = nd - c.dur;
        trimClipEnd(P, c, nd);
        if (d.ripple) shiftAfter(P, c.trackId, tg.orig.start + tg.orig.dur, delta, d.targets, tg);
      } else {
        let delta = t - c.start; // positive = shorten
        if (!c.reverse && m && m.type !== 'image' && !c.freeze) delta = Math.max(delta, -c.in / (c.ramp ? 1 : c.speed));
        if (!d.ripple) { const prev = P.clips.filter((o) => o.trackId === c.trackId && o.id !== c.id && clipEnd(o) <= tg.orig.start + 1e-4 && !d.targets.some((x) => x.c.id === o.id)).sort((a, b) => clipEnd(b) - clipEnd(a))[0]; if (prev) delta = Math.max(delta, prev.start + prev.dur - c.start); else delta = Math.max(delta, -c.start); }
        delta = Math.min(delta, c.dur - 1 / store.fps);
        trimClipStart(P, c, delta);
        if (d.ripple) { const s = c.start; c.start = tg.orig.start; shiftAfter(P, c.trackId, tg.orig.start + tg.orig.dur, -(s - tg.orig.start), d.targets, tg); }
      }
    }
    store.touch(); draw(); return;
  }
  if (d.type === 'fadeIn' || d.type === 'fadeOut') {
    const c = d.clip, t = x2t(x);
    if (d.type === 'fadeIn') c.fadeIn = clamp(frame(t - c.start), 0, c.dur - (c.fadeOut || 0));
    else c.fadeOut = clamp(frame(clipEnd(c) - t), 0, c.dur - (c.fadeIn || 0));
    for (const l of tl.linkedSel ? store.linked(c) : []) { l.fadeIn = c.fadeIn; l.fadeOut = c.fadeOut; }
    store.touch(); draw(); return;
  }
  if (d.type === 'trdur') {
    const t = x2t(x); const a = store.clip(d.tr.a), b = store.clip(d.tr.b);
    if (d.tr.overlap) {
      const want = d.side === 'left' ? clipEnd(a) - t : t - b.start;
      setTransitionOverlap(store.p, d.tr, frame(want));
      tl.dragInfo = d.tr.dur.toFixed(2) + ' s';
    } else d.tr.dur = clamp(frame(Math.abs(t - d.cut) * 2), 2 / store.fps, Math.min(a.dur, b.dur));
    store.touch(); draw();
  }
}
function shiftAfter(P, trackId, after, delta, targets, tg) {
  for (const o of P.clips) {
    if (targets.some((x) => x.c.id === o.id)) continue;
    const linkedToTarget = o.linkId && targets.some((x) => x.c.linkId === o.linkId);
    if ((o.trackId === trackId || linkedToTarget) && (o._origStart ?? o.start) >= after - 1e-4) {
      if (o._origStart === undefined) o._origStart = o.start;
      o.start = o._origStart + delta;
    }
  }
}
function onDragEnd() {
  const d = tl.drag; tl.drag = null; tl.snapLine = null;
  if (!d) return;
  const P = store.p;
  P.clips.forEach((c) => delete c._origStart);
  if (d.type === 'move' && d.started) {
    // overwrite: clear destination ranges for each moved clip
    const ids = new Set(d.items.map((i) => i.c.id));
    for (const it of d.items) clearRange(P, it.c.trackId, it.c.start, clipEnd(it.c), ids);
    if (settings.magnet) { const main = P.tracks.find((t) => t.kind === 'video'); if (d.items.some((i) => i.trackId === main.id || i.c.trackId === main.id)) rippleTrack(P, main.id); }
    dropBrokenTransitions(P);
  }
  if (d.type === 'move' && !d.started) { store.cancel(); draw(); return; }
  store.end();
  draw();
}

function startPan(e) {
  const sx = e.clientX, sy = e.clientY, ox = tl.scrollX, oy = tl.scrollY;
  const mv = (ev) => { tl.scrollX = Math.max(0, ox - (ev.clientX - sx)); tl.scrollY = clamp(oy - (ev.clientY - sy), 0, Math.max(0, tl.contentH - H + RULER)); layoutRows(); draw(); renderHeaders(); };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mv), { once: true });
}

function onWheel(e) {
  e.preventDefault();
  const { x } = pos(e);
  if (e.ctrlKey || e.altKey || pos(e).y < RULER) {
    const t = x2t(x);
    tl.zoom = clamp(tl.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 1, 6000);
    tl.scrollX = Math.max(0, t * tl.zoom - x);
  } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    tl.scrollX = Math.max(0, tl.scrollX + (e.deltaX || e.deltaY));
  } else {
    tl.scrollY = clamp(tl.scrollY + e.deltaY * 0.6, 0, Math.max(0, tl.contentH - H + RULER));
  }
  layoutRows(); draw(); renderHeaders(); syncZoomSlider();
}

function onDbl(e) {
  const { x, y } = pos(e);
  const hit = clipAt(x, y);
  if (hit?.clip?.seqId) { run('openCompound'); return; }
  if (hit?.clip) bus.emit('inspect', hit.clip.id, hit.clip.type === 'text' ? 'text' : null);
}

function onContext(e) {
  e.preventDefault();
  const { x, y } = pos(e);
  const th = transitionAt(x, y);
  if (th) {
    store.selTransition = th.tr.id; bus.emit('selection');
    contextMenu(e.clientX, e.clientY, [
      { label: L('Übergang löschen', 'Delete transition'), action: () => store.edit('Übergang löschen', (p) => { p.transitions = p.transitions.filter((t) => t.id !== th.tr.id); }) },
      { label: L('Typ ändern', 'Change type'), sub: Object.values(TRANSITIONS).slice(0, 40).map((d) => ({ label: N(d.name), action: () => store.edit('Übergang', () => { th.tr.type = d.id; }) })) },
    ]);
    return;
  }
  const hit = clipAt(x, y);
  const t = x2t(x);
  if (!hit?.clip) {
    contextMenu(e.clientX, e.clientY, [
      { label: L('Einfügen', 'Paste'), key: keyOf('paste'), action: () => run('paste') },
      { label: L('Lücke schließen', 'Close gap'), action: () => closeGapAt(hit?.row?.track, t) },
      { label: L('Alle Lücken schließen', 'Close all gaps'), action: () => run('closeGaps') },
      '-',
      { label: L('Text hier einfügen', 'Add text here'), action: () => store.edit('Text', (p) => { const c = addTextClip(p, frame(t)); store.select([c.id]); }) },
      { label: L('Marker hinzufügen', 'Add marker'), action: () => store.edit('Marker', (p) => p.markers.push({ id: uid('mk'), t: frame(t), name: '', color: '#ffb547' })) },
      { label: L('Videospur hinzufügen', 'Add video track'), action: () => run('addVideoTrack') },
      { label: L('Audiospur hinzufügen', 'Add audio track'), action: () => run('addAudioTrack') },
    ]);
    return;
  }
  const c = hit.clip;
  if (!store.selection.has(c.id)) store.select([c.id, ...(tl.linkedSel ? store.linked(c).map((l) => l.id) : [])]);
  contextMenu(e.clientX, e.clientY, clipMenu(c, t));
}

export function clipMenu(c, t) {
  const fx = (id) => ({ label: N(EFFECTS[id].name), action: () => run('applyEffect', { type: id }) });
  return [
    { label: L('Am Playhead teilen', 'Split at playhead'), key: keyOf('split'), action: () => run('split') },
    { label: L('Hier teilen', 'Split here'), action: () => store.edit('Schneiden', (p) => splitAt(p, frame(t), new Set(store.selection))) },
    { label: L('Ausschneiden', 'Cut'), key: keyOf('cut'), action: () => run('cut') },
    { label: L('Kopieren', 'Copy'), key: keyOf('copy'), action: () => run('copy') },
    { label: L('Duplizieren', 'Duplicate'), key: keyOf('duplicate'), action: () => run('duplicate') },
    { label: L('Löschen', 'Delete'), key: keyOf('delete'), action: () => run('delete') },
    { label: L('Ripple-Löschen', 'Ripple delete'), key: keyOf('rippleDelete'), action: () => run('rippleDelete') },
    '-',
    { label: L('Geschwindigkeit', 'Speed'), sub: [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8].map((s) => ({ label: s + 'x', check: c.speed === s && !c.ramp, action: () => run('setSpeed', { speed: s }) })) },
    { label: L('Velocity / Speed Ramp', 'Velocity / Speed ramp'), sub: velocityMenu() },
    { label: L('Rückwärts', 'Reverse'), check: !!c.reverse, action: () => run('reverse') },
    { label: L('Standbild einfügen', 'Freeze frame'), key: keyOf('freezeFrame'), action: () => run('freezeFrame') },
    { label: L('Audio trennen', 'Detach audio'), action: () => run('unlink') },
    { label: c.linkId ? L('Verknüpfung lösen', 'Unlink') : L('Verknüpfen', 'Link'), action: () => run(c.linkId ? 'unlink' : 'link') },
    { label: c.muted ? L('Aktivieren', 'Enable') : L('Deaktivieren', 'Disable'), key: keyOf('toggleClipEnabled'), action: () => run('toggleClipEnabled') },
    '-',
    { label: L('Übergang hinzufügen', 'Add transition'), key: keyOf('addTransition'), action: () => run('addTransition') },
    { label: L('Start-Übergang', 'Intro transition'), sub: [['dipblack', L('Aus Schwarz', 'From black')], ['dissolve', L('Einblenden', 'Fade in')], ['zoomin', 'Zoom In'], ['glitch', 'Glitch'], ['flash', 'Flash'], ['whippan', 'Whip Pan'], ['shape_in_circle', L('Kreis öffnen', 'Circle open')], ['blur', 'Blur'], ['none', L('Entfernen', 'Remove')]].map(([id, nm]) => ({ label: nm, action: () => run('setClipTransition', { edge: 'in', type: id }) })) },
    { label: L('End-Übergang', 'Outro transition'), sub: [['dipblack', L('Zu Schwarz', 'To black')], ['dissolve', L('Ausblenden', 'Fade out')], ['zoomout', 'Zoom Out'], ['glitch', 'Glitch'], ['flash', 'Flash'], ['whippan', 'Whip Pan'], ['shape_out_circle', L('Kreis schließen', 'Circle close')], ['blur', 'Blur'], ['none', L('Entfernen', 'Remove')]].map(([id, nm]) => ({ label: nm, action: () => run('setClipTransition', { edge: 'out', type: id }) })) },
    { label: L('Ein-/Ausblenden', 'Fade in/out'), action: () => run('fadeInOut') },
    { label: L('Effekt', 'Effect'), sub: ['realism', 'color', 'glow', 'shake', 'motionblur', 'rgbsplit', 'glitch', 'gaussian', 'zoompulse', 'chromakey', 'vignette', 'letterbox'].map(fx) },
    { label: L('Bild füllen', 'Fill frame'), action: () => run('fillFrame') },
    { label: L('Bild einpassen', 'Fit frame'), action: () => run('fitFrame') },
    '-',
    { label: L('Szenen erkennen & schneiden', 'Detect scenes & split'), action: () => run('aiSceneDetect') },
    { label: L('Stille entfernen', 'Remove silence'), action: () => run('aiRemoveSilence') },
    { label: L('Stabilisieren', 'Stabilize'), action: () => run('aiStabilize') },
    { label: L('Proxy erstellen', 'Create proxy'), action: () => run('createProxy') },
    '-',
    { label: L('Verschachteln (Compound)', 'Nest (compound)'), key: keyOf('makeCompound'), action: () => run('makeCompound') },
    c.seqId ? { label: L('Verschachtelten Clip öffnen', 'Open nested clip'), action: () => run('openCompound') } : null,
    { label: L('Multicam aus Auswahl', 'Multicam from selection'), action: () => run('makeMulticam') },
    c.type === 'multicam' ? { label: L('Kamera', 'Angle'), sub: [0, 1, 2, 3, 4, 5].map((i) => ({ label: L('Kamera ', 'Angle ') + (i + 1), check: (c.angle || 0) === i, action: () => store.edit('Kamera', () => { c.angle = i; }) })) } : null,
    { label: L('Clipfarbe', 'Clip color'), sub: ['#3d6bd6', '#1f9e74', '#b8569e', '#d0743c', '#c9b037', '#7c5cff', '#e04f5f', null].map((col) => ({ label: col || L('Standard', 'Default'), action: () => store.edit('Farbe', () => store.selectedClips().forEach((s) => (s.color = col))) })) },
  ];
}
function velocityMenu() {
  return [['montage', 'Montage'], ['hero', 'Hero'], ['bullet', 'Bullet'], ['jumpcut', 'Jump Cut'], ['flashIn', 'Flash In'], ['flashOut', 'Flash Out'], ['smooth', 'Smooth'], ['velocityEdit', 'Velocity Edit'], ['none', L('Keine', 'None')]]
    .map(([id, n]) => ({ label: n, action: () => run('velocityPreset', { preset: id }) }));
}

export function closeGapAt(track, t) {
  if (!track) return;
  store.edit('Lücke schließen', (p) => {
    const cs = p.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
    const prevEnd = cs.filter((c) => clipEnd(c) <= t + 1e-4).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const next = cs.find((c) => c.start >= t - 1e-4); if (!next) return;
    const gap = next.start - prevEnd; if (gap <= 0) return;
    for (const c of p.clips) if (c.start >= next.start - 1e-4) c.start -= gap;
    dropBrokenTransitions(p);
  });
}

// ------------------------------------------------------------------ drag & drop
function dragPayload(e) {
  const types = e.dataTransfer.types;
  if (types.includes('velox/media')) return 'media';
  if (types.includes('velox/effect')) return 'effect';
  if (types.includes('velox/transition')) return 'transition';
  if (types.includes('velox/text')) return 'text';
  if (types.includes('velox/preset')) return 'preset';
  if (types.includes('velox/files')) return 'vfiles';
  if (types.includes('velox/folder')) return 'vfolder';
  if (types.includes('Files')) return 'files';
  return null;
}
function onDragOver(e) {
  const kind = dragPayload(e); if (!kind) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const { x, y } = pos(e);
  const r = rowAt(y);
  if ((kind === 'media' || kind === 'text' || kind === 'vfiles' || kind === 'vfolder' || kind === 'files') && r) {
    const dur = window.__dragMedia?.type === 'image' || kind === 'text' ? settings.defaultStillDur : (window.__dragMedia?.duration || 3);
    const sn = snap(Math.max(0, x2t(x)), new Set(), [dur]);
    tl.dropGhost = { trackId: r.track.id, t: frame(sn.t), dur }; tl.snapLine = sn.line;
  } else tl.dropGhost = null;
  draw();
}
async function onDrop(e) {
  const kind = dragPayload(e); if (!kind) return;
  e.preventDefault();
  const { x, y } = pos(e);
  const ghost = tl.dropGhost; tl.dropGhost = null; tl.snapLine = null;
  const r = rowAt(y);
  const t = ghost ? ghost.t : frame(Math.max(0, x2t(x)));
  if (kind === 'vfiles' || kind === 'vfolder') {
    let ms;
    if (kind === 'vfolder') { const { importFolder } = await import('./pcbrowser.js'); ms = await importFolder(e.dataTransfer.getData('velox/folder'), { recursive: true }); }
    else ms = await importFiles(JSON.parse(e.dataTransfer.getData('velox/files')));
    store.edit('Einfügen', (p) => { let tt = t; const out = []; for (const m of ms) { const cs = placeMedia(p, m, tt, trackOpts(r, m)); out.push(...cs); tt += cs[0]?.dur || 0; } store.select(out.map((c) => c.id)); });
    return;
  }
  if (kind === 'files') {
    const { webUtils } = require('electron'); const files = [...e.dataTransfer.files].map((f) => { try { return webUtils.getPathForFile(f); } catch { return f.path; } }).filter(Boolean);
    const ms = await importFiles(files);
    store.edit('Einfügen', (p) => { let tt = t; for (const m of ms) { const cs = placeMedia(p, m, tt, trackOpts(r, m)); tt += cs[0]?.dur || 0; } });
    return;
  }
  if (kind === 'media') {
    const ids = JSON.parse(e.dataTransfer.getData('velox/media'));
    store.edit('Einfügen', (p) => {
      let tt = t; const created = [];
      const rg = window.__dragRange; window.__dragRange = null;
      for (const id of ids) { const m = store.media(id); if (!m) continue; const cs = placeMedia(p, m, tt, { ...trackOpts(r, m), ...(rg ? { inPoint: rg.in, outPoint: rg.out } : {}) }); created.push(...cs); tt += cs[0]?.dur || 0; }
      if (settings.magnet) rippleTrack(p, p.tracks.find((tr) => tr.kind === 'video').id);
      store.select(created.map((c) => c.id));
    });
    return;
  }
  if (kind === 'text') {
    const props = JSON.parse(e.dataTransfer.getData('velox/text'));
    store.edit('Text', (p) => { const c = addTextClip(p, t, props.text || props, props.dur || 3, r?.track.kind === 'video' && !p.clips.some((c) => c.trackId === r.track.id && c.start < t + 3 && clipEnd(c) > t) ? r.track.id : null); store.select([c.id]); });
    return;
  }
  const hit = clipAt(x, y);
  if (kind === 'effect') {
    const type = e.dataTransfer.getData('velox/effect');
    const target = hit?.clip || null;
    if (!target) { run('addAdjustmentWithEffect', { type, t }); return; }
    store.select([target.id]);
    run('applyEffect', { type, clipIds: [target.id] });
    return;
  }
  if (kind === 'preset') {
    const id = e.dataTransfer.getData('velox/preset');
    if (hit?.clip) { store.select([hit.clip.id]); run('applyPreset', { id }); }
    return;
  }
  if (kind === 'transition') {
    const type = e.dataTransfer.getData('velox/transition');
    if (!r) return;
    // nearest cut on that track
    const cs = store.clipsOn(r.track.id);
    let best = null;
    for (let i = 0; i < cs.length - 1; i++) { const cut = clipEnd(cs[i]); if (Math.abs(cs[i + 1].start - cut) < 1.5 / store.fps) { const d = Math.abs(cut - x2t(x)); if (!best || d < best.d) best = { d, a: cs[i], b: cs[i + 1] }; } }
    const hc = hit?.clip && hit.clip.type !== 'audio' ? hit.clip : null;
    const tx = x2t(x);
    if (best && (best.d < 0.6 || best.d * tl.zoom < 30)) { run('addTransition', { type, a: best.a.id, b: best.b.id }); return; }
    if (hc) { const edge = tx < hc.start + hc.dur / 2 ? 'in' : 'out'; run('setClipTransition', { edge, type, clipIds: [hc.id] }); toast(edge === 'in' ? L('Start-Übergang gesetzt', 'Intro transition set') : L('End-Übergang gesetzt', 'Outro transition set')); return; }
    if (best) { run('addTransition', { type, a: best.a.id, b: best.b.id }); return; }
    toast(L('Übergang auf einen Clip (Anfang/Ende) oder einen Schnitt ziehen', 'Drop a transition on a clip (start/end) or a cut'));
  }
}
function trackOpts(r, m) {
  const o = {};
  if (r?.track.kind === 'video') { o.videoTrackId = r.track.id; o.audioTrackId = tl.targetAudio; }
  else if (r?.track.kind === 'audio') { o.audioTrackId = r.track.id; o.videoTrackId = tl.targetVideo; }
  else { o.videoTrackId = tl.targetVideo; o.audioTrackId = tl.targetAudio; }
  return o;
}

// ------------------------------------------------------------------ follow playhead / zoom
function followPlayhead() {
  if (!engine.playing) return;
  const x = t2x(store.time);
  if (x > W - 40) { tl.scrollX += W * 0.7; layoutRows(); }
  else if (x < 0) { tl.scrollX = Math.max(0, store.time * tl.zoom - 40); layoutRows(); }
}
export function zoomBy(f) { const t = store.time; const x = t2x(t); tl.zoom = clamp(tl.zoom * f, 1, 6000); tl.scrollX = Math.max(0, t * tl.zoom - x); layoutRows(); draw(); }
export function syncZoomSlider() { if (tl._zoomSlider) tl._zoomSlider.value = Math.round((Math.log(tl.zoom) / Math.log(6000)) * 100); }
export function zoomFit() { const d = Math.max(5, store.duration()); tl.zoom = clamp((W - 40) / d, 2, 2000); tl.scrollX = 0; layoutRows(); draw(); }
export function setTool(t) { tl.tool = t; buildToolbar(); draw(); }

// ------------------------------------------------------------------ track headers
export function renderHeaders() {
  const host = $('#tl-headers-tracks'); if (!host) return;
  host.innerHTML = '';
  for (const r of rows) {
    const t = r.track;
    const head = el('div', { class: `trk-head ${t.kind}${t.id === tl.targetVideo || t.id === tl.targetAudio ? ' target' : ''}`, style: { top: r.y - RULER + 'px', height: r.h + 'px' } },
      el('span', { class: 'nm', title: L('Doppelklick: Umbenennen', 'Double-click: rename'), ondblclick: async () => { const { promptBox } = await import('./dialogs.js'); const n = await promptBox(L('Spurname', 'Track name'), t.name); if (n) store.edit('Spur', () => { t.name = n; }); },
        onclick: () => { if (t.kind === 'video') tl.targetVideo = t.id; else tl.targetAudio = t.id; renderHeaders(); draw(); } }, t.name),
      t.kind === 'video' ? el('button', { class: 'icon-btn tb' + (t.hidden ? ' on' : ''), title: L('Ausblenden', 'Hide'), onclick: () => store.edit('Spur', () => { t.hidden = !t.hidden; }) }, t.hidden ? '◌' : '◉')
        : el('button', { class: 'icon-btn tb' + (t.solo ? ' on' : ''), title: 'Solo', onclick: () => store.edit('Spur', () => { t.solo = !t.solo; }) }, 'S'),
      el('button', { class: 'icon-btn tb' + (t.muted ? ' on' : ''), title: L('Stumm', 'Mute'), onclick: () => store.edit('Spur', () => { t.muted = !t.muted; }) }, 'M'),
      el('button', { class: 'icon-btn tb' + (t.locked ? ' on' : ''), title: L('Sperren', 'Lock'), onclick: () => store.edit('Spur', () => { t.locked = !t.locked; }) }, t.locked ? '🔒' : '🔓'),
      el('button', { class: 'icon-btn tb', title: L('Spur-Optionen', 'Track options'), onclick: (e) => trackMenu(e, t) }, '⋯'),
    );
    const grip = el('div', { class: 'trk-grip', title: L('Ziehen: Spurhöhe', 'Drag: track height') });
    grip.addEventListener('mousedown', (e) => { e.preventDefault(); const y0 = e.clientY, h0 = t.height || 58; const mv = (ev) => { t.height = clamp(h0 + (ev.clientY - y0), 26, 220); layoutRows(); draw(); renderHeaders(); }; const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); store.edit('Spurhöhe', () => {}); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); });
    head.appendChild(grip);
    host.appendChild(head);
  }
}
function trackMenu(e, t) {
  contextMenu(e.clientX, e.clientY, [
    { label: L('Höhe: klein', 'Height: small'), action: () => store.edit('Spur', () => { t.height = 36; }) },
    { label: L('Höhe: normal', 'Height: normal'), action: () => store.edit('Spur', () => { t.height = t.kind === 'video' ? 58 : 48; }) },
    { label: L('Höhe: groß', 'Height: large'), action: () => store.edit('Spur', () => { t.height = 96; }) },
    '-',
    { label: L('Spur darüber einfügen', 'Insert track above'), action: () => store.edit('Spur', (p) => { const i = p.tracks.indexOf(t); p.tracks.splice(t.kind === 'video' ? i + 1 : i, 0, newTrack(p, t.kind)); }) },
    { label: L('Spur löschen', 'Delete track'), disabled: store.p.tracks.filter((x) => x.kind === t.kind).length < 2, action: () => store.edit('Spur löschen', (p) => { p.clips.filter((c) => c.trackId === t.id).forEach((c) => removeClip(p, c.id, false)); p.tracks = p.tracks.filter((x) => x.id !== t.id); }) },
    { label: L('Alle Clips auswählen', 'Select all clips'), action: () => store.select(store.clipsOn(t.id).map((c) => c.id)) },
  ]);
}

// ------------------------------------------------------------------ toolbar
function buildToolbar() {
  const bar = $('#tl-toolbar'); if (!bar) return;
  bar.innerHTML = '';
  const b = (label, title, cmd, on = false, cls = '', args) => el('button', { class: 'icon-btn ' + cls + (on ? ' on' : ''), title: title + (keyOf(cmd) ? `  (${keyOf(cmd)})` : ''), onclick: (e) => run(cmd, args || {}).catch(() => {}) }, label);
  const tb = (icon, text, title, cmd, cls = '') => el('button', { class: 'tl-btn ' + cls, title: title + (keyOf(cmd) ? `  (${keyOf(cmd)})` : ''), onclick: (e) => (typeof cmd === 'function' ? cmd(e) : run(cmd).catch(() => {})) }, el('span', { class: 'ico' }, icon), el('span', { class: 'txt' }, text));
  const zoomVal = () => Math.round((Math.log(tl.zoom) / Math.log(6000)) * 100);
  const zoomSlider = el('input', { type: 'range', min: 0, max: 100, value: zoomVal(), style: { width: '140px' }, title: L('Timeline zoomen (Clips breiter ziehen) – auch Strg+Mausrad oder Mausrad über dem Zeitlineal', 'Zoom timeline – also Ctrl+wheel or wheel over the ruler'),
    oninput: (e) => { const t = store.time, x = t2x(t); tl.zoom = Math.max(1, Math.pow(6000, e.target.value / 100)); tl.scrollX = Math.max(0, t * tl.zoom - x); layoutRows(); draw(); } });
  const hSlider = el('input', { type: 'range', min: 30, max: 160, value: store.p.tracks[0]?.height || 58, style: { width: '70px' }, title: L('Spurhöhe', 'Track height'),
    oninput: (e) => { for (const t of store.p.tracks) t.height = +e.target.value * (t.kind === 'audio' ? 0.85 : 1); layoutRows(); draw(); renderHeaders(); }, onchange: () => store.edit('Spurhöhe', () => {}) });
  bar.append(
    b('↶', L('Rückgängig', 'Undo'), 'undo'), b('↷', L('Wiederholen', 'Redo'), 'redo'),
    el('div', { class: 'sep' }),
    tb('✂', L('Schneiden', 'Cut'), L('Am Playhead (roter Strich) schneiden', 'Cut at the playhead (red line)'), 'split', 'accent'),
    tb('⇤', '', L('Anfang bis Playhead wegschneiden', 'Trim start to playhead'), 'trimStart'),
    tb('⇥', '', L('Ende ab Playhead wegschneiden', 'Trim end to playhead'), 'trimEnd'),
    tb('🗑', '', L('Löschen', 'Delete'), 'delete'),
    el('div', { class: 'sep' }),
    tb('⏩', L('Tempo', 'Speed'), L('Schneller / langsamer / rückwärts', 'Faster / slower / reverse'), (e) => speedPopover(e.currentTarget)),
    tb('🔊', L('Audio', 'Audio'), L('Lautstärke, Tonhöhe, Stimm-Effekte', 'Volume, pitch, voice effects'), (e) => import('./audiofx.js').then((m) => m.audioPopover(e.currentTarget))),
    tb('❄', '', L('Standbild', 'Freeze frame'), 'freezeFrame', 'adv'),
    el('div', { class: 'sep' }),
    tb('T', L('Text', 'Text'), L('Text hinzufügen', 'Add text'), 'addText'),
    tb('⧉', L('Übergang', 'Transition'), L('Übergang am Schnitt beim Playhead', 'Transition at the cut near the playhead'), 'addTransition'),
    tb('◆', '', L('Marker', 'Marker'), 'addMarker'),
    el('div', { class: 'sep' }),
    b('🧲', L('Magnetische Hauptspur (Lücken schließen sich)', 'Magnetic main track'), 'toggleMagnet', settings.magnet),
    b('⌖', L('Einrasten', 'Snapping'), 'toggleSnap', settings.snapping),
    b('🔗', L('Video+Audio zusammen auswählen', 'Linked selection'), 'toggleLinkedSel', tl.linkedSel),
    el('div', { class: 'sep' }),
    tb('✨', 'Auto-Edit', L('Automatisch schneiden (KI)', 'Automatic edit (AI)'), 'autoEditDialog', 'accent2'),
    el('div', { class: 'spacer' }),
    b('+V', L('Videospur hinzufügen', 'Add video track'), 'addVideoTrack', false, 'adv'),
    b('+A', L('Audiospur hinzufügen', 'Add audio track'), 'addAudioTrack', false, 'adv'),
    el('span', { class: 'muted', style: { fontSize: '11px' } }, '↕'), hSlider,
    el('span', { class: 'muted', style: { fontSize: '11px', marginLeft: '6px' } }, '🔍'),
    b('−', L('Herauszoomen', 'Zoom out'), 'zoomOut'), zoomSlider, b('+', L('Hineinzoomen (Clips länger ziehen)', 'Zoom in'), 'zoomIn'),
    b('⤢', L('Ganze Timeline zeigen', 'Zoom to fit'), 'zoomFit'),
  );
  tl._zoomSlider = zoomSlider;
  updateFormatLabel();
}
function updateFormatLabel() {
  const h = $('#tl-headers-top'); if (!h) return; const S = store.p.settings;
  const txt = S.width + '×' + S.height + ' · ' + S.fps + ' fps';
  if (h.textContent !== txt) { h.innerHTML = ''; h.append(el('span', { class: 'muted', style: { fontSize: '11px' }, title: L('Seitenverhältnis des Projekts – Exportauflösung wählst du beim Export (bis 8K)', 'Project aspect – export resolution is picked on export (up to 8K)') }, txt)); }
}
bus.on('changed', () => updateFormatLabel());
// ------------------------------------------------------------------ speed popover
export function speedPopover(anchor) {
  document.querySelectorAll('.popover').forEach((p) => p.remove());
  const cs = store.selectedClips().length ? store.selectedClips() : store.p.clips.filter((c) => c.start <= store.time && clipEnd(c) > store.time && (c.type === 'video' || c.type === 'audio'));
  const c = cs.find((x) => x.type === 'video') || cs[0];
  const pop = el('div', { class: 'popover' });
  if (!c) { pop.append(el('div', { class: 'muted' }, L('Playhead auf einen Clip setzen oder Clip anklicken.', 'Put the playhead on a clip or click one.'))); }
  else {
    if (!store.selection.size) store.select([c.id, ...store.linked(c).map((l) => l.id)]);
    const cur = c.ramp ? 1 : c.speed || 1;
    const lab = el('b', { class: 'tc', style: { fontSize: '20px', minWidth: '80px' } }, cur.toFixed(2) + 'x');
    const toS = (v) => Math.pow(10, (v / 100) * 2 - 1); const fromS = (s) => ((Math.log10(s) + 1) / 2) * 100;
    const sl = el('input', { type: 'range', min: 0, max: 100, step: 0.1, value: fromS(cur), style: { width: '260px' } });
    let pending = null;
    sl.oninput = () => { const v = +toS(+sl.value).toFixed(2); lab.textContent = v + 'x'; clearTimeout(pending); pending = setTimeout(() => run('setSpeed', { speed: v }).catch(() => {}), 120); };
    const dur = el('div', { class: 'muted' }, L('Dauer: ', 'Duration: ') + c.dur.toFixed(2) + ' s');
    bus.on('changed', () => { const cc = store.clip(c.id); if (cc) dur.textContent = L('Dauer: ', 'Duration: ') + cc.dur.toFixed(2) + ' s'; });
    pop.append(el('div', { class: 'row' }, el('b', {}, '⏩ ' + L('Tempo', 'Speed')), el('span', { class: 'spacer' }), lab),
      el('div', { class: 'row' }, el('span', { class: 'muted' }, '0.1x'), sl, el('span', { class: 'muted' }, '10x')),
      el('div', { class: 'chips' }, ...[0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, 10].map((v) => el('span', { class: 'chip' + (Math.abs(cur - v) < 0.001 ? ' on' : ''), onclick: () => { run('setSpeed', { speed: v }); sl.value = fromS(v); lab.textContent = v + 'x'; } }, v + 'x'))),
      dur,
      el('div', { class: 'row' },
        el('button', { class: 'btn small', onclick: () => run('reverse') }, '⇆ ' + L('Rückwärts', 'Reverse')),
        el('button', { class: 'btn small', onclick: () => run('freezeFrame') }, '❄ ' + L('Standbild', 'Freeze')),
        el('button', { class: 'btn small', onclick: () => run('aiSlowmo', { factor: 4 }) }, '🐢 ' + L('KI-Zeitlupe', 'AI slow-mo'))),
      el('div', { class: 'chips' }, el('span', { class: 'muted', style: { width: '100%' } }, L('Velocity / Speed-Ramps:', 'Velocity / speed ramps:')), ...['montage', 'hero', 'bullet', 'jumpcut', 'flashIn', 'flashOut', 'smooth', 'velocityEdit', 'none'].map((k) => el('span', { class: 'chip', onclick: () => run('velocityPreset', { preset: k }) }, k === 'none' ? L('Keine', 'None') : k))),
      el('button', { class: 'btn small block', onclick: () => { pop.remove(); bus.emit('inspect', c.id, 'speed'); } }, L('Eigene Speed-Kurve zeichnen…', 'Draw custom speed curve…')));
  }
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(); const pr = pop.getBoundingClientRect();
  pop.style.left = Math.min(innerWidth - pr.width - 8, r.left) + 'px'; pop.style.top = Math.max(8, r.top - pr.height - 8) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }), 0);
}
export { buildToolbar };
export function timelineSize() { return { W, H }; }
export { x2t, t2x };
