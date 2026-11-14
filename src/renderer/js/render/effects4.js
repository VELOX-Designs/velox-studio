// 3D effects (raymarched / projected in the fragment shader): sphere, cube, cylinder, card flip,
// 3D tiles, 3D waves with lighting, 3D photo (depth parallax), floor reflection, tunnel, tilt plane, 3D rotate loop.
import { defineEffect as def } from './effects.js';

const R = (k, de, en, min, max, d, step = 0.01) => ({ k, de, en, type: 'range', min, max, def: d, step });
const B = (k, de, en, d = false) => ({ k, de, en, type: 'bool', def: d });
const C = (k, de, en, d) => ({ k, de, en, type: 'color', def: d });
const n = (de, en) => ({ de, en });
const ROT = `mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); } mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }`;

def('sphere3d', { name: n('3D-Kugel', '3D sphere'), cat: '3d',
  params: [R('radius', 'Größe', 'Size', 0.1, 0.6, 0.38), R('spin', 'Drehung (°/s)', 'Spin (°/s)', -360, 360, 40, 1), R('tilt', 'Neigung', 'Tilt', -60, 60, 15, 1), R('light', 'Licht', 'Lighting', 0, 1, 0.7), B('bg', 'Original im Hintergrund', 'Original behind', false)],
  glsl: `${ROT} vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x/u_res.y,1.0); vec2 p = (uv-0.5)*asp; vec3 ro = vec3(0,0,2.0), rd = normalize(vec3(p, -1.6));
    float b = dot(ro, rd), c = dot(ro,ro) - u_radius*u_radius*4.0; float h = b*b - c; vec4 back = u_bg > 0.5 ? tex(uv)*0.35 : vec4(0.0);
    if (h < 0.0) return back; float t = -b - sqrt(h); vec3 pos = ro + rd*t; vec3 nn = normalize(pos);
    vec3 q = rotX(radians(u_tilt)) * rotY(radians(u_spin)*u_lt) * nn; vec2 suv = vec2(atan(q.x, q.z)/(2.0*PI)+0.5, 1.0 - (atan(q.y, sqrt(max(1e-4, 1.0-q.y*q.y)))/PI+0.5));
    vec4 col = texture(u_tex, vec2(fract(suv.x*1.0), 1.0-suv.y)); float l = mix(1.0, 0.25+0.75*max(dot(nn, normalize(vec3(-0.5,0.6,0.8))),0.0) + pow(max(dot(reflect(rd,nn), normalize(vec3(-0.5,0.6,0.8))),0.0),30.0)*0.6, u_light);
    return vec4(col.rgb*l, 1.0); }` });
def('cube3d', { name: n('3D-Würfel (drehend)', '3D cube (spinning)'), cat: '3d',
  params: [R('size', 'Größe', 'Size', 0.1, 0.6, 0.3), R('spin', 'Drehung Y (°/s)', 'Spin Y (°/s)', -360, 360, 45, 1), R('spinX', 'Drehung X (°/s)', 'Spin X (°/s)', -360, 360, 20, 1), R('light', 'Licht', 'Lighting', 0, 1, 0.6), B('bg', 'Original im Hintergrund', 'Original behind', false)],
  glsl: `${ROT} vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x/u_res.y,1.0); vec2 p = (uv-0.5)*asp; float ay = radians(u_spin)*u_lt, ax = radians(u_spinX)*u_lt + 0.3;
    mat3 m = rotY(ay) * rotX(ax); mat3 mi = rotX(-ax) * rotY(-ay);
    vec3 ro = m*vec3(0.0,0.0,2.2); vec3 rd = m*normalize(vec3(p,-1.6)); rd = sign(rd)*max(abs(rd), vec3(1e-4)) + vec3(step(abs(rd), vec3(0.0)))*1e-4;
    vec3 bs = vec3(u_size*1.8); vec3 t0 = (-bs - ro)/rd, t1 = (bs - ro)/rd; vec3 tmin = min(t0,t1), tmax = max(t0,t1);
    float tn = max(max(tmin.x,tmin.y),tmin.z), tf = min(min(tmax.x,tmax.y),tmax.z); vec4 back = u_bg > 0.5 ? tex(uv)*0.35 : vec4(0.0);
    float hit = step(tn, tf) * step(0.0, tf); vec3 pos = ro + rd*max(tn, 0.0); vec3 a = abs(pos/bs);
    vec3 nn = a.x > a.y && a.x > a.z ? vec3(sign(pos.x),0.0,0.0) : (a.y > a.z ? vec3(0.0,sign(pos.y),0.0) : vec3(0.0,0.0,sign(pos.z)));
    vec2 fuv = a.x > a.y && a.x > a.z ? pos.zy/bs.zy : (a.y > a.z ? pos.xz/bs.xz : pos.xy/bs.xy);
    vec4 col = textureLod(u_tex, clamp(fuv*0.5+0.5, 0.0, 1.0), 0.0); float l = mix(1.0, 0.35+0.65*max(dot(mi*nn, normalize(vec3(-0.4,0.5,0.8))),0.0), u_light);
    return mix(back, vec4(col.rgb*l, 1.0), hit); }` });
