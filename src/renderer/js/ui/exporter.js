// Export / rendering: frame-exact offline render with the same GPU compositor as the preview,
// FFmpeg encoding (H.264/H.265/AV1/ProRes/VP9/GIF, hardware AMF/NVENC/QSV), full audio mix.
import { store, clipEnd, sourceTime, avgSpeed, sourceLength, speedAt } from '../core/project.js';
import { el, $, tc, deepClone, fmtBytes, clamp, bus } from '../core/util.js';
import { L } from '../core/i18n.js';
import { settings, setSetting, paths } from '../core/settings.js';
import { Compositor, neededClips } from '../render/compositor.js';
import { FrameReader, FFMPEG, detectEncoders, makeReversed } from '../core/ffmpeg.js';
import { evalParam, isKf } from '../core/keyframes.js';
import { modal, toast } from './dialogs.js';
import { audioFxChain } from './audiofx.js';
import { registerCommands } from '../core/commands.js';
import { engine } from '../playback/engine.js';
const { spawn } = require('child_process');
const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

export const EXPORT_PRESETS = [
  { id: 'yt4k60', name: 'YouTube 4K 60fps', h: 2160, fps: 60, codec: 'h264', fmt: 'mp4', q: 18 },
  { id: 'yt4k', name: 'YouTube 4K', h: 2160, fps: 0, codec: 'h264', fmt: 'mp4', q: 18 },
  { id: 'yt1080', name: 'YouTube 1080p', h: 1080, fps: 0, codec: 'h264', fmt: 'mp4', q: 19 },
  { id: 'tiktok', name: 'TikTok / Reels / Shorts (1080×1920)', h: 1920, w: 1080, fps: 0, codec: 'h264', fmt: 'mp4', q: 19 },
  { id: 'insta', name: 'Instagram 1080', h: 1080, fps: 30, codec: 'h264', fmt: 'mp4', q: 20 },
  { id: 'hevc4k', name: 'H.265 / HEVC 4K (klein)', h: 2160, fps: 0, codec: 'h265', fmt: 'mp4', q: 22 },
  { id: 'av1', name: 'AV1 (modern, sehr klein)', h: 0, fps: 0, codec: 'av1', fmt: 'mp4', q: 30 },
  { id: 'prores', name: 'ProRes 422 HQ (Master)', h: 0, fps: 0, codec: 'prores', fmt: 'mov', q: 0 },
  { id: 'webm', name: 'WebM VP9', h: 1080, fps: 0, codec: 'vp9', fmt: 'webm', q: 30 },
  { id: 'gif', name: 'GIF (animiert)', h: 480, fps: 15, codec: 'gif', fmt: 'gif', q: 0 },
  { id: 'master8k', name: '8K Master', h: 4320, fps: 0, codec: 'h265', fmt: 'mp4', q: 20 },
];
const RES = [['0', L('Arbeitsgröße', 'Working size')], ['720', '720p'], ['1080', '1080p Full HD'], ['1440', '1440p QHD'], ['2160', '2160p 4K UHD'], ['4320', '4320p 8K'], ['custom', L('Eigene', 'Custom')]];

let job = null;
export const isExporting = () => !!job;

