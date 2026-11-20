// Censoring & tracked masks: AI face censor (YOLOface, local GPU), object censor / mask that follows
// a region (scale-aware template tracker), on-canvas box editor and the effect-card extras.
import { store, clipEnd, sourceTime, sourceLength } from '../core/project.js';
import { el, bus, clamp, deepClone, uid } from '../core/util.js';
import { L } from '../core/i18n.js';
import { registerCommands, run } from '../core/commands.js';
import { FFMPEG, cacheDir } from '../core/ffmpeg.js';
import { modal, toast, progressModal } from '../ui/dialogs.js';
import { defaultParams } from '../render/effects.js';
import { evalTransform } from '../render/compositor.js';
import { CENSOR_MODES, regionsAt } from '../render/censor.js';
import { evalParam, isKf, setKeyframe } from '../core/keyframes.js';
import { viewer, setTrackRect, drawOverlay } from '../ui/viewer.js';
import { ensureModels, runWorker, modelPath, pickClip } from './neural.js';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------ media <-> project frame mapping
function geo(c, lt) {
  const m = store.media(c.mediaId); const P = store.p.settings;
  const T = evalTransform(c, clamp(lt, 0, c.dur));
  const mw = m.width || 1920, mh = m.height || 1080;
  const fit = Math.min(P.width / mw, P.height / mh), s = T.scale * T.dscale;
  const hw = (mw * fit * s * (T.scaleX ?? 1)) / 2, hh = (mh * fit * s * (T.scaleY ?? 1)) / 2;
  const rz = (((T.rotation || 0) + T.drot) * Math.PI) / 180;
  return { PW: P.width, PH: P.height, hw, hh, cos: Math.cos(rz), sin: Math.sin(rz), tx: (T.x || 0) + T.dx, ty: (T.y || 0) + T.dy, fh: !!T.flipH, fv: !!T.flipV };
}
function mediaToProj(g, u, v) {
  if (g.fh) u = 1 - u; if (g.fv) v = 1 - v;
  const x = -g.hw + 2 * g.hw * u, y = -g.hh + 2 * g.hh * v;
  return [(x * g.cos - y * g.sin + g.tx + g.PW / 2) / g.PW, (x * g.sin + y * g.cos + g.ty + g.PH / 2) / g.PH];
}
function projToMedia(g, px, py) {
  const X = px * g.PW - g.PW / 2 - g.tx, Y = py * g.PH - g.PH / 2 - g.ty;
  const x = X * g.cos + Y * g.sin, y = -X * g.sin + Y * g.cos;
  let u = (x + g.hw) / (2 * g.hw), v = (y + g.hh) / (2 * g.hh);
  if (g.fh) u = 1 - u; if (g.fv) v = 1 - v;
  return [u, v];
}
const sizeToProj = (g, w, h) => [(w * 2 * g.hw) / g.PW, (h * 2 * g.hh) / g.PH];
const sizeToMedia = (g, w, h) => [(w * g.PW) / (2 * g.hw), (h * g.PH) / (2 * g.hh)];
// clip-local time for a media source time (handles speed + reverse; ramps approximated)
const srcToLt = (c, s) => (c.reverse ? c.in + sourceLength(c) - s : s - c.in) / (c.speed || 1);

function videoClip(c) {
  if (c && (c.type === 'video' || c.type === 'image')) return c;
  const t = store.time; const vt = store.p.tracks.filter((x) => x.kind === 'video');
  const idx = c ? vt.findIndex((x) => x.id === c.trackId) : vt.length - 1;
  for (let i = idx; i >= 0; i--) { const v = store.p.clips.find((x) => x.trackId === vt[i].id && (x.type === 'video' || x.type === 'image') && x.start <= t && clipEnd(x) > t); if (v) return v; }
  return null;
}

