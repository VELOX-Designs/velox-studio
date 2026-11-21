// FFmpeg / FFprobe integration: probing, thumbnails, waveforms, proxies,
// frame-accurate decoding for export, encoder detection.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

import { paths } from './settings.js';

export let FFMPEG = 'ffmpeg';
export let FFPROBE = 'ffprobe';

export function setBinaries(ff, fp) { if (ff) FFMPEG = ff; if (fp) FFPROBE = fp; }

export function checkFfmpeg() {
  return new Promise((res) => {
    execFile(FFMPEG, ['-hide_banner', '-version'], { windowsHide: true }, (err, out) => {
      res(err ? null : (out.split('\n')[0] || 'ffmpeg'));
    });
  });
}

// run ffmpeg, report progress (0..1) when total duration known
export function run(args, { duration = 0, onProgress, onStderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-y', ...args], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      err += s; if (err.length > 200000) err = err.slice(-100000);
      onStderr?.(s);
      if (onProgress && duration > 0) {
        const m = s.match(/time=(\d+):(\d+):(\d+\.?\d*)/g);
        if (m) {
          const last = m[m.length - 1].match(/time=(\d+):(\d+):(\d+\.?\d*)/);
          const t = +last[1] * 3600 + +last[2] * 60 + +last[3];
          onProgress(Math.min(1, t / duration));
        }
      }
    });
    proc.stdout.on('data', () => {});
    signal?.addEventListener('abort', () => { try { proc.kill('SIGKILL'); } catch {} });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (signal?.aborted) return reject(new Error('abgebrochen'));
      code === 0 ? resolve(err) : reject(new Error('FFmpeg Fehler (' + code + '):\n' + err.split('\n').slice(-12).join('\n')));
    });
  });
}

export function probe(file) {
  return new Promise((resolve, reject) => {
    execFile(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, out) => {
        if (err) return reject(err);
        try {
          const j = JSON.parse(out);
          const v = j.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
          const a = j.streams.find((s) => s.codec_type === 'audio');
          const fr = (r) => { if (!r) return 0; const [n, d] = r.split('/').map(Number); return d ? n / d : n; };
          const duration = parseFloat(j.format.duration || v?.duration || a?.duration || 0) || 0;
          let rot = 0;
          if (v) {
            const sd = (v.side_data_list || []).find((x) => x.rotation !== undefined);
            rot = sd ? Number(sd.rotation) : Number(v.tags?.rotate || 0);
          }
          let w = v?.width || 0, h = v?.height || 0;
          if (Math.abs(rot) === 90 || Math.abs(rot) === 270) [w, h] = [h, w];
          const isImage = v && (['png', 'mjpeg', 'jpeg', 'webp', 'bmp', 'tiff', 'gif'].includes(v.codec_name)) && (duration < 0.2 || j.format.format_name.includes('image2') || j.format.format_name.includes('_pipe'));
          resolve({
            type: v ? (isImage ? 'image' : 'video') : a ? 'audio' : 'unknown',
            duration: isImage ? 0 : duration,
            width: w, height: h,
            fps: v ? (fr(v.avg_frame_rate) || fr(v.r_frame_rate) || 30) : 0,
            vcodec: v?.codec_name || null,
            pixfmt: v?.pix_fmt || null,
            acodec: a?.codec_name || null,
            hasAudio: !!a,
            channels: a?.channels || 0,
            sampleRate: +(a?.sample_rate || 0),
            bitrate: +(j.format.bit_rate || 0),
            size: +(j.format.size || 0),
            format: j.format.format_name,
          });
        } catch (e) { reject(e); }
      });
  });
}

