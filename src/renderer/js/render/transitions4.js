// Fourth transition pack (~670): big generated families. AMD-safe: no asin(), no divisions by values that can be 0,
// fixed loop counts only.
import { defineTransition as def, TRANSITION_CATS } from './transitions.js';

Object.assign(TRANSITION_CATS, { shape: { de: 'Formen', en: 'Shapes' }, color: { de: 'Farb-Blitze', en: 'Color flashes' }, grid: { de: 'Raster / Kacheln', en: 'Grid / tiles' }, distort: { de: 'Verzerrung', en: 'Distort' } });
const n = (de, en) => ({ de, en });
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(4)));
const EASE = 'float ez(float x){ return x<0.5?4.0*x*x*x:1.0-pow(-2.0*x+2.0,3.0)/2.0; }';
const INS = 'bool ins(vec2 q){ return q.x>=0.0&&q.x<=1.0&&q.y>=0.0&&q.y<=1.0; }';
const ROT = 'mat2 rot2(float a){ return mat2(cos(a),-sin(a),sin(a),cos(a)); }';

// ---------------------------------------------------------------- 1) shape reveals: 14 shapes × 9 origins × in/out (252)
const SHAPES = {
  circle: ['Kreis', 'Circle', 'length(q)'],
  square: ['Quadrat', 'Square', 'max(abs(q.x),abs(q.y))'],
  diamond: ['Raute', 'Diamond', '(abs(q.x)+abs(q.y))*0.75'],
  hexagon: ['Sechseck', 'Hexagon', 'max(abs(q.x)*0.866+abs(q.y)*0.5, abs(q.y))'],
  octa: ['Achteck', 'Octagon', 'max(max(abs(q.x),abs(q.y)), (abs(q.x)+abs(q.y))*0.7071)'],
  star: ['Stern', 'Star', 'length(q)*(0.65+0.35*cos(atan(q.y,q.x)*5.0))'],
  star8: ['Stern 8', 'Star 8', 'length(q)*(0.7+0.3*cos(atan(q.y,q.x)*8.0))'],
  heart: ['Herz', 'Heart', 'length(vec2(q.x*1.1, q.y*1.25 - sqrt(abs(q.x))*0.55))'],
  cross: ['Kreuz', 'Cross', 'min(max(abs(q.x)*3.0,abs(q.y)), max(abs(q.x),abs(q.y)*3.0))*0.6'],
  triangle: ['Dreieck', 'Triangle', 'max(abs(q.x)*0.866+q.y*0.5, -q.y)*1.2'],
  flower: ['Blume', 'Flower', 'length(q)*(0.75+0.25*cos(atan(q.y,q.x)*6.0))'],
  gear: ['Zahnrad', 'Gear', 'length(q)*(0.88+0.12*sign(cos(atan(q.y,q.x)*12.0)))'],
  ellipseH: ['Oval quer', 'Wide oval', 'length(q*vec2(0.6,1.4))'],
  blob: ['Blob', 'Blob', 'length(q)*(0.8+0.4*fbm(normalize(q+0.0001)*2.0+3.0))'],
};
const ORIG = { c: ['Mitte', 'center', '0.5,0.5'], tl: ['oben links', 'top left', '0.0,1.0'], tr: ['oben rechts', 'top right', '1.0,1.0'], bl: ['unten links', 'bottom left', '0.0,0.0'], br: ['unten rechts', 'bottom right', '1.0,0.0'], t: ['oben', 'top', '0.5,1.0'], b: ['unten', 'bottom', '0.5,0.0'], l: ['links', 'left', '0.0,0.5'], r: ['rechts', 'right', '1.0,0.5'] };
for (const [sk, [sde, sen, sdf]] of Object.entries(SHAPES)) for (const [ok, [ode, oen, oc]] of Object.entries(ORIG)) {
  const reach = ok === 'c' ? '1.15' : '2.2';
  def(`shp_${sk}_${ok}`, { name: n(`${sde} auf (${ode})`, `${sen} open (${oen})`), cat: 'shape', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 q = (uv - vec2(${oc}))*asp(); float d = ${sdf}; float r = ez(p)*${reach}; float w = 0.012 + 0.03*u_int; return mix(A(uv), Bt(uv), 1.0 - smoothstep(r - w, r, d)); }` });
  def(`shpx_${sk}_${ok}`, { name: n(`${sde} zu (${ode})`, `${sen} close (${oen})`), cat: 'shape', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 q = (uv - vec2(${oc}))*asp(); float d = ${sdf}; float r = (1.0 - ez(p))*${reach}; float w = 0.012 + 0.03*u_int; return mix(Bt(uv), A(uv), 1.0 - smoothstep(r - w, r, d)); }` });
}

