// Right panel: context-sensitive inspector (video, text, effects, color, speed, audio, AI/tracking,
// transition, project settings).
import { store, clipEnd, setClipRamp, setClipSpeed, sourceLength, avgSpeed, setTransitionOverlap } from '../core/project.js';
import { bus, el, $, deepClone, uid, tc } from '../core/util.js';
import { L, N } from '../core/i18n.js';
import { settings } from '../core/settings.js';
import { EFFECTS, EFFECT_CATS, defaultParams } from '../render/effects.js';
import { TRANSITIONS, DIRS } from '../render/transitions.js';
import { TEXT_ANIMS_IN, TEXT_ANIMS_OUT, TEXT_LOOPS, CAPTION_STYLES } from '../render/text.js';
import { BLEND_MODES } from '../render/compositor.js';
import { numberProp, selectProp, colorProp, boolProp, section, curvesEditor, colorWheel, rampEditor, liveEdit, liveCommit, updaters } from './widgets.js';
import { run } from '../core/commands.js';
import { BUILTIN_PRESETS, VELOCITY_PRESETS } from './presets.js';
import { contextMenu, toast } from './dialogs.js';
import { fixOverlaps, setOrientation } from './actions.js';
import { shapePanel, fxExtras } from './gfxui.js';
const { ipcRenderer } = require('electron');

let tab = 'video';
const TABS = {
  video: { de: 'Video', en: 'Video' }, text: { de: 'Text', en: 'Text' }, effects: { de: 'Effekte', en: 'Effects' }, color: { de: 'Farbe', en: 'Color' },
  speed: { de: 'Tempo', en: 'Speed' }, shape: { de: 'Form', en: 'Shape' }, camera: { de: '3D-Kamera', en: '3D camera' }, audio: { de: 'Audio', en: 'Audio' }, ai: { de: 'KI / Tracking', en: 'AI / Tracking' },
};

export function initInspector() {
  bus.on('selection', render);
  bus.on('changed', (label) => { if (label === 'live') return; render(); });
  bus.on('time', () => updaters.forEach((f) => f()));
  bus.on('inspect', (id, t) => { if (t) tab = t; if (id && !store.selection.has(id)) store.select([id]); else render(); });
  bus.on('lang', render);
  render();
}

function tabsFor(c) {
  if (!c) return [];
  if (c.type === 'audio') return ['audio', 'speed', 'ai'];
  if (c.type === 'text') return ['text', 'video', 'effects', 'color'];
  if (c.type === 'adjust') return ['effects', 'color', 'video'];
  if (c.type === 'solid') return ['video', 'effects', 'color'];
  if (c.type === 'shape') return ['shape', 'video', 'effects', 'color'];
  if (c.type === 'camera') return ['camera'];
  if (c.type === 'compound' || c.type === 'multicam') return ['video', 'effects', 'color', 'speed'];
  const t = ['video', 'effects', 'color', 'speed'];
  if (store.linked(c).some((l) => l.type === 'audio')) t.push('audio');
  t.push('ai');
  return t;
}

export function render() {
  liveCommit();
  updaters.clear();
  const host = $('#inspector'); const tabsEl = $('#right-tabs');
  host.innerHTML = ''; tabsEl.innerHTML = '';
  if (store.selTransition) { tabsEl.appendChild(el('button', { class: 'active' }, L('Übergang', 'Transition'))); host.appendChild(transitionPanel()); return; }
  const c = store.primaryClip();
  if (!c) { tabsEl.appendChild(el('button', { class: 'active' }, L('Projekt', 'Project'))); host.appendChild(projectPanel()); return; }
  const tabs = tabsFor(c);
  if (!tabs.includes(tab)) tab = tabs[0];
  for (const t of tabs) tabsEl.appendChild(el('button', { class: t === tab ? 'active' : '', onclick: () => { tab = t; render(); } }, N(TABS[t])));
  const lt = () => Math.max(0, Math.min(c.dur, store.time - c.start));
  host.appendChild(el('div', { style: { padding: '8px 10px 2px', display: 'flex', gap: '6px', alignItems: 'center' } },
    el('b', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.name || c.type),
    el('span', { class: 'muted', style: { fontSize: '11px' } }, tc(c.dur, store.fps)),
    store.selection.size > 1 ? el('span', { class: 'chip' }, store.selection.size + ' ' + L('ausgewählt', 'selected')) : null));
  const panel = { camera: cameraPanel, shape: shapePanel, video: videoPanel, text: textPanel, effects: effectsPanel, color: colorPanel, speed: speedPanel, audio: audioPanel, ai: aiPanel }[tab];
  host.appendChild(panel(c, lt));
}

// ------------------------------------------------------------------ project
function projectPanel() {
  const P = store.p, S = P.settings;
  const w = el('input', { type: 'number', value: S.width, min: 16, max: 8192, step: 2 }), h = el('input', { type: 'number', value: S.height, min: 16, max: 8192, step: 2 });
  const fps = el('select', {}, ...[23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120].map((f) => el('option', { value: f }, f + ' fps'))); fps.value = S.fps;
  const bg = el('input', { type: 'color', value: S.bg });
  const apply = () => store.edit('Projekteinstellungen', (p) => { p.settings.width = Math.round(+w.value / 2) * 2; p.settings.height = Math.round(+h.value / 2) * 2; p.settings.fps = +fps.value; p.settings.bg = bg.value; });
  [w, h, fps, bg].forEach((x) => x.addEventListener('change', apply));
  const ORI = [['h', L('Horizontal 16:9', 'Landscape 16:9'), 1920, 1080], ['v', L('Vertikal 9:16 (TikTok)', 'Vertical 9:16 (TikTok)'), 1080, 1920], ['s', L('Quadrat 1:1', 'Square 1:1'), 1080, 1080], ['p', '4:5', 1080, 1350], ['c', '21:9', 2520, 1080]];
  const cur = S.width / S.height;
  const presets = el('div', {}, el('div', { class: 'chips' }, ...ORI.map(([k, n, a, b]) =>
    el('span', { class: 'chip' + (Math.abs(cur - a / b) < 0.01 ? ' on' : ''), onclick: () => setOrientation(k) }, n))),
    el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '6px' } }, L('Nur das Seitenverhältnis zählt – exportieren kannst du trotzdem in 720p, 4K oder 8K.', 'Only the aspect ratio matters – you can still export in 720p, 4K or 8K.')));
  const stats = el('div', { class: 'muted', style: { lineHeight: '1.8' } },
    el('div', {}, L('Clips: ', 'Clips: ') + P.clips.length + ' · ' + L('Medien: ', 'Media: ') + P.media.length + ' · ' + L('Spuren: ', 'Tracks: ') + P.tracks.length),
    el('div', {}, L('Dauer: ', 'Duration: ') + tc(store.duration(), S.fps)),
    el('div', {}, L('Übergänge: ', 'Transitions: ') + P.transitions.length + ' · Marker: ' + P.markers.length));
  const name = el('input', { type: 'text', value: P.name, style: { width: '100%' } });
  name.onchange = () => store.edit('Name', (p) => { p.name = name.value; });
  return el('div', {},
    section(L('Projekt', 'Project'), [el('div', { class: 'form', style: { gridTemplateColumns: '90px 1fr' } },
      el('label', {}, 'Name'), name,
      el('label', {}, L('Auflösung', 'Resolution')), el('div', { class: 'row', style: { margin: 0 } }, w, '×', h),
      el('label', {}, 'Framerate'), fps,
      el('label', {}, L('Hintergrund', 'Background')), bg), el('div', { style: { marginTop: '8px' } }, presets)]),
    section(L('Statistik', 'Stats'), stats),
    section(L('Tipp', 'Tip'), el('div', { class: 'muted', style: { lineHeight: '1.6' } }, L('Medien per Drag & Drop in die Medien-Bibliothek oder direkt in die Timeline ziehen. Clip auswählen → Eigenschaften erscheinen hier. Alle Werte mit ◆ sind per Keyframe animierbar.', 'Drag media into the library or straight onto the timeline. Select a clip to edit it here. Every ◆ value can be keyframed.'))));
}

