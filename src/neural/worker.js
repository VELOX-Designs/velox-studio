// VELOX neural worker – runs as a separate Node process (Electron with ELECTRON_RUN_AS_NODE=1).
// Tasks: upscale / detail (Real-ESRGAN), face (YOLOface + GFPGAN), bgremove (RMBG/MODNet).
// Usage: worker.js <json-config>. Prints "PROGRESS <0..1> <text>" lines, "DONE <file>" or "ERROR <msg>".
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(process.argv[2]);
const FF = cfg.ffmpeg || 'ffmpeg';
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

let ort;
// Node 24 ships Float16Array, but the native ORT binding only accepts Uint16Array for float16 tensors
try { delete globalThis.Float16Array; } catch {}
try { ort = require(cfg.ortPath || 'onnxruntime-node'); } catch (e) { log('ERROR', 'onnxruntime-node fehlt: ' + e.message); process.exit(1); }

async function session(file) {
  for (const eps of [['dml'], ['cpu']]) {
    try { const s = await ort.InferenceSession.create(file, { executionProviders: eps, graphOptimizationLevel: 'all' }); s.__ep = eps[0]; return s; } catch (e) { if (eps[0] === 'cpu') throw e; }
  }
}

// ------------------------------------------------------------------ ffmpeg IO
function reader(file, start, dur, w, h, fps) {
  const args = ['-hide_banner', '-v', 'error'];
  if (start) args.push('-ss', String(start));
  if (/\.webm$/i.test(file)) args.push('-c:v', 'libvpx-vp9');
  args.push('-i', file);
  if (dur) args.push('-t', String(dur));
  args.push('-an', '-vf', `fps=${fps}${w ? `,scale=${w}:${h}:flags=bicubic` : ''}`, '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1');
  const p = spawn(FF, args, { windowsHide: true });
  const fsz = w * h * 4; let bufs = [], len = 0, waiters = [], ended = false;
  p.stdout.on('data', (d) => { bufs.push(d); len += d.length; if (len > fsz * 4) p.stdout.pause(); waiters.splice(0).forEach((f) => f()); });
  p.stdout.on('end', () => { ended = true; waiters.splice(0).forEach((f) => f()); });
  return {
    async next() {
      while (len < fsz) { if (ended) return null; p.stdout.resume(); await new Promise((r) => waiters.push(r)); }
      const all = Buffer.concat(bufs, len); const f = Buffer.from(all.subarray(0, fsz)); bufs = [all.subarray(fsz)]; len -= fsz; if (len < fsz * 2) p.stdout.resume(); return f;
    },
    kill() { try { p.kill(); } catch {} },
  };
}
function writer(out, w, h, fps, { alpha = false, audioFrom = null, start = 0, dur = 0, crf = 16 } = {}) {
  const args = ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', 'pipe:0'];
  if (audioFrom && !alpha) { if (start) args.push('-ss', String(start)); args.push('-i', audioFrom); if (dur) args.push('-t', String(dur)); args.push('-map', '0:v', '-map', '1:a?', '-c:a', 'aac', '-b:a', '256k', '-shortest'); }
  if (alpha) args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4');
  else args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf), '-pix_fmt', 'yuv420p');
  args.push(out);
  const p = spawn(FF, args, { windowsHide: true });
  let err = ''; p.stderr.on('data', (d) => (err += d));
  const done = new Promise((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(-800))))));
  return { async write(buf) { if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r)); }, async end() { p.stdin.end(); await done; } };
}

