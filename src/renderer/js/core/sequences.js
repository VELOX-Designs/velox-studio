// Multiple sequences (timelines) per project, compound (nested) clips and multicam.
// The ACTIVE sequence lives in the top-level project fields (tracks/clips/…); others in p.sequences.
import { store, newTrack, newClip, clipEnd, removeClip, dropBrokenTransitions, sourceTime, splitClipAt } from './project.js';
import { uid, deepClone, bus } from './util.js';
import { registerCommands, run } from './commands.js';
import { L } from './i18n.js';
import { peaks } from './media.js';
import { makePeaks } from './ffmpeg.js';

const KEYS = ['settings', 'tracks', 'clips', 'transitions', 'markers', 'inPoint', 'outPoint'];
export function ensureSeqs(p = store.p) {
  if (!p.sequences) p.sequences = [];
  if (!p.activeSeq) { p.activeSeq = uid('seq'); p.seqName = p.seqName || 'Sequenz 1'; }
  return p.sequences;
}
// all sequences incl. the active one (as a lightweight view)
export function allSeqs(p = store.p) {
  ensureSeqs(p);
  return [{ id: p.activeSeq, name: p.seqName, active: true }, ...p.sequences.map((s) => ({ id: s.id, name: s.name, active: false }))];
}
export function seqData(p, id) {
  if (id === p.activeSeq) { const o = {}; for (const k of KEYS) o[k] = p[k]; return o; }
  return p.sequences.find((s) => s.id === id);
}
function stash(p) { const o = { id: p.activeSeq, name: p.seqName }; for (const k of KEYS) o[k] = p[k]; return o; }
function load(p, s) { p.activeSeq = s.id; p.seqName = s.name; for (const k of KEYS) p[k] = s[k]; }

export function switchSeq(id) {
  const p = store.p; ensureSeqs(p);
  if (id === p.activeSeq) return;
  const target = p.sequences.find((s) => s.id === id); if (!target) return;
  store.edit('Sequenz wechseln', (pp) => { pp.sequences = pp.sequences.filter((s) => s.id !== id); pp.sequences.push(stash(pp)); load(pp, target); });
  store.selection.clear(); store.setTime(0);
  bus.emit('changed', 'settings'); bus.emit('sequences');
}
export function newSeq({ name, width, height, fps, duplicate = false } = {}) {
  const p = store.p; ensureSeqs(p);
  const s = { id: uid('seq'), name: name || L(`Sequenz ${p.sequences.length + 2}`, `Sequence ${p.sequences.length + 2}`) };
  if (duplicate) { for (const k of KEYS) s[k] = deepClone(p[k]); remapIds(s); }
  else { s.settings = { ...p.settings, ...(width ? { width } : {}), ...(height ? { height } : {}), ...(fps ? { fps } : {}) }; s.tracks = []; for (const k of ['video', 'audio']) s.tracks.push(newTrack(s, k)); s.clips = []; s.transitions = []; s.markers = []; s.inPoint = null; s.outPoint = null; }
  if (duplicate) { if (width) s.settings.width = width; if (height) s.settings.height = height; if (fps) s.settings.fps = fps; }
  store.edit('Neue Sequenz', (pp) => { pp.sequences.push(s); });
  switchSeq(s.id);
  return s.id;
}
function remapIds(s) {
  const tm = new Map(), cm = new Map(), lm = new Map();
  for (const t of s.tracks) { const n = uid('trk'); tm.set(t.id, n); t.id = n; }
  for (const c of s.clips) { const n = uid('clp'); cm.set(c.id, n); c.id = n; c.trackId = tm.get(c.trackId); if (c.linkId) { if (!lm.has(c.linkId)) lm.set(c.linkId, uid('lnk')); c.linkId = lm.get(c.linkId); } }
  for (const t of s.transitions) { t.id = uid('tr'); t.a = cm.get(t.a); t.b = cm.get(t.b); }
}
export function renameSeq(id, name) { store.edit('Sequenz umbenennen', (p) => { if (id === p.activeSeq) p.seqName = name; else { const s = p.sequences.find((x) => x.id === id); if (s) s.name = name; } }); bus.emit('sequences'); }
export function deleteSeq(id) {
  const p = store.p; ensureSeqs(p);
  if (id === p.activeSeq) { if (!p.sequences.length) throw new Error(L('Letzte Sequenz kann nicht gelöscht werden', 'Cannot delete the last sequence')); const other = p.sequences[0]; switchSeq(other.id); }
  if (store.p.clips.some((c) => c.seqId === id) || store.p.sequences.some((s) => s.clips.some((c) => c.seqId === id))) throw new Error(L('Sequenz wird als verschachtelter Clip verwendet', 'Sequence is used as a nested clip'));
  store.edit('Sequenz löschen', (pp) => { pp.sequences = pp.sequences.filter((s) => s.id !== id); });
  bus.emit('sequences');
}
export const seqDuration = (s) => s.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);