def('cylinder3d', { name: n('3D-Zylinder', '3D cylinder'), cat: '3d',
  params: [R('radius', 'Radius', 'Radius', 0.1, 0.6, 0.35), R('spin', 'Drehung (°/s)', 'Spin (°/s)', -360, 360, 40, 1), R('light', 'Licht', 'Lighting', 0, 1, 0.6)],
  glsl: `vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x/u_res.y,1.0); vec2 p = (uv-0.5)*asp; float r = u_radius*asp.x; float inside = step(abs(p.x), r); float nx = clamp(p.x/r, -0.999, 0.999); float ang = atan(nx, sqrt(max(1e-4, 1.0-nx*nx))) + radians(u_spin)*u_lt; float u = fract(ang/(2.0*PI)+0.5); vec4 col = textureLod(u_tex, vec2(u, uv.y), 0.0); float l = mix(1.0, 0.3+0.7*sqrt(max(0.0, 1.0-nx*nx)), u_light); return vec4(col.rgb*l, col.a)*inside; }` });
def('cardflip3d', { name: n('3D-Karten-Flip (Loop)', '3D card flip loop'), cat: '3d',
  params: [R('speed', 'Tempo (Flips/s)', 'Flips / sec', 0, 3, 0.5), B('vertical', 'Vertikal', 'Vertical')],
  glsl: `vec4 fx(vec2 uv){ float a = u_lt*u_speed*PI*2.0; float c = cos(a); float w = max(abs(c), 0.001); vec2 q = uv-0.5; if (u_vertical > 0.5) { q.y /= w; q.x *= 1.0 + sin(a)*q.y*0.4; } else { q.x /= w; q.y *= 1.0 + sin(a)*q.x*0.4; } q += 0.5; if (q.x<0.0||q.x>1.0||q.y<0.0||q.y>1.0) return vec4(0.0); vec4 col = texture(u_tex, c > 0.0 ? q : (u_vertical > 0.5 ? vec2(q.x,1.0-q.y) : vec2(1.0-q.x,q.y))); return vec4(col.rgb*(0.55+0.45*w), col.a); }` });
def('tiles3d', { name: n('3D-Kacheln (Welle)', '3D tiles wave'), cat: '3d',
  params: [R('cols', 'Spalten', 'Columns', 2, 24, 8, 1), R('rows', 'Zeilen', 'Rows', 2, 16, 5, 1), R('speed', 'Tempo', 'Speed', 0, 4, 1), R('amount', 'Stärke', 'Amount', 0, 1, 1)],
  glsl: `vec4 fx(vec2 uv){ vec2 g = uv*vec2(u_cols,u_rows); vec2 cid = floor(g), f = fract(g); float a = sin(u_lt*u_speed*2.0 - (cid.x+cid.y)*0.5)*PI*0.5*u_amount; float c = cos(a); float w = max(abs(c),0.02); float x = (f.x-0.5)/w+0.5; if (x<0.0||x>1.0) return vec4(0.0); vec2 q = (cid + vec2(c>0.0?x:1.0-x, f.y))/vec2(u_cols,u_rows); vec4 col = texture(u_tex, q); return vec4(col.rgb*(0.5+0.5*w), col.a); }` });