// ------------------------------------------------------------------ helpers
function toCHW(rgba, w, h, norm = (v) => v / 255) {
  const out = new Float32Array(3 * w * h); const n = w * h;
  for (let i = 0; i < n; i++) { out[i] = norm(rgba[i * 4]); out[n + i] = norm(rgba[i * 4 + 1]); out[2 * n + i] = norm(rgba[i * 4 + 2]); }
  return out;
}
function resizeRGBA(src, sw, sh, dw, dh) { // bilinear
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) { const fy = ((y + 0.5) * sh) / dh - 0.5; const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(sh - 1, y0 + 1), wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < dw; x++) { const fx = ((x + 0.5) * sw) / dw - 0.5; const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(sw - 1, x0 + 1), wx = Math.min(1, Math.max(0, fx - x0));
      for (let c = 0; c < 4; c++) { const a = src[(y0 * sw + x0) * 4 + c] * (1 - wx) + src[(y0 * sw + x1) * 4 + c] * wx, b = src[(y1 * sw + x0) * 4 + c] * (1 - wx) + src[(y1 * sw + x1) * 4 + c] * wx; out[(y * dw + x) * 4 + c] = a * (1 - wy) + b * wy; } } }
  return out;
}
function probeSize(file) {
  return new Promise((res) => { const p = spawn(path.join(path.dirname(FF), 'ffprobe' + (FF.endsWith('.exe') ? '.exe' : '')).replace(/^ffprobe$/, 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames:format=duration', '-of', 'json', file], { windowsHide: true }); let s = ''; p.stdout.on('data', (d) => (s += d)); p.on('close', () => { try { const j = JSON.parse(s); const st = j.streams[0]; const [a, b] = st.r_frame_rate.split('/').map(Number); res({ w: st.width, h: st.height, fps: b ? a / b : a, dur: +j.format.duration }); } catch { res(null); } }); });
}

// ------------------------------------------------------------------ Real-ESRGAN (tiled)
async function esrgan(sess, rgba, w, h, scale, tile = 256, pad = 12) {
  const ow = w * scale, oh = h * scale; const out = Buffer.alloc(ow * oh * 4);
  const inName = sess.inputNames[0], outName = sess.outputNames[0];
  for (let ty = 0; ty < h; ty += tile) for (let tx = 0; tx < w; tx += tile) {
    const x0 = Math.max(0, tx - pad), y0 = Math.max(0, ty - pad), x1 = Math.min(w, tx + tile + pad), y1 = Math.min(h, ty + tile + pad);
    const tw = x1 - x0, th = y1 - y0; const n = tw * th; const inp = new Float32Array(3 * n);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const s = ((y0 + y) * w + x0 + x) * 4, d = y * tw + x; inp[d] = rgba[s] / 255; inp[n + d] = rgba[s + 1] / 255; inp[2 * n + d] = rgba[s + 2] / 255; }
    const r = await sess.run({ [inName]: new ort.Tensor('float32', inp, [1, 3, th, tw]) });
    const o = r[outName].data; const OW = tw * scale, ON = OW * th * scale;
    const cx0 = (tx - x0) * scale, cy0 = (ty - y0) * scale, cw = Math.min(tile, w - tx) * scale, ch = Math.min(tile, h - ty) * scale;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const si = (cy0 + y) * OW + cx0 + x; const di = ((ty * scale + y) * ow + tx * scale + x) * 4; out[di] = clamp255(o[si] * 255); out[di + 1] = clamp255(o[ON + si] * 255); out[di + 2] = clamp255(o[2 * ON + si] * 255); out[di + 3] = 255; }
  }
  return out;
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
// pull mean/contrast of each channel of `img` towards `ref` (keeps the original colour look after generative passes)
function colorMatch(img, ref, k = 0.75) {
  const st = (b) => { const m = [0, 0, 0], q = [0, 0, 0]; const n = b.length / 4; for (let i = 0; i < b.length; i += 4) for (let c = 0; c < 3; c++) { m[c] += b[i + c]; q[c] += b[i + c] * b[i + c]; } return m.map((v, c) => [v / n, Math.sqrt(Math.max(1, q[c] / n - (v / n) ** 2))]); };
  const a = st(img), r = st(ref);
  for (let i = 0; i < img.length; i += 4) for (let c = 0; c < 3; c++) { const v = (img[i + c] - a[c][0]) * (r[c][1] / a[c][1]) + r[c][0]; img[i + c] = clamp255(img[i + c] + (v - img[i + c]) * k); }
}

// ------------------------------------------------------------------ face restore (YOLOface + GFPGAN, 5-point alignment)
const FFHQ = [[0.37691676, 0.46864664], [0.62285697, 0.46912813], [0.50123859, 0.61331904], [0.39308822, 0.725411], [0.61150205, 0.72490465]];
async function detectFaces(det, rgba, w, h, conf = 0.5) {
  const S = 640; const k = Math.min(S / w, S / h); const rw = Math.round(w * k), rh = Math.round(h * k);
  const small = resizeRGBA(rgba, w, h, rw, rh); const padded = Buffer.alloc(S * S * 4); for (let y = 0; y < rh; y++) small.copy(padded, y * S * 4, y * rw * 4, (y + 1) * rw * 4);
  const r = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', toCHW(padded, S, S, (v) => (v - 127.5) / 128), [1, 3, S, S]) });
  const o = r[det.outputNames[0]].data; const N = 8400; const faces = [];
  for (let i = 0; i < N; i++) { const sc = o[4 * N + i]; if (sc < conf) continue; const cx = o[i], cy = o[N + i], bw = o[2 * N + i], bh = o[3 * N + i]; const kps = []; for (let j = 0; j < 5; j++) kps.push([o[(5 + j * 3) * N + i] / k, o[(6 + j * 3) * N + i] / k]); faces.push({ score: sc, box: [(cx - bw / 2) / k, (cy - bh / 2) / k, (cx + bw / 2) / k, (cy + bh / 2) / k], kps }); }
  faces.sort((a, b) => b.score - a.score); const keep = [];
  for (const f of faces) if (!keep.some((g) => iou(f.box, g.box) > 0.4)) keep.push(f);
  return keep;
}
const iou = (a, b) => { const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]); const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i); };
function similarity(src, dst) { // least squares similarity transform src->dst: [a,-b,tx; b,a,ty]
  let sx = 0, sy = 0, dx = 0, dy = 0; const n = src.length;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n; let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) { const x = src[i][0] - sx, y = src[i][1] - sy, u = dst[i][0] - dx, v = dst[i][1] - dy; num1 += x * u + y * v; num2 += x * v - y * u; den += x * x + y * y; }
  const a = num1 / den, b = num2 / den; return [a, -b, dx - (a * sx - b * sy), b, a, dy - (b * sx + a * sy)];
}
function sample(rgba, w, h, x, y, out, oi) { x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y)); const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0; for (let c = 0; c < 3; c++) { const i = (y0 * w + x0) * 4 + c; out[oi + c] = (rgba[i] * (1 - fx) + rgba[i + 4] * fx) * (1 - fy) + (rgba[i + w * 4] * (1 - fx) + rgba[i + w * 4 + 4] * fx) * fy; } }
async function restoreFaces(det, gfp, rgba, w, h, strength) {
  const faces = await detectFaces(det, rgba, w, h);
  const S = 512;
  for (const f of faces) {
    const M = similarity(f.kps, FFHQ.map(([x, y]) => [x * S, y * S])); // image -> crop
    const det2 = M[0] * M[4] - M[1] * M[3]; const inv = [M[4] / det2, -M[1] / det2, 0, -M[3] / det2, M[0] / det2, 0];
    inv[2] = -(inv[0] * M[2] + inv[1] * M[5]); inv[5] = -(inv[3] * M[2] + inv[4] * M[5]);
    const crop = new Float32Array(S * S * 3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) sample(rgba, w, h, inv[0] * x + inv[1] * y + inv[2], inv[3] * x + inv[4] * y + inv[5], crop, (y * S + x) * 3);
    const n = S * S; const inp = new Float32Array(3 * n); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) inp[c * n + i] = (crop[i * 3 + c] / 255 - 0.5) / 0.5;
    const r = await gfp.run({ [gfp.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, S, S]) });
    const o = r[gfp.outputNames[0]].data;
    // paste back with feathered mask
    const bx0 = Math.max(0, Math.floor(f.box[0] - (f.box[2] - f.box[0]) * 0.3)), by0 = Math.max(0, Math.floor(f.box[1] - (f.box[3] - f.box[1]) * 0.3));
    const bx1 = Math.min(w, Math.ceil(f.box[2] + (f.box[2] - f.box[0]) * 0.3)), by1 = Math.min(h, Math.ceil(f.box[3] + (f.box[3] - f.box[1]) * 0.3));
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
      const u = M[0] * x + M[1] * y + M[2], v = M[3] * x + M[4] * y + M[5];
      if (u < 1 || v < 1 || u > S - 2 || v > S - 2) continue;
      const mx = Math.min(u, S - u) / (S * 0.12), my = Math.min(v, S - v) / (S * 0.12); const m = Math.min(1, mx, my) * strength;
      const ui = Math.round(u), vi = Math.round(v), si = vi * S + ui, di = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) { const val = clamp255((o[c * n + si] * 0.5 + 0.5) * 255); rgba[di + c] = rgba[di + c] * (1 - m) + val * m; }
    }
  }
  return faces.length;
}