// ------------------------------------------------------------------ transition
function transitionPanel() {
  const tr = store.p.transitions.find((t) => t.id === store.selTransition); if (!tr) return el('div');
  const d = TRANSITIONS[tr.type];
  const opts = Object.values(TRANSITIONS).map((x) => [x.id, N(x.name)]);
  const durObj = { v: tr.dur }, intObj = { v: tr.params?.intensity ?? 1 };
  return el('div', {}, section(L('Übergang', 'Transition'), [
    selectProp({ label: L('Typ', 'Type'), value: tr.type, options: opts, onChange: (v) => store.edit('Übergang', () => { tr.type = v; }) }),
    (() => { const a = store.clip(tr.a), b = store.clip(tr.b); const mx = Math.max(0.1, Math.min(a.dur, b.dur) - 1 / store.fps);
      return el('div', {}, numberProp({ label: L('Länge (s)', 'Length (s)'), obj: durObj, key: 'v', min: 2 / store.fps, max: Math.min(30, mx), step: 0.01, keyframes: false, ltFn: () => 0, onChange: (v) => { if (tr.overlap) setTransitionOverlap(store.p, tr, v); else tr.dur = Math.min(v, a.dur, b.dur); } }),
        el('div', { class: 'chips' }, ...[0.25, 0.5, 1, 2, 3, 5, 10].map((v) => el('span', { class: 'chip' + (Math.abs(tr.dur - v) < 0.01 ? ' on' : '') + (v > mx ? ' dis' : ''), onclick: () => run('setTransitionDur', { id: tr.id, dur: v }) }, v + ' s'))),
        el('div', { class: 'muted', style: { fontSize: '11px' } }, L(`Max. ${mx.toFixed(2)} s (kürzester der beiden Clips). Ränder des Übergangs in der Timeline ziehen ändert die Länge ebenfalls.`, `Max ${mx.toFixed(2)} s. Dragging the transition edges in the timeline also changes the length.`))); })(),
    numberProp({ label: L('Intensität', 'Intensity'), obj: intObj, key: 'v', min: 0, max: 2, step: 0.01, keyframes: false, ltFn: () => 0, onChange: (v) => { tr.params ||= {}; tr.params.intensity = v; } }),
    d?.dir ? selectProp({ label: L('Richtung', 'Direction'), value: tr.params?.dir ?? 0, options: DIRS[settings.lang] || DIRS.de, onChange: (v) => store.edit('Richtung', () => { tr.params ||= {}; tr.params.dir = v; }) }) : null,
    el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => run('transitionsAll', { type: tr.type, dur: tr.dur }) }, L('Auf alle Schnitte anwenden', 'Apply to all cuts')),
      el('button', { class: 'btn small danger', onclick: () => run('delete') }, L('Löschen', 'Delete'))),
  ]));
}

