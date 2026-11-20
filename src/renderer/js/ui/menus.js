// Menubar, command palette, keyboard handling, shortcut editor, macros, settings, workspaces, help.
import { commands, run, keyOf, setKey, resetKeys, commandForEvent, comboFromEvent, rebuildKeymap, registerCommands, registerCommand } from '../core/commands.js';
import { el, $, $$, bus, uid } from '../core/util.js';
import { L, N, setLang } from '../core/i18n.js';
import { settings, setSetting, saveSettings, paths } from '../core/settings.js';
import { contextMenu, closeMenu, modal, toast, promptBox } from './dialogs.js';
import { store } from '../core/project.js';
import { EFFECTS } from '../render/effects.js';
import { TRANSITIONS } from '../render/transitions.js';
import { BUILTIN_PRESETS, VELOCITY_PRESETS } from './presets.js';
import { apiInfo } from '../core/api.js';
import { importDialog } from './library.js';
const { ipcRenderer } = require('electron');
const path = require('path');

const item = (id, extra = {}) => { const c = commands.get(id); return c ? { label: N(c.name), key: keyOf(id), action: () => run(id).catch(() => {}), ...extra } : null; };

function menuDefs() {
  return [
    [L('Datei', 'File'), () => [item('home'), item('newProject'), item('openProject'), item('photoMode'), item('photoFromFrame'), { label: L('Zuletzt geöffnet', 'Recent'), sub: settings.recent.length ? settings.recent.map((f) => ({ label: path.basename(f), action: () => run('openProject', { file: f }) })) : [{ label: '—', disabled: true }] }, '-', item('saveProject'), item('saveProjectAs'), item('packageProject'), item('exportProjectJson'), item('importProjectFile'), '-',
      { label: L('Medien importieren…', 'Import media…'), key: keyOf('importMedia'), action: () => importDialog() }, item('importSrt'), item('exportSrt'), '-', item('export'), item('exportStill'), item('exportQueue'), item('brandKits'), '-', item('newSequence'), item('duplicateSequence'), item('verticalVersion'), item('saveTemplate'), item('applyTemplate'), '-', item('openVeloxFolder'), item('openSettings'), { label: L('Beenden', 'Quit'), action: () => ipcRenderer.send('win:close') }]],
    [L('Bearbeiten', 'Edit'), () => [item('undo'), item('redo'), '-', item('cut'), item('copy'), item('paste'), item('duplicate'), item('delete'), item('rippleDelete'), '-', item('selectAll'), item('selectForward'), item('deselect'), '-', item('copyEffects'), item('pasteEffects'), '-', item('closeGaps'), item('liftRange'), item('extractRange')]],
    [L('Clip', 'Clip'), () => [item('split'), item('splitAll'), item('trimStart'), item('trimEnd'), '-',
      { label: L('Geschwindigkeit', 'Speed'), sub: [0.25, 0.5, 1, 2, 4].map((s) => ({ label: s + 'x', action: () => run('setSpeed', { speed: s }).catch(() => {}) })) },
      { label: 'Velocity', sub: Object.entries(VELOCITY_PRESETS).map(([k, v]) => ({ label: v.name, action: () => run('velocityPreset', { preset: k }).catch(() => {}) })) },
      item('reverse'), item('freezeFrame'), '-', item('link'), item('unlink'), item('toggleClipEnabled'), item('fadeInOut'), '-', item('fillFrame'), item('fitFrame'), item('resetTransform'), item('graphEditor'), item('makeCompound'), item('makeMulticam'), { label: L('Bild-im-Bild', 'Picture-in-picture'), sub: ['pip:tl', 'pip:tr', 'pip:bl', 'pip:br', 'pip:c'].map((id) => item(id)) }, item('splitScreen2'), item('snapshotToTimeline'), '-', item('nudgeLeft'), item('nudgeRight'), item('moveUp'), item('moveDown'), item('createProxy')]],
    [L('Timeline', 'Timeline'), () => [item('togglePlay'), item('goStart'), item('goEnd'), item('prevEdit'), item('nextEdit'), '-', item('markIn'), item('markOut'), item('markClip'), item('clearInOut'), item('toggleLoop'), '-', item('renderPreview'), item('toggleRenderCacheAuto'), item('clearRenderCache'), '-', item('addMarker'), item('clearMarkers'), '-', item('addVideoTrack'), item('addAudioTrack'), '-', item('toolSelect'), item('toolRazor'), item('toggleSnap'), item('toggleMagnet'), item('toggleLinkedSel'), '-', item('zoomIn'), item('zoomOut'), item('zoomFit')]],
    [L('Einfügen', 'Insert'), () => [item('addText'), item('addShape'), { label: L('Sticker', 'Sticker'), sub: ['🔥', '💯', '😂', '💥', '⭐', '❤️', '🚨', '🏆'].map((e) => ({ label: e, action: () => run('addSticker', { emoji: e }) })) }, { label: L('Overlay', 'Overlay'), sub: ['rain', 'snowfall', 'fire', 'smoke', 'lightning', 'sparks', 'scratches', 'lightleak', 'bokehoverlay', 'timestamp'].map((t) => ({ label: N(EFFECTS[t]?.name), action: () => run('addOverlay', { type: t }) })) }, item('addParticles'), item('addCamera'), item('parallaxLayers'), item('addSolid'), item('addAdjustment'), item('addTransition'), item('transitionsAll'), '-',
      { label: L('Effekt', 'Effect'), sub: Object.values(EFFECTS).map((d) => ({ label: N(d.name), action: () => run('applyEffect', { type: d.id }).catch(() => {}) })) },
      { label: L('Übergang', 'Transition'), sub: Object.values(TRANSITIONS).map((d) => ({ label: N(d.name), action: () => run('addTransition', { type: d.id }).catch(() => {}) })) }]],
    [L('KI', 'AI'), () => [item('neuralRender'), item('dlss5'), item('autoEditDialog'), '-', item('aiSceneDetect'), item('aiRemoveSilence'), item('aiBeats'), item('aiCutToBeats'), item('aiHighlights'), '-', item('aiSubtitles'), item('aiTTS'), item('aiEnhanceAudio'), '-', item('censorFacesDialog'), item('censorObject'), item('aiTrack'), item('aiStabilize'), item('aiReframe'), item('aiAutoKey'), item('smartCut'), item('colorMatch'), '-', { label: L('Neuronale KI', 'Neural AI'), sub: ['aiDetail', 'aiUpscale', 'aiUpscale4', 'aiFaceRestore', 'aiRemoveBg', 'aiRemoveBgFast', 'aiSlowmo2', 'aiSlowmo', 'aiSlowmo8', 'aiSmoothFps', 'aiVoiceIsolate', 'aiModels'].map((id) => item(id)).filter(Boolean) }, '-',
      { label: 'VELOX Realism', sub: BUILTIN_PRESETS.filter((p) => p.kind === 'realism').map((p) => ({ label: p.name, action: () => run('applyPreset', { id: p.id }).catch(() => {}) })) }, '-', item('showApiInfo')]],
    ['Audio', () => [item('audioMixer'), item('voiceover'), item('tapBeat'), '-', item('aiVoiceIsolate'), item('aiEnhanceAudio'), item('aiRemoveSilence'), item('aiBeats'), item('aiTTS')]],
    [L('Ansicht', 'View'), () => [item('wsEdit'), item('wsColor'), item('wsAudio'), item('wsEffects'), item('wsSimple'), '-', item('modeSimple'), item('modePro'), item('modeExpert'), '-', item('theme'), item('toggleFullscreen'), item('commandPalette'), item('devtools')]],
    [L('Hilfe', 'Help'), () => [item('tutorial'), item('bugReport'), item('checkUpdates'), item('installUpdate'), item('shortcuts'), item('showApiInfo'), item('about')]],
  ];
}

