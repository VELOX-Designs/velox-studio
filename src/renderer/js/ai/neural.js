// Neural AI: model manager (download on demand) + GPU jobs in a separate process (ONNX Runtime/DirectML,
// RIFE ncnn-vulkan). Works on AMD, NVIDIA and Intel GPUs.
import { store, sourceLength, clipEnd } from '../core/project.js';
import { el, bus, fmtBytes } from '../core/util.js';
import { L } from '../core/i18n.js';
import { paths } from '../core/settings.js';
import { registerCommands, run } from '../core/commands.js';
import { FFMPEG, run as ff, cacheKey, cacheDir, probe } from '../core/ffmpeg.js';
import { importFiles, addJob } from '../core/media.js';
import { modal, toast, progressModal, confirmBox } from '../ui/dialogs.js';
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const FF = 'https://github.com/facefusion/facefusion-assets/releases/download';
export const MODELS = {
  ort: { name: 'ONNX Runtime (GPU-Laufzeit, DirectML)', size: 310e6, kind: 'npm', file: 'onnxruntime-node', src: 'npmjs.com/package/onnxruntime-node', need: true },
  span: { name: 'SPAN ×4 (schnelle KI-Details, empfohlen)', size: 1.7e6, url: `${FF}/models-3.0.0/span_kendata_x4.onnx`, file: 'span_kendata_x4.onnx' },
  esrgan_x2: { name: 'Real-ESRGAN ×2 (Hochskalieren / Details erfinden)', size: 69.6e6, url: `${FF}/models-3.0.0/real_esrgan_x2.onnx`, file: 'real_esrgan_x2.onnx' },
  esrgan_x4: { name: 'Real-ESRGAN ×4 (stärkstes Hochskalieren)', size: 69.5e6, url: `${FF}/models-3.0.0/real_esrgan_x4.onnx`, file: 'real_esrgan_x4.onnx' },
  yoloface: { name: 'YOLOface (Gesichtserkennung)', size: 12.7e6, url: `${FF}/models-3.0.0/yoloface_8n.onnx`, file: 'yoloface_8n.onnx' },
  gfpgan: { name: 'GFPGAN 1.4 (Gesichtsverbesserung)', size: 340.3e6, url: `${FF}/models-3.0.0/gfpgan_1.4.onnx`, file: 'gfpgan_1.4.onnx' },
  rmbg: { name: 'RMBG 1.4 (Hintergrund entfernen, beste Qualität)', size: 176.2e6, url: `${FF}/models-3.5.0/rmbg_1.4.onnx`, file: 'rmbg_1.4.onnx' },
  modnet: { name: 'MODNet (Hintergrund entfernen, schnell, Personen)', size: 25.9e6, url: `${FF}/models-3.5.0/modnet.onnx`, file: 'modnet.onnx' },
  rife: { name: 'RIFE ncnn-vulkan (KI-Zeitlupe / Zwischenbilder)', size: 431.5e6, url: 'https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-windows.zip', file: 'rife-ncnn-vulkan', zip: true },
  sdturbo: { name: 'SD-Turbo (Neural Rendering – generative KI, Stability AI, nur privat/nicht-kommerziell)', size: 2.58e9, url: 'https://huggingface.co/onnxruntime/sd-turbo/resolve/main', file: 'sd-turbo', multi: ['tokenizer/vocab.json', 'tokenizer/merges.txt', 'tokenizer/special_tokens_map.json', 'tokenizer/tokenizer_config.json', 'scheduler/scheduler_config.json', 'model_index.json', 'LICENSE', 'text_encoder/model.onnx', 'vae_encoder/model.onnx', 'vae_decoder/model.onnx', 'unet/model.onnx'] },
  rnnoise: { name: 'RNNoise (neuronale Stimm-Isolierung)', size: 0.3e6, url: 'https://raw.githubusercontent.com/GregorR/rnnoise-models/master/somnolent-hogwash-2018-09-01/sh.rnnn', file: 'sh.rnnn' },
};
const modelDir = () => path.join(paths.userData, 'models');
export const modelPath = (id) => (id === 'ort' ? path.join(paths.appUnpacked || paths.appRoot, 'node_modules', 'onnxruntime-node') : path.join(modelDir(), MODELS[id].file));
export function installed(id) {
  const p = modelPath(id);
  if (id === 'rife') return fs.existsSync(path.join(p, 'rife-ncnn-vulkan.exe'));
  if (id === 'sdturbo') return ['unet', 'vae_encoder', 'vae_decoder'].every((m) => fs.existsSync(path.join(p, m, 'model_dml.onnx'))) && fs.existsSync(path.join(p, 'text_encoder', 'model.onnx'));
  return fs.existsSync(p);
}

