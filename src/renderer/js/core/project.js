// Project model, queries, edit operations and undo/redo history.
import { uid, deepClone, clamp, bus } from './util.js';
import { evalParam, isKf, shiftKeys, scaleKeys } from './keyframes.js';

export const PROJECT_VERSION = 1;

export function defaultTransform() {
  return { x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, rotX: 0, rotY: 0, perspective: 1.6,
    cropL: 0, cropR: 0, cropT: 0, cropB: 0, flipH: false, flipV: false };
}
export function defaultAudio() {
  return { eqLow: 0, eqMid: 0, eqHigh: 0, denoise: 0, voice: false, echo: 0, reverb: 0, pan: 0, duck: false, gainDb: 0 };
}
export function defaultText() {
  return { content: 'Text', font: 'Bahnschrift', size: 120, weight: 800, italic: false, color: '#ffffff', color2: '', gradAngle: 90,
    align: 'center', lineHeight: 1.1, letter: 0, stroke: 0, strokeColor: '#000000', shadow: 0.4, shadowColor: '#000000',
    glow: 0, glowColor: '#00e5ff', bg: '', bgPad: 20, bgRadius: 12, anim: 'none', animOut: 'none', animDur: 0.6,
    upper: false, extrude: 0, extrudeColor: '#1a1a1a', boxW: 0.9 };
}

export function newProject(opts = {}) {
  const p = {
    version: PROJECT_VERSION,
    id: uid('prj'),
    name: opts.name || 'Unbenanntes Projekt',
    created: Date.now(),
    modified: Date.now(),
    settings: { width: opts.width || 1920, height: opts.height || 1080, fps: opts.fps || 30, bg: '#000000', sampleRate: 48000 },
    media: [],
    folders: [{ id: 'root', name: 'Medien', parent: null }],
    tracks: [],
    clips: [],
    transitions: [],
    markers: [],
    inPoint: null,
    outPoint: null,
  };
  for (const k of ['video', 'audio']) p.tracks.push(newTrack(p, k));
  return p;
}

export function newTrack(p, kind) {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  return { id: uid('trk'), kind, name: (kind === 'video' ? 'V' : 'A') + n, muted: false, locked: false, hidden: false, solo: false, volume: 1, height: kind === 'video' ? 58 : 48 };
}

export function newClip(fields) {
  return Object.assign({
    id: uid('clp'), trackId: null, type: 'video', mediaId: null, name: '', start: 0, dur: 5, in: 0,
    speed: 1, ramp: null, reverse: false, volume: 1, fadeIn: 0, fadeOut: 0, muted: false, linkId: null,
    color: null, blend: 'normal', transform: defaultTransform(), effects: [], audio: defaultAudio(),
    freeze: false, tIn: null, tOut: null,
  }, fields);
}

// ------------------------------------------------------------------ speed / time mapping
// speed(u) over normalised clip time u in [0,1]: piecewise linear ramp or constant.
export function speedAt(clip, u) {
  if (!clip.ramp || clip.ramp.length < 2) return clip.speed || 1;
  const r = clip.ramp;
  if (u <= r[0].u) return r[0].v;
  for (let i = 0; i < r.length - 1; i++) {
    if (u <= r[i + 1].u) {
      const a = r[i], b = r[i + 1];
      const f = (u - a.u) / Math.max(1e-9, b.u - a.u);
      return a.v + (b.v - a.v) * f;
    }
  }
  return r[r.length - 1].v;
}
// integral of speed from 0 to u (in normalised units)
export function speedIntegral(clip, u) {
  if (!clip.ramp || clip.ramp.length < 2) return (clip.speed || 1) * u;
  const r = clip.ramp;
  let acc = 0;
  let prevU = 0, prevV = r[0].v;
  if (u <= r[0].u) return r[0].v * u;
  acc += r[0].v * r[0].u; prevU = r[0].u; prevV = r[0].v;
  for (let i = 1; i < r.length; i++) {
    const segEnd = Math.min(u, r[i].u);
    if (segEnd > prevU) {
      const fEnd = (segEnd - prevU) / Math.max(1e-9, r[i].u - prevU);
      const vEnd = prevV + (r[i].v - prevV) * fEnd;
      acc += (prevV + vEnd) * 0.5 * (segEnd - prevU);
    }
    if (u <= r[i].u) return acc;
    prevU = r[i].u; prevV = r[i].v;
  }
  return acc + r[r.length - 1].v * (u - prevU);
}
export const avgSpeed = (clip) => speedIntegral(clip, 1);
export const sourceLength = (clip) => (clip.freeze ? 0 : clip.dur * avgSpeed(clip));