// ---------------------------------------------------------------- 2) patterned wipes: 11 edge patterns × 8 directions (88)
const A8 = [0, 45, 90, 135, 180, 225, 270, 315];
const AR = { 0: '→', 45: '↗', 90: '↑', 135: '↖', 180: '←', 225: '↙', 270: '↓', 315: '↘' };
const EDGES = {
  soft: ['Weich', 'Soft', '0.0', 0.12], hard: ['Hart', 'Hard', '0.0', 0.002], zigzag: ['Zickzack', 'Zigzag', 'abs(fract(t*12.0)-0.5)*0.12', 0.004],
  wave: ['Welle', 'Wave', 'sin(t*25.0)*0.04', 0.01], saw: ['Säge', 'Saw', 'fract(t*10.0)*0.08', 0.003], brick: ['Ziegel', 'Brick', 'step(0.5, fract(t*8.0))*0.08', 0.003],
  noise: ['Rauschen', 'Noise', '(fbm(vec2(t*8.0, 2.0))-0.5)*0.25', 0.01], comb: ['Kamm', 'Comb', 'step(0.5, fract(t*20.0))*0.15', 0.002], scallop: ['Bögen', 'Scallop', 'sqrt(max(0.0, 0.25 - pow(fract(t*8.0)-0.5, 2.0)))*0.2', 0.004],
  ragged: ['Gerissen', 'Ragged', '(hash(vec2(floor(t*60.0), 3.0))-0.5)*0.08', 0.003], drip: ['Tropfend', 'Drip', 'pow(hash(vec2(floor(t*30.0), 7.0)), 3.0)*0.3', 0.004],
};
for (const [ek, [ede, een, off, soft]] of Object.entries(EDGES)) for (const a of A8) {
  const d = `vec2(${f(Math.cos((a * Math.PI) / 180))}, ${f(Math.sin((a * Math.PI) / 180))})`;
  def(`pw_${ek}_${a}`, { name: n(`Wipe ${ede} ${AR[a]}`, `Wipe ${een} ${AR[a]}`), cat: 'mask', glsl: `${EASE} vec4 tr(vec2 uv, float p){ vec2 d = ${d}; vec2 pd = vec2(-d.y, d.x); float x = dot(uv-0.5, d)*0.7071+0.5; float t = dot(uv, pd); x += ${off}; float e = ez(p)*1.5 - 0.25; float m = smoothstep(e - ${f(soft)}, e + ${f(soft)}, x); float glow = (1.0 - smoothstep(0.0, 0.03, abs(x - e)))*0.35*u_int; return mix(Bt(uv), A(uv), m) + vec4(vec3(glow), 0.0); }` });
}

