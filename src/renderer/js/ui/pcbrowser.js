// PC folder browser: favourite folders (e.g. Rockstar Editor / WR Exports), lazy tree, hover video
// preview, drag files or whole folders into the media pool or straight onto the timeline.
import { el, $, fileUrl, shortTime, fmtBytes, bus, uid } from '../core/util.js';
import { L } from '../core/i18n.js';
import { settings, setSetting, paths } from '../core/settings.js';
import { store } from '../core/project.js';
import { ALL_EXT, VIDEO_EXT, AUDIO_EXT, IMAGE_EXT, importFiles, appendToMain } from '../core/media.js';
import { makePoster } from '../core/ffmpeg.js';
import { contextMenu, toast, promptBox } from './dialogs.js';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
export function defaultFavorites() {
  const c = [
    ['Desktop', paths.desktop || path.join(home, 'Desktop')], ['Videos', paths.videos || path.join(home, 'Videos')], ['Downloads', path.join(home, 'Downloads')],
    ['Bilder', path.join(home, 'Pictures')], ['Musik', paths.music || path.join(home, 'Music')],
    ['WR Exports (Rockstar)', path.join(home, 'Videos', 'WR Exports')], ['Rockstar Editor Ablage', path.join(home, 'Desktop', 'Rockstar Editor Ablage')],
    ['Rockstar Editor Bilder', path.join(home, 'Desktop', 'Rockstar Editor Bilder')], ['Medal', path.join(home, 'Videos', 'Medal')],
    ['Radeon ReLive', path.join(home, 'Videos', 'Radeon ReLive')], ['Captures', path.join(home, 'Videos', 'Captures')],
  ];
  return c.filter(([, p]) => fs.existsSync(p)).map(([name, p]) => ({ name, path: p }));
}
const favs = () => (settings.pcFavorites?.length ? settings.pcFavorites : (settings.pcFavorites = defaultFavorites()));
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const isMedia = (f) => ALL_EXT.includes(extOf(f));
const kindOf = (f) => (VIDEO_EXT.includes(extOf(f)) ? 'video' : AUDIO_EXT.includes(extOf(f)) ? 'audio' : IMAGE_EXT.includes(extOf(f)) ? 'image' : null);

let cur = null; // current folder
let sortBy = 'date';
const posterCache = new Map();

export function listMedia(dir, recursive = false) {
  const out = [];
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (recursive && depth < 6) walk(p, depth + 1); }
      else if (isMedia(e.name)) { let st = null; try { st = fs.statSync(p); } catch {} out.push({ path: p, name: e.name, size: st?.size || 0, mtime: st?.mtimeMs || 0 }); }
    }
  };
  walk(dir, 0);
  return out;
}
function sortFiles(list) {
  if (sortBy === 'date') return list.sort((a, b) => a.mtime - b.mtime);
  if (sortBy === 'dateDesc') return list.sort((a, b) => b.mtime - a.mtime);
  if (sortBy === 'size') return list.sort((a, b) => b.size - a.size);
  return list.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
}