// ------------------------------------------------------------------ AI face detection → tracks
function buildFaceTracks(det, c) {
  const isImg = c.type === 'image'; const base = isImg ? 0 : c.in;
  const gap = 0.8; const tracks = [];
  for (const fr of det.frames) {
    const s = base + fr.t;
    const lt = isImg ? 0 : srcToLt(c, s); if (lt < -0.05 || lt > c.dur + 0.05) continue;
    const used = new Set();
    for (const [x, y, w, h, sc] of [...fr.f].sort((a, b) => b[4] - a[4])) {
      const cx = x + w / 2, cy = y + h / 2; let best = null, bd = 1e9;
      for (const tr of tracks) {
        if (used.has(tr)) continue; const l = tr.pts[tr.pts.length - 1]; if (Math.abs(lt - l[0]) > gap) continue;
        const d = Math.hypot(cx - l[1], cy - l[2]) / Math.max(w, h, l[3], l[4]);
        if (d < 0.9 && d < bd) { bd = d; best = tr; }
      }
      if (!best) { best = { pts: [], score: 0 }; tracks.push(best); }
      used.add(best); best.pts.push([lt, cx, cy, w, h]); best.score = Math.max(best.score, sc);
    }
  }
  const keep = tracks.filter((t) => isImg || t.pts.length >= 3 || t.score >= 0.7);
  return keep.map((t, i) => {
    let p = t.pts.sort((a, b) => a[0] - b[0]);
    // smooth position & size (moving average) – sizes use the local max so the box never shrinks onto the face
    p = p.map((q, j) => { const win = p.slice(Math.max(0, j - 2), j + 3); const avg = (k) => win.reduce((a, r) => a + r[k], 0) / win.length; return [q[0], avg(1), avg(2), Math.max(...win.map((r) => r[3])), Math.max(...win.map((r) => r[4]))]; });
    if (isImg) p = [[0, ...p[0].slice(1)], [c.dur, ...p[0].slice(1)]];
    const keys = p.map(([lt, cx, cy, w, h]) => { const g = geo(c, lt); const [px, py] = mediaToProj(g, cx, cy - h * 0.04); const [pw, ph] = sizeToProj(g, w, h * 1.18); return [+lt.toFixed(3), +px.toFixed(4), +py.toFixed(4), +pw.toFixed(4), +ph.toFixed(4)]; });
    return { id: uid('face'), name: L('Gesicht ', 'Face ') + (i + 1), on: true, keys };
  });
}
export async function detectFacesOnClip(c, { small = true, onProgress, signal } = {}) {
  if (!(await ensureModels(['ort', 'yoloface']))) return null;
  const m = store.media(c.mediaId);
  const out = path.join(cacheDir('tmp'), 'faces_' + c.id + '_' + Date.now() + '.json');
  const isImg = c.type === 'image';
  const cfg = { task: 'facedetect', input: m.path, output: out, start: isImg ? 0 : c.in, duration: isImg ? 0 : Math.max(0.1, sourceLength(c)), fps: isImg ? 1 : Math.min(12, (m.fps || 30)), small, models: { yoloface: modelPath('yoloface') } };
  await runWorker(cfg, onProgress, signal);
  const det = JSON.parse(fs.readFileSync(out, 'utf8')); try { fs.unlinkSync(out); } catch {}
  return buildFaceTracks(det, c);
}

function modeChips(st) {
  const opts = [[1, '▦ ' + L('Verpixeln', 'Pixelate')], [0, '◌ ' + L('Weichzeichnen', 'Blur')], [2, '▬ ' + L('Balken', 'Bar')]];
  const box = el('div', { class: 'chips' });
  const draw = () => { box.innerHTML = ''; for (const [v, n] of opts) box.appendChild(el('span', { class: 'chip' + (st.mode === v ? ' on' : ''), onclick: () => { st.mode = v; draw(); } }, n)); };
  draw(); return box;
}
function rangeRow(label, st, key, min, max, step) {
  const val = el('span', { class: 'muted', style: { minWidth: '34px', textAlign: 'right' } }, String(st[key]));
  const r = el('input', { type: 'range', min, max, step, value: st[key], style: { flex: 1 } }); r.oninput = () => { st[key] = +r.value; val.textContent = r.value; };
  return el('div', { class: 'row', style: { alignItems: 'center', gap: '8px', margin: '6px 0' } }, el('span', { style: { minWidth: '120px' } }, label), r, val);
}

