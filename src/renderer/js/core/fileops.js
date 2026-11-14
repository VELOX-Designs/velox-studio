// Project files: new / open / save / save as, autosave + crash recovery, project packaging.
import { store, newProject, repairProject } from './project.js';
import { bus, el, deepClone } from './util.js';
import { settings, paths, addRecent } from './settings.js';
import { L } from './i18n.js';
import { registerCommands } from './commands.js';
import { ensureMediaCaches } from './media.js';
import { modal, toast, confirmBox } from '../ui/dialogs.js';
import { PROJECT_TEMPLATES } from '../ui/presets.js';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

export const EXT = 'velox';

function serialize(p) { const c = deepClone(p); for (const m of c.media) { delete m._proxying; } return JSON.stringify(c, null, 1); }

export async function saveProject(as = false) {
  let file = store.filePath;
  if (!file || as) {
    const r = await ipcRenderer.invoke('dialog:save', { defaultPath: path.join(paths.projects, (store.p.name || 'Projekt') + '.' + EXT), filters: [{ name: 'VELOX Projekt', extensions: [EXT] }] });
    if (r.canceled) return false;
    file = r.filePath;
    if (store.p.name === 'Unbenanntes Projekt') store.p.name = path.basename(file, '.' + EXT);
  }
  const data = serialize(store.p);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  if (fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.bak'); } catch {} }
  fs.renameSync(tmp, file);
  store.filePath = file; store.dirty = false;
  addRecent(file);
  bus.emit('saved', file);
  toast(L('Gespeichert: ', 'Saved: ') + path.basename(file), 'ok', 1800);
  return true;
}

export async function openProject(file) {
  if (!(await confirmDiscard())) return false;
  if (!file) {
    const r = await ipcRenderer.invoke('dialog:open', { defaultPath: paths.projects, filters: [{ name: 'VELOX Projekt', extensions: [EXT, 'json'] }], properties: ['openFile'] });
    if (r.canceled) return false; file = r.filePaths[0];
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    // corrupted → try backup
    const bak = file + '.bak';
    if (fs.existsSync(bak) && (await confirmBox(L('Projektdatei ist beschädigt. Sicherung (.bak) laden?', 'Project file is corrupted. Load backup (.bak)?')))) raw = JSON.parse(fs.readFileSync(bak, 'utf8'));
    else { toast(L('Projekt konnte nicht geladen werden: ', 'Could not load project: ') + e.message, 'err'); return false; }
  }
  const before = (raw.clips || []).length;
  store.load(raw, file);
  const dropped = before - store.p.clips.length;
  addRecent(file);
  ensureMediaCaches();
  checkMissingMedia();
  if (dropped > 0) toast(L(`${dropped} beschädigte Clips wurden repariert/entfernt`, `${dropped} damaged clips were repaired/removed`), 'err', 6000);
  return true;
}

export async function newProjectDialog(force = false) {
  if (!force && !(await confirmDiscard())) return;
  { const { showHome } = await import('../ui/home.js'); showHome({ closable: !force }); return; }
  const name = el('input', { type: 'text', value: L('Neues Projekt', 'New project'), style: { width: '100%' } });
  name.addEventListener('keydown', (e) => e.stopPropagation());
  let pick = PROJECT_TEMPLATES[1];
  const tiles = el('div', { class: 'preset-tiles' }, ...PROJECT_TEMPLATES.map((t) => {
    const n = el('div', { class: 'tile' + (t === pick ? ' sel' : ''), style: t === pick ? { borderColor: 'var(--ac)' } : {}, onclick: () => { pick = t; tiles.querySelectorAll('.tile').forEach((x) => (x.style.borderColor = '')); n.style.borderColor = 'var(--ac)'; } }, el('b', {}, t.name), el('span', {}, t.sub));
    return n;
  }));
  const recent = el('div', {}, ...settings.recent.filter((f) => fs.existsSync(f)).slice(0, 8).map((f) => el('div', { class: 'list-item', onclick: () => { m.close(); openProject(f); } }, el('span', { class: 'ic' }, '🎞'), el('div', {}, el('div', {}, path.basename(f, '.' + EXT)), el('div', { class: 'muted', style: { fontSize: '11px' } }, path.dirname(f))))));
  const m = modal({ title: L('VELOX Studio – Projekt', 'VELOX Studio – project'), width: 900,
    body: el('div', { class: 'welcome' },
      el('div', {}, el('div', { style: { fontWeight: 700, marginBottom: '8px' } }, L('Neues Projekt', 'New project')), name, el('div', { style: { height: '10px' } }), tiles),
      el('div', {}, el('div', { style: { fontWeight: 700, marginBottom: '8px' } }, L('Zuletzt geöffnet', 'Recent')), recent.children.length ? recent : el('div', { class: 'muted' }, L('Noch keine Projekte', 'No projects yet')),
        el('div', { class: 'row', style: { marginTop: '12px' } }, el('button', { class: 'btn', onclick: () => { m.close(); openProject(); } }, L('Projekt öffnen…', 'Open project…'))))),
    buttons: [{ label: L('Erstellen', 'Create'), cls: 'primary', onClick: () => { store.load(newProject({ name: name.value, width: pick.w, height: pick.h, fps: pick.fps })); } }] });
}

async function confirmDiscard() {
  if (!store.dirty || !store.p.clips.length) return true;
  return new Promise((res) => modal({ title: L('Ungespeicherte Änderungen', 'Unsaved changes'), body: L('Änderungen am aktuellen Projekt speichern?', 'Save changes to the current project?'),
    buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: L('Verwerfen', 'Discard'), value: 'discard', cls: 'danger' }, { label: L('Speichern', 'Save'), cls: 'primary', onClick: async () => ((await saveProject()) ? 'saved' : false) }],
    onClose: (v) => res(v === 'discard' || v === 'saved') }));
}
export { confirmDiscard };

