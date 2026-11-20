// Left panel: media pool with folders, sound library, text presets, effects, transitions,
// presets/looks, templates, store, AI hub.
import { store, clipEnd } from '../core/project.js';
import { bus, el, $, $$, uid, shortTime, fileUrl, fmtBytes } from '../core/util.js';
import { L, N } from '../core/i18n.js';
import { settings, paths, setSetting, userPresets, deletePreset } from '../core/settings.js';
import { importFiles, thumbs, placeMedia, appendToMain, createProxy, ALL_EXT, AUDIO_EXT, freeAudioTrack } from '../core/media.js';
import { EFFECTS, EFFECT_CATS } from '../render/effects.js';
import { TRANSITIONS, TRANSITION_CATS } from '../render/transitions.js';
import { BUILTIN_PRESETS, PROJECT_TEMPLATES } from './presets.js';
import { renderEffectPreview, renderTransitionPreview, renderPresetPreview, animateOnHover } from './previews.js';
import { run, commands } from '../core/commands.js';
import { contextMenu, toast, promptBox, confirmBox, modal } from './dialogs.js';
import { run as ff } from '../core/ffmpeg.js';
import { engine } from '../playback/engine.js';
import { STORE_PACKS, installPack, installedPacks } from '../core/store.js';
import { pcTab, importFolder } from './pcbrowser.js';
import { graphicsTab } from './gfxui.js';
import { SFX2, SFX_CATS } from './sfx.js';
const { ipcRenderer, webUtils } = require('electron');
export const filePath = (f) => { try { return webUtils.getPathForFile(f); } catch { return f.path || ''; } };
const fs = require('fs');
const path = require('path');

let tab = 'media';
let folder = 'root';
let search = '';
const selMedia = new Set();

import { templatesTab as tplTab } from '../templates/templates.js';
const TABS = [
  ['media', { de: 'Medien', en: 'Media' }, '🎞'], ['templates', { de: 'Vorlagen', en: 'Templates' }, '▦'], ['pc', { de: 'PC', en: 'PC' }, '💻'], ['audio', { de: 'Audio', en: 'Audio' }, '🎵'], ['text', { de: 'Text', en: 'Text' }, 'T'],
  ['graphics', { de: 'Grafik', en: 'Graphics' }, '⬟'], ['effects', { de: 'Effekte', en: 'Effects' }, '✦'], ['transitions', { de: 'Übergänge', en: 'Transit.' }, '⧉'], ['presets', { de: 'Filter', en: 'Filters' }, '🎨'],
  ['ai', { de: 'KI', en: 'AI' }, '🧠'], ['store', { de: 'Store', en: 'Store' }, '🛒'],
];

export function initLibrary() {
  bus.on('changed', (l) => { if (tab === 'media' && l !== 'live') renderBody(); });
  bus.on('thumbs', () => { if (tab === 'media') renderBody(); });
  bus.on('lang', render);
  bus.on('presets', () => { if (tab === 'presets') renderBody(); });
  bus.on('media:progress', (id, p) => { const n = document.querySelector(`.media-item[data-id="${id}"] .prog`); if (n) n.style.width = p == null ? '0' : p * 100 + '%'; });
  bus.on('library:tab', (t) => { tab = t; render(); });
  bus.on('templates', () => { if (tab === 'templates') renderBody(); });
  // drop files anywhere on the media panel
  const body = $('#left-body');
  body.addEventListener('dragover', (e) => { const t = e.dataTransfer.types; if (tab !== 'pc' && (t.includes('Files') || t.includes('velox/files') || t.includes('velox/folder'))) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  body.addEventListener('drop', async (e) => {
    if (tab === 'pc') return;
    const t = e.dataTransfer.types;
    if (t.includes('velox/folder')) { e.preventDefault(); await importFolder(e.dataTransfer.getData('velox/folder'), { recursive: true }); tab = 'media'; render(); return; }
    let files = t.includes('velox/files') ? JSON.parse(e.dataTransfer.getData('velox/files')) : [...e.dataTransfer.files].map(filePath).filter(Boolean);
    if (!files.length) return; e.preventDefault();
    const dirs = files.filter((f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } });
    for (const d of dirs) await importFolder(d, { recursive: true });
    files = files.filter((f) => !dirs.includes(f));
    if (files.length) await importFiles(files, folder === '*' ? 'root' : folder);
    tab = 'media'; render();
  });
  render();
}

export function render() {
  const tabs = $('#left-tabs'); tabs.innerHTML = '';
  if (!tabs._wheel) { tabs._wheel = true; tabs.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabs.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false }); }
  for (const [id, name, ico] of TABS) tabs.appendChild(el('button', { class: 'side-tab' + (id === tab ? ' active' : ''), title: N(name), onclick: () => { tab = id; render(); } }, el('span', { class: 'si' }, ico), el('span', { class: 'sl' }, N(name))));
  renderBody();
}
function renderBody() {
  const body = $('#left-body'); body.innerHTML = '';
  ({ graphics: graphicsTab, pc: pcTab, media: mediaTab, audio: audioTab, text: textTab, effects: effectsTab, transitions: transitionsTab, presets: presetsTab, templates: templatesTab, store: storeTab, ai: aiTab })[tab](body);
}

