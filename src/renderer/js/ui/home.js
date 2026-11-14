// Start screen (launcher): continue last project, open recent, start new from a format template.
// Also the central "VELOX folder" where everything VELOX produces is collected.
import { store, newProject } from '../core/project.js';
import { el, $, bus, fileUrl } from '../core/util.js';
import { L } from '../core/i18n.js';
import { settings, paths } from '../core/settings.js';
import { registerCommands } from '../core/commands.js';
import { PROJECT_TEMPLATES } from './presets.js';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

export const VELOX_SUBDIRS = { projects: 'Projekte', photos: 'Fotos', exports: 'Exporte', recordings: 'Aufnahmen', ai: 'KI-Ergebnisse', templates: 'Vorlagen', stills: 'Standbilder', backups: 'Sicherungen' };
export function veloxDir(kind) { const d = kind ? path.join(paths.velox, VELOX_SUBDIRS[kind] || kind) : paths.velox; fs.mkdirSync(d, { recursive: true }); return d; }
export function logHistory(text) {
  try { const f = path.join(paths.velox, 'Verlauf.md'); const d = new Date(); fs.appendFileSync(f, `- ${d.toLocaleDateString()} ${d.toLocaleTimeString()} — ${text}\n`); } catch {}
}
bus.on('saved', (f) => { logHistory(L('Projekt gespeichert: ', 'Project saved: ') + f); saveThumb(f); });
bus.on('export:done', (f) => logHistory(L('Video exportiert: ', 'Video exported: ') + f));
function saveThumb(file) {
  try { const c = $('#preview-canvas'); if (!c) return; const t = document.createElement('canvas'); t.width = 320; t.height = Math.round((320 * c.height) / c.width); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); fs.writeFileSync(file + '.jpg', Buffer.from(t.toDataURL('image/jpeg', 0.8).split(',')[1], 'base64')); } catch {}
}

