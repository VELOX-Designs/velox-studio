// Graphics UI: shape inspector, on-canvas editors (Bezier mask, corner pin), particle editor,
// graphics/sticker/overlay library tab and the keyframe graph editor.
import { store, clipEnd } from '../core/project.js';
import { el, $, bus, clamp, deepClone, uid } from '../core/util.js';
import { L, N } from '../core/i18n.js';
import { settings, savePreset, userPresets } from '../core/settings.js';
import { evalParam, isKf, setKeyframe, hasKeyAt, EASINGS, EASING_NAMES } from '../core/keyframes.js';
import { SHAPE_KINDS, SHAPE_ANIMS } from '../render/shapes.js';
import { EMITTER_PRESETS, pathPoints } from '../render/effects3.js';
import { EFFECTS, defaultParams } from '../render/effects.js';
import { numberProp, selectProp, colorProp, boolProp, section, liveEdit, liveCommit } from './widgets.js';
import { run } from '../core/commands.js';
import { modal, toast, contextMenu, promptBox } from './dialogs.js';
import { viewer, drawOverlay } from './viewer.js';
import { engine } from '../playback/engine.js';
import { registerCommands } from '../core/commands.js';

// ------------------------------------------------------------------ shape inspector
export function shapePanel(c, lt) {
  const s = c.shape; const set = (k) => (v) => store.edit('Form', () => { s[k] = v; });
  const np = (label, key, min, max, step) => numberProp({ label, obj: s, key, min, max, step, keyframes: false, ltFn: lt });
  const labelIn = el('input', { type: 'text', value: s.label || '', style: { width: '100%' } });
  labelIn.addEventListener('input', () => liveEdit('Beschriftung', () => { s.label = labelIn.value; })); labelIn.addEventListener('change', liveCommit); labelIn.addEventListener('keydown', (e) => e.stopPropagation());
  return el('div', {},
    section(L('Form', 'Shape'), [
      selectProp({ label: L('Art', 'Kind'), value: s.kind, options: Object.entries(SHAPE_KINDS).map(([k, v]) => [k, N(v)]), onChange: set('kind') }),
      np(L('Breite', 'Width'), 'w', 4, 4000, 1), np(L('Höhe', 'Height'), 'h', 4, 4000, 1), np(L('Rundung', 'Radius'), 'radius', 0, 500, 1),
      np(L('Linienstärke', 'Line width'), 'lineWidth', 1, 200, 1), np(L('Spitzen / Ecken', 'Points'), 'points', 3, 24, 1), np(L('Innenradius (Stern)', 'Inner radius (star)'), 'inner', 0.05, 1, 0.01),
      np(L('Fortschritt', 'Progress'), 'progress', 0, 1, 0.001),
      el('div', { class: 'prop wide' }, el('label', {}, L('Beschriftung', 'Label')), labelIn, el('span'))]),
    section(L('Farbe & Kontur', 'Fill & stroke'), [
      colorProp({ label: L('Füllung', 'Fill'), obj: s, key: 'fill', ltFn: lt }),
      el('div', { class: 'prop wide' }, el('label', {}, L('Verlauf', 'Gradient')), el('div', { class: 'row', style: { margin: 0 } }, (() => { const i = el('input', { type: 'color', value: s.fill2 || '#22d3ee' }); i.oninput = () => liveEdit('Verlauf', () => { s.fill2 = i.value; }); i.onchange = liveCommit; return i; })(), el('button', { class: 'btn small', onclick: () => store.edit('Verlauf', () => { s.fill2 = ''; }) }, L('aus', 'off'))), el('span')),
      np(L('Verlaufswinkel', 'Gradient angle'), 'gradAngle', 0, 360, 1),
      colorProp({ label: L('Akzent', 'Accent'), obj: s, key: 'accent', ltFn: lt }),
      np(L('Kontur', 'Stroke'), 'stroke', 0, 60, 0.5), colorProp({ label: L('Konturfarbe', 'Stroke color'), obj: s, key: 'strokeColor', ltFn: lt }),
      np(L('Schatten', 'Shadow'), 'shadow', 0, 2, 0.01), colorProp({ label: L('Textfarbe', 'Label color'), obj: s, key: 'labelColor', ltFn: lt })]),
    section(L('Animation', 'Animation'), [
      selectProp({ label: L('Eingang', 'In'), value: s.anim, options: Object.entries(SHAPE_ANIMS).map(([k, v]) => [k, N(v)]), onChange: set('anim') }),
      selectProp({ label: L('Ausgang', 'Out'), value: s.animOut, options: Object.entries(SHAPE_ANIMS).filter(([k]) => ['none', 'fade', 'pop', 'wipe', 'slide'].includes(k)).map(([k, v]) => [k, N(v)]), onChange: set('animOut') }),
      np(L('Dauer (s)', 'Duration (s)'), 'animDur', 0.05, 5, 0.01)]));
}

