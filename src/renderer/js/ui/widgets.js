// Reusable inspector widgets: keyframeable sliders, curves editor, color wheels, speed-ramp editor.
import { el, clamp } from '../core/util.js';
import { store } from '../core/project.js';
import { evalParam, isKf, setKeyframe, removeKeyframe, hasKeyAt, EASING_NAMES } from '../core/keyframes.js';
import { sampleCurve } from '../render/compositor.js';
import { contextMenu } from './dialogs.js';
import { L } from '../core/i18n.js';

// live editing helper: one undo step per drag
let live = null;
export function liveEdit(label, fn) {
  if (!live) { store.begin(label); live = label; }
  fn(); store.touch();
}
export function liveCommit() { if (live) { live = null; store.end(); } }
window.addEventListener('mouseup', () => setTimeout(liveCommit, 0));
window.addEventListener('keyup', () => setTimeout(liveCommit, 0));

export const updaters = new Set(); // functions refreshing displayed values when time changes

const fmt = (v, step) => (typeof v !== 'number' ? v : step >= 1 ? String(Math.round(v)) : v.toFixed(step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3));

// obj[key] holds number or {kf}; ltFn() gives clip-local time
export function numberProp({ label, obj, key, min = 0, max = 1, step = 0.01, ltFn, keyframes = true, onChange, cls = '', unit = '' }) {
  const range = el('input', { type: 'range', min, max, step });
  const val = el('input', { class: 'val', type: 'text' });
  const kf = el('button', { class: 'kf-btn', title: L('Keyframe (Rechtsklick: Optionen)', 'Keyframe (right-click: options)') }, '◆');
  const cur = () => evalParam(obj[key], ltFn ? ltFn() : 0);
  const refresh = () => {
    const v = cur();
    if (document.activeElement !== range) range.value = v;
    range.style.setProperty('--p', ((clamp(v, min, max) - min) / (max - min)) * 100 + '%');
    if (document.activeElement !== val) val.value = fmt(v, step) + unit;
    const lt = ltFn ? ltFn() : 0;
    kf.className = 'kf-btn' + (isKf(obj[key]) ? (hasKeyAt(obj[key], lt) ? ' on' : ' has') : '');
  };
  const set = (v, label2 = label) => {
    v = +v; if (!isFinite(v)) return;
    liveEdit(label2, () => {
      if (isKf(obj[key])) obj[key] = setKeyframe(obj[key], ltFn(), v);
      else obj[key] = v;
      onChange?.(v);
    });
    refresh();
  };
  range.addEventListener('input', () => set(range.value));
  range.addEventListener('dblclick', () => { const d = range.dataset.def; if (d !== undefined) { set(d); liveCommit(); } });
  val.addEventListener('change', () => { set(parseFloat(val.value)); liveCommit(); });
  val.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(cur() + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)); liveCommit(); } e.stopPropagation(); });
  // drag on value = scrub
  val.addEventListener('mousedown', (e) => {
    if (document.activeElement === val) return;
    e.preventDefault(); const sx = e.clientX, v0 = cur(); let moved = false;
    const mv = (ev) => { moved = true; set(clamp(v0 + (ev.clientX - sx) * step * (ev.shiftKey ? 10 : 1) * Math.max(1, (max - min) / 200 / step), min * 10, max * 10)); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); liveCommit(); if (!moved) { val.focus(); val.select(); } };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  });
  kf.addEventListener('click', () => {
    const lt = ltFn(); const v = cur();
    store.edit('Keyframe', () => {
      if (!isKf(obj[key])) obj[key] = setKeyframe(v, lt, v);
      else if (hasKeyAt(obj[key], lt)) obj[key] = removeKeyframe(obj[key], lt);
      else obj[key] = setKeyframe(obj[key], lt, v);
    });
    refresh();
  });
  kf.addEventListener('contextmenu', (e) => {
    e.preventDefault(); const lt = ltFn();
    const items = [
      { label: L('Keyframes entfernen (Wert behalten)', 'Remove all keyframes'), disabled: !isKf(obj[key]), action: () => store.edit('Keyframes', () => { obj[key] = cur(); }) },
      { label: L('Zum vorherigen Keyframe', 'Previous keyframe'), disabled: !isKf(obj[key]), action: () => jump(-1) },
      { label: L('Zum nächsten Keyframe', 'Next keyframe'), disabled: !isKf(obj[key]), action: () => jump(1) },
      '-',
      ...EASING_NAMES.map((n) => ({ label: L('Kurve: ', 'Easing: ') + n, disabled: !hasKeyAt(obj[key], lt), action: () => store.edit('Easing', () => { const k = obj[key].kf.find((x) => Math.abs(x.t - lt) < 1 / 240); if (k) k.e = n; }) })),
    ];
    contextMenu(e.clientX, e.clientY, items);
  });
  const jump = async (dir) => {
    const { engine } = await import('../playback/engine.js');
    const c = store.primaryClip(); if (!c || !isKf(obj[key])) return;
    const lt = ltFn(); const ks = obj[key].kf.map((k) => k.t);
    const t = dir < 0 ? ks.filter((x) => x < lt - 1e-3).pop() : ks.find((x) => x > lt + 1e-3);
    if (t !== undefined) engine.seek(c.start + t);
  };
  range.dataset.def = typeof obj[key] === 'number' ? obj[key] : '';
  refresh(); updaters.add(refresh);
  return el('div', { class: 'prop ' + cls }, el('label', { title: label }, label), range, val, keyframes ? kf : el('span'));
}