// ------------------------------------------------------------------ background removal
async function matte(sess, rgba, w, h, kind) {
  const S = kind === 'modnet' ? 512 : 1024;
  const small = resizeRGBA(rgba, w, h, S, S);
  const norm = kind === 'modnet' ? (v) => (v / 255 - 0.5) / 0.5 : (v) => v / 255 - 0.5;
  const r = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', toCHW(small, S, S, norm), [1, 3, S, S]) });
  const m = r[sess.outputNames[0]].data; let mn = Infinity, mx = -Infinity; for (const v of m) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const rng = mx - mn || 1;
  // upsample matte bilinear into alpha
  for (let y = 0; y < h; y++) { const fy = ((y + 0.5) * S) / h - 0.5; const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(S - 1, y0 + 1), wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < w; x++) { const fx = ((x + 0.5) * S) / w - 0.5; const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(S - 1, x0 + 1), wx = Math.min(1, Math.max(0, fx - x0));
      const a = (m[y0 * S + x0] * (1 - wx) + m[y0 * S + x1] * wx) * (1 - wy) + (m[y1 * S + x0] * (1 - wx) + m[y1 * S + x1] * wx) * wy;
      rgba[(y * w + x) * 4 + 3] = clamp255(((a - mn) / rng) * 255); } }
}

