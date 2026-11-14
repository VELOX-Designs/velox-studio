// Third transition pack (~250): generated families. No asin(), no unguarded divisions (AMD-safe).
import { defineTransition as def } from './transitions.js';

const EASE = 'float e(float x){ return x<0.5?4.0*x*x*x:1.0-pow(-2.0*x+2.0,3.0)/2.0; }';
const ROT = 'mat2 R(float a){ return mat2(cos(a),-sin(a),sin(a),cos(a)); }';
const A8 = [0, 45, 90, 135, 180, 225, 270, 315];
const AR = { 0: '→', 45: '↗', 90: '↑', 135: '↖', 180: '←', 225: '↙', 270: '↓', 315: '↘' };
const n = (de, en) => ({ de, en });
const v2 = (a) => `vec2(${Math.cos((a * Math.PI) / 180).toFixed(4)}, ${(-Math.sin((a * Math.PI) / 180)).toFixed(4)})`; // screen dir (y up in uv)
const inside = (q) => `(${q}.x>=0.0&&${q}.x<=1.0&&${q}.y>=0.0&&${q}.y<=1.0)`;

// ---------------------------------------------------------------- 8-direction motion families (10 × 8)
for (const a of A8) {
  const d = `vec2(${Math.cos((a * Math.PI) / 180).toFixed(4)}, ${Math.sin((a * Math.PI) / 180).toFixed(4)})`;
  def(`slideblur_${a}`, { name: n(`Slide + Blur ${AR[a]}`, `Slide blur ${AR[a]}`), cat: 'motion', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 d = ${d}; float k = e(p); vec2 qa = uv - d*k, qb = uv + d*(1.0-k); vec2 bl = d*sin(p*PI)*0.25*u_int; return ${inside('qb')} ? blurDir(u_b, qb, bl) : blurDir(u_a, qa, bl); }` });
  def(`zoomslide_${a}`, { name: n(`Zoom-Slide ${AR[a]}`, `Zoom slide ${AR[a]}`), cat: 'zoom', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 d = ${d}; float k = e(p); float z = 1.0 + sin(p*PI)*0.35*u_int; vec2 q = (uv-0.5)*z+0.5; vec2 qa = q - d*k, qb = q + d*(1.0-k); return ${inside('qb')} ? Bt(qb) : A(qa); }` });
  def(`smear_${a}`, { name: n(`Verschmieren ${AR[a]}`, `Smear ${AR[a]}`), cat: 'motion', glsl: `vec4 tr(vec2 uv, float p){ vec2 d = ${d}; float s = sin(p*PI); vec4 a = blurDir(u_a, uv - d*p*0.4, d*s*0.6*u_int), b = blurDir(u_b, uv + d*(1.0-p)*0.4, d*s*0.6*u_int); return mix(a, b, smoothstep(0.35,0.65,p)); }` });
  def(`roll_${a}`, { name: n(`Durchrollen ${AR[a]}`, `Roll through ${AR[a]}`), cat: 'slide', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 d = ${d}; float k = e(p); vec2 q = fract(uv - d*k*2.0); vec2 bl = d*sin(p*PI)*0.15*u_int; return k < 0.5 ? blurDir(u_a, q, bl) : blurDir(u_b, q, bl); }` });
  def(`lightwipe_${a}`, { name: n(`Lichtkante ${AR[a]}`, `Light edge wipe ${AR[a]}`), cat: 'light', glsl: `vec4 tr(vec2 uv, float p){ vec2 d = ${d}; float x = dot(uv-0.5, d)*0.7071+0.5; float edge = p*1.3-0.15; float m = smoothstep(edge-0.02, edge, x); vec4 c = mix(Bt(uv), A(uv), m); float glow = exp(-pow((x-edge)*30.0, 2.0))*u_int; return c + vec4(vec3(glow*1.2), 0.0); }` });
  def(`pixwipe_${a}`, { name: n(`Pixel-Wipe ${AR[a]}`, `Pixel wipe ${AR[a]}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 d = ${d}; vec2 g = floor(uv*vec2(48.0*asp().x,48.0))/vec2(48.0*asp().x,48.0); float x = dot(g-0.5, d)*0.7071+0.5 + (hash(g*31.0)-0.5)*0.15; return x < p*1.3-0.15 ? Bt(uv) : A(uv); }` });
  def(`inkdir_${a}`, { name: n(`Tinte ${AR[a]}`, `Ink ${AR[a]}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 d = ${d}; float x = dot(uv-0.5, d)*0.7071+0.5 + (fbm(uv*5.0)-0.5)*0.35; return x < p*1.5-0.25 ? Bt(uv) : A(uv); }` });
  def(`glitchslide_${a}`, { name: n(`Glitch-Slide ${AR[a]}`, `Glitch slide ${AR[a]}`), cat: 'glitch', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 d = ${d}; float k = e(p); float row = floor(uv.y*24.0); float jit = (hash(vec2(row, floor(p*20.0)))-0.5)*0.15*sin(p*PI)*u_int; vec2 qb = uv + d*(1.0-k) + vec2(jit,0.0), qa = uv - d*k + vec2(jit,0.0); float sh = 0.012*sin(p*PI)*u_int; return ${inside('qb')} ? vec4(Bm(qb+vec2(sh,0)).r, Bm(qb).g, Bm(qb-vec2(sh,0)).b, 1.0) : vec4(Am(qa+vec2(sh,0)).r, Am(qa).g, Am(qa-vec2(sh,0)).b, 1.0); }` });
  def(`shutter_${a}`, { name: n(`Lamellen ${AR[a]}`, `Shutter ${AR[a]}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 d = ${d}; vec2 pd = vec2(-d.y, d.x); float band = fract(dot(uv, pd)*10.0); float x = dot(uv-0.5, d)*0.7071+0.5; return band < clamp(p*2.0 - x, 0.0, 1.0) ? Bt(uv) : A(uv); }` });
  def(`pushzoom_${a}`, { name: n(`Push mit Zoom ${AR[a]}`, `Push zoom ${AR[a]}`), cat: 'slide', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 d = ${d}; float k = e(p); vec2 qa = (uv - 0.5)/(1.0 - 0.3*k*u_int) + 0.5 - d*k; vec2 qb = (uv-0.5)/(0.7 + 0.3*k) + 0.5 + d*(1.0-k); return ${inside('qb')} ? Bt(qb) : A(qa); }` });
}

// ---------------------------------------------------------------- iris from corners / edges (8)
for (const [k, de, en, c] of [['tl', 'oben links', 'top left', '0.0,1.0'], ['tr', 'oben rechts', 'top right', '1.0,1.0'], ['bl', 'unten links', 'bottom left', '0.0,0.0'], ['br', 'unten rechts', 'bottom right', '1.0,0.0'], ['t', 'oben', 'top', '0.5,1.0'], ['b', 'unten', 'bottom', '0.5,0.0'], ['l', 'links', 'left', '0.0,0.5'], ['r', 'rechts', 'right', '1.0,0.5']]) {
  def(`cornerIris_${k}`, { name: n(`Kreis aus ${de}`, `Circle from ${en}`), cat: 'mask', glsl: `${EASE} vec4 tr(vec2 uv, float p){ float d = length((uv - vec2(${c}))*asp()); float r = e(p)*2.1; return mix(A(uv), Bt(uv), 1.0 - smoothstep(r-0.02*u_int-0.001, r, d)); }` });
}

// ---------------------------------------------------------------- more shapes (10 × 2)
const SH = {
  drop: ['Tropfen', 'Drop', 'length(q - vec2(0.0, -0.1)) - (0.15 - q.y*0.35)*0.0 + max(q.y,0.0)*0.6'],
  moon: ['Mond', 'Moon', 'max(length(q), -(length(q - vec2(0.25,0.1)) - 0.0)) * 1.2'],
  arrow: ['Pfeil', 'Arrow', 'max(abs(q.y)*1.6 + q.x*0.9, -q.x - 0.4)*1.3'],
  octagon: ['Achteck', 'Octagon', 'max(max(abs(q.x),abs(q.y)), (abs(q.x)+abs(q.y))*0.7071)*1.25'],
  diamond2: ['Raute weich', 'Soft diamond', '(abs(q.x)+abs(q.y))*1.1'],
  cloud: ['Wolke', 'Cloud', 'length(q)*(0.8+0.2*sin(atan(q.y,q.x)*7.0))*1.3'],
  burst: ['Explosion', 'Burst', 'length(q)*(0.6+0.4*abs(sin(atan(q.y,q.x)*8.0)))*1.4'],
  gear: ['Zahnrad', 'Gear', 'length(q)*(0.85+0.15*step(0.0, sin(atan(q.y,q.x)*12.0)))*1.25'],
  pill: ['Kapsel', 'Pill', 'length(max(abs(q)-vec2(0.3,0.0),0.0))*1.4'],
  plus: ['Plus', 'Plus', 'min(max(abs(q.x)*4.0,abs(q.y)), max(abs(q.x),abs(q.y)*4.0))*0.8'],
};
for (const [k, [de, en, sdf]] of Object.entries(SH)) {
  def(`shape2_in_${k}`, { name: n(`${de} öffnen`, `${en} open`), cat: 'mask', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 q = (uv-0.5)*asp(); float d = ${sdf}; float r = e(p)*1.8; return mix(A(uv), Bt(uv), 1.0 - smoothstep(r-0.015-0.001, r, d)); }` });
  def(`shape2_out_${k}`, { name: n(`${de} schließen`, `${en} close`), cat: 'mask', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 q = (uv-0.5)*asp(); float d = ${sdf}; float r = (1.0-e(p))*1.8; return mix(Bt(uv), A(uv), 1.0 - smoothstep(r-0.015-0.001, r, d)); }` });
}

// ---------------------------------------------------------------- colour flashes, dips, light leaks (10 + 10 + 8)
const COLS = [['pink', 'Pink', '1.0,0.3,0.7'], ['cyan', 'Cyan', '0.2,0.9,1.0'], ['orange', 'Orange', '1.0,0.55,0.1'], ['green', 'Grün', '0.3,1.0,0.4'], ['yellow', 'Gelb', '1.0,0.92,0.3'], ['teal', 'Petrol', '0.1,0.6,0.6'], ['magenta', 'Magenta', '0.9,0.1,0.9'], ['lime', 'Limette', '0.7,1.0,0.1'], ['ice', 'Eisblau', '0.75,0.9,1.0'], ['crimson', 'Karmin', '0.75,0.05,0.2']];
for (const [k, de, c] of COLS) {
  def(`flashc_${k}`, { name: n(`Flash ${de}`, `Flash ${k}`), cat: 'light', glsl: `vec4 tr(vec2 uv, float p){ float f = exp(-pow((p-0.5)*6.0,2.0))*u_int; vec4 c = p<0.5 ? A(uv) : Bt(uv); return mix(c, vec4(${c},1.0), clamp(f,0.0,1.0)); }` });
  def(`dipc_${k}`, { name: n(`Blende über ${de}`, `Dip to ${k}`), cat: 'basic', glsl: `vec4 tr(vec2 uv, float p){ vec4 c = vec4(${c},1.0); return p<0.5 ? mix(A(uv), c, p*2.0) : mix(c, Bt(uv), (p-0.5)*2.0); }` });
}
const LEAKS = [['1.0,0.35,0.1', '1.0,0.8,0.4'], ['1.0,0.2,0.4', '1.0,0.6,0.8'], ['0.3,0.5,1.0', '0.7,0.9,1.0'], ['0.6,0.2,1.0', '1.0,0.5,0.9'], ['1.0,0.6,0.0', '1.0,1.0,0.6'], ['0.1,0.9,0.6', '0.8,1.0,0.7'], ['1.0,0.1,0.1', '1.0,0.6,0.2'], ['0.9,0.9,1.0', '1.0,0.95,0.8']];
LEAKS.forEach(([c1, c2], i) => def(`leak_${i + 1}`, { name: n(`Light Leak ${i + 1}`, `Light leak ${i + 1}`), cat: 'light',
  glsl: `vec4 tr(vec2 uv, float p){ float w = sin(p*PI); float n2 = fbm(uv*vec2(2.0,1.2) + vec2(p*2.5 + ${i}.0*3.1, ${i}.0)); vec3 col = mix(vec3(${c1}), vec3(${c2}), n2); float m = smoothstep(0.25, 0.85, n2 + w*0.9 - 0.35 + (${i % 2 ? '1.0-uv.x' : 'uv.x'})*0.35) * w * u_int; vec4 c = mix(A(uv), Bt(uv), smoothstep(0.3,0.7,p)); return vec4(c.rgb + col*m*1.6 - c.rgb*m*0.35, 1.0); }` }));

// ---------------------------------------------------------------- zoom family (8 + 4 + 3)
for (const deg of [15, 45, 90, 180]) for (const dir of ['in', 'out']) {
  def(`zoomturn_${dir}_${deg}`, { name: n(`Zoom ${dir === 'in' ? 'rein' : 'raus'} + ${deg}°`, `Zoom ${dir} + ${deg}°`), cat: 'zoom', glsl: `${EASE} ${ROT} vec4 tr(vec2 uv, float p){ float k = e(p); float s = ${dir === 'in' ? 'p<0.5 ? 1.0+k*2.5*u_int : 1.0/(1.0+(1.0-k)*2.5*u_int)' : 'p<0.5 ? 1.0/(1.0+k*1.5*u_int) : 1.0+(1.0-k)*1.5*u_int'}; float a = (k-0.5)*${((deg * Math.PI) / 180).toFixed(4)}*2.0; vec2 q = R(a)*((uv-0.5)*asp())/s/asp()+0.5; return p<0.5 ? blurZoom(u_a, q, sin(p*PI)*0.2) : blurZoom(u_b, q, sin(p*PI)*0.2); }` });
}
for (const [k, de, c] of [['tl', 'oben links', '0.2,0.8'], ['tr', 'oben rechts', '0.8,0.8'], ['bl', 'unten links', '0.2,0.2'], ['br', 'unten rechts', '0.8,0.2']]) {
  def(`zoomto_${k}`, { name: n(`Zoom in Ecke ${de}`, `Zoom to corner ${k}`), cat: 'zoom', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 c = vec2(${c}); float k = e(p); if (p < 0.5) { float s = 1.0 + k*3.0*u_int; return Am(c + (uv-c)/s); } float s = 1.0 + (1.0-k)*3.0*u_int; return Bm(c + (uv-c)/s); }` });
}
for (const [s, de] of [[0.15, 'leicht'], [0.35, 'mittel'], [0.6, 'stark']]) {
  def(`zoomblur_${String(s).replace('.', '')}`, { name: n(`Zoom-Blur ${de}`, `Zoom blur ${de}`), cat: 'zoom', glsl: `vec4 tr(vec2 uv, float p){ float w = sin(p*PI)*${s}*u_int; return mix(blurZoom(u_a, uv, w), blurZoom(u_b, uv, w), smoothstep(0.4,0.6,p)); }` });
}

