// First-run setup for installed builds: locate / download FFmpeg, auto-update UI.
import { paths } from './settings.js';
import { setBinaries, checkFfmpeg } from './ffmpeg.js';
import { L } from './i18n.js';
import { el, fmtBytes } from './util.js';
import { registerCommands } from './commands.js';
import { modal, toast, progressModal } from '../ui/dialogs.js';
const { ipcRenderer } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// mirrors in order (the BtbN repo moved to FFmpeg-Builds – keep both)
const FFMPEG_ZIPS = [
  'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-9.0.zip',
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-9.0.zip',
  'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
];
const binDir = () => path.join(paths.userData, 'bin');
const major = (v) => +((v || '').match(/version n?(\d+)/)?.[1] || 0) || (/version N-/.test(v || '') ? 99 : 0);

// order: FFmpeg shipped with the installer → previously downloaded copy → a recent FFmpeg on PATH → download
export async function ensureFfmpeg() {
  const cands = [];
  if (paths.resources) cands.push(path.join(paths.resources, 'ffmpeg'));
  cands.push(binDir());
  for (const d of cands) {
    const ff = path.join(d, 'ffmpeg.exe'), fp = path.join(d, 'ffprobe.exe');
    if (fs.existsSync(ff) && fs.existsSync(fp)) { setBinaries(ff, fp); const v = await checkFfmpeg(); if (v) return v; }
  }
  setBinaries('ffmpeg', 'ffprobe');
  const sys = await checkFfmpeg();
  if (sys && major(sys) >= 6) return sys; // older system builds miss options VELOX uses (-fps_mode …)
  return downloadFfmpeg(sys);
}
export async function fetchTo(url, out, onProgress, signal) {
  // resumable download with timeout per chunk
  let got = fs.existsSync(out) ? fs.statSync(out).size : 0;
  const res = await fetch(url, { redirect: 'follow', signal, headers: got ? { Range: `bytes=${got}-` } : {} });
  if (res.status === 416) return; // already complete
  if (!res.ok) throw new Error('HTTP ' + res.status);
  if (got && res.status !== 206) got = 0;
  const total = (+res.headers.get('content-length') || 0) + got;
  const fd = fs.openSync(out, got ? 'a' : 'w');
  try {
    const rd = res.body.getReader();
    for (;;) {
      const r = await Promise.race([rd.read(), new Promise((_, j) => setTimeout(() => j(new Error(L('Zeitüberschreitung beim Download', 'Download timed out'))), 60000))]);
      if (r.done) break; fs.writeSync(fd, r.value); got += r.value.length; onProgress?.(total ? got / total : 0, got, total);
    }
  } finally { fs.closeSync(fd); }
}
export function unzip(zip, dest) {
  // Windows 10/11 ship bsdtar (fast, no PowerShell policy issues); PowerShell as fallback
  const tar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe');
  return new Promise((res, rej) => execFile(tar, ['-xf', zip, '-C', dest], { windowsHide: true, maxBuffer: 1e7 }, (e) => {
    if (!e) return res();
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -Force -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}'`], { windowsHide: true }, (e2) => (e2 ? rej(new Error(L('Entpacken fehlgeschlagen: ', 'Extract failed: ') + (e2.message || e.message))) : res()));
  }));
}
async function downloadFfmpeg(sys) {
  const ok = await new Promise((res) => modal({ title: L('FFmpeg fehlt', 'FFmpeg missing'), closable: false,
    body: el('div', { style: { maxWidth: '520px', lineHeight: 1.6 } }, el('p', {}, L('VELOX braucht FFmpeg zum Lesen und Exportieren von Videos. Normalerweise ist es im Installer enthalten – hier fehlt es. Jetzt einmalig herunterladen (ca. 200 MB von GitHub)?', 'VELOX needs FFmpeg. Download it once now (~200 MB from GitHub)?')),
      sys ? el('p', { class: 'muted' }, L('Gefunden, aber zu alt: ', 'Found but too old: ') + sys) : null),
    buttons: [{ label: L('Später', 'Later'), value: false }, { label: L('Jetzt herunterladen', 'Download now'), cls: 'primary', value: true }], onClose: res }));
  if (!ok) { if (sys) return sys; return null; }
  const pm = progressModal(L('Lade FFmpeg…', 'Downloading FFmpeg…')); const ac = new AbortController(); pm.onCancel?.(() => ac.abort());
  const zip = path.join(binDir(), 'ffmpeg.zip'); const tmp = path.join(binDir(), 'x');
  let lastErr = null;
  try {
    fs.mkdirSync(binDir(), { recursive: true });
    for (const url of FFMPEG_ZIPS) for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fetchTo(url, zip, (p, got, tot) => pm.set(p * 0.9, `${fmtBytes(got)} / ${fmtBytes(tot)}`), ac.signal);
        pm.set(0.92, L('Entpacke…', 'Extracting…'));
        fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
        await unzip(zip, tmp);
        const find = (d) => { for (const n of fs.readdirSync(d)) { const q = path.join(d, n); if (fs.statSync(q).isDirectory()) { const f = find(q); if (f) return f; } else if (n.toLowerCase() === 'ffmpeg.exe') return d; } return null; };
        const dir = find(tmp); if (!dir) throw new Error('ffmpeg.exe nicht im Archiv');
        for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) fs.copyFileSync(path.join(dir, exe), path.join(binDir(), exe));
        setBinaries(path.join(binDir(), 'ffmpeg.exe'), path.join(binDir(), 'ffprobe.exe'));
        const v = await checkFfmpeg(); if (!v) throw new Error(L('FFmpeg startet nicht (Virenscanner?)', 'FFmpeg does not start (antivirus?)'));
        toast(L('FFmpeg installiert', 'FFmpeg installed'), 'ok');
        return v;
      } catch (e) { lastErr = e; if (ac.signal.aborted) throw e; try { fs.unlinkSync(zip); } catch {} await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
    }
    throw lastErr || new Error('Download fehlgeschlagen');
  } catch (e) {
    modal({ title: L('FFmpeg konnte nicht geladen werden', 'Could not get FFmpeg'), body: el('div', { style: { maxWidth: '540px', lineHeight: 1.6 } }, el('p', {}, String(e.message || e)), el('p', { class: 'muted' }, L('Internet/Firewall prüfen und VELOX neu starten. Oder ffmpeg.exe + ffprobe.exe manuell in diesen Ordner legen: ', 'Check internet/firewall and restart. Or put ffmpeg.exe + ffprobe.exe into: ') + binDir())), buttons: [{ label: L('Ordner öffnen', 'Open folder'), onClick: () => { ipcRenderer.invoke('shell:open', binDir()); return false; } }, { label: 'OK', cls: 'primary', value: true }] });
    return sys || null;
  } finally { pm.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); fs.unlinkSync(zip); } catch {} }
}

