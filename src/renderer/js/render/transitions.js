// Transition library. Each transition is a GLSL function `vec4 tr(vec2 uv, float p)`
// mixing u_a (outgoing) and u_b (incoming). Uniforms: u_int (intensity), u_dir (direction index), u_res.
import { GLSL_HEADER } from './gl.js';

export const TRANSITIONS = {};
export const TRANSITION_CATS = {
  basic: { de: 'Basis', en: 'Basic' }, zoom: { de: 'Zoom', en: 'Zoom' }, motion: { de: 'Bewegung / Velocity', en: 'Motion / Velocity' },
  slide: { de: 'Slide / Push', en: 'Slide / Push' }, mask: { de: 'Masken / Wipes', en: 'Masks / Wipes' }, glitch: { de: 'Glitch / RGB', en: 'Glitch / RGB' },
  light: { de: 'Licht / Flash', en: 'Light / Flash' }, '3d': { de: '3D', en: '3D' }, cinematic: { de: 'Cinematic', en: 'Cinematic' },
};
export const DIRS = { de: ['Links', 'Rechts', 'Oben', 'Unten'], en: ['Left', 'Right', 'Up', 'Down'] };

export function defineTransition(id, d) { TRANSITIONS[id] = { id, dir: false, ...d }; return TRANSITIONS[id]; }
const def = defineTransition;

export function buildTrShader(d) {
  return `${GLSL_HEADER}
uniform sampler2D u_a; uniform sampler2D u_b; uniform float u_p; uniform float u_int; uniform float u_dir;
vec4 A(vec2 uv){ if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return vec4(0.0); return texture(u_a, uv); }
vec4 Bt(vec2 uv){ if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return vec4(0.0); return texture(u_b, uv); }
vec4 Am(vec2 uv){ return texture(u_a, abs(mod(uv + 1.0, 2.0) - 1.0)); }
vec4 Bm(vec2 uv){ return texture(u_b, abs(mod(uv + 1.0, 2.0) - 1.0)); }
vec2 dirv(){ int d = int(u_dir+0.5); return d==0?vec2(-1,0):d==1?vec2(1,0):d==2?vec2(0,1):vec2(0,-1); }
vec2 asp(){ return vec2(u_res.x/u_res.y, 1.0); }
vec4 zoomA(vec2 uv, float s){ return Am((uv-0.5)/s+0.5); }
vec4 zoomB(vec2 uv, float s){ return Bm((uv-0.5)/s+0.5); }
vec4 blurDir(sampler2D t, vec2 uv, vec2 d){ vec4 acc=vec4(0); for(int i=0;i<16;i++){ float k=float(i)/15.0-0.5; vec2 q=uv+d*k; acc+=texture(t, abs(mod(q+1.0,2.0)-1.0)); } return acc/16.0; }
vec4 blurZoom(sampler2D t, vec2 uv, float s){ vec4 acc=vec4(0); for(int i=0;i<16;i++){ float k=float(i)/15.0; vec2 q=0.5+(uv-0.5)*(1.0-s*k); acc+=texture(t, abs(mod(q+1.0,2.0)-1.0)); } return acc/16.0; }
${d.glsl}
void main(){ o = tr(v_uv, clamp(u_p, 0.0, 1.0)); }`;
}

const ease = 'float e(float x){ return x<0.5?4.0*x*x*x:1.0-pow(-2.0*x+2.0,3.0)/2.0; }';

