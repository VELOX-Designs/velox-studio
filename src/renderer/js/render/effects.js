// Effect registry. Every effect is GPU (GLSL) based and every numeric/color param is keyframeable.
// def: { name:{de,en}, cat, params:[{k,de,en,type,min,max,step,def,options}], glsl | passes | mod }
//   glsl   : body defining `vec4 fx(vec2 uv)` – single pass, params become uniforms u_<k>
//   passes : (ctx, src, dst, P, info) => void – custom multi-pass
//   mod    : (P, lt, info) => {dx,dy,rot,scale} – transform modifier (shake, zoom pulse …)
import { GLSL_HEADER } from './gl.js';

export const EFFECTS = {};
export const EFFECT_CATS = {
  color: { de: 'Farbe', en: 'Color' },
  realism: { de: 'Realismus / KI', en: 'Realism / AI' },
  blur: { de: 'Unschärfe', en: 'Blur' },
  light: { de: 'Licht', en: 'Light' },
  stylize: { de: 'Stil', en: 'Stylize' },
  distort: { de: 'Verzerrung', en: 'Distort' },
  glitch: { de: 'Glitch', en: 'Glitch' },
  motion: { de: 'Bewegung', en: 'Motion' },
  key: { de: 'Keying / Maske', en: 'Keying / Mask' },
  particles: { de: 'Partikel', en: 'Particles' },
  cinematic: { de: 'Cinematic', en: 'Cinematic' },
  '3d': { de: '3D', en: '3D' },
};

const R = (k, de, en, min, max, def, step = 0.01) => ({ k, de, en, type: 'range', min, max, def, step });
const C = (k, de, en, def) => ({ k, de, en, type: 'color', def });
const B = (k, de, en, def = false) => ({ k, de, en, type: 'bool', def });
const S = (k, de, en, options, def = 0) => ({ k, de, en, type: 'select', options, def });

export function defineEffect(id, d) { EFFECTS[id] = { id, ...d }; return EFFECTS[id]; }
const def = defineEffect;

export function defaultParams(id) {
  const d = EFFECTS[id]; const p = {};
  for (const q of d?.params || []) p[q.k] = Array.isArray(q.def) ? JSON.parse(JSON.stringify(q.def)) : q.def;
  return p;
}

export function buildFxShader(d) {
  const uni = (d.params || []).filter((q) => q.type !== 'curve' && q.type !== 'file' && q.type !== 'path').map((q) => {
    const t = q.type === 'color' ? 'vec3' : 'float';
    return `uniform ${t} u_${q.k};`;
  }).join('\n');
  return `${GLSL_HEADER}\n${uni}\n${d.uniforms || ''}\n${d.glsl}\nvoid main(){ o = fx(v_uv); }`;
}

