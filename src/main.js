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
    let sdl;
    try { sdl = require('@kmamal/sdl'); console.log('[SDL] loaded'); }
    catch (e) {
      console.log('[SDL] failed to load; relaunch fallback stays active:', e.message);
      setInterval(() => sendStatus({ active: false, error: String(e.message), connected: false }), 500);
      return;
    }
    let inst = null;
    const openNintendo = () => {
      if (inst && !inst.closed) return;
      const dev = sdl.controller.devices.find(d => d.vendor === 0x057e);
      if (!dev) return;
      try {
        inst = sdl.controller.openDevice(dev);
        // These listeners look empty but are required: the SDL package only polls the
        // controller quickly while something is listening. Without them, input lags ~1 second.
        inst.on('axisMotion', () => {});
        inst.on('buttonDown', () => {});
        inst.on('close', () => { inst = null; console.log('[SDL] Nintendo controller closed'); });
        console.log('[SDL] opened Nintendo controller:', dev.name);
      } catch (e) { inst = null; console.log('[SDL] open failed:', e.message); }
    };
    openNintendo();
    sdl.controller.on('deviceAdd', () => openNintendo());
    sdl.controller.on('deviceRemove', () => { if (inst && inst.closed) inst = null; });
    setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const on = !!(inst && !inst.closed);
      mainWindow.webContents.send('sdl-nintendo', { active: true, connected: on,
        buttons: on ? inst.buttons : {}, axes: on ? inst.axes : {} });
    }, 16);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    });
  });
}