async function censorFacesRun({ clipIds, mode = 1, strength = 26, small = true, shape = 0 } = {}) {
  const clips = clipIds?.length ? clipIds.map((id) => store.clip(id)).filter(Boolean) : [videoClip(store.selectedClips().find((x) => x.type === 'video' || x.type === 'image') || pickClip())];
  const targets = clips.filter((c) => c && (c.type === 'video' || c.type === 'image'));
  if (!targets.length) throw new Error(L('Kein Videoclip gefunden', 'No video clip found'));
  const pm = progressModal(L('KI sucht Gesichter…', 'AI is looking for faces…')); const ac = new AbortController(); pm.onCancel(() => ac.abort());
  let total = 0; const res = [];
  try {
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      const tracks = await detectFacesOnClip(c, { small, signal: ac.signal, onProgress: (p, t) => pm.set((i + p) / targets.length, (targets.length > 1 ? `Clip ${i + 1}/${targets.length} · ` : '') + t) });
      if (!tracks) return;
      res.push([c, tracks]); total += tracks.length;
    }
  } catch (e) { if (ac.signal.aborted) return; throw e; } finally { pm.close(); }
  store.edit(L('Gesichter zensieren', 'Censor faces'), () => {
    for (const [c, tracks] of res) {
      if (!tracks.length) continue;
      let fx = c.effects.find((f) => f.type === 'facecensor');
      if (!fx) { fx = { id: uid('fx'), type: 'facecensor', enabled: true, params: defaultParams('facecensor') }; c.effects.push(fx); }
      Object.assign(fx.params, { mode, strength, shape }); fx.data = { tracks };
    }
    store.select(res.filter(([, t]) => t.length).map(([c]) => c.id));
  });
  if (!total) toast(L('Keine Gesichter gefunden', 'No faces found'), 'err', 5000);
  else toast(L(`${total} Gesicht${total > 1 ? 'er' : ''} gefunden und zensiert – im Inspector „Effekte“ einzeln an/aus`, `${total} face(s) censored`), 'ok', 6000);
  return { faces: total, clips: res.map(([c, t]) => ({ id: c.id, faces: t.length })) };
}