// ---------------------------------------------------------------- 3) grid / tile reveals: 4 sizes × 5 orders × 2 cell shapes (40)
const ORD = { rnd: ['zufällig', 'random', 'hash(c)'], row: ['zeilenweise', 'row by row', '(c.y*G.x + c.x)/(G.x*G.y)'], diag: ['diagonal', 'diagonal', '(c.x + c.y)/(G.x + G.y)'], center: ['von innen', 'from center', 'length((c+0.5)/G - 0.5)*1.4'], check: ['Schachbrett', 'checker', 'mod(c.x + c.y, 2.0)*0.5 + hash(c)*0.45'] };
for (const g of [4, 8, 12, 20]) for (const [ok, [ode, oen, ord]] of Object.entries(ORD)) for (const sh of ['sq', 'dot']) {
  const cell = sh === 'sq' ? 'max(abs(fp.x-0.5), abs(fp.y-0.5))*2.0' : 'length(fp-0.5)*1.42';
  def(`grid_${g}_${ok}_${sh}`, { name: n(`${sh === 'sq' ? 'Kacheln' : 'Punkte'} ${g} ${ode}`, `${sh === 'sq' ? 'Tiles' : 'Dots'} ${g} ${oen}`), cat: 'grid', glsl: `vec4 tr(vec2 uv, float p){ vec2 G = vec2(floor(${f(g)}*asp().x + 0.5), ${f(g)}); vec2 c = floor(uv*G); vec2 fp = fract(uv*G); float o = clamp(${ord}, 0.0, 1.0); float lp = clamp((p*1.6 - o*0.6), 0.0, 1.0); float s = ${cell}; return s < lp*1.02 ? Bt(uv) : A(uv); }` });
}

// ---------------------------------------------------------------- 4) colour flashes / dips: 16 colours × 4 styles (64)
const COLS = { weiss: ['Weiß', 'White', '1.0,1.0,1.0'], schwarz: ['Schwarz', 'Black', '0.0,0.0,0.0'], rot: ['Rot', 'Red', '1.0,0.1,0.15'], blau: ['Blau', 'Blue', '0.1,0.35,1.0'], cyan: ['Cyan', 'Cyan', '0.1,0.9,1.0'], gelb: ['Gelb', 'Yellow', '1.0,0.85,0.1'], orange: ['Orange', 'Orange', '1.0,0.5,0.1'], pink: ['Pink', 'Pink', '1.0,0.3,0.7'], lila: ['Lila', 'Purple', '0.6,0.25,1.0'], gruen: ['Grün', 'Green', '0.2,1.0,0.4'], gold: ['Gold', 'Gold', '1.0,0.75,0.3'], tuerkis: ['Türkis', 'Teal', '0.1,0.78,0.83'], magenta: ['Magenta', 'Magenta', '1.0,0.0,0.85'], eis: ['Eisblau', 'Ice', '0.75,0.9,1.0'], blut: ['Blutrot', 'Blood', '0.55,0.0,0.05'], neon: ['Neongrün', 'Neon', '0.6,1.0,0.0'] };
for (const [ck, [cde, cen, c]] of Object.entries(COLS)) {
  def(`cdip_${ck}`, { name: n(`Blende ${cde}`, `Dip ${cen}`), cat: 'color', glsl: `vec4 tr(vec2 uv, float p){ vec4 C = vec4(${c},1.0); return p<0.5 ? mix(A(uv), C, p*2.0) : mix(C, Bt(uv), (p-0.5)*2.0); }` });
  def(`cflash_${ck}`, { name: n(`Blitz ${cde}`, `Flash ${cen}`), cat: 'color', glsl: `vec4 tr(vec2 uv, float p){ vec4 C = vec4(${c},1.0); float k = exp(-pow((p-0.5)*7.0, 2.0)); vec4 base = p<0.5 ? A(uv) : Bt(uv); return mix(base, C, k*min(1.0,u_int)); }` });
  def(`cglow_${ck}`, { name: n(`Leuchten ${cde}`, `Glow ${cen}`), cat: 'color', glsl: `vec4 tr(vec2 uv, float p){ vec3 C = vec3(${c}); float k = sin(p*PI); vec4 base = mix(A(uv), Bt(uv), smoothstep(0.35, 0.65, p)); float l = luma(base.rgb); return vec4(base.rgb + C*k*(0.4+l)*1.2*u_int, 1.0); }` });
  def(`cradial_${ck}`, { name: n(`Radial-Blitz ${cde}`, `Radial flash ${cen}`), cat: 'color', glsl: `vec4 tr(vec2 uv, float p){ vec3 C = vec3(${c}); float d = length((uv-0.5)*asp()); float r = p*1.6; float ring = exp(-pow((d - r)*9.0, 2.0)); vec4 base = d < r ? Bt(uv) : A(uv); return vec4(mix(base.rgb, C, ring*u_int), 1.0); }` });
}

