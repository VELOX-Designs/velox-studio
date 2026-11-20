// VELOX Studio – renderer bootstrap
import { initPaths, loadSettings, loadPresets, settings, paths } from './core/settings.js';
import { applyStatic } from './core/i18n.js';
import { bus, $ } from './core/util.js';
import { store } from './core/project.js';
import { checkFfmpeg } from './core/ffmpeg.js';
import { toast, modal } from './ui/dialogs.js';
const { ipcRenderer } = require('electron');

const logIpc = (kind, x) => { try { ipcRenderer.send('log', kind, x?.stack || (typeof x === 'object' ? JSON.stringify(x) : String(x))); } catch {} };
window.addEventListener('error', (e) => { console.error(e.error || e.message); logIpc('renderer-error', e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); logIpc('renderer-rejection', e.reason); });
{ const ce = console.error.bind(console); console.error = (...a) => { ce(...a); logIpc('console-error', a.map((x) => x?.stack || (typeof x === 'object' ? (() => { try { return JSON.stringify(x); } catch { return String(x); } })() : String(x))).join(' ')); }; }

// Sliders/inputs inside draggable cards (effect list, photo layers): the card must never steal the mouse.
// While a control is pressed, its draggable ancestors are switched off and any drag is cancelled.
{
  const CTRL = 'input, select, textarea, button, [contenteditable="true"], .no-drag';
  const off = []; let pressing = false;
  window.addEventListener('pointerdown', (e) => {
    if (!e.target.closest?.(CTRL)) return;
    pressing = true;
    for (let n = e.target.parentElement; n; n = n.parentElement) if (n.getAttribute?.('draggable') === 'true') { n.setAttribute('draggable', 'false'); off.push(n); }
  }, true);
  const restore = () => { pressing = false; while (off.length) off.pop().setAttribute('draggable', 'true'); };
  window.addEventListener('pointerup', restore, true); window.addEventListener('pointercancel', restore, true); window.addEventListener('blur', restore);
  window.addEventListener('dragstart', (e) => { if (pressing) e.preventDefault(); }, true);
}