// ------------------------------------------------------------------ media pool
export async function importDialog() {
  const r = await ipcRenderer.invoke('dialog:open', { properties: ['openFile', 'multiSelections'], filters: [{ name: L('Medien', 'Media'), extensions: ALL_EXT }, { name: '*', extensions: ['*'] }] });
  if (!r.canceled) { await importFiles(r.filePaths, folder); tab = 'media'; render(); }
}
function mediaTab(body) {
  const q = el('input', { type: 'text', placeholder: L('Suchen…', 'Search…'), value: search, oninput: (e) => { search = e.target.value; renderGrid(); } });
  q.addEventListener('keydown', (e) => e.stopPropagation());
  body.appendChild(el('div', { class: 'lib-toolbar' },
    el('button', { class: 'btn primary small', onclick: importDialog }, '+ ' + L('Importieren', 'Import')),
    q,
    el('button', { class: 'icon-btn', title: L('Dateien vom PC auswählen', 'Pick files from PC'), onclick: importDialog }, '📄'),
    el('button', { class: 'icon-btn', title: L('Ganzen Ordner importieren', 'Import whole folder'), onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openDirectory', 'multiSelections'] }); if (!r.canceled) { for (const d of r.filePaths) await importFolder(d, { recursive: true }); renderBody(); } } }, '🗂'),
    el('button', { class: 'icon-btn', title: L('PC-Ordner durchsuchen', 'Browse PC folders'), onclick: () => { tab = 'pc'; render(); } }, '💻'),
    el('button', { class: 'icon-btn', title: L('Neuer Ordner', 'New folder'), onclick: async () => { const n = await promptBox(L('Ordnername', 'Folder name'), L('Neuer Ordner', 'New folder')); if (n) store.edit('Ordner', (p) => p.folders.push({ id: uid('fld'), name: n, parent: 'root' })); } }, '📁+'),
    el('button', { class: 'icon-btn', title: L('Ausgewählte an Timeline anhängen', 'Append selected to timeline'), onclick: () => appendSelected() }, '⤓')));
  const fr = el('div', { class: 'folder-row' });
  const all = el('span', { class: 'folder-chip' + (folder === '*' ? ' active' : ''), onclick: () => { folder = '*'; renderBody(); } }, L('Alle', 'All'));
  fr.appendChild(all);
  for (const f of store.p.folders) {
    const chip = el('span', { class: 'folder-chip' + (folder === f.id ? ' active' : ''), onclick: () => { folder = f.id; renderBody(); },
      oncontextmenu: (e) => { e.preventDefault(); if (f.id === 'root') return; contextMenu(e.clientX, e.clientY, [
        { label: L('Umbenennen', 'Rename'), action: async () => { const n = await promptBox(L('Ordnername', 'Folder name'), f.name); if (n) store.edit('Ordner', () => { f.name = n; }); } },
        { label: L('Löschen (Medien → Medien)', 'Delete (media → root)'), action: () => store.edit('Ordner', (p) => { p.media.forEach((m) => { if (m.folder === f.id) m.folder = 'root'; }); p.folders = p.folders.filter((x) => x.id !== f.id); folder = 'root'; }) }]); } },
    f.name + ' (' + store.p.media.filter((m) => (m.folder || 'root') === f.id).length + ')');
    chip.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('velox/media')) { e.preventDefault(); chip.classList.add('drop'); } });
    chip.addEventListener('dragleave', () => chip.classList.remove('drop'));
    chip.addEventListener('drop', (e) => { const ids = JSON.parse(e.dataTransfer.getData('velox/media') || '[]'); store.edit('Verschieben', () => ids.forEach((id) => { const m = store.media(id); if (m) m.folder = f.id; })); });
    fr.appendChild(chip);
  }
  body.appendChild(fr);
  const grid = el('div', { class: 'media-grid' });
  body.appendChild(grid);
  function renderGrid() {
    grid.innerHTML = '';
    const list = store.p.media.filter((m) => (folder === '*' || (m.folder || 'root') === folder) && (!search || m.name.toLowerCase().includes(search.toLowerCase())));
    if (!store.p.media.length) { body.appendChild(el('div', { class: 'drop-hint' }, el('b', {}, L('Medien hierher ziehen', 'Drop media here')), L('Videos, Audio, Bilder – oder Importieren klicken. Ordner werden komplett importiert.', 'Videos, audio, images – or click Import. Folders import completely.'))); return; }
    for (const m of list) grid.appendChild(mediaItem(m));
  }
  renderGrid();
}
function mediaItem(m) {
  const th = thumbs.get(m.id);
  const used = store.p.clips.some((c) => c.mediaId === m.id);
  const thumb = el('div', { class: 'th', style: { backgroundImage: th?.poster ? `url("${fileUrl(th.poster)}")` : m.type === 'audio' ? 'linear-gradient(135deg,#123a2e,#0d1f1a)' : 'none' } },
    m.type === 'audio' ? el('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: '26px', color: '#5ff0bd' } }, '♫') : null,
    el('span', { class: 'badge' }, (m.type === 'video' ? (m.height ? m.height + 'p' : 'VID') : m.type === 'image' ? 'IMG' : 'AUD') + (m.proxyPath ? ' · P' : '') + (m.fps && m.type === 'video' ? ' · ' + Math.round(m.fps) : '')),
    m.type !== 'image' ? el('span', { class: 'dur' }, shortTime(m.duration)) : null,
    el('div', { class: 'scrub' }));
  const item = el('div', { class: 'media-item' + (selMedia.has(m.id) ? ' sel' : ''), draggable: 'true', dataset: { id: m.id }, title: `${m.name}\n${m.width ? m.width + '×' + m.height : ''} ${m.vcodec || m.acodec || ''}\n${fmtBytes(m.size || 0)}` },
    thumb, el('div', { class: 'nm' }, (used ? '● ' : '') + m.name), el('div', { class: 'prog' }));
  // hover scrub using filmstrip
  if (th?.strip && m.type === 'video') {
    thumb.addEventListener('mousemove', (e) => {
      const r = thumb.getBoundingClientRect(); const k = (e.clientX - r.left) / r.width; const n = th.count;
      thumb.style.backgroundImage = `url("${fileUrl(th.strip)}")`; thumb.style.backgroundSize = `${n * 100}% 100%`; thumb.style.backgroundPosition = `${(Math.floor(k * n) / Math.max(1, n - 1)) * 100}% 0`;
      thumb.querySelector('.scrub').style.left = k * 100 + '%';
    });
    thumb.addEventListener('mouseleave', () => { thumb.style.backgroundImage = `url("${fileUrl(th.poster)}")`; thumb.style.backgroundSize = 'cover'; thumb.style.backgroundPosition = 'center'; });
  }
  item.addEventListener('click', (e) => { if (!e.ctrlKey && !e.shiftKey) selMedia.clear(); selMedia.has(m.id) ? selMedia.delete(m.id) : selMedia.add(m.id); $$('.media-item').forEach((n) => n.classList.toggle('sel', selMedia.has(n.dataset.id))); });
  item.addEventListener('dblclick', () => import('./seqbar.js').then((x) => x.openSourceMonitor(m)));
  item.addEventListener('dragstart', (e) => {
    const ids = selMedia.has(m.id) ? [...selMedia] : [m.id];
    e.dataTransfer.setData('velox/media', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'copy';
    window.__dragMedia = m; window.__dragRange = null;
  });
  item.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
    { label: L('Im Quell-Monitor öffnen', 'Open in source monitor'), action: () => import('./seqbar.js').then((x) => x.openSourceMonitor(m)) },
    { label: L('Am Playhead einfügen', 'Insert at playhead'), action: () => store.edit('Einfügen', (p) => placeMedia(p, m, store.time, {})) },
    { label: L('An Timeline anhängen', 'Append to timeline'), action: () => store.edit('Anhängen', (p) => appendToMain(p, [m])) },
    { label: L('Proxy erstellen', 'Create proxy'), disabled: m.type !== 'video', action: () => createProxy(m) },
    { label: L('Proxy entfernen', 'Remove proxy'), disabled: !m.proxyPath, action: () => store.edit('Proxy', () => { m.proxyPath = null; }) },
    { label: L('Im Explorer zeigen', 'Show in Explorer'), action: () => ipcRenderer.invoke('shell:show', m.path) },
    { label: L('Umbenennen', 'Rename'), action: async () => { const n = await promptBox(L('Name', 'Name'), m.name); if (n) store.edit('Umbenennen', () => { m.name = n; }); } },
    { label: L('Neu verknüpfen…', 'Relink…'), action: () => relinkMedia(m) },
    '-',
    { label: L('Aus Projekt entfernen', 'Remove from project'), action: async () => { if (store.p.clips.some((c) => c.mediaId === m.id) && !(await confirmBox(L('Das Medium wird in der Timeline verwendet. Clips ebenfalls entfernen?', 'Media is used in the timeline. Remove its clips too?')))) return; store.edit('Entfernen', (p) => { p.clips = p.clips.filter((c) => c.mediaId !== m.id); p.media = p.media.filter((x) => x.id !== m.id); }); } },
  ]); });
  return item;
}
async function relinkMedia(m) {
  const r = await ipcRenderer.invoke('dialog:open', { properties: ['openFile'], defaultPath: path.dirname(m.path) });
  if (r.canceled) return;
  store.edit('Neu verknüpfen', () => { m.path = r.filePaths[0]; m.name = path.basename(m.path); m.proxyPath = null; });
}
function appendSelected() {
  const ms = [...selMedia].map((id) => store.media(id)).filter(Boolean);
  if (!ms.length) { toast(L('Erst Medien auswählen', 'Select media first')); return; }
  store.edit('Anhängen', (p) => { const cs = appendToMain(p, ms); store.select(cs.map((c) => c.id)); });
}