// ---------------------------------------------------------------- 5) zoom + rotation: 6 angles × in/out × soft/hard (24)
for (const ang of [0, 45, 90, 180, 360, -90]) for (const io of ['in', 'out']) for (const bl of [0, 1]) {
  const s = io === 'in' ? 'mix(1.0, 3.0, k)' : 'mix(1.0, 0.25, k)';
  def(`zr_${io}_${ang < 0 ? 'm' + -ang : ang}_${bl}`, { name: n(`Zoom ${io === 'in' ? 'rein' : 'raus'} ${ang ? ang + '°' : ''}${bl ? ' weich' : ''}`, `Zoom ${io} ${ang ? ang + '°' : ''}${bl ? ' soft' : ''}`), cat: 'zoom',
    glsl: `${EASE} ${ROT} vec4 tr(vec2 uv, float p){ float k = ez(p); float a = radians(${f(ang)})*k; vec2 c = (uv-0.5)*asp(); float sa = ${io === 'in' ? 'mix(1.0, 3.0, k)' : 'mix(1.0, 0.3, k)'}; float sb = ${io === 'in' ? 'mix(0.35, 1.0, k)' : 'mix(3.0, 1.0, k)'}; vec2 qa = (rot2(a)*c)/sa/asp()+0.5; vec2 qb = (rot2(a - radians(${f(ang)}))*c)/sb/asp()+0.5; float bl = ${bl ? '0.25*sin(p*PI)*u_int' : '0.0'}; vec4 ca = bl > 0.001 ? blurZoom(u_a, qa, bl) : Am(qa); vec4 cb = bl > 0.001 ? blurZoom(u_b, qb, bl) : Bm(qb); return mix(ca, cb, smoothstep(0.4, 0.6, p)); }` });
}

// ---------------------------------------------------------------- 6) slides with special easing: 4 dirs × 4 easings × 3 modes (48)
const DIRS4 = { l: ['←', 'vec2(-1.0,0.0)'], r: ['→', 'vec2(1.0,0.0)'], u: ['↑', 'vec2(0.0,1.0)'], d: ['↓', 'vec2(0.0,-1.0)'] };
const EZS = {
  bounce: ['Bounce', 'float E(float x){ float n1=7.5625, d1=2.75; if(x<1.0/d1) return n1*x*x; if(x<2.0/d1){ x-=1.5/d1; return n1*x*x+0.75; } if(x<2.5/d1){ x-=2.25/d1; return n1*x*x+0.9375; } x-=2.625/d1; return n1*x*x+0.984375; }'],
  elastic: ['Elastisch', 'float E(float x){ if(x<=0.0) return 0.0; if(x>=1.0) return 1.0; return pow(2.0,-10.0*x)*sin((x*10.0-0.75)*2.0944)+1.0; }'],
  back: ['Überschwung', 'float E(float x){ float c1=1.70158, c3=c1+1.0; return 1.0+c3*pow(x-1.0,3.0)+c1*pow(x-1.0,2.0); }'],
  expo: ['Expo', 'float E(float x){ return x>=1.0?1.0:1.0-pow(2.0,-10.0*x); }'],
};
for (const [dk, [da, dv]] of Object.entries(DIRS4)) for (const [ek, [ename, efn]] of Object.entries(EZS)) {
  def(`bpush_${ek}_${dk}`, { name: n(`Push ${ename} ${da}`, `Push ${ename} ${da}`), cat: 'slide', glsl: `${INS} ${efn} vec4 tr(vec2 uv, float p){ vec2 d = ${dv}; float k = E(p); vec2 qa = uv - d*k; return ins(qa) ? A(qa) : Bt(uv + d*(1.0-k)); }` });
  def(`bover_${ek}_${dk}`, { name: n(`Rein ${ename} ${da}`, `Slide in ${ename} ${da}`), cat: 'slide', glsl: `${INS} ${efn} vec4 tr(vec2 uv, float p){ vec2 d = ${dv}; float k = E(p); vec2 qb = uv + d*(1.0-k); return ins(qb) ? Bt(qb) : A(uv); }` });
  def(`bout_${ek}_${dk}`, { name: n(`Raus ${ename} ${da}`, `Slide out ${ename} ${da}`), cat: 'slide', glsl: `${INS} ${efn} vec4 tr(vec2 uv, float p){ vec2 d = ${dv}; float k = E(p); vec2 qa = uv - d*k; return ins(qa) ? A(qa) : Bt(uv); }` });
}