// ------------------------------------------------------------------ object tracker (scale-aware SAD on grey frames)
function grayFrames(file, start, len, fps, w, h, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-v', 'error', '-ss', String(Math.max(0, start)), '-t', String(len), '-i', file, '-an', '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
    signal?.addEventListener('abort', () => p.kill());
    const chunks = []; let got = 0; const fsz = w * h; const total = Math.max(1, Math.ceil(len * fps));
    p.stdout.on('data', (d) => { chunks.push(d); got += d.length; onProgress?.(Math.min(1, got / fsz / total)); });
    p.on('error', reject);
    p.on('close', () => { const b = Buffer.concat(chunks); const fr = []; for (let i = 0; i + fsz <= b.length; i += fsz) fr.push(b.subarray(i, i + fsz)); resolve(fr); });
  });
}
const TS = 24; // template samples per side
function sampleBox(fr, W, H, cx, cy, bw, bh) {
  const o = new Float32Array(TS * TS); let mean = 0;
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
    const x = clamp(Math.round(cx + ((i + 0.5) / TS - 0.5) * bw), 0, W - 1), y = clamp(Math.round(cy + ((j + 0.5) / TS - 0.5) * bh), 0, H - 1);
    const v = fr[y * W + x]; o[j * TS + i] = v; mean += v;
  }
  mean /= TS * TS; for (let k = 0; k < o.length; k++) o[k] -= mean; // brightness invariant
  return o;
}
const diff = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); return s; };
export function trackBox(frames, W, H, box, from, dir = 1) {
  // box {cx,cy,w,h} in frame pixels at index `from`; returns map index -> box
  const out = new Map(); let b = { ...box }; let tpl = sampleBox(frames[from], W, H, b.cx, b.cy, b.w, b.h); const tpl0 = tpl.slice();
  out.set(from, { ...b });
  for (let f = from + dir; f >= 0 && f < frames.length; f += dir) {
    const fr = frames[f]; let best = Infinity, bx = b.cx, by = b.cy, bs = 1;
    const R = Math.max(6, Math.max(b.w, b.h) * 0.45);
    for (const st of [Math.max(2, R / 6), 1]) {
      const cx0 = bx, cy0 = by, rr = st === 1 ? 2 : R;
      for (let dy = -rr; dy <= rr; dy += st) for (let dx = -rr; dx <= rr; dx += st) {
        const d = diff(sampleBox(fr, W, H, cx0 + dx, cy0 + dy, b.w, b.h), tpl); if (d < best) { best = d; bx = cx0 + dx; by = cy0 + dy; }
      }
    }
    for (const s of [0.94, 1.06]) { const d = diff(sampleBox(fr, W, H, bx, by, b.w * s, b.h * s), tpl) * 1.02; if (d < best) { best = d; bs = s; } }
    b = { cx: bx, cy: by, w: clamp(b.w * bs, 4, W), h: clamp(b.h * bs, 4, H) };
    const cur = sampleBox(fr, W, H, b.cx, b.cy, b.w, b.h);
    for (let k = 0; k < tpl.length; k++) tpl[k] = tpl[k] * 0.8 + cur[k] * 0.12 + tpl0[k] * 0.08; // adapt, but stay anchored to the first look
    out.set(f, { ...b });
  }
  return out;
}
// track a project-space box {cx,cy,w,h} on clip c (whole clip, both directions from the playhead)
async function trackRegion(c, region, { onProgress, signal } = {}) {
  const vc = videoClip(c); if (!vc || vc.type !== 'video') throw new Error(L('Kein Video unter dem Clip zum Verfolgen', 'No video to track'));
  const m = store.media(vc.mediaId);
  const fps = Math.min(20, m.fps || 30); const W = 384, H = Math.max(2, Math.round((W * (m.height || 1080)) / (m.width || 1920) / 2) * 2);
  const s0 = Math.min(sourceTime(vc, 0), sourceTime(vc, vc.dur)), len = Math.max(0.2, sourceLength(vc));
  const frames = await grayFrames(m.path, s0, len, fps, W, H, (p) => onProgress?.(p * 0.6), signal);
  if (!frames.length) throw new Error(L('Video konnte nicht gelesen werden', 'Could not read video'));
  const ltv = clamp(store.time - vc.start, 0, vc.dur);
  const g0 = geo(vc, ltv);
  const [u, v] = projToMedia(g0, region.cx, region.cy); const [mw, mh] = sizeToMedia(g0, region.w, region.h);
  const fromIdx = clamp(Math.round((sourceTime(vc, ltv) - s0) * fps), 0, frames.length - 1);
  const box = { cx: u * W, cy: v * H, w: Math.max(6, mw * W), h: Math.max(6, mh * H) };
  onProgress?.(0.7, L('Berechne Bewegung…', 'Computing motion…'));
  const fw = trackBox(frames, W, H, box, fromIdx, 1), bw = trackBox(frames, W, H, box, fromIdx, -1);
  const all = new Map([...bw, ...fw]);
  const keys = [];
  for (const [i, b] of [...all].sort((a, b2) => a[0] - b2[0])) {
    const lt = srcToLt(vc, s0 + i / fps) + (vc.start - c.start); if (lt < -0.01 || lt > c.dur + 0.01) continue;
    const g = geo(vc, lt - (vc.start - c.start));
    const [px, py] = mediaToProj(g, b.cx / W, b.cy / H); const [pw, ph] = sizeToProj(g, b.w / W, b.h / H);
    keys.push([lt, px, py, pw, ph]);
  }
  return keys.sort((a, b) => a[0] - b[0]);
}
function applyKeys(fx, keys) {
  const mk = (k) => ({ kf: keys.map((r) => ({ t: +r[0].toFixed(3), v: +r[k].toFixed(4), e: 'linear' })) });
  if (keys.length > 1) { fx.params.cx = mk(1); fx.params.cy = mk(2); fx.params.w = mk(3); fx.params.h = mk(4); }
}