// ------------------------------------------------------------------ video / transform
function videoPanel(c, lt) {
  const T = c.transform;
  const P = store.p.settings;
  const tp = (label, key, min, max, step, cls) => numberProp({ label, obj: T, key, min, max, step, ltFn: lt, cls });
  const blend = selectProp({ label: L('Mischmodus', 'Blend mode'), value: c.blend, options: BLEND_MODES.map((b) => [b, b]), onChange: (v) => store.edit('Blend', () => { c.blend = v; }), cls: 'adv' });
  const flips = el('div', { class: 'row' },
    el('button', { class: 'btn small' + (T.flipH ? ' primary' : ''), onclick: () => store.edit('Spiegeln', () => { T.flipH = !T.flipH; }) }, '⇋ ' + L('Horizontal', 'Horizontal')),
    el('button', { class: 'btn small' + (T.flipV ? ' primary' : ''), onclick: () => store.edit('Spiegeln', () => { T.flipV = !T.flipV; }) }, '⇵ ' + L('Vertikal', 'Vertical')),
    el('button', { class: 'btn small', onclick: () => run('fillFrame') }, L('Füllen', 'Fill')),
    el('button', { class: 'btn small', onclick: () => run('fitFrame') }, L('Einpassen', 'Fit')),
    el('button', { class: 'btn small', onclick: () => run('resetTransform') }, 'Reset'));
  const fades = el('div', {},
    numberProp({ label: L('Einblenden (s)', 'Fade in (s)'), obj: c, key: 'fadeIn', min: 0, max: Math.min(5, c.dur), step: 0.01, keyframes: false, ltFn: lt }),
    numberProp({ label: L('Ausblenden (s)', 'Fade out (s)'), obj: c, key: 'fadeOut', min: 0, max: Math.min(5, c.dur), step: 0.01, keyframes: false, ltFn: lt }));
  const out = el('div', {},
    section(L('Transformation', 'Transform'), [
      tp(L('Position X', 'Position X'), 'x', -P.width, P.width, 1), tp(L('Position Y', 'Position Y'), 'y', -P.height, P.height, 1),
      tp(L('Skalierung', 'Scale'), 'scale', 0.01, 5, 0.001), tp(L('Breite ×', 'Width ×'), 'scaleX', 0.01, 5, 0.001, 'adv'), tp(L('Höhe ×', 'Height ×'), 'scaleY', 0.01, 5, 0.001, 'adv'),
      tp(L('Rotation', 'Rotation'), 'rotation', -360, 360, 0.1), tp(L('Deckkraft', 'Opacity'), 'opacity', 0, 1, 0.01), blend, flips]),
    section('🧊 ' + L('3D (wie After Effects)', '3D (like After Effects)'), [
      boolProp({ label: L('3D-Ebene (Kamera wirkt)', '3D layer (camera applies)'), value: c.layer3d, onChange: (v) => store.edit('3D-Ebene', () => { c.layer3d = v; }) }),
      tp(L('Tiefe Z (näher +)', 'Depth Z (closer +)'), 'z', -3000, 1500, 1), tp(L('Rotation X', 'Rotate X'), 'rotX', -180, 180, 0.1), tp(L('Rotation Y', 'Rotate Y'), 'rotY', -180, 180, 0.1), tp(L('Perspektive', 'Perspective'), 'perspective', 0.3, 5, 0.01),
      el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => run('addCamera') }, '🎥 ' + L('3D-Kamera hinzufügen', 'Add 3D camera')), el('button', { class: 'btn small', onclick: () => run('parallaxLayers') }, '⧉ ' + L('Auswahl als Parallax-Ebenen', 'Selection as parallax layers')))], { open: !!c.layer3d }),
    section(L('Zuschneiden', 'Crop'), [tp(L('Links', 'Left'), 'cropL', 0, 1, 0.001), tp(L('Rechts', 'Right'), 'cropR', 0, 1, 0.001), tp(L('Oben', 'Top'), 'cropT', 0, 1, 0.001), tp(L('Unten', 'Bottom'), 'cropB', 0, 1, 0.001)], { open: false }),
    section(L('Überblendungen', 'Fades'), fades, { open: true }),
    section(L('Start- & End-Übergang', 'Intro & outro transition'), edgeTr(c), { open: true }),
  );
  if (c.type === 'solid') out.prepend(section(L('Farbfläche', 'Color matte'), [
    colorProp({ label: L('Farbe', 'Color'), obj: c.solid, key: 'color', ltFn: lt }),
    el('div', { class: 'prop wide' }, el('label', {}, L('Verlauf bis', 'Gradient to')), el('div', { class: 'row', style: { margin: 0 } },
      (() => { const i = el('input', { type: 'color', value: c.solid.gradient || '#000000' }); i.onchange = () => store.edit('Verlauf', () => { c.solid.gradient = i.value; }); return i; })(),
      el('button', { class: 'btn small', onclick: () => store.edit('Verlauf', () => { c.solid.gradient = ''; }) }, L('aus', 'off'))), el('span'))]));
  return out;
}

function edgeTr(c) {
  const opts = [['none', L('— keiner —', '— none —')], ...Object.values(TRANSITIONS).map((x) => [x.id, N(x.name)])];
  const row = (edge, label) => {
    const cur = edge === 'in' ? c.tIn : c.tOut;
    const o = { v: cur?.dur ?? 0.5, i: cur?.params?.intensity ?? 1 };
    const set = (fn) => store.edit('Clip-Übergang', () => { const t = (edge === 'in' ? c.tIn : c.tOut); if (t) fn(t); });
    return el('div', {},
      selectProp({ label, value: cur?.type || 'none', options: opts, onChange: (v) => run('setClipTransition', { edge, type: v, dur: o.v, clipIds: [c.id] }) }),
      cur ? numberProp({ label: L('Dauer (s)', 'Duration (s)'), obj: o, key: 'v', min: 0.05, max: Math.min(5, c.dur), step: 0.01, keyframes: false, ltFn: () => 0, onChange: (v) => { const t = edge === 'in' ? c.tIn : c.tOut; if (t) t.dur = v; } }) : null,
      cur ? numberProp({ label: L('Intensität', 'Intensity'), obj: o, key: 'i', min: 0, max: 2, step: 0.01, keyframes: false, ltFn: () => 0, onChange: (v) => { const t = edge === 'in' ? c.tIn : c.tOut; if (t) { t.params ||= {}; t.params.intensity = v; } } }) : null,
      cur && TRANSITIONS[cur.type]?.dir ? selectProp({ label: L('Richtung', 'Direction'), value: cur.params?.dir ?? 0, options: DIRS[settings.lang] || DIRS.de, onChange: (v) => set((t) => { t.params ||= {}; t.params.dir = v; }) }) : null);
  };
  return [row('in', L('Start (Eingang)', 'Intro (in)')), row('out', L('Ende (Ausgang)', 'Outro (out)')),
    el('div', { class: 'chips' }, ...[['dipblack', L('Schwarz', 'Black')], ['dissolve', 'Fade'], ['zoomin', 'Zoom'], ['glitch', 'Glitch'], ['flash', 'Flash'], ['whippan', 'Whip'], ['shape_in_circle', L('Kreis', 'Circle')]].map(([id, nm]) =>
      el('span', { class: 'chip', onclick: () => run('setClipTransition', { edge: 'both', type: id, clipIds: [c.id] }) }, nm + ' ⇄')))];
}

function cameraPanel(c, lt) {
  c.cam ||= {};
  for (const [k, v] of Object.entries({ x: 0, y: 0, dolly: 0, rx: 0, ry: 0, rz: 0, persp: 1.6 })) if (c.cam[k] === undefined) c.cam[k] = v;
  const cp = (label, key, min, max, step) => numberProp({ label, obj: c.cam, key, min, max, step, ltFn: lt });
  return el('div', {},
    section('🎥 ' + L('3D-Kamera', '3D camera'), [
      el('div', { class: 'muted', style: { fontSize: '11px', marginBottom: '6px' } }, L('Wirkt auf alle Clips mit „3D-Ebene“ (Inspector → Video → 3D). Jeder Wert ist per ◆ animierbar.', 'Affects every clip with "3D layer" enabled. Every value can be keyframed with ◆.')),
      cp(L('Position X', 'Position X'), 'x', -3000, 3000, 1), cp(L('Position Y', 'Position Y'), 'y', -3000, 3000, 1), cp(L('Dolly (vor/zurück)', 'Dolly (in/out)'), 'dolly', -3000, 1500, 1),
      cp(L('Schwenk (Y)', 'Pan (Y)'), 'ry', -90, 90, 0.1), cp(L('Neigen (X)', 'Tilt (X)'), 'rx', -90, 90, 0.1), cp(L('Rollen (Z)', 'Roll (Z)'), 'rz', -180, 180, 0.1), cp(L('Brennweite/Perspektive', 'Lens / perspective'), 'persp', 0.4, 5, 0.01)]),
    section(L('Kamerafahrten (Presets)', 'Camera moves (presets)'), el('div', { class: 'chips' }, ...[['orbit', L('Orbit', 'Orbit')], ['dollyIn', L('Ranfahren', 'Dolly in')], ['dollyOut', L('Wegfahren', 'Dolly out')], ['crane', L('Kranfahrt', 'Crane')], ['panLR', L('Schwenk L→R', 'Pan L→R')], ['tiltDown', L('Neigen', 'Tilt down')], ['vertigo', 'Vertigo'], ['roll', L('Rollen', 'Roll')]].map(([k, nm]) => el('span', { class: 'chip', onclick: () => run('cameraPreset', { preset: k, id: c.id }) }, nm)))));
}