// ---------------------------------------------------------------- 7) glitch variants: 4 block sizes × 3 styles × 2 (24)
for (const bs of [6, 14, 30, 60]) for (const [gk, gde, gen] of [['rgb', 'RGB', 'RGB'], ['mono', 'Mono', 'Mono'], ['neon', 'Neon', 'Neon']]) for (const amt of [1, 2]) {
  def(`gx_${gk}_${bs}_${amt}`, { name: n(`Glitch ${gde} ${bs}${amt > 1 ? ' stark' : ''}`, `Glitch ${gen} ${bs}${amt > 1 ? ' strong' : ''}`), cat: 'glitch', glsl: `vec4 tr(vec2 uv, float p){ float s = sin(p*PI)*u_int*${f(amt)}; float row = floor(uv.y*${f(bs)}); float t = floor(p*24.0); float j = (hash(vec2(row, t)) - 0.5)*0.25*s*step(0.55, hash(vec2(row*1.7, t))); vec2 q = vec2(uv.x + j, uv.y); vec4 a = p < 0.5 ? Am(q) : Bm(q);
    ${gk === 'rgb' ? 'vec4 r1 = p<0.5?Am(q+vec2(0.02*s,0.0)):Bm(q+vec2(0.02*s,0.0)); vec4 b1 = p<0.5?Am(q-vec2(0.02*s,0.0)):Bm(q-vec2(0.02*s,0.0)); return vec4(r1.r, a.g, b1.b, 1.0);' : gk === 'mono' ? 'float l = luma(a.rgb); return vec4(mix(a.rgb, vec3(step(0.5, l)), s*0.6), 1.0);' : 'return vec4(a.rgb + vec3(0.0, 1.0, 0.8)*s*0.4*step(0.6, hash(vec2(row, t+3.0))), 1.0);'} }` });
}

// ---------------------------------------------------------------- 8) directional blur 8 × 2 strengths + spin blurs (22)
for (const a of A8) for (const st of [1, 2]) {
  const d = `vec2(${f(Math.cos((a * Math.PI) / 180))}, ${f(Math.sin((a * Math.PI) / 180))})`;
  def(`dblur_${a}_${st}`, { name: n(`Bewegungsunschärfe ${AR[a]}${st > 1 ? ' stark' : ''}`, `Motion blur ${AR[a]}${st > 1 ? ' strong' : ''}`), cat: 'motion', glsl: `vec4 tr(vec2 uv, float p){ vec2 d = ${d}*sin(p*PI)*${f(0.25 * st)}*u_int; vec4 a = blurDir(u_a, uv, d), b = blurDir(u_b, uv, d); return mix(a, b, smoothstep(0.35, 0.65, p)); }` });
}
for (const sp of [0.5, 1, 2]) for (const dir of [1, -1]) {
  def(`spinblur_${sp}_${dir > 0 ? 'cw' : 'ccw'}`, { name: n(`Dreh-Unschärfe ${sp}× ${dir > 0 ? '↻' : '↺'}`, `Spin blur ${sp}× ${dir > 0 ? '↻' : '↺'}`), cat: 'motion', glsl: `${ROT} vec4 tr(vec2 uv, float p){ vec4 acc = vec4(0.0); float s = sin(p*PI)*${f(0.6 * sp)}*u_int*${f(dir)}; vec2 c = (uv-0.5)*asp(); for(int i=0;i<12;i++){ float k = float(i)/11.0 - 0.5; vec2 q = rot2(s*k + ${f(dir)}*p*${f(sp)}*PI*0.0)*c/asp()+0.5; acc += p<0.5 ? Am(q) : Bm(q); } return acc/12.0; }` });
}