def('wave3d', { name: n('3D-Wellen mit Licht', '3D waves with light'), cat: '3d',
  params: [R('amp', 'Höhe', 'Height', 0, 0.1, 0.03, 0.001), R('freq', 'Dichte', 'Frequency', 1, 40, 10), R('speed', 'Tempo', 'Speed', 0, 10, 3), R('light', 'Licht', 'Lighting', 0, 2, 1)],
  glsl: `vec4 fx(vec2 uv){ float h = sin(uv.x*u_freq + u_lt*u_speed)*cos(uv.y*u_freq*0.8 + u_lt*u_speed*0.7); float dx = cos(uv.x*u_freq + u_lt*u_speed)*u_freq*u_amp, dy = -sin(uv.y*u_freq*0.8+u_lt*u_speed*0.7)*u_freq*0.8*u_amp; vec3 nn = normalize(vec3(-dx,-dy,1.0)); vec4 col = texc(uv + vec2(dx,dy)*0.05); float l = 1.0 + (dot(nn, normalize(vec3(-0.5,0.5,0.7))) - 0.7)*u_light; return vec4(col.rgb*l, col.a); }` });
def('photo3d', { name: n('3D-Foto (Parallax aus Tiefe)', '3D photo (depth parallax)'), cat: '3d',
  params: [R('amount', 'Tiefe', 'Depth', 0, 0.08, 0.03, 0.001), R('speed', 'Bewegung', 'Motion', 0, 2, 0.5), R('zoom', 'Zoom', 'Zoom', 1, 1.5, 1.08), B('invert', 'Tiefe umkehren', 'Invert depth')],
  glsl: `vec4 fx(vec2 uv){ vec2 dir = vec2(sin(u_lt*u_speed*1.3), cos(u_lt*u_speed)*0.5); vec2 q = (uv-0.5)/u_zoom+0.5; vec4 acc = vec4(0); vec2 cur = q;
    for (int i=0;i<8;i++){ float d = luma(texture(u_tex, cur).rgb); d = smoothstep(0.0,1.0,d); if (u_invert < 0.5) d = 1.0 - d; cur = q - dir*u_amount*(1.0-d); } return texc(cur); }` });
def('floor3d', { name: n('3D-Spiegelboden', '3D floor reflection'), cat: '3d',
  params: [R('horizon', 'Bodenhöhe', 'Floor level', 0.2, 0.9, 0.62), R('tilt', 'Kippung', 'Tilt', 0, 1, 0.4), R('reflect', 'Spiegelung', 'Reflection', 0, 1, 0.45), R('size', 'Größe', 'Size', 0.2, 1, 0.6), C('floorC', 'Bodenfarbe', 'Floor color', '#0b0c10')],
  glsl: `vec4 fx(vec2 uv){ vec2 p = vec2(uv.x, 1.0-uv.y); float s = u_size; float top = u_horizon - s*0.9; vec2 box0 = vec2(0.5 - s*0.5, top), box1 = vec2(0.5 + s*0.5, u_horizon);
    vec3 bg = mix(u_floorC*1.6, u_floorC, p.y);
    if (p.x>box0.x && p.x<box1.x && p.y>box0.y && p.y<box1.y) { float py = (p.y - box0.y)/(box1.y-box0.y); float k = 1.0 + (py-0.5)*u_tilt*0.6; float px = ((p.x-0.5)/(s)*k)+0.5; if (px>0.0&&px<1.0) { vec4 c = texture(u_tex, vec2(px, 1.0-py)); return vec4(mix(bg, c.rgb, c.a), 1.0); } }
    if (p.y > u_horizon) { float d = p.y - u_horizon; float py = 1.0 - d/((box1.y-box0.y)); if (py > 0.0) { float px = ((p.x-0.5)/s)+0.5; if (px>0.0&&px<1.0) { vec4 c = texture(u_tex, vec2(px + sin(p.y*200.0)*0.0015, 1.0-py)); float fall = (1.0 - d*4.0); return vec4(mix(bg, c.rgb, c.a*u_reflect*max(fall,0.0)), 1.0); } } }
    return vec4(bg, 1.0); }` });
