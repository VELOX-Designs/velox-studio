// Audio controls popover + voice/sound effects (pitch, robot, telephone, 8D …).
// Effects are rendered with FFmpeg (rubberband etc.): baked to a cached WAV for preview,
// and applied with the identical filter chain during export.
import { store, clipEnd } from '../core/project.js';
import { el, bus, clamp } from '../core/util.js';
import { L, N } from '../core/i18n.js';
import { run as ff, cacheKey, cacheDir } from '../core/ffmpeg.js';
import { run, registerCommands } from '../core/commands.js';
import { toast } from './dialogs.js';
const fs = require('fs');
const path = require('path');

export const VOICE_FX = {
  none: { n: { de: 'Normal', en: 'Normal' }, f: '' },
  chipmunk: { n: { de: 'Chipmunk (hoch)', en: 'Chipmunk' }, f: 'rubberband=pitch=1.6:formant=shifted' },
  deep: { n: { de: 'Tiefe Stimme', en: 'Deep voice' }, f: 'rubberband=pitch=0.72' },
  monster: { n: { de: 'Monster', en: 'Monster' }, f: 'rubberband=pitch=0.55,aecho=0.8:0.6:40:0.4,bass=g=8' },
  robot: { n: { de: 'Roboter', en: 'Robot' }, f: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75" },
  telephone: { n: { de: 'Telefon', en: 'Telephone' }, f: 'highpass=f=320,lowpass=f=3300,acompressor=threshold=-20dB:ratio=6,volume=1.6' },
  radio: { n: { de: 'Funk / Polizeifunk', en: 'Radio' }, f: 'highpass=f=500,lowpass=f=2800,acrusher=bits=10:mix=0.25,acompressor=threshold=-18dB:ratio=8,volume=1.8' },
  megaphone: { n: { de: 'Megafon', en: 'Megaphone' }, f: 'highpass=f=650,lowpass=f=2400,acrusher=bits=8:mix=0.4,volume=2' },
  underwater: { n: { de: 'Unterwasser', en: 'Underwater' }, f: 'lowpass=f=450,aecho=0.8:0.5:60:0.3' },
  hall: { n: { de: 'Halle / Kirche', en: 'Hall' }, f: 'aecho=0.8:0.88:60|120|240:0.4|0.3|0.2' },
  cave: { n: { de: 'Höhle (Echo)', en: 'Cave echo' }, f: 'aecho=0.8:0.9:500|1000:0.4|0.25' },
  eightd: { n: { de: '8D-Audio (kreisend)', en: '8D audio' }, f: 'apulsator=hz=0.12:amount=0.9' },
  bassboost: { n: { de: 'Bass-Boost', en: 'Bass boost' }, f: 'bass=g=12:f=90,alimiter=limit=0.95' },
  lofi: { n: { de: 'Lo-Fi', en: 'Lo-fi' }, f: 'lowpass=f=3800,highpass=f=120,acrusher=bits=11:mix=0.3,vibrato=f=0.6:d=0.08' },
  muffled: { n: { de: 'Gedämpft (Nebenraum)', en: 'Muffled (next room)' }, f: 'lowpass=f=700,volume=0.9' },
  whisper: { n: { de: 'Flüstern / Geist', en: 'Ghost whisper' }, f: 'highpass=f=1200,aecho=0.6:0.7:120|240:0.5|0.3,volume=1.5' },
  stereo: { n: { de: 'Breites Stereo', en: 'Wide stereo' }, f: 'extrastereo=m=2.2,alimiter' },
  normalize: { n: { de: 'Lautheit normalisieren', en: 'Normalize loudness' }, f: 'loudnorm=I=-14:TP=-1.5:LRA=11' },
};
// presets that change speed (duration) instead of a filter
const SPEED_FX = { nightcore: { n: { de: 'Nightcore (schnell + hoch)', en: 'Nightcore' }, speed: 1.25 }, slowed: { n: { de: 'Slowed + Reverb', en: 'Slowed + reverb' }, speed: 0.82, fx: 'hall' } };

// filter chain for a clip (used by export AND preview baking)
export function audioFxChain(a = {}) {
  const f = [];
  if (a.pitch) f.push(`rubberband=pitch=${Math.pow(2, a.pitch / 12).toFixed(5)}`);
  if (a.voiceFx && VOICE_FX[a.voiceFx]?.f) f.push(VOICE_FX[a.voiceFx].f);
  return f;
}
const baking = new Map();
export async function bakeClipAudio(c) {
  const m = store.media(c.mediaId); if (!m) return;
  const chain = audioFxChain(c.audio);
  if (!chain.length) { if (c.audio.bakedPath) { c.audio.bakedPath = null; bus.emit('changed', 'bake'); } return; }
  const key = cacheKey(m.path) + '_' + require('crypto').createHash('md5').update(chain.join(',')).digest('hex').slice(0, 10);
  const out = path.join(cacheDir('audiofx'), key + '.wav');
  if (!fs.existsSync(out)) {
    if (baking.has(out)) return baking.get(out);
    const job = ff(['-i', m.path, '-vn', '-af', `aformat=sample_rates=48000:channel_layouts=stereo,${chain.join(',')}`, '-ar', '48000', '-ac', '2', out + '.part.wav'], { duration: m.duration })
      .then(() => fs.renameSync(out + '.part.wav', out)).finally(() => baking.delete(out));
    baking.set(out, job);
    toast(L('Audio-Effekt wird berechnet…', 'Rendering audio effect…'), '', 1500);
    await job;
  }
  const cc = store.clip(c.id); if (cc) { cc.audio.bakedPath = out; bus.emit('changed', 'bake'); }
}

function audioTargets() {
  const s = store.selectedClips();
  let a = s.flatMap((c) => (c.type === 'audio' ? [c] : store.linked(c).filter((l) => l.type === 'audio')));
  if (!a.length) { const t = store.time; a = store.p.clips.filter((c) => c.type === 'audio' && c.start <= t && clipEnd(c) > t); }
  return [...new Set(a)];
}
export function applyAudioFx(fields) {
  const a = audioTargets(); if (!a.length) throw new Error(L('Kein Audio am Playhead – Clip anklicken', 'No audio at the playhead – click a clip'));
  store.edit('Audio-Effekt', () => a.forEach((c) => Object.assign(c.audio, fields)));
  a.forEach((c) => bakeClipAudio(store.clip(c.id)).catch((e) => toast(e.message, 'err')));
}

export function audioPopover(anchor) {
  document.querySelectorAll('.popover').forEach((p) => p.remove());
  const a = audioTargets();
  const pop = el('div', { class: 'popover', style: { width: '400px' } });
  if (!a.length) pop.append(el('div', { class: 'muted' }, L('Playhead auf einen Clip mit Ton setzen oder Clip anklicken.', 'Put the playhead on a clip with audio or click one.')));
  else {
    const c = a[0]; if (!store.selection.size) store.select(a.map((x) => x.id));
    const vol = typeof c.volume === 'number' ? c.volume : 1;
    const db = (v) => (v <= 0.001 ? '-∞' : (20 * Math.log10(v)).toFixed(1)) + ' dB';
    const vl = el('b', { class: 'tc' }, db(vol));
    const vs = el('input', { type: 'range', min: 0, max: 3, step: 0.01, value: vol, style: { flex: 1 } });
    vs.oninput = () => { vl.textContent = db(+vs.value); store.p.clips.forEach((x) => { if (a.includes(x)) x.volume = +vs.value; }); store.touch(); };
    vs.onchange = () => store.edit('Lautstärke', () => {});
    const ps = el('input', { type: 'range', min: -12, max: 12, step: 1, value: c.audio.pitch || 0, style: { flex: 1 } });
    const pl = el('b', { class: 'tc' }, (c.audio.pitch || 0) + ' HT');
    ps.oninput = () => { pl.textContent = ps.value + ' HT'; };
    ps.onchange = () => applyAudioFx({ pitch: +ps.value });
    const fadeBtn = (d) => el('span', { class: 'chip', onclick: () => store.edit('Fade', () => a.forEach((x) => { x.fadeIn = Math.min(d, x.dur / 2); x.fadeOut = Math.min(d, x.dur / 2); })) }, d ? d + ' s' : L('aus', 'off'));
    pop.append(
      el('div', { class: 'row' }, el('b', {}, '🔊 ' + L('Audio', 'Audio')), el('span', { class: 'spacer' }), el('span', { class: 'muted' }, a.length + ' Clip(s)')),
      el('div', { class: 'row' }, el('span', { style: { width: '84px' } }, L('Lautstärke', 'Volume')), vs, vl),
      el('div', { class: 'row' }, el('span', { style: { width: '84px' } }, L('Tonhöhe', 'Pitch')), ps, pl),
      el('div', { class: 'row' }, el('span', { style: { width: '84px' } }, L('Ein/Aus-Fade', 'Fade in/out')), el('div', { class: 'chips' }, fadeBtn(0), fadeBtn(0.3), fadeBtn(1), fadeBtn(2))),
      el('div', { class: 'row' }, el('span', { style: { width: '84px' } }, L('Tempo', 'Speed')), el('div', { class: 'chips' }, ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => el('span', { class: 'chip', onclick: () => run('setSpeed', { speed: v }) }, v + 'x')),
        el('label', { class: 'chip' }, (() => { const cb = el('input', { type: 'checkbox', checked: !c.audio.pitchShift }); cb.onchange = () => store.edit('Tonhöhe', () => a.forEach((x) => { x.audio.pitchShift = !cb.checked; })); return cb; })(), ' ' + L('Tonhöhe halten', 'Keep pitch')))),
      el('div', { class: 'muted' }, L('Stimm- & Sound-Effekte', 'Voice & sound effects')),
      el('div', { class: 'chips' }, ...Object.entries(VOICE_FX).map(([k, v]) => el('span', { class: 'chip' + ((c.audio.voiceFx || 'none') === k ? ' on' : ''), onclick: () => { applyAudioFx({ voiceFx: k === 'none' ? '' : k }); pop.remove(); } }, N(v.n))),
        ...Object.entries(SPEED_FX).map(([k, v]) => el('span', { class: 'chip', onclick: async () => { store.edit('Audio-Preset', () => a.forEach((x) => { x.audio.pitchShift = true; })); await run('setSpeed', { speed: v.speed }); if (v.fx) applyAudioFx({ voiceFx: v.fx }); pop.remove(); } }, N(v.n)))),
      el('div', { class: 'row' },
        el('button', { class: 'btn small', onclick: () => run('aiEnhanceAudio') }, '🎙 ' + L('Stimme verbessern', 'Enhance voice')),
        el('button', { class: 'btn small', onclick: () => run('aiVoiceIsolate') }, '🎤 ' + L('Stimme isolieren', 'Isolate voice')),
        el('button', { class: 'btn small', onclick: () => run('audioMixer') }, '🎚 Mixer')));
  }
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(); const pr = pop.getBoundingClientRect();
  pop.style.left = Math.min(innerWidth - pr.width - 8, r.left) + 'px'; pop.style.top = Math.max(8, r.top - pr.height - 8) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }), 0);
}

registerCommands([
  { id: 'audioPanel', name: { de: 'Audio-Regler', en: 'Audio controls' }, cat: 'audio', key: 'Ctrl+Shift+V', run: () => audioPopover(document.querySelectorAll('#tl-toolbar .tl-btn')[5] || document.body) },
  { id: 'audioFx', name: { de: 'Stimm-/Sound-Effekt (API)', en: 'Voice/sound effect (API)' }, cat: 'audio', hidden: true, args: '{ voiceFx?, pitch? }', run: (a) => applyAudioFx(a || {}) },
  ...Object.entries(VOICE_FX).filter(([k]) => k !== 'none').map(([k, v]) => ({ id: 'voice:' + k, name: { de: 'Audio-Effekt: ' + v.n.de, en: 'Audio effect: ' + v.n.en }, cat: 'audio', run: () => applyAudioFx({ voiceFx: k }) })),
]);