// ------------------------------------------------------------------ COLOR
def('color', {
  name: { de: 'Farbkorrektur', en: 'Color Correction' }, cat: 'color',
  params: [R('exposure', 'Belichtung', 'Exposure', -3, 3, 0), R('brightness', 'Helligkeit', 'Brightness', -1, 1, 0), R('contrast', 'Kontrast', 'Contrast', -1, 1, 0),
    R('saturation', 'Sättigung', 'Saturation', -1, 1, 0), R('vibrance', 'Dynamik', 'Vibrance', -1, 1, 0), R('temperature', 'Temperatur', 'Temperature', -1, 1, 0),
    R('tint', 'Farbton (Tint)', 'Tint', -1, 1, 0), R('hue', 'Farbrotation', 'Hue', -180, 180, 0, 1), R('highlights', 'Lichter', 'Highlights', -1, 1, 0),
    R('shadows', 'Schatten', 'Shadows', -1, 1, 0), R('whites', 'Weiß', 'Whites', -1, 1, 0), R('blacks', 'Schwarz', 'Blacks', -1, 1, 0),
    R('gamma', 'Gamma', 'Gamma', 0.2, 3, 1), R('fade', 'Ausbleichen', 'Fade', 0, 1, 0)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); vec3 c = s.rgb;
    c *= exp2(u_exposure);
    c += u_brightness * 0.5;
    c.r += u_temperature * 0.12; c.b -= u_temperature * 0.12; c.g += u_tint * 0.1;
    float L = luma(c);
    c += u_shadows * 0.5 * (1.0 - smoothstep(0.0, 0.55, L)) * (1.0 - L);
    c += u_highlights * 0.5 * smoothstep(0.45, 1.0, L) * L;
    c += u_whites * 0.3 * smoothstep(0.7, 1.0, L);
    c += u_blacks * 0.3 * (1.0 - smoothstep(0.0, 0.3, L));
    c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
    c = pow(max(c, 0.0), vec3(1.0 / u_gamma));
    L = luma(c);
    float sat = max(max(c.r,c.g),c.b) - min(min(c.r,c.g),c.b);
    c = mix(vec3(L), c, 1.0 + u_saturation + u_vibrance * (1.0 - sat));
    if (abs(u_hue) > 0.01) { vec3 h = rgb2hsv(clamp(c,0.0,1.0)); h.x = fract(h.x + u_hue / 360.0); c = hsv2rgb(h); }
    c = mix(c, c * 0.85 + 0.12, u_fade);
    return pm(vec4(clamp(c, 0.0, 1.0), s.a)); }`,
});
def('wheels', {
  name: { de: 'Farbräder (Lift/Gamma/Gain)', en: 'Color Wheels' }, cat: 'color',
  params: [C('lift', 'Lift (Tiefen)', 'Lift', '#808080'), R('liftL', 'Lift Helligkeit', 'Lift Luma', -0.5, 0.5, 0),
    C('gammaC', 'Gamma (Mitten)', 'Gamma', '#808080'), R('gammaL', 'Gamma Helligkeit', 'Gamma Luma', -0.5, 0.5, 0),
    C('gain', 'Gain (Lichter)', 'Gain', '#808080'), R('gainL', 'Gain Helligkeit', 'Gain Luma', -0.5, 0.5, 0),
    C('offset', 'Offset', 'Offset', '#808080'), R('mix', 'Stärke', 'Amount', 0, 1, 1)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); vec3 c = s.rgb;
    vec3 lift = (u_lift - 0.5) * 0.4 + u_liftL; vec3 gam = (u_gammaC - 0.5) * 0.8 + u_gammaL; vec3 gain = (u_gain - 0.5) * 0.8 + u_gainL;
    vec3 r = c * (1.0 + gain) + lift * (1.0 - c);
    r = pow(max(r, 0.0), 1.0 / max(vec3(0.05), 1.0 + gam));
    r += (u_offset - 0.5) * 0.3;
    return pm(vec4(clamp(mix(c, r, u_mix), 0.0, 1.0), s.a)); }`,
});
def('curves', {
  name: { de: 'Kurven', en: 'Curves' }, cat: 'color', special: 'curves',
  params: [{ k: 'master', de: 'Master', en: 'Master', type: 'curve', def: [[0, 0], [1, 1]] },
    { k: 'r', de: 'Rot', en: 'Red', type: 'curve', def: [[0, 0], [1, 1]] },
    { k: 'g', de: 'Grün', en: 'Green', type: 'curve', def: [[0, 0], [1, 1]] },
    { k: 'b', de: 'Blau', en: 'Blue', type: 'curve', def: [[0, 0], [1, 1]] }, R('mix', 'Stärke', 'Amount', 0, 1, 1)],
  uniforms: 'uniform sampler2D u_curve;',
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); vec3 c = clamp(s.rgb,0.0,1.0);
    vec3 m = vec3(texture(u_curve, vec2(c.r,0.5)).a, texture(u_curve, vec2(c.g,0.5)).a, texture(u_curve, vec2(c.b,0.5)).a);
    vec3 r = vec3(texture(u_curve, vec2(m.r,0.5)).r, texture(u_curve, vec2(m.g,0.5)).g, texture(u_curve, vec2(m.b,0.5)).b);
    return pm(vec4(mix(c, r, u_mix), s.a)); }`,
});
def('lut', {
  name: { de: 'LUT (.cube)', en: 'LUT (.cube)' }, cat: 'color', special: 'lut',
  params: [{ k: 'file', de: 'LUT-Datei', en: 'LUT file', type: 'file', def: '', filter: ['cube'] }, R('mix', 'Intensität', 'Intensity', 0, 1, 1)],
  uniforms: 'uniform highp sampler3D u_lut; uniform float u_lutSize;',
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); vec3 c = clamp(s.rgb,0.0,1.0);
    float n = max(u_lutSize, 2.0); vec3 lc = c * ((n - 1.0) / n) + 0.5 / n;
    vec3 r = texture(u_lut, lc).rgb; return pm(vec4(mix(c, r, u_mix), s.a)); }`,
});
def('hsl', {
  name: { de: 'HSL Sekundär', en: 'HSL Secondary' }, cat: 'color',
  params: [R('target', 'Zielfarbton', 'Target hue', 0, 360, 200, 1), R('range', 'Bereich', 'Range', 5, 180, 40, 1),
    R('hueShift', 'Farbton verschieben', 'Hue shift', -180, 180, 0, 1), R('satAdj', 'Sättigung', 'Saturation', -1, 1, 0), R('lumAdj', 'Helligkeit', 'Lightness', -1, 1, 0)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); vec3 h = rgb2hsv(clamp(s.rgb,0.0,1.0));
    float d = abs(fract(h.x - u_target/360.0 + 0.5) - 0.5) * 360.0;
    float w = (1.0 - smoothstep(u_range*0.5, u_range, d)) * smoothstep(0.05, 0.2, h.y);
    h.x = fract(h.x + w * u_hueShift / 360.0); h.y = clamp(h.y * (1.0 + w * u_satAdj), 0.0, 1.0); h.z = clamp(h.z * (1.0 + w * u_lumAdj), 0.0, 1.0);
    return pm(vec4(hsv2rgb(h), s.a)); }`,
});
def('bw', {
  name: { de: 'Schwarzweiß', en: 'Black & White' }, cat: 'color',
  params: [R('mix', 'Stärke', 'Amount', 0, 1, 1), R('contrast', 'Kontrast', 'Contrast', -1, 1, 0.15), C('tintC', 'Tönung', 'Tint', '#ffffff')],
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); float L = luma(s.rgb); L = (L-0.5)*(1.0+u_contrast)+0.5;
    return pm(vec4(mix(s.rgb, clamp(vec3(L)*u_tintC,0.0,1.0), u_mix), s.a)); }`,
});
def('duotone', {
  name: { de: 'Duotone', en: 'Duotone' }, cat: 'color',
  params: [C('dark', 'Dunkel', 'Dark', '#1b0b3a'), C('light', 'Hell', 'Light', '#ff8a3d'), R('mix', 'Stärke', 'Amount', 0, 1, 1)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); vec3 d = mix(u_dark, u_light, smoothstep(0.0,1.0,luma(s.rgb))); return pm(vec4(mix(s.rgb, d, u_mix), s.a)); }`,
});
def('invert', { name: { de: 'Invertieren', en: 'Invert' }, cat: 'color', params: [R('mix', 'Stärke', 'Amount', 0, 1, 1)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); return pm(vec4(mix(s.rgb, 1.0 - s.rgb, u_mix), s.a)); }` });
def('posterize', { name: { de: 'Posterisieren', en: 'Posterize' }, cat: 'stylize', params: [R('levels', 'Stufen', 'Levels', 2, 32, 6, 1)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); return pm(vec4(floor(s.rgb * u_levels + 0.5) / u_levels, s.a)); }` });

// ------------------------------------------------------------------ REALISM (GPU, works on every graphics card)
def('realism', {
  name: { de: 'VELOX Realism (KI-Look)', en: 'VELOX Realism' }, cat: 'realism',
  params: [S('preset', 'Stil', 'Style', ['Natürlich', 'Fotoreal', 'Cinematic', 'Next-Gen Game', 'Nacht-Realismus'], 1),
    R('strength', 'Stärke', 'Strength', 0, 1, 1), R('detail', 'Detail-Rekonstruktion', 'Detail recovery', 0, 2, 1.2),
    R('sharpen', 'Adaptive Schärfe', 'Adaptive sharpen', 0, 1, 0.7), R('lighting', 'Globale Beleuchtung', 'Global illumination', 0, 1, 0.75),
    R('depth', 'Tiefe / Ambient Occlusion', 'Depth / AO', 0, 1, 0.7), R('bloom', 'Bloom / Halation', 'Bloom / Halation', 0, 1, 0.45),
    R('color', 'Farbwissenschaft', 'Color science', 0, 1, 0.8), R('dehaze', 'Dunst entfernen', 'Dehaze', 0, 1, 0.4),
    R('grain', 'Sensorkorn', 'Sensor grain', 0, 1, 0.25), R('lens', 'Linsencharakter', 'Lens character', 0, 1, 0.35)],
  passes(ctx, src, dst, P) {
    const s = ctx.scale;
    const big = ctx.temp(), small = ctx.temp(), bright = ctx.temp(), bb = ctx.temp();
    ctx.blur(src, big, 28 * s);
    ctx.blur(src, small, 3 * s);
    ctx.runShader('realism_bright', `${GLSL_HEADER}
      void main(){ vec4 c = unpm(tex(v_uv)); float L = luma(c.rgb); o = pm(vec4(c.rgb * smoothstep(0.62, 1.0, L), c.a)); }`, src, bright, {});
    ctx.blur(bright, bb, 40 * s);
    ctx.runShader('realism_main', `${GLSL_HEADER}
      uniform sampler2D u_big; uniform sampler2D u_small; uniform sampler2D u_bloom;
      uniform float u_preset, u_strength, u_detail, u_sharpen, u_lighting, u_depth, u_bloomA, u_color, u_dehaze, u_grain, u_lens;
      vec3 agx(vec3 x){ x = max(x, 0.0); vec3 a = x * (1.0 + x / 6.0) / (1.0 + x); return a; }
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
      void main(){
        vec2 uv = v_uv; vec2 px = 1.0 / u_res;
        vec4 s0 = tex(uv); vec4 s = unpm(s0); vec3 c = s.rgb;
        vec3 big = unpm(texture(u_big, uv)).rgb; vec3 sm = unpm(texture(u_small, uv)).rgb;
        // contrast-adaptive sharpening (CAS style)
        vec3 n = unpm(tex(uv + vec2(0, px.y))).rgb, so = unpm(tex(uv - vec2(0, px.y))).rgb, e = unpm(tex(uv + vec2(px.x, 0))).rgb, w = unpm(tex(uv - vec2(px.x, 0))).rgb;
        vec3 mn = min(c, min(min(n, so), min(e, w))), mx = max(c, max(max(n, so), max(e, w)));
        vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 0.001), 0.0, 1.0));
        float pk = -1.0 / mix(8.0, 5.0, u_sharpen); vec3 wgt = amp * pk;
        vec3 cas = clamp((c + (n + so + e + w) * wgt) / (1.0 + 4.0 * wgt), 0.0, 1.0);
        vec3 r = mix(c, cas, u_sharpen);
        // detail reconstruction: boost mid-frequency detail, suppress noise
        vec3 det = sm - big; vec3 fine = c - sm;
        r += det * u_detail * 0.8 + fine * u_detail * 0.35 * smoothstep(0.01, 0.05, abs(luma(fine)));
        // dehaze: remove veiling glare estimated from local minimum
        float veil = min(min(big.r, big.g), big.b);
        r = mix(r, (r - veil * 0.6) / max(1.0 - veil * 0.6, 0.3), u_dehaze);
        // depth / ambient occlusion from local luminance relationship
        float Lc = luma(r), Lb = luma(big);
        float ao = clamp(1.0 - max(Lb - Lc, 0.0) * 2.2, 0.55, 1.0);
        r *= mix(1.0, ao, u_depth);
        // global illumination: bounce light – tint shadows with surrounding color
        vec3 bounce = big * (1.0 - smoothstep(0.0, 0.5, Lc));
        r += bounce * u_lighting * 0.35;
        // bloom / halation
        vec3 bl = unpm(texture(u_bloom, uv)).rgb;
        vec3 hal = bl * vec3(1.0, 0.55, 0.35);
        r += mix(bl, hal, 0.4) * u_bloomA * 0.9;
        // tone mapping per preset
        int p = int(u_preset + 0.5);
        vec3 tm;
        if (p == 2) tm = aces(r * 1.15); else if (p == 3) tm = aces(r * 1.25) * 1.04; else if (p == 4) tm = agx(r * 1.4) * 1.1; else tm = agx(r * 1.2) * 1.12;
        r = mix(r, tm, 0.7 + 0.25 * float(p == 1));
        // color science: perceptual saturation, protect skin tones, subtle split tone
        float L = luma(r);
        vec3 hsv = rgb2hsv(clamp(r, 0.0, 1.0));
        float skin = 1.0 - smoothstep(0.02, 0.09, abs(hsv.x - 0.07));
        float satBoost = u_color * (0.35 - 0.25 * skin) * (1.0 - hsv.y);
        r = mix(vec3(L), r, 1.0 + satBoost);
        vec3 split = p == 2 ? mix(vec3(0.0, 0.03, 0.06), vec3(0.06, 0.03, -0.02), L) : p == 4 ? vec3(-0.02, 0.0, 0.05) * (1.0 - L) : vec3(0.0);
        r += split * u_color;
        // lens: subtle vignette + edge chroma
        vec2 d = uv - 0.5; float vg = 1.0 - dot(d, d) * 0.9 * u_lens;
        vec3 ca = vec3(unpm(tex(uv - d * 0.004 * u_lens)).r, r.g, unpm(tex(uv + d * 0.004 * u_lens)).b);
        r = mix(r, vec3(r.r + (ca.r - c.r) * 0.5, r.g, r.b + (ca.b - c.b) * 0.5), u_lens) * vg;
        // sensor grain (luma weighted)
        float gr = (hash(uv * u_res + fract(u_time * 13.1) * 100.0) - 0.5) * 0.08 * u_grain * (1.0 - L * 0.6);
        r += gr;
        o = pm(vec4(clamp(mix(c, r, u_strength), 0.0, 1.0), s.a));
      }`, src, dst, { u_preset: P.preset, u_strength: P.strength, u_detail: P.detail, u_sharpen: P.sharpen, u_lighting: P.lighting, u_depth: P.depth,
      u_bloomA: P.bloom, u_color: P.color, u_dehaze: P.dehaze, u_grain: P.grain, u_lens: P.lens }, { u_big: big, u_small: small, u_bloom: bb });
    ctx.free(big, small, bright, bb);
  },
});
def('superres', {
  name: { de: 'Super-Resolution / Schärfen', en: 'Super Resolution' }, cat: 'realism',
  params: [R('amount', 'Schärfe', 'Sharpness', 0, 1, 0.6), R('denoise', 'Entrauschen', 'Denoise', 0, 1, 0.3)],
  glsl: `vec4 fx(vec2 uv){ vec2 px = 1.0/u_res; vec4 s = unpm(tex(uv)); vec3 c = s.rgb;
    vec3 acc = vec3(0); float ws = 0.0;
    for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){ vec3 q = unpm(tex(uv+vec2(x,y)*px)).rgb; float w = exp(-dot(q-c,q-c)*60.0) * exp(-float(x*x+y*y)*0.3); acc += q*w; ws += w; }
    vec3 dn = mix(c, acc/ws, u_denoise);
    vec3 n = unpm(tex(uv+vec2(0,px.y))).rgb, so = unpm(tex(uv-vec2(0,px.y))).rgb, e = unpm(tex(uv+vec2(px.x,0))).rgb, w = unpm(tex(uv-vec2(px.x,0))).rgb;
    vec3 mn = min(dn, min(min(n,so),min(e,w))), mx = max(dn, max(max(n,so),max(e,w)));
    vec3 amp = sqrt(clamp(min(mn, 2.0-mx)/max(mx,0.001),0.0,1.0)); vec3 wg = amp * (-1.0/mix(8.0,4.5,u_amount));
    vec3 r = clamp((dn + (n+so+e+w)*wg)/(1.0+4.0*wg),0.0,1.0);
    return pm(vec4(r, s.a)); }`,
});
def('hdr', {
  name: { de: 'HDR-Look', en: 'HDR Look' }, cat: 'realism',
  params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.6), R('radius', 'Radius', 'Radius', 2, 80, 30, 1)],
  passes(ctx, src, dst, P) {
    const b = ctx.temp(); ctx.blur(src, b, P.radius * ctx.scale);
    ctx.runShader('hdr', `${GLSL_HEADER} uniform sampler2D u_b; uniform float u_amount;
      void main(){ vec4 s = unpm(tex(v_uv)); vec3 bl = unpm(texture(u_b, v_uv)).rgb; vec3 c = s.rgb;
        vec3 r = c + (c - bl) * 1.5 * u_amount; float L = luma(r); r = mix(vec3(L), r, 1.0 + 0.3*u_amount);
        r = r / (1.0 + r * 0.15 * u_amount) * (1.0 + 0.15*u_amount); o = pm(vec4(clamp(r,0.0,1.0), s.a)); }`, src, dst, { u_amount: P.amount }, { u_b: b });
    ctx.free(b);
  },
});

// ------------------------------------------------------------------ BLUR
def('gaussian', { name: { de: 'Gaußscher Weichzeichner', en: 'Gaussian Blur' }, cat: 'blur', params: [R('radius', 'Radius', 'Radius', 0, 200, 12, 0.5)],
  passes(ctx, src, dst, P) { ctx.blur(src, dst, P.radius * ctx.scale); } });
def('dirblur', { name: { de: 'Richtungsunschärfe', en: 'Directional Blur' }, cat: 'blur',
  params: [R('length', 'Länge', 'Length', 0, 300, 40, 1), R('angle', 'Winkel', 'Angle', -180, 180, 0, 1)],
  glsl: `vec4 fx(vec2 uv){ float a = radians(u_angle); vec2 d = vec2(cos(a), sin(a)) * u_length * u_scale / u_res; vec4 acc = vec4(0);
    for(int i=0;i<32;i++){ float t = float(i)/31.0 - 0.5; acc += texture(u_tex, uv + d*t); } return acc/32.0; }` });
def('zoomblur', { name: { de: 'Zoom-Unschärfe', en: 'Zoom Blur' }, cat: 'blur',
  params: [R('strength', 'Stärke', 'Strength', 0, 1, 0.25), R('cx', 'Zentrum X', 'Center X', 0, 1, 0.5), R('cy', 'Zentrum Y', 'Center Y', 0, 1, 0.5)],
  glsl: `vec4 fx(vec2 uv){ vec2 c = vec2(u_cx, 1.0-u_cy); vec4 acc = vec4(0); for(int i=0;i<32;i++){ float t = float(i)/31.0; acc += texture(u_tex, c + (uv-c)*(1.0 - u_strength*t*0.5)); } return acc/32.0; }` });
def('spinblur', { name: { de: 'Dreh-Unschärfe', en: 'Spin Blur' }, cat: 'blur',
  params: [R('angle', 'Winkel', 'Angle', 0, 90, 10, 0.5), R('cx', 'Zentrum X', 'Center X', 0, 1, 0.5), R('cy', 'Zentrum Y', 'Center Y', 0, 1, 0.5)],
  glsl: `vec4 fx(vec2 uv){ vec2 c = vec2(u_cx,1.0-u_cy); vec2 asp = vec2(u_res.x/u_res.y,1.0); vec2 p = (uv-c)*asp; vec4 acc=vec4(0);
    for(int i=0;i<32;i++){ float a = radians(u_angle)*(float(i)/31.0-0.5); mat2 m = mat2(cos(a),-sin(a),sin(a),cos(a)); acc += texture(u_tex, c + (m*p)/asp); } return acc/32.0; }` });
def('tiltshift', { name: { de: 'Tilt-Shift', en: 'Tilt Shift' }, cat: 'blur',
  params: [R('radius', 'Unschärfe', 'Blur', 0, 60, 14, 0.5), R('center', 'Fokus Position', 'Focus position', 0, 1, 0.5), R('width', 'Fokusbreite', 'Focus width', 0, 1, 0.2)],
  passes(ctx, src, dst, P) { const b = ctx.temp(); ctx.blur(src, b, P.radius * ctx.scale);
    ctx.runShader('tilt', `${GLSL_HEADER} uniform sampler2D u_b; uniform float u_center, u_width; void main(){ float d = abs((1.0-v_uv.y) - u_center); float m = smoothstep(u_width*0.5, u_width*0.5+0.25, d); o = mix(tex(v_uv), texture(u_b, v_uv), m); }`, src, dst, { u_center: P.center, u_width: P.width }, { u_b: b }); ctx.free(b); } });
def('motionblur', {
  name: { de: 'Motion Blur (Bewegung)', en: 'Motion Blur' }, cat: 'motion', special: 'motionblur',
  params: [R('shutter', 'Verschlusswinkel', 'Shutter angle', 0, 720, 360, 1), R('samples', 'Samples', 'Samples', 2, 32, 12, 1)],
  glsl: `vec4 fx(vec2 uv){ return tex(uv); }`,
});

// ------------------------------------------------------------------ LIGHT
def('glow', { name: { de: 'Glow', en: 'Glow' }, cat: 'light',
  params: [R('threshold', 'Schwelle', 'Threshold', 0, 1, 0.55), R('radius', 'Radius', 'Radius', 1, 150, 30, 0.5), R('intensity', 'Intensität', 'Intensity', 0, 5, 1.2), C('tintC', 'Farbe', 'Tint', '#ffffff')],
  passes(ctx, src, dst, P) {
    const a = ctx.temp(), b = ctx.temp();
    ctx.runShader('glow_th', `${GLSL_HEADER} uniform float u_threshold; void main(){ vec4 c = tex(v_uv); vec3 u = unpm(c).rgb; float L = luma(u); o = vec4(c.rgb * smoothstep(u_threshold, u_threshold + 0.15, L), c.a * smoothstep(u_threshold, u_threshold + 0.15, L)); }`, src, a, { u_threshold: P.threshold });
    ctx.blur(a, b, P.radius * ctx.scale);
    ctx.runShader('glow_add', `${GLSL_HEADER} uniform sampler2D u_g; uniform float u_intensity; uniform vec3 u_tintC; void main(){ vec4 s = tex(v_uv); vec4 g = texture(u_g, v_uv); vec3 c = s.rgb + g.rgb * u_tintC * u_intensity; o = vec4(c, max(s.a, clamp(g.a*u_intensity,0.0,1.0))); }`, src, dst, { u_intensity: P.intensity, u_tintC: P.tintC }, { u_g: b });
    ctx.free(a, b);
  } });
def('neon', { name: { de: 'Neon Glow (Kanten)', en: 'Neon Glow' }, cat: 'light',
  params: [C('colorA', 'Farbe', 'Color', '#00e5ff'), R('radius', 'Radius', 'Radius', 1, 80, 18, 0.5), R('intensity', 'Intensität', 'Intensity', 0, 6, 2.5), R('keep', 'Original behalten', 'Keep original', 0, 1, 0.6)],
  passes(ctx, src, dst, P) {
    const e = ctx.temp(), b = ctx.temp();
    ctx.runShader('neon_edge', `${GLSL_HEADER} uniform vec3 u_colorA; void main(){ vec2 p = 1.0/u_res; float tl=luma(tex(v_uv+p*vec2(-1,1)).rgb), t=luma(tex(v_uv+p*vec2(0,1)).rgb), tr=luma(tex(v_uv+p*vec2(1,1)).rgb), l=luma(tex(v_uv+p*vec2(-1,0)).rgb), r=luma(tex(v_uv+p*vec2(1,0)).rgb), bl=luma(tex(v_uv+p*vec2(-1,-1)).rgb), b=luma(tex(v_uv+p*vec2(0,-1)).rgb), br=luma(tex(v_uv+p*vec2(1,-1)).rgb);
      float gx = -tl-2.0*l-bl+tr+2.0*r+br, gy = -tl-2.0*t-tr+bl+2.0*b+br; float g = clamp(length(vec2(gx,gy))*1.5,0.0,1.0); o = vec4(u_colorA*g, g); }`, src, e, { u_colorA: P.colorA });
    ctx.blur(e, b, P.radius * ctx.scale);
    ctx.runShader('neon_mix', `${GLSL_HEADER} uniform sampler2D u_e; uniform sampler2D u_g; uniform float u_intensity, u_keep; void main(){ vec4 s = tex(v_uv); vec4 e = texture(u_e,v_uv); vec4 g = texture(u_g,v_uv); vec3 c = s.rgb*u_keep + e.rgb + g.rgb*u_intensity; o = vec4(c, max(s.a*u_keep, clamp(e.a+g.a*u_intensity,0.0,1.0))); }`, src, dst, { u_intensity: P.intensity, u_keep: P.keep }, { u_e: e, u_g: b });
    ctx.free(e, b);
  } });
def('lensflare', { name: { de: 'Lens Flare', en: 'Lens Flare' }, cat: 'light',
  params: [R('x', 'Position X', 'Position X', -0.2, 1.2, 0.3), R('y', 'Position Y', 'Position Y', -0.2, 1.2, 0.25), R('intensity', 'Intensität', 'Intensity', 0, 3, 1), C('colorA', 'Farbe', 'Color', '#ffd59a'), R('streak', 'Anamorph-Streifen', 'Anamorphic streak', 0, 2, 0.8)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); vec2 asp = vec2(u_res.x/u_res.y, 1.0); vec2 L = vec2(u_x, 1.0-u_y); vec2 p = (uv - L)*asp;
    float d = length(p); vec3 f = u_colorA * (0.03/(d+0.02)) ;
    f += vec3(0.4,0.6,1.0) * exp(-abs(p.y)*90.0) * exp(-abs(p.x)*1.5) * u_streak;
    vec2 axis = (vec2(0.5) - L); for(int i=1;i<6;i++){ vec2 gp = L + axis*float(i)*0.42; float gd = length((uv-gp)*asp); float r = 0.02+0.03*hash1(float(i));
      f += mix(vec3(0.3,1.0,0.6), vec3(1.0,0.4,0.8), hash1(float(i)*3.1)) * smoothstep(r, r*0.6, gd) * 0.12; }
    float ring = smoothstep(0.012,0.0,abs(d-0.32)) * 0.15; f += vec3(0.6,0.8,1.0)*ring;
    f *= u_intensity; return vec4(s.rgb + f * max(s.a, 0.0), s.a); }` });
