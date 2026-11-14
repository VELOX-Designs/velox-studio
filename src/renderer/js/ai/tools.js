// "AI" / analysis tools – all local: FFmpeg analysis filters, DSP beat tracking, whisper.cpp (built into
// FFmpeg), Windows speech synthesis, template tracking, motion-aware reframing and the Auto-Edit engine.
import { store, clipEnd, sourceTime, splitAt, newClip, setClipRamp, sourceLength, removeClip, rippleTrack, dropBrokenTransitions, defaultTransform, rippleDeleteRange } from '../core/project.js';
import { uid, el, bus, clamp, deepClone, tc } from '../core/util.js';
import { L, N } from '../core/i18n.js';
import { settings, paths, setSetting } from '../core/settings.js';
import { registerCommands, run } from '../core/commands.js';
import { run as ff, decodePcm, makePeaks, stabilize, parseSrt, FFMPEG, cacheKey, cacheDir } from '../core/ffmpeg.js';
import { importFiles, peaks, addTextClip, freeVideoTrack, freeAudioTrack, placeMedia, addSolidClip } from '../core/media.js';
import { modal, toast, progressModal, promptBox, confirmBox } from '../ui/dialogs.js';
import { defaultParams } from '../render/effects.js';
import { VELOCITY_PRESETS, BUILTIN_PRESETS } from '../ui/presets.js';
import { setTrackRect } from '../ui/viewer.js';
import { setKeyframe } from '../core/keyframes.js';
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const frame = (t) => Math.round(t * store.fps) / store.fps;
const selVideo = () => { const c = store.selectedClips().find((x) => x.type === 'video') || store.selectedClips().find((x) => x.type === 'image'); if (!c) throw new Error(L('Bitte einen Videoclip auswählen', 'Please select a video clip')); return c; };
const selAudioish = () => { const s = store.selectedClips(); const c = s.find((x) => x.type === 'audio') || s.find((x) => x.type === 'video'); if (!c) throw new Error(L('Bitte einen Clip mit Audio auswählen', 'Please select a clip with audio')); return c; };
// map media source time → timeline time for a (non-ramped) clip
const srcToTl = (c, s) => c.start + (c.reverse ? (c.in + sourceLength(c) - s) : (s - c.in)) / (c.speed || 1);

// ------------------------------------------------------------------ scene detection
export async function detectScenes(file, start, len, threshold = 0.32, onProgress) {
  const out = [];
  await ff(['-ss', String(start), '-t', String(len), '-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], {
    duration: len, onProgress,
    onStderr: (s) => { for (const m of s.matchAll(/pts_time:([\d.]+)/g)) out.push(start + parseFloat(m[1])); },
  });
  return out;
}

// ------------------------------------------------------------------ silence detection
export async function detectSilence(file, start, len, noiseDb = -35, minDur = 0.4) {
  const ranges = []; let cur = null;
  await ff(['-ss', String(start), '-t', String(len), '-i', file, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-'], {
    onStderr: (s) => {
      for (const m of s.matchAll(/silence_start: ([\d.]+)/g)) cur = start + parseFloat(m[1]);
      for (const m of s.matchAll(/silence_end: ([\d.]+)/g)) { if (cur != null) ranges.push([cur, start + parseFloat(m[1])]); cur = null; }
    },
  });
  if (cur != null) ranges.push([cur, start + len]);
  return ranges;
}

// ------------------------------------------------------------------ beat tracking (spectral flux + autocorrelation tempo + DP phase)
export async function detectBeats(file, start = 0, len = 0) {
  const sr = 22050;
  const pcm = await decodePcm(file, sr, 1, start, len);
  const hop = 441, win = 1024; // 50 frames/s
  const n = Math.floor((pcm.length - win) / hop);
  if (n < 50) return { bpm: 0, beats: [], onsets: [] };
  const env = new Float32Array(n);
  let prevLow = 0, prevAll = 0;
  for (let i = 0; i < n; i++) {
    let low = 0, all = 0, lp = 0;
    for (let j = 0; j < win; j++) { const v = pcm[i * hop + j]; lp += (v - lp) * 0.06; low += lp * lp; all += v * v; }
    const L1 = Math.log(1e-6 + low), L2 = Math.log(1e-6 + all);
    env[i] = Math.max(0, L1 - prevLow) * 1.5 + Math.max(0, L2 - prevAll);
    prevLow = L1; prevAll = L2;
  }
  // normalise / smooth
  let mean = 0; for (const v of env) mean += v; mean /= n;
  for (let i = 0; i < n; i++) env[i] = Math.max(0, env[i] - mean * 0.5);
  const fpsE = sr / hop;
  // tempo via autocorrelation 70..180 bpm
  let best = 0, bestLag = 25;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * fpsE; let s = 0;
    for (let i = Math.ceil(lag * 2); i < n; i++) s += env[i] * (interp(env, i - lag) + 0.5 * interp(env, i - lag * 2));
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2)); // prefer ~120
    if (s * w > best) { best = s * w; bestLag = lag; }
  }
  const bpm = (60 * fpsE) / bestLag;
  // phase: maximise onset energy at beat positions
  let bestPhase = 0, bestScore = -1;
  for (let ph = 0; ph < bestLag; ph += 0.5) { let s = 0; for (let t = ph; t < n; t += bestLag) s += interp(env, t); if (s > bestScore) { bestScore = s; bestPhase = ph; } }
  // local refinement of every beat (±60ms)
  const beats = [];
  for (let t = bestPhase; t < n; t += bestLag) {
    let bt = t, bv = -1;
    for (let d = -3; d <= 3; d++) { const v = env[Math.round(t + d)] || 0; if (v > bv) { bv = v; bt = t + d; } }
    beats.push(start + bt / fpsE + win / sr);
  }
  // strong onsets (drops/hits)
  const onsets = [];
  const thr = [...env].sort((a, b) => b - a)[Math.floor(n * 0.03)] || 0;
  for (let i = 1; i < n - 1; i++) if (env[i] > thr && env[i] >= env[i - 1] && env[i] >= env[i + 1]) { const ot = start + i / fpsE + win / sr; if (!onsets.length || ot - onsets[onsets.length - 1] > 0.25) onsets.push(ot); }
  return { bpm: Math.round(bpm * 10) / 10, beats, onsets };
}
function interp(a, x) { const i = Math.floor(x), f = x - i; return (a[i] || 0) * (1 - f) + (a[i + 1] || 0) * f; }

// loudness per window from cached peaks (100/s) → highlight score
export async function loudnessCurve(m, winSec = 0.5) {
  let pk = peaks.get(m.id);
  if (!pk) { pk = await makePeaks(m); peaks.set(m.id, pk); }
  const w = Math.max(1, Math.round(winSec * 100)); const out = [];
  for (let i = 0; i < pk.length; i += w) { let s = 0; for (let j = i; j < Math.min(pk.length, i + w); j++) s += pk[j] * pk[j]; out.push(Math.sqrt(s / w)); }
  return out;
}