def('tunnel3d', { name: n('3D-Tunnel', '3D tunnel'), cat: '3d',
  params: [R('speed', 'Tempo', 'Speed', -3, 3, 0.6), R('twist', 'Verdrehung', 'Twist', -2, 2, 0.2), R('fog', 'Nebel', 'Fog', 0, 1, 0.6)],
  glsl: `vec4 fx(vec2 uv){ vec2 p = (uv-0.5)*vec2(u_res.x/u_res.y,1.0); float r = length(p); float a = atan(p.y,p.x); vec2 t = vec2(a/(2.0*PI) + u_lt*u_twist*0.1, 0.25/max(r,0.01) + u_lt*u_speed); vec4 c = texture(u_tex, fract(t)); return vec4(c.rgb*mix(1.0, smoothstep(0.0,0.5,r), u_fog), 1.0); }` });
def('tilt3d', { name: n('3D-Kippen (mit Licht)', '3D tilt (lit)'), cat: '3d',
  params: [R('rx', 'Kippen X (°)', 'Tilt X (°)', -70, 70, 25, 1), R('ry', 'Kippen Y (°)', 'Tilt Y (°)', -70, 70, -20, 1), R('wobble', 'Schweben', 'Hover', 0, 1, 0.3), R('light', 'Glanz', 'Shine', 0, 1, 0.5)],
  glsl: `${ROT} vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x/u_res.y,1.0); vec2 p = (uv-0.5)*asp; float wb = u_wobble*sin(u_lt*1.5)*8.0; mat3 m = rotX(radians(u_rx + wb)) * rotY(radians(u_ry + wb*0.7)); vec3 nrm = m*vec3(0,0,1); vec3 ro = vec3(0,0,1.8), rd = normalize(vec3(p,-1.6));
    float t = dot(vec3(0.0) - ro, nrm)/dot(rd, nrm); if (t < 0.0) return vec4(0.0); vec3 hit = transpose(m)*(ro + rd*t); vec2 q = hit.xy/asp/0.9 + 0.5; if (q.x<0.0||q.x>1.0||q.y<0.0||q.y>1.0) return vec4(0.0);
    vec4 c = texture(u_tex, q); float sh = pow(max(dot(reflect(rd, nrm), normalize(vec3(0.3,0.6,0.7))),0.0), 20.0)*u_light; return vec4(c.rgb + sh, c.a); }` });
def('spin3dloop', { name: n('3D-Drehung (Endlos)', '3D spin loop'), cat: '3d',
  params: [R('speed', 'Umdrehungen/s', 'Turns / sec', -2, 2, 0.25), S3('axis'), R('persp', 'Perspektive', 'Perspective', 0, 1, 0.5)],
  glsl: `vec4 fx(vec2 uv){ float a = u_lt*u_speed*2.0*PI; float c = cos(a), s = sin(a); vec2 q = uv-0.5; int ax = int(u_axis+0.5); float w = max(abs(c),0.001);
    if (ax==0) { q.x /= c; q.y *= 1.0 + s*q.x*u_persp; } else if (ax==1) { q.y /= c; q.x *= 1.0 + s*q.y*u_persp; } else { q = mat2(c,-s,s,c)*q; }
    q += 0.5; if (q.x<0.0||q.x>1.0||q.y<0.0||q.y>1.0) return vec4(0.0); vec4 col = texture(u_tex, q); return vec4(col.rgb*(ax==2?1.0:0.5+0.5*w), col.a); }` });
function S3(k) { return { k, de: 'Achse', en: 'Axis', type: 'select', options: ['Y (horizontal)', 'X (vertikal)', 'Z (flach)'], def: 0 }; }