// ---------------------------------------------------------------- 9) split strips: N strips × horizontal/vertical × slide/scale (20)
for (const N of [2, 3, 4, 6, 8]) for (const ori of ['h', 'v']) for (const mode of ['slide', 'scale']) {
  const ax = ori === 'h' ? 'y' : 'x', mv = ori === 'h' ? 'x' : 'y';
  def(`split_${N}_${ori}_${mode}`, { name: n(`${N} Streifen ${ori === 'h' ? 'waagrecht' : 'senkrecht'} ${mode === 'slide' ? 'schieben' : 'wachsen'}`, `${N} strips ${ori === 'h' ? 'horizontal' : 'vertical'} ${mode}`), cat: 'mask', glsl: `${EASE} vec4 tr(vec2 uv, float p){ float i = floor(uv.${ax}*${f(N)}); float sgn = mod(i, 2.0) < 0.5 ? 1.0 : -1.0; float k = ez(clamp(p*1.3 - i/${f(N)}*0.3, 0.0, 1.0));
    ${mode === 'slide' ? `vec2 q = uv; q.${mv} += sgn*(1.0 - k); return (q.${mv} >= 0.0 && q.${mv} <= 1.0) ? Bt(q) : A(uv);` : `float c = fract(uv.${ax}*${f(N)}); return abs(c - 0.5)*2.0 < k ? Bt(uv) : A(uv);`} }` });
}

// ---------------------------------------------------------------- 10) coloured light leaks: 12 colours × 2 shapes (24)
const LEAK = { warm: '1.0,0.55,0.2', rose: '1.0,0.35,0.5', gold: '1.0,0.8,0.35', cyan: '0.3,0.9,1.0', violet: '0.6,0.35,1.0', red: '1.0,0.15,0.1', mint: '0.4,1.0,0.7', blue: '0.25,0.45,1.0', amber: '1.0,0.65,0.0', peach: '1.0,0.7,0.55', lime: '0.75,1.0,0.3', white: '1.0,1.0,1.0' };
for (const [lk, c] of Object.entries(LEAK)) for (const sh of ['side', 'burst']) {
  def(`leak2_${lk}_${sh}`, { name: n(`Lichtleck ${lk} ${sh === 'side' ? 'Seite' : 'Explosion'}`, `Light leak ${lk} ${sh}`), cat: 'light', glsl: `vec4 tr(vec2 uv, float p){ vec3 C = vec3(${c}); float k = sin(p*PI); ${sh === 'side' ? 'float m = smoothstep(0.0, 1.0, 1.0 - abs(uv.x - p*1.4 + 0.2)*1.6) * (0.6 + 0.4*fbm(uv*3.0 + p));' : 'float m = exp(-length((uv-0.5)*asp())*3.0/(0.2+k)) * (0.7+0.3*fbm(uv*4.0+p*2.0));'} vec4 base = mix(A(uv), Bt(uv), smoothstep(0.3, 0.7, p)); return vec4(base.rgb + C*m*k*1.6*u_int, 1.0); }` });
}

// ---------------------------------------------------------------- 11) whole-frame rotations (8)
for (const ang of [90, -90, 180, -180, 270, 360, 720, -360]) {
  def(`frot_${ang < 0 ? 'm' + -ang : ang}`, { name: n(`Bild drehen ${ang}°`, `Frame rotate ${ang}°`), cat: '3d', glsl: `${EASE} ${ROT} vec4 tr(vec2 uv, float p){ float k = ez(p); float s = 1.0 + sin(p*PI)*0.6; vec2 c = (uv-0.5)*asp(); vec2 q = rot2(radians(${f(ang)})*k)*c*s/asp()+0.5; return p < 0.5 ? Am(q) : Bm(q); }` });
}