// ------------------------------------------------------------------ whisper subtitles (FFmpeg whisper filter, whisper.cpp model)
const WHISPER_MODELS = { base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin', small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', 'large-v3-turbo': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin' };
async function ensureWhisperModel() {
  if (settings.whisperModel && fs.existsSync(settings.whisperModel)) return settings.whisperModel;
  const dir = path.join(paths.userData, 'models');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (f.startsWith('ggml-') && f.endsWith('.bin')) { setSetting('whisperModel', path.join(dir, f)); return settings.whisperModel; }
  return new Promise((resolve) => {
    const pick = el('select', {}, el('option', { value: 'base' }, 'base (148 MB, schnell)'), el('option', { value: 'small' }, 'small (488 MB, genauer)'), el('option', { value: 'large-v3-turbo' }, 'large-v3-turbo q5 (574 MB, am besten)'));
    modal({ title: L('Sprachmodell für Untertitel', 'Speech model for subtitles'),
      body: el('div', { style: { maxWidth: '480px', lineHeight: '1.6' } },
        el('p', {}, L('Automatische Untertitel laufen komplett lokal mit whisper.cpp (in FFmpeg eingebaut). Dafür wird einmalig ein Modell benötigt.', 'Auto subtitles run fully locally with whisper.cpp (built into FFmpeg). A model is needed once.')),
        el('p', {}, L('Download von huggingface.co/ggerganov/whisper.cpp:', 'Download from huggingface.co/ggerganov/whisper.cpp:')), pick,
        el('p', { class: 'muted' }, L('Oder eine vorhandene ggml-*.bin wählen.', 'Or choose an existing ggml-*.bin.'))),
      buttons: [
        { label: L('Datei wählen…', 'Choose file…'), onClick: async () => { const r = await require('electron').ipcRenderer.invoke('dialog:open', { filters: [{ name: 'ggml', extensions: ['bin'] }], properties: ['openFile'] }); if (r.canceled) return false; setSetting('whisperModel', r.filePaths[0]); resolve(r.filePaths[0]); } },
        { label: L('Abbrechen', 'Cancel'), onClick: () => resolve(null) },
        { label: L('Herunterladen', 'Download'), cls: 'primary', onClick: async () => { const url = WHISPER_MODELS[pick.value]; const out = path.join(dir, path.basename(url)); try { await download(url, out); setSetting('whisperModel', out); resolve(out); } catch (e) { toast(e.message, 'err'); resolve(null); } } },
      ] });
  });
}
async function download(url, out) {
  const pm = progressModal(L('Lade Modell…', 'Downloading model…')); const ac = new AbortController(); pm.onCancel?.(() => ac.abort());
  const { fetchTo } = await import('../core/setup.js'); const tmp = out + '.part'; let last = null;
  try {
    for (let a = 0; a < 4; a++) {
      try { await fetchTo(url, tmp, (p, got, tot) => pm.set(p, `${(got / 1e6).toFixed(0)} / ${(tot / 1e6).toFixed(0)} MB`), ac.signal); fs.renameSync(tmp, out); return; }
      catch (e) { last = e; if (ac.signal.aborted) throw new Error(L('Abgebrochen', 'Cancelled')); await new Promise((r) => setTimeout(r, 2000 * (a + 1))); }
    }
    throw new Error(L('Download fehlgeschlagen (Internet/Firewall?): ', 'Download failed: ') + (last?.message || ''));
  } finally { pm.close(); }
}
export async function transcribe(file, start, len, lang = 'auto', onProgress) {
  const model = await ensureWhisperModel(); if (!model) throw new Error(L('Kein Sprachmodell', 'No speech model'));
  const srt = path.join(cacheDir('subs'), cacheKey(file) + `_${start.toFixed(2)}_${len.toFixed(2)}.srt`);
  const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  await ff(['-ss', String(start), '-t', String(len), '-i', file, '-vn', '-af', `aresample=16000,whisper=model='${esc(model)}':language=${lang}:queue=8:destination='${esc(srt)}':format=srt`, '-f', 'null', '-'], { duration: len, onProgress });
  return parseSrt(fs.readFileSync(srt, 'utf8'));
}

// ------------------------------------------------------------------ TTS (Windows SAPI)
export function listVoices() {
  return new Promise((res) => execFile('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture }'], { windowsHide: true }, (e, out) => res(e ? [] : out.split(/\r?\n/).filter(Boolean).map((l) => { const [n, c] = l.split('|'); return { name: n, culture: c }; }))));
}
export function tts(text, voice, rate = 0, out) {
  return new Promise((res, rej) => {
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voice ? `$s.SelectVoice('${voice.replace(/'/g, "''")}');` : ''} $s.Rate = ${rate}; $s.SetOutputToWaveFile('${out.replace(/'/g, "''")}'); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()`;
    const p = spawn('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true });
    p.stdin.end(text);
    p.on('close', (c) => (c === 0 && fs.existsSync(out) ? res(out) : rej(new Error('TTS fehlgeschlagen'))));
  });
}

// ------------------------------------------------------------------ template tracker on low-res grayscale frames
async function grayFrames(file, start, len, fps, w, h, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-v', 'error', '-ss', String(start), '-t', String(len), '-i', file, '-an', '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
    const chunks = []; let got = 0; const fsz = w * h; const total = Math.ceil(len * fps);
    p.stdout.on('data', (d) => { chunks.push(d); got += d.length; onProgress?.(Math.min(1, got / fsz / total)); });
    p.on('error', reject);
    p.on('close', () => { const b = Buffer.concat(chunks); const frames = []; for (let i = 0; i + fsz <= b.length; i += fsz) frames.push(b.subarray(i, i + fsz)); resolve(frames); });
  });
}
function trackTemplate(frames, w, h, rect) {
  // rect in pixels {x,y,w,h}; returns array of centres
  const out = [];
  let tx = Math.round(rect.x), ty = Math.round(rect.y); const tw = Math.max(4, Math.round(rect.w)), th = Math.max(4, Math.round(rect.h));
  let tpl = crop(frames[0], w, tx, ty, tw, th);
  const R = Math.max(6, Math.round(Math.max(tw, th) * 0.5));
  for (let f = 0; f < frames.length; f++) {
    if (f > 0) {
      let best = Infinity, bx = tx, by = ty;
      const step = 2;
      for (let dy = -R; dy <= R; dy += step) for (let dx = -R; dx <= R; dx += step) {
        const x = tx + dx, y = ty + dy; if (x < 0 || y < 0 || x + tw > w || y + th > h) continue;
        const s = sad(frames[f], w, x, y, tpl, tw, th, best); if (s < best) { best = s; bx = x; by = y; }
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = bx + dx, y = by + dy; if (x < 0 || y < 0 || x + tw > w || y + th > h) continue; const s = sad(frames[f], w, x, y, tpl, tw, th, best); if (s < best) { best = s; tx = x; ty = y; } }
      if (best === Infinity) { tx = bx; ty = by; } else if (tx === undefined) { tx = bx; ty = by; }
      // slowly adapt template to appearance changes
      const cur = crop(frames[f], w, tx, ty, tw, th); for (let i = 0; i < tpl.length; i++) tpl[i] = tpl[i] * 0.85 + cur[i] * 0.15;
    }
    out.push({ x: tx + tw / 2, y: ty + th / 2 });
  }
  return out;
}
function crop(fr, w, x, y, cw, ch) { const o = new Float32Array(cw * ch); for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) o[j * cw + i] = fr[(y + j) * w + x + i]; return o; }
function sad(fr, w, x, y, tpl, tw, th, limit) { let s = 0; for (let j = 0; j < th; j += 2) { const row = (y + j) * w + x; for (let i = 0; i < tw; i += 2) s += Math.abs(fr[row + i] - tpl[j * tw + i]); if (s > limit) return s; } return s; }