// BASIC
def('dissolve', { name: { de: 'Überblenden', en: 'Cross Dissolve' }, cat: 'basic', glsl: `vec4 tr(vec2 uv, float p){ return mix(A(uv), Bt(uv), p); }` });
def('dipblack', { name: { de: 'Schwarzblende', en: 'Dip to Black' }, cat: 'basic', glsl: `vec4 tr(vec2 uv, float p){ return p<0.5 ? mix(A(uv), vec4(0,0,0,1), p*2.0) : mix(vec4(0,0,0,1), Bt(uv), (p-0.5)*2.0); }` });
def('dipwhite', { name: { de: 'Weißblende', en: 'Dip to White' }, cat: 'basic', glsl: `vec4 tr(vec2 uv, float p){ return p<0.5 ? mix(A(uv), vec4(1), p*2.0) : mix(vec4(1), Bt(uv), (p-0.5)*2.0); }` });
def('additive', { name: { de: 'Additive Blende', en: 'Additive Dissolve' }, cat: 'basic', glsl: `vec4 tr(vec2 uv, float p){ vec4 a = A(uv)*(1.0-smoothstep(0.5,1.0,p)); vec4 b = Bt(uv)*smoothstep(0.0,0.5,p); return clamp(a+b,0.0,1.0); }` });
def('lumafade', { name: { de: 'Luma-Blende', en: 'Luma Fade' }, cat: 'basic', glsl: `vec4 tr(vec2 uv, float p){ float l = luma(A(uv).rgb); float m = smoothstep(l-0.15, l+0.15, p*1.3-0.15); return mix(A(uv), Bt(uv), m); }` });

// ZOOM
def('zoomin', { name: { de: 'Smooth Zoom In', en: 'Smooth Zoom In' }, cat: 'zoom',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float k = e(p); float i = u_int;
    if (p < 0.5) { float s = 1.0 + k*2.0*i; return blurZoom(u_a, (uv-0.5)/s+0.5, 0.25*sin(p*PI)*i); }
    float s = 1.0/(1.0 + (1.0-k)*2.0*i); return blurZoom(u_b, (uv-0.5)*s+0.5, 0.25*sin(p*PI)*i); }` });
def('zoomout', { name: { de: 'Smooth Zoom Out', en: 'Smooth Zoom Out' }, cat: 'zoom',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float k = e(p); float i = u_int;
    if (p < 0.5) { float s = 1.0/(1.0 + k*1.5*i); return blurZoom(u_a, (uv-0.5)/s+0.5, 0.2*sin(p*PI)*i); }
    float s = 1.0 + (1.0-k)*1.5*i; return blurZoom(u_b, (uv-0.5)/s+0.5, 0.2*sin(p*PI)*i); }` });
def('zoompunch', { name: { de: 'Zoom Punch', en: 'Zoom Punch' }, cat: 'zoom',
  glsl: `vec4 tr(vec2 uv, float p){ float i = u_int; if (p < 0.5) { float s = 1.0 + pow(p*2.0, 3.0)*3.0*i; return zoomA(uv, s); } float q = (p-0.5)*2.0; float s = 1.0 + (1.0-q)*(1.0-q)*0.6*i; return mix(vec4(1), zoomB(uv, s), smoothstep(0.0,0.25,q)); }` });
def('zoomspin', { name: { de: 'Zoom + Drehung', en: 'Zoom Spin' }, cat: 'zoom',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float k = e(p); float a = (k - 0.5) * 2.0 * PI * 0.5 * u_int; vec2 q = (uv-0.5)*asp(); float s = 1.0 + sin(p*PI)*1.5*u_int; q = mat2(cos(a),-sin(a),sin(a),cos(a))*q/s; vec2 r = q/asp()+0.5; return p<0.5 ? Am(r) : Bm(r); }` });

// MOTION / VELOCITY
def('whippan', { name: { de: 'Whip Pan', en: 'Whip Pan' }, cat: 'motion', dir: true,
  glsl: `${ease} vec4 tr(vec2 uv, float p){ vec2 d = dirv(); float k = e(p); float bl = sin(p*PI)*0.35*u_int;
    vec4 a = blurDir(u_a, uv + d*k, d*bl); vec4 b = blurDir(u_b, uv + d*(k-1.0), d*bl); return mix(a, b, smoothstep(0.4,0.6,p)); }` });
def('velocity', { name: { de: 'Velocity Blur', en: 'Velocity Blur' }, cat: 'motion',
  glsl: `vec4 tr(vec2 uv, float p){ float b = sin(p*PI)*u_int; float s = 1.0 + b*0.25; vec4 a = blurZoom(u_a, (uv-0.5)/s+0.5, b*0.4); vec4 c = blurZoom(u_b, (uv-0.5)/s+0.5, b*0.4); return mix(a, c, smoothstep(0.35,0.65,p)); }` });
def('shake', { name: { de: 'Shake Übergang', en: 'Shake Transition' }, cat: 'motion',
  glsl: `vec4 tr(vec2 uv, float p){ float s = sin(p*PI)*u_int; vec2 off = vec2(hash1(floor(p*40.0))-0.5, hash1(floor(p*40.0)+7.0)-0.5)*0.12*s; vec2 q = (uv - 0.5 + off)/(1.0+0.1*s) + 0.5; vec4 a = blurDir(u_a, q, off*0.6); vec4 b = blurDir(u_b, q, off*0.6); return mix(a,b,smoothstep(0.45,0.55,p)); }` });
def('spin', { name: { de: 'Camera Spin', en: 'Camera Spin' }, cat: 'motion',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float k = e(p); float a = k*2.0*PI*u_int; vec2 q = (uv-0.5)*asp(); float s = 1.0 + sin(p*PI)*0.6; vec4 acc = vec4(0);
    for(int i=0;i<12;i++){ float aa = a - float(i)*0.03*sin(p*PI)*u_int; vec2 r = (mat2(cos(aa),-sin(aa),sin(aa),cos(aa))*q)/s/asp()+0.5; acc += p<0.5 ? Am(r) : Bm(r); } return acc/12.0; }` });
