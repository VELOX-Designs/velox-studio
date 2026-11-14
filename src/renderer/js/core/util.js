// Shared helpers
export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  if (tag === 'input' && n.type === 'range') rangeFill(n);
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return n;
}

// timecode HH:MM:SS:FF
export function tc(sec, fps = 30) {
  if (!isFinite(sec)) sec = 0;
  const neg = sec < 0; sec = Math.abs(sec);
  const totalFrames = Math.round(sec * fps);
  const f = totalFrames % Math.round(fps);
  const s = Math.floor(totalFrames / Math.round(fps));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return (neg ? '-' : '') + `${p(hh)}:${p(mm)}:${p(ss)}:${p(f)}`;
}
export function shortTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function parseTc(str, fps = 30) {
  const parts = String(str).trim().split(/[:;.]/).map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / fps;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / fps;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}
export const snapFrame = (t, fps) => Math.round(t * fps) / fps;

export function hexToRgb(hex) {
  hex = String(hex || '#000000').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= new Set()).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._h[ev]?.delete(fn); }
  emit(ev, ...a) { this._h[ev]?.forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } }); }
}
export const bus = new Emitter();

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttleRaf(fn) {
  let q = false, args;
  return (...a) => { args = a; if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...args); }); };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(1) + ' ' + u[i];
}
export function fileUrl(p) { return 'file:///' + String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^file:\/\/\/([A-Za-z])%3A/, 'file:///$1:'); }

// keep the coloured track of every range slider in sync (user input and programmatic .value = …)
const RANGE_VALUE = typeof HTMLInputElement !== 'undefined' ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') : null;
function rangeFill(n) {
  const upd = () => { const min = +n.min || 0, max = n.max === '' ? 100 : +n.max, v = +RANGE_VALUE.get.call(n); n.style.setProperty('--p', (max > min ? ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100 : 0) + '%'); };
  Object.defineProperty(n, 'value', { configurable: true, get() { return RANGE_VALUE.get.call(n); }, set(v) { RANGE_VALUE.set.call(n, v); upd(); } });
  n.addEventListener('input', upd);
  upd();
}