// ------------------------------------------------------------------ audio library (built-in SFX + user folders)
const SFX = [
  ['whoosh', 'Whoosh', '-f lavfi -i "anoisesrc=d=0.9:c=pink:a=0.8" -af "bandpass=f=1200:width_type=o:w=2,afade=t=in:d=0.35:curve=exp,afade=t=out:st=0.4:d=0.5,vibrato=f=6:d=0.4,volume=2"'],
  ['whoosh_long', 'Whoosh Lang', '-f lavfi -i "anoisesrc=d=1.8:c=pink:a=0.8" -af "bandpass=f=900:width_type=o:w=2.5,afade=t=in:d=1.1:curve=exp,afade=t=out:st=1.1:d=0.7,volume=2"'],
  ['impact', 'Impact', '-f lavfi -i "sine=f=55:d=1.2" -f lavfi -i "anoisesrc=d=0.25:c=brown:a=1" -filter_complex "[0]afade=t=out:st=0.05:d=1.1,volume=3[a];[1]lowpass=f=600,afade=t=out:d=0.25,volume=2[b];[a][b]amix=inputs=2:normalize=0,alimiter"'],
  ['boom', 'Bass Boom', '-f lavfi -i "aevalsrc=sin(2*PI*t*(70-40*t))*exp(-2.5*t):d=1.6" -af "volume=2.5,alimiter"'],
  ['riser', 'Riser', '-f lavfi -i "aevalsrc=0.4*sin(2*PI*t*(200+400*t*t))*(t/3)+0.2*(random(0)-0.5)*(t/3):d=3" -af "highpass=f=150,afade=t=out:st=2.85:d=0.15"'],
  ['downer', 'Downlifter', '-f lavfi -i "aevalsrc=0.5*sin(2*PI*t*(900-280*t))*exp(-0.8*t):d=2.5" -af "afade=t=out:st=2:d=0.5"'],
  ['click', 'Klick', '-f lavfi -i "aevalsrc=sin(2*PI*2200*t)*exp(-120*t):d=0.08"'],
  ['pop', 'Pop', '-f lavfi -i "aevalsrc=sin(2*PI*t*(900-6000*t))*exp(-30*t):d=0.15" -af volume=2'],
  ['ding', 'Ding', '-f lavfi -i "aevalsrc=0.5*sin(2*PI*1320*t)*exp(-3*t)+0.25*sin(2*PI*2640*t)*exp(-5*t):d=1.5"'],
  ['glitch', 'Glitch', '-f lavfi -i "aevalsrc=0.6*sgn(sin(2*PI*t*(300+1500*floor(mod(t*40\\,3)))))*lt(mod(t*23\\,1)\\,0.6):d=0.6" -af "acrusher=bits=6:mode=log,volume=0.8"'],
  ['camera', 'Kamera-Auslöser', '-f lavfi -i "anoisesrc=d=0.18:c=white:a=0.9" -af "highpass=f=2000,afade=t=out:d=0.18:curve=exp"'],
  ['swoosh_up', 'Swoosh Up', '-f lavfi -i "anoisesrc=d=0.7:c=pink:a=0.8" -af "highpass=f=400,bandpass=f=3000:w=1.5:width_type=o,afade=t=in:d=0.5:curve=exp,afade=t=out:st=0.5:d=0.2,volume=2"'],
  ['heartbeat', 'Herzschlag', '-f lavfi -i "aevalsrc=sin(2*PI*50*t)*(exp(-25*mod(t\\,0.9))+0.7*exp(-25*mod(t-0.22\\,0.9))*gt(mod(t\\,0.9)\\,0.22)):d=2.7" -af volume=3'],
  ['beep', 'Zensur-Piep', '-f lavfi -i "sine=f=1000:d=0.8" -af "volume=0.5"'],
  ['tick', 'Uhr-Tick', '-f lavfi -i "aevalsrc=sin(2*PI*3000*mod(t\\,1))*exp(-200*mod(t\\,1)):d=4"'],
  ['bass_drop', 'Bass Drop', '-f lavfi -i "aevalsrc=0.9*sin(2*PI*t*(120*exp(-1.2*t)+35)):d=2.5" -af "afade=t=out:st=1.8:d=0.7,alimiter"'],
];
async function ensureSfx() {
  const dir = path.join(paths.userData, 'library', 'sfx'); fs.mkdirSync(dir, { recursive: true });
  const all = [...SFX, ...SFX2.map(([id, name, , args]) => [id, name, args])].filter(([id]) => !fs.existsSync(path.join(dir, id + '.wav')));
  const gen = async ([id, , args]) => {
    const out = path.join(dir, id + '.wav');
    const parts = args.match(/(?:[^\s"]+|"[^"]*")+/g).map((x) => x.replace(/^"|"$/g, ''));
    try { await ff([...parts, '-ar', '48000', '-ac', '2', out]); } catch (e) { console.warn('sfx', id, e.message.slice(-200)); }
  };
  for (let i = 0; i < all.length; i += 6) await Promise.all(all.slice(i, i + 6).map(gen));
  return dir;
}
function audioTab(body) {
  const host = el('div', { class: 'lib-section' });
  body.appendChild(el('div', { class: 'lib-toolbar' },
    el('button', { class: 'btn small', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openDirectory'] }); if (!r.canceled) { setSetting('libraryFolders', [...new Set([...settings.libraryFolders, r.filePaths[0]])]); renderBody(); } } }, '+ ' + L('Musik-Ordner hinzufügen', 'Add music folder')),
    el('button', { class: 'btn small', onclick: () => run('aiTTS') }, '🗣 ' + L('Text-zu-Sprache', 'Text to speech'))));
  body.appendChild(host);
  host.appendChild(el('h4', {}, L('Soundeffekte (' + (SFX.length + SFX2.length) + ', eingebaut & lizenzfrei)', 'Sound effects (built-in, royalty-free)')));
  const list = el('div', {}); host.appendChild(list);
  list.appendChild(el('div', { class: 'muted' }, L('Lade…', 'Loading…')));
  const q = el('input', { type: 'text', placeholder: L('Sound suchen… (z. B. whoosh, sirene, boom)', 'Search sounds…'), style: { width: '100%', margin: '4px 0 8px' } });
  q.addEventListener('keydown', (e) => e.stopPropagation());
  host.insertBefore(q, list);
  ensureSfx().then((dir) => {
    const fill = () => {
      list.innerHTML = ''; const s2 = q.value.toLowerCase();
      const groups = [['basis', L('Basis', 'Basics'), SFX.map(([id, name]) => [id, name])], ...Object.entries(SFX_CATS).map(([k, nm]) => [k, nm, SFX2.filter((x) => x[2] === k).map(([id, name]) => [id, name])])];
      for (const [, nm, items] of groups) {
        const vis = items.filter(([id, name]) => !s2 || name.toLowerCase().includes(s2) || id.includes(s2)).filter(([id]) => fs.existsSync(path.join(dir, id + '.wav')));
        if (!vis.length) continue;
        list.appendChild(el('div', { class: 'muted', style: { fontSize: '11px', fontWeight: 700, margin: '8px 2px 2px', textTransform: 'uppercase', letterSpacing: '.6px' } }, nm + ' · ' + vis.length));
        for (const [id, name] of vis) list.appendChild(audioRow(path.join(dir, id + '.wav'), name));
      }
    };
    q.oninput = fill; fill();
  });
  for (const folderPath of settings.libraryFolders) {
    host.appendChild(el('h4', { style: { display: 'flex' } }, path.basename(folderPath), el('span', { class: 'spacer' }), el('span', { style: { cursor: 'pointer' }, onclick: () => { setSetting('libraryFolders', settings.libraryFolders.filter((x) => x !== folderPath)); renderBody(); } }, '✕')));
    let files = [];
    try { files = fs.readdirSync(folderPath).filter((f) => AUDIO_EXT.includes(path.extname(f).slice(1).toLowerCase())); } catch {}
    if (!files.length) host.appendChild(el('div', { class: 'muted' }, L('Keine Audiodateien', 'No audio files')));
    for (const f of files.slice(0, 300)) host.appendChild(audioRow(path.join(folderPath, f), f));
  }
}
let previewAudio = null;
function audioRow(file, name) {
  const row = el('div', { class: 'list-item', draggable: 'true', title: file },
    el('span', { class: 'ic', onclick: (e) => { e.stopPropagation(); if (previewAudio && !previewAudio.paused && previewAudio.dataset.f === file) { previewAudio.pause(); return; } previewAudio?.pause(); previewAudio = new Audio(fileUrl(file)); previewAudio.dataset.f = file; previewAudio.play(); } }, '▶'),
    el('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
    el('button', { class: 'btn small', onclick: async (e) => { e.stopPropagation(); const [m] = await importFiles([file], 'root'); if (m) store.edit('Audio', (p) => { const tr = freeAudioTrack(p, store.time, store.time + m.duration); placeMedia(p, m, store.time, { audioTrackId: tr.id }); }); } }, '+'));
  row.addEventListener('dragstart', async (e) => { e.dataTransfer.setData('text/uri-list', fileUrl(file)); e.dataTransfer.setData('velox/sfx', file); });
  return row;
}

// ------------------------------------------------------------------ text
function textTab(body) {
  const sec = el('div', { class: 'lib-section' });
  body.appendChild(el('div', { class: 'lib-toolbar' },
    el('button', { class: 'btn primary small', onclick: () => run('addText') }, '+ ' + L('Standard-Text', 'Default text')),
    el('button', { class: 'btn small', onclick: () => run('aiSubtitles') }, L('Auto-Untertitel', 'Auto subtitles')),
    el('button', { class: 'btn small', onclick: () => run('importSrt') }, L('SRT importieren', 'Import SRT'))));
  sec.appendChild(el('h4', {}, L('Text-Stile (ziehen oder klicken)', 'Text styles (drag or click)')));
  const g = el('div', { class: 'grid2' });
  for (const p of BUILTIN_PRESETS.filter((x) => x.kind === 'text').concat(userPresets.text || [])) {
    const t = p.text || {};
    const prev = el('div', { class: 'text-preset', draggable: 'true', style: { fontFamily: t.font || 'Bahnschrift', fontWeight: t.weight || 700, color: t.color2 ? 'transparent' : t.color || '#fff', background: t.bg || 'var(--bg2)', backgroundImage: t.color2 ? `linear-gradient(90deg, ${t.color}, ${t.color2})` : '', WebkitBackgroundClip: t.color2 ? 'text' : '', textShadow: t.glow ? `0 0 12px ${t.glowColor}` : t.extrude ? `2px 2px 0 ${t.extrudeColor}, 4px 4px 0 ${t.extrudeColor}` : '', WebkitTextStroke: t.stroke ? '1px ' + (t.strokeColor || '#000') : '', textTransform: t.upper ? 'uppercase' : '' }, onclick: () => run('addText', { content: p.name, style: t }) }, p.name);
    prev.addEventListener('dragstart', (e) => e.dataTransfer.setData('velox/text', JSON.stringify({ text: { ...t, content: p.name } })));
    g.appendChild(prev);
  }
  sec.appendChild(g);
  sec.appendChild(el('h4', {}, L('Schriftarten', 'Fonts')));
  sec.appendChild(el('button', { class: 'btn small', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }], properties: ['openFile', 'multiSelections'] }); if (!r.canceled) { for (const f of r.filePaths) await loadFontFile(f); toast(L('Schrift(en) importiert', 'Font(s) imported'), 'ok'); } } }, L('Eigene Schrift importieren…', 'Import custom font…')));
  sec.appendChild(el('div', { class: 'muted', style: { marginTop: '6px' } }, (window.__customFonts || []).join(', ') || L('Keine eigenen Schriften', 'No custom fonts')));
  body.appendChild(sec);
}
export async function loadFontFile(file) {
  const name = path.basename(file).replace(/\.[^.]+$/, '');
  const dir = path.join(paths.userData, 'fonts'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(file)); if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  const ff2 = new FontFace(name, `url("${fileUrl(dest)}")`); await ff2.load(); document.fonts.add(ff2);
  window.__customFonts = [...new Set([...(window.__customFonts || []), name])];
  return name;
}
export async function loadInstalledFonts() {
  const dir = path.join(paths.userData, 'fonts'); if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) { try { await loadFontFile(path.join(dir, f)); } catch {} }
}

