// VELOX Neural Rendering – SD-Turbo (ONNX, fp16, DirectML) img2img + inpainting, single-pass (no CFG).
// Used by worker.js for photos and video frames.
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------ fp16
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v; const x = u32[0]; const s = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15; let m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return s; m = (m | 0x800000) >> (1 - e); return s | ((m + 0x1000) >> 13); }
  if (e >= 31) return s | 0x7c00;
  const h = s | (e << 10) | ((m + 0x1000) >> 13); return h;
}
const HALF = new Float32Array(65536);
for (let h = 0; h < 65536; h++) { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff; HALF[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15); }
const half = (arr) => { const o = new Uint16Array(arr.length); for (let i = 0; i < arr.length; i++) o[i] = toHalf(arr[i]); return o; };
const unhalf = (u) => { const o = new Float32Array(u.length); for (let i = 0; i < u.length; i++) o[i] = HALF[u[i]]; return o; };
const asU16 = (d) => (d instanceof Uint16Array ? d : new Uint16Array(d.buffer, d.byteOffset, d.length));

// ------------------------------------------------------------------ CLIP BPE tokenizer
function bytesToUnicode() {
  const bs = []; for (let i = 33; i <= 126; i++) bs.push(i); for (let i = 161; i <= 172; i++) bs.push(i); for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice(); let n = 0; for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  const m = {}; bs.forEach((b, i) => (m[b] = String.fromCharCode(cs[i]))); return m;
}
class Tokenizer {
  constructor(dir) {
    this.vocab = JSON.parse(fs.readFileSync(path.join(dir, 'vocab.json'), 'utf8'));
    const merges = fs.readFileSync(path.join(dir, 'merges.txt'), 'utf8').split('\n').slice(1).filter(Boolean);
    this.ranks = new Map(merges.map((l, i) => [l, i])); this.b2u = bytesToUnicode(); this.cache = new Map();
  }
  bpe(word) {
    if (this.cache.has(word)) return this.cache.get(word);
    let parts = [...word]; parts[parts.length - 1] += '</w>';
    for (;;) {
      let best = null, bi = -1;
      for (let i = 0; i < parts.length - 1; i++) { const r = this.ranks.get(parts[i] + ' ' + parts[i + 1]); if (r !== undefined && (best === null || r < best)) { best = r; bi = i; } }
      if (bi < 0) break;
      const a = parts[bi], b = parts[bi + 1]; const np = [];
      for (let i = 0; i < parts.length; i++) { if (i < parts.length - 1 && parts[i] === a && parts[i + 1] === b) { np.push(a + b); i++; } else np.push(parts[i]); }
      parts = np;
    }
    this.cache.set(word, parts); return parts;
  }
  encode(text, len = 77) {
    const t = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
    const re = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu;
    const ids = [49406];
    for (const w of t.match(re) || []) { const enc = [...Buffer.from(w, 'utf8')].map((b) => this.b2u[b]).join(''); for (const p of this.bpe(enc)) { const id = this.vocab[p]; if (id !== undefined) ids.push(id); } }
    ids.splice(len - 1); ids.push(49407);
    while (ids.length < len) ids.push(0); // pad token "!" = 0
    return Int32Array.from(ids);
  }
}

// ------------------------------------------------------------------ scheduler (scaled_linear betas, discrete sigmas)
const ALPHAS = (() => { const a = new Float64Array(1000); let p = 1; const b0 = Math.sqrt(0.00085), b1 = Math.sqrt(0.012); for (let i = 0; i < 1000; i++) { const b = (b0 + ((b1 - b0) * i) / 999) ** 2; p *= 1 - b; a[i] = p; } return a; })();
const sigmaAt = (t) => Math.sqrt((1 - ALPHAS[t]) / ALPHAS[t]);

// seeded gaussian noise (same seed + size = same noise → stable video)
function noise(n, seed) {
  let s = seed >>> 0 || 1; const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; };
  const o = new Float32Array(n); for (let i = 0; i < n; i += 2) { const u = rnd(), v = rnd(); const r = Math.sqrt(-2 * Math.log(u)); o[i] = r * Math.cos(2 * Math.PI * v); if (i + 1 < n) o[i + 1] = r * Math.sin(2 * Math.PI * v); } return o;
}