// ---------------------------------------------------------------- glitch family (9 + 4 + 3 + 2)
for (const [bs, bn] of [[8, 'grob'], [20, 'mittel'], [48, 'fein']]) for (const [sp, sn] of [[10, 'langsam'], [24, 'schnell'], [48, 'hektisch']]) {
  def(`glitchx_${bs}_${sp}`, { name: n(`Glitch ${bn} ${sn}`, `Glitch ${bs}/${sp}`), cat: 'glitch', glsl: `vec4 tr(vec2 uv, float p){ float w = sin(p*PI)*u_int; vec2 b = floor(uv*vec2(${bs}.0*0.5, ${bs}.0)); float t = floor(p*${sp}.0); float r = hash(b+t); vec2 q = uv + vec2((r-0.5)*0.25*w*step(0.6,r), 0.0); float sh = 0.03*w; vec4 a = vec4(Am(q+vec2(sh,0)).r, Am(q).g, Am(q-vec2(sh,0)).b, 1.0), c = vec4(Bm(q+vec2(sh,0)).r, Bm(q).g, Bm(q-vec2(sh,0)).b, 1.0); return hash(vec2(t, b.y)) < p ? c : a; }` });
}
for (const ang of [0, 45, 90, 135]) {
  def(`rgbangle_${ang}`, { name: n(`RGB-Split ${ang}°`, `RGB split ${ang}°`), cat: 'glitch', glsl: `vec4 tr(vec2 uv, float p){ vec2 d = vec2(${Math.cos((ang * Math.PI) / 180).toFixed(3)}, ${Math.sin((ang * Math.PI) / 180).toFixed(3)})*sin(p*PI)*0.07*u_int; vec4 a = vec4(Am(uv+d).r, Am(uv).g, Am(uv-d).b, 1.0), b = vec4(Bm(uv+d).r, Bm(uv).g, Bm(uv-d).b, 1.0); return mix(a, b, smoothstep(0.4,0.6,p)); }` });
}
for (const [k, l] of [[1, 60], [2, 160], [3, 320]]) {
  def(`scanglitch_${k}`, { name: n(`Zeilen-Glitch ${k}`, `Scanline glitch ${k}`), cat: 'glitch', glsl: `vec4 tr(vec2 uv, float p){ float w = sin(p*PI)*u_int; float l = floor(uv.y*${l}.0); float o = (hash(vec2(l, floor(p*30.0)))-0.5)*0.3*w*step(0.55, hash(vec2(l*0.7, floor(p*12.0)))); vec2 q = vec2(uv.x + o, uv.y); return hash(vec2(l, 3.0)) < p ? Bm(q) : Am(q); }` });
}
def('vhs_rewind', { name: n('VHS-Rückspul-Übergang', 'VHS rewind'), cat: 'glitch', glsl: `vec4 tr(vec2 uv, float p){ float w = sin(p*PI)*u_int; float band = step(0.9, fract(uv.y*3.0 + p*8.0)); vec2 q = uv + vec2(band*0.1*w, 0.0); vec4 c = p<0.5 ? Am(q) : Bm(q); c.rgb = mix(c.rgb, vec3(luma(c.rgb)), 0.4*w) + band*0.35*w + (hash(uv*500.0+p)-0.5)*0.2*w; return c; }` });
def('tv_off', { name: n('TV ausschalten', 'TV switch off'), cat: 'glitch', glsl: `vec4 tr(vec2 uv, float p){ if (p < 0.5) { float k = p*2.0; float sy = max(0.003, 1.0-k*1.6); float sx = k > 0.6 ? max(0.003, 1.0-(k-0.6)*2.5) : 1.0; vec2 q = (uv-0.5)/vec2(sx,sy)+0.5; vec4 c = A(q); return ${inside('q')} ? c + vec4(vec3(k*0.8),0.0) : vec4(0,0,0,1); } float k = (p-0.5)*2.0; return mix(vec4(1.0), Bt(uv), smoothstep(0.0,0.5,k)); }` });