// nested project view for rendering compound/multicam clips
export function nestedProject(P, clip) {
  const s = (P.sequences || []).find((x) => x.id === clip.seqId) || (clip.seqId === P.activeSeq ? null : null);
  if (!s) return null;
  let tracks = s.tracks;
  if (clip.type === 'multicam') { const vt = s.tracks.filter((t) => t.kind === 'video'); const keep = vt[Math.max(0, Math.min(vt.length - 1, clip.angle || 0))]; tracks = s.tracks.map((t) => (t.kind === 'video' ? { ...t, hidden: t !== keep } : t)); }
  return { settings: P.settings, tracks, clips: s.clips, transitions: s.transitions, markers: [], media: P.media, sequences: P.sequences };
}

// ------------------------------------------------------------------ compound clips
export function makeCompound(ids, name) {
  const p = store.p; ensureSeqs(p);
  const sel = ids.map((i) => store.clip(i)).filter(Boolean);
  if (!sel.length) throw new Error(L('Clips auswählen', 'Select clips'));
  const t0 = Math.min(...sel.map((c) => c.start)), t1 = Math.max(...sel.map(clipEnd));
  const s = { id: uid('seq'), name: name || L('Verschachtelt ', 'Nested ') + (p.sequences.length + 1), settings: { ...p.settings }, tracks: [], clips: [], transitions: [], markers: [], inPoint: null, outPoint: null };
  const trackMap = new Map();
  const usedTracks = p.tracks.filter((t) => sel.some((c) => c.trackId === t.id));
  for (const t of p.tracks) if (usedTracks.includes(t)) { const nt = { ...deepClone(t), id: uid('trk') }; trackMap.set(t.id, nt.id); s.tracks.push(nt); }
  if (!s.tracks.some((t) => t.kind === 'audio')) s.tracks.push(newTrack(s, 'audio'));
  const idSet = new Set(sel.map((c) => c.id));
  store.edit('Verschachteln', (pp) => {
    for (const c of sel) { const nc = deepClone(c); nc.trackId = trackMap.get(c.trackId); nc.start -= t0; s.clips.push(nc); }
    s.transitions = deepClone(pp.transitions.filter((t) => idSet.has(t.a) && idSet.has(t.b)));
    for (const c of sel) removeClip(pp, c.id, false);
    pp.sequences.push(s);
    const vTrack = pp.tracks.find((t) => t.id === sel.find((c) => c.type !== 'audio')?.trackId) || pp.tracks.find((t) => t.kind === 'video');
    const cc = newClip({ trackId: vTrack.id, type: 'compound', seqId: s.id, name: s.name, start: t0, dur: t1 - t0, in: 0 });
    pp.clips.push(cc); dropBrokenTransitions(pp);
    store.select([cc.id]);
  });
  return s.id;
}