// ------------------------------------------------------------------ effect extras (inside effect cards)
export function fxExtras(c, fx) {
  if (fx.type === 'bezmask') {
    const editing = viewer.editFx?.fxId === fx.id;
    return el('div', { class: 'row' },
      el('button', { class: 'btn small' + (editing ? ' primary' : ''), onclick: () => { viewer.editFx = editing ? null : { clipId: c.id, fxId: fx.id, kind: 'bezmask' }; drawOverlay(); bus.emit('selection'); } }, editing ? L('✓ Bearbeitung beenden', '✓ Done editing') : '✎ ' + L('Maske im Bild bearbeiten', 'Edit mask on canvas')),
      el('button', { class: 'btn small', title: L('Pfad als Keyframe am Playhead', 'Path keyframe at playhead'), onclick: () => store.edit('Masken-Keyframe', () => { const lt = Math.max(0, store.time - c.start); fx.params.points = setKeyframe(fx.params.points, lt, deepClone(evalParam(fx.params.points, lt))); }) }, '◆ ' + L('Pfad-Keyframe', 'Path keyframe')),
      el('button', { class: 'btn small', onclick: () => run('trackMask', { clipId: c.id, fxId: fx.id }) }, '🎯 ' + L('Maske tracken', 'Track mask')),
      el('div', { class: 'muted', style: { fontSize: '11px', width: '100%' } }, L('Im Bild: Punkte ziehen · Klick auf Linie = Punkt einfügen · Doppelklick = rund/eckig · Rechtsklick = löschen', 'Canvas: drag points · click on line = add · double-click = smooth/corner · right-click = delete')));
  }
  if (fx.type === 'cornerpin') {
    const editing = viewer.editFx?.fxId === fx.id;
    return el('div', { class: 'row' },
      el('button', { class: 'btn small' + (editing ? ' primary' : ''), onclick: () => { viewer.editFx = editing ? null : { clipId: c.id, fxId: fx.id, kind: 'cornerpin' }; drawOverlay(); bus.emit('selection'); } }, editing ? L('✓ Fertig', '✓ Done') : '✎ ' + L('Ecken im Bild ziehen', 'Drag corners on canvas')),
      el('button', { class: 'btn small', onclick: () => run('trackCornerPin', { clipId: c.id, fxId: fx.id }) }, '🎯 ' + L('Ecken tracken (Clip darunter)', 'Track corners (clip below)')));
  }
  if (fx.type === 'emitter') {
    return el('div', {},
      el('div', { class: 'chips', style: { margin: '4px 0' } }, ...Object.entries(EMITTER_PRESETS).map(([k, v]) => el('span', { class: 'chip', onclick: () => store.edit('Partikel-Preset', () => { fx.params = Object.assign(defaultParams('emitter'), deepClone(v.p)); }) }, N(v))),
        ...(userPresets.particles || []).map((p) => el('span', { class: 'chip', onclick: () => store.edit('Partikel-Preset', () => { fx.params = Object.assign(defaultParams('emitter'), deepClone(p.params)); }) }, '★ ' + p.name))),
      el('button', { class: 'btn small', onclick: async () => { const n = await promptBox(L('Name des Partikel-Presets', 'Particle preset name'), L('Meine Partikel', 'My particles')); if (n) { savePreset('particles', { id: uid('pp'), name: n, params: deepClone(fx.params) }); toast(L('Gespeichert', 'Saved'), 'ok'); bus.emit('selection'); } } }, '💾 ' + L('Als Partikel-Preset speichern', 'Save particle preset')));
  }
  return null;
}

