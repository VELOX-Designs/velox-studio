// GPU compositor: builds a frame from the project at time t.
// Used by both the live preview and the offline exporter (same code path = WYSIWYG export).
import { GL, GLSL_HEADER, parseCube, upload3d } from './gl.js';
import { EFFECTS, buildFxShader } from './effects.js';
import { TRANSITIONS, buildTrShader } from './transitions.js';
import './transitions2.js';
import './transitions3.js';
import './transitions4.js';
import './effects2.js';
import './effects3.js';
import './censor.js';
import './effects4.js';
import { ShapeRenderer } from './shapes.js';
import { TextRenderer } from './text.js';
import { evalParam } from '../core/keyframes.js';
import { clipEnd, sourceTime, trWindow } from '../core/project.js';
import { nestedProject } from '../core/sequences.js';
import { hexToRgb } from '../core/util.js';
const fs = require('fs');

// ------------------------------------------------------------------ 3D camera
export const CAM_DEFAULT = { x: 0, y: 0, dolly: 0, rx: 0, ry: 0, rz: 0, persp: 1.6 };
export function cameraAt(P, t) {
  const c = P.clips.find((x) => x.type === 'camera' && t >= x.start && t < x.start + x.dur && !P.tracks.find((tr) => tr.id === x.trackId)?.hidden);
  if (!c) return null;
  const lt = t - c.start; const o = {};
  for (const [k, v] of Object.entries({ ...CAM_DEFAULT, ...(c.cam || {}) })) o[k] = evalParam(v, lt);
  return o;
}

// ------------------------------------------------------------------ scene description
export function activeVisualLayers(p, t) {
  const layers = [];
  const vtracks = p.tracks.filter((tr) => tr.kind === 'video');
  for (const tr of vtracks) {
    if (tr.hidden) continue;
    const clips = p.clips.filter((c) => c.trackId === tr.id);
    // transitions first
    let handled = false;
    for (const x of p.transitions) {
      const a = clips.find((c) => c.id === x.a); if (!a) continue;
      const b = clips.find((c) => c.id === x.b); if (!b) continue;
      const [w0, w1] = trWindow(x, a, b);
      if (t >= w0 && t < w1) {
        layers.push({ kind: 'transition', tr: x, track: tr, a, b, ltA: t - a.start, ltB: t - b.start, p: (t - w0) / Math.max(1e-6, w1 - w0) });
        handled = true; break;
      }
    }
    if (handled) continue;
    const c = clips.find((c) => t >= c.start && t < clipEnd(c));
    if (!c) continue;
    layers.push({ kind: c.type === 'adjust' ? 'adjust' : 'clip', clip: c, track: tr, lt: t - c.start });
  }
  return layers;
}
// clips whose frames are needed at time t (for prefetching)
export function neededClips(p, t, depth = 0) {
  const out = [];
  for (const L of activeVisualLayers(p, t)) {
    if (L.kind === 'transition') out.push({ clip: L.a, lt: L.ltA }, { clip: L.b, lt: L.ltB });
    else out.push({ clip: L.clip, lt: L.lt });
  }
  const res = [];
  for (const x of out) {
    if ((x.clip.type === 'compound' || x.clip.type === 'multicam') && depth < 4) { const np = nestedProject(p, x.clip); if (np) res.push(...neededClips(np, sourceTime(x.clip, x.lt), depth + 1)); }
    else if (x.clip.type === 'video' || x.clip.type === 'image') res.push(x);
  }
  return res;
}