// ------------------------------------------------------------------ updates
let readyInfo = null;
export function initUpdates() {
  ipcRenderer.on('update:status', (e, s) => {
    if (s.state === 'available') toast(L(`Update ${s.version} gefunden – wird im Hintergrund geladen…`, `Update ${s.version} found – downloading…`), '', 5000);
    if (s.state === 'ready') {
      readyInfo = s;
      modal({ title: L('Update bereit', 'Update ready'), body: L(`VELOX Studio ${s.version} wurde geladen. Jetzt neu starten und installieren? (Dein Projekt wird vorher gespeichert, falls nötig.)`, `VELOX Studio ${s.version} is ready. Restart and install now?`),
        buttons: [{ label: L('Später (beim Beenden)', 'Later (on quit)'), value: false }, { label: L('Jetzt neu starten', 'Restart now'), cls: 'primary', onClick: async () => { const { saveProject } = await import('./fileops.js'); const { store } = await import('./project.js'); if (store.dirty && store.p.clips.length) await saveProject(false); ipcRenderer.send('app:clean-exit'); ipcRenderer.send('update:install'); } }] });
    }
    if (s.state === 'error' && s.manual) toast(L('Update-Fehler: ', 'Update error: ') + s.message, 'err');
  });
}
registerCommands([
  { id: 'checkUpdates', name: { de: 'Nach Updates suchen', en: 'Check for updates' }, cat: 'help', run: async () => {
    const r = await ipcRenderer.invoke('update:check');
    if (r.state === 'dev') toast(L('Updates gibt es nur in der installierten Version.', 'Updates are only available in the installed version.'));
    else if (r.state === 'error') toast(L('Update-Prüfung fehlgeschlagen: ', 'Update check failed: ') + r.message, 'err', 8000);
    else if (!r.version || r.version === paths.version) toast(L('Du hast die neueste Version (' + paths.version + ').', 'You are up to date (' + paths.version + ').'), 'ok');
  } },
  { id: 'installUpdate', name: { de: 'Update jetzt installieren', en: 'Install update now' }, cat: 'help', run: () => { if (!readyInfo) { toast(L('Kein Update geladen', 'No update downloaded')); return; } ipcRenderer.send('update:install'); } },
]);

// ------------------------------------------------------------------ bug report (for testers on other PCs)
export async function bugReport() {
  const { settings } = await import('./settings.js');
  const { FFMPEG } = await import('./ffmpeg.js');
  const si = await ipcRenderer.invoke('app:sysinfo');
  let gl = ''; try { const g = document.createElement('canvas').getContext('webgl2'); const d = g.getExtension('WEBGL_debug_renderer_info'); gl = d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'webgl2 ok'; } catch { gl = 'KEIN WEBGL2'; }
  const ffv = await checkFfmpeg();
  const models = (() => { try { return fs.readdirSync(path.join(paths.userData, 'models')).join(', '); } catch { return '-'; } })();
  const log = (() => { try { return fs.readFileSync(si.log, 'utf8').split('\n').slice(-300).join('\n'); } catch { return '(kein Log)'; } })();
  const anon = (s) => String(s).split(require('os').userInfo().username).join('<user>');
  const txt = [`VELOX Studio Fehlerbericht – ${new Date().toLocaleString()}`, `Version: ${paths.version} (${paths.isPackaged ? 'installiert' : 'Entwicklung'})`, `Windows: ${si.os} ${si.arch} · CPU: ${si.cpus} · RAM: ${si.ram}`, `Grafik: ${gl}`, `GPU-Status: ${JSON.stringify(si.gpuFeatures)}`,
    `FFmpeg: ${ffv || 'NICHT GEFUNDEN'} (${anon(FFMPEG)})`, `VELOX-Ordner: ${anon(paths.velox)}`, `KI-Modelle: ${models}`, `Sprache/Modus: ${settings.lang}/${settings.mode}`, '', '----- Log (letzte 300 Zeilen) -----', anon(log)].join('\n');
  const out = path.join(paths.desktop, `VELOX-Fehlerbericht-${Date.now().toString(36)}.txt`);
  fs.writeFileSync(out, txt, 'utf8');
  toast(L('Fehlerbericht auf dem Desktop gespeichert – bitte an den Entwickler schicken', 'Bug report saved to the desktop'), 'ok', 8000);
  ipcRenderer.invoke('shell:show', out).catch(() => {});
  return out;
}
registerCommands([{ id: 'bugReport', name: { de: 'Fehlerbericht erstellen (für Support)', en: 'Create bug report' }, cat: 'help', run: () => bugReport() }]);