// resumable download into <out>.part with retries; renamed only when complete
async function download(url, out, onProgress, signal) {
  const { fetchTo } = await import('../core/setup.js');
  const tmp = out + '.part'; let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await fetchTo(url, tmp, onProgress, signal); if (fs.statSync(tmp).size < 1000 && !/\.(json|txt)$/i.test(out)) throw new Error('Datei unvollständig'); fs.renameSync(tmp, out); return; }
    catch (e) { last = e; if (signal?.aborted) throw e; await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); }
  }
  throw new Error(L('Download fehlgeschlagen (Internet/Firewall?): ', 'Download failed (internet/firewall?): ') + path.basename(out) + ' – ' + (last?.message || ''));
}
export async function install(id, onProgress, signal) {
  const m = MODELS[id];
  fs.mkdirSync(modelDir(), { recursive: true });
  if (m.kind === 'npm') {
    if (paths.isPackaged) throw new Error(L('KI-Laufzeit fehlt in dieser Installation – bitte VELOX neu installieren', 'AI runtime missing – please reinstall VELOX'));
    await new Promise((res, rej) => { const p = spawn('npm', ['install', 'onnxruntime-node@1', '--no-audit', '--no-fund'], { cwd: paths.appRoot, shell: true, windowsHide: true }); let e = ''; p.stderr.on('data', (d) => (e += d)); p.stdout.on('data', () => onProgress?.(0.5)); p.on('close', (c) => (c === 0 ? res() : rej(new Error('npm: ' + e.slice(-400))))); });
    return;
  }
  if (m.multi) {
    // many files (resumable per file), then make the CUDA-optimised graph DirectML-compatible
    const sizes = { 'unet/model.onnx': 1732410827, 'text_encoder/model.onnx': 680854339, 'vae_decoder/model.onnx': 99072656, 'vae_encoder/model.onnx': 68412355 };
    const total = m.size; let doneBytes = 0;
    for (const f of m.multi) {
      const out = path.join(modelPath(id), f); fs.mkdirSync(path.dirname(out), { recursive: true });
      if (!fs.existsSync(out)) await download(`${m.url}/${f}`, out, (p, got) => onProgress?.(Math.min(0.97, (doneBytes + got) / total), doneBytes + got, total), signal);
      doneBytes += sizes[f] || fs.statSync(out).size;
    }
    const { fixModel } = require(path.join(paths.appUnpacked || paths.appRoot, 'src', 'neural', 'onnxfix.js'));
    for (const sub of ['vae_encoder', 'vae_decoder', 'unet']) {
      onProgress?.(0.98, doneBytes, total);
      const src = path.join(modelPath(id), sub, 'model.onnx'), dst = path.join(modelPath(id), sub, 'model_dml.onnx');
      await new Promise((r) => setTimeout(r, 30));
      if (!fs.existsSync(dst) && !fixModel(src, dst)) fs.copyFileSync(src, dst);
    }
    return;
  }
  if (m.zip) {
    const zip = path.join(modelDir(), path.basename(m.url));
    if (!fs.existsSync(zip)) await download(m.url, zip, onProgress, signal);
    const tmp = path.join(modelDir(), id + '_extract');
    fs.mkdirSync(tmp, { recursive: true }); const { unzip } = await import('../core/setup.js'); await unzip(zip, tmp);
    const inner = fs.readdirSync(tmp).map((n) => path.join(tmp, n)).find((p) => fs.statSync(p).isDirectory()) || tmp;
    fs.rmSync(modelPath(id), { recursive: true, force: true });
    fs.renameSync(inner, modelPath(id));
    fs.rmSync(tmp, { recursive: true, force: true }); fs.unlinkSync(zip);
    return;
  }
  await download(m.url, modelPath(id), onProgress, signal);
}
// make sure models exist; asks the user (listing names, source and size) before downloading
export async function ensureModels(ids) {
  const missing = ids.filter((id) => !installed(id));
  if (!missing.length) return true;
  const total = missing.reduce((s, id) => s + MODELS[id].size, 0);
  const ok = await confirmBox(L('Für diese KI-Funktion werden einmalig folgende Dateien heruntergeladen:\n\n', 'This AI feature needs a one-time download of:\n\n') + missing.map((id) => `• ${MODELS[id].name}\n   ${MODELS[id].file} · ${fmtBytes(MODELS[id].size)} · ${MODELS[id].src || new URL(MODELS[id].url).host}`).join('\n') + `\n\n${L('Gesamt', 'Total')}: ${fmtBytes(total)}`, { ok: L('Herunterladen', 'Download') });
  if (!ok) return false;
  const pm = progressModal(L('KI-Modelle werden geladen…', 'Downloading AI models…'));
  const ac = new AbortController(); pm.onCancel(() => ac.abort());
  try {
    for (const [i, id] of missing.entries()) await install(id, (p, got, tot) => pm.set((i + p) / missing.length, `${MODELS[id].name}: ${tot ? fmtBytes(got) + ' / ' + fmtBytes(tot) : L('installiere…', 'installing…')}`), ac.signal);
    toast(L('KI-Modelle installiert', 'AI models installed'), 'ok'); bus.emit('models');
    return true;
  } catch (e) { toast(L('Download fehlgeschlagen: ', 'Download failed: ') + e.message, 'err', 8000); return false; }
  finally { pm.close(); }
}

