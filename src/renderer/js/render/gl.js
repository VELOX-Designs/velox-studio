// Minimal WebGL2 toolkit: programs, fullscreen quad, render targets, textures.
export const VS_QUAD = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

export const GLSL_HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform float u_lt;
uniform float u_seed;
uniform float u_scale;
#define PI 3.14159265359
vec4 unpm(vec4 c){ return c.a > 0.0001 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 pm(vec4 c){ return vec4(c.rgb * c.a, c.a); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash1(float n){ return fract(sin(n) * 43758.5453123); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
vec4 tex(vec2 uv){ return texture(u_tex, uv); }
vec4 texc(vec2 uv){ if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return vec4(0.0); return texture(u_tex, uv); }
`;

export class GL {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance', desynchronized: false });
    if (!gl) throw new Error('WebGL2 nicht verfügbar');
    this.gl = gl; this.canvas = canvas;
    this.floatOk = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.progs = new Map();
    this.pool = [];
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.quadVao = vao; this.quadBuf = buf;
    // dynamic quad for transformed layers (x,y,z,w? we use x,y,u,v + extra)
    this.dynVao = gl.createVertexArray(); gl.bindVertexArray(this.dynVao);
    this.dynBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 6 * 4, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.disable(gl.DEPTH_TEST);
    this.white = this.texFromPixels(1, 1, new Uint8Array([255, 255, 255, 255]));
  }
  compile(type, src) {
    const gl = this.gl; const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(log, '\n', src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
      throw new Error('Shader: ' + log);
    }
    return s;
  }
  program(key, fs, vs = VS_QUAD) {
    let p = this.progs.get(key);
    if (p) return p;
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.bindAttribLocation(prog, 1, 'a_uv');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    p = { prog, loc: {} };
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      p.loc[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(prog, info.name);
    }
    this.progs.set(key, p);
    return p;
  }
  use(p, uniforms = {}, textures = {}) {
    const gl = this.gl; gl.useProgram(p.prog);
    let unit = 0;
    for (const [name, t] of Object.entries(textures)) {
      if (!p.loc[name]) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      if (t && t.is3d) gl.bindTexture(gl.TEXTURE_3D, t.tex);
      else gl.bindTexture(gl.TEXTURE_2D, t?.tex || t || this.white.tex);
      gl.uniform1i(p.loc[name], unit++);
    }
    for (const [name, v] of Object.entries(uniforms)) {
      const l = p.loc[name]; if (!l) continue;
      if (typeof v === 'number' || typeof v === 'boolean') gl.uniform1f(l, +v);
      else if (v.length === 2) gl.uniform2fv(l, v);
      else if (v.length === 3) gl.uniform3fv(l, v);
      else if (v.length === 4) gl.uniform4fv(l, v);
      else if (v.length === 16) gl.uniformMatrix4fv(l, false, v);
      else gl.uniform1fv(l, v);
    }
  }
  drawQuad() { const gl = this.gl; gl.bindVertexArray(this.quadVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.disableVertexAttribArray(1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  // verts: Float32Array of 4 vertices * (x,y,z,w,u,v)
  drawDyn(verts) {
    const gl = this.gl; gl.bindVertexArray(this.dynVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  newTexture(w, h, filter = 'linear') {
    const gl = this.gl; const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return { tex, w, h };
  }
  texFromPixels(w, h, data) {
    const t = this.newTexture(0, 0); const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    t.w = w; t.h = h; return t;
  }
  upload(t, src, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (src && src.data) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      t.w = src.width; t.h = src.height;
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      t.w = w; t.h = h;
    }
  }
  // render target pool
  target(w, h) {
    const free = this.pool.find((r) => !r.busy && r.w === w && r.h === h);
    if (free) { free.busy = true; return free; }
    const gl = this.gl;
    const t = this.newTexture(w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    const r = { fb, tex: t.tex, w, h, busy: true };
    this.pool.push(r);
    return r;
  }
  release(r) { if (r && r.fb) r.busy = false; }
  releaseAll() { this.pool.forEach((r) => (r.busy = false)); }
  trimPool(w, h) {
    const gl = this.gl;
    this.pool = this.pool.filter((r) => {
      if (!r.busy && (r.w !== w || r.h !== h) && !r.keep) { gl.deleteFramebuffer(r.fb); gl.deleteTexture(r.tex); return false; }
      return true;
    });
  }
  bind(r) {
    const gl = this.gl;
    if (r) { gl.bindFramebuffer(gl.FRAMEBUFFER, r.fb); gl.viewport(0, 0, r.w, r.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
  }
  clear(r, c = [0, 0, 0, 0]) { const gl = this.gl; this.bind(r); gl.clearColor(c[0], c[1], c[2], c[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
}

// parse Adobe .cube 3D LUT
export function parseCube(text) {
  let size = 0; const data = [];
  let dmin = [0, 0, 0], dmax = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l[0] === '#') continue;
    if (l.startsWith('LUT_3D_SIZE')) { size = parseInt(l.split(/\s+/)[1]); continue; }
    if (l.startsWith('DOMAIN_MIN')) { dmin = l.split(/\s+/).slice(1).map(Number); continue; }
    if (l.startsWith('DOMAIN_MAX')) { dmax = l.split(/\s+/).slice(1).map(Number); continue; }
    if (/^[A-Za-z_]/.test(l)) continue;
    const v = l.split(/\s+/).map(Number);
    if (v.length >= 3 && v.every(isFinite)) data.push(v[0], v[1], v[2]);
  }
  if (!size || data.length < size * size * size * 3) throw new Error('Ungültige .cube Datei');
  const out = new Uint8Array(size * size * size * 4);
  for (let i = 0; i < size * size * size; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(((data[i * 3 + c] - dmin[c]) / (dmax[c] - dmin[c])) * 255)));
    out[i * 4 + 3] = 255;
  }
  return { size, data: out };
}
export function upload3d(glw, lut) {
  const gl = glw.gl; const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  return { tex, is3d: true, size: lut.size };
}
