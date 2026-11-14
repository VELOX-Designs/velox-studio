// Modals, toasts, context menus, prompts.
import { el, $ } from '../core/util.js';
import { L } from '../core/i18n.js';

export function toast(msg, type = '', ms = 3200) {
  const t = el('div', { class: 'toast ' + type }, msg);
  $('#toast-root').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}

export function modal({ title, body, buttons = [], width, onClose, closable = true }) {
  const root = $('#modal-root');
  const box = el('div', { class: 'modal', style: width ? { width: width + 'px' } : null });
  const close = (v) => { bg.remove(); document.removeEventListener('keydown', esc, true); onClose?.(v); };
  const esc = (e) => { if (e.key === 'Escape' && closable) { e.stopPropagation(); close(null); } };
  const head = el('div', { class: 'modal-h' }, title || '', closable ? el('button', { class: 'icon-btn x', onclick: () => close(null) }, '✕') : null);
  const b = el('div', { class: 'modal-b' });
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
  box.append(head, b);
  if (buttons.length) {
    const f = el('div', { class: 'modal-f' });
    for (const bt of buttons) {
      const btn = el('button', { class: 'btn ' + (bt.cls || ''), onclick: async () => { if (!bt.onClick) { close(bt.value); return; } const r = await bt.onClick(); if (r !== false) close(r === undefined ? bt.value : r); } }, bt.label);
      f.appendChild(btn);
    }
    box.appendChild(f);
  }
  const bg = el('div', { class: 'modal-bg', onmousedown: (e) => { if (e.target === bg && closable) close(null); } }, box);
  root.appendChild(bg);
  document.addEventListener('keydown', esc, true);
  return { close, body: b, box };
}

export function confirmBox(text, { ok = L('OK', 'OK'), cancel = L('Abbrechen', 'Cancel'), danger = false } = {}) {
  return new Promise((res) => {
    modal({ title: L('Bestätigen', 'Confirm'), body: el('div', { style: { whiteSpace: 'pre-wrap', maxWidth: '480px' } }, text),
      buttons: [{ label: cancel, value: false }, { label: ok, value: true, cls: danger ? 'danger' : 'primary' }], onClose: (v) => res(!!v) });
  });
}
export function promptBox(title, value = '', { multiline = false } = {}) {
  return new Promise((res) => {
    const inp = multiline ? el('textarea', { rows: 6 }) : el('input', { type: 'text', style: { width: '360px' } });
    inp.value = value;
    const m = modal({ title, body: inp, buttons: [{ label: L('Abbrechen', 'Cancel'), value: null }, { label: 'OK', cls: 'primary', onClick: () => inp.value }], onClose: (v) => res(v) });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); m.close(inp.value); } });
    setTimeout(() => { inp.focus(); inp.select?.(); }, 30);
  });
}

// items: [{label, key, action, disabled, sub:[...]}, '-']
let openMenu = null;
export function contextMenu(x, y, items) {
  closeMenu();
  const root = $('#ctx-root');
  const build = (list, px, py) => {
    const m = el('div', { class: 'ctx-menu' });
    for (const it of list) {
      if (it === '-' || !it) { if (it === '-') m.appendChild(el('div', { class: 'sep' })); continue; }
      const mi = el('div', { class: 'mi' + (it.disabled ? ' dis' : '') + (it.sub ? ' sub' : '') }, it.check !== undefined ? (it.check ? '✓ ' : ' ') + it.label : it.label, it.key ? el('span', { class: 'k' }, it.key) : null);
      if (it.sub) {
        let subEl = null;
        mi.addEventListener('mouseenter', () => { m.querySelectorAll('.ctx-sub').forEach((s) => s.remove()); const r = mi.getBoundingClientRect(); subEl = build(it.sub, r.right - 2, r.top - 4); subEl.classList.add('ctx-sub'); m.appendChild(subEl); });
      } else {
        mi.addEventListener('mouseenter', () => m.querySelectorAll(':scope > .ctx-sub').forEach((s) => s.remove()));
        mi.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.action?.(); });
      }
      m.appendChild(mi);
    }
    m.style.left = px + 'px'; m.style.top = py + 'px';
    root.appendChild(m);
    const r = m.getBoundingClientRect();
    if (r.right > innerWidth) m.style.left = Math.max(0, px - r.width) + 'px';
    if (r.bottom > innerHeight) m.style.top = Math.max(0, innerHeight - r.height - 4) + 'px';
    return m;
  };
  openMenu = build(items, x, y);
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
}
function outside(e) { if (!e.target.closest('.ctx-menu')) closeMenu(); }
export function closeMenu() { $('#ctx-root').innerHTML = ''; openMenu = null; document.removeEventListener('mousedown', outside, true); document.querySelectorAll('.menu-top.open').forEach((n) => n.classList.remove('open')); }

export function progressModal(title) {
  const bar = el('i'); const txt = el('div', { class: 'muted', style: { marginTop: '8px' } }, '');
  let cancelled = false; let onCancel = null;
  const m = modal({ title, closable: false, body: el('div', { style: { width: '440px' } }, el('div', { class: 'progress' }, bar), txt),
    buttons: [{ label: L('Abbrechen', 'Cancel'), onClick: () => { cancelled = true; onCancel?.(); return false; } }] });
  return { set(p, t) { bar.style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%'; if (t !== undefined) txt.textContent = t; }, close: () => m.close(), get cancelled() { return cancelled; }, onCancel(f) { onCancel = f; } };
}