// evaluate transform incl. effect modifiers
export function evalTransform(clip, lt, extra = 0) {
  const T = {};
  for (const [k, v] of Object.entries(clip.transform)) T[k] = evalParam(v, lt);
  T.dx = 0; T.dy = 0; T.drot = 0; T.dscale = 1;
  for (const fx of clip.effects) {
    if (!fx.enabled) continue;
    const d = EFFECTS[fx.type]; if (!d?.mod) continue;
    const P = evalParams(fx, lt + extra);
    const m = d.mod(P, lt + extra, { dur: clip.dur });
    T.dx += m.dx || 0; T.dy += m.dy || 0; T.drot += m.rot || 0; T.dscale *= m.scale || 1;
  }
  return T;
}
export function evalParams(fx, lt) {
  const d = EFFECTS[fx.type]; const P = {};
  for (const q of d.params || []) {
    let v = fx.params[q.k]; if (v === undefined) v = q.def;
    v = q.type === 'curve' || q.type === 'file' ? v : evalParam(v, lt);
    if (q.type === 'path' && !Array.isArray(v)) v = q.def;
    if (q.type === 'color') v = hexToRgb(v);
    if (q.type === 'bool') v = v ? 1 : 0;
    P[q.k] = v;
  }
  return P;
}

const BLEND_MODES = ['normal', 'add', 'screen', 'multiply', 'overlay', 'softlight', 'lighten', 'darken', 'difference', 'colordodge', 'colorburn', 'hardlight'];
export { BLEND_MODES };

const VS_LAYER = `#version 300 es
in vec4 a_pos; in vec2 a_uv; out vec2 v_uv;
void main(){ v_uv = a_uv; gl_Position = a_pos; }`;
const FS_LAYER = `${GLSL_HEADER}
uniform float u_opacity; uniform vec3 u_tint; uniform float u_solid; uniform float u_bicubic; uniform vec2 u_texSize;
vec4 cubic(float v){ vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v; vec4 s = n*n*n; float x = s.x; float y = s.y - 4.0*s.x; float z = s.z - 4.0*s.y + 6.0*s.x; float w = 6.0 - x - y - z; return vec4(x,y,z,w)*(1.0/6.0); }
vec4 bicubic(vec2 uv){ vec2 tc = uv*u_texSize - 0.5; vec2 f = fract(tc); tc -= f; vec4 xc = cubic(f.x), yc = cubic(f.y); vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy; vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw); vec4 off = c + vec4(xc.yw, yc.yw)/s; off /= u_texSize.xxyy;
  vec4 s0 = texture(u_tex, off.xz), s1 = texture(u_tex, off.yz), s2 = texture(u_tex, off.xw), s3 = texture(u_tex, off.yw); float sx = s.x/(s.x+s.y), sy = s.z/(s.z+s.w); return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy); }
void main(){ vec4 c = u_solid > 0.5 ? vec4(u_tint, 1.0) : (u_bicubic > 0.5 ? bicubic(v_uv) : texture(u_tex, v_uv)); o = c * u_opacity; }`;
const FS_BLEND = `${GLSL_HEADER}
uniform sampler2D u_dst; uniform float u_mode; uniform float u_op;
vec3 B(vec3 b, vec3 s, int m){
  if(m==1) return min(b+s, 1.0); if(m==2) return b+s-b*s; if(m==3) return b*s;
  if(m==4) return mix(2.0*b*s, 1.0-2.0*(1.0-b)*(1.0-s), step(0.5,b));
  if(m==5) return mix(b-(1.0-2.0*s)*b*(1.0-b), b+(2.0*s-1.0)*(sqrt(b)-b), step(0.5,s));
  if(m==6) return max(b,s); if(m==7) return min(b,s); if(m==8) return abs(b-s);
  if(m==9) return min(b/max(1.0-s,0.001),1.0); if(m==10) return 1.0-min((1.0-b)/max(s,0.001),1.0);
  if(m==11) return mix(2.0*b*s, 1.0-2.0*(1.0-b)*(1.0-s), step(0.5,s));
  return s; }
void main(){ vec4 d = texture(u_dst, v_uv); vec4 s = texture(u_tex, v_uv) * u_op; int m = int(u_mode+0.5);
  if (m == 0) { o = s + d*(1.0-s.a); return; }
  vec3 cs = s.a>0.0? s.rgb/s.a : vec3(0); vec3 cb = d.a>0.0? d.rgb/d.a : vec3(0);
  vec3 r = s.rgb*(1.0-d.a) + d.rgb*(1.0-s.a) + s.a*d.a*B(cb, cs, m);
  o = vec4(r, s.a + d.a*(1.0-s.a)); }`;