// ------------------------------------------------------------------ text
function textPanel(c, lt) {
  const t = c.text;
  const ta = el('textarea', { rows: 3 }); ta.value = t.content;
  ta.addEventListener('input', () => liveEdit('Text', () => { t.content = ta.value; c.name = ta.value.slice(0, 30); }));
  ta.addEventListener('change', liveCommit);
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  const fonts = ['Bahnschrift', 'Arial', 'Arial Black', 'Impact', 'Segoe UI', 'Segoe UI Black', 'Georgia', 'Times New Roman', 'Consolas', 'Courier New', 'Verdana', 'Trebuchet MS', 'Comic Sans MS', 'Franklin Gothic Medium', 'Gabriola', 'Palatino Linotype', 'Lucida Console', 'Tahoma', 'Candara', 'Corbel', 'Ink Free', ...(window.__customFonts || [])];
  const set = (k) => (v) => store.edit('Text', () => { t[k] = v; });
  const fontRow = el('div', { class: 'row' },
    el('button', { class: 'btn small', onclick: async () => {
      const r = await ipcRenderer.invoke('dialog:open', { filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }], properties: ['openFile', 'multiSelections'] });
      if (r.canceled) return; const { loadFontFile } = await import('./library.js'); for (const f of r.filePaths) { const n = await loadFontFile(f); store.edit('Schrift', () => { t.font = n; }); }
    } }, L('Schrift importieren…', 'Import font…')));
  return el('div', {},
    section(L('Inhalt', 'Content'), [ta]),
    t.words?.length ? section('💬 ' + L('Untertitel-Animation', 'Caption animation'), [
      selectProp({ label: L('Wort-Effekt', 'Word effect'), value: t.cap || 'none', options: Object.entries(CAPTION_STYLES).map(([k, v]) => [k, N(v)]), onChange: set('cap') }),
      colorProp({ label: L('Highlight-Farbe', 'Highlight colour'), obj: t, key: 'hiColor', ltFn: lt }),
      colorProp({ label: L('Box-Farbe', 'Box colour'), obj: t, key: 'hiBg', ltFn: lt }),
      c.caption ? el('div', { class: 'muted', style: { fontSize: '11px', margin: '6px 0 2px' } }, L('Stil für ALLE Untertitel:', 'Style for ALL captions:')) : null,
      c.caption ? el('div', { class: 'chips' }, ...(window.__capPresets || []).map((p) => el('span', { class: 'chip' + (c.caption.preset === p.id ? ' on' : ''), onclick: () => run('captionStyle', { preset: p.id }) }, p.name))) : null,
      c.caption ? el('div', { class: 'chips' }, ...[['bottom', L('Unten', 'Bottom')], ['center', L('Mitte', 'Center')], ['top', L('Oben', 'Top')]].map(([k, n]) => el('span', { class: 'chip' + (c.caption.pos === k ? ' on' : ''), onclick: () => run('captionStyle', { pos: k }) }, '⇕ ' + n))) : null]) : null,
    section(L('Schrift', 'Font'), [
      selectProp({ label: L('Schriftart', 'Font'), value: t.font, options: [...new Set([t.font, ...fonts])].map((f) => [f, f]), onChange: set('font') }), fontRow,
      numberProp({ label: L('Größe', 'Size'), obj: t, key: 'size', min: 8, max: 600, step: 1, keyframes: false, ltFn: lt }),
      selectProp({ label: L('Stärke', 'Weight'), value: t.weight, options: [100, 300, 400, 500, 600, 700, 800, 900].map((w) => [w, String(w)]), onChange: set('weight') }),
      selectProp({ label: L('Ausrichtung', 'Align'), value: t.align, options: [['left', L('Links', 'Left')], ['center', L('Mitte', 'Center')], ['right', L('Rechts', 'Right')]], onChange: set('align') }),
      numberProp({ label: L('Zeichenabstand', 'Tracking'), obj: t, key: 'letter', min: -20, max: 100, step: 0.5, keyframes: false, ltFn: lt }),
      numberProp({ label: L('Zeilenhöhe', 'Line height'), obj: t, key: 'lineHeight', min: 0.6, max: 3, step: 0.01, keyframes: false, ltFn: lt }),
      numberProp({ label: L('Textbox-Breite', 'Box width'), obj: t, key: 'boxW', min: 0.1, max: 1, step: 0.01, keyframes: false, ltFn: lt }),
      boolProp({ label: L('Großbuchstaben', 'Uppercase'), value: t.upper, onChange: set('upper') }),
      boolProp({ label: L('Kursiv', 'Italic'), value: t.italic, onChange: set('italic') })]),
    section(L('Farbe & Stil', 'Color & style'), [
      colorProp({ label: L('Farbe', 'Color'), obj: t, key: 'color', ltFn: lt }),
      el('div', { class: 'prop wide' }, el('label', {}, L('Verlauf', 'Gradient')), el('div', { class: 'row', style: { margin: 0 } },
        (() => { const i = el('input', { type: 'color', value: t.color2 || '#22d3ee' }); i.oninput = () => liveEdit('Verlauf', () => { t.color2 = i.value; }); i.onchange = liveCommit; return i; })(),
        el('button', { class: 'btn small', onclick: () => store.edit('Verlauf', () => { t.color2 = ''; }) }, L('aus', 'off'))), el('span')),
      numberProp({ label: L('Verlaufswinkel', 'Gradient angle'), obj: t, key: 'gradAngle', min: 0, max: 360, step: 1, keyframes: false, ltFn: lt }),
      numberProp({ label: L('Kontur', 'Stroke'), obj: t, key: 'stroke', min: 0, max: 30, step: 0.5, keyframes: false, ltFn: lt }),
      colorProp({ label: L('Konturfarbe', 'Stroke color'), obj: t, key: 'strokeColor', ltFn: lt }),
      numberProp({ label: L('Schatten', 'Shadow'), obj: t, key: 'shadow', min: 0, max: 2, step: 0.01, keyframes: false, ltFn: lt }),
      numberProp({ label: 'Glow', obj: t, key: 'glow', min: 0, max: 120, step: 1, keyframes: false, ltFn: lt }),
      colorProp({ label: L('Glow-Farbe', 'Glow color'), obj: t, key: 'glowColor', ltFn: lt }),
      numberProp({ label: L('3D-Tiefe', '3D depth'), obj: t, key: 'extrude', min: 0, max: 60, step: 1, keyframes: false, ltFn: lt }),
      colorProp({ label: L('3D-Farbe', '3D color'), obj: t, key: 'extrudeColor', ltFn: lt }),
      el('div', { class: 'prop wide' }, el('label', {}, L('Hintergrund', 'Background')), el('div', { class: 'row', style: { margin: 0 } },
        (() => { const i = el('input', { type: 'color', value: t.bg || '#000000' }); i.oninput = () => liveEdit('BG', () => { t.bg = i.value; }); i.onchange = liveCommit; return i; })(),
        el('button', { class: 'btn small', onclick: () => store.edit('BG', () => { t.bg = ''; }) }, L('aus', 'off'))), el('span')),
      numberProp({ label: L('BG Abstand', 'BG padding'), obj: t, key: 'bgPad', min: 0, max: 100, step: 1, keyframes: false, ltFn: lt }),
      numberProp({ label: L('BG Rundung', 'BG radius'), obj: t, key: 'bgRadius', min: 0, max: 100, step: 1, keyframes: false, ltFn: lt })]),
    section(L('Animation', 'Animation'), [
      selectProp({ label: L('Eingang', 'In'), value: t.anim, options: Object.entries(TEXT_ANIMS_IN).map(([k, v]) => [k, N(v)]), onChange: set('anim') }),
      selectProp({ label: L('Ausgang', 'Out'), value: t.animOut, options: Object.entries(TEXT_ANIMS_OUT).map(([k, v]) => [k, N(v)]), onChange: set('animOut') }),
      selectProp({ label: L('Schleife', 'Loop'), value: t.loop || 'none', options: Object.entries(TEXT_LOOPS).map(([k, v]) => [k, N(v)]), onChange: set('loop') }),
      numberProp({ label: L('Dauer (s)', 'Duration (s)'), obj: t, key: 'animDur', min: 0.05, max: 5, step: 0.01, keyframes: false, ltFn: lt })]),
    section(L('Stil-Presets', 'Style presets'), el('div', { class: 'chips' }, ...BUILTIN_PRESETS.filter((p) => p.kind === 'text').map((p) => el('span', { class: 'chip', onclick: () => run('applyPreset', { id: p.id }) }, p.name)))),
  );
}

