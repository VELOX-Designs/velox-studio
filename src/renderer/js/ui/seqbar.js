// Sequence tabs above the timeline + source monitor (preview media, set in/out, insert/overwrite).
import { store, clipEnd, splitAt } from '../core/project.js';
import { el, $, bus, tc, fileUrl, clamp } from '../core/util.js';
import { L } from '../core/i18n.js';
import { allSeqs, switchSeq, newSeq, renameSeq, deleteSeq, ensureSeqs } from '../core/sequences.js';
import { contextMenu, promptBox, toast } from './dialogs.js';
import { placeMedia } from '../core/media.js';
import { run } from '../core/commands.js';
import { tl } from './timeline.js';

export function initSeqBar() {
  const bar = el('div', { id: 'seq-tabs' });
  $('#panel-timeline').insertBefore(bar, $('#tl-toolbar'));
  const render = () => {
    ensureSeqs(store.p);
    bar.innerHTML = '';
    const list = allSeqs();
    // stable order: by creation (active first is confusing) → keep p.seqOrder
    const order = store.p.seqOrder || (store.p.seqOrder = list.map((s) => s.id));
    for (const s of list) if (!order.includes(s.id)) order.push(s.id);
    const sorted = order.map((id) => list.find((s) => s.id === id)).filter(Boolean);
    for (const s of sorted) {
      const tab = el('button', { class: 'seq-tab' + (s.active ? ' active' : ''), title: L('Doppelklick: umbenennen · Rechtsklick: Optionen', 'Double-click: rename · right-click: options'),
        onclick: () => switchSeq(s.id),
        ondblclick: async () => { const n = await promptBox(L('Sequenzname', 'Sequence name'), s.name); if (n) renameSeq(s.id, n); },
        oncontextmenu: (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
          { label: L('Umbenennen', 'Rename'), action: async () => { const n = await promptBox(L('Sequenzname', 'Sequence name'), s.name); if (n) renameSeq(s.id, n); } },
          { label: L('Duplizieren', 'Duplicate'), action: () => { switchSeq(s.id); run('duplicateSequence'); } },
          { label: L('9:16-Version erstellen', 'Create 9:16 version'), action: () => { switchSeq(s.id); run('verticalVersion'); } },
          '-', { label: L('Löschen', 'Delete'), action: () => { try { deleteSeq(s.id); } catch (er) { toast(er.message, 'err'); } } }]); } },
        '🎞 ' + s.name);
      bar.appendChild(tab);
    }
    bar.appendChild(el('button', { class: 'seq-tab add', title: L('Neue Sequenz', 'New sequence'), onclick: (e) => contextMenu(e.clientX, e.clientY, [
      { label: L('Leere Sequenz (gleiches Format)', 'Empty sequence (same format)'), action: () => newSeq({}) },
      { label: L('Leere 9:16 (TikTok/Reels)', 'Empty 9:16 (TikTok/Reels)'), action: () => newSeq({ width: 1080, height: 1920, name: '9:16' }) },
      { label: L('Leere 16:9 4K (YouTube)', 'Empty 16:9 4K (YouTube)'), action: () => newSeq({ width: 3840, height: 2160, name: 'YouTube 4K' }) },
      { label: L('Diese duplizieren', 'Duplicate current'), action: () => run('duplicateSequence') },
      { label: L('9:16-Version dieser Sequenz', '9:16 version of this'), action: () => run('verticalVersion') }]) }, '+'));
  };
  bus.on('sequences', render); bus.on('project:loaded', render); bus.on('changed', (l) => { if (l !== 'live') render(); }); bus.on('lang', render);
  render();
}