// motion centroid per sample for auto reframing
function motionCentroids(frames, w, h) {
  const xs = [];
  for (let f = 0; f < frames.length; f++) {
    const a = frames[f], b = frames[Math.max(0, f - 1)];
    let sx = 0, sw = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const i = y * w + x; const d = Math.abs(a[i] - b[i]); if (d > 12) { sx += x * d; sw += d; } }
    // fallback: saliency by contrast against mean
    xs.push(sw > 50 ? sx / sw / w : null);
  }
  // fill gaps & smooth
  let last = 0.5; for (let i = 0; i < xs.length; i++) { if (xs[i] == null) xs[i] = last; last = xs[i]; }
  const sm = xs.map((_, i) => { let s = 0, n = 0; for (let k = -6; k <= 6; k++) { const v = xs[i + k]; if (v != null) { s += v; n++; } } return s / n; });
  return sm;
}

// ------------------------------------------------------------------ auto edit engine
export const AUTO_STYLES = {
  montage: { name: 'Gaming Montage', beatsPerCut: 2, ramp: ['montage', 'velocityEdit', 'bullet', null, 'flashIn'], rampChance: 0.6, trans: ['flash', 'zoompunch', 'whippan', 'rgbsplit', 'shake'], transEvery: 4, look: 'game_impact', adj: null, origAudio: 0, shakeOnDrops: true },
  cinematic: { name: 'Cinematic', beatsPerCut: 8, ramp: [null, null, 'smooth', 'slowEnd'], rampChance: 0.4, trans: ['dissolve', 'dipblack', 'lightleak', 'blur'], transEvery: 1, look: null, adj: 'cine_239', origAudio: 0.15 },
  tiktok: { name: 'TikTok Hype', beatsPerCut: 1, ramp: ['jumpcut', 'flashIn', null], rampChance: 0.35, trans: ['zoompunch', 'glitch', 'flash', 'swipe'], transEvery: 2, look: 'game_beat', adj: null, origAudio: 0, shakeOnDrops: true },
  vlog: { name: 'Vlog / Story', beatsPerCut: 8, ramp: [null], rampChance: 0, trans: ['dissolve', 'slide', 'iris'], transEvery: 2, look: null, adj: 'look_summer', origAudio: 1, keepAudio: true },
  realism: { name: 'Realism Showcase', beatsPerCut: 4, ramp: [null, 'smooth'], rampChance: 0.3, trans: ['dissolve', 'flare', 'blur'], transEvery: 1, look: null, adj: 'real_cine', origAudio: 0.1, kenburns: true },
};

export async function autoEdit({ style = 'montage', mediaIds, musicId, length = 0, replace = true, title = '', beatsPerCut = 0 }, onStatus = () => {}) {
  const S = AUTO_STYLES[style] || AUTO_STYLES.montage;
  const P = store.p;
  const vids = (mediaIds?.length ? mediaIds.map((id) => store.media(id)) : P.media.filter((m) => m.type === 'video' || m.type === 'image')).filter((m) => m && (m.type === 'video' || m.type === 'image'));
  if (!vids.length) throw new Error(L('Keine Videoclips in der Medien-Bibliothek', 'No video clips in the media pool'));
  const music = musicId ? store.media(musicId) : P.media.find((m) => m.type === 'audio');
  let beats = [], onsets = [], bpm = 120, musicLen = 0;
  if (music) {
    onStatus(L('Analysiere Musik (Beats)…', 'Analysing music (beats)…'));
    const r = await detectBeats(music.path, 0, length ? Math.min(music.duration, length + 2) : music.duration);
    beats = r.beats; onsets = r.onsets; bpm = r.bpm || 120; musicLen = length ? Math.min(length, music.duration) : music.duration;
  } else {
    musicLen = length || Math.min(60, vids.reduce((s, m) => s + (m.duration || 3), 0));
    for (let t = 0; t < musicLen; t += 60 / bpm) beats.push(t);
  }
  const bpc = beatsPerCut || S.beatsPerCut;
  const cuts = [0]; for (let i = bpc; i < beats.length; i += bpc) if (beats[i] < musicLen - 0.3) cuts.push(beats[i]);
  cuts.push(musicLen);
  onStatus(L('Bewerte Clips (Highlights)…', 'Scoring clips (highlights)…'));
  const scores = new Map();
  for (const m of vids) if (m.type === 'video') { try { scores.set(m.id, m.hasAudio ? await loudnessCurve(m, 0.5) : null); } catch { scores.set(m.id, null); } }
  const used = new Map(); // mediaId -> list of [a,b] used ranges
  const pickSegment = (m, need) => {
    if (m.type === 'image') return 0;
    const maxStart = Math.max(0, m.duration - need - 0.05);
    const sc = scores.get(m.id);
    const ranges = used.get(m.id) || [];
    let best = Math.random() * maxStart, bestScore = -1;
    for (let k = 0; k < 40; k++) {
      const s = (k / 40) * maxStart + Math.random() * (maxStart / 40);
      if (ranges.some(([a, b]) => s < b && s + need > a)) continue;
      let v = Math.random() * 0.2;
      if (sc) { const i0 = Math.floor(s / 0.5), i1 = Math.ceil((s + need) / 0.5); for (let i = i0; i < i1; i++) v = Math.max(v, sc[i] || 0); }
      if (v > bestScore) { bestScore = v; best = s; }
    }
    ranges.push([best, best + need]); used.set(m.id, ranges);
    return best;
  };
  onStatus(L('Baue Timeline…', 'Building timeline…'));
  store.edit('Auto-Edit', (p) => {
    if (replace) { p.clips = []; p.transitions = []; p.markers = []; }
    const vTrack = p.tracks.find((t) => t.kind === 'video');
    const aTracks = p.tracks.filter((t) => t.kind === 'audio');
    let aMusic = aTracks[1] || aTracks[0];
    if (aTracks.length < 2) { const nt = { id: uid('trk'), kind: 'audio', name: 'A' + (aTracks.length + 1), muted: false, locked: false, hidden: false, solo: false, volume: 1, height: 48 }; p.tracks.push(nt); aMusic = nt; }
    const aOrig = p.tracks.find((t) => t.kind === 'audio');
    const created = [];
    let order = [...vids].sort(() => Math.random() - 0.5);
    for (let i = 0; i < cuts.length - 1; i++) {
      const t0 = cuts[i], t1 = cuts[i + 1], d = t1 - t0; if (d < 0.1) continue;
      const m = order[i % order.length];
      const presetId = Math.random() < S.rampChance ? S.ramp[Math.floor(Math.random() * S.ramp.length)] : null;
      const ramp = presetId ? VELOCITY_PRESETS[presetId]?.ramp : null;
      let avg = 1;
      if (ramp) { const tmp = newClip({ ramp, dur: 1 }); avg = sourceLength(tmp); }
      let need = d * avg;
      let rampUse = ramp;
      if (m.type === 'video' && need > m.duration - 0.1) { rampUse = null; need = d; avg = 1; }
      if (m.type === 'video' && need > m.duration) need = m.duration;
      const inP = pickSegment(m, need);
      const linkId = m.type === 'video' && m.hasAudio && S.origAudio > 0 ? uid('lnk') : null;
      const c = newClip({ trackId: vTrack.id, type: m.type, mediaId: m.id, name: m.name, start: t0, dur: d, in: inP, ramp: rampUse ? deepClone(rampUse) : null, linkId });
      if (m.type === 'video' && !rampUse && need < d) c.speed = need / d;
      if (rampUse && VELOCITY_PRESETS[presetId]?.fx) c.effects.push({ id: uid('fx'), type: 'motionblur', enabled: true, params: defaultParams('motionblur') });
      if (S.kenburns || m.type === 'image') c.effects.push({ id: uid('fx'), type: 'kenburns', enabled: true, params: { zoom: 0.12, panX: (Math.random() - 0.5) * 120, panY: 0 } });
      if (S.shakeOnDrops && onsets.some((o) => o >= t0 && o < t0 + 0.25)) c.effects.push({ id: uid('fx'), type: 'shake', enabled: true, params: { ...defaultParams('shake'), amp: 22, freq: 14 } });
      // fill frame for vertical formats
      if (m.width && p.settings.height > p.settings.width && m.width > m.height) { const fit = Math.min(p.settings.width / m.width, p.settings.height / m.height); c.transform.scale = Math.max(p.settings.width / m.width, p.settings.height / m.height) / fit; }
      p.clips.push(c); created.push(c);
      if (linkId) p.clips.push(newClip({ trackId: aOrig.id, type: 'audio', mediaId: m.id, name: m.name, start: t0, dur: d, in: inP, ramp: c.ramp ? deepClone(c.ramp) : null, speed: c.speed, linkId, volume: S.origAudio, audio: { ...newClip({}).audio, duck: !S.keepAudio } }));
    }
    // transitions
    created.forEach((c, i) => {
      if (i === created.length - 1) return;
      if ((i + 1) % S.transEvery !== 0) return;
      const type = S.trans[Math.floor(Math.random() * S.trans.length)];
      const nxt = created[i + 1];
      p.transitions.push({ id: uid('tr'), a: c.id, b: nxt.id, type, dur: Math.min(Math.max(0.2, 60 / bpm / 2), c.dur * 0.9, nxt.dur * 0.9), params: { intensity: 1, dir: Math.floor(Math.random() * 2) } });
    });
    // look
    if (S.look) { const pr = BUILTIN_PRESETS.find((x) => x.id === S.look); for (const c of created) for (const f of pr.effects) c.effects.push({ id: uid('fx'), type: f.type, enabled: true, params: Object.assign(defaultParams(f.type), deepClone(f.params)) }); }
    if (S.adj) {
      const pr = BUILTIN_PRESETS.find((x) => x.id === S.adj);
      const vt2 = freeVideoTrack(p, 0, musicLen, 1);
      const a = newClip({ trackId: vt2.id, type: 'adjust', name: pr.name, start: 0, dur: musicLen, effects: pr.effects.map((f) => ({ id: uid('fx'), type: f.type, enabled: true, params: Object.assign(defaultParams(f.type), deepClone(f.params)) })) });
      p.clips.push(a);
    }
    // music
    if (music) p.clips.push(newClip({ trackId: aMusic.id, type: 'audio', mediaId: music.id, name: music.name, start: 0, dur: musicLen, in: 0, fadeOut: Math.min(2, musicLen / 4) }));
    // beat markers
    beats.filter((b) => b < musicLen).forEach((b, i) => { if (i % bpc === 0) p.markers.push({ id: uid('mk'), t: b, name: '', color: '#7c5cff' }); });
    if (title) { const tc2 = addTextClip(p, 0, { content: title, size: 150, weight: 900, anim: 'pop', animOut: 'zoomOut', upper: true, shadow: 0.6 }, Math.min(3, musicLen)); }
    dropBrokenTransitions(p);
  });
  return { bpm, cuts: cuts.length - 1, length: musicLen };
}