export function initMenus() {
  const bar = $('#menubar');
  const build = () => {
    bar.innerHTML = '';
    for (const [name, fn] of menuDefs()) {
      const top = el('div', { class: 'menu-top' }, name);
      const open = () => { closeMenu(); top.classList.add('open'); const r = top.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, fn().filter((x) => x)); top.classList.add('open'); };
      top.addEventListener('mousedown', (e) => { e.stopPropagation(); if (top.classList.contains('open')) closeMenu(); else open(); });
      top.addEventListener('mouseenter', () => { if ($('.menu-top.open') && !top.classList.contains('open')) open(); });
      bar.appendChild(top);
    }
  };
  build(); bus.on('lang', build); bus.on('keymap', build);
  // workspaces
  const ws = $('#workspaces');
  const buildWs = () => {
    ws.innerHTML = '';
    for (const [id, n] of [['edit', L('Schnitt', 'Edit')], ['color', L('Farbe', 'Color')], ['audio', 'Audio'], ['effects', L('Effekte', 'Effects')], ['simple', L('Einfach', 'Simple')]])
      ws.appendChild(el('button', { class: settings.workspace === id ? 'active' : '', onclick: () => setWorkspace(id) }, n));
  };
  buildWs(); bus.on('lang', buildWs); bus.on('workspace', buildWs);
  // mode select
  const ms = $('#mode-select');
  const buildMode = () => { ms.innerHTML = ''; [['simple', L('Einsteiger', 'Beginner')], ['pro', 'Pro'], ['expert', L('Experte', 'Expert')]].forEach(([v, n]) => ms.appendChild(el('option', { value: v }, n))); ms.value = settings.mode; };
  buildMode(); bus.on('lang', buildMode);
  ms.onchange = () => setMode(ms.value);
  $('#lang-select').value = settings.lang;
  $('#lang-select').onchange = (e) => setLang(e.target.value);
  $$('.win-buttons button').forEach((b) => (b.onclick = () => ipcRenderer.send('win:' + b.dataset.win)));
  $('#btn-export-top').onclick = () => run('export');
  $$('#transport [data-act]').forEach((b) => (b.onclick = () => run(b.dataset.act)));
  // keyboard
  window.addEventListener('keydown', onKey, true);
  rebuildKeymap();
}