// ------------------------------------------------------------------ effects
function effectsTab(body) {
  const q = el('input', { type: 'text', placeholder: L('Effekt suchen…', 'Search effects…'), oninput: () => fill() }); q.addEventListener('keydown', (e) => e.stopPropagation());
  body.appendChild(el('div', { class: 'lib-toolbar' }, q));
  const host = el('div', {}); body.appendChild(host);
  const fill = () => {
    host.innerHTML = '';
    const s = q.value.toLowerCase();
    const cats = {};
    for (const d of Object.values(EFFECTS)) if (d.cat !== 'color' && (!s || N(d.name).toLowerCase().includes(s) || d.id.includes(s))) (cats[d.cat] ||= []).push(d);
    host.appendChild(el('div', { class: 'lib-section' }, el('div', { class: 'list-item', style: { background: 'var(--bg2)' }, onclick: () => { const c = store.primaryClip(); if (c) bus.emit('inspect', c.id, 'color'); else toast(L('Clip anklicken, dann Farbe im Inspector rechts', 'Click a clip, then Color in the inspector')); } }, el('span', { class: 'ic' }, '🎨'), el('div', {}, el('b', {}, L('Farbe & Filter (alles an einem Ort)', 'Color & filters (all in one place)')), el('div', { class: 'muted', style: { fontSize: '11px' } }, L('Korrektur, Farbräder, Kurven, HSL, LUT, Filter → Inspector „Farbe“', 'Correction, wheels, curves, HSL, LUT, filters → inspector "Color"'))))));
    for (const [cat, list] of Object.entries(cats)) {
      const sec = el('div', { class: 'lib-section' }, el('h4', {}, N(EFFECT_CATS[cat]) || cat));
      const grid = el('div', { class: 'fx-grid' });
      for (const d of list) {
        const cv = el('canvas', { width: 160, height: 90 });
        const tile = el('div', { class: 'fx-item', draggable: 'true', title: N(d.name) + '\n' + L('Ziehen auf Clip oder Klick = auf Auswahl anwenden', 'Drag onto clip or click = apply to selection') }, cv, el('div', { class: 'nm' }, N(d.name)));
        tile.addEventListener('dragstart', (e) => e.dataTransfer.setData('velox/effect', d.id));
        tile.addEventListener('click', () => { if (store.selection.size) run('applyEffect', { type: d.id }); else toast(L('Clip auswählen oder Effekt auf Clip ziehen', 'Select a clip or drag the effect onto one')); });
        requestIdleCallback(() => { try { renderEffectPreview(d.id, cv); } catch (e) { console.warn(d.id, e); } });
        animateOnHover(tile, cv, (c, k) => { try { renderEffectPreview(d.id, c, k * 2); } catch {} }, 2);
        grid.appendChild(tile);
      }
      sec.appendChild(grid); host.appendChild(sec);
    }
  };
  fill();
}