async function censorObjectRun({ mode = 1, strength = 28, track = true, rect, clipId } = {}) {
  const c = (clipId && store.clip(clipId)) || videoClip(store.selectedClips().find((x) => x.type === 'video' || x.type === 'image') || pickClip());
  if (!c) throw new Error(L('Kein Videoclip gefunden', 'No video clip found'));
  let st = { mode, strength, track };
  if (!rect) {
    const r = { x: 0.4, y: 0.3, w: 0.2, h: 0.28 }; setTrackRect(r);
    const ok = await new Promise((res) => modal({ title: L('Objekt zensieren / maskieren', 'Censor / mask object'), body: el('div', { style: { maxWidth: '440px', lineHeight: '1.6' } },
      el('p', { style: { marginTop: 0 } }, L('Ziehe den orangefarbenen Rahmen in der Vorschau über das Objekt (Ecke unten rechts = Größe). VELOX verfolgt es dann durch den ganzen Clip – vorwärts und rückwärts ab dem Playhead.', 'Drag the orange box in the preview over the object (bottom-right corner = size). VELOX then follows it through the whole clip.')),
      modeChips(st), rangeRow(L('Stärke', 'Strength'), st, 'strength', 4, 100, 1),
      el('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, (() => { const cb = el('input', { type: 'checkbox', checked: st.track }); cb.onchange = () => (st.track = cb.checked); return cb; })(), L('Objekt mitverfolgen (Tracking)', 'Follow the object (tracking)')),
      el('p', { class: 'muted', style: { fontSize: '11px' } }, L('Danach im Inspector unter „Effekte“: Art (auch Maske: nur Bereich zeigen / ausschneiden), Form, Größe, Kante.', 'Afterwards in the inspector "Effects": mode (incl. mask), shape, size, feather.'))),
      buttons: [{ label: L('Abbrechen', 'Cancel'), value: false }, { label: L('Zensieren', 'Censor'), cls: 'primary', value: true }], onClose: res }));
    setTrackRect(null);
    if (!ok) return;
    rect = r;
  }
  const region = { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, w: rect.w, h: rect.h };
  let keys = null;
  if (st.track && c.type === 'video') {
    const pm = progressModal(L('Verfolge Objekt…', 'Tracking object…')); const ac = new AbortController(); pm.onCancel(() => ac.abort());
    try { keys = await trackRegion(c, region, { signal: ac.signal, onProgress: (p, t) => pm.set(p, t) }); }
    catch (e) { if (ac.signal.aborted) return; throw e; } finally { pm.close(); }
  }
  let fx;
  store.edit(L('Objekt zensieren', 'Censor object'), () => {
    fx = { id: uid('fx'), type: 'censor', enabled: true, params: { ...defaultParams('censor'), mode: st.mode, strength: st.strength, shape: 1, cx: region.cx, cy: region.cy, w: region.w, h: region.h } };
    if (keys) applyKeys(fx, keys);
    c.effects.push(fx); store.select([c.id]);
  });
  toast(keys ? L(`Objekt verfolgt (${keys.length} Positionen)`, `Object tracked (${keys.length} positions)`) : L('Zensur-Bereich hinzugefügt', 'Censor region added'), 'ok');
  return { clipId: c.id, fxId: fx.id, keys: keys?.length || 0 };
}

// ------------------------------------------------------------------ inspector extras + on-canvas editor
function fxOf(clipId, fxId) { const c = store.clip(clipId); const fx = c?.effects.find((f) => f.id === fxId); return c && fx ? { c, fx } : null; }
viewer.fxExtras ||= {};
viewer.fxExtras.censor = (c, fx) => {
  const editing = viewer.editFx?.fxId === fx.id;
  return el('div', { class: 'row', style: { flexWrap: 'wrap' } },
    el('button', { class: 'btn small' + (editing ? ' primary' : ''), onclick: () => { viewer.editFx = editing ? null : { clipId: c.id, fxId: fx.id, kind: 'censor' }; drawOverlay(); bus.emit('selection'); } }, editing ? L('✓ Fertig', '✓ Done') : '✎ ' + L('Bereich im Bild ziehen', 'Drag region on canvas')),
    el('button', { class: 'btn small', onclick: async () => {
      const lt = clamp(store.time - c.start, 0, c.dur); const region = { cx: evalParam(fx.params.cx, lt), cy: evalParam(fx.params.cy, lt), w: evalParam(fx.params.w, lt), h: evalParam(fx.params.h, lt) };
      const pm = progressModal(L('Verfolge Objekt…', 'Tracking object…')); const ac = new AbortController(); pm.onCancel(() => ac.abort());
      try { const keys = await trackRegion(c, region, { signal: ac.signal, onProgress: (p, t) => pm.set(p, t) }); store.edit(L('Tracking', 'Tracking'), () => applyKeys(fx, keys)); toast(L('Neu getrackt', 'Re-tracked'), 'ok'); }
      catch (e) { if (!ac.signal.aborted) toast(e.message, 'err'); } finally { pm.close(); }
    } }, '🎯 ' + L('Ab Playhead neu tracken', 'Re-track from playhead')),
    el('button', { class: 'btn small', onclick: () => store.edit(L('Fest', 'Static'), () => { const lt = clamp(store.time - c.start, 0, c.dur); for (const k of ['cx', 'cy', 'w', 'h']) fx.params[k] = evalParam(fx.params[k], lt); }) }, '📌 ' + L('Tracking entfernen', 'Remove tracking')),
    el('div', { class: 'muted', style: { fontSize: '11px', width: '100%' } }, L('Rahmen im Bild verschieben/skalieren korrigiert die Position am aktuellen Frame.', 'Moving the box on canvas corrects the current frame.')));
};
viewer.fxExtras.facecensor = (c, fx) => {
  const tracks = fx.data?.tracks || [];
  const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '160px', overflow: 'auto', margin: '4px 0' } },
    ...tracks.map((tr) => { const a = tr.keys[0][0], b = tr.keys[tr.keys.length - 1][0];
      const cb = el('input', { type: 'checkbox', checked: tr.on !== false }); cb.onchange = () => store.edit(L('Gesicht', 'Face'), () => { tr.on = cb.checked; });
      return el('label', { class: 'row', style: { gap: '6px', alignItems: 'center', margin: 0, cursor: 'pointer' }, onmouseenter: () => { store.setTime(c.start + a + Math.min(0.2, (b - a) / 2)); } }, cb, el('span', {}, tr.name || 'Gesicht'), el('span', { class: 'muted' }, `${a.toFixed(1)}–${b.toFixed(1)} s`)); }));
  return el('div', {},
    tracks.length ? list : el('div', { class: 'muted' }, L('Keine Gesichter', 'No faces')),
    el('div', { class: 'row' },
      el('button', { class: 'btn small', onclick: () => run('censorFaces', { clipIds: [c.id], mode: fx.params.mode, strength: fx.params.strength, shape: fx.params.shape }) }, '🔄 ' + L('Gesichter neu suchen', 'Detect again')),
      el('button', { class: 'btn small', onclick: () => run('censorObject', { clipId: c.id }) }, '+ ' + L('Bereich manuell', 'Add region'))),
    el('div', { class: 'muted', style: { fontSize: '11px' } }, L('Haken weg = dieses Gesicht bleibt sichtbar. Maus über ein Gesicht = Playhead springt hin.', 'Untick = keep this face visible. Hover = jump to it.')));
};
viewer.censorOverlay = (ov, W, H) => {
  const r = viewer.editFx && fxOf(viewer.editFx.clipId, viewer.editFx.fxId); if (!r) return false;
  const { c, fx } = r; const lt = clamp(store.time - c.start, 0, c.dur);
  const P = { cx: evalParam(fx.params.cx, lt), cy: evalParam(fx.params.cy, lt), w: evalParam(fx.params.w, lt), h: evalParam(fx.params.h, lt) };
  const set = (k, v) => { fx.params[k] = isKf(fx.params[k]) ? setKeyframe(fx.params[k], lt, +v.toFixed(4), 'linear') : +v.toFixed(4); };
  const box = el('div', { class: 'trackbox', style: { left: (P.cx - P.w / 2) * W + 'px', top: (P.cy - P.h / 2) * H + 'px', width: P.w * W + 'px', height: P.h * H + 'px', borderColor: '#ff4d6d', pointerEvents: 'auto' } });
  const handle = el('div', { style: { position: 'absolute', right: '-6px', bottom: '-6px', width: '12px', height: '12px', background: '#ff4d6d', cursor: 'nwse-resize' } });
  box.appendChild(handle);
  const drag = (e, resize) => {
    e.preventDefault(); e.stopPropagation(); const sx = e.clientX, sy = e.clientY, o = { ...P }; store.begin(L('Zensur-Bereich', 'Censor region'));
    const mv = (ev) => { const dx = (ev.clientX - sx) / W, dy = (ev.clientY - sy) / H; if (resize) { set('w', Math.max(0.01, o.w + dx * 2)); set('h', Math.max(0.01, o.h + dy * 2)); } else { set('cx', o.cx + dx); set('cy', o.cy + dy); } store.touch(); drawOverlay(); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); store.end(); drawOverlay(); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  box.addEventListener('mousedown', (e) => drag(e, false)); handle.addEventListener('mousedown', (e) => drag(e, true));
  ov.appendChild(box); return true;
};

// ------------------------------------------------------------------ dialog + commands
async function censorFacesDialog() {
  const sel = store.selectedClips().filter((x) => x.type === 'video' || x.type === 'image');
  const st = { mode: 1, strength: 26, small: true, all: false };
  const ok = await new Promise((res) => modal({ title: '🙈 ' + L('Gesichter automatisch zensieren', 'Auto-censor faces'), width: 500, body: el('div', { style: { lineHeight: '1.6' } },
    el('p', { class: 'muted', style: { marginTop: 0 } }, L('Die KI findet jedes Gesicht im Clip, verfolgt es und zensiert es – komplett lokal auf deiner Grafikkarte. Danach kannst du einzelne Gesichter wieder freigeben.', 'The AI finds every face in the clip, follows it and censors it – locally on your GPU. You can un-censor single faces afterwards.')),
    modeChips(st), rangeRow(L('Stärke', 'Strength'), st, 'strength', 4, 100, 1),
    el('label', { class: 'row', style: { gap: '6px', alignItems: 'center', margin: '4px 0' } }, (() => { const cb = el('input', { type: 'checkbox', checked: true }); cb.onchange = () => (st.small = cb.checked); return cb; })(), L('Auch kleine / weit entfernte Gesichter (genauer, langsamer)', 'Also small / distant faces (slower)')),
    el('label', { class: 'row', style: { gap: '6px', alignItems: 'center', margin: '4px 0' } }, (() => { const cb = el('input', { type: 'checkbox' }); cb.onchange = () => (st.all = cb.checked); return cb; })(), L('Alle Videoclips der Timeline', 'All video clips on the timeline')),
    el('p', { class: 'muted', style: { fontSize: '11px' } }, (sel.length ? L(`Ausgewählt: ${sel.length} Clip(s)`, `Selected: ${sel.length} clip(s)`) : L('Kein Clip ausgewählt – nimmt den Clip am Playhead.', 'No clip selected – uses the clip at the playhead.')))),
    buttons: [{ label: L('Abbrechen', 'Cancel'), value: false }, { label: L('Gesichter zensieren', 'Censor faces'), cls: 'primary', value: true }], onClose: res }));
  if (!ok) return;
  const clipIds = st.all ? store.p.clips.filter((x) => x.type === 'video' || x.type === 'image').map((x) => x.id) : sel.map((x) => x.id);
  return censorFacesRun({ clipIds, mode: st.mode, strength: st.strength, small: st.small });
}

registerCommands([
  { id: 'censorFacesDialog', name: { de: 'Gesichter automatisch zensieren…', en: 'Auto-censor faces…' }, cat: 'ai', key: 'Ctrl+Alt+G', run: () => censorFacesDialog() },
  { id: 'censorFaces', name: { de: 'Gesichter zensieren (API)', en: 'Censor faces (API)' }, cat: 'ai', hidden: true, args: '{ clipIds?, mode?: 0 blur|1 pixel|2 bar, strength?, small? }', run: (a = {}) => censorFacesRun(a) },
  { id: 'censorObject', name: { de: 'Objekt zensieren / Tracking-Maske…', en: 'Censor object / tracked mask…' }, cat: 'ai', key: 'Ctrl+Alt+Z', args: '{ clipId?, mode?, strength?, track?, rect?: {x,y,w,h} }', run: (a = {}) => censorObjectRun(a) },
  { id: 'censorRegionsAt', name: { de: 'Zensur-Bereiche (API)', en: 'Censor regions (API)' }, cat: 'ai', hidden: true, args: '{ clipId, t? }', run: ({ clipId, t } = {}) => { const c = store.clip(clipId); const fx = c?.effects.find((f) => f.type === 'facecensor'); return fx ? regionsAt(fx.data?.tracks, (t ?? store.time) - c.start) : []; } },
]);
export { CENSOR_MODES };
