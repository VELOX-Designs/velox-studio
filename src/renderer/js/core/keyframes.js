// Keyframe evaluation. A param is either a plain value or { kf: [{ t, v, e }] }
// where t is clip-local seconds and e the easing towards the NEXT keyframe.
export const EASINGS = {
  linear: (x) => x,
  easeIn: (x) => x * x * x,
  easeOut: (x) => 1 - Math.pow(1 - x, 3),
  easeInOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  smooth: (x) => x * x * (3 - 2 * x),
  expoIn: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  expoOut: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  backOut: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  elastic: (x) => (x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
  bounce: (x) => {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  },
  hold: () => 0,
};
export const EASING_NAMES = Object.keys(EASINGS);

export const isKf = (p) => p && typeof p === 'object' && Array.isArray(p.kf);

function mix(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((x, i) => mix(x, b[i], t));
  if (typeof a === 'string' && a[0] === '#' && typeof b === 'string' && b[0] === '#') {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (n, s) => (n >> s) & 255;
    const r = Math.round(ch(pa, 16) + (ch(pb, 16) - ch(pa, 16)) * t);
    const g = Math.round(ch(pa, 8) + (ch(pb, 8) - ch(pa, 8)) * t);
    const bl = Math.round(ch(pa, 0) + (ch(pb, 0) - ch(pa, 0)) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  return t < 1 ? a : b;
}

export function evalParam(p, t) {
  if (!isKf(p)) return p;
  const k = p.kf;
  if (!k.length) return 0;
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1e-9;
      const fn = EASINGS[a.e || 'linear'] || EASINGS.linear;
      return mix(a.v, b.v, fn((t - a.t) / span));
    }
  }
  return last.v;
}

export function setKeyframe(p, t, v, e = 'easeInOut') {
  const out = isKf(p) ? { kf: p.kf.map((x) => ({ ...x })) } : { kf: [] };
  const eps = 1 / 240;
  const ex = out.kf.find((k) => Math.abs(k.t - t) < eps);
  if (ex) ex.v = v; else out.kf.push({ t, v, e });
  out.kf.sort((a, b) => a.t - b.t);
  return out;
}
export function removeKeyframe(p, t) {
  if (!isKf(p)) return p;
  const eps = 1 / 240;
  const kf = p.kf.filter((k) => Math.abs(k.t - t) >= eps);
  if (!kf.length) return evalParam(p, t);
  return { kf };
}
export function hasKeyAt(p, t) {
  return isKf(p) && p.kf.some((k) => Math.abs(k.t - t) < 1 / 240);
}
// shift keyframes when a clip's head is trimmed
export function shiftKeys(p, dt) {
  if (!isKf(p)) return p;
  return { kf: p.kf.map((k) => ({ ...k, t: k.t + dt })) };
}
export function scaleKeys(p, f) {
  if (!isKf(p)) return p;
  return { kf: p.kf.map((k) => ({ ...k, t: k.t * f })) };
}