// ------------------------------------------------------------------ transitions
function transitionsTab(body) {
  body.appendChild(el('div', { class: 'lib-toolbar' },
    el('span', { class: 'muted', style: { flex: 1 } }, L('Auf einen Schnitt ziehen · Hover = Vorschau', 'Drag onto a cut · hover = preview')),
    el('label', { class: 'muted' }, L('Standard-Dauer', 'Default duration')),
    (() => { const i = el('input', { type: 'number', value: settings.defaultTransitionDur, step: 0.05, min: 0.05, max: 5 }); i.onchange = () => setSetting('defaultTransitionDur', +i.value); i.addEventListener('keydown', (e) => e.stopPropagation()); return i; })()));
  const cats = {};
  for (const d of Object.values(TRANSITIONS)) (cats[d.cat] ||= []).push(d);
  for (const [cat, list] of Object.entries(cats)) {
    const sec = el('div', { class: 'lib-section' }, el('h4', {}, N(TRANSITION_CATS[cat]) || cat));
    const grid = el('div', { class: 'fx-grid' });
    for (const d of list) {
      const cv = el('canvas', { width: 160, height: 90 });
      const tile = el('div', { class: 'fx-item', draggable: 'true', title: N(d.name) }, cv, el('div', { class: 'nm' }, N(d.name)));
      tile.addEventListener('dragstart', (e) => e.dataTransfer.setData('velox/transition', d.id));
      tile.addEventListener('click', () => run('addTransition', { type: d.id }).catch(() => {}));
      tile.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [{ label: L('Als Start-Übergang auf Auswahl', 'As intro on selection'), action: () => run('setClipTransition', { edge: 'in', type: d.id }).catch(() => {}) }, { label: L('Als End-Übergang auf Auswahl', 'As outro on selection'), action: () => run('setClipTransition', { edge: 'out', type: d.id }).catch(() => {}) }, { label: L('Start + Ende auf Auswahl', 'Intro + outro on selection'), action: () => run('setClipTransition', { edge: 'both', type: d.id }).catch(() => {}) }, '-', { label: L('Als Standard-Übergang', 'Set as default'), action: () => { setSetting('defaultTransition', d.id); toast(L('Standard: ', 'Default: ') + N(d.name)); } }, { label: L('Auf alle Schnitte', 'Apply to all cuts'), action: () => run('transitionsAll', { type: d.id }) }]); });
      requestIdleCallback(() => { try { renderTransitionPreview(d.id, cv, 0.45); } catch (e) { console.warn(d.id, e); } });
      animateOnHover(tile, cv, (c, k) => { try { renderTransitionPreview(d.id, c, k); } catch {} }, 1.4);
      grid.appendChild(tile);
    }
    sec.appendChild(grid); body.appendChild(sec);
  }
}