export function showHome({ closable = true } = {}) {
  closeHome();
  const recent = settings.recent.filter((f) => fs.existsSync(f));
  const card = (f) => {
    const thumb = fs.existsSync(f + '.jpg') ? `url("${fileUrl(f + '.jpg')}?${fs.statSync(f + '.jpg').mtimeMs}")` : 'linear-gradient(135deg,#1e222b,#111318)';
    const st = fs.statSync(f);
    return el('div', { class: 'home-card', onclick: async () => { closeHome(); const { openProject } = await import('../core/fileops.js'); openProject(f); } },
      el('div', { class: 'home-thumb', style: { backgroundImage: thumb } }), el('div', { class: 'home-name' }, path.basename(f).replace(/\.velox$/, '')), el('div', { class: 'muted', style: { fontSize: '11px' } }, new Date(st.mtimeMs).toLocaleString()));
  };
  const name = el('input', { type: 'text', value: L('Neues Projekt', 'New project'), class: 'home-input' });
  name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') create({ w: 1920, h: 1080, fps: 30, auto: true }); });
  const create = (t) => { const p = newProject({ name: name.value || 'Projekt', width: t.w, height: t.h, fps: t.fps }); p.settings.autoFormat = !!t.auto; store.load(p); closeHome(); };
  const root = el('div', { id: 'home' },
    el('div', { class: 'home-side' },
      el('div', { class: 'brand', style: { gap: '10px', marginBottom: '26px' } }, el('span', { class: 'logo', style: { width: '40px', height: '40px', fontSize: '22px' } }, 'V'), el('div', {}, el('div', { class: 'brand-name', style: { fontSize: '20px' } }, 'VELOX', el('b', {}, 'Studio')), el('div', { class: 'muted' }, 'v' + paths.version))),
      el('button', { class: 'home-btn primary', onclick: () => create({ w: 1920, h: 1080, fps: 30, auto: true }) }, '＋ ' + L('Neues Projekt', 'New project')),
      el('button', { class: 'home-btn', onclick: async () => { closeHome(); const { openProject } = await import('../core/fileops.js'); if (!(await openProject())) showHome(); } }, '📂 ' + L('Projekt öffnen…', 'Open project…')),
      el('button', { class: 'home-btn photo', onclick: async () => { closeHome(); const { openPhotoMode } = await import('../photo/photo.js'); openPhotoMode(); } }, el('b', {}, '📷 ' + L('Foto-Modus', 'Photo mode')), el('span', {}, L('Bilder bearbeiten wie in Photoshop – Ebenen, Retusche, KI', 'Edit images like Photoshop – layers, retouch, AI'))),
      recent[0] ? el('button', { class: 'home-btn', onclick: async () => { closeHome(); const { openProject } = await import('../core/fileops.js'); openProject(recent[0]); } }, '⏵ ' + L('Weitermachen: ', 'Continue: ') + path.basename(recent[0]).replace(/\.velox$/, '')) : null,
      el('button', { class: 'home-btn', onclick: () => ipcRenderer.invoke('shell:open', veloxDir()) }, '🗂 ' + L('VELOX-Ordner öffnen', 'Open VELOX folder')),
      el('div', { class: 'spacer' }),
      el('div', { class: 'muted', style: { fontSize: '11px', lineHeight: 1.6 } }, L('Alles, was du mit VELOX machst, liegt in:', 'Everything you make with VELOX is in:'), el('br'), paths.velox),
      closable ? el('button', { class: 'home-btn', onclick: closeHome }, '✕ ' + L('Schließen', 'Close')) : null),
    el('div', { class: 'home-main' },
      el('h2', {}, L('Neues Projekt', 'New project')),
      el('div', { class: 'row', style: { marginBottom: '12px' } }, el('span', { class: 'muted' }, L('Name', 'Name')), name),
      el('div', { class: 'home-orient' }, ...[['h', L('Horizontal', 'Landscape'), L('YouTube, normale Videos', 'YouTube, regular'), 1920, 1080], ['v', L('Vertikal', 'Vertical'), L('TikTok, Reels, Shorts', 'TikTok, Reels, Shorts'), 1080, 1920], ['s', L('Quadratisch', 'Square'), 'Instagram', 1080, 1080]].map(([k, nm, sub, w, h]) =>
        el('div', { class: 'home-format' + (k === 'h' ? ' main' : ''), onclick: () => create({ w, h, fps: 30, auto: true }) }, el('div', { class: 'home-ratio', style: { aspectRatio: `${w}/${h}`, [w >= h ? 'width' : 'height']: '46px' } }), el('b', {}, nm), el('span', { class: 'muted' }, sub)))),
      el('div', { class: 'muted', style: { marginTop: '10px', lineHeight: 1.6 } }, L('Einfach starten – die Framerate übernimmt VELOX automatisch vom ersten Clip. Die Auflösung (720p bis 8K) wählst du erst beim Exportieren.', 'Just start – VELOX takes the frame rate from your first clip. Pick the resolution (720p–8K) when exporting.')),
      photoRecent(),
      el('h2', { style: { marginTop: '26px' } }, L('Zuletzt bearbeitet', 'Recent projects')),
      recent.length ? el('div', { class: 'home-grid' }, ...recent.slice(0, 12).map(card)) : el('div', { class: 'muted' }, L('Noch keine Projekte – starte oben ein neues.', 'No projects yet – start a new one above.'))));
  document.body.appendChild(root);
  setTimeout(() => name.focus(), 50);
}
function photoRecent() {
  const rec = (settings.photoRecent || []).filter((f) => fs.existsSync(f)).slice(0, 6);
  if (!rec.length) return null;
  const open = async (f) => { closeHome(); const { openPhotoMode } = await import('../photo/photo.js'); openPhotoMode(f); };
  return el('div', {}, el('h2', { style: { marginTop: '26px' } }, L('Zuletzt bearbeitete Fotos', 'Recent photos')), el('div', { class: 'home-grid' }, ...rec.map((f) => {
    const th = fs.existsSync(f + '.jpg') ? f + '.jpg' : /\.vxfoto$/i.test(f) ? null : f;
    return el('div', { class: 'home-card', onclick: () => open(f) }, el('div', { class: 'home-thumb', style: { backgroundImage: th ? `url("${fileUrl(th)}")` : 'linear-gradient(135deg,#1e222b,#111318)' } }), el('div', { class: 'home-name' }, '📷 ' + path.basename(f)));
  })));
}
export function closeHome() { $('#home')?.remove(); }

registerCommands([
  { id: 'home', name: { de: 'Startbildschirm', en: 'Start screen' }, cat: 'file', key: 'Ctrl+Shift+H', run: () => showHome() },
  { id: 'openVeloxFolder', name: { de: 'VELOX-Ordner öffnen', en: 'Open VELOX folder' }, cat: 'file', run: () => ipcRenderer.invoke('shell:open', veloxDir()) },
]);