export function selectProp({ label, value, options, onChange, cls = '' }) {
  const s = el('select', { style: { width: '100%' } });
  options.forEach((o, i) => { const [v, n] = Array.isArray(o) ? o : [i, o]; s.appendChild(el('option', { value: v }, n)); });
  s.value = value;
  s.onchange = () => onChange(isNaN(+s.value) || s.value === '' ? s.value : +s.value);
  return el('div', { class: 'prop wide ' + cls }, el('label', {}, label), s, el('span'));
}
export function colorProp({ label, obj, key, ltFn, onChange }) {
  const inp = el('input', { type: 'color' });
  const refresh = () => { const v = evalParam(obj[key], ltFn ? ltFn() : 0); if (typeof v === 'string' && v[0] === '#') inp.value = v.slice(0, 7); };
  inp.addEventListener('input', () => liveEdit(label, () => { obj[key] = isKf(obj[key]) ? setKeyframe(obj[key], ltFn(), inp.value) : inp.value; onChange?.(); }));
  inp.addEventListener('change', liveCommit);
  refresh(); updaters.add(refresh);
  return el('div', { class: 'prop wide' }, el('label', {}, label), el('div', { class: 'row', style: { margin: 0 } }, inp, el('span', { class: 'muted' }, '')), el('span'));
}
export function boolProp({ label, value, onChange }) {
  const cb = el('input', { type: 'checkbox' }); cb.checked = !!value;
  cb.onchange = () => onChange(cb.checked);
  return el('div', { class: 'prop wide' }, el('label', {}, label), el('div', {}, cb), el('span'));
}

export function section(title, body, { open = true, acts = [], cls = '' } = {}) {
  const s = el('div', { class: 'sec ' + cls + (open ? '' : ' closed') });
  const h = el('div', { class: 'sec-h' }, el('span', { class: 'chev' }, '▾'), title, el('div', { class: 'acts' }, ...acts));
  h.addEventListener('click', (e) => { if (e.target.closest('.acts')) return; s.classList.toggle('closed'); });
  s.append(h, el('div', { class: 'sec-b' }, ...[].concat(body)));
  return s;
}