// source time (seconds in media) for clip-local time lt; may exceed clip bounds (transition handles)
export function sourceTime(clip, lt) {
  if (clip.freeze) return clip.in;
  const d = Math.max(1e-6, clip.dur);
  let off;
  if (lt < 0) off = lt * speedAt(clip, 0);
  else if (lt > d) off = speedIntegral(clip, 1) * d + (lt - d) * speedAt(clip, 1);
  else off = speedIntegral(clip, lt / d) * d;
  if (clip.reverse) return clip.in + sourceLength(clip) - off;
  return clip.in + off;
}
export const clipEnd = (c) => c.start + c.dur;

// ------------------------------------------------------------------ store with history
class Store {
  constructor() {
    this.p = newProject();
    this.undoStack = [];
    this.redoStack = [];
    this.selection = new Set();
    this.selTransition = null;
    this.time = 0;
    this.dirty = false;
    this.filePath = null;
    this._pending = null;
  }
  load(p, filePath = null) {
    this.p = repairProject(p);
    this.filePath = filePath;
    this.undoStack = []; this.redoStack = [];
    this.selection.clear(); this.selTransition = null;
    this.time = 0; this.dirty = false;
    bus.emit('project:loaded');
    bus.emit('changed', 'load');
  }
  snapshot() { return JSON.stringify(this.p); }
  // wrap a mutation into a single undo step
  edit(label, fn) {
    const before = this.snapshot();
    let r;
    try { r = fn(this.p); } catch (e) { this.p = JSON.parse(before); throw e; }
    const after = this.snapshot();
    if (after !== before) {
      this.undoStack.push({ label, data: before });
      if (this.undoStack.length > 300) this.undoStack.shift();
      this.redoStack = [];
      this.dirty = true;
      this.p.modified = Date.now();
      bus.emit('changed', label);
    }
    return r;
  }
  // for drags: begin() takes snapshot, live changes call touch(), end() commits
  begin(label) { this._pending = { label, data: this.snapshot() }; }
  touch() { bus.emit('changed', 'live'); }
  end() {
    if (!this._pending) return;
    const after = this.snapshot();
    if (after !== this._pending.data) {
      this.undoStack.push(this._pending);
      this.redoStack = [];
      this.dirty = true;
      bus.emit('changed', this._pending.label);
    }
    this._pending = null;
  }
  cancel() { if (this._pending) { this.p = JSON.parse(this._pending.data); this._pending = null; bus.emit('changed', 'cancel'); } }
  undo() {
    const s = this.undoStack.pop(); if (!s) return null;
    this.redoStack.push({ label: s.label, data: this.snapshot() });
    this.p = JSON.parse(s.data); this.dirty = true; this.pruneSelection();
    bus.emit('changed', 'undo'); return s.label;
  }
  redo() {
    const s = this.redoStack.pop(); if (!s) return null;
    this.undoStack.push({ label: s.label, data: this.snapshot() });
    this.p = JSON.parse(s.data); this.dirty = true; this.pruneSelection();
    bus.emit('changed', 'redo'); return s.label;
  }
  pruneSelection() {
    for (const id of [...this.selection]) if (!this.clip(id)) this.selection.delete(id);
    if (this.selTransition && !this.p.transitions.find((t) => t.id === this.selTransition)) this.selTransition = null;
  }
  // queries
  clip(id) { return this.p.clips.find((c) => c.id === id); }
  media(id) { return this.p.media.find((m) => m.id === id); }
  track(id) { return this.p.tracks.find((t) => t.id === id); }
  get fps() { return this.p.settings.fps; }
  videoTracks() { return this.p.tracks.filter((t) => t.kind === 'video'); }
  audioTracks() { return this.p.tracks.filter((t) => t.kind === 'audio'); }
  clipsOn(trackId) { return this.p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start); }
  duration() { return this.p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0); }
  selectedClips() { return [...this.selection].map((id) => this.clip(id)).filter(Boolean); }
  primaryClip() { const s = this.selectedClips(); return s[s.length - 1] || null; }
  select(ids, additive = false) {
    if (!additive) this.selection.clear();
    for (const id of [].concat(ids)) if (id) this.selection.add(id);
    this.selTransition = null;
    bus.emit('selection');
  }
  linked(clip) { return clip.linkId ? this.p.clips.filter((c) => c.linkId === clip.linkId && c.id !== clip.id) : []; }
  transitionsFor(clipId) { return this.p.transitions.filter((t) => t.a === clipId || t.b === clipId); }
  setTime(t) { this.time = Math.max(0, t); bus.emit('time', this.time); }
}
export const store = new Store();