// ------------------------------------------------------------------ presets
function presetsTab(body) {
  body.appendChild(el('div', { class: 'lib-toolbar' }, el('span', { class: 'muted' }, L('Klick = auf Auswahl anwenden · ziehen = auf Clip', 'Click = apply to selection · drag onto clip')),
    el('button', { class: 'btn small', onclick: () => run('savePresetFromClip') }, '+ ' + L('Von Clip speichern', 'Save from clip'))));
  const groups = [['realism', L('Realismus', 'Realism')], ['color', L('Color Grading / Filmlooks', 'Color grading / film looks')], ['cinematic', 'Cinematic'], ['gaming', L('Gaming-Edits', 'Gaming edits')], ['audio', 'Audio']];
  const user = [...(userPresets.effects || []), ...(userPresets.color || [])];
  if (user.length) groups.unshift(['__user', L('Eigene Presets', 'My presets')]);
  for (const [k, name] of groups) {
    const list = k === '__user' ? user : BUILTIN_PRESETS.filter((p) => p.kind === k);
    const sec = el('div', { class: 'lib-section' }, el('h4', {}, name));
    const grid = el('div', { class: 'fx-grid' });
    for (const p of list) {
      const cv = el('canvas', { width: 160, height: 90 });
      const tile = el('div', { class: 'fx-item', draggable: 'true' }, k === 'audio' ? el('div', { class: 'pv', style: { display: 'grid', placeItems: 'center', fontSize: '22px', color: '#5ff0bd' } }, '♫') : cv, el('div', { class: 'nm' }, p.name));
      tile.addEventListener('dragstart', (e) => e.dataTransfer.setData('velox/preset', p.id));
      tile.addEventListener('click', () => run('applyPreset', { id: p.id }).catch(() => {}));
      if (k === '__user') tile.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [{ label: L('Preset löschen', 'Delete preset'), action: () => { deletePreset('effects', p.id); deletePreset('color', p.id); } }]); });
      if (k !== 'audio') { requestIdleCallback(() => { try { renderPresetPreview(p, cv); } catch {} }); animateOnHover(tile, cv, (c, kk) => { try { renderPresetPreview(p, c, kk * 2); } catch {} }, 2); }
      grid.appendChild(tile);
    }
    sec.appendChild(grid); body.appendChild(sec);
  }
}

