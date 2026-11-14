// Advanced effects with custom data: Bezier masks, corner pin (homography), particle emitter.
import { defineEffect as def } from './effects.js';
import { GLSL_HEADER } from './gl.js';

const R = (k, de, en, min, max, d, step = 0.01) => ({ k, de, en, type: 'range', min, max, def: d, step });
const C = (k, de, en, d) => ({ k, de, en, type: 'color', def: d });
const S = (k, de, en, options, d = 0) => ({ k, de, en, type: 'select', options, def: d });
const B = (k, de, en, d = false) => ({ k, de, en, type: 'bool', def: d });

// ---------------------------------------------------------------- Bezier / freeform mask
// points: [[x,y,smooth], ...] normalised (0..1, y down). Keyframeable as a whole (point arrays interpolate).
const maskCanvas = document.createElement('canvas');
export function pathPoints(pts) {
  // Catmull-Rom → cubic bezier segments for smooth points
  const n = pts.length; const segs = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const s1 = p1[2] ? 1 : 0, s2 = p2[2] ? 1 : 0;
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * s1, p1[1] + ((p2[1] - p0[1]) / 6) * s1];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * s2, p2[1] - ((p3[1] - p1[1]) / 6) * s2];
    segs.push([p1, c1, c2, p2]);
  }
  return segs;
}
def('bezmask', {
  name: { de: 'Freihand-/Bezier-Maske', en: 'Bezier mask' }, cat: 'key', special: 'bezmask',
  params: [{ k: 'points', de: 'Pfad', en: 'Path', type: 'path', def: [[0.3, 0.3, 1], [0.7, 0.3, 1], [0.7, 0.7, 1], [0.3, 0.7, 1]] },
    R('feather', 'Weiche Kante (px)', 'Feather (px)', 0, 200, 12, 0.5), R('expand', 'Erweitern (px)', 'Expand (px)', -100, 100, 0, 0.5), R('opacity', 'Deckkraft', 'Opacity', 0, 1, 1), B('invert', 'Invertieren', 'Invert')],
  passes(ctx, src, dst, P) {
    const W = ctx.w, H = ctx.h; const c = maskCanvas; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    const pts = Array.isArray(P.points) ? P.points : [];
    if (pts.length >= 3) {
      g.filter = P.feather > 0.3 ? `blur(${(P.feather * ctx.scale).toFixed(1)}px)` : 'none';
      g.beginPath();
      const segs = pathPoints(pts);
      g.moveTo(segs[0][0][0] * W, segs[0][0][1] * H);
      for (const [, c1, c2, p2] of segs) g.bezierCurveTo(c1[0] * W, c1[1] * H, c2[0] * W, c2[1] * H, p2[0] * W, p2[1] * H);
      g.closePath(); g.fillStyle = '#fff'; g.fill();
      if (P.expand > 0) { g.lineWidth = P.expand * 2 * ctx.scale; g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.stroke(); }
      if (P.expand < 0) { g.globalCompositeOperation = 'destination-out'; g.lineWidth = -P.expand * 2 * ctx.scale; g.strokeStyle = '#000'; g.stroke(); g.globalCompositeOperation = 'source-over'; }
      g.filter = 'none';
    }
    const tex = ctx.uploadCanvas('bezmask', c);
    ctx.runShader('bezmask', `${GLSL_HEADER} uniform sampler2D u_m; uniform float u_inv, u_op; void main(){ float m = texture(u_m, vec2(v_uv.x, 1.0-v_uv.y)).a; if (u_inv > 0.5) m = 1.0-m; o = tex(v_uv) * mix(1.0, m, u_op); }`, src, dst, { u_inv: P.invert, u_op: P.opacity }, { u_m: tex });
  },
});