// ------------------------------------------------------------------ edit operations (call inside store.edit)
const EPS = 1e-4;

export function overlaps(p, trackId, start, end, ignore = new Set()) {
  return p.clips.filter((c) => c.trackId === trackId && !ignore.has(c.id) && c.start < end - EPS && clipEnd(c) > start + EPS);
}

// clear space on a track (overwrite edit): trims/splits existing clips in [start,end)
export function clearRange(p, trackId, start, end, ignore = new Set()) {
  for (const c of overlaps(p, trackId, start, end, ignore)) {
    const cs = c.start, ce = clipEnd(c);
    if (cs >= start - EPS && ce <= end + EPS) { removeClip(p, c.id, false); continue; }
    if (cs < start && ce > end) {
      const right = splitClipAt(p, c, end);
      if (right) trimClipEnd(p, c, start - c.start);
      continue;
    }
    if (cs < start) trimClipEnd(p, c, start - cs);
    else trimClipStart(p, c, end - cs);
  }
}

export function removeClip(p, id, withLinked = true) {
  const c = p.clips.find((x) => x.id === id); if (!c) return;
  const ids = new Set([id]);
  if (withLinked && c.linkId) p.clips.forEach((x) => { if (x.linkId === c.linkId) ids.add(x.id); });
  p.clips = p.clips.filter((x) => !ids.has(x.id));
  p.transitions = p.transitions.filter((t) => !ids.has(t.a) && !ids.has(t.b));
  ids.forEach((i) => store.selection.delete(i));
}

// keep clip.in + sourceLength valid when changing dur
export function trimClipEnd(p, c, newDur) {
  newDur = Math.max(1 / p.settings.fps, newDur);
  if (c.reverse) {
    // reversed: end of clip corresponds to clip.in; keep top of source fixed
    const top = c.in + sourceLength(c);
    c.dur = newDur; c.in = top - sourceLength(c);
  } else c.dur = newDur;
  dropBrokenTransitions(p);
}
export function trimClipStart(p, c, delta) {
  // delta > 0 trims in (clip gets shorter), < 0 extends
  delta = Math.min(delta, c.dur - 1 / p.settings.fps);
  const srcDelta = c.freeze ? 0 : delta * avgSpeed(c);
  if (!c.reverse) c.in += srcDelta;
  c.start += delta; c.dur -= delta;
  for (const k of Object.keys(c.transform)) c.transform[k] = shiftKeys(c.transform[k], -delta);
  for (const fx of c.effects) for (const k of Object.keys(fx.params)) fx.params[k] = shiftKeys(fx.params[k], -delta);
  c.volume = shiftKeys(c.volume, -delta);
  dropBrokenTransitions(p);
}

export function splitClipAt(p, c, t) {
  if (t <= c.start + EPS || t >= clipEnd(c) - EPS) return null;
  const lt = t - c.start;
  const right = deepClone(c);
  right.id = uid('clp');
  const srcAtCut = c.freeze ? c.in : sourceTime(c, lt);
  if (c.ramp) {
    // split ramp curves proportionally
    const u = lt / c.dur;
    const sp = speedAt(c, u);
    const leftR = c.ramp.filter((k) => k.u < u).map((k) => ({ u: k.u / u, v: k.v })); leftR.push({ u: 1, v: sp });
    const rightR = [{ u: 0, v: sp }, ...c.ramp.filter((k) => k.u > u).map((k) => ({ u: (k.u - u) / (1 - u), v: k.v }))];
    if (leftR[0].u > 0) leftR.unshift({ u: 0, v: speedAt(c, 0) });
    if (rightR[rightR.length - 1].u < 1) rightR.push({ u: 1, v: speedAt(c, 1) });
    c.ramp = leftR; right.ramp = rightR;
  }
  right.start = t; right.dur = c.dur - lt;
  c.dur = lt;
  if (c.reverse) { c.in = srcAtCut; /* right keeps original in */ }
  else right.in = srcAtCut;
  for (const k of Object.keys(right.transform)) right.transform[k] = shiftKeys(right.transform[k], -lt);
  for (const fx of right.effects) { fx.id = uid('fx'); for (const k of Object.keys(fx.params)) fx.params[k] = shiftKeys(fx.params[k], -lt); }
  right.volume = shiftKeys(right.volume, -lt);
  right.fadeIn = 0; c.fadeOut = 0; right.tIn = null; c.tOut = null;
  p.clips.push(right);
  // transitions on the right edge now belong to the right half
  p.transitions.forEach((tr) => { if (tr.a === c.id) tr.a = right.id; });
  return right;
}