def('lightleak', { name: { de: 'Light Leak', en: 'Light Leak' }, cat: 'light',
  params: [R('intensity', 'Intensität', 'Intensity', 0, 2, 0.8), R('speed', 'Tempo', 'Speed', 0, 3, 0.6), C('colorA', 'Farbe A', 'Color A', '#ff5a1f'), C('colorB', 'Farbe B', 'Color B', '#ffd23f'), R('seedV', 'Variante', 'Variant', 0, 50, 3, 1)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); float t = u_lt*u_speed + u_seedV*7.0; float n = fbm(vec2(uv.x*1.5 + t*0.25, uv.y*0.8 - t*0.1) + u_seedV);
    float edge = smoothstep(0.35, 0.0, uv.x + sin(t)*0.15) + smoothstep(0.65, 1.0, uv.y + cos(t*0.7)*0.2);
    vec3 col = mix(u_colorA, u_colorB, n); float m = clamp(n*edge*1.6,0.0,1.0) * u_intensity;
    vec3 r = s.rgb + col*m - s.rgb*col*m*0.3; return vec4(r, max(s.a, 0.0)); }` });
def('godrays', { name: { de: 'Lichtstrahlen (God Rays)', en: 'God Rays' }, cat: 'light',
  params: [R('x', 'Lichtquelle X', 'Source X', 0, 1, 0.5), R('y', 'Lichtquelle Y', 'Source Y', 0, 1, 0.2), R('intensity', 'Intensität', 'Intensity', 0, 3, 0.8), R('decay', 'Länge', 'Length', 0.8, 1, 0.96, 0.001), R('threshold', 'Schwelle', 'Threshold', 0, 1, 0.6)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); vec2 L = vec2(u_x,1.0-u_y); vec2 d = (uv - L) / 48.0; vec2 p = uv; float w = 1.0; vec3 acc = vec3(0);
    for(int i=0;i<48;i++){ p -= d; vec3 q = unpm(texture(u_tex,p)).rgb; acc += q * smoothstep(u_threshold, 1.0, luma(q)) * w; w *= u_decay; }
    return vec4(s.rgb + acc/48.0*u_intensity*3.0, s.a); }` });