class SD {
  constructor(ort, dir, session) { this.ort = ort; this.dir = dir; this.session = session; this.embCache = new Map(); this.noiseCache = new Map(); }
  async load() {
    const f = (m) => { const d = path.join(this.dir, m); return fs.existsSync(path.join(d, 'model_dml.onnx')) ? path.join(d, 'model_dml.onnx') : path.join(d, 'model.onnx'); };
    this.tok = new Tokenizer(path.join(this.dir, 'tokenizer'));
    this.te = await this.session(f('text_encoder')); this.unet = await this.session(f('unet'));
    this.enc = await this.session(f('vae_encoder')); this.dec = await this.session(f('vae_decoder'));
    return this;
  }
  async embed(prompt) {
    if (this.embCache.has(prompt)) return this.embCache.get(prompt);
    const ids = this.tok.encode(prompt);
    const r = await this.te.run({ input_ids: new this.ort.Tensor('int32', ids, [1, 77]) });
    const e = r.last_hidden_state; const t = new this.ort.Tensor('float16', asU16(e.data).slice(), e.dims);
    this.embCache.set(prompt, t); return t;
  }
  // rgba Buffer (w×h, multiples of 64) → rgba Buffer; o = { prompt, strength 0..1, steps, seed, mask: Float32Array(w*h) 1=generate }
  async run(rgba, w, h, o) {
    const T = this.ort; const tm = [Date.now()]; const n = w * h; const lw = w / 8, lh = h / 8, ln = lw * lh;
    const img = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { img[i] = rgba[i * 4] / 127.5 - 1; img[n + i] = rgba[i * 4 + 1] / 127.5 - 1; img[2 * n + i] = rgba[i * 4 + 2] / 127.5 - 1; }
    const er = await this.enc.run({ sample: new T.Tensor('float16', half(img), [1, 3, h, w]) });
    tm.push(Date.now()); const x0 = unhalf(asU16(er.latent_sample.data)); for (let i = 0; i < x0.length; i++) x0[i] *= 0.18215;
    const key = `${lw}x${lh}_${o.seed}`; if (!this.noiseCache.has(key)) this.noiseCache.set(key, noise(4 * ln, o.seed || 42));
    const nz = this.noiseCache.get(key);
    // latent mask
    let lm = null;
    if (o.mask) { lm = new Float32Array(ln); for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) { let s = 0; for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) s += o.mask[(y * 8 + yy) * w + x * 8 + xx]; lm[y * lw + x] = s / 64; } }
    const steps = Math.max(1, Math.min(8, o.steps || 2)); const t0 = Math.max(1, Math.min(999, Math.round(1000 * Math.min(1, o.strength)) - 1));
    const ts = []; for (let i = 0; i < steps; i++) ts.push(Math.max(1, Math.round(t0 * (1 - i / steps))));
    const emb = await this.embed(o.prompt || 'photorealistic photo');
    let sig = sigmaAt(ts[0]); const x = new Float32Array(4 * ln); for (let i = 0; i < x.length; i++) x[i] = x0[i] + sig * nz[i];
    for (let k = 0; k < steps; k++) {
      sig = sigmaAt(ts[k]); const c = 1 / Math.sqrt(sig * sig + 1); const inp = new Float32Array(x.length); for (let i = 0; i < x.length; i++) inp[i] = x[i] * c;
      const r = await this.unet.run({ sample: new T.Tensor('float16', half(inp), [1, 4, lh, lw]), timestep: new T.Tensor('float16', Uint16Array.from([toHalf(ts[k])]), [1]), encoder_hidden_states: emb });
      const eps = unhalf(asU16(r.out_sample.data)); const sn = k < steps - 1 ? sigmaAt(ts[k + 1]) : 0;
      for (let i = 0; i < x.length; i++) x[i] = x[i] - sig * eps[i] + sn * eps[i];
      if (lm) for (let ch = 0; ch < 4; ch++) for (let p = 0; p < ln; p++) { const i = ch * ln + p; x[i] = lm[p] * x[i] + (1 - lm[p]) * (x0[i] + sn * nz[i]); }
    }
    tm.push(Date.now()); for (let i = 0; i < x.length; i++) x[i] /= 0.18215;
    const dr = await this.dec.run({ latent_sample: new T.Tensor('float16', half(x), [1, 4, lh, lw]) });
    tm.push(Date.now()); const out = unhalf(asU16(dr.sample.data)); const res = Buffer.alloc(n * 4);
    const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
    for (let i = 0; i < n; i++) { res[i * 4] = cl((out[i] + 1) * 127.5); res[i * 4 + 1] = cl((out[n + i] + 1) * 127.5); res[i * 4 + 2] = cl((out[2 * n + i] + 1) * 127.5); res[i * 4 + 3] = rgba[i * 4 + 3]; }
    tm.push(Date.now()); this.timing = tm.slice(1).map((t, i) => t - tm[i]);
    return res;
  }
}
// working size: long side ≈ maxSide, both multiples of 64
function workSize(w, h, maxSide = 768) { const k = Math.min(1, maxSide / Math.max(w, h)); return [Math.max(64, Math.round((w * k) / 64) * 64), Math.max(64, Math.round((h * k) / 64) * 64)]; }
module.exports = { SD, workSize, Tokenizer };
