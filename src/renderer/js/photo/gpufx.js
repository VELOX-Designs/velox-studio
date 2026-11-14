// Runs the video effect shaders (colour, filters, realism …) on a still image – same look as in the video editor.
import { Compositor } from '../render/compositor.js';
import { canvas, ctx2d } from './doc.js';

let comp = null, glc = null;
const FLIP = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D u_tex; void main(){ o = texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y)); }`;
const COPY = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D u_tex; void main(){ o = texture(u_tex, v_uv); }`;
function get() {
  if (!comp || comp.g.gl.isContextLost()) { glc = document.createElement('canvas'); comp = new Compositor(glc, { preserve: true }); }
  return comp;
}
// effects: [{type, params, enabled}] ; amt: 0..1 mix with the original ; returns the GL canvas (draw it right away) or a copy
export function applyFx(src, effects, { amt = 1, copy = false } = {}) {
  const list = (effects || []).filter((e) => e.enabled !== false);
  if (!list.length) return src;
  const c = get(); c.scale = 1; c.time = 0; c.setSize(src.width, src.height); c.g.releaseAll();
  const tex = c.sourceTexture('photo_src', src, src.width, src.height, undefined);
  const t0 = c.temp(); c.pass('copy_flip', FLIP, tex, t0);
  const clip = { id: 'photo', type: 'image', effects: list.map((e) => ({ enabled: true, ...e, fromFilter: amt < 0.999 })), filter: amt < 0.999 ? 'x' : null, filterAmt: amt, transform: {}, dur: 1 };
  const out = c.applyEffects(clip, 0, t0);
  c.g.bind(null); c.pass('copy_plain', COPY, out, null); c.free(out, t0);
  if (!copy) return glc;
  const r = canvas(src.width, src.height); ctx2d(r).drawImage(glc, 0, 0); return r;
}