// ------------------------------------------------------------------ effects stack
function effectsPanel(c, lt) {
  const wrap = el('div', { style: { padding: '0 10px' } });
  const add = el('button', { class: 'btn small primary', onclick: (e) => {
    const cats = {};
    for (const d of Object.values(EFFECTS)) (cats[d.cat] ||= []).push(d);
    contextMenu(e.clientX, e.clientY, Object.entries(cats).map(([k, list]) => ({ label: N(EFFECT_CATS[k]) || k, sub: list.map((d) => ({ label: N(d.name), action: () => run('applyEffect', { type: d.id }) })) })));
  } }, '+ ' + L('Effekt hinzufügen', 'Add effect'));
  wrap.appendChild(el('div', { class: 'row', style: { padding: '8px 0' } }, add,
    el('button', { class: 'btn small', onclick: () => run('savePresetFromClip') }, L('Als Preset speichern', 'Save as preset')),
    el('button', { class: 'btn small', onclick: () => run('copyEffects') }, L('Kopieren', 'Copy')),
    el('button', { class: 'btn small', onclick: () => run('pasteEffects') }, L('Einfügen', 'Paste'))));
  if (!c.effects.length) wrap.appendChild(el('div', { class: 'insp-empty' }, L('Keine Effekte. Effekte aus der Bibliothek (links) auf den Clip ziehen oder oben hinzufügen.', 'No effects. Drag effects from the library onto the clip or add one above.')));
  c.effects.forEach((fx, idx) => { if (!fx.fromFilter) wrap.appendChild(effectCard(c, fx, idx, lt)); });
  if (c.filter) wrap.appendChild(el('div', { class: 'muted', style: { padding: '6px 0' } }, '🎞 ' + L('Filter aktiv: ', 'Active filter: ') + (BUILTIN_PRESETS.find((p) => p.id === c.filter)?.name || c.filter) + L(' (im Reiter Farbe änderbar)', ' (change in the Color tab)')));
  return wrap;
}
export function effectCard(c, fx, idx, lt) {
  const d = EFFECTS[fx.type];
  if (!d) return el('div', { class: 'fx-card' }, el('div', { class: 'fx-h' }, '? ' + fx.type));
  const body = el('div', { class: 'fx-b' });
  for (const q of d.params || []) {
    if (fx.params[q.k] === undefined) fx.params[q.k] = deepClone(q.def);
    const label = N({ de: q.de, en: q.en });
    if (q.type === 'range') body.appendChild(numberProp({ label, obj: fx.params, key: q.k, min: q.min, max: q.max, step: q.step, ltFn: lt }));
    else if (q.type === 'color') body.appendChild(colorProp({ label, obj: fx.params, key: q.k, ltFn: lt }));
    else if (q.type === 'bool') body.appendChild(boolProp({ label, value: fx.params[q.k], onChange: (v) => store.edit('Effekt', () => { fx.params[q.k] = v; }) }));
    else if (q.type === 'select') body.appendChild(selectProp({ label, value: fx.params[q.k], options: q.options, onChange: (v) => store.edit('Effekt', () => { fx.params[q.k] = v; }) }));
    else if (q.type === 'path') continue;
    else if (q.type === 'file') body.appendChild(el('div', { class: 'prop wide' }, el('label', {}, label), el('div', { class: 'row', style: { margin: 0, flexWrap: 'nowrap', minWidth: 0 } },
      el('button', { class: 'btn small', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { filters: [{ name: 'LUT', extensions: q.filter || ['*'] }], properties: ['openFile'] }); if (!r.canceled) store.edit('LUT', () => { fx.params[q.k] = r.filePaths[0]; }); } }, L('Wählen…', 'Choose…')),
      el('span', { class: 'muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, fx.params[q.k] ? require('path').basename(fx.params[q.k]) : '—')), el('span')));
  }
  if (d.special === 'curves') body.appendChild(curvesEditor(fx.params, () => {}));
  const extra = fxExtras(c, fx); if (extra) body.appendChild(extra);
  const card = el('div', { class: 'fx-card' + (fx.enabled ? '' : ' off'), draggable: 'true' },
    el('div', { class: 'fx-h' },
      el('input', { type: 'checkbox', checked: fx.enabled, onchange: (e) => store.edit('Effekt an/aus', () => { fx.enabled = e.target.checked; }) }),
      el('span', { style: { flex: 1 } }, N(d.name)),
      el('button', { class: 'icon-btn', title: L('Nach oben', 'Move up'), onclick: () => store.edit('Reihenfolge', () => { if (idx > 0) [c.effects[idx - 1], c.effects[idx]] = [c.effects[idx], c.effects[idx - 1]]; }) }, '↑'),
      el('button', { class: 'icon-btn', title: L('Nach unten', 'Move down'), onclick: () => store.edit('Reihenfolge', () => { if (idx < c.effects.length - 1) [c.effects[idx + 1], c.effects[idx]] = [c.effects[idx], c.effects[idx + 1]]; }) }, '↓'),
      el('button', { class: 'icon-btn', title: 'Reset', onclick: () => store.edit('Reset', () => { fx.params = defaultParams(fx.type); }) }, '⟲'),
      el('button', { class: 'icon-btn', title: L('Duplizieren', 'Duplicate'), onclick: () => store.edit('Effekt', () => { c.effects.splice(idx + 1, 0, { ...deepClone(fx), id: uid('fx') }); }) }, '⧉'),
      el('button', { class: 'icon-btn', title: L('Entfernen', 'Remove'), onclick: () => store.edit('Effekt entfernen', () => { c.effects.splice(idx, 1); }) }, '✕')),
    body);
  return card;
}

// ------------------------------------------------------------------ color
// ONE colour module: filter (one at a time) + basic correction + wheels + curves + HSL + LUT + extra tools.
// Sections work immediately – the underlying effect is created on the first change.
function colorPanel(c, lt) {
  const lazy = (type) => {
    let f = c.effects.find((x) => x.type === type && !x.fromFilter);
    if (f) return f;
    f = { id: uid('fx'), type, enabled: true, params: defaultParams(type), _lazy: true };
    return f;
  };
  const attach = (f) => { if (f._lazy) { delete f._lazy; c.effects.unshift(f); } };
  const prop = (f, key, label, min, max, step) => numberProp({ label, obj: f.params, key, min, max, step, ltFn: lt, onChange: () => attach(f) });
  const wrap = el('div', {});
  // filter row (one active filter, replaces the previous)
  const filters = BUILTIN_PRESETS.filter((p) => ['color', 'realism', 'cinematic'].includes(p.kind));
  wrap.appendChild(section('🎞 ' + L('Filter (immer nur einer aktiv)', 'Filter (one at a time)'), [
    el('div', { class: 'chips' }, el('span', { class: 'chip' + (!c.filter ? ' on' : ''), onclick: () => run('applyFilter', { id: null }) }, L('Ohne', 'None')),
      ...filters.map((p) => el('span', { class: 'chip' + (c.filter === p.id ? ' on' : ''), onclick: () => run('applyFilter', { id: p.id }) }, p.name))),
    c.filter ? numberProp({ label: L('Filter-Stärke', 'Filter strength'), obj: c, key: 'filterAmt', min: 0, max: 1, step: 0.01, keyframes: false, ltFn: lt }) : null]));
  if (c.filterAmt === undefined) c.filterAmt = 1;
  const cc = lazy('color');
  wrap.appendChild(section('☀ ' + L('Grundkorrektur', 'Basic correction'), [
    prop(cc, 'exposure', L('Belichtung', 'Exposure'), -3, 3, 0.01), prop(cc, 'brightness', L('Helligkeit', 'Brightness'), -1, 1, 0.01), prop(cc, 'contrast', L('Kontrast', 'Contrast'), -1, 1, 0.01),
    prop(cc, 'saturation', L('Sättigung', 'Saturation'), -1, 1, 0.01), prop(cc, 'vibrance', L('Dynamik', 'Vibrance'), -1, 1, 0.01),
    prop(cc, 'temperature', L('Temperatur', 'Temperature'), -1, 1, 0.01), prop(cc, 'tint', L('Farbton (Tint)', 'Tint'), -1, 1, 0.01),
    prop(cc, 'highlights', L('Lichter', 'Highlights'), -1, 1, 0.01), prop(cc, 'shadows', L('Schatten', 'Shadows'), -1, 1, 0.01),
    prop(cc, 'whites', L('Weiß', 'Whites'), -1, 1, 0.01), prop(cc, 'blacks', L('Schwarz', 'Blacks'), -1, 1, 0.01), prop(cc, 'hue', L('Farbrotation', 'Hue'), -180, 180, 1),
    prop(cc, 'fade', L('Ausbleichen', 'Fade'), 0, 1, 0.01),
    el('button', { class: 'btn small', onclick: () => store.edit('Farbe zurücksetzen', () => { c.effects = c.effects.filter((f) => f.type !== 'color' || f.fromFilter); }) }, '⟲ ' + L('Zurücksetzen', 'Reset'))]));
  const wh = lazy('wheels');
  wrap.appendChild(section('◎ ' + L('Farbräder', 'Color wheels'), [el('div', { class: 'grid3' },
    colorWheel('Lift', wh.params, 'lift', () => attach(wh)), colorWheel('Gamma', wh.params, 'gammaC', () => attach(wh)), colorWheel('Gain', wh.params, 'gain', () => attach(wh))),
    prop(wh, 'liftL', L('Tiefen hell/dunkel', 'Lift luma'), -0.5, 0.5, 0.01), prop(wh, 'gammaL', L('Mitten hell/dunkel', 'Gamma luma'), -0.5, 0.5, 0.01), prop(wh, 'gainL', L('Lichter hell/dunkel', 'Gain luma'), -0.5, 0.5, 0.01)], { open: false }));
  const cu = lazy('curves');
  wrap.appendChild(section('〰 ' + L('Kurven', 'Curves'), [curvesEditor(cu.params, () => attach(cu))], { open: false }));
  const hs = lazy('hsl');
  wrap.appendChild(section('🎯 ' + L('Einzelne Farbe ändern (HSL)', 'Change one color (HSL)'), [prop(hs, 'target', L('Zielfarbe (Farbton)', 'Target hue'), 0, 360, 1), prop(hs, 'range', L('Bereich', 'Range'), 5, 180, 1),
    prop(hs, 'hueShift', L('Farbton verschieben', 'Hue shift'), -180, 180, 1), prop(hs, 'satAdj', L('Sättigung', 'Saturation'), -1, 1, 0.01), prop(hs, 'lumAdj', L('Helligkeit', 'Lightness'), -1, 1, 0.01)], { open: false }));
  const lut = c.effects.find((x) => x.type === 'lut');
  wrap.appendChild(section('🧊 LUT', lut ? effectCard(c, lut, c.effects.indexOf(lut), lt).querySelector('.fx-b') : el('button', { class: 'btn small', onclick: () => run('applyEffect', { type: 'lut' }) }, '+ ' + L('LUT-Datei (.cube) laden', 'Load LUT (.cube)')), { open: false }));
  const more = el('select', {}, el('option', { value: '' }, L('— weiteres Farb-Werkzeug hinzufügen —', '— add another color tool —')),
    ...Object.values(EFFECTS).filter((d) => d.cat === 'color' && !['color', 'wheels', 'curves', 'hsl', 'lut'].includes(d.id)).map((d) => el('option', { value: d.id }, N(d.name))));
  more.onchange = () => { if (more.value) run('applyEffect', { type: more.value }); };
  const extras = c.effects.filter((f) => EFFECTS[f.type]?.cat === 'color' && !['color', 'wheels', 'curves', 'hsl', 'lut'].includes(f.type) && !f.fromFilter);
  wrap.appendChild(section('➕ ' + L('Weitere Farb-Werkzeuge', 'More color tools'), [more, ...extras.map((f) => effectCard(c, f, c.effects.indexOf(f), lt))], { open: extras.length > 0 }));
  wrap.appendChild(section(L('Scopes', 'Scopes'), el('div', { id: 'scopes' }), { cls: 'adv', open: false }));
  setTimeout(() => import('./scopes.js').then((m) => m.mountScopes($('#scopes'))), 0);
  return wrap;
}

// ------------------------------------------------------------------ speed
function speedPanel(c, lt) {
  const sp = { v: c.speed };
  const info = el('div', { class: 'muted', style: { fontSize: '11px', margin: '4px 0' } }, L(`Quelle: ${sourceLength(c).toFixed(2)}s → Timeline: ${c.dur.toFixed(2)}s (Ø ${avgSpeed(c).toFixed(2)}x)`, `Source: ${sourceLength(c).toFixed(2)}s → Timeline: ${c.dur.toFixed(2)}s (avg ${avgSpeed(c).toFixed(2)}x)`));
  let pending = null;
  const ed = rampEditor(c, (r, commit) => {
    if (!pending) { store.begin('Speed Ramp'); pending = true; }
    setClipRamp(store.p, c, r); store.touch();
    if (commit) { fixOverlaps(store.p, [c]); store.end(); pending = null; }
  });
  return el('div', {},
    section(L('Geschwindigkeit', 'Speed'), [
      numberProp({ label: L('Konstant', 'Constant'), obj: sp, key: 'v', min: 0.05, max: 16, step: 0.01, keyframes: false, ltFn: lt, onChange: (v) => { setClipSpeed(store.p, c, v); } }),
      el('div', { class: 'chips' }, ...[0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10].map((s) => el('span', { class: 'chip' + (c.speed === s && !c.ramp ? ' on' : ''), onclick: () => run('setSpeed', { speed: s }) }, s + 'x'))),
      info,
      el('div', { class: 'row' },
        boolProp({ label: L('Rückwärts', 'Reverse'), value: c.reverse, onChange: () => run('reverse') }),
      ),
      c.type === 'audio' ? boolProp({ label: L('Tonhöhe ändern', 'Change pitch'), value: c.audio?.pitchShift, onChange: (v) => store.edit('Pitch', () => { c.audio.pitchShift = v; }) }) : null,
      el('button', { class: 'btn small', onclick: () => run('freezeFrame') }, '❄ ' + L('Standbild am Playhead', 'Freeze frame at playhead'))]),
    section(L('Speed Ramping / Velocity', 'Speed ramping / velocity'), [
      el('div', { class: 'chips', style: { marginBottom: '6px' } }, ...Object.entries(VELOCITY_PRESETS).map(([k, v]) => el('span', { class: 'chip', onclick: () => run('velocityPreset', { preset: k }) }, v.name)),
        el('span', { class: 'chip', onclick: () => run('velocityPreset', { preset: 'none' }) }, L('Zurücksetzen', 'Reset'))),
      ed.el,
      el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } }, L('Klick: Punkt · Ziehen: Tempo · Shift: einrasten · Rechtsklick: löschen. Clip-Länge passt sich automatisch an.', 'Click: point · Drag: speed · Shift: snap · Right-click: delete. Clip length adapts automatically.')),
      boolProp({ label: 'Motion Blur', value: c.effects.some((f) => f.type === 'motionblur'), onChange: (v) => { if (v) run('applyEffect', { type: 'motionblur' }); else store.edit('Motion Blur', () => { c.effects = c.effects.filter((f) => f.type !== 'motionblur'); }); } })]),
  );
}