// ------------------------------------------------------------------ curves editor
export function curvesEditor(params, onChange) {
  const cv = el('canvas', { class: 'curve-editor', width: 300, height: 170 });
  let ch = 'master';
  const colors = { master: '#ffffff', r: '#ff5470', g: '#2fd18b', b: '#4d8dff' };
  const chips = el('div', { class: 'chips', style: { marginBottom: '6px' } }, ...Object.keys(colors).map((k) => el('span', { class: 'chip' + (k === ch ? ' on' : ''), onclick: (e) => { ch = k; chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); e.target.classList.add('on'); draw(); } }, k === 'master' ? 'RGB' : k.toUpperCase())));
  const g = cv.getContext('2d');
  const pts = () => (params[ch] ||= [[0, 0], [1, 1]]);
  function draw() {
    const W = cv.width, H = cv.height;
    g.fillStyle = '#0b0c10'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#222833'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((W * i) / 4, 0); g.lineTo((W * i) / 4, H); g.moveTo(0, (H * i) / 4); g.lineTo(W, (H * i) / 4); g.stroke(); }
    g.strokeStyle = '#333a48'; g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke();
    for (const k of Object.keys(colors)) {
      const s = sampleCurve(params[k] || [[0, 0], [1, 1]]);
      g.strokeStyle = k === ch ? colors[k] : colors[k] + '44'; g.lineWidth = k === ch ? 2 : 1;
      g.beginPath(); for (let i = 0; i < 256; i++) { const x = (i / 255) * W, y = H - s[i] * H; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    }
    g.fillStyle = colors[ch];
    for (const [x, y] of pts()) { g.beginPath(); g.arc(x * W, H - y * H, 4.5, 0, 7); g.fill(); }
  }
  const hit = (x, y) => pts().findIndex(([px, py]) => Math.hypot(px * cv.width - x, (1 - py) * cv.height - y) < 9);
  cv.addEventListener('mousedown', (e) => {
    const r = cv.getBoundingClientRect(); const sx = cv.width / r.width, sy = cv.height / r.height;
    const x = (e.clientX - r.left) * sx, y = (e.clientY - r.top) * sy;
    let i = hit(x, y);
    if (e.button === 2) { if (i > 0 && i < pts().length - 1) { liveEdit('Kurve', () => { pts().splice(i, 1); onChange(); }); liveCommit(); draw(); } return; }
    if (i < 0) { liveEdit('Kurve', () => { pts().push([x / cv.width, 1 - y / cv.height]); pts().sort((a, b) => a[0] - b[0]); onChange(); }); i = hit(x, y); }
    const mv = (ev) => {
      const p = pts()[i]; if (!p) return;
      const nx = clamp((ev.clientX - r.left) * sx / cv.width, 0, 1), ny = clamp(1 - (ev.clientY - r.top) * sy / cv.height, 0, 1);
      const isEnd = i === 0 || i === pts().length - 1;
      liveEdit('Kurve', () => { p[0] = isEnd ? p[0] : clamp(nx, pts()[i - 1][0] + 0.01, pts()[i + 1][0] - 0.01); p[1] = ny; onChange(); });
      draw();
    };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); liveCommit(); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    draw();
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('dblclick', () => { liveEdit('Kurve', () => { params[ch] = [[0, 0], [1, 1]]; onChange(); }); liveCommit(); draw(); });
  draw();
  return el('div', {}, chips, cv, el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '3px' } }, L('Klick: Punkt · Rechtsklick: löschen · Doppelklick: Reset', 'Click: add · Right-click: delete · Double-click: reset')));
}

// ------------------------------------------------------------------ color wheel (returns hex, centre = #808080)
export function colorWheel(label, obj, key, onChange) {
  const w = el('div', { class: 'wheel' }); const dot = el('div', { class: 'dot' }); w.appendChild(dot);
  const toPos = (hex) => {
    const n = parseInt((hex || '#808080').slice(1), 16); const r = ((n >> 16) & 255) / 255 - 0.5, g = ((n >> 8) & 255) / 255 - 0.5, b = (n & 255) / 255 - 0.5;
    // project rgb offset on 2D chroma plane
    const x = r - 0.5 * g - 0.5 * b, y = (Math.sqrt(3) / 2) * (g - b);
    return [x, y];
  };
  const place = () => { const [x, y] = toPos(obj[key]); dot.style.left = 50 + x * 90 + '%'; dot.style.top = 50 - y * 90 + '%'; };
  const setFrom = (e) => {
    const r = w.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width - 0.5) * 2, y = -((e.clientY - r.top) / r.height - 0.5) * 2;
    const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; }
    const ang = Math.atan2(y, x), mag = Math.min(1, Math.hypot(x, y)) * 0.5;
    const rr = 0.5 + mag * Math.cos(ang), gg = 0.5 + mag * Math.cos(ang - (2 * Math.PI) / 3), bb = 0.5 + mag * Math.cos(ang + (2 * Math.PI) / 3);
    const hex = '#' + [rr, gg, bb].map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
    liveEdit('Farbrad', () => { obj[key] = hex; onChange(); }); place();
  };
  w.addEventListener('mousedown', (e) => { setFrom(e); const mv = (ev) => setFrom(ev); const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); liveCommit(); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); });
  w.addEventListener('dblclick', () => { liveEdit('Farbrad', () => { obj[key] = '#808080'; onChange(); }); liveCommit(); place(); });
  place();
  return el('div', {}, w, el('div', { class: 'wheel-lbl' }, label));
}