export function cacheKey(file) {
  let st = { size: 0, mtimeMs: 0 };
  try { st = fs.statSync(file); } catch {}
  return crypto.createHash('md5').update(file + '|' + st.size + '|' + st.mtimeMs).digest('hex').slice(0, 16);
}
export function cacheDir(sub) {
  const d = path.join(paths.userData, 'cache', sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// filmstrip sprite: N frames tiled horizontally, each 96px wide
export async function makeFilmstrip(media) {
  const key = cacheKey(media.path);
  const out = path.join(cacheDir('thumbs'), key + '_strip.jpg');
  const n = media.type === 'image' ? 1 : Math.max(1, Math.min(60, Math.ceil(media.duration / 2)));
  if (fs.existsSync(out)) return { file: out, count: n };
  if (media.type === 'image') {
    await run(['-i', media.path, '-vf', 'scale=96:54:force_original_aspect_ratio=increase,crop=96:54', '-frames:v', '1', '-q:v', '4', out]);
    return { file: out, count: 1 };
  }
  const rate = n / Math.max(0.1, media.duration);
  await run(['-skip_frame', 'nokey', '-i', media.path, '-an', '-vf',
    `fps=${rate.toFixed(6)},scale=96:54:force_original_aspect_ratio=increase,crop=96:54,tile=${n}x1`,
    '-frames:v', '1', '-q:v', '5', out]).catch(async () => {
    await run(['-i', media.path, '-an', '-vf', `fps=${rate.toFixed(6)},scale=96:54:force_original_aspect_ratio=increase,crop=96:54,tile=${n}x1`, '-frames:v', '1', '-q:v', '5', out]);
  });
  return { file: out, count: n };
}

export async function makePoster(media) {
  const key = cacheKey(media.path);
  const out = path.join(cacheDir('thumbs'), key + '_poster.jpg');
  if (fs.existsSync(out)) return out;
  const ss = media.type === 'video' ? Math.min(1, media.duration / 3) : 0;
  await run(['-ss', String(ss), '-i', media.path, '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2', '-frames:v', '1', '-q:v', '4', out]);
  return out;
}

// waveform peaks: 100 values/sec, Float32 abs-max, stored as .bin
export async function makePeaks(media) {
  const key = cacheKey(media.path);
  const out = path.join(cacheDir('peaks'), key + '.bin');
  if (fs.existsSync(out)) return new Float32Array(fs.readFileSync(out).buffer.slice(0));
  const pcm = await decodePcm(media.path, 8000, 1);
  const per = 80; // 8000/100
  const n = Math.ceil(pcm.length / per);
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0; const e = Math.min(pcm.length, (i + 1) * per);
    for (let j = i * per; j < e; j++) { const v = Math.abs(pcm[j]); if (v > m) m = v; }
    peaks[i] = m;
  }
  fs.writeFileSync(out, Buffer.from(peaks.buffer));
  return peaks;
}

export function decodePcm(file, rate = 22050, channels = 1, start = 0, dur = 0) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-v', 'error'];
    if (start) args.push('-ss', String(start));
    args.push('-i', file);
    if (dur) args.push('-t', String(dur));
    args.push('-vn', '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', 'pipe:1');
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    const chunks = []; let len = 0;
    proc.stdout.on('data', (d) => { chunks.push(d); len += d.length; });
    proc.on('error', reject);
    proc.on('close', () => {
      const buf = Buffer.concat(chunks, len);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.length - (buf.length % 4)));
      resolve(new Float32Array(ab));
    });
  });
}