def('vignette', { name: { de: 'Vignette', en: 'Vignette' }, cat: 'cinematic',
  params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.45), R('size', 'Größe', 'Size', 0, 1, 0.5), R('soft', 'Weichheit', 'Softness', 0.01, 1, 0.5), C('colorA', 'Farbe', 'Color', '#000000')],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); vec2 d = (uv-0.5)*vec2(u_res.x/u_res.y,1.0); float v = smoothstep(u_size*0.8, u_size*0.8+u_soft, length(d)*1.2);
    return vec4(mix(s.rgb, u_colorA*s.a, v*u_amount), s.a); }` });
def('dropshadow', { name: { de: 'Schlagschatten', en: 'Drop Shadow' }, cat: 'light',
  params: [R('dist', 'Abstand', 'Distance', 0, 200, 20, 1), R('angle', 'Winkel', 'Angle', -180, 180, 135, 1), R('blurR', 'Weichheit', 'Softness', 0, 80, 16, 0.5), R('opacity', 'Deckkraft', 'Opacity', 0, 1, 0.7), C('colorA', 'Farbe', 'Color', '#000000')],
  passes(ctx, src, dst, P) { const b = ctx.temp(); ctx.blur(src, b, P.blurR * ctx.scale); const a = (P.angle * Math.PI) / 180;
    ctx.runShader('dshadow', `${GLSL_HEADER} uniform sampler2D u_b; uniform vec2 u_off; uniform float u_opacity; uniform vec3 u_colorA; void main(){ vec4 s = tex(v_uv); float sh = texture(u_b, v_uv - u_off).a * u_opacity; vec4 shadow = vec4(u_colorA*sh, sh); o = s + shadow*(1.0-s.a); }`,
      src, dst, { u_off: [Math.cos(a) * P.dist * ctx.scale / ctx.w, -Math.sin(a) * P.dist * ctx.scale / ctx.h], u_opacity: P.opacity, u_colorA: P.colorA }, { u_b: b }); ctx.free(b); } });

// ------------------------------------------------------------------ STYLIZE / CINEMATIC
def('grain', { name: { de: 'Filmkorn', en: 'Film Grain' }, cat: 'cinematic', params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.3), R('size', 'Größe', 'Size', 0.5, 4, 1.2)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); float n = hash(floor(uv*u_res/u_size) + fract(u_time*24.0)*91.0) - 0.5; return vec4(s.rgb + n*0.25*u_amount*s.a, s.a); }` });
def('letterbox', { name: { de: 'Cinema-Balken', en: 'Letterbox' }, cat: 'cinematic',
  params: [S('ratio', 'Format', 'Ratio', ['2.39:1', '2.35:1', '2:1', '1.85:1', '4:3', 'Eigene'], 0), R('custom', 'Eigene Höhe', 'Custom size', 0, 0.45, 0.12), C('colorA', 'Farbe', 'Color', '#000000')],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); int r = int(u_ratio+0.5); float ar = r==0?2.39:r==1?2.35:r==2?2.0:r==3?1.85:r==4?1.3333:0.0; float bar = ar > 0.0 ? max(0.0, (1.0 - (u_res.x/ar)/u_res.y)*0.5) : u_custom;
    if (r==4) { float w = max(0.0,(1.0-(u_res.y*ar)/u_res.x)*0.5); if (uv.x < w || uv.x > 1.0-w) return vec4(u_colorA,1.0); return s; }
    if (uv.y < bar || uv.y > 1.0 - bar) return vec4(u_colorA, 1.0); return s; }` });
def('sharpen', { name: { de: 'Schärfen', en: 'Sharpen' }, cat: 'stylize', params: [R('amount', 'Stärke', 'Amount', 0, 3, 0.8)],
  glsl: `vec4 fx(vec2 uv){ vec2 p = 1.0/u_res; vec4 c = tex(uv); vec4 b = (tex(uv+vec2(p.x,0))+tex(uv-vec2(p.x,0))+tex(uv+vec2(0,p.y))+tex(uv-vec2(0,p.y)))*0.25; return clamp(c + (c-b)*u_amount*2.0, 0.0, 1.0); }` });
def('pixelate', { name: { de: 'Verpixeln', en: 'Pixelate' }, cat: 'stylize', params: [R('size', 'Pixelgröße', 'Pixel size', 1, 120, 16, 1)],
  glsl: `vec4 fx(vec2 uv){ vec2 b = u_size*u_scale/u_res; return tex((floor(uv/b)+0.5)*b); }` });
def('edge', { name: { de: 'Kanten / Skizze', en: 'Edges / Sketch' }, cat: 'stylize', params: [R('mix', 'Stärke', 'Amount', 0, 1, 1), B('inv', 'Invertiert (Skizze)', 'Inverted (sketch)', true)],
  glsl: `vec4 fx(vec2 uv){ vec2 p = 1.0/u_res; float gx = luma(tex(uv+vec2(p.x,0)).rgb)-luma(tex(uv-vec2(p.x,0)).rgb); float gy = luma(tex(uv+vec2(0,p.y)).rgb)-luma(tex(uv-vec2(0,p.y)).rgb);
    float g = clamp(length(vec2(gx,gy))*4.0,0.0,1.0); if(u_inv>0.5) g = 1.0-g; vec4 s = tex(uv); return vec4(mix(s.rgb, vec3(g)*s.a, u_mix), s.a); }` });
def('scanlines', { name: { de: 'Scanlines / CRT', en: 'Scanlines / CRT' }, cat: 'stylize', params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.4), R('density', 'Dichte', 'Density', 50, 1200, 400, 1), R('curve', 'Wölbung', 'Curvature', 0, 0.5, 0.08)],
  glsl: `vec4 fx(vec2 uv){ vec2 c = uv-0.5; c *= 1.0 + dot(c,c)*u_curve*2.0; vec2 q = c+0.5; vec4 s = texc(q); float l = 0.5+0.5*sin(q.y*u_density*PI); return vec4(s.rgb*(1.0-u_amount*l), s.a); }` });
def('vhs', { name: { de: 'VHS', en: 'VHS' }, cat: 'glitch', params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.6)],
  glsl: `vec4 fx(vec2 uv){ float t = u_time; float j = (noise(vec2(uv.y*80.0, t*20.0))-0.5)*0.006*u_amount; float tr = step(0.97, noise(vec2(t*3.0, floor(uv.y*20.0))))*0.03*u_amount;
    vec2 q = vec2(uv.x + j + tr, uv.y); float r = tex(q + vec2(0.004*u_amount,0)).r, g = tex(q).g, b = tex(q - vec2(0.004*u_amount,0)).b; vec3 c = vec3(r,g,b);
    c += (hash(uv*u_res+t)-0.5)*0.12*u_amount; c *= 0.9 + 0.1*sin(uv.y*900.0); float L = luma(c); c = mix(c, vec3(L), 0.25*u_amount); return vec4(c, tex(q).a); }` });
def('mirror', { name: { de: 'Spiegeln', en: 'Mirror' }, cat: 'distort', params: [S('mode', 'Modus', 'Mode', ['Links→Rechts', 'Rechts→Links', 'Oben→Unten', 'Unten→Oben', 'Vierfach'], 0)],
  glsl: `vec4 fx(vec2 uv){ int m = int(u_mode+0.5); vec2 q = uv; if(m==0) q.x = q.x>0.5?1.0-q.x:q.x; else if(m==1) q.x = q.x<0.5?1.0-q.x:q.x; else if(m==2) q.y = q.y<0.5?1.0-q.y:q.y; else if(m==3) q.y = q.y>0.5?1.0-q.y:q.y; else q = abs(fract(uv*2.0)-0.0); if(m==4) q = vec2(abs(1.0-2.0*abs(uv.x-0.5)), abs(1.0-2.0*abs(uv.y-0.5))); return tex(q); }` });
def('kaleido', { name: { de: 'Kaleidoskop', en: 'Kaleidoscope' }, cat: 'distort', params: [R('segments', 'Segmente', 'Segments', 2, 16, 6, 1), R('rot', 'Rotation', 'Rotation', -180, 180, 0, 1)],
  glsl: `vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x/u_res.y,1.0); vec2 p = (uv-0.5)*asp; float a = atan(p.y,p.x) + radians(u_rot); float r = length(p); float s = 2.0*PI/u_segments; a = mod(a, s); a = abs(a - s*0.5); return tex(vec2(cos(a),sin(a))*r/asp + 0.5); }` });
def('fisheye', { name: { de: 'Fischauge / Linse', en: 'Fisheye / Lens' }, cat: 'distort', params: [R('amount', 'Stärke', 'Amount', -1, 1, 0.4)],
  glsl: `vec4 fx(vec2 uv){ vec2 p = uv-0.5; float r = length(p); vec2 q = p*(1.0 + u_amount*r*r*2.0); return texc(q/(1.0+u_amount*0.25)+0.5); }` });
def('wave', { name: { de: 'Welle / Warp', en: 'Wave Warp' }, cat: 'distort', params: [R('amp', 'Amplitude', 'Amplitude', 0, 0.1, 0.015, 0.001), R('freq', 'Frequenz', 'Frequency', 0, 60, 12), R('speed', 'Tempo', 'Speed', 0, 10, 2)],
  glsl: `vec4 fx(vec2 uv){ return tex(uv + vec2(sin(uv.y*u_freq + u_lt*u_speed), cos(uv.x*u_freq*0.7 + u_lt*u_speed))*u_amp); }` });
def('swirl', { name: { de: 'Strudel', en: 'Swirl' }, cat: 'distort', params: [R('angle', 'Winkel', 'Angle', -720, 720, 180, 1), R('radius', 'Radius', 'Radius', 0.05, 1, 0.4)],
  glsl: `vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x/u_res.y,1.0); vec2 p = (uv-0.5)*asp; float r = length(p); float k = max(0.0, 1.0 - r/u_radius); float a = radians(u_angle)*k*k; mat2 m = mat2(cos(a),-sin(a),sin(a),cos(a)); return texc((m*p)/asp+0.5); }` });

// ------------------------------------------------------------------ GLITCH
def('rgbsplit', { name: { de: 'RGB Split', en: 'RGB Split' }, cat: 'glitch', params: [R('amount', 'Abstand', 'Amount', 0, 80, 12, 0.5), R('angle', 'Winkel', 'Angle', -180, 180, 0, 1)],
  glsl: `vec4 fx(vec2 uv){ float a = radians(u_angle); vec2 d = vec2(cos(a),sin(a))*u_amount*u_scale/u_res; vec4 r = tex(uv+d), g = tex(uv), b = tex(uv-d); return vec4(r.r, g.g, b.b, max(max(r.a,g.a),b.a)); }` });
def('chromatic', { name: { de: 'Chromatische Aberration', en: 'Chromatic Aberration' }, cat: 'glitch', params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.3)],
  glsl: `vec4 fx(vec2 uv){ vec2 d = (uv-0.5)*u_amount*0.04; vec4 g = tex(uv); return vec4(tex(uv+d).r, g.g, tex(uv-d).b, g.a); }` });
def('glitch', { name: { de: 'Digital Glitch', en: 'Digital Glitch' }, cat: 'glitch',
  params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.5), R('blocks', 'Blockgröße', 'Block size', 2, 60, 18, 1), R('speed', 'Tempo', 'Speed', 0, 30, 10), R('rgb', 'Farbversatz', 'Color shift', 0, 1, 0.5)],
  glsl: `vec4 fx(vec2 uv){ float t = floor(u_time*u_speed); vec2 b = floor(uv*vec2(u_blocks*0.5, u_blocks)); float r = hash(b + t);
    float on = step(1.0 - u_amount*0.35, r); float line = step(1.0-u_amount*0.15, hash(vec2(floor(uv.y*u_blocks*3.0), t)));
    vec2 q = uv + vec2((hash(b*1.7+t)-0.5)*0.15*on + (hash(vec2(t,uv.y))-0.5)*0.05*line, 0.0);
    float sh = 0.012*u_rgb*(on+line); vec4 g = tex(q); vec3 c = vec3(tex(q+vec2(sh,0)).r, g.g, tex(q-vec2(sh,0)).b);
    if (on > 0.5 && hash(b+t*3.0) > 0.85) c = 1.0 - c; return vec4(c, g.a); }` });
def('datamosh', { name: { de: 'Pixel-Sortierung', en: 'Pixel Sort' }, cat: 'glitch', params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.5), R('threshold', 'Schwelle', 'Threshold', 0, 1, 0.5)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); if (luma(s.rgb) < u_threshold) return s; vec4 acc = s; float n = 0.0; for(int i=1;i<24;i++){ vec4 q = tex(uv - vec2(0.0, float(i)*0.006*u_amount)); if (luma(q.rgb) < u_threshold) break; acc += q; n += 1.0; } return acc/(n+1.0); }` });