// ------------------------------------------------------------------ run worker
export function runWorker(cfg, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    const p = spawn(process.execPath, [path.join(paths.appUnpacked || paths.appRoot, 'src', 'neural', 'worker.js'), JSON.stringify({ ffmpeg: FFMPEG, ortPath: modelPath('ort'), ...cfg })], { env, windowsHide: true });
    let buf = '', err = '', result = null;
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line.startsWith('PROGRESS')) { const [, v, ...t] = line.split(' '); onProgress?.(+v, t.join(' ')); } else if (line.startsWith('DONE')) result = line.slice(5); else if (line.startsWith('ERROR')) err = line.slice(6); } });
    p.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    signal?.addEventListener('abort', () => p.kill());
    p.on('close', (code) => (result ? resolve(result) : reject(new Error(err || 'Worker beendet (' + code + ')'))));
  });
}

// process a clip's source range and swap in the result
// clip the user means: selection, otherwise the clip under the playhead (top-most visual)
export function pickClip(types = ['video', 'image']) {
  const sel = store.selectedClips().find((x) => types.includes(x.type));
  if (sel) return sel;
  const t = store.time;
  const vt = store.p.tracks.filter((x) => x.kind === 'video').reverse();
  for (const tr of vt) { const c = store.p.clips.find((x) => x.trackId === tr.id && types.includes(x.type) && x.start <= t && clipEnd(x) > t); if (c) return c; }
  const any = store.p.clips.find((x) => types.includes(x.type));
  if (any) return any;
  throw new Error(L('Kein Video in der Timeline – erst einen Clip hineinziehen', 'No video on the timeline – add a clip first'));
}
// target size for super-resolution
function srConfig(task, m, quality, factor = 1) {
  const fast = quality !== 'quality';
  const scale = fast ? 4 : factor >= 4 ? 4 : 2;
  const model = fast ? 'span' : scale === 4 ? 'esrgan_x4' : 'esrgan_x2';
  let outW = Math.min(7680, Math.round((m.width || 1920) * factor)), outH = Math.round(outW * (m.height || 1080) / (m.width || 1920));
  if (task === 'detail') { outW = Math.min(m.width || 1920, 3840); outH = Math.round(outW * (m.height || 1080) / (m.width || 1920)); }
  return { cfg: { scale, outW: outW & ~1, outH: outH & ~1, models: { esrgan: modelPath(model) } }, models: [model] };
}
export async function processClip(task, label, cfg = {}, { models, ext = '.mp4', keepAudio = true, clip } = {}) {
  const c = clip || pickClip();
  if (!(await ensureModels(['ort', ...models]))) return;
  const m = store.media(c.mediaId);
  const isImg = m.type === 'image';
  const start = isImg ? 0 : Math.max(0, c.in - 0.25), dur = isImg ? 0 : Math.min(m.duration - start, sourceLength(c) + 0.5);
  const out = path.join(paths.velox, 'KI-Ergebnisse', `${m.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}_${task}_${start.toFixed(2)}_${dur.toFixed(2)}_${require('crypto').createHash('md5').update(JSON.stringify(cfg)).digest('hex').slice(0, 8)}${isImg ? '.png' : ext}`);
  const pm = progressModal(label + ' · ' + (c.name || ''));
  const ac = new AbortController(); pm.onCancel(() => ac.abort());
  try {
    if (!fs.existsSync(out)) await runWorker({ task, input: m.path, output: out, start, duration: dur, ...cfg }, (p, t) => pm.set(p, t), ac.signal);
    const [nm] = await importFiles([out]);
    store.edit(label, () => {
      for (const x of [c, ...store.linked(c)]) {
        if (x.type !== 'video' && x.type !== 'image') continue;
        x.mediaId = nm.id; if (!isImg) x.in = Math.max(0, x.in - start); x.name = m.name + ' · ' + label;
      }
      if (!keepAudio) for (const l of store.linked(c)) l.linkId = null;
    });
    nm.folder = m.folder;
    toast(L(`${label} fertig`, `${label} done`), 'ok');
    return nm;
  } catch (e) {
    if (ac.signal.aborted) { toast(L('Abgebrochen', 'Cancelled')); return; }
    throw new Error(friendly(e.message));
  } finally { pm.close(); }
}
function friendly(msg) {
  if (/onnxruntime/i.test(msg)) return L('KI-Laufzeit fehlt – KI → KI-Modelle verwalten → ONNX Runtime installieren', 'AI runtime missing – install ONNX Runtime in AI models');
  if (/DML|DirectML|device/i.test(msg)) return L('Grafikkarte nicht verfügbar (DirectML). Treiber aktualisieren oder kleineren Clip testen. Details: ', 'GPU (DirectML) unavailable. Details: ') + msg.slice(0, 160);
  if (/ENOENT|nicht lesbar|No such file/i.test(msg)) return L('Datei nicht gefunden oder nicht lesbar', 'File not found or unreadable');
  return msg.slice(0, 300);
}