// ------------------------------------------------------------------ commands
registerCommands([
  { id: 'aiSceneDetect', name: { de: 'Szenen erkennen & teilen', en: 'Detect scenes & split' }, cat: 'ai', args: '{ threshold? }', run: async ({ threshold = 0.32 } = {}) => {
    const c = selVideo(); const m = store.media(c.mediaId);
    const pm = progressModal(L('Szenenerkennung…', 'Detecting scenes…'));
    try {
      const len = sourceLength(c); const lo = c.reverse ? c.in : c.in;
      const cuts = await detectScenes(m.path, lo, len, threshold, (p) => pm.set(p));
      const times = cuts.map((s) => frame(srcToTl(c, s))).filter((t) => t > c.start + 0.1 && t < clipEnd(c) - 0.1);
      store.edit('Szenen teilen', (p) => { const ids = new Set([c.id, ...store.linked(c).map((l) => l.id)]); for (const t of times.sort((a, b) => b - a)) { const r = splitAt(p, t, ids); } });
      toast(L(`${times.length} Szenenwechsel gefunden`, `${times.length} scene changes found`), 'ok');
      return times;
    } finally { pm.close(); }
  } },
  { id: 'aiRemoveSilence', name: { de: 'Stille entfernen', en: 'Remove silence' }, cat: 'ai', args: '{ noiseDb?, minDur?, pad? }', run: async ({ noiseDb = -35, minDur = 0.45, pad = 0.08 } = {}) => {
    const c = selAudioish(); const m = store.media(c.mediaId);
    if (!m.hasAudio && m.type !== 'audio') throw new Error(L('Clip hat kein Audio', 'Clip has no audio'));
    const ranges = await detectSilence(m.path, c.in, sourceLength(c), noiseDb, minDur);
    const tl = ranges.map(([a, b]) => [srcToTl(c, a) + pad, srcToTl(c, b) - pad]).map(([a, b]) => [Math.max(c.start, a), Math.min(clipEnd(c), b)]).filter(([a, b]) => b - a > 0.1).sort((x, y) => y[0] - x[0]);
    if (!tl.length) { toast(L('Keine Stille gefunden', 'No silence found')); return []; }
    const trackIds = new Set([c.trackId, ...store.linked(c).map((l) => l.trackId)]);
    store.edit('Stille entfernen', (p) => { for (const [a, b] of tl) rippleDeleteRange(p, frame(a), frame(b), trackIds); });
    toast(L(`${tl.length} stille Stellen entfernt`, `${tl.length} silent parts removed`), 'ok');
    return tl;
  } },
  { id: 'aiBeats', name: { de: 'Beats erkennen → Marker', en: 'Detect beats → markers' }, cat: 'ai', run: async () => {
    const c = store.selectedClips().find((x) => x.type === 'audio') || store.p.clips.find((x) => x.type === 'audio');
    if (!c) throw new Error(L('Kein Audioclip gefunden', 'No audio clip found'));
    const m = store.media(c.mediaId);
    toast(L('Analysiere Beats…', 'Analysing beats…'));
    const r = await detectBeats(m.path, c.in, sourceLength(c));
    const times = r.beats.map((s) => srcToTl(c, s)).filter((t) => t >= c.start && t < clipEnd(c));
    store.edit('Beat-Marker', (p) => { for (const t of times) p.markers.push({ id: uid('mk'), t: frame(t), name: '', color: '#7c5cff' }); });
    toast(L(`${r.bpm} BPM · ${times.length} Beats markiert`, `${r.bpm} BPM · ${times.length} beats marked`), 'ok');
    return { bpm: r.bpm, beats: times };
  } },
  { id: 'aiCutToBeats', name: { de: 'Auswahl auf Beat-Marker schneiden', en: 'Cut selection to beat markers' }, cat: 'ai', run: () => {
    const s = store.selectedClips(); if (!s.length) throw new Error(L('Clips auswählen', 'Select clips'));
    const ids = new Set(s.flatMap((c) => [c.id, ...store.linked(c).map((l) => l.id)]));
    store.edit('Auf Beats schneiden', (p) => { for (const mk of [...p.markers].sort((a, b) => b.t - a.t)) { const r = splitAt(p, mk.t, ids); r.forEach((x) => ids.add(x.id)); } });
  } },
  { id: 'aiHighlights', name: { de: 'Highlights finden', en: 'Find highlights' }, cat: 'ai', run: async ({ count = 8 } = {}) => {
    const c = selAudioish(); const m = store.media(c.mediaId);
    const curve = await loudnessCurve(m, 0.5);
    const lo = Math.floor(c.in / 0.5), hi = Math.ceil((c.in + sourceLength(c)) / 0.5);
    const cand = []; for (let i = lo; i < hi; i++) cand.push([i * 0.5, curve[i] || 0]);
    cand.sort((a, b) => b[1] - a[1]);
    const picks = []; for (const [s] of cand) { if (picks.every((x) => Math.abs(x - s) > 4)) picks.push(s); if (picks.length >= count) break; }
    store.edit('Highlights', (p) => { for (const s of picks) p.markers.push({ id: uid('mk'), t: frame(srcToTl(c, s)), name: '★', color: '#ffb547' }); });
    toast(L(`${picks.length} Highlights markiert`, `${picks.length} highlights marked`), 'ok');
    return picks.map((s) => srcToTl(c, s));
  } },
  { id: 'aiSubtitles', name: { de: 'Automatische Untertitel', en: 'Auto subtitles' }, cat: 'ai', args: '{ lang?, style? }', run: async ({ lang, style } = {}) => {
    const c = selAudioish(); const m = store.media(c.mediaId);
    if (!lang) {
      lang = await new Promise((res) => { const s = el('select', {}, el('option', { value: 'auto' }, 'Auto'), el('option', { value: 'de' }, 'Deutsch'), el('option', { value: 'en' }, 'English'), el('option', { value: 'fr' }, 'Français'), el('option', { value: 'es' }, 'Español'), el('option', { value: 'tr' }, 'Türkçe')); s.value = settings.lang;
        modal({ title: L('Untertitel – Sprache', 'Subtitles – language'), body: s, buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: 'Start', cls: 'primary', onClick: () => s.value }], onClose: (v) => res(v) }); });
      if (!lang) return;
    }
    const pm = progressModal(L('Transkribiere (lokal)…', 'Transcribing (local)…'));
    try {
      const segs = await transcribe(m.path, c.in, sourceLength(c), lang, (p) => pm.set(p));
      const st = style || BUILTIN_PRESETS.find((x) => x.id === 'txt_tiktok').text;
      store.edit('Untertitel', (p) => {
        const tr = freeVideoTrack(p, c.start, clipEnd(c), 1);
        for (const sgm of segs) {
          const a = srcToTl(c, c.in + sgm.start), b = srcToTl(c, c.in + sgm.end);
          if (b <= a) continue;
          p.clips.push(newClip({ trackId: tr.id, type: 'text', name: sgm.text.slice(0, 30), start: frame(a), dur: Math.max(0.2, frame(b - a)), text: { ...defaultTextLite(), ...st, content: sgm.text, animDur: Math.min(0.4, (b - a) / 2) }, transform: { ...defaultTransform(), y: p.settings.height * 0.3 } }));
        }
      });
      toast(L(`${segs.length} Untertitel erstellt`, `${segs.length} subtitles created`), 'ok');
      return segs.length;
    } finally { pm.close(); }
  } },
  { id: 'importSrt', name: { de: 'SRT-Untertitel importieren', en: 'Import SRT subtitles' }, cat: 'ai', run: async ({ file } = {}) => {
    if (!file) { const r = await require('electron').ipcRenderer.invoke('dialog:open', { filters: [{ name: 'SRT', extensions: ['srt'] }], properties: ['openFile'] }); if (r.canceled) return; file = r.filePaths[0]; }
    const segs = parseSrt(fs.readFileSync(file, 'utf8'));
    const st = BUILTIN_PRESETS.find((x) => x.id === 'txt_sub').text;
    store.edit('SRT', (p) => { const end = Math.max(...segs.map((s) => s.end)); const tr = freeVideoTrack(p, 0, end, 1); for (const s of segs) p.clips.push(newClip({ trackId: tr.id, type: 'text', name: s.text.slice(0, 30), start: frame(s.start), dur: Math.max(0.2, s.end - s.start), text: { ...defaultTextLite(), ...st, content: s.text }, transform: { ...defaultTransform(), y: p.settings.height * 0.35 } })); });
    toast(L(`${segs.length} Untertitel importiert`, `${segs.length} subtitles imported`), 'ok');
  } },
  { id: 'exportSrt', name: { de: 'Untertitel als SRT exportieren', en: 'Export subtitles as SRT' }, cat: 'ai', run: async ({ file } = {}) => {
    const texts = store.p.clips.filter((c) => c.type === 'text').sort((a, b) => a.start - b.start);
    if (!file) { const r = await require('electron').ipcRenderer.invoke('dialog:save', { defaultPath: (store.p.name || 'subs') + '.srt', filters: [{ name: 'SRT', extensions: ['srt'] }] }); if (r.canceled) return; file = r.filePath; }
    const f = (t) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
    fs.writeFileSync(file, texts.map((c, i) => `${i + 1}\n${f(c.start)} --> ${f(clipEnd(c))}\n${c.text.content}\n`).join('\n'));
    toast('SRT: ' + file, 'ok');
  } },
  { id: 'aiTTS', name: { de: 'Text-zu-Sprache', en: 'Text to speech' }, cat: 'ai', args: '{ text?, voice?, rate? }', run: async ({ text, voice, rate } = {}) => {
    if (!text) {
      const voices = await listVoices();
      const ta = el('textarea', { rows: 5, style: { width: '420px' } }); ta.value = L('Willkommen zu meinem neuen Video!', 'Welcome to my new video!'); ta.addEventListener('keydown', (e) => e.stopPropagation());
      const vs = el('select', {}, ...voices.map((v) => el('option', { value: v.name }, `${v.name} (${v.culture})`)));
      const rs = el('input', { type: 'range', min: -10, max: 10, value: 0 });
      const r = await new Promise((res) => modal({ title: L('Text-zu-Sprache', 'Text to speech'), body: el('div', {}, ta, el('div', { class: 'form', style: { marginTop: '10px' } }, el('label', {}, L('Stimme', 'Voice')), vs, el('label', {}, L('Tempo', 'Rate')), rs)),
        buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('Erzeugen', 'Generate'), cls: 'primary', onClick: () => ({ text: ta.value, voice: vs.value, rate: +rs.value }) }], onClose: res }));
      if (!r) return; ({ text, voice, rate } = r);
    }
    const out = path.join(paths.userData, 'library', 'tts_' + Date.now() + '.wav'); fs.mkdirSync(path.dirname(out), { recursive: true });
    await tts(text, voice, rate || 0, out);
    const [m] = await importFiles([out]);
    store.edit('Sprache', (p) => { const tr = freeAudioTrack(p, store.time, store.time + m.duration); const cs = placeMedia(p, m, store.time, { audioTrackId: tr.id }); cs.forEach((c) => { c.audio.voice = true; }); store.select(cs.map((c) => c.id)); });
    toast(L('Sprachspur erstellt', 'Voice track created'), 'ok');
    return m.id;
  } },
  { id: 'aiEnhanceAudio', name: { de: 'Audio verbessern', en: 'Enhance audio' }, cat: 'ai', run: () => {
    const s = store.selectedClips().flatMap((c) => (c.type === 'audio' ? [c] : store.linked(c).filter((l) => l.type === 'audio')));
    if (!s.length) throw new Error(L('Audioclip auswählen', 'Select an audio clip'));
    store.edit('Audio verbessern', () => s.forEach((c) => Object.assign(c.audio, { voice: true, denoise: 0.5, eqHigh: Math.max(c.audio.eqHigh, 1.5) })));
    toast(L('Stimme verbessert (Rauschen, EQ, Kompressor)', 'Voice enhanced (noise, EQ, compressor)'), 'ok');
  } },
  { id: 'aiStabilize', name: { de: 'Stabilisieren', en: 'Stabilize' }, cat: 'ai', args: '{ smoothing? }', run: async ({ smoothing = 15 } = {}) => {
    const c = selVideo(); const m = store.media(c.mediaId);
    const pm = progressModal(L('Stabilisiere (vid.stab, 2 Durchgänge)…', 'Stabilizing (vid.stab, 2 passes)…'));
    const ac = new AbortController(); pm.onCancel(() => ac.abort());
    try {
      const out = await stabilize(m, { smoothing, onProgress: (p) => pm.set(p), signal: ac.signal });
      const [nm] = await importFiles([out]);
      store.edit('Stabilisiert', () => { for (const x of [c, ...store.linked(c)]) if (x.type === 'video') { x.mediaId = nm.id; x.name = m.name + ' (stabil)'; } });
      toast(L('Stabilisierung fertig', 'Stabilization done'), 'ok');
    } finally { pm.close(); }
  } },
  { id: 'aiTrack', name: { de: 'Objekt verfolgen', en: 'Track object' }, cat: 'ai', run: async () => {
    const c = selVideo(); const m = store.media(c.mediaId);
    if (c.type !== 'video') throw new Error(L('Tracking braucht einen Videoclip', 'Tracking needs a video clip'));
    const rect = { x: 0.42, y: 0.4, w: 0.16, h: 0.2 };
    setTrackRect(rect);
    const targets = store.p.clips.filter((x) => x.id !== c.id && x.type !== 'audio' && x.start < clipEnd(c) && clipEnd(x) > c.start);
    const tsel = el('select', {}, el('option', { value: '' }, L('— Nur Daten / neuer Text —', '— New text that follows —')), ...targets.map((x) => el('option', { value: x.id }, x.name || x.type)));
    const ok = await new Promise((res) => modal({ title: L('Objekt-Tracking', 'Object tracking'), body: el('div', { style: { maxWidth: '420px', lineHeight: '1.6' } }, el('p', {}, L('Ziehe den orangefarbenen Rahmen in der Vorschau auf das Objekt (am aktuellen Frame). Dann „Tracken“.', 'Drag the orange box in the preview onto the object (current frame), then "Track".')), el('div', { class: 'form' }, el('label', {}, L('Folgen lassen', 'Attach to')), tsel)),
      buttons: [{ label: L('Abbrechen', 'Cancel'), value: false }, { label: L('Tracken', 'Track'), cls: 'primary', value: true }], onClose: res }));
    setTrackRect(null);
    if (!ok) return;
    const P = store.p.settings;
    const fit = Math.min(P.width / m.width, P.height / m.height);
    const lt0 = Math.max(0, store.time - c.start);
    const tw = 320, th = Math.round((320 * m.height) / m.width / 2) * 2;
    // rect from project-normalised to media pixels (assuming untransformed clip)
    const toMedia = (nx, ny) => [((nx - 0.5) * P.width / fit) + m.width / 2, ((ny - 0.5) * P.height / fit) + m.height / 2];
    const [mx0, my0] = toMedia(rect.x, rect.y), [mx1, my1] = toMedia(rect.x + rect.w, rect.y + rect.h);
    const sx = tw / m.width;
    const fpsT = Math.min(30, store.fps);
    const pm = progressModal(L('Tracke…', 'Tracking…'));
    try {
      const s0 = sourceTime(c, lt0), s1 = sourceTime(c, c.dur);
      const frames = await grayFrames(m.path, s0, Math.max(0.2, s1 - s0), fpsT, tw, th, (p) => pm.set(p * 0.6));
      pm.set(0.7, L('Berechne Bewegung…', 'Computing motion…'));
      const pts = trackTemplate(frames, tw, th, { x: mx0 * sx, y: my0 * sx, w: (mx1 - mx0) * sx, h: (my1 - my0) * sx });
      const startC = pts[0];
      store.edit('Tracking', (p) => {
        let target = tsel.value ? p.clips.find((x) => x.id === tsel.value) : null;
        if (!target) { target = addTextClip(p, c.start + lt0, { content: '●', size: 80, color: '#ffb547' }, Math.max(0.5, c.dur - lt0)); const [nx, ny] = [((startC.x / sx) - m.width / 2) * fit, ((startC.y / sx) - m.height / 2) * fit]; target.transform.x = nx; target.transform.y = ny; }
        const bx = typeof target.transform.x === 'number' ? target.transform.x : 0, by = typeof target.transform.y === 'number' ? target.transform.y : 0;
        let kx = { kf: [] }, ky = { kf: [] };
        pts.forEach((pt, i) => { if (i % 2) return; const tl = c.start + lt0 + i / fpsT / (c.speed || 1); const lt = tl - target.start; if (lt < 0 || lt > target.dur) return; const dx = ((pt.x - startC.x) / sx) * fit, dy = ((pt.y - startC.y) / sx) * fit; kx.kf.push({ t: lt, v: Math.round(bx + dx), e: 'linear' }); ky.kf.push({ t: lt, v: Math.round(by + dy), e: 'linear' }); });
        if (kx.kf.length) { target.transform.x = kx; target.transform.y = ky; }
        store.select([target.id]);
      });
      toast(L(`Tracking fertig (${pts.length} Frames)`, `Tracking done (${pts.length} frames)`), 'ok');
    } finally { pm.close(); }
  } },
  { id: 'aiReframe', name: { de: 'Auto-Reframe', en: 'Auto reframe' }, cat: 'ai', args: '{ aspect?: "9:16"|"1:1"|"4:5"|"16:9" }', run: async ({ aspect } = {}) => {
    if (!aspect) {
      aspect = await new Promise((res) => { const s = el('select', {}, ...['9:16', '1:1', '4:5', '16:9'].map((a) => el('option', { value: a }, a))); modal({ title: 'Auto-Reframe', body: el('div', {}, el('p', { class: 'muted' }, L('Projekt wird umformatiert; jeder Clip füllt das Bild und folgt der Bewegung im Bild.', 'Project gets reformatted; each clip fills the frame and follows on-screen motion.')), s), buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: 'Start', cls: 'primary', onClick: () => s.value }], onClose: res }); });
      if (!aspect) return;
    }
    const [aw, ah] = aspect.split(':').map(Number);
    const S = store.p.settings; const base = Math.max(S.width, S.height) >= 3000 ? 2160 : 1080;
    const nw = aw >= ah ? Math.round((base * aw) / ah / 2) * 2 : base, nh = aw >= ah ? base : Math.round((base * ah) / aw / 2) * 2;
    const clips = store.p.clips.filter((c) => c.type === 'video' || c.type === 'image');
    const pm = progressModal(L('Analysiere Motive…', 'Analysing subjects…'));
    const tracks = new Map();
    try {
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i]; const m = store.media(c.mediaId); if (c.type !== 'video') continue;
        const frames = await grayFrames(m.path, c.in, Math.max(0.3, sourceLength(c)), 4, 96, 54);
        tracks.set(c.id, motionCentroids(frames, 96, 54));
        pm.set((i + 1) / clips.length);
      }
    } finally { pm.close(); }
    store.edit('Auto-Reframe', (p) => {
      p.settings.width = nw; p.settings.height = nh;
      for (const c of clips) {
        const m = store.media(c.mediaId); if (!m?.width) continue;
        const fit = Math.min(nw / m.width, nh / m.height), fill = Math.max(nw / m.width, nh / m.height);
        c.transform.scale = fill / fit;
        const overX = Math.max(0, m.width * fill - nw) / 2;
        const xs = tracks.get(c.id);
        if (xs && overX > 1) {
          const kf = { kf: [] };
          xs.forEach((x, i) => { const lt = (i / 4) / (c.speed || 1); if (lt > c.dur) return; kf.kf.push({ t: lt, v: Math.round(clamp((0.5 - x) * m.width * fill, -overX, overX)), e: 'smooth' }); });
          c.transform.x = kf.kf.length > 1 ? kf : (kf.kf[0]?.v || 0);
        } else c.transform.x = 0;
        c.transform.y = 0;
      }
    });
    toast(L(`Reframe auf ${aspect} fertig`, `Reframed to ${aspect}`), 'ok');
  } },
  { id: 'aiAutoKey', name: { de: 'Hintergrund entfernen (Auto-Key)', en: 'Remove background (auto key)' }, cat: 'ai', run: async () => {
    const c = selVideo(); const m = store.media(c.mediaId);
    // sample border pixels of current frame to find dominant background color
    const st = sourceTime(c, Math.max(0, store.time - c.start));
    const tmp = path.join(cacheDir('tmp'), 'key.raw');
    await ff(['-ss', String(st), '-i', m.path, '-frames:v', '1', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', tmp]);
    const b = fs.readFileSync(tmp); const acc = [0, 0, 0]; let n = 0;
    for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) if (x < 3 || x > 60 || y < 3 || y > 32) { const i = (y * 64 + x) * 3; acc[0] += b[i]; acc[1] += b[i + 1]; acc[2] += b[i + 2]; n++; }
    const hex = '#' + acc.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
    run('applyEffect', { type: 'chromakey', params: { key: hex, similarity: 0.3, smooth: 0.1, spill: 0.6 }, clipIds: [c.id] });
    toast(L('Key-Farbe: ', 'Key color: ') + hex, 'ok');
  } },
  { id: 'aiNeuralEnhance', name: { de: 'Neuronale Hochskalierung', en: 'Neural upscale' }, cat: 'ai', run: async () => {
    modal({ title: L('Neuronale Hochskalierung', 'Neural upscale'), body: el('div', { style: { maxWidth: '520px', lineHeight: '1.6' } },
      el('p', {}, L('Der eingebaute „VELOX Realism“ + „Super-Resolution“ läuft in Echtzeit auf jeder GPU (Shader).', 'Built-in "VELOX Realism" + "Super Resolution" run in real time on any GPU (shaders).')),
      el('p', {}, L('Ein neuronales Modul (Real-ESRGAN über Vulkan, läuft auf AMD/NVIDIA/Intel) ist als Plugin-Schnittstelle vorbereitet: realesrgan-ncnn-vulkan.exe in den Plugin-Ordner legen → VELOX nutzt es für „KI-Hochskalieren“ beim Export.', 'A neural module (Real-ESRGAN via Vulkan, runs on AMD/NVIDIA/Intel) is prepared as a plugin hook: drop realesrgan-ncnn-vulkan.exe in the plugin folder.'))),
      buttons: [{ label: 'OK', cls: 'primary', value: true }] });
  } },
  { id: 'autoEditDialog', name: { de: 'Auto-Edit…', en: 'Auto edit…' }, cat: 'ai', key: 'Ctrl+Alt+A', run: async ({ style } = {}) => autoEditDialog(style) },
  { id: 'autoEdit', name: { de: 'Auto-Edit (API)', en: 'Auto edit (API)' }, cat: 'ai', hidden: true, args: '{ style, mediaIds?, musicId?, length?, replace?, title?, beatsPerCut? }', run: (a) => autoEdit(a || {}) },
]);
function defaultTextLite() { return { content: '', font: 'Bahnschrift', size: 80, weight: 800, italic: false, color: '#ffffff', color2: '', gradAngle: 90, align: 'center', lineHeight: 1.1, letter: 0, stroke: 0, strokeColor: '#000000', shadow: 0.4, shadowColor: '#000000', glow: 0, glowColor: '#00e5ff', bg: '', bgPad: 20, bgRadius: 12, anim: 'none', animOut: 'none', animDur: 0.4, upper: false, extrude: 0, extrudeColor: '#1a1a1a', boxW: 0.9 }; }

