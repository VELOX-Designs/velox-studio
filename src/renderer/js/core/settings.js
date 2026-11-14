// App paths, persistent user settings, user presets.
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
import { bus, deepClone } from './util.js';

export const paths = {};
export async function initPaths() {
  Object.assign(paths, await ipcRenderer.invoke('app:paths'));
  for (const sub of ['', 'autosave', 'cache', 'plugins', 'presets', 'library', 'models', 'projects']) {
    fs.mkdirSync(path.join(paths.userData, sub), { recursive: true });
  }
  // Documents can be blocked (Windows "controlled folder access", OneDrive offline …) → fall back to other places
  const SUBS = ['', 'Projekte', 'Exporte', 'Aufnahmen', 'KI-Ergebnisse', 'Vorlagen', 'Standbilder', 'Sicherungen', 'Fotos'];
  for (const base of [paths.documents, paths.videos, paths.home, paths.userData].filter(Boolean)) {
    try { const v = path.join(base, 'VELOX Studio'); for (const sub of SUBS) fs.mkdirSync(path.join(v, sub), { recursive: true }); fs.writeFileSync(path.join(v, '.write-test'), '1'); fs.unlinkSync(path.join(v, '.write-test')); paths.velox = v; break; }
    catch (e) { console.warn('VELOX folder not writable:', base, e.message); }
  }
  if (!paths.velox) paths.velox = path.join(paths.userData, 'VELOX Studio');
  paths.projects = path.join(paths.velox, 'Projekte');
}

const DEFAULTS = {
  lang: 'de',
  mode: 'pro', // simple | pro | expert
  workspace: 'edit',
  autosaveSec: 60,
  previewQuality: 'auto', // full | half | quarter | auto
  autoProxy: true,
  proxyHeight: 720,
  proxyAboveHeight: 1440,
  snapping: true,
  magnet: true,
  rippleDefault: false,
  defaultStillDur: 5,
  defaultTransitionDur: 0.5,
  showWaveforms: true,
  showFilmstrip: true,
  recent: [],
  shortcuts: {},
  layout: {},
  hwAccel: 'auto',
  exportDir: '',
  whisperModel: '',
  libraryFolders: [],
  accent: '#1ec8d4',
};

export const settings = deepClone(DEFAULTS);
let file = '';
export function loadSettings() {
  file = path.join(paths.userData, 'settings.json');
  try { Object.assign(settings, JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))); } catch {}
  if (!settings.exportDir || settings.exportDir === paths.desktop) settings.exportDir = path.join(paths.velox, 'Exporte');
}
let saveT = null;
export function saveSettings() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { fs.writeFileSync(file, JSON.stringify(settings, null, 2)); } catch (e) { console.error(e); }
  }, 200);
}
export function setSetting(k, v) { settings[k] = v; saveSettings(); bus.emit('settings', k, v); }

export function addRecent(p) {
  settings.recent = [p, ...settings.recent.filter((x) => x !== p)].slice(0, 12);
  saveSettings();
}

// ------------------------------------------------------------------ user presets
// kinds: effects, color, text, transition, velocity, template
let presetsFile = '';
export let userPresets = { effects: [], color: [], text: [], transition: [], velocity: [], template: [] };
export function loadPresets() {
  presetsFile = path.join(paths.userData, 'presets', 'user-presets.json');
  try { Object.assign(userPresets, JSON.parse(fs.readFileSync(presetsFile, 'utf8'))); } catch {}
}
export function savePreset(kind, preset) {
  (userPresets[kind] ||= []).push(preset);
  fs.writeFileSync(presetsFile, JSON.stringify(userPresets, null, 2));
  bus.emit('presets');
}
export function deletePreset(kind, id) {
  userPresets[kind] = (userPresets[kind] || []).filter((p) => p.id !== id);
  fs.writeFileSync(presetsFile, JSON.stringify(userPresets, null, 2));
  bus.emit('presets');
}