// split all clips (optionally only selected) under time t; returns new right halves
export function splitAt(p, t, onlyIds = null) {
  const out = [];
  const linkMap = new Map();
  const targets = p.clips.filter((c) => c.start < t - EPS && clipEnd(c) > t + EPS && (!onlyIds || onlyIds.has(c.id)) && !store.track(c.trackId)?.locked);
  for (const c of targets) {
    const r = splitClipAt(p, c, t);
    if (r) {
      if (c.linkId) { if (!linkMap.has(c.linkId)) linkMap.set(c.linkId, uid('lnk')); r.linkId = linkMap.get(c.linkId); }
      out.push(r);
    }
  }
  return out;
}

// time window of a transition: overlap transitions = the region where clip B lies under clip A,
// classic ones are centred on the cut
export function trWindow(tr, a, b) {
  if (tr.overlap) return [b.start, clipEnd(a)];
  const cut = clipEnd(a), h = tr.dur / 2; return [cut - h, cut + h];
}
export function dropBrokenTransitions(p) {
  const f = 1 / p.settings.fps;
  p.transitions = p.transitions.filter((tr) => {
    const a = p.clips.find((c) => c.id === tr.a), b = p.clips.find((c) => c.id === tr.b);
    if (!a || !b || a.trackId !== b.trackId) return false;
    if (tr.overlap) {
      const ov = clipEnd(a) - b.start;
      if (ov < f - EPS || b.start <= a.start + EPS || clipEnd(b) <= clipEnd(a) + EPS) return false;
      tr.dur = ov; return true;
    }
    if (Math.abs(clipEnd(a) - b.start) > f + EPS) return false;
    tr.dur = Math.min(tr.dur, a.dur, b.dur);
    return true;
  });
}
// set the overlap length of a fused transition: clip B (and everything after it on the track,
// incl. linked audio) slides so B starts `dur` before A ends; audio gets a matching crossfade
export function setTransitionOverlap(p, tr, dur) {
  const a = p.clips.find((c) => c.id === tr.a), b = p.clips.find((c) => c.id === tr.b);
  if (!a || !b) return 0;
  const maxD = Math.max(1 / p.settings.fps, Math.min(a.dur, b.dur) - 1 / p.settings.fps);
  dur = Math.max(1 / p.settings.fps, Math.min(dur, maxD));
  const cur = tr.overlap ? clipEnd(a) - b.start : 0;
  const delta = dur - cur; // >0 = move B earlier
  const bStart = b.start;
  const move = new Set(p.clips.filter((c) => c.trackId === b.trackId && c.id !== a.id && c.start >= bStart - EPS).map((c) => c.id));
  for (const c of [...move]) { const o = p.clips.find((x) => x.id === c); if (o?.linkId) p.clips.forEach((x) => { if (x.linkId === o.linkId && x.linkId !== a.linkId) move.add(x.id); }); }
  for (const c of p.clips) if (move.has(c.id)) c.start -= delta;
  tr.overlap = true; tr.dur = dur;
  // crossfade the linked audio
  const la = a.linkId ? p.clips.find((x) => x.linkId === a.linkId && x.type === 'audio') : null;
  const lb = b.linkId ? p.clips.find((x) => x.linkId === b.linkId && x.type === 'audio') : null;
  if (la) la.fadeOut = dur; if (lb) lb.fadeIn = dur;
  return dur;
}

// close gaps on a track (magnetic main track)
export function rippleTrack(p, trackId) {
  const cs = p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  let t = 0; let prev = null;
  for (const c of cs) {
    const ov = prev ? p.transitions.find((tr) => tr.overlap && tr.a === prev.id && tr.b === c.id) : null;
    if (ov) t -= ov.dur;
    const shift = c.start - t;
    if (Math.abs(shift) > EPS) {
      c.start = t;
      for (const l of p.clips) if (c.linkId && l.linkId === c.linkId && l.id !== c.id) l.start -= shift;
    }
    t = clipEnd(c); prev = c;
  }
}