async function autoEditDialog(style = 'montage') {
  const P = store.p;
  const vids = P.media.filter((m) => m.type === 'video' || m.type === 'image');
  const auds = P.media.filter((m) => m.type === 'audio');
  const st = { style, music: auds[0]?.id || '', length: 0, replace: true, title: '', bpc: 0, media: new Set(vids.map((m) => m.id)) };
  const styleSel = el('select', {}, ...Object.entries(AUTO_STYLES).map(([k, v]) => el('option', { value: k }, v.name))); styleSel.value = style; styleSel.onchange = () => (st.style = styleSel.value);
  const musSel = el('select', {}, el('option', { value: '' }, L('— ohne Musik (fester Takt) —', '— no music (fixed tempo) —')), ...auds.map((m) => el('option', { value: m.id }, m.name))); musSel.value = st.music; musSel.onchange = () => (st.music = musSel.value);
  const lenIn = el('input', { type: 'number', value: 0, min: 0, step: 1 }); lenIn.onchange = () => (st.length = +lenIn.value); lenIn.addEventListener('keydown', (e) => e.stopPropagation());
  const bpcSel = el('select', {}, el('option', { value: 0 }, L('Automatisch (Stil)', 'Automatic (style)')), ...[1, 2, 4, 8].map((n) => el('option', { value: n }, n + ' Beat' + (n > 1 ? 's' : '')))); bpcSel.onchange = () => (st.bpc = +bpcSel.value);
  const repl = el('input', { type: 'checkbox', checked: true }); repl.onchange = () => (st.replace = repl.checked);
  const title = el('input', { type: 'text', placeholder: L('optional', 'optional') }); title.oninput = () => (st.title = title.value); title.addEventListener('keydown', (e) => e.stopPropagation());
  const list = el('div', { style: { maxHeight: '160px', overflow: 'auto', background: 'var(--bg0)', borderRadius: '6px', padding: '4px' } },
    ...vids.map((m) => { const cb = el('input', { type: 'checkbox', checked: true }); cb.onchange = () => (cb.checked ? st.media.add(m.id) : st.media.delete(m.id)); return el('label', { style: { display: 'flex', gap: '6px', padding: '2px 4px' } }, cb, m.name); }));
  if (!vids.length) { toast(L('Erst Videos/Bilder importieren', 'Import videos/images first'), 'err'); return; }
  const r = await new Promise((res) => modal({ title: '✨ Auto-Edit', width: 560, body: el('div', {},
    el('p', { class: 'muted', style: { marginTop: 0 } }, L('VELOX analysiert Musik (Beats, Drops) und Clips (laute/actionreiche Momente) und baut automatisch ein komplettes Edit mit Velocity, Übergängen und Look.', 'VELOX analyses the music (beats, drops) and clips (loud / action moments) and builds a full edit with velocity, transitions and look.')),
    el('div', { class: 'form' }, el('label', {}, L('Stil', 'Style')), styleSel, el('label', {}, L('Musik', 'Music')), musSel, el('label', {}, L('Länge (s, 0 = Musik)', 'Length (s, 0 = music)')), lenIn,
      el('label', {}, L('Schnitt alle', 'Cut every')), bpcSel, el('label', {}, L('Titel', 'Title')), title, el('label', {}, L('Timeline ersetzen', 'Replace timeline')), repl, el('label', {}, L('Clips', 'Clips')), list)),
    buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('Edit erstellen', 'Create edit'), cls: 'primary', value: true }], onClose: res }));
  if (!r) return;
  if (!st.replace && P.clips.length && !(await confirmBox(L('Das Edit wird zusätzlich in die Timeline gelegt. Fortfahren?', 'The edit will be added to the timeline. Continue?')))) return;
  const pm = progressModal('Auto-Edit');
  try {
    const res = await autoEdit({ style: st.style, mediaIds: [...st.media], musicId: st.music, length: st.length, replace: st.replace, title: st.title, beatsPerCut: st.bpc }, (s) => pm.set(0.5, s));
    toast(L(`Auto-Edit fertig: ${res.cuts} Schnitte · ${res.bpm} BPM · ${res.length.toFixed(1)}s`, `Auto edit done: ${res.cuts} cuts · ${res.bpm} BPM`), 'ok', 6000);
    (await import('../ui/timeline.js')).zoomFit();
  } finally { pm.close(); }
}