// ------------------------------------------------------------------ audio
function audioPanel(c0, lt) {
  const c = c0.type === 'audio' ? c0 : store.linked(c0).find((l) => l.type === 'audio');
  if (!c) return el('div', { class: 'insp-empty' }, L('Kein Audio', 'No audio'));
  const A = c.audio;
  const ltA = () => Math.max(0, store.time - c.start);
  const ae = (k, label, min, max, step) => numberProp({ label, obj: A, key: k, min, max, step, keyframes: false, ltFn: ltA });
  return el('div', {},
    section(L('Lautstärke', 'Volume'), [
      numberProp({ label: L('Lautstärke', 'Volume'), obj: c, key: 'volume', min: 0, max: 3, step: 0.01, ltFn: ltA }),
      ae('gainDb', L('Gain (dB)', 'Gain (dB)'), -24, 24, 0.5), ae('pan', L('Panorama', 'Pan'), -1, 1, 0.01),
      numberProp({ label: L('Einblenden (s)', 'Fade in (s)'), obj: c, key: 'fadeIn', min: 0, max: Math.min(10, c.dur), step: 0.01, keyframes: false, ltFn: ltA }),
      numberProp({ label: L('Ausblenden (s)', 'Fade out (s)'), obj: c, key: 'fadeOut', min: 0, max: Math.min(10, c.dur), step: 0.01, keyframes: false, ltFn: ltA }),
      boolProp({ label: L('Stumm', 'Mute'), value: c.muted, onChange: (v) => store.edit('Stumm', () => { c.muted = v; }) })]),
    section(L('Equalizer', 'Equalizer'), [ae('eqLow', L('Bass (200 Hz)', 'Low (200 Hz)'), -24, 24, 0.5), ae('eqMid', L('Mitten (1,5 kHz)', 'Mid (1.5 kHz)'), -24, 24, 0.5), ae('eqHigh', L('Höhen (6 kHz)', 'High (6 kHz)'), -24, 24, 0.5)]),
    section(L('Verbesserung (KI)', 'Enhance (AI)'), [
      boolProp({ label: L('Stimme verbessern', 'Voice enhance'), value: A.voice, onChange: (v) => store.edit('Voice', () => { A.voice = v; }) }),
      ae('denoise', L('Rauschunterdrückung', 'Noise reduction'), 0, 1, 0.01),
      boolProp({ label: L('Ducking (leiser bei Stimme)', 'Ducking (lower under voice)'), value: A.duck, onChange: (v) => store.edit('Ducking', () => { A.duck = v; }) }),
      el('div', { class: 'muted', style: { fontSize: '11px' } }, L('Ducking: Dieser Clip wird automatisch leiser, solange ein Clip mit „Stimme verbessern“ läuft.', 'Ducking: this clip gets quieter while a clip with "Voice enhance" plays.'))]),
    section(L('Raum', 'Space'), [ae('reverb', L('Hall', 'Reverb'), 0, 1, 0.01), ae('echo', L('Echo', 'Echo'), 0, 1, 0.01)]),
    section(L('Presets', 'Presets'), el('div', { class: 'chips' }, ...BUILTIN_PRESETS.filter((p) => p.kind === 'audio').map((p) => el('span', { class: 'chip', onclick: () => { store.select([c.id]); run('applyPreset', { id: p.id }); } }, p.name)))),
  );
}