// ---------------------------------------------------------------- 12) waves / ripples (12)
for (const fr of [4, 10, 20]) for (const [wk, wde, wen] of [['x', 'Welle quer', 'Wave X'], ['y', 'Welle hoch', 'Wave Y'], ['r', 'Wellenring', 'Ring ripple'], ['s', 'Strudel', 'Swirl']]) {
  def(`wv_${wk}_${fr}`, { name: n(`${wde} ${fr}`, `${wen} ${fr}`), cat: 'distort', glsl: `${ROT} vec4 tr(vec2 uv, float p){ float s = sin(p*PI)*u_int; vec2 q = uv;
    ${wk === 'x' ? `q.x += sin(uv.y*${f(fr)}*6.2832 + p*10.0)*0.05*s;` : wk === 'y' ? `q.y += sin(uv.x*${f(fr)}*6.2832 + p*10.0)*0.05*s;` : wk === 'r' ? `vec2 c = (uv-0.5)*asp(); float d = length(c); q += normalize(c + 0.0001)/asp()*sin(d*${f(fr * 3)} - p*20.0)*0.03*s;` : `vec2 c = (uv-0.5)*asp(); float d = length(c); q = rot2(s*${f(fr / 3)}*(1.0 - smoothstep(0.0, 0.8, d)))*c/asp()+0.5;`}
    return mix(Am(q), Bm(q), smoothstep(0.35, 0.65, p)); }` });
}

// ---------------------------------------------------------------- 13) pixelate variants (8)
for (const px of [8, 20, 40, 80]) for (const m of ['mix', 'cut']) {
  def(`pxl_${px}_${m}`, { name: n(`Verpixeln ${px}${m === 'cut' ? ' hart' : ''}`, `Pixelate ${px}${m === 'cut' ? ' hard' : ''}`), cat: 'glitch', glsl: `vec4 tr(vec2 uv, float p){ float s = sin(p*PI); float cells = mix(400.0, ${f(px)}, s); vec2 G = vec2(cells*asp().x, cells); vec2 q = (floor(uv*G)+0.5)/G; return ${m === 'mix' ? 'mix(Am(q), Bm(q), smoothstep(0.4, 0.6, p))' : 'p < 0.5 ? Am(q) : Bm(q)'}; }` });
}