// ------------------------------------------------------------------ mask / corner-pin tracking
async function trackRegionsOnClip(vc, rects, lt0, onProgress) {
  // rects: normalised project-frame rects [{x,y,w,h}] at clip-local time lt0 (untransformed fit assumed)
  const m = store.media(vc.mediaId); const P = store.p.settings;
  const fit = Math.min(P.width / m.width, P.height / m.height);
  const tw = 320, th = Math.round((320 * m.height) / m.width / 2) * 2, sx = tw / m.width;
  const toMedia = (nx, ny) => [((nx - 0.5) * P.width) / fit + m.width / 2, ((ny - 0.5) * P.height) / fit + m.height / 2];
  const fpsT = Math.min(30, store.fps);
  const s0 = sourceTime(vc, lt0), s1 = sourceTime(vc, vc.dur);
  const frames = await grayFrames(m.path, s0, Math.max(0.2, s1 - s0), fpsT, tw, th, onProgress);
  return rects.map((r) => {
    const [x0, y0] = toMedia(r.x, r.y), [x1, y1] = toMedia(r.x + r.w, r.y + r.h);
    const pts = trackTemplate(frames, tw, th, { x: x0 * sx, y: y0 * sx, w: Math.max(6, (x1 - x0) * sx), h: Math.max(6, (y1 - y0) * sx) });
    // convert pixel deltas back to normalised project offsets
    return pts.map((p) => ({ dx: ((p.x - pts[0].x) / sx) * fit / P.width, dy: ((p.y - pts[0].y) / sx) * fit / P.height }));
  }).map((d) => ({ deltas: d, fps: fpsT, speed: vc.speed || 1 }));
}
function underlyingVideo(c) {
  const t = store.time; const vt = store.p.tracks.filter((x) => x.kind === 'video');
  const idx = vt.findIndex((x) => x.id === c.trackId);
  for (let i = idx; i >= 0; i--) { const v = store.p.clips.find((x) => x.trackId === vt[i].id && x.type === 'video' && x.start <= t && clipEnd(x) > t); if (v) return v; }
  return null;
}
registerCommands([
  { id: 'trackMask', name: { de: 'Maske tracken', en: 'Track mask' }, cat: 'ai', hidden: true, run: async ({ clipId, fxId } = {}) => {
    const c = store.clip(clipId) || store.primaryClip(); const fx = c?.effects.find((f) => f.id === fxId) || c?.effects.find((f) => f.type === 'bezmask');
    if (!fx) throw new Error(L('Keine Maske', 'No mask'));
    const vc = c.type === 'video' ? c : underlyingVideo(c); if (!vc) throw new Error(L('Kein Video zum Tracken gefunden', 'No video to track'));
    const lt0 = Math.max(0, store.time - c.start); const ltv = Math.max(0, store.time - vc.start);
    const { evalParam: ev } = await import('../core/keyframes.js');
    const base = deepClone(ev(fx.params.points, lt0));
    const xs = base.map((p) => p[0]), ys = base.map((p) => p[1]);
    const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const pm = progressModal(L('Tracke Maske…', 'Tracking mask…'));
    try {
      const [res] = await trackRegionsOnClip(vc, [rect], ltv, (p) => pm.set(p));
      store.edit('Masken-Tracking', () => {
        const kf = { kf: [] };
        res.deltas.forEach((d, i) => { if (i % 2) return; const tl = store.time + i / res.fps / res.speed; const lt = tl - c.start; if (lt < 0 || lt > c.dur) return; kf.kf.push({ t: lt, v: base.map((p) => [p[0] + d.dx, p[1] + d.dy, p[2]]), e: 'linear' }); });
        if (kf.kf.length) fx.params.points = kf;
      });
      toast(L('Maske getrackt', 'Mask tracked'), 'ok');
    } finally { pm.close(); }
  } },
  { id: 'trackCornerPin', name: { de: 'Corner-Pin tracken', en: 'Track corner pin' }, cat: 'ai', hidden: true, run: async ({ clipId, fxId } = {}) => {
    const c = store.clip(clipId) || store.primaryClip(); const fx = c?.effects.find((f) => f.id === fxId) || c?.effects.find((f) => f.type === 'cornerpin');
    if (!fx) throw new Error('Corner-Pin fehlt');
    const vc = underlyingVideo(c) || (c.type === 'video' ? c : null); if (!vc || vc === c) throw new Error(L('Kein Video unter dem Clip (Overlay auf höhere Spur legen)', 'No video below this clip (put the overlay on a higher track)'));
    const { evalParam: ev } = await import('../core/keyframes.js');
    const lt0 = Math.max(0, store.time - c.start), ltv = Math.max(0, store.time - vc.start);
    const keys = [['tlx', 'tly'], ['trx', 'try_'], ['brx', 'bry'], ['blx', 'bly']];
    const pts = keys.map(([a, b]) => [ev(fx.params[a], lt0), ev(fx.params[b], lt0)]);
    const S = 0.035;
    const pm = progressModal(L('Tracke 4 Ecken…', 'Tracking 4 corners…'));
    try {
      const res = await trackRegionsOnClip(vc, pts.map(([x, y]) => ({ x: x - S / 2, y: y - S / 2, w: S, h: S * 1.7 })), ltv, (p) => pm.set(p));
      store.edit('Corner-Pin-Tracking', () => {
        keys.forEach(([a, b], ci) => {
          const kx = { kf: [] }, ky = { kf: [] };
          res[ci].deltas.forEach((d, i) => { if (i % 2) return; const tl = store.time + i / res[ci].fps / res[ci].speed; const lt = tl - c.start; if (lt < 0 || lt > c.dur) return; kx.kf.push({ t: lt, v: +(pts[ci][0] + d.dx).toFixed(4), e: 'linear' }); ky.kf.push({ t: lt, v: +(pts[ci][1] + d.dy).toFixed(4), e: 'linear' }); });
          if (kx.kf.length) { fx.params[a] = kx; fx.params[b] = ky; }
        });
      });
      toast(L('Corner-Pin getrackt', 'Corner pin tracked'), 'ok');
    } finally { pm.close(); }
  } },
]);
