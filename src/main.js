const { app, BrowserWindow, ipcMain, dialog } = require('electron');

// Enable Gamepad API in Electron
app.commandLine.appendSwitch('enable-gamepad');
const path = require('path');
const RetroArchBridge = require('./bridge/RetroArchBridge');
const registerIpcHandlers = require('./ipc/handlers');

let mainWindow;
let bridge; // declared here, instantiated before app.whenReady

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      gamepad: true,
    },
  });
  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  bridge = new RetroArchBridge();
  registerIpcHandlers(ipcMain, bridge, dialog);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
