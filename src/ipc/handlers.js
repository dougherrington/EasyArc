function registerIpcHandlers(ipcMain, bridge, dialog) {
  function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        console.error(`[IPC] ${channel} error:`, err);
        return { success: false, error: err.message };
      }
    });
  }

  handle('bridge:findRetroArch', () => bridge.findRetroArch());
  // FIX_2026-05-24_DOLPHIN_STEP1_2: ensureDolphinReady — Step 1+2 only.
  // Detects existing Dolphin install or downloads+extracts to %APPDATA%\\easyarc\\dolphin.
  // Does NOT launch Dolphin, does NOT write config. Manual DevTools invocation only.
  handle('bridge:ensureDolphinReady', () => {
    const DolphinBridge = require('../bridge/DolphinBridge');
    const dolphinBridge = new DolphinBridge();
    return dolphinBridge.ensureDolphinReady();
  });

  // STAGE_4: Bare Dolphin spawn handler. DevTools-invokable only.
  // No UI wiring, no ROM, no args. Just spawns Dolphin.exe with correct cwd.
  handle('bridge:launchDolphinBare', () => {
    const DolphinBridge = require('../bridge/DolphinBridge');
    const dolphinBridge = new DolphinBridge();
    return dolphinBridge.launchDolphinBare();
  });

  // STAGE_5: Launch Dolphin with a ROM. Used by gamecubeEnsureReadyAndLaunch.
  handle('bridge:launchDolphin', (romPath, controllerType) => {  // FIX_2026-06-08_DOLPHIN_HANDLER_FORWARD
    const DolphinBridge = require('../bridge/DolphinBridge');
    const dolphinBridge = new DolphinBridge();
    return dolphinBridge.launchDolphin(romPath, controllerType);
  });
  handle('bridge:findDolphin',   () => bridge.findDolphin());
  // FIX_2026-06-18_PPSSPP_STAGEA: launch a PSP ROM via standalone PPSSPP.
  handle('bridge:launchPPSSPP', (romPath) => {
    const PPSSPPBridge = require('../bridge/PPSSPPBridge');
    const ppssppBridge = new PPSSPPBridge();
    return ppssppBridge.launchPPSSPP(romPath);
  });
  // RMG_SLICE1_2026-06-20: N64 via RMG. Download/extract + launch only (no controllers yet).
  handle('bridge:ensureRMGReady', () => {
    const RMGBridge = require('../bridge/RMGBridge');
    const rmgBridge = new RMGBridge();
    return rmgBridge.ensureRMGReady();
  });
  handle('bridge:launchRMG', (romPath) => {
    const RMGBridge = require('../bridge/RMGBridge');
    const rmgBridge = new RMGBridge();
    const result = rmgBridge.launchRMG(romPath);
    // Return a serializable result (drop the non-cloneable proc handle).
    return { success: result.success, pid: result.pid, error: result.error };
  });
  handle('bridge:findDuckStation', () => bridge.findDuckStation());
  handle('bridge:installDuckStation', async (event) => {
    // Download + extract DuckStation. Progress sent back via events.
    const progressCallback = (received, total) => {
      // Broadcast progress to all renderer windows
      const { BrowserWindow } = require('electron');
      const wins = BrowserWindow.getAllWindows();
      for (const win of wins) {
        if (!win.isDestroyed()) win.webContents.send('duckstation:downloadProgress', { received, total });
      }
    };
    const archivePath = await bridge.downloadDuckStation(progressCallback);
    const result = await bridge.installDuckStation(archivePath);
    return result;
  });
  handle('bridge:scanForPSXBios', () => bridge.scanForPSXBios());
  handle('bridge:configureDuckStationBios', (biosDir) => {
    // Update DuckStation's settings.ini with EasyArc-required settings (Main + Pad sections)
    bridge.writeDuckStationConfig();
    // FIX_2026-06-06_DUCKSTATION_BIOS_COPY: on Windows, copy BIOS files into DuckStation's
    // portable bios/ subfolder so DuckStation finds them at its default location. The
    // previous code writes [BIOS] SearchDirectory to a non-portable settings.ini path,
    // which DuckStation portable never reads — silent config failure. Mac path unchanged.
    if (process.platform === 'win32') {
      const copyResult = bridge.copyPSXBiosToPortable(biosDir);
      console.log('[BRIDGE] copyPSXBiosToPortable result:', JSON.stringify(copyResult));
      return copyResult;
    }
    // Now update just the BIOS search directory
    const cfgPath = process.platform === 'darwin'
      ? require('path').join(require('os').homedir(), 'Library/Application Support/DuckStation/settings.ini')
      : require('path').join(process.env.APPDATA || require('os').homedir(), 'DuckStation/settings.ini');
    try {
      const fs = require('fs');
      const path = require('path');
      // FIX_2026-05-23_MKDIR_HANDLER: defensive mkdir before BIOS-directory write.
      // Mirrors the same fix in RetroArchBridge.writeDuckStationConfig() — protects
      // against ENOENT if parent directory doesn't exist.
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      // FIX_2026-05-23_WIN_BIOS: ensure DuckStation config dir exists (fresh install has none)
      try { fs.mkdirSync(path.dirname(cfgPath), { recursive: true }); } catch(e) {}
      let cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
      // Update or add SearchDirectory in [BIOS] section
      const biosSection = cfg.indexOf('[BIOS]');
      if (biosSection === -1) {
        cfg += `\n[BIOS]\nSearchDirectory = ${biosDir}\n`;
      } else {
        const nextSection = cfg.indexOf('\n[', biosSection + 1);
        const sectionBlock = nextSection === -1 ? cfg.slice(biosSection) : cfg.slice(biosSection, nextSection);
        const dirRegex = /^SearchDirectory\s*=.*$/m;
        if (dirRegex.test(sectionBlock)) {
          const updated = sectionBlock.replace(dirRegex, `SearchDirectory = ${biosDir}`);
          cfg = nextSection === -1 ? cfg.slice(0, biosSection) + updated : cfg.slice(0, biosSection) + updated + cfg.slice(nextSection);
        } else {
          const insertAt = nextSection === -1 ? cfg.length : nextSection;
          cfg = cfg.slice(0, insertAt) + `\nSearchDirectory = ${biosDir}` + cfg.slice(insertAt);
        }
      }
      fs.writeFileSync(cfgPath, cfg);
      return { success: true };
    } catch(err) {
      return { success: false, error: err.message };
    }
  });
  handle('bridge:browseForBiosFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select your PlayStation System Files folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, directory: result.filePaths[0] };
  });
  handle('bridge:getConfig',     () => bridge.getConfig());
  handle('bridge:setConfig',     (values) => bridge.setConfig(values));
  handle('bridge:listCores',     () => bridge.listCores());
  handle('bridge:coreExists',    (system) => bridge.coreExists(system));
  handle('bridge:installCore',   (system) => bridge.installCore(system));
  handle('bridge:scanRoms',      (folderPath) => bridge.scanRoms(folderPath));
  handle('bridge:launchGame',    (options) => bridge.launchGame(options));
  handle('bridge:killGame',        () => bridge.killGame());
  handle('bridge:listControllers', () => bridge.listControllers());
  handle('bridge:saveMapping',   (mapping) => bridge.saveMapping(mapping));
  handle('bridge:scrapeGame',    (game, ssUser, ssPassword) => bridge.scrapeGame(game, ssUser, ssPassword));
  handle('bridge:createFolder',  (folderPath) => bridge.createFolder(folderPath));
  handle('bridge:scanCollection', (parentFolder) => bridge.scanCollection(parentFolder));
  handle('bridge:moveFiles',     (filePaths, destFolder) => bridge.moveFiles(filePaths, destFolder));
  handle('bridge:artworkExists', (game) => bridge.artworkExists(game));
  handle('bridge:writeScrapeLog', (logText) => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const file = path.join(os.homedir(), 'Desktop', 'easyarc_scrape_log.txt');
    fs.writeFileSync(file, logText, 'utf8');
    return { success: true, path: file };
  });
  handle('bridge:saveArtwork',   (game, data) => bridge.saveArtwork(game, data));
  handle('bridge:getArtworkPath',(game) => bridge.getArtworkPath(game));
  handle('bridge:getMetadata',    (game) => bridge.getMetadata(game));

  handle('bridge:pickFiles', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select ROM files to add',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'ROM Files', extensions: ['zip','iso','rvz','bin','cue','img','pbp','chd','gba','gbc','nes','sfc','smc','n64','z64','v64','gcm','gcz','wbfs','nsp','xci','rom','j64','jag','md','gen','smd','gg','sms','a26'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    return result.canceled ? null : result.filePaths;
  });

  handle('bridge:pickRomFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select your ROMs folder',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle('bridge:pickParentFolder', async (folderName) => {
    const result = await dialog.showOpenDialog({
      title: 'Choose where to create your "' + folderName + '" folder',
      message: 'Select a parent folder. EasyArc will create "' + folderName + '" inside it.',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

module.exports = registerIpcHandlers;