// ------------------------------------------------------------------ on-canvas editors
function fxRef() { const e = viewer.editFx; if (!e) return null; const c = store.clip(e.clipId); const fx = c?.effects.find((f) => f.id === e.fxId); return c && fx ? { c, fx, kind: e.kind } : null; }
function setParam(fx, key, value, lt) { fx.params[key] = isKf(fx.params[key]) ? setKeyframe(fx.params[key], lt, value) : value; }
viewer.customOverlay = (ov, W, H) => {
  const r = fxRef(); if (!r) return false;
  const { c, fx, kind } = r; const lt = clamp(store.time - c.start, 0, c.dur);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H); Object.assign(svg.style, { position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', cursor: 'crosshair' });
  const NS = svg.namespaceURI; const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const drag = (e, onMove) => { e.preventDefault(); e.stopPropagation(); store.begin('Maske'); const mv = (ev) => { const b = svg.getBoundingClientRect(); onMove((ev.clientX - b.left) / W, (ev.clientY - b.top) / H); store.touch(); drawOverlay(); }; const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); store.end(); drawOverlay(); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); };
  if (kind === 'bezmask') {
    const pts = deepClone(evalParam(fx.params.points, lt) || []);
    if (pts.length >= 2) {
      const segs = pathPoints(pts);
      let d = `M ${segs[0][0][0] * W} ${segs[0][0][1] * H}`; for (const [, c1, c2, p2] of segs) d += ` C ${c1[0] * W} ${c1[1] * H} ${c2[0] * W} ${c2[1] * H} ${p2[0] * W} ${p2[1] * H}`;
      const path = mk('path', { d: d + ' Z', fill: 'rgba(255,181,71,0.08)', stroke: '#ffb547', 'stroke-width': 2, 'stroke-dasharray': '6 4' });
      path.style.cursor = 'copy';
      path.addEventListener('mousedown', (e) => { // insert point at nearest segment
        const b = svg.getBoundingClientRect(); const x = (e.clientX - b.left) / W, y = (e.clientY - b.top) / H;
        let best = 0, bd = 1e9; pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; const dd = (mx - x) ** 2 + (my - y) ** 2; if (dd < bd) { bd = dd; best = i; } });
        store.edit('Maskenpunkt', () => { const np = deepClone(pts); np.splice(best + 1, 0, [x, y, 1]); setParam(fx, 'points', np, lt); }); drawOverlay(); e.stopPropagation();
      });
      svg.appendChild(path);
    }
    pts.forEach((p, i) => {
      const h = mk(p[2] ? 'circle' : 'rect', p[2] ? { cx: p[0] * W, cy: p[1] * H, r: 6, fill: '#fff', stroke: '#ffb547', 'stroke-width': 2 } : { x: p[0] * W - 5, y: p[1] * H - 5, width: 10, height: 10, fill: '#fff', stroke: '#ffb547', 'stroke-width': 2 });
      h.style.cursor = 'move';
      h.addEventListener('mousedown', (e) => { if (e.button === 2) return; drag(e, (x, y) => { const np = deepClone(evalParam(fx.params.points, lt)); np[i][0] = x; np[i][1] = y; setParam(fx, 'points', np, lt); }); });
      h.addEventListener('dblclick', (e) => { e.stopPropagation(); store.edit('Maskenpunkt', () => { const np = deepClone(evalParam(fx.params.points, lt)); np[i][2] = np[i][2] ? 0 : 1; setParam(fx, 'points', np, lt); }); drawOverlay(); });
      h.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); if (pts.length <= 3) return; store.edit('Maskenpunkt', () => { const np = deepClone(evalParam(fx.params.points, lt)); np.splice(i, 1); setParam(fx, 'points', np, lt); }); drawOverlay(); });
      svg.appendChild(h);
    });
  } else if (kind === 'cornerpin') {
    const P = {}; for (const k of ['tlx', 'tly', 'trx', 'try_', 'brx', 'bry', 'blx', 'bly']) P[k] = evalParam(fx.params[k] ?? defaultParams('cornerpin')[k], lt);
    const q = [['tlx', 'tly'], ['trx', 'try_'], ['brx', 'bry'], ['blx', 'bly']];
    svg.appendChild(mk('polygon', { points: q.map(([a, b]) => `${P[a] * W},${P[b] * H}`).join(' '), fill: 'rgba(34,211,238,0.06)', stroke: '#22d3ee', 'stroke-width': 2 }));
    q.forEach(([a, b]) => { const h = mk('circle', { cx: P[a] * W, cy: P[b] * H, r: 8, fill: '#fff', stroke: '#22d3ee', 'stroke-width': 3 }); h.style.cursor = 'move'; h.addEventListener('mousedown', (e) => drag(e, (x, y) => { setParam(fx, a, +x.toFixed(4), lt); setParam(fx, b, +y.toFixed(4), lt); })); svg.appendChild(h); });
  }
  ov.appendChild(svg);
  return true;
};