// ------------------------------------------------------------------ source monitor
let mon = null;
export function openSourceMonitor(media) {
  closeSourceMonitor();
  if (media.type === 'audio' && !media.duration) return;
  const st = { in: 0, out: media.duration || 5 };
  const v = el(media.type === 'audio' ? 'audio' : media.type === 'image' ? 'img' : 'video', { src: fileUrl(media.path), style: { width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' } });
  if (v.tagName !== 'IMG') { v.preload = 'auto'; }
  const tcEl = el('span', { class: 'tc' }, '00:00:00:00');
  const io = el('span', { class: 'muted' });
  const bar = el('div', { class: 'srcmon-bar' }); const range = el('div', { class: 'srcmon-range' }); const head = el('div', { class: 'srcmon-head' }); bar.append(range, head);
  const fps = media.fps || store.fps;
  const upd = () => {
    const t = v.currentTime || 0; const d = media.duration || 1;
    tcEl.textContent = tc(t, fps); head.style.left = (t / d) * 100 + '%';
    range.style.left = (st.in / d) * 100 + '%'; range.style.width = ((st.out - st.in) / d) * 100 + '%';
    io.textContent = `IN ${tc(st.in, fps)} · OUT ${tc(st.out, fps)} · ${tc(st.out - st.in, fps)}`;
  };
  v.addEventListener('timeupdate', upd); v.addEventListener('loadedmetadata', upd);
  const scrub = (e) => { const r = bar.getBoundingClientRect(); v.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * (media.duration || 0); upd(); };
  bar.addEventListener('mousedown', (e) => { scrub(e); const mv = (ev) => scrub(ev); window.addEventListener('mousemove', mv); window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mv), { once: true }); });
  const place = (insert) => {
    const t = Math.round(store.time * store.fps) / store.fps;
    store.edit(insert ? 'Einfügen (Insert)' : 'Überschreiben', (p) => {
      if (insert) splitAt(p, t);
      const cs = placeMedia(p, media, t, { videoTrackId: tl.targetVideo, audioTrackId: tl.targetAudio, insert, inPoint: st.in, outPoint: media.type === 'image' ? null : st.out });
      store.select(cs.map((c) => c.id));
    });
    toast(insert ? L('Eingefügt (Insert)', 'Inserted') : L('Überschrieben', 'Overwritten'), 'ok', 1200);
  };
  const btn = (label, title, fn) => el('button', { class: 'icon-btn', title, onclick: fn }, label);
  const panel = el('div', { class: 'srcmon' },
    el('div', { class: 'srcmon-top' }, el('b', {}, '🎬 ' + L('Quell-Monitor: ', 'Source: ') + media.name), el('span', { class: 'spacer' }), btn('✕', L('Schließen (Esc)', 'Close (Esc)'), closeSourceMonitor)),
    el('div', { class: 'srcmon-video' }, v), bar,
    el('div', { class: 'srcmon-ctl' }, tcEl,
      btn('◀|', L('Frame zurück', 'Back'), () => { v.currentTime = Math.max(0, v.currentTime - 1 / fps); }),
      btn('▶', 'Play/Pause', () => (v.paused ? v.play() : v.pause())),
      btn('|▶', L('Frame vor', 'Forward'), () => { v.currentTime += 1 / fps; }),
      btn('{', L('In-Punkt (I)', 'Mark in (I)'), () => { st.in = v.currentTime || 0; if (st.out <= st.in) st.out = media.duration; upd(); }),
      btn('}', L('Out-Punkt (O)', 'Mark out (O)'), () => { st.out = v.currentTime || media.duration; if (st.in >= st.out) st.in = 0; upd(); }),
      io, el('span', { class: 'spacer' }),
      el('button', { class: 'btn small', title: L('Einfügen: verschiebt nachfolgende Clips (,)', 'Insert: ripples following clips (,)'), onclick: () => place(true) }, L('⤵ Einfügen', '⤵ Insert')),
      el('button', { class: 'btn small primary', title: L('Überschreiben am Playhead (.)', 'Overwrite at playhead (.)'), onclick: () => place(false) }, L('⬇ Überschreiben', '⬇ Overwrite'))));
  // drag the marked range onto the timeline
  panel.querySelector('.srcmon-video').draggable = true;
  panel.querySelector('.srcmon-video').addEventListener('dragstart', (e) => { e.dataTransfer.setData('velox/media', JSON.stringify([media.id])); window.__dragMedia = { ...media, duration: st.out - st.in }; window.__dragRange = { in: st.in, out: st.out }; });
  const keys = (e) => {
    if (!mon) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { closeSourceMonitor(); e.stopPropagation(); return; }
    if (!panel.matches(':hover')) return;
    const map = { i: () => panel.querySelectorAll('.srcmon-ctl .icon-btn')[3].click(), o: () => panel.querySelectorAll('.srcmon-ctl .icon-btn')[4].click(), ' ': () => (v.paused ? v.play() : v.pause()), ',': () => place(true), '.': () => place(false), arrowleft: () => { v.currentTime -= 1 / fps; }, arrowright: () => { v.currentTime += 1 / fps; } };
    if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); }
  };
  window.addEventListener('keydown', keys, true);
  $('#viewer-stage').appendChild(panel);
  mon = { panel, keys, v };
}
export function closeSourceMonitor() { if (!mon) return; mon.v.pause?.(); window.removeEventListener('keydown', mon.keys, true); mon.panel.remove(); mon = null; }