// preview proxy: 720p, keyframe every 0.5 s (instant seeking), GPU decode + GPU encode when available.
// Alpha videos (WebM VP9 / ProRes 4444 …) get a VP9-alpha proxy so transparency survives.
export function hasAlpha(file) {
  return new Promise((res) => execFile(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt:stream_tags', '-of', 'json', file], { windowsHide: true }, (e, out) => {
    try { const s = JSON.parse(out).streams[0] || {}; const t = Object.fromEntries(Object.entries(s.tags || {}).map(([k, v]) => [k.toLowerCase(), v])); res(t.alpha_mode === '1' || /yuva|rgba|argb|bgra|ya8|gbrap/.test(s.pix_fmt || '')); } catch { res(false); }
  }));
}
// seconds between the first two keyframes (long-GOP files – e.g. game/screen recorder exports – seek very slowly)
export function keyframeGap(file) {
  return new Promise((res) => execFile(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', '-read_intervals', '%+12', file], { windowsHide: true, timeout: 20000 }, (e, out) => {
    const t = String(out || '').split(/\r?\n/).map(parseFloat).filter((x) => !isNaN(x));
    res(t.length >= 2 ? t[1] - t[0] : 12);
  }));
}
export async function makeProxy(media, { height = 720, onProgress, signal } = {}) {
  const key = cacheKey(media.path);
  const alpha = await hasAlpha(media.path);
  const out = path.join(cacheDir('proxies'), `${key}_${height}p${alpha ? '_a.webm' : '.mp4'}`);
  if (fs.existsSync(out)) return out;
  const tmp = out + (alpha ? '.part.webm' : '.part.mp4');
  const fps = media.fps || 30, g = String(Math.max(6, Math.round(fps / 2)));
  const vf = `scale=-2:${height}:flags=fast_bilinear,format=${alpha ? 'yuva420p' : 'yuv420p'}`;
  if (alpha) {
    await run(['-c:v', 'libvpx-vp9', '-i', media.path, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '0', '-crf', '30', '-g', g, '-auto-alt-ref', '0', '-c:a', 'libopus', '-b:a', '128k', tmp], { duration: media.duration, onProgress, signal });
  } else {
    const enc = await detectEncoders();
    const hw = enc.h264_nvenc ? ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'constqp', '-qp', '23']
      : enc.h264_amf ? ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '24']
      : enc.h264_qsv ? ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '24']
      : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-tune', 'fastdecode'];
    const go = async (hwdec, venc) => run([...(hwdec ? ['-hwaccel', 'auto'] : []), '-i', media.path, '-map', '0:v:0', '-map', '0:a:0?', '-filter_threads', '8', '-vf', vf, ...venc, '-g', g, '-bf', '0', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmp], { duration: media.duration, onProgress, signal });
    try { await go(true, hw); }
    catch (e) { if (signal?.aborted) throw e; await go(false, ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-tune', 'fastdecode']); }
  }
  fs.renameSync(tmp, out);
  return out;
}

// reversed segment (for reverse-playback preview and export)
export async function makeReversed(media, start, len, { height = 720, onProgress, full = false } = {}) {
  const key = cacheKey(media.path);
  const tag = `${key}_rev_${start.toFixed(3)}_${len.toFixed(3)}_${full ? 'full' : height}`;
  const out = path.join(cacheDir('reversed'), tag + '.mp4');
  if (fs.existsSync(out)) return out;
  const vf = full ? 'reverse,format=yuv420p' : `scale=-2:${height},reverse,format=yuv420p`;
  const tmp = out + '.part.mp4';
  await run(['-ss', String(start), '-t', String(len), '-i', media.path, '-an', '-vf', vf,
    '-c:v', 'libx264', '-preset', full ? 'fast' : 'veryfast', '-crf', full ? '14' : '22', '-g', '12', tmp], { duration: len, onProgress });
  fs.renameSync(tmp, out);
  return out;
}