function checkMissingMedia() {
  const missing = store.p.media.filter((m) => !fs.existsSync(m.path));
  if (!missing.length) return;
  modal({ title: L('Fehlende Medien', 'Missing media'), body: el('div', { style: { maxWidth: '560px' } }, el('p', {}, L(`${missing.length} Datei(en) nicht gefunden. Ordner wählen, in dem gesucht werden soll:`, `${missing.length} file(s) not found. Choose a folder to search:`)),
    el('div', { class: 'muted', style: { maxHeight: '160px', overflow: 'auto' } }, ...missing.map((m) => el('div', {}, m.path)))),
    buttons: [{ label: L('Später', 'Later'), value: null }, { label: L('Ordner durchsuchen…', 'Search folder…'), cls: 'primary', onClick: async () => {
      const r = await ipcRenderer.invoke('dialog:open', { properties: ['openDirectory'] }); if (r.canceled) return false;
      const index = new Map(); const walk = (d, depth = 0) => { if (depth > 5) return; for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p, depth + 1); else index.set(f.name.toLowerCase(), p); } };
      try { walk(r.filePaths[0]); } catch {}
      let n = 0; store.edit('Neu verknüpfen', () => { for (const m of missing) { const p = index.get(path.basename(m.path).toLowerCase()); if (p) { m.path = p; m.proxyPath = null; n++; } } });
      toast(L(`${n} von ${missing.length} Dateien neu verknüpft`, `${n} of ${missing.length} relinked`), n ? 'ok' : 'err'); ensureMediaCaches();
    } }] });
}

// ------------------------------------------------------------------ autosave & recovery
let autosaveTimer = null;
export function startAutosave() {
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => {
    if (!store.dirty) return;
    try {
      const dir = path.join(paths.userData, 'autosave');
      const f = path.join(dir, `autosave_${store.p.id}.velox`);
      fs.writeFileSync(f, JSON.stringify({ ...store.p, __filePath: store.filePath }));
      // keep the 10 newest
      const all = fs.readdirSync(dir).map((n) => path.join(dir, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      all.slice(10).forEach((x) => fs.unlinkSync(x));
      if (store.filePath) fs.writeFileSync(store.filePath + '.autosave', JSON.stringify(store.p));
      bus.emit('autosaved');
    } catch (e) { console.warn('autosave', e); }
  }, Math.max(15, settings.autosaveSec) * 1000);
}
export async function checkRecovery() {
  const marker = path.join(paths.userData, 'clean-exit');
  const dir = path.join(paths.userData, 'autosave');
  const cleanAt = fs.existsSync(marker) ? +fs.readFileSync(marker, 'utf8') : 0;
  try { fs.unlinkSync(marker); } catch {}
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => path.join(dir, n)).filter((f) => fs.statSync(f).mtimeMs > cleanAt + 1000).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs) : [];
  if (!files.length) return false;
  const f = files[0];
  let raw; try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return false; }
  if (!(raw.clips || []).length) return false;
  const ok = await confirmBox(L(`VELOX wurde nicht sauber beendet. Automatisch gesicherte Version von „${raw.name}“ (${new Date(fs.statSync(f).mtimeMs).toLocaleString()}) wiederherstellen?`, `VELOX did not exit cleanly. Restore autosaved version of "${raw.name}"?`), { ok: L('Wiederherstellen', 'Restore') });
  if (!ok) return false;
  const fp = raw.__filePath || null; delete raw.__filePath;
  store.load(raw, fp); store.dirty = true;
  ensureMediaCaches();
  toast(L('Projekt wiederhergestellt', 'Project restored'), 'ok');
  return true;
}