// ------------------------------------------------------------------ library tab: graphics, stickers, overlays, particles
export function graphicsTab(body) {
  const sec = el('div', { class: 'lib-section' });
  sec.appendChild(el('h4', {}, L('Formen & Grafiken (klicken = am Playhead)', 'Shapes & graphics (click = at playhead)')));
  const g = el('div', { class: 'grid3' });
  const icons = { rect: '▭', circle: '◯', line: '―', arrow: '➜', star: '★', polygon: '⬢', triangle: '▲', heart: '♥', bubble: '💬', lowerthird: '▤', progress: '▰', ring: '◔', cross: '✕', check: '✓', bracket: '⌜⌟' };
  for (const [k, v] of Object.entries(SHAPE_KINDS)) g.appendChild(el('div', { class: 'text-preset', style: { fontSize: '13px', flexDirection: 'column', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }, onclick: () => run('addShape', { kind: k, shape: k === 'lowerthird' ? { w: 900, h: 120, radius: 0, fill: '#111318', label: 'Name · Titel', anim: 'wipe' } : k === 'progress' ? { w: 900, h: 40, fill: '#262b36', anim: 'grow' } : k === 'arrow' ? { w: 500, h: 120, fill: '#ffb547', anim: 'draw' } : k === 'bracket' || k === 'cross' || k === 'check' || k === 'line' || k === 'ring' ? { fill: '#ffffff', anim: 'draw', lineWidth: 14 } : {} }) }, el('span', { style: { fontSize: '22px' } }, icons[k] || '■'), N(v)));
  sec.appendChild(g);
  sec.appendChild(el('h4', {}, L('Sticker', 'Stickers')));
  const st = el('div', { class: 'chips' });
  for (const e of ['🔥', '💯', '😂', '😱', '👀', '⭐', '❤️', '💥', '🎯', '👑', '💀', '🚨', '🚓', '💸', '⚡', '✅', '❌', '🤯', '🥶', '😎', '👍', '🎉', '🏆', '📍']) st.appendChild(el('span', { class: 'chip', style: { fontSize: '20px', padding: '2px 8px' }, onclick: () => run('addSticker', { emoji: e }) }, e));
  sec.appendChild(st);
  sec.appendChild(el('h4', {}, L('Animierte Overlays (wirken auf alles darunter)', 'Animated overlays (affect everything below)')));
  const ovs = [['rain', '🌧 Regen'], ['raindrops', '💧 Tropfen auf Glas'], ['snowfall', '❄ Schnee'], ['fire', '🔥 Feuer'], ['smoke', '🌫 Rauch/Nebel'], ['lightning', '⚡ Gewitter'], ['sparks', '✨ Funken'], ['scratches', '🎞 Filmkratzer'], ['lightleak', '🌅 Light Leak'], ['bokehoverlay', '🔆 Bokeh'], ['lensflare', '☀ Lens Flare'], ['particles', '❄ Partikel'], ['stars', '⭐ Funkeln'], ['vhs', '📼 VHS'], ['timestamp', '⏺ REC-Kamera'], ['speedlines', '💨 Speed Lines'], ['cinebarsanim', '🎬 Cinema-Balken']];
  const og = el('div', { class: 'chips' }); for (const [t, n] of ovs) if (EFFECTS[t]) og.appendChild(el('span', { class: 'chip', onclick: () => run('addOverlay', { type: t }) }, n)); sec.appendChild(og);
  sec.appendChild(el('h4', {}, L('Partikel-Emitter', 'Particle emitter')));
  const pg = el('div', { class: 'chips' }); for (const [k, v] of Object.entries(EMITTER_PRESETS)) pg.appendChild(el('span', { class: 'chip', onclick: () => run('addParticles', { preset: k }) }, '✦ ' + N(v)));
  sec.appendChild(pg);
  sec.appendChild(el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '6px' } }, L('Emitter auswählen → Inspector „Effekte“: alle Parameter (Richtung, Schwerkraft, Lebensdauer, Farben, Form) einstellen und als eigenes Preset speichern.', 'Select the emitter → inspector "Effects": tweak every parameter and save as your own preset.')));
  body.appendChild(sec);
}