// ripple delete a time range on all unlocked tracks
export function rippleDeleteRange(p, start, end, trackIds = null) {
  const len = end - start;
  for (const tr of p.tracks) {
    if (tr.locked || (trackIds && !trackIds.has(tr.id))) continue;
    clearRange(p, tr.id, start, end);
    for (const c of p.clips) if (c.trackId === tr.id && c.start >= end - EPS) c.start -= len;
  }
  dropBrokenTransitions(p);
}

export function setClipSpeed(p, c, speed, keepSource = true) {
  const srcLen = sourceLength(c);
  c.ramp = null;
  c.speed = clamp(speed, 0.05, 100);
  if (keepSource && !c.freeze) {
    const f = (srcLen / c.speed) / c.dur;
    for (const k of Object.keys(c.transform)) c.transform[k] = scaleKeys(c.transform[k], f);
    c.dur = srcLen / c.speed;
  }
  dropBrokenTransitions(p);
}
export function setClipRamp(p, c, ramp) {
  const srcLen = sourceLength(c);
  c.ramp = ramp && ramp.length >= 2 ? ramp.map((k) => ({ u: clamp(k.u, 0, 1), v: clamp(k.v, 0.05, 100) })).sort((a, b) => a.u - b.u) : null;
  if (!c.ramp) c.speed = c.speed || 1;
  const avg = avgSpeed(c);
  if (!c.freeze) c.dur = srcLen / avg;
  dropBrokenTransitions(p);
}

// fit a duration into media bounds
export function maxDurFor(c, media) {
  if (!media || media.type === 'image' || c.freeze || !media.duration) return Infinity;
  if (c.reverse) return (c.in + sourceLength(c)) / avgSpeed(c);
  return (media.duration - c.in) / avgSpeed(c);
}

// ------------------------------------------------------------------ repair (crash / corrupt project tolerant loading)
export function repairProject(raw) {
  const base = newProject();
  const p = Object.assign(base, raw || {});
  p.settings = Object.assign(newProject().settings, raw?.settings || {});
  p.media = Array.isArray(p.media) ? p.media.filter((m) => m && m.id && m.path) : [];
  p.folders = Array.isArray(p.folders) && p.folders.length ? p.folders : [{ id: 'root', name: 'Medien', parent: null }];
  if (!p.folders.find((f) => f.id === 'root')) p.folders.unshift({ id: 'root', name: 'Medien', parent: null });
  p.tracks = Array.isArray(p.tracks) ? p.tracks.filter((t) => t && t.id && (t.kind === 'video' || t.kind === 'audio')) : [];
  if (!p.tracks.some((t) => t.kind === 'video')) p.tracks.push(newTrack(p, 'video'));
  if (!p.tracks.some((t) => t.kind === 'audio')) p.tracks.push(newTrack(p, 'audio'));
  const trackIds = new Set(p.tracks.map((t) => t.id));
  const mediaIds = new Set(p.media.map((m) => m.id));
  p.clips = (Array.isArray(p.clips) ? p.clips : []).filter((c) => c && c.id && trackIds.has(c.trackId) && isFinite(c.start) && isFinite(c.dur) && c.dur > 0)
    .filter((c) => !['video', 'audio', 'image'].includes(c.type) || mediaIds.has(c.mediaId))
    .map((c) => {
      const n = newClip(c);
      n.transform = Object.assign(defaultTransform(), c.transform || {});
      n.audio = Object.assign(defaultAudio(), c.audio || {});
      if (n.type === 'text') n.text = Object.assign(defaultText(), c.text || {});
      if (n.type === 'shape') n.shape = Object.assign({}, c.shape || {});
      n.effects = (c.effects || []).filter((f) => f && f.type).map((f) => ({ id: f.id || uid('fx'), type: f.type, enabled: f.enabled !== false, params: f.params || {} }));
      return n;
    });
  p.transitions = Array.isArray(p.transitions) ? p.transitions.filter((t) => t && t.a && t.b && t.type) : [];
  p.markers = Array.isArray(p.markers) ? p.markers.filter((m) => m && isFinite(m.t)) : [];
  p.sequences = Array.isArray(p.sequences) ? p.sequences.filter((q) => q && q.id && Array.isArray(q.clips) && Array.isArray(q.tracks)) : [];
  dropBrokenTransitions(p);
  return p;
}

export { evalParam, isKf };
