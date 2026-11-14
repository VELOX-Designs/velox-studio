// Audio mixer (per-track fader, pan, EQ, mute/solo, live meters), live beat tapping, voice-over recording.
import { store, clipEnd } from '../core/project.js';
import { el, $, bus, uid, clamp, tc } from '../core/util.js';
import { L } from '../core/i18n.js';
import { paths } from '../core/settings.js';
import { engine } from '../playback/engine.js';
import { registerCommands, run } from '../core/commands.js';
import { modal, toast } from './dialogs.js';
import { importFiles, placeMedia, freeAudioTrack } from '../core/media.js';
const fs = require('fs');
const path = require('path');

let mixerOpen = null;
export function openMixer() {
  if (mixerOpen) { mixerOpen.close(); return; }
  const host = el('div', { class: 'mixer' });
  const strips = new Map();
  const build = () => {
    host.innerHTML = ''; strips.clear();
    for (const t of store.p.tracks.filter((x) => x.kind === 'audio')) {
      const meter = el('div', { class: 'mx-meter' }, el('i'));
      const vol = el('input', { type: 'range', min: 0, max: 2, step: 0.01, value: t.volume ?? 1, class: 'mx-fader', orient: 'vertical' });
      const db = el('div', { class: 'mx-db' }, toDb(t.volume ?? 1));
      vol.addEventListener('input', () => { t.volume = +vol.value; db.textContent = toDb(t.volume); engine.applyTrackParams?.(); });
      vol.addEventListener('change', () => store.edit('Spur-Lautstärke', () => {}));
      vol.addEventListener('dblclick', () => { vol.value = 1; t.volume = 1; db.textContent = toDb(1); engine.applyTrackParams?.(); });
      const pan = el('input', { type: 'range', min: -1, max: 1, step: 0.01, value: t.pan || 0, style: { width: '70px' }, title: 'Pan' });
      pan.addEventListener('input', () => { t.pan = +pan.value; engine.applyTrackParams?.(); });
      const eq = (k, label) => { const i = el('input', { type: 'range', min: -18, max: 18, step: 0.5, value: t[k] || 0, style: { width: '70px' }, title: label }); i.addEventListener('input', () => { t[k] = +i.value; engine.applyTrackParams?.(); }); return el('div', { class: 'mx-row' }, el('span', {}, label), i); };
      const strip = el('div', { class: 'mx-strip' },
        el('b', {}, t.name), eq('eqHigh', 'H'), eq('eqMid', 'M'), eq('eqLow', 'L'), el('div', { class: 'mx-row' }, el('span', {}, 'Pan'), pan),
        el('div', { class: 'mx-faderwrap' }, vol, meter), db,
        el('div', { class: 'row', style: { justifyContent: 'center' } },
          el('button', { class: 'icon-btn tb' + (t.muted ? ' on' : ''), onclick: () => store.edit('Stumm', () => { t.muted = !t.muted; }) }, 'M'),
          el('button', { class: 'icon-btn tb' + (t.solo ? ' on' : ''), onclick: () => store.edit('Solo', () => { t.solo = !t.solo; }) }, 'S')));
      strips.set(t.id, meter.firstChild);
      host.appendChild(strip);
    }
    const master = el('div', { class: 'mx-meter master' }, el('i')); strips.set('__master', master.firstChild);
    host.appendChild(el('div', { class: 'mx-strip' }, el('b', {}, 'Master'), el('div', { class: 'mx-faderwrap' }, master), el('div', { class: 'mx-db muted' }, 'L+R')));
  };
  build();
  const offC = bus.on('changed', (l) => { if (l !== 'live') build(); });
  const iv = setInterval(() => {
    for (const [id, bar] of strips) { const lv = id === '__master' ? Math.max(...engine.levels()) : engine.trackLevel?.(id) || 0; bar.style.height = Math.min(100, lv * 100) + '%'; }
  }, 50);
  const m = modal({ title: L('Audio-Mixer', 'Audio mixer'), body: host, width: 760, onClose: () => { clearInterval(iv); offC(); mixerOpen = null; } });
  mixerOpen = m;
}
const toDb = (v) => (v <= 0.0001 ? '-∞ dB' : (20 * Math.log10(v)).toFixed(1) + ' dB');

// ------------------------------------------------------------------ voice-over
let rec = null;
export async function toggleVoiceover() {
  if (rec) { rec.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { toast(L('Kein Mikrofon-Zugriff: ', 'No microphone access: ') + e.message, 'err'); return; }
  const startT = store.time;
  // count-in
  const badge = el('div', { class: 'rec-badge' }, '3'); document.body.appendChild(badge);
  for (const n of ['3', '2', '1']) { badge.textContent = n; await new Promise((r) => setTimeout(r, 650)); }
  badge.textContent = '● REC  ' + L('(Strg+Umschalt+R = Stopp)', '(Ctrl+Shift+R = stop)');
  const chunks = [];
  const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop()); badge.remove(); engine.pause();
    const dir = path.join(paths.velox, 'Aufnahmen'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `Voiceover_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`);
    fs.writeFileSync(file, Buffer.from(await new Blob(chunks).arrayBuffer()));
    const [m] = await importFiles([file]);
    if (m) store.edit('Voiceover', (p) => { const tr = freeAudioTrack(p, startT, startT + m.duration); const cs = placeMedia(p, m, startT, { audioTrackId: tr.id }); cs.forEach((c) => { c.audio.voice = true; c.name = 'Voiceover'; }); store.select(cs.map((c) => c.id)); });
    toast(L('Voiceover aufgenommen', 'Voice-over recorded'), 'ok');
    rec = null;
  };
  mr.start(250); rec = mr;
  engine.seek(startT); engine.play();
}

// ------------------------------------------------------------------ beat tap
let taps = [];
function tapBeat() {
  const t = Math.round(store.time * store.fps) / store.fps;
  store.edit('Beat-Tap', (p) => p.markers.push({ id: uid('mk'), t, name: '', color: '#ff4fa3' }));
  taps.push(performance.now()); taps = taps.slice(-8);
  if (taps.length >= 4) { const d = []; for (let i = 1; i < taps.length; i++) d.push(taps[i] - taps[i - 1]); const avg = d.reduce((a, b) => a + b, 0) / d.length; bus.emit('toast', `♪ ${Math.round(60000 / avg)} BPM`); }
}

registerCommands([
  { id: 'audioMixer', name: { de: 'Audio-Mixer', en: 'Audio mixer' }, cat: 'audio', key: 'Ctrl+Shift+M', run: () => openMixer() },
  { id: 'voiceover', name: { de: 'Voiceover aufnehmen (Start/Stopp)', en: 'Record voice-over (start/stop)' }, cat: 'audio', key: 'Ctrl+Shift+R', run: () => toggleVoiceover() },
  { id: 'tapBeat', name: { de: 'Beat tippen (Marker beim Abspielen)', en: 'Tap beat (marker while playing)' }, cat: 'audio', key: 'Shift+B', run: () => tapBeat() },
]);
