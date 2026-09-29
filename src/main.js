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
ipcMain.handle('app:relaunchForController', () => {
  console.log('[MAIN] Relaunching to re-initialize Nintendo controller');
  if (mainWindow) mainWindow.setOpacity(0);
  app.relaunch();
  app.exit(0);
});