const FS_COPY = `${GLSL_HEADER} void main(){ o = texture(u_tex, v_uv); }`;
const FS_MIX = `${GLSL_HEADER} uniform sampler2D u_b; uniform float u_k; void main(){ o = mix(texture(u_tex, v_uv), texture(u_b, v_uv), u_k); }`;
const FS_BG = `${GLSL_HEADER} uniform vec3 u_c; void main(){ o = vec4(u_c, 1.0); }`;
const FS_BLUR = `${GLSL_HEADER} uniform vec2 u_dir; uniform float u_radius;
void main(){ float r = u_radius; if (r < 0.5) { o = texture(u_tex, v_uv); return; } float n = min(ceil(r), 24.0); float stp = r/n; float sig = r*0.5 + 0.001; vec4 acc = vec4(0); float ws = 0.0;
  for (float i = -24.0; i <= 24.0; i += 1.0) { if (abs(i) > n) continue; float x = i*stp; float w = exp(-x*x/(2.0*sig*sig)); acc += texture(u_tex, v_uv + u_dir*x/u_res)*w; ws += w; } o = acc/ws; }`;

export class Compositor {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.g = new GL(canvas, opts);
    this.text = new TextRenderer();
    this.shapes = new ShapeRenderer();
    this.texCache = new Map(); // key -> {tex, srcKey}
    this.curveCache = new Map();
    this.lutCache = new Map();
    this.time = 0;
    this.bicubic = true;
  }
  setSize(w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.g.trimPool(w, h); }
    this.w = w; this.h = h;
  }
  // -------------------------------------------------------------- pass helpers
  prog(key, src, vs) { return this.g.program(key, src, vs); }
  pass(progKey, src, srcTex, dst, uniforms = {}, textures = {}) {
    const g = this.g; const p = this.prog(progKey, src);
    g.bind(dst);
    g.gl.disable(g.gl.BLEND);
    g.use(p, { u_res: [dst ? dst.w : this.w, dst ? dst.h : this.h], u_time: this.time, u_scale: this.scale, ...uniforms }, { u_tex: srcTex, ...textures });
    g.drawQuad();
  }
  temp() { return this.g.target(this.w, this.h); }
  free(...r) { r.forEach((x) => this.g.release(x)); }
  blur(src, dst, radius) {
    const t = this.temp();
    this.pass('blur', FS_BLUR, src, t, { u_dir: [1, 0], u_radius: radius });
    this.pass('blur', FS_BLUR, t, dst, { u_dir: [0, 1], u_radius: radius });
    this.free(t);
  }
  fxCtx(lt) {
    const self = this;
    return {
      g: this.g, scale: this.scale, w: this.w, h: this.h, lt,
      temp: () => self.temp(), free: (...r) => self.free(...r),
      blur: (s, d, r) => self.blur(s, d, r),
      runShader: (key, src, s, d, u = {}, tx = {}) => self.pass('fx_' + key, src, s, d, { u_lt: lt, ...u }, tx),
      uploadCanvas: (key, cv) => self.sourceTexture('fxc_' + key, cv, cv.width, cv.height, undefined),
    };
  }
  // -------------------------------------------------------------- textures
  sourceTexture(key, img, w, h, version) {
    let e = this.texCache.get(key);
    if (img == null) return e ? e.tex : null; // hold last frame
    if (!e) { e = { tex: this.g.newTexture(0, 0), ver: null }; this.texCache.set(key, e); }
    if (e.ver !== version || version === undefined) {
      try { this.g.upload(e.tex, img, w, h); e.ver = version; } catch (err) { console.warn('upload', err); return null; }
    }
    return e.tex;
  }
  dropTexture(key) { const e = this.texCache.get(key); if (e) { this.g.gl.deleteTexture(e.tex.tex); this.texCache.delete(key); } }
  curveTexture(params) {
    const key = JSON.stringify([params.master, params.r, params.g, params.b]);
    let t = this.curveCache.get(key); if (t) return t;
    const data = new Uint8Array(256 * 4);
    const ch = [params.r, params.g, params.b, params.master].map((pts) => sampleCurve(pts || [[0, 0], [1, 1]]));
    for (let i = 0; i < 256; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(ch[c][i] * 255);
    const g = this.g.gl;
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    t = this.g.texFromPixels(256, 1, data);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (this.curveCache.size > 50) this.curveCache.clear();
    this.curveCache.set(key, t); return t;
  }
  lutTexture(file) {
    if (!file) return null;
    if (this.lutCache.has(file)) return this.lutCache.get(file);
    let t = null;
    try { t = upload3d(this.g, parseCube(fs.readFileSync(file, 'utf8'))); } catch (e) { console.warn('LUT', e); }
    this.lutCache.set(file, t); return t;
  }
  // -------------------------------------------------------------- effects
  applyEffects(clip, lt, target, ownsTarget = false) {
    let cur = target; let preFilter = null; const amt = clip.filter ? (clip.filterAmt ?? 1) : 1;
    for (const fx of clip.effects) {
      if (!fx.enabled) continue;
      if (fx.fromFilter && amt < 0.999 && !preFilter) { preFilter = this.temp(); this.pass('copy', FS_COPY, cur, preFilter); }
      const d = EFFECTS[fx.type]; if (!d || d.mod || d.special === 'motionblur') continue;
      const P = evalParams(fx, lt);
      const out = this.temp();
      try {
        if (d.passes) d.passes(this.fxCtx(lt), cur, out, P, { clip, fx });
        else {
          const u = { u_lt: lt };
          const tx = {};
          for (const q of d.params || []) if (q.type !== 'curve' && q.type !== 'file' && q.type !== 'path') u['u_' + q.k] = P[q.k];
          if (d.special === 'curves') tx.u_curve = this.curveTexture(P);
          if (d.special === 'lut') { const l = this.lutTexture(P.file); if (!l) { this.free(out); continue; } tx.u_lut = l; u.u_lutSize = l.size; }
          this.pass('fx_' + fx.type, buildFxShader(d), cur, out, u, tx);
        }
      } catch (e) { console.error('effect', fx.type, e); this.free(out); continue; }
      if (cur !== target || ownsTarget) this.free(cur);
      cur = out;
    }
    if (preFilter) { const out = this.temp(); this.pass('mix', FS_MIX, preFilter, out, { u_k: amt }, { u_b: cur }); if (cur !== target || ownsTarget) this.free(cur); this.free(preFilter); cur = out; }
    return cur;
  }
  // -------------------------------------------------------------- draw a clip into a fresh layer target
  drawClipLayer(clip, lt, provider, P) {
    const PW = P.settings.width, PH = P.settings.height;
    if (clip.type === 'camera') return null;
    const cam = clip.layer3d ? cameraAt(P, clip.start + lt) : null;
    let tex = null, mw = PW, mh = PH, solid = null, nestedTarget = null;
    if (clip.type === 'shape') {
      const cv = this.shapes.render(clip.shape || {}, lt, clip.dur, this.w, this.h, this.scale);
      tex = this.sourceTexture('shape_' + clip.id, cv, cv.width, cv.height, undefined);
    } else if (clip.type === 'text') {
      const cv = this.text.render(clip.text, lt, clip.dur, this.w, this.h, this.scale);
      tex = this.sourceTexture('text_' + clip.id, cv, cv.width, cv.height, undefined);
    } else if (clip.type === 'solid') {
      solid = hexToRgb(clip.solid?.color || '#000000');
      if (clip.solid?.gradient) {
        const cv = this._grad ||= document.createElement('canvas'); cv.width = 256; cv.height = 256;
        const c2 = cv.getContext('2d'); const gr = c2.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, clip.solid.color); gr.addColorStop(1, clip.solid.gradient);
        c2.fillStyle = gr; c2.fillRect(0, 0, 256, 256); tex = this.sourceTexture('grad_' + clip.id, cv, 256, 256, clip.solid.color + clip.solid.gradient); solid = null;
      }
    } else if (clip.type === 'compound' || clip.type === 'multicam') {
      const np = nestedProject(P, clip);
      if (!np || (this._depth || 0) > 3) return null;
      this._depth = (this._depth || 0) + 1;
      nestedTarget = this.renderFrame(np, sourceTime(clip, lt), provider, { toScreen: false, nested: true });
      this._depth--;
      tex = { tex: nestedTarget.tex, w: nestedTarget.w, h: nestedTarget.h };
    } else {
      const s = provider.source(clip, lt);
      if (!s) return null;
      tex = this.sourceTexture(s.key, s.img, s.w, s.h, s.version);
      if (!tex) return null;
      mw = s.w; mh = s.h;
    }
    const target = this.temp();
    this.g.clear(target);
    const fade = clip.type !== 'audio' ? fadeFactor(clip, lt) : 1;
    const mb = clip.effects.find((f) => f.enabled && f.type === 'motionblur');
    const gl = this.g.gl;
    const prog = this.prog('layer', FS_LAYER, VS_LAYER);
    const drawAt = (dt, weight) => {
      const T = evalTransform(clip, lt + dt);
      const op = Math.max(0, Math.min(1, T.opacity)) * fade * weight;
      const verts = layerVerts(T, mw, mh, PW, PH, clip.type === 'text' || clip.type === 'solid' || clip.type === 'shape' || !!nestedTarget, cam);
      if (nestedTarget) for (let i = 0; i < 4; i++) verts.data[i * 6 + 5] = 1 - verts.data[i * 6 + 5];
      this.g.use(prog, { u_opacity: op, u_tint: solid || [1, 1, 1], u_solid: solid ? 1 : 0, u_bicubic: this.bicubic && !solid && (verts.upscale > 1.05) ? 1 : 0, u_texSize: [tex?.w || 1, tex?.h || 1] }, { u_tex: tex });
      this.g.drawDyn(verts.data);
    };
    this.g.bind(target);
    if (mb) {
      const MP = evalParams(mb, lt);
      const n = Math.max(2, Math.round(MP.samples));
      const span = (MP.shutter / 360) / P.settings.fps;
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = 0; i < n; i++) drawAt((i / (n - 1) - 0.5) * span, 1 / n);
      gl.disable(gl.BLEND);
    } else drawAt(0, 1);
    if (nestedTarget) this.free(nestedTarget);
    const out = this.applyEffects(clip, lt, target, true);
    return this.edgeTransitions(clip, lt, out);
  }
  // intro / outro transitions on a single clip (to/from transparent)
  edgeTransitions(clip, lt, layer) {
    const run = (tr, p, inMode) => {
      const d = TRANSITIONS[tr.type]; if (!d) return layer;
      const empty = this.emptyLayer(); const out = this.temp();
      this.pass('tr_' + d.id, buildTrShader(d), null, out, { u_p: p, u_int: tr.params?.intensity ?? 1, u_dir: tr.params?.dir ?? 0 }, inMode ? { u_a: empty, u_b: layer } : { u_a: layer, u_b: empty });
      this.free(empty, layer); return out;
    };
    const ti = clip.tIn, to = clip.tOut;
    if (ti?.type && ti.dur > 0 && lt < ti.dur) layer = run(ti, Math.max(0, lt / ti.dur), true);
    if (to?.type && to.dur > 0 && lt > clip.dur - to.dur) layer = run(to, Math.min(1, (lt - (clip.dur - to.dur)) / to.dur), false);
    return layer;
  }
  composite(accum, layer, mode = 'normal', op = 1) {
    const out = this.temp();
    this.pass('blend', FS_BLEND, layer, out, { u_mode: Math.max(0, BLEND_MODES.indexOf(mode)), u_op: op }, { u_dst: accum });
    this.free(accum, layer);
    return out;
  }
  // -------------------------------------------------------------- full frame
  // returns the render target holding the final frame (caller must free) or draws to screen
  renderFrame(P, t, provider, { toScreen = true, view = null, nested = false } = {}) {
    if (!nested) { this.time = t; this.scale = this.w / P.settings.width; this.g.releaseAll(); }
    let acc = this.temp();
    this.pass('bg', FS_BG, null, acc, { u_c: hexToRgb(P.settings.bg || '#000') });
    const layers = activeVisualLayers(P, t);
    for (const L of layers) {
      try {
        if (L.kind === 'clip') {
          const lay = this.drawClipLayer(L.clip, L.lt, provider, P);
          if (lay) acc = this.composite(acc, lay, L.clip.blend);
        } else if (L.kind === 'adjust') {
          const T = evalTransform(L.clip, L.lt);
          const fx = this.applyEffects(L.clip, L.lt, acc);
          if (fx !== acc) {
            const out = this.temp();
            this.pass('mix', FS_MIX, acc, out, { u_k: Math.max(0, Math.min(1, T.opacity)) * fadeFactor(L.clip, L.lt) }, { u_b: fx });
            this.free(acc, fx); acc = out;
          }
        } else if (L.kind === 'transition') {
          const la = this.drawClipLayer(L.a, L.ltA, provider, P) || this.emptyLayer();
          const lb = this.drawClipLayer(L.b, L.ltB, provider, P) || this.emptyLayer();
          const d = TRANSITIONS[L.tr.type] || TRANSITIONS.dissolve;
          const out = this.temp();
          this.pass('tr_' + d.id, buildTrShader(d), null, out, { u_p: L.p, u_int: L.tr.params?.intensity ?? 1, u_dir: L.tr.params?.dir ?? 0 }, { u_a: la, u_b: lb });
          this.free(la, lb);
          acc = this.composite(acc, out, L.b.blend || 'normal');
        }
      } catch (e) { console.error('layer', e); }
    }
    if (toScreen) {
      this.g.bind(null);
      this.pass('copy', FS_COPY, acc, null);
      this.free(acc);
      return null;
    }
    return acc;
  }
  // draw a cached frame (ImageBitmap / canvas) straight to the screen
  drawCached(img) {
    const tex = this.sourceTexture('__rcache', img, img.width, img.height, undefined);
    if (!tex) return false;
    this.g.bind(null);
    this.pass('rcache', `${GLSL_HEADER} void main(){ o = texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y)); }`, tex, null);
    return true;
  }
  emptyLayer() { const t = this.temp(); this.g.clear(t); return t; }
  // read final frame pixels (RGBA, bottom-up)
  readPixels(target, out) {
    const gl = this.g.gl;
    this.g.bind(target);
    gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }
  // render a single standalone texture pass (used by library previews)
  renderTransitionPreview(type, texA, texB, p, intensity = 1, dir = 0) {
    this.scale = 1; this.g.releaseAll();
    const d = TRANSITIONS[type];
    this.pass('tr_' + d.id, buildTrShader(d), null, null, { u_p: p, u_int: intensity, u_dir: dir }, { u_a: texA, u_b: texB });
  }
}