// ------------------------------------------------------------------ MOTION (transform modifiers)
const noise1 = (x) => { const i = Math.floor(x), f = x - i; const h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }; const u = f * f * (3 - 2 * f); return h(i) * (1 - u) + h(i + 1) * u; };
def('shake', { name: { de: 'Kamera-Wackeln', en: 'Camera Shake' }, cat: 'motion',
  params: [R('amp', 'Stärke (px)', 'Amplitude (px)', 0, 200, 25, 1), R('freq', 'Frequenz', 'Frequency', 0.5, 40, 8), R('rot', 'Rotation', 'Rotation', 0, 20, 2), R('zoom', 'Zoom-Ausgleich', 'Zoom compensation', 0, 0.5, 0.06), R('seedV', 'Variante', 'Variant', 0, 100, 1, 1)],
  glsl: `vec4 fx(vec2 uv){ return tex(uv); }`,
  mod(P, lt) { const t = lt * P.freq + P.seedV * 13.7; return { dx: (noise1(t) - 0.5) * 2 * P.amp, dy: (noise1(t + 71.3) - 0.5) * 2 * P.amp, rot: (noise1(t + 33.1) - 0.5) * 2 * P.rot, scale: 1 + P.zoom }; } });
def('zoompulse', { name: { de: 'Zoom Puls / Beat', en: 'Zoom Pulse' }, cat: 'motion',
  params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.12), R('bpm', 'BPM', 'BPM', 30, 240, 120, 1), R('decay', 'Abklingen', 'Decay', 1, 20, 6)],
  glsl: `vec4 fx(vec2 uv){ return tex(uv); }`,
  mod(P, lt) { const beat = 60 / P.bpm; const ph = (lt % beat) / beat; return { scale: 1 + P.amount * Math.exp(-ph * P.decay) }; } });