// ---------------------------------------------------------------- corner pin (perspective warp of the layer)
function homography(src, dst) {
  // solve 8x8 for H mapping src->dst (4 points)
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) { // gaussian elimination
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
export { homography };
def('cornerpin', {
  name: { de: 'Corner-Pin (4 Ecken)', en: 'Corner pin' }, cat: 'distort', special: 'cornerpin',
  params: [R('tlx', 'Oben links X', 'Top-left X', -0.5, 1.5, 0), R('tly', 'Oben links Y', 'Top-left Y', -0.5, 1.5, 0), R('trx', 'Oben rechts X', 'Top-right X', -0.5, 1.5, 1), R('try_', 'Oben rechts Y', 'Top-right Y', -0.5, 1.5, 0),
    R('brx', 'Unten rechts X', 'Bottom-right X', -0.5, 1.5, 1), R('bry', 'Unten rechts Y', 'Bottom-right Y', -0.5, 1.5, 1), R('blx', 'Unten links X', 'Bottom-left X', -0.5, 1.5, 0), R('bly', 'Unten links Y', 'Bottom-left Y', -0.5, 1.5, 1)],
  passes(ctx, src, dst, P) {
    // destination quad (y down, normalised) -> inverse homography maps output uv to source uv
    const dstQ = [[P.tlx, P.tly], [P.trx, P.try_], [P.brx, P.bry], [P.blx, P.bly]];
    const H = homography(dstQ, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    ctx.runShader('cornerpin', `${GLSL_HEADER} uniform vec3 u_h0, u_h1, u_h2; void main(){ vec2 p = vec2(v_uv.x, 1.0-v_uv.y); vec3 q = vec3(dot(u_h0, vec3(p,1.0)), dot(u_h1, vec3(p,1.0)), dot(u_h2, vec3(p,1.0))); vec2 s = q.xy/q.z; if (s.x<0.0||s.y<0.0||s.x>1.0||s.y>1.0) { o = vec4(0.0); return; } o = texture(u_tex, vec2(s.x, 1.0-s.y)); }`,
      src, dst, { u_h0: H.slice(0, 3), u_h1: H.slice(3, 6), u_h2: H.slice(6, 9) });
  },
});

// ---------------------------------------------------------------- particle emitter (analytic, GPU)
export const EMITTER_PRESETS = {
  fireworks: { de: 'Feuerwerk', en: 'Fireworks', p: { x: 0.5, y: 0.35, w: 0, dir: 90, spread: 360, speed: 0.45, grav: 0.35, life: 1.6, count: 120, size: 3, c1: '#ffe27a', c2: '#ff3b6b', shape: 0, rate: 1, glow: 1.2, burst: true } },
  sparkrain: { de: 'Funkenregen', en: 'Spark shower', p: { x: 0.5, y: 0.05, w: 0.6, dir: -90, spread: 30, speed: 0.15, grav: 0.6, life: 1.4, count: 140, size: 2, c1: '#fff3b0', c2: '#ff6a00', shape: 1, rate: 1, glow: 1.4 } },
  confetti: { de: 'Konfetti', en: 'Confetti', p: { x: 0.5, y: -0.05, w: 1.0, dir: -90, spread: 40, speed: 0.12, grav: 0.15, life: 4, count: 120, size: 7, c1: '#ff4fa3', c2: '#3fd0ff', shape: 2, rate: 1, glow: 0, rainbow: true } },
  magic: { de: 'Magie-Funkeln', en: 'Magic sparkle', p: { x: 0.5, y: 0.6, w: 0.15, dir: 90, spread: 70, speed: 0.12, grav: -0.05, life: 2.2, count: 90, size: 4, c1: '#9d84ff', c2: '#22d3ee', shape: 3, rate: 1, glow: 1.6 } },
  smokepuffs: { de: 'Rauchwolken', en: 'Smoke puffs', p: { x: 0.5, y: 0.9, w: 0.3, dir: 90, spread: 25, speed: 0.08, grav: -0.02, life: 4, count: 50, size: 60, c1: '#888c94', c2: '#2a2d33', shape: 0, rate: 1, glow: 0, soft: 1 } },
  explosion: { de: 'Explosion', en: 'Explosion', p: { x: 0.5, y: 0.55, w: 0.02, dir: 90, spread: 360, speed: 0.6, grav: 0.4, life: 1.0, count: 160, size: 4, c1: '#fff1a1', c2: '#ff2a00', shape: 1, rate: 1, glow: 2, burst: true } },
  fountain: { de: 'Fontäne', en: 'Fountain', p: { x: 0.5, y: 0.95, w: 0.02, dir: 90, spread: 20, speed: 0.55, grav: 0.9, life: 1.6, count: 140, size: 3, c1: '#bfe9ff', c2: '#2b7bff', shape: 0, rate: 1, glow: 0.8 } },
  embers: { de: 'Glut', en: 'Embers', p: { x: 0.5, y: 1.0, w: 1.0, dir: 90, spread: 30, speed: 0.08, grav: -0.03, life: 5, count: 80, size: 3, c1: '#ffb347', c2: '#ff2200', shape: 0, rate: 1, glow: 1.5 } },
};
def('emitter', {
  name: { de: 'Partikel-Emitter', en: 'Particle emitter' }, cat: 'particles', special: 'emitter',
  params: [R('x', 'Quelle X', 'Source X', -0.2, 1.2, 0.5), R('y', 'Quelle Y', 'Source Y', -0.2, 1.2, 0.5), R('w', 'Quellbreite', 'Source width', 0, 1.5, 0.05),
    R('dir', 'Richtung (°)', 'Direction (°)', -180, 180, 90, 1), R('spread', 'Streuung (°)', 'Spread (°)', 0, 360, 40, 1), R('speed', 'Tempo', 'Speed', 0, 2, 0.3),
    R('grav', 'Schwerkraft', 'Gravity', -1, 2, 0.3), R('life', 'Lebensdauer (s)', 'Lifetime (s)', 0.2, 8, 2), R('count', 'Anzahl', 'Count', 4, 160, 80, 1), R('size', 'Größe (px)', 'Size (px)', 1, 120, 4, 0.5),
    C('c1', 'Farbe Start', 'Color start', '#ffffff'), C('c2', 'Farbe Ende', 'Color end', '#ff8a3d'), S('shape', 'Form', 'Shape', ['Punkt', 'Streifen', 'Quadrat', 'Stern']),
    R('glow', 'Leuchten', 'Glow', 0, 3, 1), B('burst', 'Explosion (einmalig)', 'Burst (once)'), B('rainbow', 'Regenbogen', 'Rainbow'), R('soft', 'Weichheit', 'Softness', 0, 1, 0.3), R('seedP', 'Variante', 'Variant', 0, 100, 1, 1)],
  glsl: `vec4 fx(vec2 uv){ return tex(uv); }`,
  passes(ctx, src, dst, P) {
    ctx.runShader('emitter', `${GLSL_HEADER}
      uniform float u_x,u_y,u_w,u_dir,u_spread,u_speed,u_grav,u_life,u_count,u_size,u_shape,u_glow,u_burst,u_rainbow,u_soft,u_seedP; uniform vec3 u_c1,u_c2;
      void main(){ vec4 s = tex(v_uv); vec2 asp = vec2(u_res.x/u_res.y, 1.0); vec2 p = vec2(v_uv.x, 1.0-v_uv.y)*asp; vec3 acc = vec3(0); float aa = 0.0;
        float sz = u_size*u_scale/u_res.y;
        for (int i=0;i<160;i++){ if (float(i) >= u_count) break; float fi = float(i) + u_seedP*17.0;
          float birth = u_burst > 0.5 ? 0.0 : hash1(fi*1.7)*u_life; float t = u_burst > 0.5 ? u_lt : mod(u_lt + birth, u_life); float cycle = u_burst > 0.5 ? 0.0 : floor((u_lt + birth)/u_life);
          float age = t/u_life; if (age > 1.0) continue;
          float a = radians(u_dir + (hash1(fi*3.1+cycle*7.3)-0.5)*u_spread); float sp = u_speed*(0.5+hash1(fi*5.7+cycle)*0.8);
          vec2 o0 = vec2(u_x + (hash1(fi*9.1+cycle*3.0)-0.5)*u_w, u_y)*asp;
          vec2 pos = o0 + vec2(cos(a), -sin(a))*sp*t + vec2(0.0, 0.5*u_grav*t*t);
          vec2 d = p - pos; float r;
          if (u_shape < 0.5) r = length(d);
          else if (u_shape < 1.5) { vec2 vel = normalize(vec2(cos(a), -sin(a))*sp + vec2(0.0, u_grav*t) + 1e-5); float along = dot(d, vel); float across = dot(d, vec2(-vel.y, vel.x)); r = length(vec2(along*0.25, across)); }
          else if (u_shape < 2.5) { float ang = fi + u_lt*3.0; mat2 m = mat2(cos(ang),-sin(ang),sin(ang),cos(ang)); vec2 q = m*d; r = max(abs(q.x), abs(q.y)*1.6); }
          else { float an = atan(d.y,d.x); r = length(d)*(0.6+0.4*cos(5.0*an+fi)); }
          float size = sz*(1.0 - age*0.5);
          float m = smoothstep(size, size*(1.0-u_soft*0.9)-0.0001, r);
          float glow = u_glow*0.15*size/(r+size*0.5)*smoothstep(size*6.0, 0.0, r);
          float fade = smoothstep(0.0, 0.05, age)*(1.0-smoothstep(0.7, 1.0, age));
          vec3 col = u_rainbow > 0.5 ? hsv2rgb(vec3(hash1(fi*2.3), 0.85, 1.0)) : mix(u_c1, u_c2, age);
          acc += col*(m + glow)*fade; aa = max(aa, m*fade);
        }
        o = vec4(s.rgb + acc, max(s.a, clamp(aa + luma(acc)*0.5, 0.0, 1.0)));
      }`, src, dst, Object.fromEntries(Object.entries(P).map(([k, v]) => ['u_' + k, v])));
  },
});