def('swipe', { name: { de: 'Swipe Blur', en: 'Swipe Blur' }, cat: 'motion', dir: true,
  glsl: `${ease} vec4 tr(vec2 uv, float p){ vec2 d = dirv(); float k = e(p); vec2 dd = d*sin(p*PI)*0.25*u_int; vec4 a = blurDir(u_a, uv + d*k*0.3, dd); vec4 b = blurDir(u_b, uv + d*(k-1.0)*0.3, dd); return mix(a,b,k); }` });
def('stretch', { name: { de: 'Stretch', en: 'Stretch' }, cat: 'motion', dir: true,
  glsl: `${ease} vec4 tr(vec2 uv, float p){ vec2 d = abs(dirv()); float k = e(p); float st = 1.0 + sin(p*PI)*4.0*u_int; vec2 q = 0.5 + (uv-0.5)/mix(vec2(1.0), vec2(st), d); return mix(Am(q), Bm(q), smoothstep(0.45,0.55,p)); }` });

// SLIDE / PUSH
def('slide', { name: { de: 'Slide', en: 'Slide' }, cat: 'slide', dir: true,
  glsl: `${ease} vec4 tr(vec2 uv, float p){ vec2 d = dirv(); float k = e(p); vec4 b = Bt(uv - d*(1.0-k)); return mix(A(uv), b, b.a > 0.0 ? 1.0 : 0.0); }` });
def('push', { name: { de: 'Push', en: 'Push' }, cat: 'slide', dir: true,
  glsl: `${ease} vec4 tr(vec2 uv, float p){ vec2 d = dirv(); float k = e(p); vec2 qa = uv + d*k; vec2 qb = uv + d*(k-1.0); if (qa.x>=0.0&&qa.x<=1.0&&qa.y>=0.0&&qa.y<=1.0) return A(qa); return Bt(qb); }` });
def('pushblur', { name: { de: 'Push + Motion Blur', en: 'Push Blur' }, cat: 'slide', dir: true,
  glsl: `${ease} vec4 tr(vec2 uv, float p){ vec2 d = dirv(); float k = e(p); vec2 dd = d*sin(p*PI)*0.2*u_int; vec2 qa = uv + d*k; vec2 qb = uv + d*(k-1.0);
    if (qa.x>=0.0&&qa.x<=1.0&&qa.y>=0.0&&qa.y<=1.0) return blurDir(u_a, qa, dd); return blurDir(u_b, qb, dd); }` });