function onKey(e) {
  if (window.__photoKey && window.__photoKey(e)) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = (tag === 'input' && !['range', 'checkbox', 'color'].includes(e.target.type)) || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if (typing && !(e.ctrlKey && ['s', 'z', 'y'].includes(e.key.toLowerCase()))) return;
  if ($('.modal-bg') && !e.ctrlKey) return;
  if (e.key === 'Escape' && $('.ctx-menu')) { closeMenu(); return; }
  const id = commandForEvent(e);
  if (!id) return;
  e.preventDefault(); e.stopPropagation();
  run(id).catch(() => {});
}

export function setWorkspace(id) {
  setSetting('workspace', id);
  document.body.classList.remove('ws-edit', 'ws-color', 'ws-audio', 'ws-effects', 'ws-simple');
  document.body.classList.add('ws-' + id);
  const root = document.documentElement.style;
  const L0 = settings.layout || {};
  if (!settings.skin2Layout) { for (const k of Object.keys(L0)) if (L0[k]?.[0] < 430) L0[k][0] = 440; settings.skin2Layout = true; }
  const presets = { edit: [450, 360, 340], color: [400, 420, 260], audio: [430, 360, 380], effects: [480, 380, 320], simple: [430, 340, 320] };
  let [l, r, t] = L0[id] || presets[id];
  // small screens / 125–150 % Windows scaling: keep at least ~40 % of the width for the preview
  const kw = Math.min(1, innerWidth / 1920), kh = Math.min(1, innerHeight / 1040);
  if (!L0[id]) { l = Math.max(300, Math.round(l * kw)); r = Math.max(260, Math.round(r * kw)); t = Math.max(220, Math.round(t * kh)); }
  if (l + r > innerWidth * 0.6) { const f = (innerWidth * 0.6) / (l + r); l = Math.round(l * f); r = Math.round(r * f); }
  root.setProperty('--left-w', l + 'px'); root.setProperty('--right-w', r + 'px'); root.setProperty('--tl-h', t + 'px');
  if (id === 'color') bus.emit('inspect', null, 'color');
  if (id === 'audio') bus.emit('inspect', null, 'audio');
  if (id === 'effects') bus.emit('library:tab', 'effects');
  if (id === 'simple') setMode('simple');
  bus.emit('workspace', id);
  window.dispatchEvent(new Event('resize'));
}
export function setMode(m) {
  setSetting('mode', m);
  document.body.classList.remove('mode-simple', 'mode-pro', 'mode-expert');
  document.body.classList.add('mode-' + m);
  const ms = $('#mode-select'); if (ms) ms.value = m;
}