// ------------------------------------------------------------------ templates (new project formats + auto-edit templates)
function templatesTab(body) { tplTab(body); }

// ------------------------------------------------------------------ store
function storeTab(body) {
  const sec = el('div', { class: 'lib-section' });
  sec.appendChild(el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => run('installPlugin') }, L('Plugin installieren (Ordner)…', 'Install plugin (folder)…')), el('button', { class: 'btn small', onclick: () => ipcRenderer.invoke('shell:open', path.join(paths.userData, 'plugins')) }, L('Plugin-Ordner öffnen', 'Open plugin folder'))));
  sec.appendChild(el('h4', {}, L('Pakete', 'Packs')));
  const inst = installedPacks();
  for (const pk of STORE_PACKS) {
    sec.appendChild(el('div', { class: 'list-item', style: { background: 'var(--bg2)', marginBottom: '6px' } },
      el('span', { class: 'ic', style: { background: pk.color } }, pk.icon),
      el('div', { style: { flex: 1 } }, el('div', {}, el('b', {}, pk.name), ' ', el('span', { class: 'muted' }, '· ' + pk.items.length + ' ' + L('Elemente', 'items'))), el('div', { class: 'muted', style: { fontSize: '11px' } }, N(pk.desc))),
      inst.has(pk.id) ? el('span', { class: 'chip on' }, L('Installiert', 'Installed')) : el('button', { class: 'btn small primary', onclick: () => { installPack(pk.id); renderBody(); toast(pk.name + L(' installiert', ' installed'), 'ok'); } }, L('Installieren', 'Install'))));
  }
  sec.appendChild(el('h4', {}, L('Plugins', 'Plugins')));
  for (const pl of window.__plugins || []) sec.appendChild(el('div', { class: 'list-item' }, el('span', { class: 'ic' }, '🧩'), el('div', {}, el('b', {}, pl.name), el('div', { class: 'muted', style: { fontSize: '11px' } }, pl.description || ''))));
  if (!(window.__plugins || []).length) sec.appendChild(el('div', { class: 'muted' }, L('Keine Plugins geladen', 'No plugins loaded')));
  body.appendChild(sec);
}

