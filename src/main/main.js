// VELOX Studio – Electron main process
// Owns windows, native dialogs and app paths. All media work runs in the renderer
// (nodeIntegration) so frames never cross the IPC boundary.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// long shader compiles (hundreds of effects) must not trip the GPU watchdog and kill the GPU process
app.commandLine.appendSwitch('disable-gpu-watchdog');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,ParallelShaderCompile');

// never let Chromium block WebGL after a GPU reset (heavy GPU/AI load on Windows can trigger driver resets)
app.disableDomainBlockingFor3DAPIs();

app.setPath('userData', process.env.VELOX_USERDATA || path.join(app.getPath('appData'), 'velox-studio'));

let win = null;
let forceClose = false;

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0d0f13',
    title: 'VELOX Studio',
    frame: false,
    show: false,
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  const f = fileArg(process.argv);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), f ? { query: { open: f } } : undefined);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    win.webContents.send('app:request-close');
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

// files passed by Windows (double-click on .velox / .vxfoto / images, "Öffnen mit")
function fileArg(argv) { return argv.slice(1).find((a) => /\.(velox|vxfoto|png|jpe?g|webp|bmp)$/i.test(a) && fs.existsSync(a)) || null; }
// ------------------------------------------------------------------ error log (for bug reports from other PCs)
const logFile = () => path.join(app.getPath('userData'), 'logs', 'velox.log');
function logLine(kind, msg) {
  try { fs.mkdirSync(path.dirname(logFile()), { recursive: true }); const f = logFile(); if (fs.existsSync(f) && fs.statSync(f).size > 2e6) fs.renameSync(f, f + '.old'); fs.appendFileSync(f, `[${new Date().toISOString()}] ${kind}: ${String(msg).slice(0, 4000)}
`); } catch {}
}
process.on('uncaughtException', (e) => logLine('main-exception', e.stack || e));
process.on('unhandledRejection', (e) => logLine('main-rejection', e?.stack || e));
app.on('render-process-gone', (_e, _wc, d) => logLine('renderer-gone', JSON.stringify(d)));
app.on('child-process-gone', (_e, d) => logLine('child-gone', JSON.stringify(d)));
ipcMain.on('log', (_e, kind, msg) => logLine(kind, msg));
ipcMain.handle('app:sysinfo', async () => { let gpu = null; try { gpu = await app.getGPUInfo('basic'); } catch {} return { os: require('os').release(), arch: process.arch, cpus: require('os').cpus()[0]?.model, ram: Math.round(require('os').totalmem() / 1e9) + ' GB', electron: process.versions.electron, chrome: process.versions.chrome, gpu: gpu?.gpuDevice, gpuFeatures: app.getGPUFeatureStatus(), log: logFile() }; });
// single instance: a second start focuses the running window
if (!app.requestSingleInstanceLock() && !process.argv.some((a) => a.startsWith('--remote-debugging-port'))) { app.quit(); }
app.on('second-instance', (_e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); const f = fileArg(argv); if (f) win.webContents.send('app:open-file', f); } });

app.whenReady().then(() => { createWindow(); setupUpdater(); });
app.on('window-all-closed', () => app.quit());

const appRoot = path.join(__dirname, '..', '..');
ipcMain.handle('app:paths', () => ({
  userData: app.getPath('userData'),
  documents: app.getPath('documents'),
  desktop: app.getPath('desktop'),
  videos: app.getPath('videos'),
  music: app.getPath('music'),
  temp: app.getPath('temp'),
  appRoot,
  // native modules / scripts started as separate processes live outside the asar archive
  appUnpacked: app.isPackaged ? appRoot.replace(/app\.asar$/, 'app.asar.unpacked') : appRoot,
  isPackaged: app.isPackaged,
  resources: app.isPackaged ? process.resourcesPath : path.join(appRoot, 'vendor'),
  home: app.getPath('home'),
  exe: process.execPath,
  version: app.getVersion(),
}));

// ------------------------------------------------------------------ auto updates (GitHub Releases)
let updater = null;
function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    const send = (state, info = {}) => win?.webContents.send('update:status', { state, ...info });
    updater.on('checking-for-update', () => send('checking'));
    updater.on('update-available', (i) => send('available', { version: i.version }));
    updater.on('update-not-available', () => send('none'));
    updater.on('download-progress', (p) => send('progress', { percent: p.percent }));
    updater.on('update-downloaded', (i) => send('ready', { version: i.version }));
    updater.on('error', (e) => send('error', { message: String(e?.message || e).slice(0, 300) }));
    setTimeout(() => updater.checkForUpdates().catch(() => {}), 8000);
  } catch (e) { console.warn('updater', e); }
}
ipcMain.handle('update:check', async () => { if (!updater) return { state: 'dev' }; try { const r = await updater.checkForUpdates(); return { state: 'ok', version: r?.updateInfo?.version }; } catch (e) { return { state: 'error', message: e.message }; } });
ipcMain.on('update:install', () => { if (updater) { forceClose = true; updater.quitAndInstall(false, true); } });

ipcMain.handle('dialog:open', (e, opts) => dialog.showOpenDialog(win, opts));
ipcMain.handle('dialog:save', (e, opts) => dialog.showSaveDialog(win, opts));
ipcMain.handle('dialog:message', (e, opts) => dialog.showMessageBox(win, opts));
ipcMain.handle('shell:show', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:open', (e, p) => shell.openPath(p));

ipcMain.on('win:minimize', () => win.minimize());
ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => win.close());
ipcMain.on('win:force-close', () => { forceClose = true; win.close(); });
ipcMain.on('win:fullscreen', () => win.setFullScreen(!win.isFullScreen()));
ipcMain.on('win:devtools', () => win.webContents.toggleDevTools());

// marker that the app shut down cleanly (crash recovery uses it)
ipcMain.on('app:clean-exit', () => {
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'clean-exit'), String(Date.now())); } catch {}
});