// ------------------------------------------------------------------ keyframe graph editor
export function graphEditor() {
  const c = store.primaryClip(); if (!c) { toast(L('Clip auswählen', 'Select a clip')); return; }
  const tracks = [];
  for (const [k, v] of Object.entries(c.transform)) if (isKf(v)) tracks.push({ label: 'Transform · ' + k, obj: c.transform, key: k });
  for (const f of c.effects) for (const [k, v] of Object.entries(f.params)) if (isKf(v) && typeof v.kf[0]?.v === 'number') tracks.push({ label: (N(EFFECTS[f.type]?.name) || f.type) + ' · ' + k, obj: f.params, key: k });
  if (isKf(c.volume)) tracks.push({ label: 'Audio · volume', obj: c, key: 'volume' });
  if (!tracks.length) { toast(L('Dieser Clip hat noch keine Keyframes (◆ im Inspector setzen)', 'This clip has no keyframes yet (set ◆ in the inspector)')); return; }
  let cur = tracks[0];
  const cv = el('canvas', { width: 860, height: 380, style: { width: '860px', height: '380px', background: '#0b0c10', borderRadius: '8px', cursor: 'crosshair', display: 'block' } });
  const list = el('select', {}, ...tracks.map((t, i) => el('option', { value: i }, t.label))); list.onchange = () => { cur = tracks[+list.value]; draw(); };
  const g = cv.getContext('2d'); const PAD = 36;
  const range = () => { const ks = cur.obj[cur.key].kf; let lo = Math.min(...ks.map((k) => k.v)), hi = Math.max(...ks.map((k) => k.v)); if (hi - lo < 1e-6) { lo -= 1; hi += 1; } const m = (hi - lo) * 0.15; return [lo - m, hi + m]; };
  const tx = (t) => PAD + (t / c.dur) * (cv.width - PAD * 2), vy = (v, [lo, hi]) => cv.height - PAD - ((v - lo) / (hi - lo)) * (cv.height - PAD * 2);
  const xt = (x) => clamp(((x - PAD) / (cv.width - PAD * 2)) * c.dur, 0, c.dur), yv = (y, [lo, hi]) => lo + ((cv.height - PAD - y) / (cv.height - PAD * 2)) * (hi - lo);
  let sel = -1;
  function draw() {
    const p = cur.obj[cur.key]; if (!isKf(p)) return; const rg = range();
    g.fillStyle = '#0b0c10'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#1c2029'; g.fillStyle = '#5d6577'; g.font = '10px Consolas';
    for (let i = 0; i <= 10; i++) { const x = PAD + (i / 10) * (cv.width - PAD * 2); g.beginPath(); g.moveTo(x, PAD); g.lineTo(x, cv.height - PAD); g.stroke(); g.fillText((c.dur * i / 10).toFixed(2) + 's', x - 12, cv.height - 14); }
    for (let i = 0; i <= 4; i++) { const v = rg[0] + (rg[1] - rg[0]) * i / 4; const y = vy(v, rg); g.beginPath(); g.moveTo(PAD, y); g.lineTo(cv.width - PAD, y); g.stroke(); g.fillText(v.toFixed(2), 2, y + 3); }
    const ph = tx(clamp(store.time - c.start, 0, c.dur)); g.fillStyle = '#ff5470'; g.fillRect(ph, PAD, 1, cv.height - PAD * 2);
    g.strokeStyle = '#ffb547'; g.lineWidth = 2; g.beginPath();
    for (let x = PAD; x <= cv.width - PAD; x += 2) { const v = evalParam(p, xt(x)); const y = vy(v, rg); x === PAD ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
    p.kf.forEach((k, i) => { const x = tx(k.t), y = vy(k.v, rg); g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = i === sel ? '#fff' : '#ffb547'; g.fillRect(-5, -5, 10, 10); g.restore(); g.fillStyle = '#8a92a4'; g.fillText(k.e || 'linear', x + 8, y - 8); });
  }
  const hit = (x, y) => { const p = cur.obj[cur.key]; const rg = range(); return p.kf.findIndex((k) => Math.hypot(tx(k.t) - x, vy(k.v, rg) - y) < 9); };
  cv.addEventListener('mousedown', (e) => {
    const b = cv.getBoundingClientRect(); const x = (e.clientX - b.left) * cv.width / b.width, y = (e.clientY - b.top) * cv.height / b.height;
    const i = hit(x, y); sel = i;
    if (e.button === 2 && i >= 0) { e.preventDefault(); contextMenu(e.clientX, e.clientY, [...EASING_NAMES.map((n) => ({ label: L('Kurve: ', 'Easing: ') + n, check: (cur.obj[cur.key].kf[i].e || 'linear') === n, action: () => { store.edit('Easing', () => { cur.obj[cur.key].kf[i].e = n; }); draw(); } })), '-', { label: L('Keyframe löschen', 'Delete keyframe'), disabled: cur.obj[cur.key].kf.length < 2, action: () => { store.edit('Keyframe', () => { cur.obj[cur.key].kf.splice(i, 1); }); draw(); } }]); return; }
    if (i < 0) return;
    const rg = range(); store.begin('Keyframe ziehen');
    const mv = (ev) => { const xx = (ev.clientX - b.left) * cv.width / b.width, yy = (ev.clientY - b.top) * cv.height / b.height; const k = cur.obj[cur.key].kf[i]; k.t = Math.round(xt(xx) * store.fps) / store.fps; k.v = +yv(yy, rg).toFixed(4); if (ev.shiftKey) k.v = Math.round(k.v); store.touch(); draw(); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); cur.obj[cur.key].kf.sort((a, b2) => a.t - b2.t); store.end(); draw(); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); draw();
  });
  cv.addEventListener('dblclick', (e) => { const b = cv.getBoundingClientRect(); const x = (e.clientX - b.left) * cv.width / b.width, y = (e.clientY - b.top) * cv.height / b.height; const rg = range(); store.edit('Keyframe', () => { cur.obj[cur.key] = setKeyframe(cur.obj[cur.key], xt(x), +yv(y, rg).toFixed(4)); }); draw(); });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  const off = bus.on('time', draw);
  modal({ title: L('Keyframe-Graph-Editor – ', 'Keyframe graph editor – ') + (c.name || c.type), width: 920, onClose: () => off(),
    body: el('div', {}, el('div', { class: 'row' }, el('label', {}, L('Parameter', 'Parameter')), list, el('span', { class: 'muted' }, L('Ziehen = Zeit/Wert · Doppelklick = Keyframe · Rechtsklick = Kurve/Löschen · Shift = runden', 'Drag = time/value · double-click = add · right-click = easing/delete'))), cv),
    buttons: [{ label: 'OK', cls: 'primary' }] });
  draw();
}

registerCommands([
  { id: 'graphEditor', name: { de: 'Keyframe-Graph-Editor', en: 'Keyframe graph editor' }, cat: 'clip', key: 'Shift+K', run: () => graphEditor() },
]);