def('zoomio', { name: { de: 'Zoom In / Out', en: 'Zoom In / Out' }, cat: 'motion',
  params: [R('from', 'Start-Zoom', 'Start zoom', 0.2, 4, 1), R('to', 'End-Zoom', 'End zoom', 0.2, 4, 1.25), S('ease', 'Kurve', 'Curve', ['Linear', 'Ease In', 'Ease Out', 'Smooth'], 3)],
  glsl: `vec4 fx(vec2 uv){ return tex(uv); }`,
  mod(P, lt, info) { let u = Math.min(1, Math.max(0, lt / Math.max(0.01, info.dur))); u = [u, u * u * u, 1 - Math.pow(1 - u, 3), u * u * (3 - 2 * u)][P.ease | 0]; return { scale: P.from + (P.to - P.from) * u }; } });
def('kenburns', { name: { de: 'Ken Burns (Schwenk)', en: 'Ken Burns' }, cat: 'motion',
  params: [R('zoom', 'Zoom', 'Zoom', 0, 1, 0.2), R('panX', 'Schwenk X', 'Pan X', -400, 400, 80, 1), R('panY', 'Schwenk Y', 'Pan Y', -400, 400, 0, 1)],
  glsl: `vec4 fx(vec2 uv){ return tex(uv); }`,
  mod(P, lt, info) { const u = Math.min(1, Math.max(0, lt / Math.max(0.01, info.dur))); const e = u * u * (3 - 2 * u); return { scale: 1 + P.zoom * e, dx: -P.panX / 2 + P.panX * e, dy: -P.panY / 2 + P.panY * e }; } });
