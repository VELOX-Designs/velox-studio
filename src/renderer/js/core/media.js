// Media import, metadata, background jobs (thumbnails, waveforms, proxies) and timeline insertion.
import { store, newClip, clipEnd, clearRange, newTrack, defaultText, rippleTrack } from './project.js';
import { uid, bus, fileUrl } from './util.js';
import { probe, makeFilmstrip, makePoster, makePeaks, makeProxy } from './ffmpeg.js';
import { settings } from './settings.js';
import { defaultShape } from '../render/shapes.js';
const path = require('path');
const fs = require('fs');

export const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mts', 'm2ts', 'ts', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'mxf', 'gif'];
export const AUDIO_EXT = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'aif'];
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'avif'];
export const ALL_EXT = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT];

// runtime-only caches (not saved in project)
export const thumbs = new Map(); // mediaId -> {poster, strip, count}
export const peaks = new Map(); // mediaId -> Float32Array
export const stripImages = new Map(); // mediaId -> HTMLImageElement

// ------------------------------------------------------------------ jobs
const jobs = [];
let running = 0;
export function addJob(label, fn, prio = 0) {
  return new Promise((res, rej) => { jobs.push({ label, fn, res, rej, prio }); jobs.sort((a, b) => b.prio - a.prio); pump(); });
}
function pump() {
  bus.emit('jobs', jobs.length + running);
  while (running < 3 && jobs.length) {
    const j = jobs.shift(); running++;
    j.fn().then(j.res, j.rej).finally(() => { running--; pump(); });
  }
}
export const jobCount = () => jobs.length + running;

// ------------------------------------------------------------------ import
export async function importFiles(files, folderId = 'root') {
  const added = [];
  const list = [];
  for (const f of files) {
    try {
      if (fs.statSync(f).isDirectory()) { for (const x of fs.readdirSync(f)) list.push(path.join(f, x)); continue; }
    } catch { continue; }
    list.push(f);
  }
  for (const file of list) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!ALL_EXT.includes(ext)) continue;
    const existing = store.p.media.find((m) => m.path === file);
    if (existing) { added.push(existing); continue; }
    try {
      const info = await probe(file);
      if (info.type === 'unknown') continue;
      if (IMAGE_EXT.includes(ext)) { info.type = 'image'; info.duration = 0; }
      const m = { id: uid('med'), name: path.basename(file), path: file, folder: folderId, added: Date.now(), ...info };
      store.edit('Import', (p) => { p.media.push(m); });
      added.push(m);
      prepareMedia(m);
    } catch (e) {
      console.error(e);
      bus.emit('toast', `Import fehlgeschlagen: ${path.basename(file)}`, 'err');
    }
  }
  return added;
}

export function prepareMedia(m) {
  if (m.type === 'video' || m.type === 'image') {
    addJob('Thumbnail', async () => {
      const poster = await makePoster(m).catch(() => null);
      const strip = await makeFilmstrip(m).catch(() => null);
      thumbs.set(m.id, { poster, strip: strip?.file, count: strip?.count || 1 });
      if (strip?.file) { const im = new Image(); im.onload = () => bus.emit('thumbs'); im.src = fileUrl(strip.file); stripImages.set(m.id, im); }
      bus.emit('thumbs');
    }, 2);
  }
  if (m.hasAudio || m.type === 'audio') {
    addJob('Waveform', async () => { const pk = await makePeaks(m); peaks.set(m.id, pk); bus.emit('thumbs'); }, 1);
  }
  if (m.type === 'video') {
    const unsupported = ['prores', 'dnxhd', 'cfhd', 'mpeg2video', 'mpeg4', 'msmpeg4v3', 'wmv3', 'vc1', 'hap', 'mjpeg', 'qtrle', 'rawvideo', 'ffv1', 'h263', 'flv1', 'gif'].includes(m.vcodec) || (m.pixfmt || '').includes('422') || (m.pixfmt || '').includes('444') || (m.pixfmt || '').includes('10');
    const big = m.height > settings.proxyAboveHeight;
    if (m.proxyPath && fs.existsSync(m.proxyPath)) return;
    if (unsupported || (settings.autoProxy && big)) createProxy(m);
  }
}

export function createProxy(m) {
  if (m._proxying) return;
  m._proxying = true;
  bus.emit('media:progress', m.id, 0);
  return addJob('Proxy', async () => {
    try {
      const p = await makeProxy(m, { height: Math.min(settings.proxyHeight, m.height || 720), onProgress: (x) => bus.emit('media:progress', m.id, x) });
      const mm = store.media(m.id) || m;
      mm.proxyPath = p; store.dirty = true;
      bus.emit('media:progress', m.id, null);
      bus.emit('toast', `Proxy fertig: ${m.name}`, 'ok');
      bus.emit('changed', 'proxy');
    } finally { m._proxying = false; }
  }, 0);
}

export function ensureMediaCaches() {
  for (const m of store.p.media) if (!thumbs.has(m.id)) prepareMedia(m);
}

// ------------------------------------------------------------------ timeline insertion
export function trackForKind(kind, preferId) {
  const t = preferId && store.track(preferId);
  if (t && t.kind === kind) return t;
  return store.p.tracks.find((x) => x.kind === kind);
}

