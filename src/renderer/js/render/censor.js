// Censor / tracked mask effects.
//  censor      – one region (keyframeable centre + size, trackable), blur / pixelate / bar / mask.
//  facecensor  – any number of tracked regions stored in fx.data.tracks (AI face detection).
// Regions are in project-frame coordinates, normalised 0..1, y down.
import { defineEffect as def } from './effects.js';
import { GLSL_HEADER } from './gl.js';

const R = (k, de, en, min, max, d, step = 0.01) => ({ k, de, en, type: 'range', min, max, def: d, step });
const C = (k, de, en, d) => ({ k, de, en, type: 'color', def: d });
const S = (k, de, en, options, d = 0) => ({ k, de, en, type: 'select', options, def: d });
const B = (k, de, en, d = false) => ({ k, de, en, type: 'bool', def: d });

export const CENSOR_MODES = ['Weichzeichnen', 'Verpixeln', 'Balken (Farbe)', 'Maske: nur Bereich zeigen', 'Maske: Bereich ausschneiden', 'Bereich hervorheben (Rest dunkel)'];
export const CENSOR_SHAPES = ['Oval', 'Rechteck', 'Abgerundet'];
const MAXR = 24;

const FS_CENSOR = `${GLSL_HEADER}
uniform sampler2D u_fx; uniform vec4 u_rects[${MAXR}]; uniform float u_n, u_mode, u_shape, u_feather, u_px; uniform vec3 u_color;
float sdf(vec2 p, vec4 r){
  vec2 c = r.xy * u_res, h = max(r.zw * u_res * 0.5, vec2(1.0));
  if (u_shape < 0.5) return (length((p - c) / h) - 1.0) * min(h.x, h.y);
  float rr = u_shape > 1.5 ? min(h.x, h.y) * 0.35 : 0.0;
  vec2 q = abs(p - c) - h + rr; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
}
void main(){
  vec2 p = v_uv * u_res; float m = 0.0, blk = u_px;
  for (int i = 0; i < ${MAXR}; i++) { if (float(i) >= u_n) break; vec4 r = u_rects[i]; r.y = 1.0 - r.y; float d = sdf(p, r); float mi = clamp(0.5 - d / max(u_feather, 1.0), 0.0, 1.0); if (mi > m) { m = mi; blk = max(u_px, min(r.z * u_res.x, r.w * u_res.y) / 7.0); } }
  vec4 s = tex(v_uv);
  if (u_mode < 0.5) { o = mix(s, texture(u_fx, v_uv), m); return; }
  if (u_mode < 1.5) { vec2 b = max(blk, 2.0) / u_res; vec4 px = tex((floor(v_uv / b) + 0.5) * b); o = mix(s, px, m); return; }
  if (u_mode < 2.5) { o = mix(s, vec4(u_color, 1.0), m); return; }
  if (u_mode < 3.5) { o = s * m; return; }
  if (u_mode < 4.5) { o = s * (1.0 - m); return; }
  o = vec4(mix(s.rgb * 0.3, s.rgb, m), s.a);
}`;

function runCensor(ctx, src, dst, P, rects) {
  const flat = new Float32Array(MAXR * 4); flat._vec4 = true; const n = Math.min(MAXR, rects.length);
  for (let i = 0; i < n; i++) flat.set(rects[i], i * 4);
  let fx = null;
  if (P.mode === 0 && n) { fx = ctx.temp(); let big = 0; for (let i = 0; i < n; i++) big = Math.max(big, Math.min(rects[i][2] * ctx.w, rects[i][3] * ctx.h)); const r = Math.min(80, Math.max(2, P.strength * ctx.scale * 1.2, big * 0.14)); ctx.blur(src, fx, r); const t2 = ctx.temp(); ctx.blur(fx, t2, r * 0.6); ctx.free(fx); fx = t2; }
  ctx.runShader('censor', FS_CENSOR, src, dst, { u_rects: flat, u_n: n, u_mode: P.mode, u_shape: P.shape, u_feather: P.feather * ctx.scale, u_px: P.strength * ctx.scale, u_color: P.color }, { u_fx: fx || src });
  if (fx) ctx.free(fx);
}

def('censor', {
  name: { de: 'Zensur / Tracking-Maske', en: 'Censor / tracked mask' }, cat: 'key', special: 'censor',
  params: [S('mode', 'Art', 'Mode', CENSOR_MODES, 1), S('shape', 'Form', 'Shape', CENSOR_SHAPES, 0),
    R('cx', 'Mitte X', 'Center X', -0.5, 1.5, 0.5, 0.001), R('cy', 'Mitte Y', 'Center Y', -0.5, 1.5, 0.5, 0.001),
    R('w', 'Breite', 'Width', 0.005, 1.5, 0.2, 0.001), R('h', 'Höhe', 'Height', 0.005, 1.5, 0.25, 0.001),
    R('strength', 'Stärke (Pixel/Blur)', 'Strength', 2, 120, 28, 1), R('feather', 'Weiche Kante (px)', 'Feather (px)', 0, 120, 6, 0.5), C('color', 'Balkenfarbe', 'Bar color', '#000000')],
  passes(ctx, src, dst, P) { runCensor(ctx, src, dst, P, [[P.cx, P.cy, P.w, P.h]]); },
});

// fx.data.tracks: [{ id, on, keys: [[lt, cx, cy, w, h], ...] }]  (clip-local seconds, sorted)
export function regionsAt(tracks, lt, pad = 1) {
  const out = [];
  for (const tr of tracks || []) {
    if (tr.on === false) continue; const k = tr.keys; if (!k?.length) continue;
    const t0 = k[0][0], t1 = k[k.length - 1][0];
    if (lt < t0 - 0.12 || lt > t1 + 0.12) continue;
    let r;
    if (lt <= t0) r = k[0]; else if (lt >= t1) r = k[k.length - 1];
    else { let lo = 0, hi = k.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (k[mid][0] <= lt) lo = mid; else hi = mid; } const a = k[lo], b = k[hi], f = (lt - a[0]) / Math.max(1e-6, b[0] - a[0]); r = a.map((v, i) => v + (b[i] - v) * f); }
    out.push([r[1], r[2], r[3] * pad, r[4] * pad]);
  }
  return out;
}
def('facecensor', {
  name: { de: 'Gesichter zensieren (KI)', en: 'Censor faces (AI)' }, cat: 'key', special: 'facecensor',
  params: [S('mode', 'Art', 'Mode', CENSOR_MODES, 1), S('shape', 'Form', 'Shape', CENSOR_SHAPES, 0),
    R('pad', 'Größe', 'Size', 0.6, 2.5, 1.35, 0.01), R('strength', 'Stärke (Pixel/Blur)', 'Strength', 2, 120, 26, 1),
    R('feather', 'Weiche Kante (px)', 'Feather (px)', 0, 120, 6, 0.5), C('color', 'Balkenfarbe', 'Bar color', '#000000')],
  passes(ctx, src, dst, P, { fx } = {}) {
    const rects = regionsAt(fx?.data?.tracks, ctx.lt, P.pad);
    if (!rects.length) { ctx.runShader('censor_copy', `${GLSL_HEADER} void main(){ o = tex(v_uv); }`, src, dst); return; }
    runCensor(ctx, src, dst, P, rects);
  },
});