// ------------------------------------------------------------------ AI hub
function aiTab(body) {
  const sec = el('div', { class: 'lib-section' });
  const item = (icon, name, desc, cmd, args) => el('div', { class: 'list-item', onclick: () => run(cmd, args) }, el('span', { class: 'ic' }, icon), el('div', {}, el('div', {}, name), el('div', { class: 'muted', style: { fontSize: '11px' } }, desc)));
  sec.append(
    el('button', { class: 'nr-btn', onclick: () => run('neuralRender') }, el('span', { class: 'dlss-t' }, '✦ Neural Rendering'), el('span', { class: 'dlss-s' }, L('Generative KI malt jedes Bild realistischer – Stärke einstellbar (auch GTA)', 'Generative AI repaints every frame more realistically – adjustable (incl. GTA)'))),
    el('button', { class: 'dlss-btn', onclick: () => run('dlss5') }, el('span', { class: 'dlss-t' }, '⚡ DLSS5'), el('span', { class: 'dlss-s' }, L('KI-Realismus: Gesichter, Autos, Umgebung – Stärke einstellbar', 'AI realism: faces, cars, surroundings – adjustable strength'))),
    el('h4', {}, L('Automatisch editieren', 'Automatic editing')),
    item('✨', 'Auto-Edit', L('Komplettes Edit aus Clips + Musik (Beats, Velocity, Übergänge, Looks)', 'Full edit from clips + music (beats, velocity, transitions, looks)'), 'autoEditDialog'),
    item('🎵', L('Beats erkennen', 'Detect beats'), L('Marker auf jeden Beat des Musikclips', 'Markers on every beat of the music clip'), 'aiBeats'),
    item('✂', L('Auf Beats schneiden', 'Cut to beats'), L('Ausgewählte Clips an Beat-Markern teilen', 'Split selected clips at beat markers'), 'aiCutToBeats'),
    item('🎬', L('Szenenerkennung', 'Scene detection'), L('Clip an Szenenwechseln teilen', 'Split clip at scene changes'), 'aiSceneDetect'),
    item('🔇', L('Stille entfernen', 'Remove silence'), L('Leise Stellen automatisch herausschneiden', 'Cut out quiet parts automatically'), 'aiRemoveSilence'),
    item('⭐', L('Highlights finden', 'Find highlights'), L('Lauteste/actionreichste Momente → Marker', 'Loudest / most action moments → markers'), 'aiHighlights'),
    item('🎯', 'Smart Cut', L('Beste Momente aus langem Rohmaterial in neue Sequenz', 'Best moments of long footage into a new sequence'), 'smartCut'),
    item('🎨', L('KI-Farbabgleich', 'AI color match'), L('Clip B an Look von Clip A angleichen', 'Match clip B to clip A'), 'colorMatch'),
    el('h4', {}, L('Bild & Video', 'Image & video')),
    item('🌅', 'VELOX Realism', L('Realistischerer Look per GPU (jede Grafikkarte)', 'More realistic look via GPU (any graphics card)'), 'applyPreset', { id: 'real_photo' }),
    item('🙈', L('Gesichter zensieren', 'Censor faces'), L('KI findet & verfolgt jedes Gesicht → verpixeln / Blur / Balken', 'AI finds & follows every face → pixelate / blur / bar'), 'censorFacesDialog'),
    item('▦', L('Objekt zensieren / Tracking-Maske', 'Censor object / tracked mask'), L('Bereich wählen → folgt dem Objekt (Kennzeichen, Logos, Maske)', 'Pick a region → follows the object (plates, logos, mask)'), 'censorObject'),
    item('🎯', L('Objekt-Tracking', 'Object tracking'), L('Bereich verfolgen → Text/Clip folgt', 'Track a region → text/clip follows'), 'aiTrack'),
    item('📐', 'Auto-Reframe', L('Auf 9:16 / 1:1 umformatieren und Motiv folgen', 'Reformat to 9:16 / 1:1 and follow the subject'), 'aiReframe'),
    item('🫨', L('Stabilisieren', 'Stabilize'), L('Verwackelte Aufnahmen glätten (vid.stab)', 'Smooth shaky footage (vid.stab)'), 'aiStabilize'),
    item('🟩', L('Hintergrund entfernen (Key)', 'Remove background (key)'), L('Auto-Chroma-Key aus Randfarbe', 'Auto chroma key from border color'), 'aiAutoKey'),
    el('h4', {}, L('Neuronale KI (erfindet Details, läuft auf deiner GPU)', 'Neural AI (invents detail, runs on your GPU)')),
    item('🧠', L('KI-Details neu erfinden', 'AI detail reconstruction'), L('Real-ESRGAN rekonstruiert Texturen & Kanten bei gleicher Auflösung', 'Real-ESRGAN rebuilds textures at the same resolution'), 'aiDetail'),
    item('🔍', L('KI-Hochskalieren ×2 / ×4', 'AI upscale ×2 / ×4'), L('Echtes Upscaling z. B. 1080p → 4K mit neuen Details', 'True upscaling, e.g. 1080p → 4K'), 'aiUpscale'),
    item('🙂', L('KI-Gesichtsverbesserung', 'AI face restore'), L('GFPGAN schärft & rekonstruiert Gesichter', 'GFPGAN restores faces'), 'aiFaceRestore'),
    item('✂', L('KI-Hintergrund entfernen', 'AI background removal'), L('Person/Objekt freistellen ohne Green Screen (Video mit Alpha)', 'Cut out subject without green screen'), 'aiRemoveBg'),
    item('🐢', L('KI-Zeitlupe (RIFE)', 'AI slow motion (RIFE)'), L('Echte Zwischenbilder ×2/×4/×8 – butterweiche Slowmo', 'Real in-between frames ×2/×4/×8'), 'aiSlowmo'),
    item('🎤', L('Stimme isolieren (neuronal)', 'Isolate voice (neural)'), L('RNNoise entfernt Musik/Spielgeräusche hinter Sprache', 'RNNoise removes background noise behind speech'), 'aiVoiceIsolate'),
    item('📦', L('KI-Modelle verwalten', 'Manage AI models'), L('Installieren / Status', 'Install / status'), 'aiModels'),
    el('h4', {}, L('Audio & Sprache', 'Audio & speech')),
    item('💬', L('Automatische Untertitel', 'Auto subtitles'), L('Sprache → animierte Untertitel (Whisper, lokal)', 'Speech → animated captions (Whisper, local)'), 'aiSubtitles'),
    item('🗣', L('Text-zu-Sprache', 'Text to speech'), L('Windows-Stimmen (DE/EN), lokal', 'Windows voices, local'), 'aiTTS'),
    item('🎙', L('Audio verbessern', 'Enhance audio'), L('Rauschen, EQ, Kompression, Lautheit', 'Noise, EQ, compression, loudness'), 'aiEnhanceAudio'),
    el('h4', {}, L('Steuerung durch KI-Assistenten', 'Control by AI assistants')),
    item('🤖', L('Automations-API', 'Automation API'), L('Claude & Skripte können VELOX fernsteuern (HTTP + MCP)', 'Claude & scripts can drive VELOX (HTTP + MCP)'), 'showApiInfo'),
  );
  body.appendChild(sec);
}
export { selMedia };