def('wiggle', { name: { de: 'Schwingen (Wiggle)', en: 'Wiggle' }, cat: 'motion',
  params: [R('rot', 'Rotation (°)', 'Rotation (°)', 0, 45, 6), R('freq', 'Frequenz', 'Frequency', 0.1, 10, 1.5)],
  glsl: `vec4 fx(vec2 uv){ return tex(uv); }`,
  mod(P, lt) { return { rot: Math.sin(lt * P.freq * Math.PI * 2) * P.rot }; } });
def('strobe', { name: { de: 'Stroboskop / Flash', en: 'Strobe / Flash' }, cat: 'light',
  params: [R('rate', 'Blitze pro Sek.', 'Flashes / sec', 0.5, 30, 4), R('amount', 'Stärke', 'Amount', 0, 1, 0.8), C('colorA', 'Farbe', 'Color', '#ffffff')],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); float ph = fract(u_lt*u_rate); float f = exp(-ph*8.0)*u_amount; return vec4(mix(s.rgb, u_colorA*max(s.a,1.0), f), max(s.a, f)); }` });

// ------------------------------------------------------------------ KEY / MASK
def('chromakey', { name: { de: 'Green Screen / Chroma Key', en: 'Chroma Key' }, cat: 'key',
  params: [C('key', 'Key-Farbe', 'Key color', '#00ff00'), R('similarity', 'Toleranz', 'Similarity', 0, 1, 0.35), R('smooth', 'Weichheit', 'Smoothness', 0, 0.5, 0.08), R('spill', 'Spill entfernen', 'Spill removal', 0, 1, 0.6)],
  glsl: `vec2 ycc(vec3 c){ return vec2(-0.1687*c.r - 0.3313*c.g + 0.5*c.b, 0.5*c.r - 0.4187*c.g - 0.0813*c.b); }
    vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); float d = distance(ycc(s.rgb), ycc(u_key)); float a = smoothstep(u_similarity*0.5, u_similarity*0.5 + u_smooth, d);
    vec3 c = s.rgb; float kmax = max(u_key.r, max(u_key.g, u_key.b)); if (u_key.g >= kmax) c.g = mix(c.g, min(c.g, max(c.r, c.b)), u_spill); else if (u_key.b >= kmax) c.b = mix(c.b, min(c.b, max(c.r, c.g)), u_spill); else c.r = mix(c.r, min(c.r, max(c.g,c.b)), u_spill);
    return pm(vec4(c, s.a * a)); }` });
def('lumakey', { name: { de: 'Luma Key', en: 'Luma Key' }, cat: 'key', params: [R('threshold', 'Schwelle', 'Threshold', 0, 1, 0.1), R('smooth', 'Weichheit', 'Smoothness', 0, 0.5, 0.05), B('invert', 'Hell entfernen', 'Key brights')],
  glsl: `vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); float L = luma(s.rgb); float a = smoothstep(u_threshold, u_threshold+u_smooth, L); if(u_invert>0.5) a = 1.0-smoothstep(1.0-u_threshold-u_smooth, 1.0-u_threshold, L); return pm(vec4(s.rgb, s.a*a)); }` });
def('mask', { name: { de: 'Maske (Form)', en: 'Mask (Shape)' }, cat: 'key',
  params: [S('shape', 'Form', 'Shape', ['Rechteck', 'Ellipse', 'Linear (Verlauf)', 'Herz', 'Stern'], 1), R('x', 'Mitte X', 'Center X', 0, 1, 0.5), R('y', 'Mitte Y', 'Center Y', 0, 1, 0.5), R('w', 'Breite', 'Width', 0, 2, 0.6), R('h', 'Höhe', 'Height', 0, 2, 0.6),
    R('rot', 'Rotation', 'Rotation', -180, 180, 0, 1), R('feather', 'Weiche Kante', 'Feather', 0, 0.5, 0.03), R('round', 'Rundung', 'Roundness', 0, 0.5, 0), B('invert', 'Invertieren', 'Invert')],
  glsl: `float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
    float sdStar(vec2 p, float r){ float a = atan(p.x,p.y); float s = 2.0*PI/5.0; float k = cos(floor(0.5+a/s)*s-a)*length(p); float m = 0.5+0.5*cos(5.0*a); return length(p) - r*(0.55+0.45*m); }
    vec4 fx(vec2 uv){ vec4 s = tex(uv); vec2 asp = vec2(u_res.x/u_res.y,1.0); vec2 p = (uv - vec2(u_x, 1.0-u_y))*asp; float a = radians(u_rot); p = mat2(cos(a),sin(a),-sin(a),cos(a))*p;
    int sh = int(u_shape+0.5); float d; vec2 hs = vec2(u_w*asp.x, u_h)*0.5;
    if(sh==0) d = sdBox(p, hs, min(u_round, min(hs.x,hs.y)));
    else if(sh==1) d = (length(p/max(hs,vec2(0.001))) - 1.0) * min(hs.x,hs.y);
    else if(sh==2) d = p.y;
    else if(sh==3) { vec2 q = p/max(hs.x,0.001); q.y = -q.y + 0.25; q.x = abs(q.x); float hh = q.y - sqrt(q.x)*0.7; d = (length(vec2(q.x, hh)) - 0.75) * hs.x; }
    else d = sdStar(p, min(hs.x,hs.y));
    float m = 1.0 - smoothstep(-u_feather, u_feather + 0.0001, d); if(u_invert>0.5) m = 1.0-m; return s*m; }` });

// ------------------------------------------------------------------ PARTICLES
def('particles', { name: { de: 'Partikel', en: 'Particles' }, cat: 'particles',
  params: [S('type', 'Art', 'Type', ['Schnee', 'Staub', 'Funken', 'Bokeh', 'Regen', 'Glut'], 0), R('amount', 'Menge', 'Amount', 0, 1, 0.5), R('size', 'Größe', 'Size', 0.2, 4, 1), R('speed', 'Tempo', 'Speed', 0, 4, 1), C('colorA', 'Farbe', 'Color', '#ffffff'), R('opacityP', 'Deckkraft', 'Opacity', 0, 1, 0.9)],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); int ty = int(u_type+0.5); vec2 asp = vec2(u_res.x/u_res.y, 1.0); vec3 acc = vec3(0); float aa = 0.0;
    for (int L = 0; L < 4; L++) { float fl = float(L); float scale = 6.0 + fl*5.0; vec2 dir = ty==2||ty==5 ? vec2(0.05, 0.6) : ty==4 ? vec2(0.08, -2.5) : vec2(0.04, -0.25);
      vec2 p = uv*asp*scale + dir*u_time*u_speed*(1.0+fl*0.3)*scale*0.12 + fl*13.0; vec2 cell = floor(p); vec2 f = fract(p) - 0.5;
      float h = hash(cell + fl*7.1); if (h > u_amount) continue; vec2 off = vec2(hash(cell*1.3)-0.5, hash(cell*2.7)-0.5)*0.6; f -= off;
      float r = (0.03 + 0.05*hash(cell*3.1)) * u_size * (ty==3 ? 4.0 : 1.0);
      float d = ty==4 ? length(f*vec2(6.0,0.4)) : length(f);
      float m = ty==3 ? smoothstep(r, r*0.75, d)*0.35 : smoothstep(r, 0.0, d);
      float tw = ty==1||ty==5 ? 0.5+0.5*sin(u_time*3.0+h*50.0) : 1.0;
      vec3 col = ty==2 ? mix(vec3(1.0,0.6,0.1), u_colorA, 0.3) : ty==5 ? mix(vec3(1.0,0.3,0.05), u_colorA, 0.2) : u_colorA;
      acc += col*m*tw; aa = max(aa, m*tw); }
    aa *= u_opacityP; return vec4(s.rgb*(1.0-aa) + acc*u_opacityP, max(s.a, aa)); }` });