// single-frame AI preview with before/after slider (fast way to judge a result)
export async function aiPreview(task, cfg, models, label) {
  const c = pickClip();
  if (!(await ensureModels(['ort', ...models]))) return;
  const m = store.media(c.mediaId);
  const { sourceTime } = await import('../core/project.js');
  const st = m.type === 'image' ? 0 : sourceTime(c, Math.max(0, Math.min(c.dur - 0.01, store.time - c.start)));
  const dir = cacheDir('preview'); const inp = path.join(dir, 'in_' + Date.now() + '.png'); const out = path.join(dir, 'out_' + Date.now() + '.png');
  const pm = progressModal(L('KI-Vorschau (1 Bild)…', 'AI preview (1 frame)…'));
  try {
    await ff(['-ss', String(st), '-i', m.path, '-frames:v', '1', inp]);
    await runWorker({ task, input: inp, output: out, ...cfg }, (p, t) => pm.set(p, t));
  } catch (e) { pm.close(); throw new Error(friendly(e.message)); }
  pm.close();
  const { fileUrl } = await import('../core/util.js');
  const wrap = el('div', { style: { position: 'relative', width: '900px', aspectRatio: `${m.width || 16}/${m.height || 9}`, background: '#000', overflow: 'hidden', borderRadius: '8px', userSelect: 'none' } });
  const imgB = el('img', { src: fileUrl(out), style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } });
  const clipDiv = el('div', { style: { position: 'absolute', inset: 0, overflow: 'hidden', width: '50%' } }, el('img', { src: fileUrl(inp), style: { position: 'absolute', left: 0, top: 0, width: '900px', height: '100%', objectFit: 'contain' } }));
  const line = el('div', { style: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: '2px', background: '#fff', boxShadow: '0 0 6px #000' } });
  wrap.append(imgB, clipDiv, line, el('span', { class: 'chip', style: { position: 'absolute', left: '8px', top: '8px' } }, L('Vorher', 'Before')), el('span', { class: 'chip on', style: { position: 'absolute', right: '8px', top: '8px' } }, L('Nachher (KI)', 'After (AI)')));
  const mv = (e) => { const r = wrap.getBoundingClientRect(); const k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); clipDiv.style.width = k * 100 + '%'; line.style.left = k * 100 + '%'; };
  wrap.addEventListener('mousemove', mv);
  return new Promise((res) => modal({ title: L('KI-Vorschau: ', 'AI preview: ') + label, width: 940, body: el('div', {}, wrap, el('div', { class: 'muted', style: { marginTop: '6px' } }, L('Maus über das Bild bewegen = Vergleich. Gefällt es? Dann auf den ganzen Clip anwenden.', 'Move the mouse over the image to compare. Like it? Apply to the whole clip.'))),
    buttons: [{ label: L('Schließen', 'Close'), value: false }, { label: L('Auf ganzen Clip anwenden', 'Apply to whole clip'), cls: 'primary', value: true }], onClose: (v) => res(!!v) }));
}