// ------------------------------------------------------------------ AI / tracking
function aiPanel(c, lt) {
  const b = (label, cmd, args, cls = '') => el('button', { class: 'btn small block ' + cls, style: { marginBottom: '6px' }, onclick: () => run(cmd, args) }, label);
  const isVid = c.type === 'video' || c.type === 'image';
  return el('div', {},
    isVid ? el('div', { style: { padding: '10px' } }, el('button', { class: 'nr-btn', onclick: () => run('neuralRender') }, el('span', { class: 'dlss-t' }, '✦ Neural Rendering'), el('span', { class: 'dlss-s' }, L('Generative KI – realistischer neu gemalt', 'Generative AI – repainted more realistically'))), el('button', { class: 'dlss-btn', onclick: () => run('dlss5') }, el('span', { class: 'dlss-t' }, '⚡ DLSS5'), el('span', { class: 'dlss-s' }, L('KI-Realismus mit Stärkestufen', 'AI realism with strength levels')))) : null,
    isVid ? section(L('Realismus (GPU)', 'Realism (GPU)'), [
      el('div', { class: 'muted', style: { fontSize: '11px', marginBottom: '6px' } }, L('VELOX Realism rekonstruiert Details, Licht, Tiefe und Farbe auf deiner eigenen Grafikkarte – funktioniert mit jeder GPU (AMD, NVIDIA, Intel).', 'VELOX Realism rebuilds detail, lighting, depth and color on your own GPU – works on any card.')),
      ...BUILTIN_PRESETS.filter((p) => p.kind === 'realism').map((p) => el('button', { class: 'btn small block', style: { marginBottom: '6px' }, onclick: () => run('applyPreset', { id: p.id }) }, '✨ ' + p.name)),
      b('🧠 ' + L('KI-Details neu erfinden', 'AI detail reconstruction'), 'aiDetail'),
      b('🔍 ' + L('KI-Hochskalieren ×2', 'AI upscale ×2'), 'aiUpscale'), b('🔍 ' + L('KI-Hochskalieren ×4', 'AI upscale ×4'), 'aiUpscale4'),
      b('🙂 ' + L('KI-Gesichtsverbesserung', 'AI face restore'), 'aiFaceRestore'),
      b('✂ ' + L('KI-Hintergrund entfernen', 'AI remove background'), 'aiRemoveBg'),
      c.type === 'video' ? b('🐢 ' + L('KI-Zeitlupe ×4 (RIFE)', 'AI slow motion ×4'), 'aiSlowmo') : null,
      c.type === 'video' ? b('〰 ' + L('KI-Flüssig (doppelte FPS)', 'AI smooth (2× fps)'), 'aiSmoothFps') : null]) : null,
    section(L('Analyse & Auto-Schnitt', 'Analysis & auto cut'), [
      c.type !== 'audio' ? b(L('Szenen erkennen & teilen', 'Detect scenes & split'), 'aiSceneDetect') : null,
      b(L('Stille entfernen', 'Remove silence'), 'aiRemoveSilence'),
      b(L('Stimme isolieren (neuronal)', 'Isolate voice (neural)'), 'aiVoiceIsolate'),
      b(L('Beats erkennen → Marker', 'Detect beats → markers'), 'aiBeats'),
      b(L('Highlights finden', 'Find highlights'), 'aiHighlights'),
      b(L('Automatische Untertitel', 'Auto subtitles'), 'aiSubtitles')]),
    isVid ? section(L('Tracking & Stabilisierung', 'Tracking & stabilization'), [
      b('🙈 ' + L('Gesichter automatisch zensieren…', 'Auto-censor faces…'), 'censorFacesDialog'),
      b('▦ ' + L('Objekt zensieren / Tracking-Maske…', 'Censor object / tracked mask…'), 'censorObject'),
      b(L('Objekt verfolgen (Bereich wählen)…', 'Track object (select region)…'), 'aiTrack'),
      b(L('Stabilisieren (vid.stab)', 'Stabilize (vid.stab)'), 'aiStabilize'),
      b(L('Auto-Reframe auf Projektformat', 'Auto reframe to project format'), 'aiReframe')]) : null,
  );
}