def('split', { name: { de: 'Split', en: 'Split' }, cat: 'slide',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float k = e(p); float o = k*0.5; if (uv.x < 0.5) { vec2 q = uv + vec2(o,0); if (q.x < 0.5) return A(q); } else { vec2 q = uv - vec2(o,0); if (q.x > 0.5) return A(q); } return Bt(uv); }` });
def('bounce', { name: { de: 'Bounce-In', en: 'Bounce In' }, cat: 'slide', dir: true,
  glsl: `float bo(float x){ float n1=7.5625, d1=2.75; if(x<1.0/d1) return n1*x*x; if(x<2.0/d1){x-=1.5/d1; return n1*x*x+0.75;} if(x<2.5/d1){x-=2.25/d1; return n1*x*x+0.9375;} x-=2.625/d1; return n1*x*x+0.984375; }
    vec4 tr(vec2 uv, float p){ vec2 d = dirv(); vec4 b = Bt(uv - d*(1.0-bo(p))); return b.a>0.0 ? b : A(uv); }` });

// MASKS / WIPES
def('wipe', { name: { de: 'Wipe', en: 'Wipe' }, cat: 'mask', dir: true,
  glsl: `vec4 tr(vec2 uv, float p){ vec2 d = dirv(); float x = dot(uv - 0.5, -d) + 0.5; float m = smoothstep(p - 0.05*u_int, p + 0.05*u_int, 1.0 - x + 0.0); m = step(x, p*1.1 - 0.05 + 0.0); m = smoothstep(x - 0.04*u_int, x, p*1.08 - 0.04); return mix(A(uv), Bt(uv), m); }` });
def('iris', { name: { de: 'Kreis-Maske', en: 'Circle Mask' }, cat: 'mask',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float r = e(p)*1.2; float d = length((uv-0.5)*asp()); float m = 1.0 - smoothstep(r - 0.02*u_int, r, d); return mix(A(uv), Bt(uv), m); }` });
def('diamond', { name: { de: 'Rauten-Maske', en: 'Diamond Mask' }, cat: 'mask',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ vec2 q = abs(uv-0.5)*asp(); float d = q.x+q.y; float r = e(p)*1.8; return mix(A(uv), Bt(uv), 1.0 - smoothstep(r-0.02, r, d)); }` });
def('diagonal', { name: { de: 'Diagonal-Wipe', en: 'Diagonal Wipe' }, cat: 'mask',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float d = (uv.x + (1.0-uv.y))*0.5; float m = smoothstep(d-0.05, d, e(p)*1.1-0.05); return mix(A(uv), Bt(uv), m); }` });
def('blinds', { name: { de: 'Jalousie', en: 'Blinds' }, cat: 'mask',
  glsl: `vec4 tr(vec2 uv, float p){ float n = 10.0; float f = fract(uv.y*n); return f < p ? Bt(uv) : A(uv); }` });
def('clock', { name: { de: 'Uhr-Wipe', en: 'Clock Wipe' }, cat: 'mask',
  glsl: `vec4 tr(vec2 uv, float p){ vec2 q = uv-0.5; float a = atan(q.x, q.y)/(2.0*PI) + 0.5; return a < p ? Bt(uv) : A(uv); }` });
def('pixels', { name: { de: 'Pixel-Auflösung', en: 'Pixel Dissolve' }, cat: 'mask',
  glsl: `vec4 tr(vec2 uv, float p){ float s = 6.0 + 60.0*sin(p*PI)*u_int; vec2 b = s/u_res; vec2 q = (floor(uv/b)+0.5)*b; float h = hash(floor(uv/b)); return h < p ? Bt(q) : A(q); }` });
def('inkwipe', { name: { de: 'Tinten-Wipe', en: 'Ink Wipe' }, cat: 'mask',
  glsl: `vec4 tr(vec2 uv, float p){ float n = fbm(uv*4.0); float m = smoothstep(p*1.4-0.2, p*1.4, n*0.7+uv.x*0.3+0.15); m = 1.0 - m; return mix(A(uv), Bt(uv), m); }` });
def('heart', { name: { de: 'Herz-Maske', en: 'Heart Mask' }, cat: 'mask',
  glsl: `vec4 tr(vec2 uv, float p){ vec2 q = (uv-0.5)*asp(); q.y = q.y + 0.1; q /= max(p*1.6, 0.0001); q.x = abs(q.x); float h = q.y - sqrt(q.x)*0.6; float d = length(vec2(q.x, h)) - 0.45; return d < 0.0 ? Bt(uv) : A(uv); }` });