// ---------------------------------------------------------------- 14) coloured ink spreads (10)
const INK = { schwarz: '0.02,0.02,0.02', weiss: '0.97,0.97,0.97', rot: '0.8,0.05,0.1', blau: '0.05,0.2,0.75', gold: '0.9,0.7,0.2', lila: '0.45,0.15,0.75', gruen: '0.1,0.6,0.25', pink: '0.95,0.35,0.65', cyan: '0.1,0.8,0.9', orange: '0.95,0.45,0.05' };
for (const [ik, c] of Object.entries(INK)) {
  def(`ink2_${ik}`, { name: n(`Farbklecks ${ik}`, `Ink splash ${ik}`), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec3 C = vec3(${c}); float d = length((uv-0.5)*asp()) + (fbm(uv*6.0)-0.5)*0.35; float r1 = p*1.6, r2 = p*1.6 - 0.25; if (d < r2) return Bt(uv); if (d < r1) return vec4(C, 1.0); return A(uv); }` });
}

// ---------------------------------------------------------------- 15) tactical / trailer pack (used by the "Tactical Cinematic" template)
def('tc_boxreveal', { name: n('Kasten-Reveal', 'Box reveal'), cat: 'mask', glsl: `${EASE} vec4 tr(vec2 uv, float p){ float k = ez(p); vec2 c = abs(uv - vec2(0.5, 0.5)); vec2 hs = mix(vec2(0.12, 0.18), vec2(0.75, 0.75), k); float inb = step(c.x, hs.x)*step(c.y, hs.y); float edge = inb*(1.0 - step(c.x, hs.x - 0.006))*1.0 + inb*(1.0 - step(c.y, hs.y - 0.01)); vec4 col = mix(A(uv), Bt(uv), inb); float wf = (1.0 - smoothstep(0.0, 0.25, p))*0.8*u_int; return mix(col, vec4(1.0), clamp(edge, 0.0, 1.0)*0.9 + inb*wf); }` });
def('tc_panels', { name: n('Weiße Panels', 'White panels'), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ float t = floor(p*6.0); vec2 o1 = vec2(0.1 + 0.5*hash(vec2(t, 1.0)), 0.1 + 0.5*hash(vec2(t, 2.0))); vec2 s1 = vec2(0.3 + 0.25*hash(vec2(t, 3.0)), 0.2 + 0.2*hash(vec2(t, 4.0))); float b1 = step(o1.x, uv.x)*step(uv.x, o1.x + s1.x)*step(o1.y, uv.y)*step(uv.y, o1.y + s1.y); vec2 o2 = vec2(0.2 + 0.5*hash(vec2(t, 5.0)), 0.05 + 0.6*hash(vec2(t, 6.0))); float b2 = step(o2.x, uv.x)*step(uv.x, o2.x + 0.3)*step(o2.y, uv.y)*step(uv.y, o2.y + 0.25); vec4 base = p < 0.5 ? A(uv) : Bt(uv); vec4 inset = p < 0.5 ? Bt(uv) : A(uv); vec4 c = mix(base, inset, b2*step(0.3, p)*step(p, 0.8)); return mix(c, vec4(0.96, 0.96, 0.97, 1.0), b1*u_int*step(p, 0.85)); }` });
def('tc_xwipe', { name: n('Weißes X', 'White X'), cat: 'mask', glsl: `vec4 tr(vec2 uv, float p){ vec2 q = (uv - 0.5)*asp(); float d1 = abs(q.x - q.y), d2 = abs(q.x + q.y); float w = sin(p*PI)*0.22*u_int; float x = min(d1, d2); float m = 1.0 - smoothstep(w*0.6, w, x); vec4 base = p < 0.5 ? A(uv) : Bt(uv); return mix(base, vec4(0.92, 0.94, 0.95, 1.0), m); }` });
def('tc_whitesmear', { name: n('Weiß-Wischer', 'White smear'), cat: 'light', glsl: `vec4 tr(vec2 uv, float p){ float band = 1.0 - smoothstep(0.0, 0.18 + 0.4*sin(p*PI), abs(uv.y - 0.55 + (fbm(vec2(uv.x*4.0, p*3.0)) - 0.5)*0.2)); float k = sin(p*PI); vec4 base = mix(A(uv), Bt(uv), smoothstep(0.45, 0.55, p)); float n = 0.8 + 0.2*fbm(uv*12.0 + p*4.0); return mix(base, vec4(vec3(0.95*n), 1.0), clamp(band*k*1.4*u_int + step(0.4, p)*step(p, 0.6)*0.9, 0.0, 1.0)); }` });
def('tc_negflash', { name: n('Negativ-Blitz', 'Negative flash'), cat: 'light', glsl: `vec4 tr(vec2 uv, float p){ vec4 base = p < 0.5 ? A(uv) : Bt(uv); float k = 1.0 - smoothstep(0.0, 0.5, abs(p - 0.5)*2.0); vec3 inv = vec3(1.0) - base.rgb; float l = luma(inv); return vec4(mix(base.rgb, mix(inv, vec3(step(0.45, l)), 0.5), k*u_int), 1.0); }` });
def('tc_bars', { name: n('Balken-Glitch', 'Bar glitch'), cat: 'glitch', glsl: `vec4 tr(vec2 uv, float p){ float t = floor(p*10.0); float row = floor(uv.y*7.0); float on = step(0.45, hash(vec2(row, t))); float shift = (hash(vec2(row, t + 9.0)) - 0.5)*0.3; vec2 q = vec2(uv.x + shift*on, uv.y); vec4 base = p < 0.5 ? Am(q) : Bm(q); float blk = on*step(0.6, hash(vec2(row, t + 3.0))); float gry = on*(1.0 - blk)*step(0.7, hash(vec2(row*3.0, t))); vec4 c = mix(base, vec4(0.0, 0.0, 0.0, 1.0), blk*u_int); return mix(c, vec4(0.55, 0.55, 0.55, 1.0), gry*0.8*u_int); }` });