// splitters (resizable panels, saved per workspace)
export function initSplitters() {
  for (const sp of $$('.splitter')) {
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault(); sp.classList.add('drag');
      const kind = sp.dataset.split; const root = document.documentElement.style;
      const mv = (ev) => {
        if (kind === 'left') root.setProperty('--left-w', Math.max(200, Math.min(700, ev.clientX)) + 'px');
        if (kind === 'right') root.setProperty('--right-w', Math.max(240, Math.min(700, innerWidth - ev.clientX)) + 'px');
        if (kind === 'bottom') root.setProperty('--tl-h', Math.max(140, Math.min(innerHeight - 260, innerHeight - ev.clientY - 24)) + 'px');
        window.dispatchEvent(new Event('resize'));
      };
      const up = () => {
        sp.classList.remove('drag'); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
        const cs = getComputedStyle(document.documentElement);
        settings.layout ||= {}; settings.layout[settings.workspace] = ['--left-w', '--right-w', '--tl-h'].map((v) => parseInt(cs.getPropertyValue(v)));
        saveSettings();
      };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
  }
}

// ------------------------------------------------------------------ command palette
function commandPalette() {
  const inp = el('input', { type: 'text', placeholder: L('Befehl suchen… (alle Funktionen)', 'Search command… (everything)'), style: { width: '100%', fontSize: '14px', padding: '8px 10px' } });
  const list = el('div', { style: { maxHeight: '420px', overflow: 'auto', marginTop: '8px' } });
  let idx = 0, items = [];
  const fill = () => {
    const q = inp.value.toLowerCase();
    items = [...commands.values()].filter((c) => !c.hidden && (N(c.name).toLowerCase().includes(q) || c.id.toLowerCase().includes(q))).slice(0, 60);
    idx = Math.min(idx, items.length - 1); list.innerHTML = '';
    items.forEach((c, i) => list.appendChild(el('div', { class: 'list-item', style: i === idx ? { background: 'var(--acs)' } : {}, onclick: () => { m.close(); run(c.id).catch(() => {}); } }, el('span', { style: { flex: 1 } }, N(c.name)), keyOf(c.id) ? el('kbd', {}, keyOf(c.id)) : null)));
  };
  inp.addEventListener('input', () => { idx = 0; fill(); });
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); fill(); e.preventDefault(); } if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); fill(); e.preventDefault(); } if (e.key === 'Enter' && items[idx]) { m.close(); run(items[idx].id).catch(() => {}); } if (e.key === 'Escape') m.close(); });
  const m = modal({ title: L('Befehlspalette', 'Command palette'), width: 560, body: el('div', {}, inp, list) });
  fill(); setTimeout(() => inp.focus(), 20);
}