// GLITCH / RGB
def('glitch', { name: { de: 'Glitch', en: 'Glitch' }, cat: 'glitch',
  glsl: `vec4 tr(vec2 uv, float p){ float s = sin(p*PI)*u_int; float t = floor(p*30.0); vec2 b = floor(uv*vec2(8.0,24.0)); float r = hash(b+t); vec2 q = uv + vec2((r-0.5)*0.2*s*step(0.6,r), 0.0);
    float sh = 0.03*s; vec4 a = vec4(Am(q+vec2(sh,0)).r, Am(q).g, Am(q-vec2(sh,0)).b, 1.0); vec4 c = vec4(Bm(q+vec2(sh,0)).r, Bm(q).g, Bm(q-vec2(sh,0)).b, 1.0);
    return hash(vec2(t, b.y)) < p ? c : a; }` });
def('rgbsplit', { name: { de: 'RGB Split', en: 'RGB Split' }, cat: 'glitch',
  glsl: `vec4 tr(vec2 uv, float p){ float s = sin(p*PI)*0.08*u_int; vec4 a = vec4(Am(uv+vec2(s,0)).r, Am(uv).g, Am(uv-vec2(s,0)).b, 1.0); vec4 b = vec4(Bm(uv+vec2(s,0)).r, Bm(uv).g, Bm(uv-vec2(s,0)).b, 1.0); return mix(a,b,smoothstep(0.4,0.6,p)); }` });
def('chromazoom', { name: { de: 'Chroma Zoom', en: 'Chroma Zoom' }, cat: 'glitch',
  glsl: `vec4 tr(vec2 uv, float p){ float s = sin(p*PI)*u_int; vec2 c = uv-0.5; float k = 1.0 + s*0.3; vec4 a, b;
    a = vec4(Am(c/(k*1.04)+0.5).r, Am(c/k+0.5).g, Am(c/(k*0.96)+0.5).b, 1.0); b = vec4(Bm(c/(k*1.04)+0.5).r, Bm(c/k+0.5).g, Bm(c/(k*0.96)+0.5).b, 1.0); return mix(a,b,smoothstep(0.4,0.6,p)); }` });
def('datamosh', { name: { de: 'Datamosh', en: 'Datamosh' }, cat: 'glitch',
  glsl: `vec4 tr(vec2 uv, float p){ float s = sin(p*PI)*u_int; vec2 b = floor(uv*24.0); vec2 mv = (vec2(hash(b), hash(b+3.1))-0.5)*0.15*s; vec4 bb = Bm(uv - mv*(1.0-p)); vec4 aa = Am(uv + mv*p); return hash(b+floor(p*8.0)) < p ? bb : aa; }` });

// LIGHT / FLASH
def('flash', { name: { de: 'Flash', en: 'Flash' }, cat: 'light',
  glsl: `vec4 tr(vec2 uv, float p){ float f = exp(-pow((p-0.5)*6.0,2.0))*u_int; vec4 c = p<0.5 ? A(uv) : Bt(uv); return mix(c, vec4(1), clamp(f,0.0,1.0)); }` });
def('lightleak', { name: { de: 'Light Leak', en: 'Light Leak' }, cat: 'light',
  glsl: `vec4 tr(vec2 uv, float p){ float n = fbm(uv*2.0 + vec2(p*2.0, 0.0)); float w = sin(p*PI); vec3 col = mix(vec3(1.0,0.35,0.1), vec3(1.0,0.85,0.4), n); float m = smoothstep(0.2, 0.9, n + w*0.8 - 0.3 + uv.x*0.3) * w * u_int;
    vec4 c = mix(A(uv), Bt(uv), smoothstep(0.3,0.7,p)); return vec4(c.rgb + col*m*1.5 - c.rgb*m*0.3, 1.0); }` });