// insert media at time on given video track; creates linked audio
// first clip of a fresh project decides frame rate (and orientation, if the user kept the default)
function adoptFormat(p, m) {
  if (!p.settings.autoFormat || p.clips.length || m.type !== 'video' || !m.width) return;
  const std = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120];
  if (m.fps) p.settings.fps = std.reduce((a, b) => (Math.abs(b - m.fps) < Math.abs(a - m.fps) ? b : a));
  const landscape = p.settings.width >= p.settings.height;
  if (landscape && m.height > m.width * 1.2) { p.settings.width = 1080; p.settings.height = 1920; }
  p.settings.autoFormat = false;
  bus.emit('changed', 'settings');
}
export function placeMedia(p, m, t, { videoTrackId, audioTrackId, insert = false, inPoint = 0, outPoint = null } = {}) {
  adoptFormat(p, m);
  const fps = p.settings.fps;
  t = Math.round(t * fps) / fps;
  const dur = m.type === 'image' ? settings.defaultStillDur : Math.max(1 / fps, (outPoint ?? m.duration) - inPoint);
  const linkId = m.type === 'video' && m.hasAudio ? uid('lnk') : null;
  const created = [];
  const vTrack = (videoTrackId && p.tracks.find((x) => x.id === videoTrackId && x.kind === 'video')) || p.tracks.find((x) => x.kind === 'video');
  const aTrack = (audioTrackId && p.tracks.find((x) => x.id === audioTrackId && x.kind === 'audio')) || (m.type === 'audio' ? freeAudioTrack(p, t, t + dur) : p.tracks.find((x) => x.kind === 'audio'));
  if (insert) {
    for (const tr of p.tracks) {
      if (tr.locked) continue;
      // split clips that straddle t, then shift everything right
      for (const c of p.clips.filter((c) => c.trackId === tr.id && c.start < t - 1e-4 && clipEnd(c) > t + 1e-4)) { /* split handled by caller */ }
      for (const c of p.clips) if (c.trackId === tr.id && c.start >= t - 1e-4) c.start += dur;
    }
  }
  if (m.type === 'video' || m.type === 'image') {
    clearRange(p, vTrack.id, t, t + dur);
    const c = newClip({ trackId: vTrack.id, type: m.type, mediaId: m.id, name: m.name, start: t, dur, in: inPoint, linkId });
    p.clips.push(c); created.push(c);
  }
  if (m.type === 'audio' || (m.type === 'video' && m.hasAudio)) {
    clearRange(p, aTrack.id, t, t + dur);
    const c = newClip({ trackId: aTrack.id, type: 'audio', mediaId: m.id, name: m.name, start: t, dur, in: inPoint, linkId });
    p.clips.push(c); created.push(c);
  }
  return created;
}

export function appendToMain(p, medias) {
  const main = p.tracks.find((x) => x.kind === 'video');
  let t = p.clips.filter((c) => c.trackId === main.id).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const out = [];
  for (const m of medias) {
    if (m.type === 'audio') { const aTrack = p.tracks.find((x) => x.kind === 'audio'); const end = p.clips.filter((c) => c.trackId === aTrack.id).reduce((mm, c) => Math.max(mm, clipEnd(c)), 0); out.push(...placeMedia(p, m, end)); continue; }
    const cs = placeMedia(p, m, t, { videoTrackId: main.id });
    out.push(...cs);
    t += cs[0]?.dur || 0;
  }
  return out;
}

export function addTextClip(p, t, textProps = {}, dur = 3, trackId = null) {
  let tr = trackId ? p.tracks.find((x) => x.id === trackId) : null;
  if (!tr || tr.kind !== 'video') tr = freeVideoTrack(p, t, t + dur, 1);
  const c = newClip({ trackId: tr.id, type: 'text', name: (textProps.content || 'Text').slice(0, 30), start: t, dur, text: Object.assign(defaultText(), textProps) });
  p.clips.push(c);
  return c;
}
export function addSolidClip(p, t, color = '#000000', dur = 3, type = 'solid', gradient = '') {
  const tr = freeVideoTrack(p, t, t + dur, 1);
  const c = newClip({ trackId: tr.id, type, name: type === 'adjust' ? 'Einstellungsebene' : 'Farbfläche', start: t, dur, solid: { color, gradient } });
  p.clips.push(c);
  return c;
}
// first video track above minIndex that is free in [a,b); creates one if needed
export function freeVideoTrack(p, a, b, minIndex = 0) {
  const vt = p.tracks.filter((x) => x.kind === 'video');
  for (let i = minIndex; i < vt.length; i++) {
    if (vt[i].locked) continue;
    if (!p.clips.some((c) => c.trackId === vt[i].id && c.start < b - 1e-4 && clipEnd(c) > a + 1e-4)) return vt[i];
  }
  const nt = newTrack(p, 'video');
  const lastV = p.tracks.lastIndexOf(vt[vt.length - 1]);
  p.tracks.splice(lastV + 1, 0, nt);
  return nt;
}
export function freeAudioTrack(p, a, b) {
  const at = p.tracks.filter((x) => x.kind === 'audio');
  for (const t of at) if (!t.locked && !p.clips.some((c) => c.trackId === t.id && c.start < b - 1e-4 && clipEnd(c) > a + 1e-4)) return t;
  const nt = newTrack(p, 'audio'); p.tracks.push(nt); return nt;
}
export { rippleTrack };

export function addShapeClip(p, t, shape = {}, dur = 3) {
  const tr = freeVideoTrack(p, t, t + dur, 1);
  const c = newClip({ trackId: tr.id, type: 'shape', name: shape.label || shape.kind || 'Form', start: t, dur, shape: Object.assign(defaultShape(shape.kind || 'rect'), shape) });
  p.clips.push(c); return c;
}