// ------------------------------------------------------------------ package / import
export async function packageProject() {
  const r = await ipcRenderer.invoke('dialog:open', { properties: ['openDirectory', 'createDirectory'], title: L('Zielordner für Projektpaket', 'Target folder for package') });
  if (r.canceled) return;
  const dir = path.join(r.filePaths[0], (store.p.name || 'Projekt').replace(/[\\/:*?"<>|]/g, '_') + '_Paket');
  const mdir = path.join(dir, 'Media'); fs.mkdirSync(mdir, { recursive: true });
  const p = deepClone(store.p);
  let n = 0;
  for (const m of p.media) {
    if (!fs.existsSync(m.path)) continue;
    let dest = path.join(mdir, path.basename(m.path));
    if (fs.existsSync(dest) && fs.statSync(dest).size !== fs.statSync(m.path).size) dest = path.join(mdir, m.id + '_' + path.basename(m.path));
    if (!fs.existsSync(dest)) fs.copyFileSync(m.path, dest);
    m.path = 'Media/' + path.basename(dest); m.relative = true; m.proxyPath = null; n++;
  }
  fs.writeFileSync(path.join(dir, (store.p.name || 'Projekt') + '.' + EXT), JSON.stringify(p, null, 1));
  toast(L(`Projekt gepackt (${n} Medien): `, `Packaged (${n} media): `) + dir, 'ok', 6000);
  ipcRenderer.invoke('shell:open', dir);
}
// resolve relative media paths after loading packaged projects
bus.on('project:loaded', () => {
  if (!store.filePath) return;
  const base = path.dirname(store.filePath);
  for (const m of store.p.media) if (m.relative || !path.isAbsolute(m.path)) { m.path = path.join(base, m.path); m.relative = false; }
});

registerCommands([
  { id: 'newProject', name: { de: 'Neues Projekt…', en: 'New project…' }, cat: 'file', key: 'Ctrl+N', run: () => newProjectDialog() },
  { id: 'openProject', name: { de: 'Projekt öffnen…', en: 'Open project…' }, cat: 'file', key: 'Ctrl+O', args: '{ file? }', run: ({ file } = {}) => openProject(file) },
  { id: 'saveProject', name: { de: 'Speichern', en: 'Save' }, cat: 'file', key: 'Ctrl+S', run: () => saveProject(false) },
  { id: 'saveProjectAs', name: { de: 'Speichern unter…', en: 'Save as…' }, cat: 'file', key: 'Ctrl+Shift+S', run: () => saveProject(true) },
  { id: 'saveProjectTo', name: { de: 'Speichern nach Pfad (API)', en: 'Save to path (API)' }, cat: 'file', hidden: true, args: '{ file }', run: ({ file }) => { store.filePath = file; return saveProject(false); } },
  { id: 'packageProject', name: { de: 'Projekt packen (mit Medien)…', en: 'Package project (with media)…' }, cat: 'file', run: () => packageProject() },
  { id: 'exportProjectJson', name: { de: 'Projektdatei exportieren…', en: 'Export project file…' }, cat: 'file', run: async () => { const r = await ipcRenderer.invoke('dialog:save', { defaultPath: (store.p.name || 'Projekt') + '.json', filters: [{ name: 'JSON', extensions: ['json'] }] }); if (!r.canceled) { fs.writeFileSync(r.filePath, serialize(store.p)); toast('OK', 'ok'); } } },
  { id: 'importProjectFile', name: { de: 'Projektdatei importieren (zusammenführen)…', en: 'Import project file (merge)…' }, cat: 'file', run: async () => {
    const r = await ipcRenderer.invoke('dialog:open', { filters: [{ name: 'VELOX', extensions: [EXT, 'json'] }], properties: ['openFile'] }); if (r.canceled) return;
    const other = repairProject(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
    store.edit('Projekt importieren', (p) => {
      const off = store.duration();
      for (const m of other.media) if (!p.media.find((x) => x.path === m.path)) p.media.push(m);
      const trackMap = new Map();
      for (const t of other.tracks) { const same = p.tracks.filter((x) => x.kind === t.kind)[other.tracks.filter((x) => x.kind === t.kind).indexOf(t)]; if (same) trackMap.set(t.id, same.id); else { p.tracks.push(t); trackMap.set(t.id, t.id); } }
      for (const c of other.clips) { const m = other.media.find((x) => x.id === c.mediaId); if (m) c.mediaId = p.media.find((x) => x.path === m.path).id; c.trackId = trackMap.get(c.trackId); c.start += off; p.clips.push(c); }
      p.transitions.push(...other.transitions);
    });
    ensureMediaCaches();
  } },
]);