def('stars', { name: { de: 'Sterne / Funkeln', en: 'Sparkles' }, cat: 'particles', params: [R('amount', 'Menge', 'Amount', 0, 1, 0.3), R('size', 'Größe', 'Size', 0.2, 3, 1), C('colorA', 'Farbe', 'Color', '#fff6c8')],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); vec2 asp = vec2(u_res.x/u_res.y,1.0); vec2 p = uv*asp*14.0; vec2 c = floor(p); vec2 f = fract(p)-0.5; float h = hash(c); if(h>u_amount) return s;
    f -= (vec2(hash(c*1.7),hash(c*2.3))-0.5)*0.6; float tw = pow(0.5+0.5*sin(u_time*4.0+h*90.0), 4.0); float st = (0.003/(abs(f.x*f.y)+0.0015)) * smoothstep(0.25*u_size,0.0,length(f)) * tw * 0.15;
    return vec4(s.rgb + u_colorA*st, max(s.a, clamp(st,0.0,1.0))); }` });

// ------------------------------------------------------------------ ADJUST helpers
def('opacityfx', { name: { de: 'Deckkraft', en: 'Opacity' }, cat: 'stylize', params: [R('opacity', 'Deckkraft', 'Opacity', 0, 1, 1)],
  glsl: `vec4 fx(vec2 uv){ return tex(uv)*u_opacity; }` });
def('blackout', { name: { de: 'Ab-/Aufblenden (Farbe)', en: 'Fade to Color' }, cat: 'cinematic', params: [R('amount', 'Stärke', 'Amount', 0, 1, 0.5), C('colorA', 'Farbe', 'Color', '#000000')],
  glsl: `vec4 fx(vec2 uv){ vec4 s = tex(uv); return vec4(mix(s.rgb, u_colorA*s.a, u_amount), s.a); }` });