// ------------------------------------------------------------------ shortcut editor + macros
function shortcutsDialog() {
  const q = el('input', { type: 'text', placeholder: L('Filtern…', 'Filter…'), style: { width: '100%' } });
  const table = el('table', { class: 'kb-table' });
  const fill = () => {
    table.innerHTML = '';
    const s = q.value.toLowerCase();
    const cats = {};
    for (const c of commands.values()) { if (c.hidden) continue; if (s && !N(c.name).toLowerCase().includes(s) && !keyOf(c.id).toLowerCase().includes(s)) continue; (cats[c.cat || 'other'] ||= []).push(c); }
    for (const [cat, list] of Object.entries(cats)) {
      table.appendChild(el('tr', {}, el('td', { colspan: 3, style: { color: 'var(--ac2)', fontWeight: 700, paddingTop: '10px' } }, cat.toUpperCase())));
      for (const c of list) {
        const inp = el('input', { type: 'text', value: keyOf(c.id), readonly: true, placeholder: L('Taste drücken…', 'Press key…') });
        inp.addEventListener('keydown', (e) => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Backspace' || e.key === 'Delete') { setKey(c.id, ''); inp.value = ''; return; } const combo = comboFromEvent(e); if (['Ctrl', 'Shift', 'Alt', 'Ctrl+Shift', 'Ctrl+Alt', 'Shift+Alt', 'Ctrl+Shift+Alt'].includes(combo)) return; setKey(c.id, combo); inp.value = combo; fill(); });
        table.appendChild(el('tr', {}, el('td', {}, N(c.name)), el('td', {}, inp), el('td', {}, c.key && keyOf(c.id) !== c.key ? el('button', { class: 'btn small', onclick: () => { setKey(c.id, c.key); fill(); } }, '⟲') : '')));
      }
    }
  };
  q.addEventListener('input', fill); q.addEventListener('keydown', (e) => e.stopPropagation());
  fill();
  modal({ title: L('Tastenkombinationen', 'Keyboard shortcuts'), width: 720, body: el('div', {},
    el('p', { class: 'muted', style: { marginTop: 0 } }, L('Feld anklicken und neue Taste drücken (Entf = entfernen). Jeder Effekt, Übergang, Preset und jedes Makro kann eine eigene Taste bekommen.', 'Click a field and press a key (Del = clear). Every effect, transition, preset and macro can get its own key.')),
    el('div', { class: 'row' }, q, el('button', { class: 'btn small', onclick: () => macroDialog() }, '+ ' + L('Makro erstellen', 'Create macro')), el('button', { class: 'btn small danger', onclick: () => { resetKeys(); fill(); } }, L('Alle zurücksetzen', 'Reset all'))),
    el('div', { style: { maxHeight: '58vh', overflow: 'auto' } }, table)) });
}

// macros: named sequences of commands; each becomes a bindable command
function loadMacros() {
  for (const m of settings.macros || []) registerMacro(m);
}
function registerMacro(m) {
  registerCommand({ id: 'macro_' + m.id, name: { de: '⚙ Makro: ' + m.name, en: '⚙ Macro: ' + m.name }, cat: 'macros', key: m.key || '', run: async () => { for (const s of m.steps) await run(s.command, s.args || {}); } });
}
async function macroDialog() {
  const all = [...commands.values()].filter((c) => !c.hidden);
  const name = el('input', { type: 'text', value: L('Mein Makro', 'My macro') }); name.addEventListener('keydown', (e) => e.stopPropagation());
  const steps = [];
  const list = el('div', { style: { minHeight: '60px', background: 'var(--bg0)', borderRadius: '6px', padding: '6px', margin: '8px 0' } });
  const sel = el('select', { style: { width: '100%' } }, ...all.map((c) => el('option', { value: c.id }, N(c.name))));
  const draw = () => { list.innerHTML = ''; steps.forEach((s, i) => list.appendChild(el('div', { class: 'row' }, el('span', { style: { flex: 1 } }, (i + 1) + '. ' + N(commands.get(s.command)?.name)), el('button', { class: 'icon-btn', onclick: () => { steps.splice(i, 1); draw(); } }, '✕')))); };
  modal({ title: L('Makro erstellen', 'Create macro'), width: 520, body: el('div', {}, el('div', { class: 'form' }, el('label', {}, 'Name'), name), list, el('div', { class: 'row' }, sel, el('button', { class: 'btn small', onclick: () => { steps.push({ command: sel.value }); draw(); } }, '+'))),
    buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('Speichern', 'Save'), cls: 'primary', onClick: () => { if (!steps.length) return false; const m = { id: uid('m'), name: name.value, steps }; settings.macros = [...(settings.macros || []), m]; saveSettings(); registerMacro(m); rebuildKeymap(); toast(L('Makro gespeichert – jetzt eine Taste zuweisen', 'Macro saved – now assign a key'), 'ok'); } }] });
}

// ------------------------------------------------------------------ settings
function settingsDialog() {
  const chk = (k, label) => { const c = el('input', { type: 'checkbox', checked: !!settings[k] }); c.onchange = () => setSetting(k, c.checked); return [el('label', {}, label), c]; };
  const numI = (k, label, min, max) => { const i = el('input', { type: 'number', value: settings[k], min, max }); i.onchange = () => setSetting(k, +i.value); i.addEventListener('keydown', (e) => e.stopPropagation()); return [el('label', {}, label), i]; };
  const proxyH = el('select', {}, ...[360, 540, 720, 1080].map((h) => el('option', { value: h }, h + 'p'))); proxyH.value = settings.proxyHeight; proxyH.onchange = () => setSetting('proxyHeight', +proxyH.value);
  const useProxy = el('input', { type: 'checkbox', checked: settings.useProxies !== false }); useProxy.onchange = () => { setSetting('useProxies', useProxy.checked); bus.emit('changed', 'proxy'); };
  modal({ title: L('Einstellungen', 'Settings'), width: 600, body: el('div', { class: 'form' },
    ...numI('autosaveSec', L('Auto-Speichern (s)', 'Autosave (s)'), 15, 3600),
    ...numI('defaultStillDur', L('Bild-Dauer (s)', 'Still duration (s)'), 1, 60),
    ...chk('autoProxy', L('Auto-Proxy für große Videos', 'Auto proxy for large videos')),
    ...numI('proxyAboveHeight', L('Proxy ab Höhe (px)', 'Proxy above height (px)'), 480, 8000),
    el('label', {}, L('Proxy-Auflösung', 'Proxy resolution')), proxyH,
    el('label', {}, L('Proxies in Vorschau nutzen', 'Use proxies for preview')), useProxy,
    ...chk('showWaveforms', L('Wellenformen zeigen', 'Show waveforms')),
    ...chk('showFilmstrip', L('Filmstreifen zeigen', 'Show filmstrips')),
    el('label', {}, L('Cache-Ordner', 'Cache folder')), el('button', { class: 'btn small', onclick: () => ipcRenderer.invoke('shell:open', path.join(paths.userData, 'cache')) }, L('Öffnen', 'Open')),
    el('label', {}, L('Cache leeren', 'Clear cache')), el('button', { class: 'btn small danger', onclick: () => { const fs = require('fs'); for (const sub of ['proxies', 'reversed', 'tmp']) fs.rmSync(path.join(paths.userData, 'cache', sub), { recursive: true, force: true }); toast(L('Cache geleert', 'Cache cleared'), 'ok'); } }, L('Proxies & Temp löschen', 'Delete proxies & temp'))),
    buttons: [{ label: 'OK', cls: 'primary', value: true }] });
}

