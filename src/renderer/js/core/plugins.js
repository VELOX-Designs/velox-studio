// Plugin system. A plugin is a folder with manifest.json { name, main, description } and a CommonJS
// main file exporting activate(api). The api can register effects (GLSL), transitions, commands, presets.
import { defineEffect, EFFECTS } from '../render/effects.js';
import { defineTransition } from '../render/transitions.js';
import { registerCommand, run } from './commands.js';
import { BUILTIN_PRESETS } from '../ui/presets.js';
import { store } from './project.js';
import { bus } from './util.js';
import { paths } from './settings.js';
import { GLSL_HEADER } from '../render/gl.js';
import { registerCommands } from './commands.js';
import { toast } from '../ui/dialogs.js';
import { L } from './i18n.js';
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

window.__plugins = [];
function apiFor(manifest) {
  return {
    version: 1, GLSL_HEADER,
    defineEffect: (id, d) => defineEffect(id, { cat: 'stylize', ...d }),
    defineTransition: (id, d) => defineTransition(id, { cat: 'basic', ...d }),
    registerCommand, run, store, bus,
    addPreset: (p) => BUILTIN_PRESETS.push({ id: p.id || 'pl_' + Math.random().toString(36).slice(2), kind: 'effects', ...p }),
    toast,
  };
}
export function loadPlugins() {
  const dirs = [path.join(paths.appUnpacked || paths.appRoot, 'plugins'), path.join(paths.userData, 'plugins')];
  for (const base of dirs) {
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      const mf = path.join(dir, 'manifest.json');
      if (!fs.existsSync(mf)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
        if (window.__plugins.some((p) => p.name === manifest.name)) continue;
        const mod = require(path.join(dir, manifest.main || 'index.js'));
        mod.activate?.(apiFor(manifest));
        window.__plugins.push({ ...manifest, dir });
      } catch (e) { console.error('Plugin', name, e); toast(`Plugin ${name}: ${e.message}`, 'err'); }
    }
  }
}
registerCommands([
  { id: 'installPlugin', name: { de: 'Plugin installieren…', en: 'Install plugin…' }, cat: 'file', run: async () => {
    const r = await ipcRenderer.invoke('dialog:open', { properties: ['openDirectory'], title: L('Plugin-Ordner (mit manifest.json) wählen', 'Choose plugin folder (with manifest.json)') });
    if (r.canceled) return;
    const src = r.filePaths[0];
    if (!fs.existsSync(path.join(src, 'manifest.json'))) { toast(L('Kein manifest.json gefunden', 'No manifest.json found'), 'err'); return; }
    const dest = path.join(paths.userData, 'plugins', path.basename(src));
    fs.cpSync(src, dest, { recursive: true });
    loadPlugins();
    toast(L('Plugin installiert: ', 'Plugin installed: ') + path.basename(src), 'ok');
    bus.emit('library:tab', 'store');
  } },
]);