function fadeFactor(clip, lt) {
  let f = 1;
  if (clip.fadeIn > 0 && lt < clip.fadeIn) f *= Math.max(0, lt / clip.fadeIn);
  if (clip.fadeOut > 0 && lt > clip.dur - clip.fadeOut) f *= Math.max(0, (clip.dur - lt) / clip.fadeOut);
  return f;
}

// compute 4 vertices (x,y,z,w,u,v) for a transformed quad
export function layerVerts(T, mw, mh, PW, PH, fullFrame, cam = null) {
  const fit = fullFrame ? 1 : Math.min(PW / mw, PH / mh);
  const s = T.scale * T.dscale;
  const hw = (mw * fit * s * T.scaleX) / 2, hh = (mh * fit * s * T.scaleY) / 2;
  const cl = T.cropL || 0, cr = T.cropR || 0, ct = T.cropT || 0, cb = T.cropB || 0;
  let corners = [
    [-hw + 2 * hw * cl, -hh + 2 * hh * ct, cl, ct],
    [hw - 2 * hw * cr, -hh + 2 * hh * ct, 1 - cr, ct],
    [-hw + 2 * hw * cl, hh - 2 * hh * cb, cl, 1 - cb],
    [hw - 2 * hw * cr, hh - 2 * hh * cb, 1 - cr, 1 - cb],
  ];
  if (T.flipH) corners = corners.map((c) => [c[0], c[1], 1 - c[2], c[3]]);
  if (T.flipV) corners = corners.map((c) => [c[0], c[1], c[2], 1 - c[3]]);
  const rz = ((T.rotation + T.drot) * Math.PI) / 180, rx = (T.rotX * Math.PI) / 180, ry = (T.rotY * Math.PI) / 180;
  const cz = Math.cos(rz), sz = Math.sin(rz), cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  const d = PH * (T.perspective || 1.6);
  const tx = T.x + T.dx, ty = T.y + T.dy;
  const out = new Float32Array(24);
  corners.forEach((c, i) => {
    let x = c[0], y = c[1], z = 0;
    // Y rotation
    let x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    // X rotation
    let y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
    // Z rotation
    const x3 = x1 * cz - y2 * sz, y3 = x1 * sz + y2 * cz;
    let px = x3 + tx, py = y3 + ty, pz = z2 + (T.z || 0), dd = d;
    if (cam) {
      // world → camera: translate, then inverse camera rotation (Y, X, Z), dolly moves the camera into the scene
      px -= cam.x; py -= cam.y; pz += cam.dolly;
      const a = (-cam.ry * Math.PI) / 180, b = (-cam.rx * Math.PI) / 180, g = (-cam.rz * Math.PI) / 180;
      let X = px * Math.cos(a) + pz * Math.sin(a), Z = -px * Math.sin(a) + pz * Math.cos(a);
      let Y = py * Math.cos(b) - Z * Math.sin(b); Z = py * Math.sin(b) + Z * Math.cos(b);
      const X2 = X * Math.cos(g) - Y * Math.sin(g), Y2 = X * Math.sin(g) + Y * Math.cos(g);
      px = X2; py = Y2; pz = Z; dd = PH * (cam.persp || 1.6);
    }
    const w = Math.max(0.05, (dd - pz) / dd);
    out.set([(px * 2) / PW, (-py * 2) / PH, 0, w, c[2], c[3]], i * 6);
  });
  return { data: out, upscale: fit * s };
}

// monotone cubic interpolation of curve points -> 256 samples
export function sampleCurve(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(256);
  const n = p.length;
  if (n < 2) { for (let i = 0; i < 256; i++) out[i] = i / 255; return out; }
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx.push(p[i + 1][0] - p[i][0] || 1e-6); dy.push(p[i + 1][1] - p[i][1]); m.push(dy[i] / dx[i]); }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i]; const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  for (let j = 0; j < 256; j++) {
    const x = j / 255;
    let i = 0; while (i < n - 2 && x > p[i + 1][0]) i++;
    if (x <= p[0][0]) { out[j] = p[0][1]; continue; }
    if (x >= p[n - 1][0]) { out[j] = p[n - 1][1]; continue; }
    const h = dx[i], u = (x - p[i][0]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    out[j] = Math.max(0, Math.min(1, h00 * p[i][1] + h10 * h * t[i] + h01 * p[i + 1][1] + h11 * h * t[i + 1]));
  }
  return out;
}