def('burn', { name: { de: 'Film Burn', en: 'Film Burn' }, cat: 'light',
  glsl: `vec4 tr(vec2 uv, float p){ float n = fbm(uv*3.0 + p*3.0); float w = sin(p*PI); vec3 burn = vec3(1.0,0.5,0.15)*smoothstep(0.3,1.0,n+w-0.4)*2.0*u_int; vec4 c = mix(A(uv), Bt(uv), smoothstep(0.35,0.65,p)); return vec4(c.rgb + burn*w, 1.0); }` });
def('flare', { name: { de: 'Lens-Flare Übergang', en: 'Flare Transition' }, cat: 'light',
  glsl: `vec4 tr(vec2 uv, float p){ vec2 L = vec2(mix(-0.2, 1.2, p), 0.4); vec2 q = (uv-L)*asp(); float d = length(q); vec3 f = vec3(1.0,0.85,0.6)*(0.08/(d+0.03))*u_int + vec3(0.5,0.7,1.0)*exp(-abs(q.y)*60.0)*0.8*u_int; float w = sin(p*PI);
    vec4 c = mix(A(uv), Bt(uv), smoothstep(0.4,0.6,p)); return vec4(c.rgb + f*w + vec3(w*w*0.6*u_int), 1.0); }` });
def('flashblur', { name: { de: 'Flash + Zoom', en: 'Flash Zoom' }, cat: 'light',
  glsl: `vec4 tr(vec2 uv, float p){ float w = sin(p*PI); vec4 c = p<0.5 ? blurZoom(u_a, uv, w*0.3*u_int) : blurZoom(u_b, uv, w*0.3*u_int); return mix(c, vec4(1), pow(w, 3.0)*u_int); }` });

// 3D
def('cube', { name: { de: '3D Würfel', en: '3D Cube' }, cat: '3d', dir: true,
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float k = e(p); vec2 d = dirv(); bool hz = abs(d.x) > 0.5; float sg = hz ? -d.x : d.y; float x = hz ? uv.x : uv.y; float y = hz ? uv.y : uv.x;
    float persp = 0.35*u_int; float sc = 1.0 - sin(k*PI)*0.15; float bnd = sg > 0.0 ? 1.0-k : k;
    if (sg > 0.0) { if (x < bnd) { float u = x / max(bnd, 1e-4); float pp = 1.0 + persp*k*(1.0-u); float v = (y-0.5)*pp/sc+0.5; vec2 q = hz?vec2(u,v):vec2(v,u); return A(q); } else { float u = (x-bnd)/max(1.0-bnd,1e-4); float pp = 1.0 + persp*(1.0-k)*u; float v = (y-0.5)*pp/sc+0.5; vec2 q = hz?vec2(u,v):vec2(v,u); return Bt(q); } }
    else { if (x > bnd) { float u = (x-bnd)/max(1.0-bnd,1e-4); float pp = 1.0 + persp*k*u; float v = (y-0.5)*pp/sc+0.5; vec2 q = hz?vec2(u,v):vec2(v,u); return A(q); } else { float u = x/max(bnd,1e-4); float pp = 1.0 + persp*(1.0-k)*(1.0-u); float v = (y-0.5)*pp/sc+0.5; vec2 q = hz?vec2(u,v):vec2(v,u); return Bt(q); } } }` });
def('flip', { name: { de: '3D Flip', en: '3D Flip' }, cat: '3d',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float k = e(p); float a = k*PI; float c = cos(a); float w = abs(c); if (w < 0.001) return vec4(0,0,0,1); float x = (uv.x-0.5)/w; float persp = 1.0 + (uv.y-0.5)*0.0; float yy = (uv.y-0.5)/(1.0 - 0.25*sin(a)*x*sign(c)*u_int)+0.5; vec2 q = vec2(x+0.5, yy);
    if (q.x<0.0||q.x>1.0||q.y<0.0||q.y>1.0) return vec4(0,0,0,1); return c > 0.0 ? A(q) : Bt(vec2(1.0-q.x, q.y)*vec2(1,1) + vec2(0)) ; }` });