// import a folder as its own media bin, optional date-based renaming (Rockstar mode)
export async function importFolder(dir, { recursive = true, rockstar = false, toTimeline = false } = {}) {
  const files = sortFiles(listMedia(dir, recursive));
  if (!files.length) { toast(L('Keine Medien im Ordner', 'No media in folder')); return []; }
  let folder = store.p.folders.find((f) => f.name === path.basename(dir));
  if (!folder) { folder = { id: uid('fld'), name: path.basename(dir), parent: 'root' }; store.edit('Ordner', (p) => p.folders.push(folder)); }
  toast(L(`Importiere ${files.length} Dateien…`, `Importing ${files.length} files…`));
  const ms = await importFiles(files.map((f) => f.path), folder.id);
  if (rockstar) {
    store.edit('Rockstar sortieren', () => {
      ms.forEach((m, i) => { const st = files.find((f) => f.path === m.path); const d = new Date(st?.mtime || Date.now()); const pad = (n) => String(n).padStart(2, '0');
        m.name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())} · ${String(i + 1).padStart(2, '0')} ${m.name.replace(/\.[^.]+$/, '')}`; m.shotAt = st?.mtime; });
    });
  }
  if (toTimeline) store.edit('In Timeline', (p) => { const cs = appendToMain(p, ms); store.select(cs.map((c) => c.id)); });
  toast(L(`${ms.length} Medien importiert`, `${ms.length} media imported`), 'ok');
  return ms;
}

export function pcTab(body) {
  body.appendChild(el('div', { class: 'lib-toolbar' },
    el('button', { class: 'btn small primary', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openDirectory'] }); if (!r.canceled) { addFav(r.filePaths[0]); cur = r.filePaths[0]; rerender(); } } }, '+ ' + L('Ordner hinzufügen', 'Add folder')),
    el('button', { class: 'btn small', title: L('Dateien vom PC wählen', 'Pick files from PC'), onclick: () => import('./library.js').then((m) => m.importDialog()) }, '📄 ' + L('Dateien…', 'Files…')),
    (() => { const s = el('select', { title: L('Sortierung', 'Sort') }, el('option', { value: 'date' }, L('Datum ↑', 'Date ↑')), el('option', { value: 'dateDesc' }, L('Datum ↓', 'Date ↓')), el('option', { value: 'name' }, 'Name'), el('option', { value: 'size' }, L('Größe', 'Size'))); s.value = sortBy; s.onchange = () => { sortBy = s.value; rerender(); }; return s; })()));
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column' } });
  body.appendChild(wrap);
  const rerender = () => { body.innerHTML = ''; pcTab(body); };
  // favourites
  const fl = el('div', { class: 'lib-section' }, el('h4', {}, L('Favoriten', 'Favourites')));
  for (const f of favs()) {
    const row = el('div', { class: 'list-item', draggable: 'true', style: cur === f.path ? { background: 'var(--acs)' } : {}, title: f.path, onclick: () => { cur = f.path; rerender(); } },
      el('span', { class: 'ic' }, /rockstar|wr export/i.test(f.name + f.path) ? '🎬' : '📁'), el('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.name));
    row.addEventListener('dragstart', (e) => dragFolder(e, f.path));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); folderMenu(e, f.path, f); });
    fl.appendChild(row);
  }
  wrap.appendChild(fl);
  if (!cur) { wrap.appendChild(el('div', { class: 'muted', style: { padding: '8px 12px' } }, L('Ordner wählen – dann Dateien oder ganze Ordner in Medien oder Timeline ziehen.', 'Pick a folder – then drag files or whole folders into media or timeline.'))); return; }
  // breadcrumb + subfolders
  const crumb = el('div', { class: 'lib-section' });
  const parent = path.dirname(cur);
  crumb.appendChild(el('div', { class: 'row' },
    el('button', { class: 'icon-btn', title: L('Ordner hoch', 'Up'), onclick: () => { if (parent !== cur) { cur = parent; rerender(); } } }, '⬆'),
    el('b', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: cur }, path.basename(cur) || cur),
    el('button', { class: 'btn small', onclick: () => importFolder(cur, { recursive: false }) }, L('Alles importieren', 'Import all')),
    el('button', { class: 'btn small', onclick: () => importFolder(cur, { recursive: false, toTimeline: true }) }, L('→ Timeline', '→ Timeline')),
    el('button', { class: 'btn small', title: L('Rockstar: nach Aufnahmedatum sortieren & benennen', 'Rockstar: sort & name by date'), onclick: () => importFolder(cur, { recursive: true, rockstar: true }) }, '🎬')));
  let subs = []; try { subs = fs.readdirSync(cur, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$')).map((e) => e.name); } catch {}
  for (const s of subs.slice(0, 200)) {
    const p = path.join(cur, s);
    const row = el('div', { class: 'list-item', draggable: 'true', style: { padding: '4px 10px' }, onclick: () => { cur = p; rerender(); } }, el('span', {}, '📁'), el('span', { style: { flex: 1 } }, s));
    row.addEventListener('dragstart', (e) => dragFolder(e, p));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); folderMenu(e, p); });
    crumb.appendChild(row);
  }
  wrap.appendChild(crumb);
  // files
  const files = sortFiles(listMedia(cur, false));
  const grid = el('div', { class: 'media-grid' });
  if (!files.length) grid.appendChild(el('div', { class: 'muted', style: { padding: '8px' } }, L('Keine Medien in diesem Ordner', 'No media in this folder')));
  const sel = new Set();
  for (const f of files.slice(0, 400)) {
    const kind = kindOf(f.name);
    const th = el('div', { class: 'th', style: { background: kind === 'audio' ? 'linear-gradient(135deg,#123a2e,#0d1f1a)' : '#000' } },
      kind === 'audio' ? el('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: '24px', color: '#5ff0bd' } }, '♫') : null,
      el('span', { class: 'badge' }, kind === 'video' ? 'VID' : kind === 'image' ? 'IMG' : 'AUD'),
      el('span', { class: 'dur' }, new Date(f.mtime).toLocaleDateString() + ' · ' + fmtBytes(f.size)));
    const item = el('div', { class: 'media-item', draggable: 'true', title: f.path }, th, el('div', { class: 'nm' }, f.name));
    if (kind === 'image') th.style.background = `#000 url("${fileUrl(f.path)}") center/cover`;
    else if (kind === 'video') {
      const io = new IntersectionObserver((ents) => { if (!ents[0].isIntersecting) return; io.disconnect(); poster(f).then((p) => { if (p) th.style.background = `#000 url("${fileUrl(p)}") center/cover`; }); });
      io.observe(item);
      let v = null;
      th.addEventListener('mouseenter', () => { v = el('video', { src: fileUrl(f.path), muted: true, autoplay: true, loop: true, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } }); v.muted = true; th.appendChild(v); });
      th.addEventListener('mousemove', (e) => { if (!v || !v.duration) return; const r = th.getBoundingClientRect(); v.pause(); v.currentTime = ((e.clientX - r.left) / r.width) * v.duration; });
      th.addEventListener('mouseleave', () => { v?.remove(); v = null; });
    }
    item.addEventListener('click', (e) => { if (!e.ctrlKey && !e.shiftKey) { sel.clear(); grid.querySelectorAll('.media-item').forEach((n) => n.classList.remove('sel')); } sel.has(f.path) ? sel.delete(f.path) : sel.add(f.path); item.classList.toggle('sel', sel.has(f.path)); });
    item.addEventListener('dblclick', async () => { const [m] = await importFiles([f.path]); if (m) store.edit('Einfügen', (p) => appendToMain(p, [m])); });
    item.addEventListener('dragstart', (e) => { const list = sel.has(f.path) ? [...sel] : [f.path]; e.dataTransfer.setData('velox/files', JSON.stringify(list)); e.dataTransfer.effectAllowed = 'copy'; window.__dragMedia = { type: kind, duration: 5 }; });
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
      { label: L('In Medien importieren', 'Import to media'), action: () => importFiles(sel.has(f.path) ? [...sel] : [f.path]) },
      { label: L('An Timeline anhängen', 'Append to timeline'), action: async () => { const ms = await importFiles(sel.has(f.path) ? [...sel] : [f.path]); store.edit('Anhängen', (p) => appendToMain(p, ms)); } },
      { label: L('Im Explorer zeigen', 'Show in Explorer'), action: () => ipcRenderer.invoke('shell:show', f.path) }]); });
    grid.appendChild(item);
  }
  wrap.appendChild(grid);
}
async function poster(f) {
  if (posterCache.has(f.path)) return posterCache.get(f.path);
  const pr = makePoster({ path: f.path, type: 'video', duration: 3 }).catch(() => null);
  posterCache.set(f.path, pr); return pr;
}
function dragFolder(e, dir) { e.dataTransfer.setData('velox/folder', dir); e.dataTransfer.effectAllowed = 'copy'; window.__dragMedia = { type: 'video', duration: 10 }; }
function addFav(p) { const f = favs(); if (!f.some((x) => x.path === p)) { f.push({ name: path.basename(p), path: p }); setSetting('pcFavorites', f); } }
function folderMenu(e, p, fav) {
  contextMenu(e.clientX, e.clientY, [
    { label: L('Als Medien-Ordner importieren', 'Import as media bin'), action: () => importFolder(p, { recursive: true }) },
    { label: L('Importieren + an Timeline anhängen', 'Import + append to timeline'), action: () => importFolder(p, { recursive: true, toTimeline: true }) },
    { label: L('Rockstar-Modus (nach Datum sortieren & benennen)', 'Rockstar mode (sort & name by date)'), action: () => importFolder(p, { recursive: true, rockstar: true }) },
    '-',
    fav ? { label: L('Umbenennen', 'Rename'), action: async () => { const n = await promptBox('Name', fav.name); if (n) { fav.name = n; setSetting('pcFavorites', favs()); bus.emit('library:tab', 'pc'); } } } : { label: L('Zu Favoriten', 'Add to favourites'), action: () => { addFav(p); bus.emit('library:tab', 'pc'); } },
    fav ? { label: L('Aus Favoriten entfernen', 'Remove from favourites'), action: () => { setSetting('pcFavorites', favs().filter((x) => x.path !== p)); if (cur === p) cur = null; bus.emit('library:tab', 'pc'); } } : null,
    { label: L('Im Explorer öffnen', 'Open in Explorer'), action: () => ipcRenderer.invoke('shell:open', p) },
  ].filter(Boolean));
}