async function boot() {
  await initPaths();
  // graphics check: without WebGL2 the preview/export cannot work → tell the user what to do
  { const t = document.createElement('canvas').getContext('webgl2'); if (!t) { logIpc('webgl2', 'not available'); document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;z-index:99999;background:#111;color:#eee;display:grid;place-items:center;font:15px Segoe UI"><div style="max-width:560px;line-height:1.6"><h2>Grafik nicht verfügbar (WebGL2)</h2>VELOX braucht eine Grafikkarte mit aktuellem Treiber.<br>1. Grafiktreiber aktualisieren (AMD / NVIDIA / Intel Webseite)<br>2. PC neu starten<br>3. Bei Laptops: VELOX in den Windows-Grafikeinstellungen auf „Hohe Leistung“ stellen.</div></div>'); } }
  loadSettings(); loadPresets();
  document.documentElement.lang = settings.lang;
  applyStatic();
  // modules (order matters: commands register on import)
  await import('./ui/actions.js');
  await import('./ui/exporter.js');
  await import('./ai/tools.js');
  await import('./ai/neural.js');
  await import('./ai/dlss5.js');
  await import('./ai/neuralrender.js');
  await import('./ai/censor.js');
  await import('./ai/captions.js');
  await import('./photo/photo.js');
  await import('./core/sequences.js');
  await import('./ui/gfxui.js');
  await import('./ui/audiox.js');
  await import('./ui/audiofx.js');
  await import('./ui/home.js');
  const extras = await import('./ui/extras.js');
  extras.applyTheme();
  const { loadPlugins } = await import('./core/plugins.js');
  const fileops = await import('./core/fileops.js');
  const menus = await import('./ui/menus.js');
  const { initViewer } = await import('./ui/viewer.js');
  const { initTimeline } = await import('./ui/timeline.js');
  const { initInspector } = await import('./ui/inspector.js');
  const { initLibrary, loadInstalledFonts } = await import('./ui/library.js');
  const { startApi, apiInfo } = await import('./core/api.js');
  const { jobCount } = await import('./core/media.js');
  const { engine } = await import('./playback/engine.js');

  loadPlugins();
  menus.registerDynamicCommands();
  menus.initMenus();
  menus.initSplitters();
  menus.setWorkspace(settings.workspace || 'edit');
  menus.setMode(settings.mode || 'pro');
  initViewer();
  initTimeline();
  (await import('./ui/seqbar.js')).initSeqBar();
  initInspector();
  initLibrary();
  loadInstalledFonts();
  startApi();

  // status bar
  const status = $('#status-text');
  bus.on('toast', (msg, type) => toast(msg, type));
  bus.on('command', (id) => { status.textContent = id; });
  bus.on('jobs', (n) => { $('#status-jobs').textContent = n ? `⏳ ${n} Hintergrund-Aufgabe(n)` : ''; });
  bus.on('export:progress', (p) => { $('#status-jobs').textContent = `⬤ Export ${(p * 100).toFixed(0)}%`; });
  bus.on('export:end', () => { $('#status-jobs').textContent = ''; });
  bus.on('api:ready', (a) => { $('#status-api').textContent = `🤖 API :${a.port}`; });
  bus.on('api', (k) => { status.textContent = '🤖 ' + k; });
  bus.on('media:error', (id) => { const m = store.media(id); if (m && !m.proxyPath && !m._proxying) import('./core/media.js').then((x) => x.createProxy(m)); });
  const updTitle = () => { $('#title-project').textContent = (store.p.name || '') + (store.dirty ? ' •' : ''); $('#status-project').textContent = store.filePath || ''; };
  bus.on('changed', updTitle); bus.on('saved', updTitle); updTitle();
  const setup = await import('./core/setup.js');
  setup.initUpdates();
  const ff = await setup.ensureFfmpeg();
  $('#status-gpu').textContent = ff ? ff.replace('ffmpeg version ', 'FFmpeg ').split(' Copyright')[0] : 'FFmpeg fehlt!';
  try { const gl = document.createElement('canvas').getContext('webgl2'); const dbg = gl.getExtension('WEBGL_debug_renderer_info'); const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ''; $('#status-gpu').textContent += ' · ' + (r.match(/(Radeon[^,)]*|GeForce[^,)]*|RTX[^,)]*|Intel[^,)]*|Arc[^,)]*)/)?.[0] || 'GPU'); } catch {}

  window.__velox = { store, engine, bus, paths, run: (await import('./core/commands.js')).run };
  fileops.startAutosave();
  // close handling
  ipcRenderer.on('app:request-close', async () => {
    if (await fileops.confirmDiscard()) { ipcRenderer.send('app:clean-exit'); ipcRenderer.send('win:force-close'); }
  });
  const recovered = await fileops.checkRecovery();
  const arg = new URLSearchParams(location.search).get('open');
  const openArg = async (f) => {
    if (!f) return;
    if (/\.velox$/i.test(f)) { (await import('./ui/home.js')).closeHome(); await fileops.openProject(f); }
    else { const ph = await import('./photo/photo.js'); (await import('./ui/home.js')).closeHome(); ph.openPhotoMode(f); }
  };
  ipcRenderer.on('app:open-file', (_e, f) => openArg(f));
  if (!recovered && !arg) fileops.newProjectDialog(true);
  else if (arg) setTimeout(() => openArg(arg), 300);
  if (!settings.tutorialDone) { const off = bus.on('project:loaded', () => { off(); setTimeout(() => extras.startTutorial(0), 600); }); }
  bus.emit('ready');
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:40px;background:#200;color:#fbb;padding:20px;z-index:9999;white-space:pre-wrap">Startfehler:\n${e.stack || e}</pre>`); });