export function openExportDialog() {
  const P = store.p;
  const S = P.settings;
  const st = { preset: 'custom', res: S.width * S.height > 2.5e6 ? '0' : '1080', w: S.width, h: S.height, fps: S.fps, fmt: 'mp4', codec: 'h264', enc: 'auto', mode: 'crf', q: 18, kbps: 40000, audio: 'aac', abr: 320, range: P.inPoint != null || P.outPoint != null ? 'inout' : 'all', ten: false, name: (P.name || 'Export').replace(/[\\/:*?"<>|]/g, '_'), dir: settings.exportDir, openAfter: true, preview: true };
  const f = (label, input, cls = '') => [el('label', { class: cls }, label), input];
  const sel = (opts, val, on) => { const s = el('select', {}, ...opts.map(([v, n]) => el('option', { value: v }, n))); s.value = val; s.onchange = () => { on(s.value); refresh(); }; return s; };
  const num = (val, on, attrs = {}) => { const i = el('input', { type: 'number', value: val, ...attrs }); i.oninput = () => { on(+i.value); refresh(false); }; i.addEventListener('keydown', (e) => e.stopPropagation()); return i; };
  const presetSel = sel([['custom', L('— Eigene Einstellungen —', '— Custom —')], ...EXPORT_PRESETS.map((p) => [p.id, p.name])], st.preset, (v) => applyPreset(v));
  const resSel = sel(RES, st.res, (v) => { st.res = v; if (v !== 'custom') setRes(v); });
  const wIn = num(st.w, (v) => (st.w = v), { step: 2 }), hIn = num(st.h, (v) => (st.h = v), { step: 2 });
  if (st.res !== '0') setRes(st.res);
  const fpsSel = sel([23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120].map((x) => [x, x + ' fps']), st.fps, (v) => (st.fps = +v));
  const fmtSel = sel([['mp4', 'MP4'], ['mov', 'MOV'], ['mkv', 'MKV'], ['webm', 'WebM'], ['gif', 'GIF']], st.fmt, (v) => { st.fmt = v; if (v === 'webm') st.codec = 'vp9'; if (v === 'gif') st.codec = 'gif'; if (v === 'mp4' && ['vp9', 'gif', 'prores'].includes(st.codec)) st.codec = 'h264'; codecSel.value = st.codec; });
  const codecSel = sel([['h264', 'H.264 / AVC'], ['h265', 'H.265 / HEVC'], ['av1', 'AV1'], ['prores', 'Apple ProRes 422 HQ'], ['vp9', 'VP9'], ['gif', 'GIF']], st.codec, (v) => { st.codec = v; if (v === 'prores') st.fmt = 'mov'; if (v === 'vp9' && st.fmt !== 'mkv') st.fmt = 'webm'; if (v === 'gif') st.fmt = 'gif'; if (['h264', 'h265', 'av1'].includes(v) && ['webm', 'gif'].includes(st.fmt)) st.fmt = 'mp4'; fmtSel.value = st.fmt; });
  const encSel = el('select', {}, el('option', { value: 'auto' }, L('Automatisch (GPU wenn möglich)', 'Automatic (GPU if possible)')), el('option', { value: 'cpu' }, L('Software (beste Qualität)', 'Software (best quality)')));
  encSel.onchange = () => { st.enc = encSel.value; refresh(); };
  detectEncoders().then((enc) => { for (const [k, ok] of Object.entries(enc)) if (ok) encSel.appendChild(el('option', { value: k }, k + ' (GPU)')); encSel.value = st.enc; refresh(); });
  const modeSel = sel([['crf', L('Qualität (konstant)', 'Quality (constant)')], ['cbr', L('Bitrate (kbit/s)', 'Bitrate (kbps)')]], st.mode, (v) => (st.mode = v));
  const qIn = num(st.q, (v) => (st.q = v), { min: 0, max: 51 }), kbIn = num(st.kbps, (v) => (st.kbps = v), { min: 500, max: 400000, step: 500 });
  const audioSel = sel([['aac', 'AAC'], ['opus', 'Opus'], ['pcm', 'PCM (WAV, unkomprimiert)'], ['none', L('Kein Audio', 'No audio')]], st.audio, (v) => (st.audio = v));
  const abrSel = sel([[128, '128 kbit/s'], [192, '192 kbit/s'], [256, '256 kbit/s'], [320, '320 kbit/s']], st.abr, (v) => (st.abr = +v));
  const rangeSel = sel([['all', L('Gesamte Timeline', 'Whole timeline')], ['inout', L('In/Out-Bereich', 'In/out range')]], st.range, (v) => (st.range = v));
  const tenCb = el('input', { type: 'checkbox' }); tenCb.onchange = () => { st.ten = tenCb.checked; };
  const nameIn = el('input', { type: 'text', value: st.name, style: { width: '100%' } }); nameIn.oninput = () => { st.name = nameIn.value; refresh(false); }; nameIn.addEventListener('keydown', (e) => e.stopPropagation());
  const dirBtn = el('button', { class: 'btn small', onclick: async () => { const r = await ipcRenderer.invoke('dialog:open', { properties: ['openDirectory'], defaultPath: st.dir }); if (!r.canceled) { st.dir = r.filePaths[0]; setSetting('exportDir', st.dir); refresh(); } } }, '…');
  const dirLbl = el('span', { class: 'muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } });
  const openCb = el('input', { type: 'checkbox', checked: true }); openCb.onchange = () => (st.openAfter = openCb.checked);
  const summary = el('div', { class: 'muted', style: { marginTop: '10px', lineHeight: '1.6' } });
  const deskCb = el('input', { type: 'checkbox', checked: settings.copyToDesktop !== false }); deskCb.onchange = () => setSetting('copyToDesktop', deskCb.checked);
  const kitSel = el('select', {}, el('option', { value: '' }, L('— kein —', '— none —')));
  import('./extras.js').then((x) => { for (const k of x.brandKits()) kitSel.appendChild(el('option', { value: k.id }, k.name)); kitSel.value = settings.lastKit || ''; });
  kitSel.onchange = () => setSetting('lastKit', kitSel.value);
  const pv = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px', marginTop: '10px' } });
  function setRes(v) {
    // value = short side (720p … 8K); long side follows the project aspect (vertical 8K = 4320×7680)
    const h = +v; if (!h) { st.w = S.width; st.h = S.height; }
    else if (S.height > S.width) { st.w = h; st.h = Math.round((h * S.height) / S.width / 2) * 2; }
    else { st.h = h; st.w = Math.round((h * S.width) / S.height / 2) * 2; }
    wIn.value = st.w; hIn.value = st.h;
    if (Math.max(st.w, st.h) > 4096 && st.codec === 'h264') { st.codec = 'h265'; if (st.fmt !== 'mp4' && st.fmt !== 'mov' && st.fmt !== 'mkv') st.fmt = 'mp4'; try { codecSel.value = 'h265'; fmtSel.value = st.fmt; } catch {} toast(L('8K/6K: auf H.265 umgestellt – die Grafikkarte kann H.264 nur bis 4K, H.265 geht bis 8K und ist viel schneller', 'Switched to H.265 for >4K (GPU H.264 only up to 4K)'), '', 7000); }
  }
  function applyPreset(id) {
    st.preset = id; const p = EXPORT_PRESETS.find((x) => x.id === id); if (!p) return;
    if (p.w) { st.w = p.w; st.h = p.h; st.res = 'custom'; } else if (p.h) { st.res = String(p.h); setRes(p.h); } else { st.res = '0'; setRes(0); }
    if (p.fps) st.fps = p.fps; else st.fps = S.fps;
    st.codec = p.codec; st.fmt = p.fmt; if (p.q) st.q = p.q;
    resSel.value = st.res; wIn.value = st.w; hIn.value = st.h; fpsSel.value = st.fps; codecSel.value = st.codec; fmtSel.value = st.fmt; qIn.value = st.q;
  }
  function range() { return st.range === 'inout' ? [P.inPoint ?? 0, P.outPoint ?? store.duration()] : [0, store.duration()]; }
  function refresh(previews = true) {
    const [a, b] = range();
    const dur = Math.max(0, b - a);
    const frames = Math.round(dur * st.fps);
    const estMbps = st.mode === 'cbr' ? st.kbps / 1000 : st.codec === 'prores' ? (st.w * st.h * st.fps * 2.4) / 1e6 : (st.w * st.h * st.fps) / 1e6 * ({ h264: 0.12, h265: 0.07, av1: 0.05, vp9: 0.07, gif: 0.5 }[st.codec] || 0.1) * Math.pow(0.89, st.q - 18);
    dirLbl.textContent = st.dir;
    summary.innerHTML = '';
    summary.append(el('div', {}, `${st.w}×${st.h} · ${st.fps} fps · ${st.codec.toUpperCase()} · ${st.fmt.toUpperCase()} · ${tc(dur, st.fps)} (${frames} Frames)`),
      el('div', {}, L('Geschätzte Größe: ', 'Estimated size: ') + fmtBytes((estMbps * 1e6 / 8) * dur + (st.audio === 'none' ? 0 : st.abr * 125 * dur))),
      el('div', {}, L('Datei: ', 'File: ') + path.join(st.dir, `${st.name}.${st.fmt}`)));
    if (previews) renderPreviewThumbs();
  }
  let pvTimer = null;
  function renderPreviewThumbs() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => {
      pv.innerHTML = '';
      const [a, b] = range();
      const cv = el('canvas', { width: 320, height: Math.round((320 * st.h) / st.w) });
      for (let i = 0; i < 4; i++) {
        const t = a + ((b - a) * (i + 0.5)) / 4;
        const img = el('canvas', { width: 160, height: Math.round((160 * st.h) / st.w), style: { width: '100%', borderRadius: '6px', background: '#000', cursor: 'pointer' }, title: tc(t, st.fps), onclick: () => engine.seek(t) });
        pv.appendChild(img);
        engine.seek(t);
      }
      // render via main preview for speed (it already has decoders); after seeks settle, copy canvas
      const ts = [0, 1, 2, 3].map((i) => a + ((b - a) * (i + 0.5)) / 4);
      let k = 0;
      const step = () => {
        if (k >= ts.length) { engine.seek(ts[0]); return; }
        engine.seek(ts[k]);
        setTimeout(() => { const c = pv.children[k]; if (c) c.getContext('2d').drawImage($('#preview-canvas'), 0, 0, c.width, c.height); k++; step(); }, 450);
      };
      step();
    }, 300);
  }
  const body = el('div', { style: { width: '640px' } },
    el('div', { class: 'form' },
      ...f(L('Vorlage', 'Preset'), presetSel),
      ...f(L('Auflösung', 'Resolution'), el('div', { class: 'row', style: { margin: 0 } }, resSel, wIn, '×', hIn)),
      ...f('Framerate', fpsSel),
      ...f(L('Format', 'Container'), fmtSel),
      ...f('Codec', codecSel),
      ...f(L('Encoder', 'Encoder'), encSel),
      ...f(L('Ratensteuerung', 'Rate control'), el('div', { class: 'row', style: { margin: 0 } }, modeSel, el('span', { class: 'muted' }, 'CRF/QP'), qIn, el('span', { class: 'muted' }, 'kbit/s'), kbIn)),
      ...f(L('10-Bit (HEVC/AV1)', '10-bit (HEVC/AV1)'), tenCb, 'adv'),
      ...f('Audio', el('div', { class: 'row', style: { margin: 0 } }, audioSel, abrSel)),
      ...f(L('Bereich', 'Range'), rangeSel),
      ...f(L('Dateiname', 'File name'), nameIn),
      ...f(L('Ordner', 'Folder'), el('div', { class: 'row', style: { margin: 0, flexWrap: 'nowrap', minWidth: 0 } }, dirLbl, dirBtn)),
      ...f(L('Danach öffnen', 'Open when done'), openCb),
      ...f(L('Kopie auf Desktop', 'Copy to desktop'), deskCb),
      ...f(L('Branding-Kit', 'Branding kit'), kitSel)),
    el('div', { style: { marginTop: '12px', fontWeight: 600 } }, L('Vorschau', 'Preview')), pv, summary);
  refresh();
  modal({ title: L('Video exportieren', 'Export video'), body, width: 700, buttons: [
    { label: L('Einzelbild (PNG)', 'Still (PNG)'), onClick: () => { exportStill(); return false; } },
    { label: L('Zur Warteschlange', 'Add to queue'), onClick: async () => { const x = await import('./extras.js'); x.addToQueue({ label: st.name, kitId: kitSel.value || null, opts: { ...st, range: range(), openAfter: false } }); } },
    { label: L('Abbrechen', 'Cancel'), value: null },
    { label: L('Rendern', 'Render'), cls: 'primary', onClick: async () => { let project = null; if (kitSel.value) { const x = await import('./extras.js'); const kit = x.brandKits().find((k) => k.id === kitSel.value); if (kit) { await x.ensureKitMedia(kit); project = x.applyBranding(store.p, kit); } } const r2 = range(); startExport({ ...st, project, range: project ? [0, project.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)] : r2 }); } },
  ] });
}

// ------------------------------------------------------------------ encoder args
function videoArgs(o, enc) {
  const q = o.q, br = o.kbps + 'k';
  const cbr = o.mode === 'cbr';
  const big = Math.max(o.w || 0, o.h || 0);
  let hw = o.enc === 'auto' ? pickHw(o.codec, enc) : o.enc === 'cpu' ? null : o.enc;
  if (hw && ((hw.startsWith('h264') && big > 4096) || big > 8192)) hw = null; // beyond the hardware limit -> software encoder
  const pf = o.ten && (o.codec === 'h265' || o.codec === 'av1') ? 'yuv420p10le' : 'yuv420p';
  if (o.codec === 'gif') return { vf: `fps=${o.fps},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`, args: [] , gif: true };
  if (o.codec === 'prores') return { pf: 'yuv422p10le', args: ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0'] };
  if (o.codec === 'vp9') return { pf: 'yuv420p', args: ['-c:v', 'libvpx-vp9', ...(cbr ? ['-b:v', br] : ['-crf', String(q), '-b:v', '0']), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3'] };
  if (hw) {
    if (hw.endsWith('_amf')) return { pf: pf === 'yuv420p10le' ? 'p010le' : 'nv12', hw, args: ['-c:v', hw, '-quality', 'quality', ...(cbr ? ['-rc', 'cbr', '-b:v', br] : ['-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q + 2), ...(hw.startsWith('h264') || hw.startsWith('hevc') ? ['-qp_b', String(q + 4)] : [])])] };
    if (hw.endsWith('_nvenc')) return { pf, hw, args: ['-c:v', hw, '-preset', 'p6', '-tune', 'hq', ...(cbr ? ['-b:v', br] : ['-rc', 'vbr', '-cq', String(q), '-b:v', '0'])] };
    if (hw.endsWith('_qsv')) return { pf: 'nv12', hw, args: ['-c:v', hw, '-preset', 'slow', ...(cbr ? ['-b:v', br] : ['-global_quality', String(q)])] };
  }
  if (o.codec === 'h265') return { pf, args: ['-c:v', 'libx265', '-preset', big > 4096 ? 'faster' : 'medium', ...(cbr ? ['-b:v', br] : ['-crf', String(q)]), '-tag:v', 'hvc1'] };
  if (o.codec === 'av1') return { pf, args: ['-c:v', 'libsvtav1', '-preset', '7', ...(cbr ? ['-b:v', br] : ['-crf', String(q)])] };
  return { pf, args: ['-c:v', 'libx264', '-preset', big > 4096 ? 'faster' : 'medium', ...(cbr ? ['-b:v', br, '-maxrate', br, '-bufsize', o.kbps * 2 + 'k'] : ['-crf', String(q)]), '-profile:v', 'high'] };
}
function pickHw(codec, enc) {
  const m = { h264: ['h264_nvenc', 'h264_amf', 'h264_qsv'], h265: ['hevc_nvenc', 'hevc_amf', 'hevc_qsv'], av1: ['av1_nvenc', 'av1_amf', 'av1_qsv'] }[codec] || [];
  return m.find((e) => enc?.[e]) || null;
}

// ------------------------------------------------------------------ audio graph
function volumeExpr(clip) {
  const v = clip.volume;
  if (!isKf(v)) return null;
  // piecewise linear expression in clip-local time (t after asetpts → starts at 0 for the clip)
  const k = v.kf; let e = String(k[k.length - 1].v);
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i], b = k[i + 1];
    e = `if(lt(t,${b.t.toFixed(4)}),${a.v}+(${b.v}-${a.v})*(t-${a.t.toFixed(4)})/${Math.max(1e-4, b.t - a.t).toFixed(4)},${e})`;
  }
  return `if(lt(t,${k[0].t.toFixed(4)}),${k[0].v},${e})`;
}
function atempoChain(s) {
  const out = []; let r = s;
  while (r > 2) { out.push('atempo=2'); r /= 2; }
  while (r < 0.5) { out.push('atempo=0.5'); r /= 0.5; }
  out.push('atempo=' + r.toFixed(5));
  return out;
}
export function buildAudioGraph(P, rangeStart, rangeEnd, inputOffset) {
  const tracks = P.tracks.filter((t) => t.kind === 'audio');
  const anySolo = tracks.some((t) => t.solo);
  const clips = P.clips.filter((c) => {
    if (c.type !== 'audio' || c.muted) return false;
    const tr = tracks.find((t) => t.id === c.trackId);
    if (!tr || tr.muted || (anySolo && !tr.solo)) return false;
    return c.start < rangeEnd && clipEnd(c) > rangeStart;
  });
  const inputs = []; const chains = []; const labels = [];
  const voiceRanges = clips.filter((c) => c.audio?.voice).map((c) => [c.start, clipEnd(c)]);
  clips.forEach((c, i) => {
    const m = P.media.find((x) => x.id === c.mediaId); if (!m) return;
    const tr = tracks.find((t) => t.id === c.trackId);
    const srcLen = sourceLength(c);
    const srcStart = c.reverse ? c.in : c.in;
    inputs.push('-ss', srcStart.toFixed(4), '-t', (srcLen + 0.05).toFixed(4), '-i', m.path);
    const idx = inputOffset + inputs.filter((x) => x === '-i').length - 1;
    const f = ['aformat=sample_rates=48000:channel_layouts=stereo'];
    if (c.reverse) f.push('areverse');
    const sp = c.freeze ? 1 : avgSpeed(c);
    if (Math.abs(sp - 1) > 1e-3) {
      if (c.audio?.pitchShift) f.push(`asetrate=${Math.round(48000 * sp)}`, 'aresample=48000');
      else f.push(...atempoChain(sp));
    }
    f.push(`atrim=0:${c.dur.toFixed(4)}`, 'asetpts=PTS-STARTPTS');
    const A = c.audio || {};
    f.push(...audioFxChain(A));
    if (A.denoise > 0) f.push(`afftdn=nr=${(8 + A.denoise * 24).toFixed(1)}:nf=-30`);
    if (A.voice) f.push('highpass=f=90', 'equalizer=f=3200:t=q:w=1:g=4', 'acompressor=threshold=-24dB:ratio=4:attack=5:release=80:makeup=2');
    if (A.eqLow) f.push(`bass=g=${A.eqLow}:f=200`);
    if (A.eqMid) f.push(`equalizer=f=1500:t=q:w=0.8:g=${A.eqMid}`);
    if (A.eqHigh) f.push(`treble=g=${A.eqHigh}:f=6000`);
    if (A.reverb > 0) f.push(`aecho=0.8:0.7:40|70|110:${(0.3 * A.reverb).toFixed(2)}|${(0.25 * A.reverb).toFixed(2)}|${(0.2 * A.reverb).toFixed(2)}`);
    if (A.echo > 0) f.push(`aecho=0.8:0.8:280|560:${(0.5 * A.echo).toFixed(2)}|${(0.3 * A.echo).toFixed(2)}`);
    const ve = volumeExpr(c);
    const gain = (tr?.volume ?? 1) * Math.pow(10, (A.gainDb || 0) / 20);
    if (ve) f.push(`volume='${ve}':eval=frame`);
    const constVol = (isKf(c.volume) ? 1 : c.volume) * gain;
    if (Math.abs(constVol - 1) > 1e-3) f.push(`volume=${constVol.toFixed(4)}`);
    if (A.pan) f.push(`stereotools=balance_out=${A.pan.toFixed(2)}`);
    if (tr?.eqLow) f.push(`bass=g=${tr.eqLow}:f=200`); if (tr?.eqMid) f.push(`equalizer=f=1500:t=q:w=0.8:g=${tr.eqMid}`); if (tr?.eqHigh) f.push(`treble=g=${tr.eqHigh}:f=6000`); if (tr?.pan) f.push(`stereotools=balance_out=${(+tr.pan).toFixed(2)}`);
    if (c.fadeIn > 0) f.push(`afade=t=in:st=0:d=${c.fadeIn.toFixed(3)}`);
    if (c.fadeOut > 0) f.push(`afade=t=out:st=${Math.max(0, c.dur - c.fadeOut).toFixed(3)}:d=${c.fadeOut.toFixed(3)}`);
    const delayMs = Math.max(0, Math.round(c.start * 1000));
    f.push(`adelay=${delayMs}:all=1`);
    if (A.duck) {
      const rs = voiceRanges.filter(([a, b]) => b > c.start && a < clipEnd(c));
      if (rs.length) f.push(`volume=0.25:enable='${rs.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+')}'`);
    }
    chains.push(`[${idx}:a]${f.join(',')}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  const total = (rangeEnd - rangeStart).toFixed(4);
  if (!labels.length) return { inputs: ['-f', 'lavfi', '-t', total, '-i', 'anullsrc=r=48000:cl=stereo'], graph: `[${inputOffset}:a]atrim=0:${total},asetpts=PTS-STARTPTS[aout]` };
  const mix = labels.length > 1 ? `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0,` : `${labels[0]}`;
  const tail = `apad,atrim=start=${rangeStart.toFixed(4)}:end=${rangeEnd.toFixed(4)},asetpts=PTS-STARTPTS,alimiter=limit=0.98[aout]`;
  return { inputs, graph: chains.join(';') + ';' + (labels.length > 1 ? mix + tail : `${labels[0]}${tail}`) };
}

// ------------------------------------------------------------------ export provider
export class ExportProvider {
  constructor(P, W, H, { proxy = false } = {}) { this.P = P; this.W = W; this.H = H; this.useProxy = proxy; this.readers = new Map(); this.frames = new Map(); this.images = new Map(); this.reversed = new Map(); }
  async prepareReverse() {
    for (const c of this.P.clips.filter((c) => c.type === 'video' && c.reverse)) {
      const m = this.P.media.find((x) => x.id === c.mediaId);
      const start = Math.max(0, c.in - 0.5), len = Math.min(m.duration - start, sourceLength(c) + 1);
      const file = await makeReversed(m, start, len, { full: true });
      this.reversed.set(c.id, { file, start, len });
    }
  }
  decodeSize(c, m) {
    const fit = Math.min(this.W / m.width, this.H / m.height);
    let maxS = 1;
    const s = c.transform.scale; if (isKf(s)) maxS = Math.max(...s.kf.map((k) => k.v)); else maxS = s;
    const k = Math.min(1, fit * Math.max(1, maxS * 1.15));
    return [Math.max(2, Math.round((m.width * k) / 2) * 2), Math.max(2, Math.round((m.height * k) / 2) * 2)];
  }
  async prepare(t) {
    const need = neededClips(this.P, t);
    this.frames.clear();
    for (const { clip, lt } of need) {
      const m = this.P.media.find((x) => x.id === clip.mediaId); if (!m) continue;
      if (clip.type === 'image') {
        if (!this.images.has(m.id)) { const im = new Image(); im.src = 'file:///' + m.path.replace(/\\/g, '/'); await im.decode().catch(() => {}); this.images.set(m.id, im); }
        continue;
      }
      let file = this.useProxy && m.proxyPath && fs.existsSync(m.proxyPath) ? m.proxyPath : m.path, st = sourceTime(clip, lt);
      const rv = this.reversed.get(clip.id);
      if (rv) { file = rv.file; st = clamp(rv.start + rv.len - st, 0, rv.len - 0.001); }
      st = clamp(st, 0, Math.max(0, m.duration - 0.5 / (m.fps || 30)));
      let r = this.readers.get(clip.id);
      if (!r) {
        const [w, h] = this.decodeSize(clip, m);
        r = new FrameReader(file, { width: w, height: h, fps: Math.min(120, m.fps || 30), start: st });
        this.readers.set(clip.id, r);
      }
      const data = await r.get(st);
      if (data) this.frames.set(clip.id, { data, width: r.w, height: r.h, idx: r.index });
    }
    // close readers of clips that are over
    for (const [id, r] of this.readers) { const c = this.P.clips.find((x) => x.id === id); if (!c || clipEnd(c) + 2 < t) { r.kill(); this.readers.delete(id); } }
  }
  source(clip) {
    const m = this.P.media.find((x) => x.id === clip.mediaId); if (!m) return null;
    if (clip.type === 'image') { const im = this.images.get(m.id); return im ? { key: 'eimg_' + m.id, img: im, w: im.naturalWidth, h: im.naturalHeight, version: m.id } : null; }
    const f = this.frames.get(clip.id); if (!f) return null;
    return { key: 'evid_' + clip.id, img: f, w: m.width, h: m.height, version: f.idx + '_' + f.data.length };
  }
  close() { for (const r of this.readers.values()) r.kill(); this.readers.clear(); }
}

// ------------------------------------------------------------------ render job
export async function startExport(o, { silent = false } = {}) {
  if (job) { toast(L('Es läuft bereits ein Export', 'An export is already running'), 'err'); return null; }
  const P = deepClone(o.project || store.p);
  const W = Math.round(o.w / 2) * 2, H = Math.round(o.h / 2) * 2, fps = +o.fps;
  const [rs, re] = o.range || [0, store.duration()];
  if (!(re - rs > 0.01)) { toast(L('Timeline ist leer – nichts zu exportieren', 'Timeline is empty – nothing to export'), 'err'); throw new Error('empty timeline'); }
  const total = Math.max(1, Math.round((re - rs) * fps));
  const out = o.out || path.join(o.dir, `${o.name}.${o.fmt}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // scale project to export resolution: compositor works in project units → scale = W / project width
  const canvas = document.createElement('canvas');
  const comp = new Compositor(canvas, { preserve: false });
  comp.setSize(W, H);
  const prov = new ExportProvider(P, W, H);
  // if aspect differs from project, the compositor still renders the project frame into WxH
  const enc = await detectEncoders();
  const v = videoArgs(o, enc);
  const abort = new AbortController();
  job = { abort, out, done: 0, total };
  const ui = silent ? null : progressUI(out, () => abort.abort());
  bus.emit('export:start', job);
  try {
    if (P.clips.some((c) => c.reverse && c.type === 'video')) { ui?.set(0, L('Bereite Rückwärts-Clips vor…', 'Preparing reversed clips…')); await prov.prepareReverse(); }
    const args = ['-hide_banner', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0'];
    let filter = `[0:v]vflip${v.gif ? ',' + v.vf : ',format=' + (v.pf || 'yuv420p')}[vout]`;
    const maps = ['-map', '[vout]'];
    if (o.audio !== 'none' && !v.gif) {
      const ag = buildAudioGraph(P, rs, re, 1);
      args.push(...ag.inputs);
      filter += ';' + ag.graph;
      maps.push('-map', '[aout]');
    }
    args.push('-filter_complex', filter, ...maps, ...v.args);
    if (!v.gif) {
      if (o.audio === 'aac') args.push('-c:a', 'aac', '-b:a', o.abr + 'k');
      else if (o.audio === 'opus' || o.fmt === 'webm') args.push('-c:a', 'libopus', '-b:a', o.abr + 'k');
      else if (o.audio === 'pcm') args.push('-c:a', 'pcm_s24le');
      if (o.fmt === 'mp4' || o.fmt === 'mov') args.push('-movflags', '+faststart');
      args.push('-r', String(fps), '-t', ((re - rs)).toFixed(4));
      args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
    }
    args.push(out);
    console.log('ffmpeg', args.join(' '));
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    let errLog = '';
    proc.stderr.on('data', (d) => { errLog += d.toString(); if (errLog.length > 60000) errLog = errLog.slice(-30000); });
    let exited = false; const closed = new Promise((res) => proc.on('close', (c) => { exited = true; res(c); }));
    const ffFail = () => new Error(L('FFmpeg hat abgebrochen: ', 'FFmpeg stopped: ') + (errLog.split('\n').filter((l) => /error|invalid|not supported|failed|exceed|unsupported/i.test(l)).slice(-3).join(' | ') || errLog.split('\n').slice(-4).join(' ')));
    proc.stdin.on('error', () => {});
    abort.signal.addEventListener('abort', () => { try { proc.kill('SIGKILL'); } catch {} });
    const t0 = performance.now();
    const pool = []; for (let i = 0; i < 3; i++) pool.push({ buf: new Uint8Array(W * H * 4), busy: false });
    for (let f = 0; f < total; f++) {
      if (abort.signal.aborted) throw new Error(L('Export abgebrochen', 'Export cancelled'));
      if (exited) throw ffFail();
      const t = rs + f / fps;
      await prov.prepare(t);
      const target = comp.renderFrame(P, t, prov, { toScreen: false });
      let slot = pool.find((s) => !s.busy);
      while (!slot) { if (exited) throw ffFail(); await new Promise((r) => setTimeout(r, 1)); slot = pool.find((s) => !s.busy); }
      comp.readPixels(target, slot.buf);
      comp.free(target);
      slot.busy = true;
      const ok = proc.stdin.write(Buffer.from(slot.buf.buffer), () => { slot.busy = false; });
      if (!ok) { await Promise.race([new Promise((r) => proc.stdin.once('drain', r)), closed]); if (exited) throw ffFail(); }
      job.done = f + 1;
      if (f % 4 === 0 || f === total - 1) {
        const el2 = (performance.now() - t0) / 1000; const rfps = (f + 1) / el2; const eta = (total - f - 1) / rfps;
        ui?.set((f + 1) / total, `Frame ${f + 1} / ${total} · ${rfps.toFixed(1)} fps · ${L('Rest', 'ETA')} ${Math.ceil(eta)}s`, f % 24 === 0 ? canvas : null);
        bus.emit('export:progress', (f + 1) / total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    proc.stdin.end();
    const code = await closed;
    if (code !== 0) throw ffFail();
    const size = fs.statSync(out).size;
    ui?.done(L(`Fertig: ${path.basename(out)} (${fmtBytes(size)}) in ${((performance.now() - t0) / 1000).toFixed(1)}s`, `Done: ${path.basename(out)} (${fmtBytes(size)})`));
    toast(L('Export fertig: ', 'Export done: ') + out, 'ok', 6000);
    bus.emit('export:done', out);
    if (settings.copyToDesktop !== false && !o.noDesktopCopy) { try { const desk = paths.desktop; if (path.resolve(path.dirname(out)).toLowerCase() !== path.resolve(desk).toLowerCase()) { fs.copyFileSync(out, path.join(desk, path.basename(out))); } } catch (e) { console.warn('desktop copy', e); } }
    if (o.openAfter) ipcRenderer.invoke('shell:show', out);
    return out;
  } catch (e) {
    console.error(e);
    try { fs.existsSync(out) && abort.signal.aborted && fs.unlinkSync(out); } catch {}
    ui?.fail(e.message);
    if (!abort.signal.aborted) toast(L('Export fehlgeschlagen: ', 'Export failed: ') + e.message, 'err', 9000);
    throw e;
  } finally {
    prov.close();
    const lose = comp.g.gl.getExtension('WEBGL_lose_context'); lose?.loseContext();
    job = null; bus.emit('export:end');
  }
}

function progressUI(out, onCancel) {
  const bar = el('i'); const txt = el('div', { class: 'muted', style: { marginTop: '8px' } }, L('Starte…', 'Starting…'));
  const thumb = el('canvas', { width: 480, height: 270, style: { width: '100%', background: '#000', borderRadius: '8px', marginBottom: '10px' } });
  let finished = false;
  const m = modal({ title: L('Rendern: ', 'Rendering: ') + path.basename(out), closable: false, width: 560,
    body: el('div', {}, thumb, el('div', { class: 'progress' }, bar), txt),
    buttons: [
      { label: L('Im Hintergrund', 'Run in background'), onClick: () => true },
      { label: L('Abbrechen', 'Cancel'), onClick: () => { if (!finished) onCancel(); return true; } },
    ] });
  return {
    set(p, t, cv) { bar.style.width = (p * 100).toFixed(1) + '%'; txt.textContent = t; if (cv) { const g = thumb.getContext('2d'); thumb.height = Math.round(480 * cv.height / cv.width); g.drawImage(cv, 0, 0, thumb.width, thumb.height); } },
    done(t) { finished = true; bar.style.width = '100%'; txt.textContent = t; setTimeout(() => m.close(), 1500); },
    fail(t) { finished = true; txt.textContent = '✕ ' + t; txt.style.color = 'var(--err)'; },
  };
}

// single frame export at project resolution
export async function exportStill(file) {
  const P = store.p.settings;
  if (!file) {
    const r = await ipcRenderer.invoke('dialog:save', { defaultPath: path.join(paths.velox, 'Standbilder', `Frame_${tc(store.time, P.fps).replace(/:/g, '-')}.png`), filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'JPEG', extensions: ['jpg'] }] });
    if (r.canceled) return; file = r.filePath;
  }
  const canvas = document.createElement('canvas');
  const comp = new Compositor(canvas, { preserve: true });
  comp.setSize(P.width, P.height);
  const prov = new ExportProvider(deepClone(store.p), P.width, P.height);
  await prov.prepare(store.time);
  comp.renderFrame(prov.P, store.time, prov);
  prov.close();
  const type = file.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((r) => canvas.toBlob(r, type, 0.95));
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  comp.g.gl.getExtension('WEBGL_lose_context')?.loseContext();
  toast(L('Einzelbild gespeichert: ', 'Still saved: ') + file, 'ok');
  return file;
}

registerCommands([
  { id: 'export', name: { de: 'Video exportieren…', en: 'Export video…' }, cat: 'file', key: 'Ctrl+E', run: () => openExportDialog() },
  { id: 'exportStill', name: { de: 'Einzelbild exportieren', en: 'Export still frame' }, cat: 'file', key: 'Ctrl+Shift+E', run: ({ file } = {}) => exportStill(file) },
  { id: 'renderVideo', name: { de: 'Rendern (API, ohne Dialog)', en: 'Render (API, no dialog)' }, cat: 'file', hidden: true,
    args: '{ out, width?, height?, fps?, codec?, fmt?, q?, range?:[a,b], audio?, seqId?, kitId? (Branding-Kit id oder Name) }',
    run: (a = {}) => {
      const S = store.p.settings;
      const fmt = a.fmt || (a.out ? path.extname(a.out).slice(1) : 'mp4') || 'mp4';
      const o = { w: a.width || S.width, h: a.height || S.height, fps: a.fps || S.fps, fmt, codec: a.codec || (fmt === 'webm' ? 'vp9' : fmt === 'gif' ? 'gif' : 'h264'), enc: a.enc || 'auto', mode: a.kbps ? 'cbr' : 'crf', q: a.q ?? 18, kbps: a.kbps || 0, audio: a.audio || (fmt === 'webm' ? 'opus' : 'aac'), abr: 320, range: a.range || [0, store.duration()], out: a.out || path.join(settings.exportDir, (store.p.name || 'Export') + '.' + fmt), openAfter: false };
      return (async () => {
        let project = null;
        if (a.seqId && a.seqId !== store.p.activeSeq) { const { seqData } = await import('../core/sequences.js'); project = { ...store.p, ...deepClone(seqData(store.p, a.seqId)) }; }
        if (a.kitId) { const x = await import('./extras.js'); const kit = x.brandKits().find((k) => k.id === a.kitId || k.name === a.kitId); if (kit) { await x.ensureKitMedia(kit); project = x.applyBranding(project || store.p, kit); } }
        if (project) { o.project = project; if (!a.range) o.range = [0, project.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)]; }
        return startExport(o, { silent: !!a.silent });
      })();
    } },
]);