// ---------------------------------------------------------------- grid / block patterns (12 + 3 + 4)
for (const sz of [4, 8, 16, 32]) {
  def(`blockdiag_${sz}`, { name: n(`Blöcke diagonal ${sz}`, `Blocks diagonal ${sz}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 c = floor(uv*vec2(${sz}.0*asp().x, ${sz}.0)); vec2 gs = vec2(${sz}.0*asp().x, ${sz}.0); float o = (c.x/gs.x + c.y/gs.y)*0.5; vec2 f = fract(uv*gs)-0.5; float k = clamp(p*1.6 - o*0.6, 0.0, 1.0); return max(abs(f.x),abs(f.y)) < k*0.5 ? Bt(uv) : A(uv); }` });
  def(`blockspiral_${sz}`, { name: n(`Blöcke Spirale ${sz}`, `Blocks spiral ${sz}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 gs = vec2(${sz}.0*asp().x, ${sz}.0); vec2 c = (floor(uv*gs)+0.5)/gs - 0.5; float o = fract(atan(c.y,c.x)/(2.0*PI)+0.5)*0.5 + length(c)*0.6; return o < p*1.15 ? Bt(uv) : A(uv); }` });
  def(`blockrandom_${sz}`, { name: n(`Blöcke zufällig wachsend ${sz}`, `Blocks random grow ${sz}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 gs = vec2(${sz}.0*asp().x, ${sz}.0); vec2 c = floor(uv*gs), f = fract(uv*gs)-0.5; float k = clamp(p*1.7 - hash(c)*0.7, 0.0, 1.0); return length(f) < k*0.72 ? Bt(uv) : A(uv); }` });
}
for (const s of [6, 12, 20]) def(`hexsize_${s}`, { name: n(`Waben ${s}`, `Honeycomb ${s}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 q = uv*vec2(asp().x,1.0)*${s}.0; vec2 r = vec2(1.0,1.732); vec2 h = r*0.5; vec2 a = mod(q,r)-h, b = mod(q-h,r)-h; vec2 gv = dot(a,a)<dot(b,b)?a:b; vec2 id = q-gv; float k = clamp(p*1.6 - (id.x/(${s}.0*asp().x))*0.6, 0.0, 1.0); return max(abs(gv.x)*0.866+abs(gv.y)*0.5, abs(gv.y)) < k*0.55 ? Bt(uv) : A(uv); }` });
for (const a of [0, 90, 180, 270]) def(`dotsweep_${a}`, { name: n(`Punkt-Raster ${AR[a]}`, `Dot sweep ${AR[a]}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 d = vec2(${Math.cos((a * Math.PI) / 180).toFixed(3)}, ${Math.sin((a * Math.PI) / 180).toFixed(3)}); vec2 g = uv*vec2(18.0*asp().x,18.0); vec2 f = fract(g)-0.5; float x = dot((floor(g)+0.5)/vec2(18.0*asp().x,18.0)-0.5, d)+0.5; float k = clamp(p*1.6 - x*0.6, 0.0, 1.0); return length(f) < k*0.75 ? Bt(uv) : A(uv); }` });

// ---------------------------------------------------------------- stripes (12)
for (const cnt of [4, 8, 16, 32]) for (const [o, on] of [['h', 'horizontal'], ['v', 'vertikal'], ['d', 'diagonal']]) {
  const coord = o === 'h' ? 'uv.y' : o === 'v' ? 'uv.x' : '(uv.x+uv.y)*0.5';
  const along = o === 'h' ? 'uv.x' : o === 'v' ? 'uv.y' : '(uv.x-uv.y)*0.5+0.5';
  def(`stripes_${o}${cnt}`, { name: n(`Streifen ${on} ${cnt}`, `Stripes ${o} ${cnt}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ float i = floor(${coord}*${cnt}.0); float dir = mod(i,2.0)==0.0 ? ${along} : 1.0-${along}; return dir < p*1.2 - hash1(i)*0.2 ? Bt(uv) : A(uv); }` });
}

// ---------------------------------------------------------------- radial (8 + 4 + 3)
for (const start of [0, 90, 180, 270]) for (const cw of [1, -1]) {
  def(`clockx_${start}_${cw > 0 ? 'cw' : 'ccw'}`, { name: n(`Uhr ab ${start}° ${cw > 0 ? '↻' : '↺'}`, `Clock from ${start}° ${cw > 0 ? 'CW' : 'CCW'}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 q = uv-0.5; float a = fract((${cw}.0*atan(q.x, q.y))/(2.0*PI) + ${(start / 360).toFixed(3)} + 1.0); return a < p ? Bt(uv) : A(uv); }` });
}
for (const rays of [4, 8, 16, 24]) def(`rays_${rays}`, { name: n(`Strahlen ${rays}`, `Rays ${rays}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 q = uv-0.5; float a = fract((atan(q.y,q.x)/(2.0*PI)+0.5)*${rays}.0); return a < p ? Bt(uv) : A(uv); }` });
for (const turns of [1, 2, 4]) def(`spiralx_${turns}`, { name: n(`Spirale ${turns}×`, `Spiral ${turns}×`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 q = (uv-0.5)*asp(); float a = atan(q.y,q.x)/(2.0*PI)+0.5; float r = length(q); float v = fract(a + r*${turns * 2}.0); return v*0.45 + r*0.65 < p*1.15 ? Bt(uv) : A(uv); }` });

// ---------------------------------------------------------------- 3D family (12)
for (const [k, de, ax] of [['l', 'links', 'x'], ['r', 'rechts', 'x'], ['u', 'oben', 'y'], ['d', 'unten', 'y']]) {
  const sgn = k === 'l' || k === 'd' ? '-1.0' : '1.0';
  def(`flip3d_${k}`, { name: n(`3D-Flip nach ${de}`, `3D flip ${k}`), cat: '3d', glsl: `${EASE} vec4 tr(vec2 uv, float p){ float a = e(p)*PI; float c = cos(a); float w = max(abs(c), 0.02); vec2 q = uv-0.5; ${ax === 'x' ? `q.x /= w; q.y *= 1.0 + ${sgn}*sin(a)*q.x*0.35*u_int;` : `q.y /= w; q.x *= 1.0 + ${sgn}*sin(a)*q.y*0.35*u_int;`} q += 0.5; if (!${inside('q')}) return vec4(0,0,0,1); return c > 0.0 ? A(q) : Bt(${ax === 'x' ? 'vec2(1.0-q.x,q.y)' : 'vec2(q.x,1.0-q.y)'}); }` });
  def(`door3d_${k}`, { name: n(`3D-Tür von ${de}`, `3D door ${k}`), cat: '3d', glsl: `${EASE} vec4 tr(vec2 uv, float p){ float a = e(p)*PI*0.5; float w = max(cos(a), 0.001); vec2 q = uv; ${k === 'r' ? 'q.x = 1.0-q.x;' : k === 'u' ? 'q = vec2(q.y, q.x);' : k === 'd' ? 'q = vec2(1.0-q.y, q.x);' : ''} if (q.x < w) { float u = q.x/w; vec2 s = vec2(u, (q.y-0.5)*(1.0+sin(a)*u*0.5*u_int)+0.5); ${k === 'r' ? 's.x = 1.0-s.x;' : k === 'u' ? 's = vec2(s.y, s.x);' : k === 'd' ? 's = vec2(s.y, 1.0-s.x);' : ''} if (${inside('s')}) return A(s)*(1.0-sin(a)*0.45); } return Bt(uv); }` });
  def(`fold3d_${k}`, { name: n(`Falten nach ${de}`, `Fold ${k}`), cat: '3d', glsl: `${EASE} vec4 tr(vec2 uv, float p){ float k2 = e(p); float w = max(1.0-k2, 0.001); vec2 q = uv; ${k === 'r' ? 'q.x = 1.0-q.x;' : k === 'u' ? 'q = vec2(1.0-q.y, q.x);' : k === 'd' ? 'q = vec2(q.y, q.x);' : ''} if (q.x < w) { vec2 s = vec2(q.x/w, q.y); ${k === 'r' ? 's.x = 1.0-s.x;' : k === 'u' ? 's = vec2(s.y, 1.0-s.x);' : k === 'd' ? 's = vec2(s.y, s.x);' : ''} return A(s)*(0.75 + 0.25*cos(q.x/w*PI*6.0*k2)); } return Bt(uv); }` });
}

// ---------------------------------------------------------------- film / burn (8)
for (const [k, de, c] of [['amber', 'Bernstein', '1.0,0.5,0.15'], ['red', 'Rot', '1.0,0.15,0.1'], ['blue', 'Blau', '0.2,0.5,1.0'], ['white', 'Weiß', '1.0,0.95,0.9']]) {
  def(`burn_${k}`, { name: n(`Film-Brand ${de}`, `Film burn ${k}`), cat: 'light', glsl: `vec4 tr(vec2 uv, float p){ float n2 = fbm(uv*3.5 + p*2.5); float w = sin(p*PI); vec3 b = vec3(${c})*smoothstep(0.3,1.0,n2+w-0.4)*2.0*u_int; vec4 c = mix(A(uv), Bt(uv), smoothstep(0.35,0.65,p)); return vec4(c.rgb + b*w, 1.0); }` });
}
for (const a of [0, 90, 180, 270]) def(`filmstrip_${a}`, { name: n(`Filmstreifen ${AR[a]}`, `Film strip ${AR[a]}`), cat: 'cinematic', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 d = vec2(${Math.cos((a * Math.PI) / 180).toFixed(3)}, ${Math.sin((a * Math.PI) / 180).toFixed(3)}); float k = e(p); vec2 q = uv - d*k; vec2 qb = uv + d*(1.0-k); float gap = 0.04; vec4 c = ${inside('qb')} ? Bt(qb) : A(q); vec2 qq = ${inside('qb')} ? qb : q; float edge = step(min(min(qq.x,1.0-qq.x),min(qq.y,1.0-qq.y)), gap*0.5); return mix(c, vec4(0.04,0.04,0.04,1.0), edge*sin(p*PI)); }` });

// ---------------------------------------------------------------- distortion (3 + 2 + 2 + 4 + 3)
for (const [k, s] of [[1, 0.01], [2, 0.025], [3, 0.05]]) def(`ripplex_${k}`, { name: n(`Wellen ${['leicht', 'mittel', 'stark'][k - 1]}`, `Ripple ${k}`), cat: 'cinematic', glsl: `vec4 tr(vec2 uv, float p){ vec2 q = uv-0.5; float r = length(q*asp()); float w = sin(p*PI)*u_int; vec2 d = q/max(r,0.001)*sin(r*45.0 - p*35.0)*${s}*w; return mix(Am(uv+d), Bm(uv+d), smoothstep(0.35,0.65,p)); }` });
for (const dir of [1, -1]) def(`swirlx_${dir > 0 ? 'cw' : 'ccw'}`, { name: n(`Strudel ${dir > 0 ? '↻' : '↺'} stark`, `Swirl ${dir > 0 ? 'CW' : 'CCW'} strong`), cat: 'cinematic', glsl: `${ROT} vec4 tr(vec2 uv, float p){ float w = sin(p*PI)*u_int; vec2 q = (uv-0.5)*asp(); float r = length(q); vec2 s = R(${dir}.0*w*10.0*max(0.0,1.0-r*1.3))*q/asp()+0.5; return mix(Am(s), Bm(s), smoothstep(0.4,0.6,p)); }` });
for (const dir of [1, -1]) def(`twistx_${dir > 0 ? 'a' : 'b'}`, { name: n(`Verdrehen ${dir > 0 ? 'A' : 'B'}`, `Twist ${dir > 0 ? 'A' : 'B'}`), cat: 'cinematic', glsl: `${ROT} vec4 tr(vec2 uv, float p){ float w = sin(p*PI)*u_int; vec2 q = (uv-0.5)*asp(); vec2 s = R(${dir}.0*w*3.0*(uv.y-0.5))*q/asp()+0.5; return mix(Am(s), Bm(s), smoothstep(0.4,0.6,p)); }` });
for (const seg of [4, 6, 8, 12]) def(`kaleidox_${seg}`, { name: n(`Kaleidoskop ${seg}`, `Kaleidoscope ${seg}`), cat: 'cinematic', glsl: `vec4 tr(vec2 uv, float p){ float w = sin(p*PI); vec2 q = (uv-0.5)*asp(); float a = atan(q.y,q.x)+p*3.0; float r = length(q); float s = 2.0*PI/${seg}.0; a = abs(mod(a,s)-s*0.5); vec2 k = vec2(cos(a),sin(a))*r/asp()+0.5; vec2 f = mix(uv, k, smoothstep(0.0,0.5,w)*u_int); return mix(Am(f), Bm(f), smoothstep(0.4,0.6,p)); }` });
for (const [k, mx] of [[1, 30], [2, 80], [3, 160]]) def(`mosaicx_${k}`, { name: n(`Mosaik ${['fein', 'mittel', 'grob'][k - 1]}`, `Mosaic ${k}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ float w = sin(p*PI); float s = max(1.0, ${mx}.0*w*u_int); vec2 px = s/u_res; vec2 q = w > 0.02 ? (floor(uv/px)+0.5)*px : uv; return p<0.5 ? Am(q) : Bm(q); }` });