function apiInfoDialog() {
  const mcp = path.join(paths.appUnpacked || paths.appRoot, 'tools', 'velox-mcp.js');
  modal({ title: L('KI-Steuerung (Automations-API)', 'AI control (automation API)'), width: 680, body: el('div', { style: { lineHeight: '1.6', userSelect: 'text' } },
    el('p', {}, L('VELOX kann von Claude oder eigenen Skripten komplett bedient werden: Medien importieren, schneiden, Effekte/Übergänge setzen, Auto-Edit, Rendern, Frames ansehen.', 'VELOX can be fully operated by Claude or scripts: import, cut, effects/transitions, auto edit, render, inspect frames.')),
    el('p', {}, el('b', {}, 'Claude Code (MCP):')),
    el('pre', { style: { background: 'var(--bg0)', padding: '10px', borderRadius: '6px', whiteSpace: 'pre-wrap' } }, `claude mcp add velox -- node "${mcp}"`),
    el('p', {}, el('b', {}, 'HTTP:'), ` http://127.0.0.1:${apiInfo.port}  ·  Header x-velox-token (${path.join(paths.userData, 'api.json')})`),
    el('p', { class: 'muted' }, 'GET /state · GET /commands · GET /catalog · POST /run {command,args} · POST /batch {steps} · POST /import {files,place} · POST /frame {t}')),
    buttons: [{ label: 'OK', cls: 'primary', value: true }] });
}