// ------------------------------------------------------------------ speed ramp editor
export function rampEditor(clip, onChange) {
  const cv = el('canvas', { class: 'ramp-editor', width: 300, height: 150 });
  const g = cv.getContext('2d');
  const lo = Math.log(0.1), hi = Math.log(10);
  const vy = (v) => cv.height - ((Math.log(clamp(v, 0.1, 10)) - lo) / (hi - lo)) * cv.height;
  const yv = (y) => Math.exp(lo + (1 - y / cv.height) * (hi - lo));
  const ramp = () => clip.ramp || [{ u: 0, v: clip.speed || 1 }, { u: 1, v: clip.speed || 1 }];
  function draw() {
    const W = cv.width, H = cv.height;
    g.fillStyle = '#0b0c10'; g.fillRect(0, 0, W, H);
    g.font = '10px Consolas'; g.fillStyle = '#5d6577';
    for (const v of [0.1, 0.25, 0.5, 1, 2, 4, 10]) { const y = vy(v); g.fillStyle = v === 1 ? '#3a4152' : '#1c2029'; g.fillRect(0, y, W, 1); g.fillStyle = '#5d6577'; g.fillText(v + 'x', 3, y - 2); }
    const r = ramp();
    g.strokeStyle = '#ffb547'; g.lineWidth = 2; g.beginPath();
    r.forEach((k, i) => { const x = k.u * W, y = vy(k.v); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    g.fillStyle = 'rgba(255,181,71,0.1)'; g.lineTo(W, H); g.lineTo(0, H); g.fill();
    g.fillStyle = '#fff'; r.forEach((k) => { g.beginPath(); g.arc(k.u * W, vy(k.v), 4.5, 0, 7); g.fill(); });
  }
  cv.addEventListener('mousedown', (e) => {
    const rc = cv.getBoundingClientRect(); const sx = cv.width / rc.width, sy = cv.height / rc.height;
    const x = (e.clientX - rc.left) * sx, y = (e.clientY - rc.top) * sy;
    let r = JSON.parse(JSON.stringify(ramp()));
    let i = r.findIndex((k) => Math.hypot(k.u * cv.width - x, vy(k.v) - y) < 9);
    if (e.button === 2) { if (i > 0 && i < r.length - 1) { r.splice(i, 1); onChange(r, true); draw(); } return; }
    if (i < 0) { r.push({ u: x / cv.width, v: +yv(y).toFixed(2) }); r.sort((a, b) => a.u - b.u); i = r.findIndex((k) => Math.abs(k.u - x / cv.width) < 1e-6); onChange(r, false); }
    const mv = (ev) => {
      const nx = clamp((ev.clientX - rc.left) * sx / cv.width, 0, 1), ny = clamp((ev.clientY - rc.top) * sy, 0, cv.height);
      const k = r[i]; if (!k) return;
      if (i > 0 && i < r.length - 1) k.u = clamp(nx, r[i - 1].u + 0.01, r[i + 1].u - 0.01);
      k.v = +yv(ny).toFixed(2);
      if (ev.shiftKey) k.v = [0.1, 0.25, 0.5, 1, 2, 4, 10].reduce((a, b) => (Math.abs(b - k.v) < Math.abs(a - k.v) ? b : a));
      onChange(r, false); draw();
    };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); onChange(r, true); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    draw();
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  draw();
  return { el: cv, draw };
}