// stabilisation via vid.stab two-pass, produces new file
export async function stabilize(media, { smoothing = 15, onProgress, signal } = {}) {
  const key = cacheKey(media.path);
  const dir = cacheDir('stabilized');
  const trf = path.join(dir, key + '.trf').replace(/\\/g, '/').replace(':', '\\:');
  const out = path.join(dir, `${key}_stab${smoothing}.mp4`);
  if (fs.existsSync(out)) return out;
  await run(['-i', media.path, '-vf', `vidstabdetect=shakiness=6:accuracy=12:result='${trf}'`, '-f', 'null', '-'],
    { duration: media.duration, onProgress: (p) => onProgress?.(p * 0.5), signal });
  await run(['-i', media.path, '-vf', `vidstabtransform=input='${trf}':smoothing=${smoothing}:zoom=0:optzoom=1,unsharp=5:5:0.6:3:3:0.3,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-c:a', 'copy', out], { duration: media.duration, onProgress: (p) => onProgress?.(0.5 + p * 0.5), signal });
  return out;
}

// ------------------------------------------------------------------ hardware encoder detection
let encCache = null;
export async function detectEncoders() {
  if (encCache) return encCache;
  const test = async (enc) => {
    try {
      await run(['-f', 'lavfi', '-i', 'color=c=black:s=256x144:d=0.2', '-frames:v', '3', '-c:v', enc, '-f', 'null', '-']);
      return true;
    } catch { return false; }
  };
  const cands = ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_amf', 'hevc_amf', 'av1_amf', 'h264_qsv', 'hevc_qsv', 'av1_qsv'];
  const results = await Promise.all(cands.map(test));
  encCache = {};
  cands.forEach((c, i) => (encCache[c] = results[i]));
  return encCache;
}

// ------------------------------------------------------------------ sequential frame reader (export)
// Decodes a media file into RGBA frames at a fixed rate starting at `start`.
// get(t) returns the frame nearest to source time t; seeks (restarts) on backwards jumps.
export class FrameReader {
  constructor(file, { width, height, fps, start = 0 }) {
    this.file = file; this.w = width & ~1; this.h = height & ~1; this.fps = fps;
    this.frameSize = this.w * this.h * 4;
    this.start = start;
    this.proc = null; this.buf = []; this.bufLen = 0; this.waiters = [];
    this.index = -1; this.frame = null; this.ended = false;
    this._spawn(start);
  }
  _spawn(start) {
    this.kill();
    this.start = Math.max(0, start);
    this.index = -1; this.frame = null; this.ended = false; this.buf = []; this.bufLen = 0;
    const args = ['-hide_banner', '-v', 'error', '-ss', this.start.toFixed(4), ...(/\.webm$/i.test(this.file) ? ['-c:v', 'libvpx-vp9'] : []), '-i', this.file, '-an',
      '-vf', `fps=${this.fps},scale=${this.w}:${this.h}:flags=bicubic,format=rgba`, '-f', 'rawvideo', 'pipe:1'];
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    this.proc = proc;
    proc.stdout.on('data', (d) => {
      if (proc !== this.proc) return;
      this.buf.push(d); this.bufLen += d.length;
      if (this.bufLen > this.frameSize * 6) proc.stdout.pause();
      this._wake();
    });
    proc.stdout.on('end', () => { if (proc === this.proc) { this.ended = true; this._wake(); } });
    proc.on('error', () => { if (proc === this.proc) { this.ended = true; this._wake(); } });
  }
  _wake() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
  async _readFrame() {
    while (this.bufLen < this.frameSize) {
      if (this.ended) return null;
      if (this.proc?.stdout.isPaused()) this.proc.stdout.resume();
      await new Promise((r) => this.waiters.push(r));
    }
    const out = Buffer.allocUnsafe(this.frameSize);
    let off = 0;
    while (off < this.frameSize) {
      const c = this.buf[0];
      const need = this.frameSize - off;
      if (c.length <= need) { c.copy(out, off); off += c.length; this.buf.shift(); }
      else { c.copy(out, off, 0, need); this.buf[0] = c.subarray(need); off += need; }
    }
    this.bufLen -= this.frameSize;
    if (this.bufLen < this.frameSize * 3 && this.proc?.stdout.isPaused()) this.proc.stdout.resume();
    return out;
  }
  async get(t) {
    const target = Math.round((t - this.start) * this.fps);
    if (target < this.index || target > this.index + this.fps * 4 || target < 0) {
      this._spawn(Math.max(0, t - 0.0001));
      return this.get(t);
    }
    while (this.index < target) {
      const f = await this._readFrame();
      if (!f) break;
      this.frame = f; this.index++;
    }
    return this.frame;
  }
  kill() { if (this.proc) { try { this.proc.kill('SIGKILL'); } catch {} this.proc = null; } }
}

export function srtTimeToSec(s) {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}
export function parseSrt(text) {
  const out = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.trim().split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const txt = lines.slice(i + 1).join('\n').trim();
    if (txt) out.push({ start: srtTimeToSec(a), end: srtTimeToSec(b), text: txt });
  }
  return out;
}