// RIFE frame interpolation
async function slowmo(factor = 4, mode = 'slow') {
  const c = pickClip(['video']);
  if (!(await ensureModels(['rife']))) return;
  const m = store.media(c.mediaId);
  const start = Math.max(0, c.in), dur = Math.min(m.duration - start, sourceLength(c));
  const work = path.join(cacheDir('rife'), cacheKey(m.path) + '_' + start.toFixed(2) + '_' + dur.toFixed(2));
  const out = `${work}_x${factor}_${mode}.mp4`;
  const pm = progressModal(L(`KI-Zeitlupe ×${factor} (RIFE)…`, `AI slow motion ×${factor} (RIFE)…`));
  let cancelled = false; let proc = null; pm.onCancel(() => { cancelled = true; proc?.kill(); });
  try {
    if (!fs.existsSync(out)) {
      const inDir = work + '_in', outDir = work + '_out';
      fs.rmSync(inDir, { recursive: true, force: true }); fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(inDir, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
      pm.set(0.02, L('Frames extrahieren…', 'Extracting frames…'));
      await ff(['-ss', String(start), '-t', String(dur), '-i', m.path, '-fps_mode', 'passthrough', path.join(inDir, '%08d.png')]);
      const n = fs.readdirSync(inDir).length;
      pm.set(0.1, L(`Interpoliere ${n} → ${n * factor} Frames…`, `Interpolating ${n} → ${n * factor} frames…`));
      const exe = path.join(modelPath('rife'), 'rife-ncnn-vulkan.exe');
      await new Promise((res, rej) => {
        proc = spawn(exe, ['-i', inDir, '-o', outDir, '-n', String(n * factor), '-m', 'rife-v4.6', '-f', '%08d.png'], { cwd: modelPath('rife'), windowsHide: true });
        const iv = setInterval(() => { try { pm.set(0.1 + 0.8 * fs.readdirSync(outDir).length / (n * factor)); } catch {} }, 700);
        let e = ''; proc.stderr.on('data', (d) => (e += d));
        proc.on('close', (code) => { clearInterval(iv); cancelled ? rej(new Error('abgebrochen')) : code === 0 ? res() : rej(new Error('RIFE: ' + e.slice(-400))); });
      });
      pm.set(0.92, L('Video kodieren…', 'Encoding…'));
      const fps = m.fps || 30;
      await ff(['-framerate', String(mode === 'slow' ? fps : fps * factor), '-i', path.join(outDir, '%08d.png'), '-c:v', 'libx264', '-crf', '15', '-pix_fmt', 'yuv420p', out]);
      fs.rmSync(inDir, { recursive: true, force: true }); fs.rmSync(outDir, { recursive: true, force: true });
    }
    const [nm] = await importFiles([out]);
    store.edit('KI-Zeitlupe', (p) => {
      const oldEnd = clipEnd(c);
      c.mediaId = nm.id; c.in = 0; c.speed = 1; c.ramp = null; c.reverse = false; c.name = m.name + ` · Slowmo ×${factor}`;
      if (mode === 'slow') {
        c.dur = nm.duration; const d = clipEnd(c) - oldEnd;
        const move = new Set(p.clips.filter((o) => o.trackId === c.trackId && o.start >= oldEnd - 1e-3 && o.id !== c.id).map((o) => o.id));
        for (const o of p.clips) if (move.has(o.id) && o.linkId) p.clips.forEach((x) => { if (x.linkId === o.linkId && x.linkId !== c.linkId) move.add(x.id); });
        for (const o of p.clips) if (move.has(o.id)) o.start += d;
      }
      for (const l of store.linked(c)) { if (l.type === 'audio' && mode === 'slow') { l.speed = dur / nm.duration; l.dur = c.dur; l.start = c.start; } }
    });
    toast(L('KI-Zeitlupe fertig', 'AI slow motion done'), 'ok');
  } finally { pm.close(); }
}

async function voiceIsolate() {
  let s = store.selectedClips().flatMap((c) => (c.type === 'audio' ? [c] : store.linked(c).filter((l) => l.type === 'audio')));
  if (!s.length) { const t = store.time; s = store.p.clips.filter((c) => c.type === 'audio' && c.start <= t && clipEnd(c) > t); }
  if (!s.length) throw new Error(L('Kein Audio am Playhead – Clip auswählen', 'No audio at playhead – select a clip'));
  if (!(await ensureModels(['rnnoise']))) return;
  const model = modelPath('rnnoise').replace(/\\/g, '/').replace(':', '\\:');
  for (const c of s) {
    const m = store.media(c.mediaId);
    const out = path.join(cacheDir('neural'), cacheKey(m.path) + '_voice.wav');
    const pm = progressModal(L('Stimme isolieren (RNNoise)…', 'Isolating voice (RNNoise)…'));
    try {
      if (!fs.existsSync(out)) await ff(['-i', m.path, '-vn', '-af', `arnndn=m='${model}':mix=1,highpass=f=70,lowpass=f=12000,dynaudnorm=f=150:g=7`, '-ar', '48000', '-ac', '2', out], { duration: m.duration, onProgress: (p) => pm.set(p) });
      const [nm] = await importFiles([out]);
      store.edit('Stimme isolieren', () => { c.mediaId = nm.id; c.name = m.name + ' · Stimme'; });
    } finally { pm.close(); }
  }
  toast(L('Stimme isoliert', 'Voice isolated'), 'ok');
}

function modelsDialog() {
  const body = el('div', { style: { width: '620px' } });
  const fill = () => {
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'muted', style: { marginTop: 0 } }, L('Alle Modelle laufen lokal auf deiner Grafikkarte (DirectML / Vulkan – AMD, NVIDIA, Intel). Download nur einmal, gespeichert in ', 'All models run locally on your GPU. Stored in ') + modelDir()));
    for (const [id, m] of Object.entries(MODELS)) {
      const ok = installed(id);
      body.appendChild(el('div', { class: 'list-item', style: { background: 'var(--bg2)', marginBottom: '6px' } },
        el('span', { class: 'ic' }, ok ? '✅' : '⬇'), el('div', { style: { flex: 1 } }, el('div', {}, m.name), el('div', { class: 'muted', style: { fontSize: '11px' } }, `${m.file} · ${fmtBytes(m.size)} · ${m.src || new URL(m.url).host}`)),
        ok ? el('span', { class: 'chip on' }, L('Installiert', 'Installed')) : el('button', { class: 'btn small primary', onclick: async () => { await ensureModels(id === 'ort' ? ['ort'] : [id]); fill(); } }, L('Installieren', 'Install'))));
    }
  };
  fill();
  modal({ title: L('KI-Modelle', 'AI models'), body, buttons: [{ label: 'OK', cls: 'primary' }] });
}

