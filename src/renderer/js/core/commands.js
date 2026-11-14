// Central command registry. Menus, keyboard shortcuts, the command palette and the
// external automation API (Claude / scripts) all execute the very same commands.
import { bus } from './util.js';
import { settings, saveSettings } from './settings.js';
import { N } from './i18n.js';

export const commands = new Map();

// cmd: { id, name:{de,en}, cat, key, run(args) -> any, enabled?() , args?: description, hidden? }
export function registerCommand(cmd) { commands.set(cmd.id, cmd); return cmd; }
export function registerCommands(list) { list.forEach(registerCommand); }

export async function run(id, args = {}) {
  const c = commands.get(id);
  if (!c) throw new Error('Unbekannter Befehl: ' + id);
  if (c.enabled && !c.enabled()) return { ok: false, reason: 'disabled' };
  try {
    const r = await c.run(args || {});
    bus.emit('command', id, args);
    return r;
  } catch (e) {
    console.error(id, e);
    bus.emit('toast', (N(c.name) || id) + ': ' + e.message, 'err');
    throw e;
  }
}

// ------------------------------------------------------------------ key bindings
export function keyOf(id) {
  if (settings.shortcuts && Object.prototype.hasOwnProperty.call(settings.shortcuts, id)) return settings.shortcuts[id];
  return commands.get(id)?.key || '';
}
export function setKey(id, combo) {
  settings.shortcuts ||= {};
  // remove combo from other commands
  if (combo) for (const [cid] of commands) if (cid !== id && normalize(keyOf(cid)) === normalize(combo)) settings.shortcuts[cid] = '';
  settings.shortcuts[id] = combo;
  saveSettings(); rebuildKeymap(); bus.emit('keymap');
}
export function resetKeys() { settings.shortcuts = {}; saveSettings(); rebuildKeymap(); bus.emit('keymap'); }

const normalize = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase().split('+').sort().join('+')).join(',');
let keymap = new Map();
export function rebuildKeymap() {
  keymap = new Map();
  for (const [id] of commands) {
    const k = keyOf(id); if (!k) continue;
    for (const combo of k.split(',')) keymap.set(normalize(combo), id);
  }
}
export function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let k = e.key;
  if (k === ' ') k = 'Space';
  else if (k.length === 1) k = k.toUpperCase();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return parts.join('+');
  // shifted digits/symbols -> use code for stability
  if (e.code?.startsWith('Digit')) k = e.code.slice(5);
  if (e.code === 'NumpadAdd' || k === '+') k = '+'; if (e.code === 'NumpadSubtract' || k === '-') k = '-';
  parts.push(k === '+' ? 'Plus' : k);
  return parts.join('+');
}
export function commandForEvent(e) { return keymap.get(normalize(comboFromEvent(e))); }