// ------------------------------------------------------------------ multicam (audio-synced angles)
async function syncOffsets(clips) {
  // cross-correlate 100Hz loudness envelopes against the first angle
  const env = async (c) => { const m = store.media(c.mediaId); let pk = peaks.get(m.id); if (!pk) { pk = await makePeaks(m); peaks.set(m.id, pk); } return pk; };
  const ref = await env(clips[0]); const out = [0];
  for (const c of clips.slice(1)) {
    const e = await env(c); let best = 0, bestLag = 0; const maxLag = 3000; // ±30s
    for (let lag = -maxLag; lag <= maxLag; lag += 2) { let s = 0; for (let i = 0; i < Math.min(ref.length, 6000); i += 3) { const j = i + lag; if (j >= 0 && j < e.length) s += ref[i] * e[j]; } if (s > best) { best = s; bestLag = lag; } }
    out.push(bestLag / 100);
  }
  return out;
}
export async function makeMulticam(ids, { sync = 'audio' } = {}) {
  const p = store.p; ensureSeqs(p);
  const vids = ids.map((i) => store.clip(i)).filter((c) => c && c.type === 'video');
  if (vids.length < 2) throw new Error(L('Mindestens 2 Videoclips (Kameras) auswählen', 'Select at least 2 video clips (angles)'));
  const offs = sync === 'audio' ? await syncOffsets(vids) : vids.map((c) => c.start - vids[0].start);
  const s = { id: uid('seq'), name: 'Multicam ' + (p.sequences.length + 1), settings: { ...p.settings }, tracks: [], clips: [], transitions: [], markers: [], inPoint: null, outPoint: null };
  vids.forEach((c, i) => { const t = newTrack(s, 'video'); t.name = 'Kamera ' + (i + 1); s.tracks.push(t); });
  const at = newTrack(s, 'audio'); s.tracks.push(at);
  const minOff = Math.min(...offs.map((o, i) => -o));
  vids.forEach((c, i) => { const nc = deepClone(c); nc.id = uid('clp'); nc.linkId = null; nc.trackId = s.tracks[i].id; nc.start = -offs[i] - minOff; nc.in = c.in; s.clips.push(nc); });
  const a0 = store.linked(vids[0]).find((l) => l.type === 'audio');
  if (a0) { const na = deepClone(a0); na.id = uid('clp'); na.linkId = null; na.trackId = at.id; na.start = -minOff; s.clips.push(na); }
  const dur = seqDuration(s);
  store.edit('Multicam', (pp) => {
    const t0 = Math.min(...vids.map((c) => c.start));
    for (const c of vids) removeClip(pp, c.id, true);
    pp.sequences.push(s);
    const vTrack = pp.tracks.find((t) => t.kind === 'video');
    const mc = newClip({ trackId: vTrack.id, type: 'multicam', seqId: s.id, angle: 0, name: s.name, start: t0, dur, in: 0 });
    pp.clips.push(mc);
    if (a0) { const ac = deepClone(a0); ac.id = uid('clp'); ac.start = t0 + (-minOff); ac.linkId = null; pp.clips.push(ac); }
    store.select([mc.id]);
  });
  return s.id;
}
// switch angle at playhead (live multicam cutting with 1-9)
export function cutToAngle(angle) {
  const t = Math.round(store.time * store.fps) / store.fps;
  const c = store.p.clips.find((x) => x.type === 'multicam' && x.start <= t && clipEnd(x) > t);
  if (!c) return false;
  store.edit('Kamera wechseln', (p) => {
    let target = c;
    if (t > c.start + 1 / store.fps) target = splitClipAt(p, c, t) || c;
    target.angle = angle; target.name = `Multicam · Kamera ${angle + 1}`;
  });
  return true;
}

registerCommands([
  { id: 'newSequence', name: { de: 'Neue Sequenz', en: 'New sequence' }, cat: 'file', args: '{ name?, width?, height?, fps?, duplicate? }', run: (a = {}) => newSeq(a) },
  { id: 'duplicateSequence', name: { de: 'Sequenz duplizieren', en: 'Duplicate sequence' }, cat: 'file', run: (a = {}) => newSeq({ ...a, duplicate: true, name: (store.p.seqName || 'Sequenz') + ' Kopie' }) },
  { id: 'verticalVersion', name: { de: '9:16-Version dieser Sequenz erstellen', en: 'Create 9:16 version' }, cat: 'file', run: async () => { newSeq({ duplicate: true, name: (store.p.seqName || 'Sequenz') + ' 9:16', width: 1080, height: 1920 }); await run('fillFrame', {}).catch(() => {}); } },
  { id: 'switchSequence', name: { de: 'Sequenz wechseln (API)', en: 'Switch sequence (API)' }, cat: 'file', hidden: true, args: '{ id }', run: ({ id }) => switchSeq(id) },
  { id: 'makeCompound', name: { de: 'Verschachteln (Compound Clip)', en: 'Nest (compound clip)' }, cat: 'clip', key: 'Ctrl+G', run: ({ ids, name } = {}) => makeCompound(ids || [...store.selection], name) },
  { id: 'openCompound', name: { de: 'Verschachtelten Clip öffnen', en: 'Open nested clip' }, cat: 'clip', run: () => { const c = store.primaryClip(); if (!c?.seqId) throw new Error(L('Kein verschachtelter Clip ausgewählt', 'No nested clip selected')); switchSeq(c.seqId); } },
  { id: 'makeMulticam', name: { de: 'Multicam aus Auswahl (Audio-Sync)', en: 'Multicam from selection (audio sync)' }, cat: 'clip', run: ({ ids, sync } = {}) => makeMulticam(ids || [...store.selection], { sync }) },
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: 'camAngle' + (i + 1), name: { de: `Multicam: Kamera ${i + 1}`, en: `Multicam: angle ${i + 1}` }, cat: 'clip', key: String(i + 1), run: () => { if (!cutToAngle(i)) return { ok: false }; } })),
]);
