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
