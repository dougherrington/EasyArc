// DolphinBridge.js — Dolphin emulator integration for EasyArc
// FIX_2026-05-24_DOLPHIN_STEP1_2: Detection + auto-install only.
// No launch logic, no config writing, no UI triggers.
// Manually invoke ensureDolphinReady() from DevTools to test.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

// Pinned Dolphin stable release. Bump deliberately when updating.
const DOLPHIN_VERSION = '2603a';
const DOLPHIN_FILENAME = `dolphin-${DOLPHIN_VERSION}-x64.7z`;
// SourceForge mirror — stable URLs, official mirror of dolphin-emu.org
const DOLPHIN_URL = `https://dl.dolphin-emu.org/releases/${DOLPHIN_VERSION}/${DOLPHIN_FILENAME}`;

class DolphinBridge {
  // Returns the directory where EasyArc manages its Dolphin install.
  getEasyArcDolphinDir() {
    return process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'easyarc', 'dolphin')
      : path.join(process.env.APPDATA || os.homedir(), 'easyarc', 'dolphin');
  }

  // Returns the expected full path to Dolphin's executable inside our managed dir.
  // The archive extracts to a subfolder (e.g. "Dolphin-x64\"), so the .exe is one level deep.
  getEasyArcDolphinBinary() {
    const baseDir = this.getEasyArcDolphinDir();
    if (process.platform === 'darwin') {
      return path.join(baseDir, 'Dolphin.app', 'Contents', 'MacOS', 'Dolphin');
    } else if (process.platform === 'win32') {
      // The 2603a archive extracts to a "Dolphin-x64" folder containing Dolphin.exe
      return path.join(baseDir, 'Dolphin-x64', 'Dolphin.exe');
    } else {
      return path.join(baseDir, 'dolphin-emu');
    }
  }

  // Returns the path to the bundled 7za.exe inside the EasyArc install.
  // At production runtime: process.resourcesPath/win/7za.exe
  // In dev: PROJECT_ROOT/resources/win/7za.exe
  get7zaPath() {
    const prodPath = process.resourcesPath
      ? path.join(process.resourcesPath, 'win', '7za.exe')
      : null;
    if (prodPath && fs.existsSync(prodPath)) return prodPath;
    // Dev fallback — relative to this file
    const devPath = path.join(__dirname, '..', '..', 'resources', 'win', '7za.exe');
    return devPath;
  }

  // Main entry point. Linear flow with logging at each gate.
  async ensureDolphinReady() {
    console.log('[DOLPHIN] Checking for existing Dolphin install...');
    const binaryPath = this.getEasyArcDolphinBinary();
    console.log('[DOLPHIN] Expected binary path:', binaryPath);

    if (fs.existsSync(binaryPath)) {
      console.log('[DOLPHIN] Already installed at:', binaryPath);
      this._ensurePortableMode();
      return { success: true, path: binaryPath, alreadyInstalled: true };
    }

    console.log('[DOLPHIN] Dolphin not found — downloading...');
    const installDir = this.getEasyArcDolphinDir();
    try {
      fs.mkdirSync(installDir, { recursive: true });
    } catch (err) {
      console.log('[DOLPHIN] Failed to create install dir:', err.message);
      return { success: false, error: 'mkdir failed: ' + err.message };
    }

    const archivePath = path.join(installDir, DOLPHIN_FILENAME);
    try {
      await this._downloadFile(DOLPHIN_URL, archivePath);
    } catch (err) {
      console.log('[DOLPHIN] Download failed:', err.message);
      return { success: false, error: 'download failed: ' + err.message };
    }

    const stats = fs.statSync(archivePath);
    console.log('[DOLPHIN] Download complete. Size:', stats.size, 'bytes');

    // Extract. On Windows we use bundled 7za.exe; on Mac/Linux we use system tools.
    console.log('[DOLPHIN] Extracting Dolphin...');
    try {
      if (process.platform === 'win32') {
        await this._extractWith7za(archivePath, installDir);
      } else if (process.platform === 'darwin') {
        // macOS has /usr/bin/7zz built-in via macOS 14+, but to be safe use a known tool.
        // For Step 1+2 testing on Mac we can use the system `tar` which handles 7z on recent macOS,
        // OR rely on the user having 7zz/p7zip installed. For now, log clearly if it's missing.
        await this._extractWithMacTools(archivePath, installDir);
      } else {
        // Linux — assume p7zip-full is available
        await this._spawnAndWait('7z', ['x', archivePath, '-o' + installDir, '-y']);
      }
    } catch (err) {
      console.log('[DOLPHIN] Extraction failed:', err.message);
      return { success: false, error: 'extraction failed: ' + err.message };
    }

    // Verify the binary now exists
    if (!fs.existsSync(binaryPath)) {
      console.log('[DOLPHIN] Extraction completed but binary not found at expected path:', binaryPath);
      // List what IS in the install dir to help debugging
      try {
        const contents = fs.readdirSync(installDir);
        console.log('[DOLPHIN] Contents of install dir:', contents);
      } catch {}
      return { success: false, error: 'binary not found after extraction at ' + binaryPath };
    }

    // Clean up the archive — we no longer need it
    try { fs.unlinkSync(archivePath); } catch {}

    console.log('[DOLPHIN] Dolphin installed at:', binaryPath);
    this._ensurePortableMode();
    return { success: true, path: binaryPath, alreadyInstalled: false };
  }

  // --- helpers ---

  _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const fetchUrl = (urlToFetch, redirectCount) => {
        if (redirectCount > 10) {
          reject(new Error('Too many redirects'));
          return;
        }
        https.get(urlToFetch, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            console.log('[DOLPHIN] Following redirect to:', response.headers.location);
            fetchUrl(response.headers.location, redirectCount + 1);
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }
          const file = fs.createWriteStream(destPath);
          let downloadedBytes = 0;
          const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
          response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
          });
          response.pipe(file);
          file.on('finish', () => {
            file.close(() => resolve());
          });
          file.on('error', (err) => {
            try { fs.unlinkSync(destPath); } catch {}
            reject(err);
          });
        }).on('error', (err) => reject(err));
      };
      console.log('[DOLPHIN] Downloading from:', url);
      fetchUrl(url, 0);
    });
  }

  async _extractWith7za(archivePath, outputDir) {
    const sevenZa = this.get7zaPath();
    console.log('[DOLPHIN] Using 7za.exe at:', sevenZa);
    if (!fs.existsSync(sevenZa)) {
      throw new Error('7za.exe not found at ' + sevenZa);
    }
    await this._spawnAndWait(sevenZa, ['x', archivePath, '-o' + outputDir, '-y']);
  }

  async _extractWithMacTools(archivePath, outputDir) {
    // Try common 7z extraction tools on macOS in order of preference.
    const candidates = ['7zz', '7z', 'unar'];
    for (const cmd of candidates) {
      try {
        const which = await this._spawnAndWaitCapture('which', [cmd]);
        if (which.code === 0 && which.stdout.trim()) {
          console.log('[DOLPHIN] Using extractor:', cmd);
          if (cmd === 'unar') {
            await this._spawnAndWait(cmd, ['-o', outputDir, '-f', archivePath]);
          } else {
            await this._spawnAndWait(cmd, ['x', archivePath, '-o' + outputDir, '-y']);
          }
          return;
        }
      } catch {}
    }
    throw new Error('No 7z extractor found on macOS (looked for: 7zz, 7z, unar). Install p7zip or 7-Zip for macOS.');
  }

  _spawnAndWait(cmd, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: 'ignore' });
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${cmd} exited with code ${code}`));
      });
      proc.on('error', (err) => reject(err));
    });
  }

  _spawnAndWaitCapture(cmd, args) {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('exit', (code) => resolve({ code, stdout, stderr }));
      proc.on('error', () => resolve({ code: -1, stdout, stderr }));
    });
  }

  // STAGE_6: Write Dolphin.ini before launch. Section-aware: merges with any
  // existing config rather than clobbering it. Three settings:
  //   [Interface] ConfirmStop = False     (no quit-confirm prompt)
  //   [Graphics]  StartFullscreen = True  (open in fullscreen)
  //   [Core]      SIDevice0-3 = 6         (four standard controllers)
  writeDolphinConfig() {
    const cfgDir = this._getDolphinConfigDir();
    const cfgPath = path.join(cfgDir, 'Dolphin.ini');
    try {
      fs.mkdirSync(cfgDir, { recursive: true });

      // FIX_2026-06-07_DOLPHIN_CONFIG_ENFORCE: enforce performance and platform
      // settings that previously relied on Dolphin defaults. CPUThread enables Dual
      // Core (significant perf boost). Backend = D3D11 on Windows locks to known-good
      // backend (avoids Microsoft Basic Render Driver fallback issues). Analytics
      // suppresses the first-launch telemetry prompt for beta testers.
      const sectionSettings = {
        'Interface': { 'ConfirmStop': 'False' },
        'Graphics': { 'StartFullscreen': 'True' },
        'Core': { 'SIDevice0': '6', 'SIDevice1': '6', 'SIDevice2': '6', 'SIDevice3': '6', 'CPUThread': 'True' },
        'Analytics': { 'PermissionAsked': 'True', 'Enabled': 'False' }
      };
      if (process.platform === 'win32') {
        sectionSettings['Graphics']['Backend'] = 'D3D11';
      }

      let cfg = '';
      if (fs.existsSync(cfgPath)) cfg = fs.readFileSync(cfgPath, 'utf8');

      for (const [section, settings] of Object.entries(sectionSettings)) {
        const sectionHeader = '[' + section + ']';
        if (!cfg.includes(sectionHeader)) cfg += '\n' + sectionHeader + '\n';
        for (const [key, val] of Object.entries(settings)) {
          const line = key + ' = ' + val;
          const regex = new RegExp('^' + key + '\\s*=.*$', 'm');
          const sectionIdx = cfg.indexOf(sectionHeader);
          const nextSectionIdx = cfg.indexOf('\n[', sectionIdx + 1);
          const sectionBlock = nextSectionIdx === -1 ? cfg.slice(sectionIdx) : cfg.slice(sectionIdx, nextSectionIdx);
          if (regex.test(sectionBlock)) {
            const updatedBlock = sectionBlock.replace(regex, line);
            cfg = nextSectionIdx === -1 ? cfg.slice(0, sectionIdx) + updatedBlock : cfg.slice(0, sectionIdx) + updatedBlock + cfg.slice(nextSectionIdx);
          } else {
            const insertAt = nextSectionIdx === -1 ? cfg.length : nextSectionIdx;
            cfg = cfg.slice(0, insertAt) + '\n' + line + cfg.slice(insertAt);
          }
        }
      }

      fs.writeFileSync(cfgPath, cfg);
      console.log('[DOLPHIN] Wrote Dolphin.ini at:', cfgPath);
    } catch (err) {
      console.log('[DOLPHIN] Failed to write Dolphin.ini:', err.message);
    }
  }

  // STAGE_6: Write GCPadNew.ini before launch. The exact XInput-based config
  // that worked when manually configured through Dolphin's UI on Parallels.
  // controllerName and controllerType are accepted but unused for now.
  // FIX_2026-06-07_DOLPHIN_CONTROLLER_FAMILIES: branch on controllerType to write
  // the correct binding template. DualShock 3/4 and DualSense get WGInput-based
  // bindings; everything else (xbox, xinput, generic, switch) gets XInput bindings.
  // Switch Pro support deferred to v1.0.
  writeGCPadConfig(controllerName, controllerType) {
    const cfgDir = this._getDolphinConfigDir();
    const cfgPath = path.join(cfgDir, 'GCPadNew.ini');
    try {
      fs.mkdirSync(cfgDir, { recursive: true });

      const isDualShock = (controllerType === 'ds4' || controllerType === 'dualsense' || controllerType === 'ds3');
      const gcpadConfig = isDualShock
        ? this._getGCPadConfigDualShock()
        : this._getGCPadConfigXInput();

      fs.writeFileSync(cfgPath, gcpadConfig);
      console.log('[DOLPHIN] Wrote GCPadNew.ini at:', cfgPath, '(family:', isDualShock ? 'DualShock' : 'XInput', ')');
    } catch (err) {
      console.log('[DOLPHIN] Failed to write GCPadNew.ini:', err.message);
    }
  }

  // FIX_2026-06-13_DOLPHIN_EXIT_HOTKEY: write Hotkeys.ini with a player-1 controller
  // exit binding so couch/TV users can quit cleanly back to EasyArc without a keyboard.
  // Device string AND exit combo differ per controller family, captured verbatim from
  // working Dolphin UI configs:
  //   XInput (Xbox/8BitDo): Device = SDL/0/XInput Controller #1, Exit = Back&Guide&Start
  //   DualShock (PS4/PS5):  Device = SDL/0/PS4 Controller,        Exit = @(Start+Back)
  // Exit-combo SYNTAX also differs (& vs @()+) — reproduced exactly, not normalized.
  // Keyboard 'General/Stop = ESCAPE' kept as fallback. P1 only. Switch Pro deferred.
  writeHotkeyConfig(controllerType) {
    const cfgDir = this._getDolphinConfigDir();
    const cfgPath = path.join(cfgDir, 'Hotkeys.ini');
    try {
      fs.mkdirSync(cfgDir, { recursive: true });

      const isDualShock = (controllerType === 'ds4' || controllerType === 'dualsense' || controllerType === 'ds3');
      const device = isDualShock ? 'SDL/0/PS4 Controller' : 'SDL/0/XInput Controller #1';
      const exitBinding = isDualShock ? '@(Start+Back)' : 'Back&Guide&Start';

      const hotkeyConfig = [
        '[Hotkeys]',
        'Device = ' + device,
        'General/Stop = ESCAPE',
        'General/Exit = ' + exitBinding
      ].join('\n');

      fs.writeFileSync(cfgPath, hotkeyConfig);
      console.log('[DOLPHIN] Wrote Hotkeys.ini at:', cfgPath, '(family:', isDualShock ? 'DualShock' : 'XInput', ', exit:', exitBinding, ')');
    } catch (err) {
      console.log('[DOLPHIN] Failed to write Hotkeys.ini:', err.message);
    }
  }

  _getGCPadConfigXInput() {
    return [
        '[GCPad1]',
        'Device = XInput/0/Gamepad',
        'Buttons/A = `Button A`',
        'Buttons/B = `Button B`',
        'Buttons/X = `Button X`',
        'Buttons/Y = `Button Y`',
        'Buttons/Z = `Shoulder R`',
        'Buttons/Start = Start',
        'Main Stick/Up = `Left Y+`',
        'Main Stick/Down = `Left Y-`',
        'Main Stick/Left = `Left X-`',
        'Main Stick/Right = `Left X+`',
        'Main Stick/Modifier = `Shift`',
        'Main Stick/Calibration = 100.00 141.42 100.00 141.42 100.00 141.42 100.00 141.42',
        'C-Stick/Up = `Right Y+`',
        'C-Stick/Down = `Right Y-`',
        'C-Stick/Left = `Right X-`',
        'C-Stick/Right = `Right X+`',
        'C-Stick/Modifier = `Ctrl`',
        'C-Stick/Calibration = 100.00 141.42 100.00 141.42 100.00 141.42 100.00 141.42',
        'Triggers/L = `Trigger L`',
        'Triggers/R = `Trigger R`',
        'D-Pad/Up = `Pad N`',
        'D-Pad/Down = `Pad S`',
        'D-Pad/Left = `Pad W`',
        'D-Pad/Right = `Pad E`',
        '[GCPad2]',
        'Device =',
        '[GCPad3]',
        'Device =',
        '[GCPad4]',
        'Device ='
    ].join('\n');
  }

  // DualShock 4 / DualSense / DualShock 3 binding template. Empirically captured
  // from Dolphin UI configuration with a DualShock-mode controller on Windows.
  // Uses WGInput (Windows.Gaming.Input) device naming. PS5 DualSense may need a
  // variant in v1.0 if WGInput device name differs.
  _getGCPadConfigDualShock() {
    return [
      // FIX_2026-06-07_DOLPHIN_DS_SDL_TEMPLATE: SDL device naming (not WGInput).
      // Empirically validated June 7 2026 by manual Dolphin configuration test.
      // SDL is the same backend Mac uses successfully — unified across platforms.
      '[GCPad1]',
      'Device = SDL/0/PS4 Controller',
      'Buttons/A = `Button S`',
      'Buttons/B = `Button E`',
      'Buttons/X = `Button W`',
      'Buttons/Y = `Button N`',
      'Buttons/Z = `Shoulder L`',
      'Buttons/Start = Start',
      'Main Stick/Up = `Left Y+`',
      'Main Stick/Down = `Left Y-`',
      'Main Stick/Left = `Left X-`',
      'Main Stick/Right = `Left X+`',
      'Main Stick/Modifier = `Shift`',
      'Main Stick/Calibration = 100.00 141.42 100.00 141.42 100.00 141.42 100.00 141.42',
      'C-Stick/Up = `Right Y+`',
      'C-Stick/Down = `Right Y-`',
      'C-Stick/Left = `Right X-`',
      'C-Stick/Right = `Right X+`',
      'C-Stick/Modifier = `Ctrl`',
      'C-Stick/Calibration = 100.00 141.42 100.00 141.42 100.00 141.42 100.00 141.42',
      'Triggers/L = `Trigger L`',
      'Triggers/R = `Trigger R`',
      'D-Pad/Up = `Pad N`',
      'D-Pad/Down = `Pad S`',
      'D-Pad/Left = `Pad W`',
      'D-Pad/Right = `Pad E`',
      '[GCPad2]',
      'Device =',
      '[GCPad3]',
      'Device =',
      '[GCPad4]',
      'Device ='
    ].join('\n');
  }

  // STAGE_5: Launch Dolphin with a ROM. Same spawn pattern as launchDolphinBare,
  // but passes --batch (suppresses some interactive UI) and --exec=ROMPATH (loads
  // and starts the game). Matches the Mac launch pattern in RetroArchBridge.launchGame.
  // FIX_2026-06-07_DOLPHIN_CONTROLLER_FAMILIES: accept controllerType from renderer
  // so we can write the correct GCPadNew.ini based on connected controller family.
  async launchDolphin(romPath, controllerType) {
    console.log('[DOLPHIN] launchDolphin called with romPath:', romPath);

    // STAGE_6: Write config files before launching so Dolphin starts in fullscreen
    // and the controller mapping matches what we know works on Windows + XInput.
    this.writeDolphinConfig();
    this.writeGCPadConfig(null, controllerType);
    // FIX_2026-06-13_DOLPHIN_EXIT_HOTKEY: write Hotkeys.ini so player 1 can cleanly
    // exit back to EasyArc via a controller combo. Device string and exit binding are
    // per controller family (verbatim from working Dolphin UI configs). P1 only.
    this.writeHotkeyConfig(controllerType);

    const binaryPath = this.getEasyArcDolphinBinary();
    console.log('[DOLPHIN] Binary path:', binaryPath);

    if (!fs.existsSync(binaryPath)) {
      console.log('[DOLPHIN] Binary not found — call ensureDolphinReady() first');
      return { success: false, error: 'Dolphin not installed. Call ensureDolphinReady() first.' };
    }

    if (!romPath || !fs.existsSync(romPath)) {
      console.log('[DOLPHIN] ROM path missing or invalid:', romPath);
      return { success: false, error: 'ROM not found at: ' + romPath };
    }

    const cwd = path.dirname(binaryPath);
    // FIX_2026-06-07_DOLPHIN_LAUNCH_NO_BATCH: empirical command-line testing showed
    // that --batch suppresses settings even when --config flags are passed. Dropping
    // --batch and keeping --config flags makes StartFullscreen, CPUThread, and Backend
    // take effect correctly. Tradeoff: Dolphin briefly shows UI before game loads.
    // Acceptable for beta. Supersedes FIX_2026-06-07_DOLPHIN_LAUNCH_CONFIG_FLAGS.
    const args = [
      '--exec=' + romPath,
      '--config=Dolphin.Graphics.StartFullscreen=True',
      '--config=Dolphin.Core.CPUThread=True'
    ];
    if (process.platform === 'win32') {
      args.push('--config=Dolphin.Graphics.Backend=D3D11');
    }
    console.log('[DOLPHIN] Spawning with cwd:', cwd, 'args:', args);

    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(binaryPath, args, { cwd, detached: false, stdio: 'ignore' });
      } catch (err) {
        console.log('[DOLPHIN] spawn() threw synchronously:', err.message);
        resolve({ success: false, error: 'spawn threw: ' + err.message });
        return;
      }

      let settled = false;
      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        console.log('[DOLPHIN] spawn error event:', err.message);
        resolve({ success: false, error: 'spawn error: ' + err.message });
      });

      proc.on('spawn', () => {
        if (settled) return;
        settled = true;
        console.log('[DOLPHIN] spawn event fired — PID:', proc.pid);
        resolve({ success: true, pid: proc.pid });
      });
    });
  }

  // STAGE_4: Bare Dolphin spawn — no ROM, no args, just launch the binary.
  // Used to prove the spawn chain works before any ROM-passing logic is added.
  // cwd is set to the binary's parent folder so Dolphin can find its DLLs, Qt plugins,
  // Languages folder, etc. — matching what double-click behavior produces.
  async launchDolphinBare() {
    console.log('[DOLPHIN] launchDolphinBare called');
    const binaryPath = this.getEasyArcDolphinBinary();
    console.log('[DOLPHIN] Binary path:', binaryPath);

    if (!fs.existsSync(binaryPath)) {
      console.log('[DOLPHIN] Binary not found — call ensureDolphinReady() first');
      return { success: false, error: 'Dolphin not installed. Call ensureDolphinReady() first.' };
    }

    const cwd = path.dirname(binaryPath);
    console.log('[DOLPHIN] Spawning with cwd:', cwd);

    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(binaryPath, [], { cwd, detached: false, stdio: 'ignore' });
      } catch (err) {
        console.log('[DOLPHIN] spawn() threw synchronously:', err.message);
        resolve({ success: false, error: 'spawn threw: ' + err.message });
        return;
      }

      let settled = false;
      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        console.log('[DOLPHIN] spawn error event:', err.message);
        resolve({ success: false, error: 'spawn error: ' + err.message });
      });

      proc.on('spawn', () => {
        if (settled) return;
        settled = true;
        console.log('[DOLPHIN] spawn event fired — PID:', proc.pid);
        resolve({ success: true, pid: proc.pid });
      });
    });
  }

  // PORTABLE_MODE: Returns the directory where Dolphin reads/writes its config
  // files. On Windows, Dolphin is run in portable mode (portable.txt next to
  // the binary), so configs live inside the EasyArc-managed Dolphin folder.
  // On Mac, returns the legacy Documents path (current behavior unchanged).
  _getDolphinConfigDir() {
    if (process.platform === 'win32') {
      const binaryPath = this.getEasyArcDolphinBinary();
      return path.join(path.dirname(binaryPath), 'User', 'Config');
    }
    return path.join(os.homedir(), 'Documents', 'Dolphin Emulator', 'Config');
  }

  // PORTABLE_MODE: On Windows, writes an empty portable.txt next to Dolphin.exe
  // so Dolphin keeps all user data inside the EasyArc-managed folder rather than
  // touching %USERPROFILE%\Documents (which OneDrive may redirect). No-op on Mac.
  _ensurePortableMode() {
    if (process.platform !== 'win32') return;
    try {
      const binaryPath = this.getEasyArcDolphinBinary();
      const portableMarker = path.join(path.dirname(binaryPath), 'portable.txt');
      if (!fs.existsSync(portableMarker)) {
        fs.writeFileSync(portableMarker, '');
        console.log('[DOLPHIN] Created portable.txt at:', portableMarker);
      }
    } catch (err) {
      console.log('[DOLPHIN] Failed to create portable.txt:', err.message);
    }
  }
}

module.exports = DolphinBridge;