registerCommands([
  { id: 'aiDetail', name: { de: 'KI-Details neu erfinden (schnell)', en: 'AI detail reconstruction (fast)' }, cat: 'ai', run: async () => { const c = pickClip(); const m = store.media(c.mediaId); const sc = srConfig('detail', m, 'fast'); if (await aiPreview('detail', sc.cfg, sc.models, L('KI-Details', 'AI detail'))) return processClip('detail', L('KI-Details', 'AI detail'), sc.cfg, { models: sc.models, clip: c }); } },
  { id: 'aiDetailHQ', name: { de: 'KI-Details neu erfinden (Höchste Qualität, langsam)', en: 'AI detail (best quality, slow)' }, cat: 'ai', run: async () => { const c = pickClip(); const m = store.media(c.mediaId); const sc = srConfig('detail', m, 'quality', 1); if (await aiPreview('detail', sc.cfg, sc.models, L('KI-Details HQ', 'AI detail HQ'))) return processClip('detail', L('KI-Details HQ', 'AI detail HQ'), sc.cfg, { models: sc.models, clip: c }); } },
  { id: 'aiUpscale', name: { de: 'KI-Hochskalieren ×2', en: 'AI upscale ×2' }, cat: 'ai', args: '{ scale?: 2|4, quality?: "fast"|"quality" }', run: async ({ scale = 2, quality = 'fast', preview = true } = {}) => { const c = pickClip(); const m = store.media(c.mediaId); const sc = srConfig('upscale', m, quality, scale); if (!preview || await aiPreview('upscale', sc.cfg, sc.models, L(`Hochskalieren ×${scale}`, `Upscale ×${scale}`))) return processClip('upscale', L(`KI-Hochskalieren ×${scale}`, `AI upscale ×${scale}`), sc.cfg, { models: sc.models, clip: c }); } },
  { id: 'aiUpscale4', name: { de: 'KI-Hochskalieren ×4', en: 'AI upscale ×4' }, cat: 'ai', run: () => run('aiUpscale', { scale: 4 }) },
  { id: 'aiFaceRestore', name: { de: 'KI-Gesichtsverbesserung (GFPGAN)', en: 'AI face restore (GFPGAN)' }, cat: 'ai', args: '{ strength? }', run: async ({ strength = 0.9, preview = true } = {}) => { const cfg = { strength, models: { yoloface: modelPath('yoloface'), gfpgan: modelPath('gfpgan') } }; if (preview && !(await aiPreview('face', cfg, ['yoloface', 'gfpgan'], L('KI-Gesichter', 'AI faces')))) return; return processClip('face', L('KI-Gesichter', 'AI faces'), cfg, { models: ['yoloface', 'gfpgan'] }); } },
  { id: 'aiRemoveBg', name: { de: 'KI-Hintergrund entfernen', en: 'AI remove background' }, cat: 'ai', args: '{ fast? }', run: async ({ fast = false, preview = true } = {}) => { if (preview && !(await aiPreview('bgremove', { matteKind: fast ? 'modnet' : 'rmbg', models: { matte: modelPath(fast ? 'modnet' : 'rmbg') } }, [fast ? 'modnet' : 'rmbg'], L('Freistellung', 'Cutout')))) return; return processClip('bgremove', L('KI-Freistellung', 'AI cutout'), { matteKind: fast ? 'modnet' : 'rmbg', models: { matte: modelPath(fast ? 'modnet' : 'rmbg') } }, { models: [fast ? 'modnet' : 'rmbg'], ext: '.webm' }); } },
  { id: 'aiRemoveBgFast', name: { de: 'KI-Hintergrund entfernen (schnell, Personen)', en: 'AI remove background (fast)' }, cat: 'ai', run: () => processClip('bgremove', L('KI-Freistellung', 'AI cutout'), { matteKind: 'modnet', models: { matte: modelPath('modnet') } }, { models: ['modnet'], ext: '.webm' }) },
  { id: 'aiSlowmo', name: { de: 'KI-Zeitlupe (RIFE)', en: 'AI slow motion (RIFE)' }, cat: 'ai', args: '{ factor?: 2|4|8, mode?: "slow"|"smooth" }', run: ({ factor = 4, mode = 'slow' } = {}) => slowmo(factor, mode) },
  { id: 'aiSlowmo2', name: { de: 'KI-Zeitlupe ×2', en: 'AI slow motion ×2' }, cat: 'ai', run: () => slowmo(2) },
  { id: 'aiSlowmo8', name: { de: 'KI-Zeitlupe ×8', en: 'AI slow motion ×8' }, cat: 'ai', run: () => slowmo(8) },
  { id: 'aiSmoothFps', name: { de: 'KI-Flüssig (doppelte FPS)', en: 'AI smooth (double fps)' }, cat: 'ai', run: () => slowmo(2, 'smooth') },
  { id: 'aiVoiceIsolate', name: { de: 'Stimme isolieren (neuronal)', en: 'Isolate voice (neural)' }, cat: 'ai', run: () => voiceIsolate() },
  { id: 'aiModels', name: { de: 'KI-Modelle verwalten…', en: 'Manage AI models…' }, cat: 'ai', run: () => modelsDialog() },
]);