registerCommands([
  { id: 'importMedia', name: { de: 'Medien importieren…', en: 'Import media…' }, cat: 'file', key: 'Ctrl+I', run: () => importDialog() },
  { id: 'commandPalette', name: { de: 'Befehlspalette', en: 'Command palette' }, cat: 'view', key: 'Ctrl+P,F1', run: () => commandPalette() },
  { id: 'shortcuts', name: { de: 'Tastenkombinationen & Makros…', en: 'Shortcuts & macros…' }, cat: 'view', key: 'Ctrl+Alt+K', run: () => shortcutsDialog() },
  { id: 'openSettings', name: { de: 'Einstellungen…', en: 'Settings…' }, cat: 'file', key: 'Ctrl+Alt+S', run: () => settingsDialog() },
  { id: 'showApiInfo', name: { de: 'KI-Steuerung / API…', en: 'AI control / API…' }, cat: 'view', run: () => apiInfoDialog() },
  { id: 'wsEdit', name: { de: 'Arbeitsbereich: Schnitt', en: 'Workspace: Edit' }, cat: 'view', key: 'Alt+1', run: () => setWorkspace('edit') },
  { id: 'wsColor', name: { de: 'Arbeitsbereich: Farbe', en: 'Workspace: Color' }, cat: 'view', key: 'Alt+2', run: () => setWorkspace('color') },
  { id: 'wsAudio', name: { de: 'Arbeitsbereich: Audio', en: 'Workspace: Audio' }, cat: 'view', key: 'Alt+3', run: () => setWorkspace('audio') },
  { id: 'wsEffects', name: { de: 'Arbeitsbereich: Effekte', en: 'Workspace: Effects' }, cat: 'view', key: 'Alt+4', run: () => setWorkspace('effects') },
  { id: 'wsSimple', name: { de: 'Arbeitsbereich: Einfach', en: 'Workspace: Simple' }, cat: 'view', key: 'Alt+5', run: () => setWorkspace('simple') },
  { id: 'modeSimple', name: { de: 'Modus: Einsteiger', en: 'Mode: Beginner' }, cat: 'view', run: () => setMode('simple') },
  { id: 'modePro', name: { de: 'Modus: Pro', en: 'Mode: Pro' }, cat: 'view', run: () => setMode('pro') },
  { id: 'modeExpert', name: { de: 'Modus: Experte', en: 'Mode: Expert' }, cat: 'view', run: () => setMode('expert') },
  { id: 'toggleFullscreen', name: { de: 'Vollbild', en: 'Fullscreen' }, cat: 'view', key: 'F11', run: () => ipcRenderer.send('win:fullscreen') },
  { id: 'devtools', name: { de: 'Entwicklertools', en: 'Developer tools' }, cat: 'view', run: () => ipcRenderer.send('win:devtools') },
  { id: 'about', name: { de: 'Über VELOX Studio', en: 'About VELOX Studio' }, cat: 'help', run: () => modal({ title: 'VELOX Studio', body: el('div', { style: { lineHeight: '1.7' } }, el('div', { class: 'logo', style: { width: '48px', height: '48px', fontSize: '26px', marginBottom: '10px' } }, 'V'), `Version ${paths.version}`, el('br'), 'Electron · WebGL2 · FFmpeg', el('br'), L(`${Object.keys(EFFECTS).length} Effekte · ${Object.keys(TRANSITIONS).length} Übergänge · ${commands.size} Befehle`, `${Object.keys(EFFECTS).length} effects · ${Object.keys(TRANSITIONS).length} transitions · ${commands.size} commands`)), buttons: [{ label: 'OK', cls: 'primary' }] }) },
]);

// per-effect / transition / preset bindable commands ("mit Keybinds bestimmte Sachen machen")
export function registerDynamicCommands() {
  for (const d of Object.values(EFFECTS)) registerCommand({ id: 'fx:' + d.id, name: { de: 'Effekt: ' + d.name.de, en: 'Effect: ' + d.name.en }, cat: 'effects', run: () => run('applyEffect', { type: d.id }) });
  for (const d of Object.values(TRANSITIONS)) registerCommand({ id: 'tr:' + d.id, name: { de: 'Übergang: ' + d.name.de, en: 'Transition: ' + d.name.en }, cat: 'transitions', run: () => run('addTransition', { type: d.id }) });
  for (const p of BUILTIN_PRESETS) registerCommand({ id: 'preset:' + p.id, name: { de: 'Preset: ' + p.name, en: 'Preset: ' + p.name }, cat: 'presets', run: () => run('applyPreset', { id: p.id }) });
  for (const [k, v] of Object.entries(VELOCITY_PRESETS)) registerCommand({ id: 'vel:' + k, name: { de: 'Velocity: ' + v.name, en: 'Velocity: ' + v.name }, cat: 'velocity', run: () => run('velocityPreset', { preset: k }) });
  [0.25, 0.5, 2, 4].forEach((s) => registerCommand({ id: 'speed:' + s, name: { de: `Tempo ${s}x`, en: `Speed ${s}x` }, cat: 'clip', run: () => run('setSpeed', { speed: s }) }));
  // sensible defaults for quick-access
  const defaults = { 'tr:dissolve': 'Ctrl+Shift+D', 'tr:flash': 'Ctrl+Shift+F', 'tr:zoomin': 'Ctrl+Shift+I', 'tr:whippan': 'Ctrl+Shift+W', 'tr:glitch': 'Ctrl+Shift+G', 'fx:shake': 'Alt+S', 'fx:glow': 'Alt+G', 'fx:motionblur': 'Alt+M', 'fx:realism': 'Alt+R', 'fx:rgbsplit': 'Alt+C', 'vel:montage': 'Alt+V', 'speed:0.5': 'Alt+-', 'speed:2': 'Alt+Plus' };
  for (const [id, k] of Object.entries(defaults)) { const c = commands.get(id); if (c) c.key = k; }
  loadMacros();
  rebuildKeymap();
}