// ------------------------------------------------------------------ main
(async () => {
  const info = await probeSize(cfg.input);
  if (!info) throw new Error('Video nicht lesbar');
  const start = cfg.start || 0, dur = cfg.duration || Math.max(0.04, info.dur - start);
  const fps = cfg.fps || info.fps || 30;
  let w = info.w & ~1, h = info.h & ~1;
  const isImage = /\.(png|jpe?g|webp|bmp)$/i.test(cfg.input);
  const total = isImage ? 1 : Math.max(1, Math.round(dur * fps));
  let outW = w, outH = h, scale = 1, sess, det, gfp;
  if (cfg.task === 'upscale' || cfg.task === 'detail') {
    // target size (renderer decides), model scale (SPAN ×4 / ESRGAN ×2|×4): input = target / scale
    sess = await session(cfg.models.esrgan); scale = cfg.scale || 2;
    outW = (cfg.outW || (cfg.task === 'detail' ? w : w * scale)) & ~1; outH = (cfg.outH || (cfg.task === 'detail' ? h : h * scale)) & ~1;
    while (outW > 7680 || outH > 4320) { outW = Math.round(outW * 0.75) & ~1; outH = Math.round(outH * 0.75) & ~1; }
    w = Math.max(16, Math.round(outW / scale)) & ~1; h = Math.max(16, Math.round(outH / scale)) & ~1;
  }
  if (cfg.task === 'face') { det = await session(cfg.models.yoloface); gfp = await session(cfg.models.gfpgan); }
  if (cfg.task === 'dlss5') {
    // full-res frames; SR runs on a 1/4 copy and re-invents texture detail at full size
    while (w > 3840) { w = Math.round(w * 0.75) & ~1; h = Math.round(h * 0.75) & ~1; }
    outW = w; outH = h; scale = 4;
    if (cfg.detail !== false) sess = await session(cfg.models.sr);
    if (cfg.faces !== false) { det = await session(cfg.models.yoloface); gfp = await session(cfg.models.gfpgan); }
  }
  let sd = null, maskF = null, sdW = 0, sdH = 0;
  if (cfg.task === 'neural') {
    while (w > 3840) { w = Math.round(w * 0.75) & ~1; h = Math.round(h * 0.75) & ~1; }
    outW = w; outH = h;
    const { SD, workSize } = require('./sd.js');
    log('PROGRESS 0', 'Neural Rendering: KI-Modell wird geladen…');
    sd = await new SD(ort, cfg.models.sd, session).load();
    [sdW, sdH] = workSize(w, h, cfg.maxSide || (isImage ? 1024 : 768));
    if (cfg.detail !== false && cfg.models.sr && fs.existsSync(cfg.models.sr) && (w > sdW * 1.3)) sess = await session(cfg.models.sr);
    if (cfg.faces) { det = await session(cfg.models.yoloface); gfp = await session(cfg.models.gfpgan); }
    if (cfg.mask) { const mr = reader(cfg.mask, 0, 0, sdW, sdH, 25); const mf = await mr.next(); mr.kill(); maskF = new Float32Array(sdW * sdH); for (let i = 0; i < maskF.length; i++) maskF[i] = mf[i * 4 + 3] / 255; }
  }
  if (cfg.task === 'bgremove') { sess = await session(cfg.models.matte); while (w > 2560) { w = Math.round(w * 0.75) & ~1; h = Math.round(h * 0.75) & ~1; } outW = w; outH = h; }
  log('PROGRESS 0', `GPU: ${(sess || det || sd?.unet)?.__ep || '?'} · ${w}x${h} → ${outW}x${outH}`);
  const rd = reader(cfg.input, isImage ? 0 : start, isImage ? 0 : dur, w, h, fps);
  const alpha = cfg.task === 'bgremove';
  const wr = isImage ? null : writer(cfg.output, outW, outH, fps, { alpha, audioFrom: cfg.input, start, dur });
  const t0 = Date.now(); let i = 0, facesFound = 0; let prevOut = null, prevIn = null;
  for (;;) {
    let f = await rd.next(); if (!f) break;
    if (cfg.task === 'dlss5') {
      const S = Math.max(0, Math.min(1, cfg.strength ?? 0.6)); const orig = Buffer.from(f);
      if (sess) {
        const sw = Math.max(16, Math.round(w / 4)) & ~1, sh = Math.max(16, Math.round(h / 4)) & ~1;
        let up = await esrgan(sess, resizeRGBA(f, w, h, sw, sh), sw, sh, 4, 384);
        if (sw * 4 !== w || sh * 4 !== h) up = resizeRGBA(up, sw * 4, sh * 4, w, h);
        // blend reconstructed detail in: high-frequency of the AI frame onto the original (keeps colours/shape)
        const k = 0.35 + 0.65 * S;
        for (let j = 0; j < f.length; j += 4) for (let c = 0; c < 3; c++) f[j + c] = clamp255(orig[j + c] + (up[j + c] - orig[j + c]) * k);
      }
      if (det) facesFound += await restoreFaces(det, gfp, f, w, h, Math.min(1, 0.4 + 0.6 * S));
      // temporal stabilisation: where the source barely changed, keep the previous AI result (kills AI flicker)
      if (cfg.temporal !== false && prevOut && prevIn) {
        for (let j = 0; j < f.length; j += 4) {
          const dIn = Math.abs(orig[j] - prevIn[j]) + Math.abs(orig[j + 1] - prevIn[j + 1]) + Math.abs(orig[j + 2] - prevIn[j + 2]);
          const kk = dIn < 12 ? 0.55 : dIn < 30 ? 0.25 : 0;
          if (kk) for (let c = 0; c < 3; c++) f[j + c] = f[j + c] * (1 - kk) + prevOut[j + c] * kk;
        }
      }
      prevOut = Buffer.from(f); prevIn = orig;
    }
    if (cfg.task === 'neural') {
      const S = Math.max(0.05, Math.min(1, cfg.strength ?? 0.35)); const orig = Buffer.from(f);
      const small = resizeRGBA(f, w, h, sdW, sdH);
      let gen = await sd.run(small, sdW, sdH, { prompt: cfg.prompt, strength: S, steps: cfg.steps || (S <= 0.22 ? 1 : 2), seed: cfg.seed ?? 42, mask: maskF });
      if (!maskF) colorMatch(gen, small, 0.75);
      if (cfg.debug) log('TIMING', JSON.stringify(sd.timing));
      // back to full size: AI detail upscale (SPAN ×4) when the source is much larger
      if (sess) { let up = await esrgan(sess, gen, sdW, sdH, 4, 256); f = resizeRGBA(up, sdW * 4, sdH * 4, w, h); }
      else f = resizeRGBA(gen, sdW, sdH, w, h);
      // keep fine structure of the source (edges/text) – stronger rendering keeps less
      const keep = Math.max(0, 0.55 - S * 0.75);
      if (keep > 0.01) { const blurO = resizeRGBA(resizeRGBA(orig, w, h, sdW, sdH), sdW, sdH, w, h); for (let j = 0; j < f.length; j += 4) { const hp = (orig[j] - blurO[j] + orig[j + 1] - blurO[j + 1] + orig[j + 2] - blurO[j + 2]) / 3 * keep; for (let c = 0; c < 3; c++) f[j + c] = clamp255(f[j + c] + hp); } }
      if (maskF) { const mFull = resizeRGBA(Buffer.from(Uint8Array.from(maskF, (v) => v * 255).reduce((b, v, i) => { b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = b[i * 4 + 3] = v; return b; }, Buffer.alloc(sdW * sdH * 4))), sdW, sdH, w, h);
        for (let j = 0; j < f.length; j += 4) { const m = mFull[j] / 255; for (let c = 0; c < 3; c++) f[j + c] = orig[j + c] * (1 - m) + f[j + c] * m; } }
      for (let j = 3; j < f.length; j += 4) f[j] = orig[j];
      if (det) facesFound += await restoreFaces(det, gfp, f, w, h, 0.75);
      if (!isImage && cfg.temporal !== false && prevOut && prevIn) {
        for (let j = 0; j < f.length; j += 4) { const dIn = Math.abs(orig[j] - prevIn[j]) + Math.abs(orig[j + 1] - prevIn[j + 1]) + Math.abs(orig[j + 2] - prevIn[j + 2]); const kk = dIn < 10 ? 0.6 : dIn < 28 ? 0.3 : 0.08; for (let c = 0; c < 3; c++) f[j + c] = f[j + c] * (1 - kk) + prevOut[j + c] * kk; }
      }
      prevOut = Buffer.from(f); prevIn = orig;
    }
    else if (cfg.task === 'upscale' || cfg.task === 'detail') { f = await esrgan(sess, f, w, h, scale, cfg.tile || 384); if (w * scale !== outW || h * scale !== outH) f = resizeRGBA(f, w * scale, h * scale, outW, outH); }
    else if (cfg.task === 'face') facesFound += await restoreFaces(det, gfp, f, w, h, cfg.strength ?? 1);
    else if (cfg.task === 'bgremove') await matte(sess, f, w, h, cfg.matteKind || 'rmbg');
    if (isImage) {
      const p = spawn(FF, ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${outW}x${outH}`, '-i', 'pipe:0', '-frames:v', '1', cfg.output], { windowsHide: true });
      p.stdin.end(f); await new Promise((r) => p.on('close', r));
    } else await wr.write(f);
    i++;
    const el = (Date.now() - t0) / 1000; log('PROGRESS', (i / total).toFixed(4), `Frame ${i}/${total} · ${(i / el).toFixed(2)} fps · Rest ${Math.ceil((total - i) / Math.max(0.01, i / el))}s${cfg.task === 'face' || cfg.task === 'dlss5' || (cfg.task === 'neural' && det) ? ' · Gesichter ' + facesFound : ''}`);
  }
  rd.kill();
  if (wr) await wr.end();
  log('DONE', cfg.output);
  process.exit(0);
})().catch((e) => { log('ERROR', String(e.message || e).replace(/\n/g, ' ')); process.exit(1); });
