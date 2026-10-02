const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const os = require('os');

// Enable Gamepad API in Electron
app.commandLine.appendSwitch('enable-gamepad');
const path = require('path');
const RetroArchBridge = require('./bridge/RetroArchBridge');
const registerIpcHandlers = require('./ipc/handlers');

let mainWindow;
let bridge; // declared here, instantiated before app.whenReady

function createWindow() {
  // FIX_2026-09-29_SMOOTH_RELAUNCH: open at full work-area size so the later
  // maximize() causes no visible resize.
  const _wa = require('electron').screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
    x: _wa.x,
    y: _wa.y,
    width: _wa.width,
    height: _wa.height,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      gamepad: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
  });
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// FIX_2026-09-29_SINGLE_INSTANCE: only one EasyArc at a time. A second launch
// brings the existing window forward instead of opening another copy.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.setOpacity(1);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  await ensureRetroArchReady();
  await ensurePPSSPPReady();
  bridge = new RetroArchBridge();
  registerIpcHandlers(ipcMain, bridge, dialog);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// FIX_2026-08-27_PPSSPP_BUNDLE: copy bundled PPSSPP to appdata on first run.
async function ensurePPSSPPReady() {
  if (process.platform !== 'win32') return;
  const appData = process.env.APPDATA || os.homedir();
  const destDir = path.join(appData, 'easyarc', 'ppsspp');
  const destExe = path.join(destDir, 'PPSSPPWindows64.exe');

  if (fs.existsSync(destExe)) {
    console.log('[PPSSPP-BUNDLE] Already installed at:', destDir);
    return;
  }

  console.log('[PPSSPP-BUNDLE] First run — copying PPSSPP bundle...');
  const bundleDir = path.join(process.resourcesPath, 'ppsspp-bundle');

  if (!fs.existsSync(bundleDir)) {
    console.log('[PPSSPP-BUNDLE] Bundle not found at:', bundleDir);
    return;
  }

  try {
    fs.mkdirSync(destDir, { recursive: true });
    copyDirRecursive(bundleDir, destDir);
    console.log('[PPSSPP-BUNDLE] Copy complete.');
  } catch (err) {
    console.log('[PPSSPP-BUNDLE] Copy failed:', err.message);
  }
}

