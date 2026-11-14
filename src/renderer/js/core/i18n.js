// Bilingual UI: L('Deutsch', 'English') picks by current language. Panels re-render on change.
import { settings, setSetting } from './settings.js';
import { bus } from './util.js';

export const L = (de, en) => (settings.lang === 'en' ? (en ?? de) : de);
export const N = (obj) => (obj ? (settings.lang === 'en' ? obj.en || obj.de : obj.de || obj.en) : '');

const STATIC = {
  export: ['Exportieren', 'Export'],
  timeline_view: ['Timeline', 'Timeline'],
};
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((n) => { const s = STATIC[n.dataset.i18n]; if (s) n.textContent = L(s[0], s[1]); });
}
export function setLang(l) { setSetting('lang', l); document.documentElement.lang = l; applyStatic(); bus.emit('lang', l); }