def('pagecurl', { name: { de: 'Seite umblättern', en: 'Page Turn' }, cat: '3d',
  glsl: `vec4 tr(vec2 uv, float p){ float x = 1.0 - p*1.3; float d = uv.x - x + (uv.y-0.5)*0.2*p; if (d < 0.0) return A(uv); float r = 0.1; if (d < r) { float sn = min(d/r,0.999); float t = atan(sn, sqrt(1.0-sn*sn)); vec2 q = vec2(x + t*r - (uv.y-0.5)*0.2*p, uv.y); vec4 c = A(q); return vec4(c.rgb*(0.6+0.4*cos(t)),1.0); } return Bt(uv)*mix(0.6, 1.0, smoothstep(0.0, 0.2, d - r)); }` });
def('rotate3d', { name: { de: '3D Rotation', en: '3D Rotate' }, cat: '3d',
  glsl: `${ease} vec4 tr(vec2 uv, float p){ float k = e(p); float a = (k - (k>0.5?1.0:0.0))*PI; float s = 1.0 - sin(k*PI)*0.3*u_int; vec2 q = (uv-0.5)/s; float cz = cos(a); float x = q.x/max(abs(cz),0.001); float y = q.y*(1.0 + q.x*sin(a)*0.6*u_int); vec2 r = vec2(x,y)+0.5; if (r.x<0.0||r.x>1.0||r.y<0.0||r.y>1.0) return vec4(0,0,0,1); return k<0.5 ? A(r) : Bt(r); }` });
def('tunnel', { name: { de: 'Tunnel', en: 'Tunnel' }, cat: '3d',
  glsl: `vec4 tr(vec2 uv, float p){ vec2 q = (uv-0.5)*asp(); float r = length(q); float a = atan(q.y,q.x); float z = p*2.0*u_int; vec2 t = vec2(a/(2.0*PI)+0.5, fract(0.3/max(r,0.01)+z)); vec4 tun = p<0.5 ? Am(t) : Bm(t); float w = sin(p*PI); vec4 c = p<0.5 ? A(uv) : Bt(uv); return mix(c, tun*smoothstep(0.0,0.4,r), w); }` });

// CINEMATIC
def('filmroll', { name: { de: 'Film Roll', en: 'Film Roll' }, cat: 'cinematic', dir: true,
  glsl: `${ease} vec4 tr(vec2 uv, float p){ vec2 d = dirv(); float k = e(p); vec2 dd = d*sin(p*PI)*0.3*u_int; vec2 qa = fract(uv + d*k); vec2 qb = fract(uv + d*(k-1.0)); vec2 raw = uv + d*k; bool inA = raw.x>=0.0&&raw.x<=1.0&&raw.y>=0.0&&raw.y<=1.0; return inA ? blurDir(u_a, qa, dd) : blurDir(u_b, qb, dd); }` });
def('letterboxin', { name: { de: 'Cinema-Balken Übergang', en: 'Letterbox Close' }, cat: 'cinematic',
  glsl: `vec4 tr(vec2 uv, float p){ float b = sin(p*PI)*0.5; if (uv.y < b || uv.y > 1.0-b) return vec4(0,0,0,1); return p<0.5 ? A(uv) : Bt(uv); }` });
def('blur', { name: { de: 'Blur Übergang', en: 'Blur Transition' }, cat: 'cinematic',
  glsl: `vec4 tr(vec2 uv, float p){ float r = sin(p*PI)*0.03*u_int; vec4 a = vec4(0), b = vec4(0); for(int i=0;i<25;i++){ vec2 o2 = vec2(float(i%5)-2.0, float(i/5)-2.0)*r*0.5; a += Am(uv+o2); b += Bm(uv+o2); } return mix(a/25.0, b/25.0, smoothstep(0.3,0.7,p)); }` });
def('smoke', { name: { de: 'Rauch / Nebel', en: 'Smoke' }, cat: 'cinematic',
  glsl: `vec4 tr(vec2 uv, float p){ float n = fbm(uv*3.0 + vec2(0.0, p*2.0)); float w = sin(p*PI); vec4 c = mix(A(uv), Bt(uv), smoothstep(n-0.2, n+0.2, p*1.4-0.2)); return mix(c, vec4(vec3(0.85),1.0), smoothstep(0.4,0.9,n)*w*0.8*u_int); }` });