// FIX_2026-08-27_RETROARCH_BUNDLE: copy bundled RetroArch to appdata on first run.
// Checks for retroarch.exe in the managed location; if missing, copies the entire
// retroarch-bundle from extraResources. Shows no UI — copy completes before window opens.
async function ensureRetroArchReady() {
  if (process.platform !== 'win32') return;
  const appData = process.env.APPDATA || os.homedir();
  const destDir = path.join(appData, 'easyarc', 'retroarch');
  const destExe = path.join(destDir, 'retroarch.exe');

  if (fs.existsSync(destExe)) {
    console.log('[RETROARCH-BUNDLE] Already installed at:', destDir);
    return;
  }

  console.log('[RETROARCH-BUNDLE] First run — copying RetroArch bundle...');
  const bundleDir = path.join(process.resourcesPath, 'retroarch-bundle');

  if (!fs.existsSync(bundleDir)) {
    console.log('[RETROARCH-BUNDLE] Bundle not found at:', bundleDir);
    return;
  }

  try {
    fs.mkdirSync(destDir, { recursive: true });
    copyDirRecursive(bundleDir, destDir);
    console.log('[RETROARCH-BUNDLE] Copy complete.');
  } catch (err) {
    console.log('[RETROARCH-BUNDLE] Copy failed:', err.message);
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// FIX_2026-09-29_NINTENDO_RELAUNCH: relaunch EasyArc after a game when a Nintendo
// controller is connected. Only a fresh app start re-initializes it (reload doesn't).
let _eaRelaunching = false; // FIX_2026-09-29_SINGLE_INSTANCE
ipcMain.handle('app:relaunchForController', () => {
  if (_eaRelaunching) return;
  _eaRelaunching = true;
  app.releaseSingleInstanceLock();
  console.log('[MAIN] Relaunching to re-initialize Nintendo controller');
  if (mainWindow) mainWindow.setOpacity(0);
  app.relaunch();
  app.exit(0);
});

// FIX_2026-09-30_SDL_NINTENDO: read Nintendo controllers (vendor 057e) through SDL,
// which keeps working after emulators exit (Chromium's copy freezes). Windows only.
// If SDL fails to load, nothing is sent and the relaunch fallback stays active.
if (process.platform === 'win32') {
  process.env.SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS = '1';
  app.whenReady().then(() => {
    // FIX_2026-10-01_SDL_AFTER_LOAD: (1) start SDL only after the page has loaded, matching the
    // sandbox setup proven to coexist with Chromium's controller support; (2) off switch: a file
    // named disable-sdl (or disable-sdl.txt) in %APPDATA%\easyarc skips SDL entirely; (3) report
    // status to the page so DevTools shows whether SDL is disabled, failed, or running.
    const sendStatus = (st) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sdl-nintendo', st); };
    const startWhenLoaded = (fn) => {
      const w = mainWindow;
      if (w && !w.isDestroyed()) {
        if (w.webContents.isLoading()) w.webContents.once('did-finish-load', fn); else fn();
      } else setTimeout(() => startWhenLoaded(fn), 200);
    };
    startWhenLoaded(() => {
    const _p = require('path'), _fs = require('fs');
    const _dir = _p.join(app.getPath('appData'), 'easyarc');
    if (_fs.existsSync(_p.join(_dir, 'disable-sdl')) || _fs.existsSync(_p.join(_dir, 'disable-sdl.txt'))) {
      console.log('[SDL] disabled by switch file');
      setInterval(() => sendStatus({ active: false, disabled: true, connected: false }), 500);
      return;
    }
    // FIX_2026-10-02_SDL_HELPER: SDL now runs in a restartable helper process (src/sdl-helper.js).
    // Evidence: SDL frozen after a game is cured by a fresh process; reopening in-process is not.
    // After each game (Nintendo connected only), the helper is stopped, waited for, and replaced;
    // the page sees a neutral controller meanwhile. If the helper fails, status shows the error
    // and the relaunch fallback stays active.
    const { utilityProcess } = require('electron');
    const helperPath = _p.join(__dirname, 'sdl-helper.js').replace('app.asar' + _p.sep, 'app.asar.unpacked' + _p.sep);
    let helper = null, last = null, restarting = false, restartStartedAt = 0, lastRestartMs = null, helperError = null;
    const startHelper = () => {
      let h;
      try { h = utilityProcess.fork(helperPath, [], { serviceName: 'EasyArc SDL helper' }); }
      catch (e) { helperError = 'helper failed to start: ' + String(e && e.message); restarting = false; return; }
      helper = h;
      h.on('message', (msg) => {
        if (h !== helper || !msg) return;
        if (msg.type === 'state') {
          last = msg;
          if (restarting) { restarting = false; lastRestartMs = Date.now() - restartStartedAt; console.log('[SDL] helper restarted in', lastRestartMs, 'ms'); }
        } else if (msg.type === 'error') { helperError = msg.error; restarting = false; }
      });
      h.on('exit', (code) => {
        if (h !== helper) return;
        helper = null; last = null;
        if (!restarting && !helperError) helperError = 'helper exited unexpectedly (code ' + code + ')';
      });
    };
    startHelper();
    // The page already calls this after every game exit (see FIX_2026-10-01_SDL_REOPEN in index.html).
    ipcMain.handle('sdl:reopenNintendo', () => {
      if (restarting || helperError) return;
      if (!last || !last.connected) return;           // no Nintendo controller: nothing to reset
      restarting = true; restartStartedAt = Date.now();
      const old = helper; helper = null;               // ignore anything the old helper still sends
      if (!old) { startHelper(); return; }
      let done = false;
      const next = () => { if (done) return; done = true; startHelper(); };
      old.once('exit', next);                          // never start the new helper before the old one exits
      try { old.postMessage({ type: 'shutdown' }); } catch (e) {}
      setTimeout(() => { if (!done) { try { old.kill(); } catch (e) {} } }, 1500);
    });
    setInterval(() => {
      if (restarting && Date.now() - restartStartedAt > 5000) { restarting = false; helperError = 'helper restart timed out'; }
      if (helperError) { sendStatus({ active: false, error: helperError, connected: false }); return; }
      if (restarting) { sendStatus({ active: true, connected: true, restarting: true, buttons: {}, axes: {}, lastRestartMs }); return; }
      const on = !!(last && last.connected);
      sendStatus({ active: true, connected: on, buttons: on ? last.buttons : {}, axes: on ? last.axes : {}, lastRestartMs });
    }, 16);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    });
  });
}

// FIX_2026-10-02_DIAG_FULLMODE: diagnostic only. Sends Nintendo subcommand 0x03
// ("Set Input Report Mode") with 0x30 (full mode) to any vendor-057e HID device, the same
// command Chromium, SDL and the Linux driver use at setup. Reports each step's outcome.
// Run manually from DevTools: window.easyarc.diagNintendoFullMode()
let _diagPacket = 0;
ipcMain.handle('diag:nintendoFullMode', () => {
  let HID;
  try { HID = require('node-hid'); } catch (e) { return { ok: false, step: 'require', error: String(e.message) }; }
  let all;
  try { all = HID.devices().filter(d => d.vendorId === 0x057e); } catch (e) { return { ok: false, step: 'list', error: String(e.message) }; }
  if (!all.length) return { ok: false, step: 'find', error: 'no Nintendo (057e) HID device found' };
  const results = [], seen = new Set();
  for (const d of all) {
    if (seen.has(d.path)) continue; seen.add(d.path);
    const r = { product: d.product, usagePage: d.usagePage, usage: d.usage, open: false, writes: [] };
    let dev;
    try { dev = new HID.HID(d.path); r.open = true; }
    catch (e) { r.openError = String(e.message); results.push(r); continue; }
    for (const len of [49, 64]) {
      const buf = new Array(len).fill(0);
      buf[0] = 0x01;                                   // output report: rumble + subcommand
      buf[1] = (_diagPacket++) & 0x0f;                 // packet counter
      [0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40].forEach((b, i) => { buf[2 + i] = b; }); // neutral rumble
      buf[10] = 0x03;                                  // subcommand: set input report mode
      buf[11] = 0x30;                                  // full mode
      try { const n = dev.write(buf); r.writes.push({ len, ok: true, wrote: n }); break; }
      catch (e) { r.writes.push({ len, ok: false, error: String(e.message) }); }
    }
    try { dev.close(); } catch (e) {}
    results.push(r);
  }
  return { ok: results.some(r => r.writes.some(w => w.ok)), results };
});
