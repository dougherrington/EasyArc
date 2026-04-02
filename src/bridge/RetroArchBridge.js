const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const https = require('https');

const PCSX2_LOCATIONS = {
  darwin: ['/Applications/PCSX2.app/Contents/MacOS/PCSX2'],
  win32:  ['C:\\Program Files\\PCSX2\\pcsx2-qt.exe'],
  linux:  ['/usr/bin/pcsx2'],
};

const DOLPHIN_LOCATIONS = {
  darwin: ['/Applications/Dolphin.app/Contents/MacOS/Dolphin'],
  win32:  ['C:\\Dolphin\\Dolphin.exe'],
  linux:  ['/usr/bin/dolphin-emu'],
};

const RYUJINX_LOCATIONS = {
  darwin: ['/Applications/Ryujinx.app/Contents/MacOS/Ryujinx'],
  win32:  ['C:\\Ryujinx\\Ryujinx.exe'],
  linux:  ['/usr/bin/ryujinx'],
};

const RETROARCH_LOCATIONS = {
  darwin: [
    '/Applications/RetroArch.app/Contents/MacOS/RetroArch',
    path.join(os.homedir(), 'Applications/RetroArch.app/Contents/MacOS/RetroArch'),
  ],
  win32:  ['C:\\RetroArch-Win64\\retroarch.exe'],
  linux:  ['/usr/bin/retroarch'],
};

// Extensions that uniquely identify a system — no ambiguity
const UNIQUE_EXTENSIONS = {
  gbc:          ['.gbc', '.gb', '.gbs'],
  gba:          ['.gba', '.agb'],
  snes:         ['.sfc', '.smc', '.fig', '.bs'],
  nes:          ['.nes', '.fds', '.unf', '.unif'],
  n64:          ['.z64', '.n64', '.v64', '.ndd'],
  jaguar:       ['.j64', '.jag', '.rom'],
  genesis:      ['.md', '.gen', '.smd', '.68k'],
  gamegear:     ['.gg'],
  mastersystem: ['.sms'],
  atari2600:    ['.a26'],
  switch:       ['.nsp', '.xci', '.nca'],
  gamecube:     ['.gcm', '.gcz', '.nkit'],
  wii:          ['.wbfs', '.wad'],
  wiiu:         ['.wud', '.wux', '.rpx', '.wua'],
  gba:          ['.gba', '.agb'],
};

// Extensions shared by multiple systems — need folder hint to resolve
const SHARED_EXTENSIONS = {
  '.zip':  ['gbc','gba','snes','nes','n64','genesis','gamegear','mastersystem','atari2600','jaguar','psp'],
  '.iso':  ['ps2','psp','gamecube','wii','saturn','dreamcast'],
  '.rvz':  ['gamecube','wii'],
  '.ciso': ['gamecube','wii'],
  '.cso':  ['ps2','psp'],
  '.chd':  ['psx','ps2','saturn','dreamcast'],
  '.cdi':  ['dreamcast'],
  '.cue':  ['psx','ps2','saturn','dreamcast'],
  '.pbp':  ['psx','psp'],
  '.pkg':  ['ps3'],
};

// Folder hints in priority order — most specific first
const FOLDER_HINTS = [
  { hints: ['playstation 3','playstation3','ps3'],                          system: 'ps3' },
  { hints: ['playstation 2','playstation2','ps2'],                          system: 'ps2' },
  { hints: ['playstation portable','psp'],                                  system: 'psp' },
  { hints: ['sony playstation','playstation 1','playstation1','psx','ps1'], system: 'psx' },
  { hints: ['sega dreamcast','dreamcast','dream cast'],                     system: 'dreamcast' },
  { hints: ['sega saturn','saturn'],                                        system: 'saturn' },
  { hints: ['game boy color','gameboy color','gbc'],                        system: 'gbc' },
  { hints: ['game boy advance','gameboy advance','gba'],                    system: 'gba' },
  { hints: ['game boy','gameboy'],                                          system: 'gbc' },
  { hints: ['super nintendo','super nes','superfamicom','snes'],            system: 'snes' },
  { hints: ['nintendo 64','nintendo64','n64'],                              system: 'n64' },
  { hints: ['nintendo wii','wii nintendo','wii games','wii'],               system: 'wii' },
  { hints: ['gamecube','game cube','nintendo gamecube','ngc','gamecube games','cube','/gc/'], system: 'gamecube' },
  { hints: ['nintendo entertainment system','nintendo entertainment'],      system: 'nes' },
  { hints: ['mega drive','megadrive','sega genesis','genesis'],             system: 'genesis' },
  { hints: ['game gear','gamegear'],                                        system: 'gamegear' },
  { hints: ['master system','mastersystem'],                                system: 'mastersystem' },
  { hints: ['atari 2600','atari2600'],                                      system: 'atari2600' },
  { hints: ['atari jaguar','jaguar'],                                       system: 'jaguar' },
];

// Folders to skip during scanning
const SKIP_FOLDERS = new Set([
  'logs','logs_arrm','media','images','videos','manuals',
  'cheats','saves','states','backup','extras','artwork',
  'boxart','screenshots','thumbs','bios','themes','tools',
  'bgmusic','launchimages','pico-8','scummvm','easyrpg',
  '.fseventsd','.spotlight-v100','.trashes','.ds_store',
]);

const CORES_PATH = path.join(os.homedir(), 'Library/Application Support/RetroArch/cores');
const REMAPS_PATH = path.join(os.homedir(), 'Library/Application Support/RetroArch/config/remaps');

// Core folder names for remap files (must match RetroArch's core display name)
const CORE_REMAP_FOLDERS = {
  gbc:         'Gambatte',
  gba:         'mGBA',
  nes:         'Mesen',
  snes:        'Snes9x',
  n64:         'Mupen64Plus-Next',
  jaguar:      'Virtual Jaguar',
  genesis:     'Genesis Plus GX',
  gamegear:    'Genesis Plus GX',
  mastersystem:'Genesis Plus GX',
  psx:         'Beetle PSX',
  ps2:         'PCSX2',
  psp:         'PPSSPP',
  saturn:      'Beetle Saturn',
  dreamcast:   'Flycast',
  gamecube:    'Dolphin',
  atari2600:   'Stella',
};

// Device type values per system (RetroArch internal values)
// These match what RetroArch saves in remap files
const SYSTEM_DEVICE_TYPES = {
  psx:      { p1: '517', p2: '517' },  // 517 = DualShock
  ps2:      { p1: '517', p2: '517' },
  n64:      { p1: '5',   p2: '5'   },  // 5 = N64 controller
  jaguar:   { p1: '1',   p2: '1'   },  // 1 = RetroPad
  gbc:      { p1: '1',   p2: '1'   },
  gba:      { p1: '1',   p2: '1'   },
  snes:     { p1: '1',   p2: '1'   },
  nes:      { p1: '1',   p2: '1'   },
  genesis:  { p1: '1',   p2: '1'   },
  gamegear: { p1: '1',   p2: '1'   },
  saturn:   { p1: '1',   p2: '1'   },
  dreamcast:{ p1: '1',   p2: '1'   },
  gamecube: { p1: '1',   p2: '1'   },
};

// Analog dpad mode per system
// 0 = analog stick, 1 = left stick as dpad, 3 = right stick as dpad
const SYSTEM_ANALOG_MODES = {
  psx:      { p1: '3', p2: '3' },
  ps2:      { p1: '3', p2: '3' },
  n64:      { p1: '0', p2: '0' },
  jaguar:   { p1: '1', p2: '3' },
  gbc:      { p1: '1', p2: '1' },
  gba:      { p1: '1', p2: '1' },
  snes:     { p1: '0', p2: '0' },
  nes:      { p1: '1', p2: '1' },
  genesis:  { p1: '0', p2: '0' },
  saturn:   { p1: '0', p2: '0' },
  dreamcast:{ p1: '0', p2: '0' },
  gamecube: { p1: '0', p2: '0' },
};

const SYSTEM_CORES = {
  gbc:          'gambatte_libretro.dylib',
  gba:          'mgba_libretro.dylib',
  nes:          'mesen_libretro.dylib',
  snes:         'snes9x_libretro.dylib',
  n64:          'mupen64plus_next_libretro.dylib',
  jaguar:       'virtualjaguar_libretro.dylib',
  genesis:      'genesis_plus_gx_libretro.dylib',
  gamegear:     'genesis_plus_gx_libretro.dylib',
  mastersystem: 'genesis_plus_gx_libretro.dylib',
  psx:          'mednafen_psx_libretro.dylib',
  ps2:          'pcsx2_libretro.dylib',
  psp:          'ppsspp_libretro.dylib',
  saturn:       'mednafen_saturn_libretro.dylib',
  dreamcast:    'flycast_libretro.dylib',
  gamecube:     'dolphin_libretro.dylib',
  atari2600:    'stella_libretro.dylib',
};

class RetroArchBridge {
  constructor() { this.retroarchPath = null; this.retroarchProcess = null; }

  async findPCSX2() {
    const locations = PCSX2_LOCATIONS[process.platform] || [];
    for (const loc of locations) {
      if (fs.existsSync(loc)) return { found: true, path: loc };
    }
    return { found: false, path: null };
  }

  async findDolphin() {
    const locations = DOLPHIN_LOCATIONS[process.platform] || [];
    for (const loc of locations) {
      if (fs.existsSync(loc)) return { found: true, path: loc };
    }
    return { found: false, path: null };
  }

  async findRyujinx() {
    const locations = RYUJINX_LOCATIONS[process.platform] || [];
    for (const loc of locations) {
      if (fs.existsSync(loc)) return { found: true, path: loc };
    }
    return { found: false, path: null };
  }

  async findRetroArch() {
    const locations = RETROARCH_LOCATIONS[process.platform] || [];
    for (const loc of locations) {
      if (fs.existsSync(loc)) { this.retroarchPath = loc; return { found: true, path: loc }; }
    }
    return { found: false, path: null };
  }

  async getConfig() {
    return { video_driver:'metal', video_fullscreen:'true', video_windowed_fullscreen:'true', video_scale_integer:'true', audio_driver:'coreaudio', audio_sync:'true' };
  }

  async setConfig(values) { console.log('[Bridge] setConfig:', values); return { success: true }; }

  async listCores() { return []; }

  coreExists(system) {
    const coreFile = SYSTEM_CORES[system];
    if (!coreFile) return false;
    return fs.existsSync(path.join(CORES_PATH, coreFile));
  }

  async installCore(system) {
    const coreFile = SYSTEM_CORES[system];
    if (!coreFile) return { success: false, error: 'No core mapped for system: ' + system };

    const corePath = path.join(CORES_PATH, coreFile);
    if (fs.existsSync(corePath)) return { success: true, already: true };

    const url = 'https://buildbot.libretro.com/nightly/apple/osx/arm64/latest/' + coreFile + '.zip';
    const zipPath = corePath + '.zip';

    return new Promise((resolve) => {
      const file = fs.createWriteStream(zipPath);
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          resolve({ success: false, error: 'Download failed: HTTP ' + response.statusCode });
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          // Unzip the core
          const unzip = spawn('unzip', ['-o', zipPath, '-d', CORES_PATH]);
          unzip.on('exit', (code) => {
            fs.unlinkSync(zipPath);
            if (fs.existsSync(corePath)) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: 'Core file not found after extraction' });
            }
          });
        });
      }).on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  async scanRoms(folderPath) {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, error: 'Folder not found', roms: [] };
    }
    const roms = [];
    this._scanDir(folderPath, roms, 0);
    // Deduplicate by path
    const seen = new Set();
    const unique = roms.filter(r => { if (seen.has(r.path)) return false; seen.add(r.path); return true; });
    return { success: true, roms: unique };
  }

  _scanDir(dir, results, depth) {
    if (depth > 10) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { return; }

    for (const entry of entries) {
      // Skip hidden and metadata files/folders
      if (entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('_')) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip known non-game folders
        if (SKIP_FOLDERS.has(entry.name.toLowerCase())) continue;
        // Detect PS3 games by internal folder structure
        const ps3marker = path.join(fullPath, 'PS3_GAME', 'USRDIR');
        if (fs.existsSync(ps3marker)) {
          results.push({ title: entry.name, path: fullPath, system: 'ps3' });
          continue;
        }
        this._scanDir(fullPath, results, depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        // Skip non-game files
        if (!ext) continue;
        if (['.xml','.txt','.png','.jpg','.jpeg','.gif','.srm','.rtc','.cfg','.sav','.state','.bak','.old','.dll','.dat'].includes(ext)) continue;

        const system = this._detectSystem(fullPath, ext);
        if (!system) continue;

        const title = ext === '.cue' ? this._getCueName(fullPath) : path.basename(entry.name, ext);
        results.push({ title, path: fullPath, system });
      }
    }
  }

  _detectSystem(fullPath, ext) {
    // 1. Check unique extensions first — no ambiguity
    for (const [system, exts] of Object.entries(UNIQUE_EXTENSIONS)) {
      if (exts.includes(ext)) return system;
    }

    // 2. For shared extensions, use folder hints to resolve
    if (SHARED_EXTENSIONS[ext]) {
      const lower = fullPath.toLowerCase();
      for (const { hints, system } of FOLDER_HINTS) {
        for (const hint of hints) {
          if (lower.includes(hint)) {
            // Confirm this system supports this extension
            if (SHARED_EXTENSIONS[ext].includes(system)) return system;
          }
        }
      }
      // 3. If only one system uses this extension, use it directly
      if (SHARED_EXTENSIONS[ext].length === 1) return SHARED_EXTENSIONS[ext][0];
    }

    return null;
  }

  _getCueName(cuePath) {
    try {
      const content = fs.readFileSync(cuePath, 'utf8');
      const match = content.match(/FILE\s+"?([^"\n]+\.bin)"?/i);
      if (match) return path.basename(match[1], path.extname(match[1]));
    } catch(e) {}
    return path.basename(cuePath, '.cue');
  }

  writeRemapFile(system, gameName) {
    const coreFolder = CORE_REMAP_FOLDERS[system];
    if (!coreFolder) return;

    const deviceTypes = SYSTEM_DEVICE_TYPES[system] || { p1: '1', p2: '1' };
    const analogModes = SYSTEM_ANALOG_MODES[system] || { p1: '0', p2: '0' };

    const remapDir = path.join(REMAPS_PATH, coreFolder);
    try { fs.mkdirSync(remapDir, { recursive: true }); } catch(e) {}

    const remapFile = path.join(remapDir, gameName + '.rmp');

    const content = [
      'input_libretro_device_p1 = "' + deviceTypes.p1 + '"',
      'input_libretro_device_p2 = "' + deviceTypes.p2 + '"',
      'input_libretro_device_p3 = "1"',
      'input_libretro_device_p4 = "1"',
      'input_libretro_device_p5 = "1"',
      'input_libretro_device_p6 = "1"',
      'input_libretro_device_p7 = "1"',
      'input_libretro_device_p8 = "1"',
      'input_player1_analog_dpad_mode = "' + analogModes.p1 + '"',
      'input_player2_analog_dpad_mode = "' + analogModes.p2 + '"',
      'input_player3_analog_dpad_mode = "0"',
      'input_player4_analog_dpad_mode = "0"',
      'input_player5_analog_dpad_mode = "0"',
      'input_player6_analog_dpad_mode = "0"',
      'input_player7_analog_dpad_mode = "0"',
      'input_player8_analog_dpad_mode = "0"',
      'input_remap_port_p1 = "0"',
      'input_remap_port_p2 = "1"',
      'input_remap_port_p3 = "2"',
      'input_remap_port_p4 = "3"',
      'input_remap_port_p5 = "4"',
      'input_remap_port_p6 = "5"',
      'input_remap_port_p7 = "6"',
      'input_remap_port_p8 = "7"',
      'input_turbo_allow_dpad = "false"',
      'input_turbo_bind = "-1"',
      'input_turbo_button = "0"',
      'input_turbo_duty_cycle = "0"',
      'input_turbo_enable = "false"',
      'input_turbo_mode = "0"',
      'input_turbo_period = "6"',
    ].join('\n');

    try {
      fs.writeFileSync(remapFile, content);
      console.log('[Bridge] Wrote remap file:', remapFile);
    } catch(e) {
      console.error('[Bridge] Failed to write remap file:', e.message);
    }
  }

  writeRetroArchConfig() {
    const cfgPath = require('path').join(require('os').homedir(), 'Library/Application Support/RetroArch/retroarch.cfg');
    try {
      let cfg = '';
      const fs = require('fs');
      if (fs.existsSync(cfgPath)) cfg = fs.readFileSync(cfgPath, 'utf8');
      const settings = {
        'input_enable_hotkey': 'select',
        'input_exit_emulator': 'start',
        'auto_remaps_enable': 'true',
        'input_menu_toggle': 'nul',
        'input_menu_toggle_btn': 'nul',
        'input_menu_toggle_gamepad_combo': '0',
        'input_quit_gamepad_combo': '4',
        'input_pause_toggle': 'nul',
        'input_pause_toggle_btn': 'nul',
        'input_rewind': 'nul',
        'input_rewind_btn': 'nul',
        'ui_companion_start_on_boot': 'false',
        'video_fullscreen': 'true',
        'quit_on_close_content': '2'
      };
      for (const [key, val] of Object.entries(settings)) {
        const regex = new RegExp('^' + key + '\\s*=.*$', 'm');
        const line = key + ' = "' + val + '"';
        if (regex.test(cfg)) { cfg = cfg.replace(regex, line); }
        else { cfg += '\n' + line; }
      }
      fs.writeFileSync(cfgPath, cfg);
      console.log('[Bridge] Wrote retroarch.cfg hotkey settings');
    } catch(e) {
      console.error('[Bridge] Failed to write retroarch.cfg:', e.message);
    }
  }

  async launchGame(options) {
    // Prevent launching if RetroArch is already running
    if (this.retroarchProcess && !this.retroarchProcess.killed) {
      return { success: false, error: 'A game is already running. Close it first.' };
    }

    // Find RetroArch if we haven't yet
    if (!this.retroarchPath) {
      const found = await this.findRetroArch();
      if (!found.found) return { success: false, error: 'RetroArch not found. Please install RetroArch first.' };
    }

    // PS2 games launch via PCSX2
    if (options.system === 'ps2') {
      const pcsx2 = await this.findPCSX2();
      if (!pcsx2.found) return { success: false, error: 'PCSX2 not found. Please install PCSX2 first.' };
      // If .cue file, find and use the .bin file instead
      let romPath = options.romPath;
      if (path.extname(romPath).toLowerCase() === '.cue') {
        const binPath = romPath.replace(/\.cue$/i, '.bin');
        if (fs.existsSync(binPath)) {
          romPath = binPath;
          console.log('[Bridge] Using .bin instead of .cue:', romPath);
        }
      }
      this.writePCSX2Config();
      console.log('[Bridge] Launching PS2 game via PCSX2:', romPath);
      try {
        this.retroarchProcess = spawn(pcsx2.path, ['-batch', '-nogui', '-fullscreen', romPath], { detached: false, stdio: 'ignore' });
        this.retroarchProcess.on('exit', () => {
          console.log('[Bridge] PCSX2 exited');
          this.retroarchProcess = null;
          const { BrowserWindow } = require('electron');
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) { wins[0].show(); wins[0].focus(); }
        });
        return { success: true };
      } catch(err) {
        return { success: false, error: err.message };
      }
    }

    // GameCube and Wii games launch via Dolphin instead of RetroArch
    if (options.system === 'gamecube' || options.system === 'wii') {
      this.writeDolphinConfig();
      if (options.system === 'wii') this.writeWiiConfig(options.controllerName);
      if (options.system === 'gamecube') this.writeGCPadConfig(options.controllerName);
      const dolphin = await this.findDolphin();
      if (!dolphin.found) return { success: false, error: 'Dolphin not found. Please install Dolphin first.' };
      console.log('[Bridge] Launching GameCube/Wii game via Dolphin:', options.romPath);
      try {
        this.retroarchProcess = spawn(dolphin.path, ['--batch', '--exec=' + options.romPath], { detached: false, stdio: 'ignore' });
        this.retroarchProcess.on('exit', () => {
          console.log('[Bridge] Dolphin exited');
          this.retroarchProcess = null;
          const { BrowserWindow } = require('electron');
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) { wins[0].show(); wins[0].focus(); }
        });
        return { success: true };
      } catch(err) {
        return { success: false, error: err.message };
      }
    }

    // Switch games launch via Ryujinx instead of RetroArch
    if (options.system === 'switch') {
      const ryujinx = await this.findRyujinx();
      if (!ryujinx.found) return { success: false, error: 'Ryujinx not found. Please install Ryujinx first.' };
      console.log('[Bridge] Launching Switch game via Ryujinx:', options.romPath);
      try {
        this.retroarchProcess = spawn(ryujinx.path, [options.romPath], { detached: false, stdio: 'ignore' });
        this.retroarchProcess.on('exit', () => {
          console.log('[Bridge] Ryujinx exited');
          this.retroarchProcess = null;
          const { BrowserWindow } = require('electron');
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) { wins[0].show(); wins[0].focus(); }
        });
        return { success: true };
      } catch(err) {
        return { success: false, error: err.message };
      }
    }

    // Find the core for this system
    const coreFile = SYSTEM_CORES[options.system];
    if (!coreFile) return { success: false, error: 'No core mapped for system: ' + options.system };

    const corePath = path.join(CORES_PATH, coreFile);
    if (!fs.existsSync(corePath)) {
      return { success: false, error: 'Core not installed: ' + coreFile + '. Go to Settings to install cores.' };
    }

    // Write core options file for N64 to set Angrylion as default video plugin
    if (options.system === 'n64') {
      const n64OptsDir = path.join(os.homedir(), 'Library/Application Support/RetroArch/config/Mupen64Plus-Next');
      try { fs.mkdirSync(n64OptsDir, { recursive: true }); } catch(e) {}
      const n64OptsFile = path.join(n64OptsDir, 'Mupen64Plus-Next.opt');
      if (!fs.existsSync(n64OptsFile)) {
        fs.writeFileSync(n64OptsFile, "mupen64plus-rdp-plugin = \"angrylion\"\n");
        console.log('[Bridge] Wrote N64 core options:', n64OptsFile);
      }
    }

    // Write remap file for this game so device type is correct
    const gameName = path.basename(options.romPath, path.extname(options.romPath));
    this.writeRetroArchConfig();
    this.writeRemapFile(options.system, gameName);

    // Build RetroArch launch args
    const args = ['-L', corePath, '--fullscreen', options.romPath];

    console.log('[Bridge] Launching:', this.retroarchPath, args.join(' '));

    try {
      this.retroarchProcess = spawn(this.retroarchPath, args, { detached: false, stdio: 'ignore' });
      this.retroarchProcess.on('exit', () => {
        console.log('[Bridge] RetroArch exited');
        this.retroarchProcess = null;
        const { BrowserWindow } = require('electron');
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) { wins[0].show(); wins[0].focus(); }
      });
      return { success: true, pid: this.retroarchProcess.pid };
    } catch(err) {
      return { success: false, error: err.message };
    }
  }

  writeGCPadConfig(controllerName) {
    const dolphinConfigDir = require('path').join(require('os').homedir(), 'Library/Application Support/Dolphin/Config');
    try { require('fs').mkdirSync(dolphinConfigDir, { recursive: true }); } catch(e) {}
    const lower = (controllerName || '').toLowerCase();
    let sdlDevice = 'SDL/0/PS4 Controller';
    if (lower.includes('xbox')) sdlDevice = 'SDL/0/Xbox One S Controller';
    else if (lower.includes('switch pro') || lower.includes('nintendo switch pro')) sdlDevice = 'SDL/0/Nintendo Switch Pro Controller';
    const gcpadConfig = `[GCPad1]
Device = ${sdlDevice}
Buttons/A = \`Button S\`
Buttons/B = \`Button E\`
Buttons/X = \`Button N\`
Buttons/Y = \`Button W\`
Buttons/Z = \`Shoulder R\`
Buttons/Start = Start
Main Stick/Up = \`Left Y+\`
Main Stick/Down = \`Left Y-\`
Main Stick/Left = \`Left X-\`
Main Stick/Right = \`Left X+\`
Main Stick/Modifier = \`Shift\`
Main Stick/Calibration = 100.00 141.42 100.00 141.42 100.00 141.42 100.00 141.42
C-Stick/Up = \`Right Y+\`
C-Stick/Down = \`Right Y-\`
C-Stick/Left = \`Right X-\`
C-Stick/Right = \`Right X+\`
C-Stick/Modifier = \`Ctrl\`
C-Stick/Calibration = 100.00 141.42 100.00 141.42 100.00 141.42 100.00 141.42
Triggers/L = \`Trigger L\`
Triggers/R = \`Trigger R\`
D-Pad/Up = \`Pad N\`
D-Pad/Down = \`Pad S\`
D-Pad/Left = \`Pad W\`
D-Pad/Right = \`Pad E\`
[GCPad2]
Device = Quartz/0/Keyboard & Mouse
[GCPad3]
Device = Quartz/0/Keyboard & Mouse
[GCPad4]
Device = Quartz/0/Keyboard & Mouse`;
    try {
      require('fs').writeFileSync(require('path').join(dolphinConfigDir, 'GCPadNew.ini'), gcpadConfig);
      console.log('[Bridge] Wrote GameCube controller config');
    } catch(e) {
      console.error('[Bridge] Failed to write GCPad config:', e.message);
    }
  }

  writePCSX2Config() {
    const cfgPath = require('path').join(require('os').homedir(), 'Library/Application Support/PCSX2/inis/PCSX2.ini');
    try {
      let cfg = '';
      const fs = require('fs');
      if (fs.existsSync(cfgPath)) cfg = fs.readFileSync(cfgPath, 'utf8');
      // Write ConfirmShutdown setting
      const shutdownRegex = new RegExp('^ConfirmShutdown\s*=.*$', 'm');
      if (shutdownRegex.test(cfg)) { cfg = cfg.replace(shutdownRegex, 'ConfirmShutdown = false'); }
      else { cfg += '\nConfirmShutdown = false'; }
      // Write Pad1 controller config
      const pad1 = '[Pad1]\nType = DualShock2\nInvertL = 0\nInvertR = 0\nDeadzone = 0\nAxisScale = 1.33\nLargeMotorScale = 1\nSmallMotorScale = 1\nButtonDeadzone = 0\nPressureModifier = 0.5\nUp = SDL-0/DPadUp\nRight = SDL-0/DPadRight\nDown = SDL-0/DPadDown\nLeft = SDL-0/DPadLeft\nTriangle = SDL-0/FaceNorth\nCircle = SDL-0/FaceEast\nCross = SDL-0/FaceSouth\nSquare = SDL-0/FaceWest\nSelect = SDL-0/Back\nStart = SDL-0/Start\nL1 = SDL-0/LeftShoulder\nL2 = SDL-0/+LeftTrigger\nR1 = SDL-0/RightShoulder\nR2 = SDL-0/+RightTrigger\nL3 = SDL-0/LeftStick\nR3 = SDL-0/RightStick\nLUp = SDL-0/-LeftY\nLRight = SDL-0/+LeftX\nLDown = SDL-0/+LeftY\nLLeft = SDL-0/-LeftX\nRUp = SDL-0/-RightY\nRRight = SDL-0/+RightX\nRDown = SDL-0/+RightY\nRLeft = SDL-0/-RightX\nAnalog = SDL-0/Guide\nLargeMotor = SDL-0/LargeMotor\nSmallMotor = SDL-0/SmallMotor';
      if (cfg.includes('[Pad1]')) {
        cfg = cfg.replace(/\[Pad1\][\s\S]*?(?=\n\[|\s*$)/, pad1);
      } else {
        cfg += '\n' + pad1;
      }
      fs.writeFileSync(cfgPath, cfg);
      console.log('[Bridge] Wrote PCSX2 config');
    } catch(e) {
      console.error('[Bridge] Failed to write PCSX2 config:', e.message);
    }
  }

  writeDolphinConfig() {
    const cfgPath = require('path').join(require('os').homedir(), 'Library/Application Support/Dolphin/Config/Dolphin.ini');
    try {
      let cfg = '';
      const fs = require('fs');
      if (fs.existsSync(cfgPath)) cfg = fs.readFileSync(cfgPath, 'utf8');
      const settings = { 'ConfirmStop': 'False' };
      for (const [key, val] of Object.entries(settings)) {
        const regex = new RegExp('^' + key + '\s*=.*$', 'm');
        const line = key + ' = ' + val;
        if (regex.test(cfg)) { cfg = cfg.replace(regex, line); }
        else { cfg += '\n' + line; }
      }
      fs.writeFileSync(cfgPath, cfg);
      console.log('[Bridge] Wrote Dolphin config');
    } catch(e) {
      console.error('[Bridge] Failed to write Dolphin config:', e.message);
    }
  }

  writeWiiConfig(controllerName) {
    const dolphinConfigDir = path.join(os.homedir(), 'Library/Application Support/Dolphin/Config');
    try { require('fs').mkdirSync(dolphinConfigDir, { recursive: true }); } catch(e) {}
    const lower = (controllerName || '').toLowerCase();
    let sdlDevice = 'SDL/0/Nintendo Switch Pro Controller';
    if (lower.includes('xbox')) sdlDevice = 'SDL/0/Xbox One S Controller';
    else if (lower.includes('054c') || lower.includes('dualshock') || lower.includes('wireless controller')) sdlDevice = 'SDL/0/PS4 Controller';
    const wiimoteConfig = `[Wiimote1]
Device = ${sdlDevice}
Buttons/A = \`Button E\`
Buttons/B = \`Button S\`
Buttons/1 = \`Button N\`
Buttons/2 = \`Button W\`
Buttons/- = Back
Buttons/+ = Start
Buttons/Home = Guide
D-Pad/Up = \`Pad N\`
D-Pad/Down = \`Pad S\`
D-Pad/Left = \`Pad W\`
D-Pad/Right = \`Pad E\`
IR/Up = \`Right Y+\`
IR/Down = \`Right Y-\`
IR/Left = \`Right X-\`
IR/Right = \`Right X+\`
Shake/X = \`Trigger R\`
Shake/Y = \`Trigger R\`
Shake/Z = \`Middle Click\`
IRPassthrough/Object 1 X = \`IR Object 1 X\`
IRPassthrough/Object 1 Y = \`IR Object 1 Y\`
IRPassthrough/Object 1 Size = \`IR Object 1 Size\`
IRPassthrough/Object 2 X = \`IR Object 2 X\`
IRPassthrough/Object 2 Y = \`IR Object 2 Y\`
IRPassthrough/Object 2 Size = \`IR Object 2 Size\`
IRPassthrough/Object 3 X = \`IR Object 3 X\`
IRPassthrough/Object 3 Y = \`IR Object 3 Y\`
IRPassthrough/Object 3 Size = \`IR Object 3 Size\`
IRPassthrough/Object 4 X = \`IR Object 4 X\`
IRPassthrough/Object 4 Y = \`IR Object 4 Y\`
IRPassthrough/Object 4 Size = \`IR Object 4 Size\`
IMUAccelerometer/Up = @(\`Left Y+\`+\`Left X+\`)
IMUAccelerometer/Down = @(\`Left Y-\`+\`Left X-\`)
IMUAccelerometer/Left = \`Left X-\`
IMUAccelerometer/Right = \`Left X+\`
IMUAccelerometer/Forward = \`Left X+\`
IMUAccelerometer/Backward = \`Left X-\`
IMUGyroscope/Pitch Up = \`Gyro Pitch Up\`
IMUGyroscope/Pitch Down = \`Gyro Pitch Down\`
IMUGyroscope/Roll Left = \`Gyro Roll Left\`
IMUGyroscope/Roll Right = \`Gyro Roll Right\`
IMUGyroscope/Yaw Left = \`Gyro Yaw Left\`
IMUGyroscope/Yaw Right = \`Gyro Yaw Right\`
Nunchuk/Buttons/C = \`Trigger R\`
Nunchuk/Buttons/Z = \`Shoulder R\`
Nunchuk/Stick/Up = \`Left Y+\`
Nunchuk/Stick/Down = \`Left Y-\`
Nunchuk/Stick/Left = \`Left X-\`
Nunchuk/Stick/Right = \`Left X+\`
Nunchuk/Stick/Calibration = 100.00 141.42 100.00 141.42 100.00 141.42 100.00 141.42
Nunchuk/Shake/X = \`Thumb L\`
Nunchuk/Shake/Y = \`Trigger L\`
Nunchuk/Shake/Z = \`Thumb L\`
Source = 1
Rumble/Motor = \`Motor L\`|\`Motor R\`
IR/Relative Input = True
Classic/Buttons/A = \`Button S\`
Classic/Buttons/B = \`Button E\`
Classic/Buttons/X = \`Button W\`
Classic/Buttons/Y = \`Button N\`
Classic/Buttons/ZL = \`Shoulder L\`
Classic/Buttons/ZR = \`Shoulder R\`
Classic/D-Pad/Up = \`Pad N\`
Classic/D-Pad/Down = \`Pad S\`
Classic/D-Pad/Left = \`Pad W\`
Classic/D-Pad/Right = \`Pad E\`
Classic/Left Stick/Up = \`Left Y+\`
Classic/Left Stick/Down = \`Left Y-\`
Classic/Left Stick/Left = \`Left X-\`
Classic/Left Stick/Right = \`Left X+\`
Classic/Right Stick/Up = \`Right Y+\`
Classic/Right Stick/Down = \`Right Y-\`
Classic/Right Stick/Left = \`Right X-\`
Classic/Right Stick/Right = \`Right X+\`
Classic/Triggers/L-Analog = \`Trigger L\`
Classic/Triggers/R-Analog = \`Trigger R\`
Extension = Nunchuk
[Wiimote2]
Device = Quartz/0/Keyboard & Mouse
Source = 0
[Wiimote3]
Device = Quartz/0/Keyboard & Mouse
Source = 0
[Wiimote4]
Device = Quartz/0/Keyboard & Mouse
Source = 0
[BalanceBoard]
Device = Quartz/0/Keyboard & Mouse
Source = 0`;
    try {
      fs.writeFileSync(path.join(dolphinConfigDir, 'WiimoteNew.ini'), wiimoteConfig);
      console.log('[Bridge] Wrote Wii controller config');
    } catch(e) {
      console.error('[Bridge] Failed to write Wii config:', e.message);
    }
  }


  getArtworkCacheDir() {
    const dir = require('path').join(require('os').homedir(), 'Library/Application Support/EasyArc/artwork');
    try { require('fs').mkdirSync(dir, { recursive: true }); } catch(e) {}
    return dir;
  }

  getArtworkPath(game) {
    const cleanTitle = (game.title||'').replace(/\.(pbp|zip|iso|bin|cue|img|rom|gba|gbc|nes|sfc|smc|n64|z64|v64|gcm|gcz|rvz|wbfs|nsp|xci)$/i, '');
    const safe = cleanTitle.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 60);
    return require('path').join(this.getArtworkCacheDir(), game.system + '_' + safe + '.jpg');
  }

  saveArtwork(game, base64Data) {
    try {
      const artPath = this.getArtworkPath(game);
      const buf = Buffer.from(base64Data, 'base64');
      require('fs').writeFileSync(artPath, buf);
      return { success: true, path: artPath };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  moveFiles(filePaths, destFolder) {
    const fs = require('fs');
    const path = require('path');
    const results = { moved: [], failed: [] };
    for (const src of filePaths) {
      try {
        const dest = path.join(destFolder, path.basename(src));
        fs.renameSync(src, dest);
        results.moved.push(dest);
      } catch(e) {
        // Try copy+delete if rename fails (cross-device)
        try {
          const dest = path.join(destFolder, path.basename(src));
          fs.copyFileSync(src, dest);
          fs.unlinkSync(src);
          results.moved.push(dest);
        } catch(e2) {
          results.failed.push({ src, error: e2.message });
        }
      }
    }
    return { success: true, moved: results.moved.length, failed: results.failed.length };
  }

  scanCollection(parentFolder) {
    const fs = require('fs');
    const path = require('path');
    try {
      const entries = fs.readdirSync(parentFolder, { withFileTypes: true });
      const results = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const folderName = entry.name.toLowerCase();
        if (SKIP_FOLDERS.has(folderName)) continue;
        const fullPath = path.join(parentFolder, entry.name);
        // Try to detect system from folder name
        let detectedSystem = null;
        for (const hint of FOLDER_HINTS) {
          if (hint.hints.some(h => {
            // Exact match always wins
            if (folderName === h) return true;
            // For short hints (3 chars or less), only exact match
            if (h.length <= 3) return folderName === h;
            // For longer hints, check if contained with word boundaries
            const idx = folderName.indexOf(h);
            if (idx === -1) return false;
            const before = idx === 0 || !/[a-z0-9]/.test(folderName[idx-1]);
            const after = idx+h.length >= folderName.length || !/[a-z0-9]/.test(folderName[idx+h.length]);
            return before && after;
          })) {
            detectedSystem = hint.system;
            break;
          }
        }
        // Count files in folder
        let fileCount = 0;
        try {
          fileCount = fs.readdirSync(fullPath).filter(f => !fs.statSync(path.join(fullPath, f)).isDirectory()).length;
        } catch(e) {}
        if (fileCount > 0) {
          results.push({ folder: fullPath, folderName: entry.name, detectedSystem, fileCount });
        }
      }
      return { success: true, folders: results };
    } catch(e) {
      return { success: false, error: e.message, folders: [] };
    }
  }

  createFolder(folderPath) {
    try {
      require('fs').mkdirSync(folderPath, { recursive: true });
      return { success: true, path: folderPath };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  artworkExists(game) {
    return require('fs').existsSync(this.getArtworkPath(game));
  }

  getMetadata(game) {
    const metaPath = this.getArtworkPath(game).replace(/\.jpg$/, '.json');
    try {
      if (require('fs').existsSync(metaPath)) {
        return JSON.parse(require('fs').readFileSync(metaPath, 'utf8'));
      }
    } catch(e) {}
    return null;
  }

  async scrapeGame(game, ssUser, ssPassword) {
    const SS_IDS = { gbc:33, gba:12, nes:3, snes:4, n64:14, gamecube:13, wii:38, psx:57, ps2:58, switch:203, dreamcast:23, genesis:1, jaguar:27, gamegear:21, mastersystem:2, saturn:22, psp:61, ps3:59 };
    const systemId = SS_IDS[game.system];
    if (!systemId) return { success:false, error:'Unsupported system' };
    const artPath = this.getArtworkPath(game);
    const metaPath0 = artPath.replace(/\.jpg$/, '.json');
    if (require('fs').existsSync(artPath) && require('fs').existsSync(metaPath0)) return { success:true, path:artPath, cached:true };

    const https = require('https');
    const fs = require('fs');

    const httpsGet = (url) => new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    const httpsGetBinary = (url) => new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpsGetBinary(res.headers.location));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });

    const getEnglishText = (arr) => {
      if (!arr) return '';
      const en = arr.find(x => x.langue === 'en');
      return en ? en.text : (arr[0] ? arr[0].text : '');
    };

    const baseParams = 'devid=jelos&devpassword=jelos&softname=EasyArc&ssid=' + encodeURIComponent(ssUser) + '&sspassword=' + encodeURIComponent(ssPassword) + '&output=json';

    try {
      // Step 1: Clean the title and search for game ID
      const cleanTitle = game.title
        .replace(/\.(pbp|zip|iso|bin|cue|img|rom|gba|gbc|nes|sfc|smc|n64|z64|v64|gcm|gcz|rvz|wbfs|nsp|xci)$/i, '')
        .replace(/\(USA\)|\(Europe\)|\(Japan\)|\(World\)|\(En.*?\)|\(Rev.*?\)/gi, '')
        .replace(/\(Disc ?\d+\)/gi, '')
        .replace(/\[.*?\]/g, '')
        .replace(/\bv\d+(\.\d+)+\b/gi, '')
        .replace(/\s+/g, ' ').trim();

      const searchUrl = 'https://api.screenscraper.fr/api2/jeuRecherche.php?' + baseParams + '&recherche=' + encodeURIComponent(cleanTitle) + '&systemeid=' + systemId;
      const searchData = await httpsGet(searchUrl);
      const searchJson = JSON.parse(searchData);

      let gameId = null;
      if (searchJson.response && searchJson.response.jeux && searchJson.response.jeux.length > 0) {
        const firstGame = searchJson.response.jeux[0];
        if (firstGame && firstGame.id) gameId = firstGame.id;
      }

      if (!gameId) return { success:false, error:'Game not found in search' };

      // Step 2: Get full game info including media using game ID
      const infoUrl = 'https://api.screenscraper.fr/api2/jeuInfos.php?' + baseParams + '&gameid=' + gameId;
      const infoData = await httpsGet(infoUrl);
      const infoJson = JSON.parse(infoData);

      if (!infoJson.response || !infoJson.response.jeu) return { success:false, error:'No game info found' };

      const jeu = infoJson.response.jeu;
      const medias = jeu.medias || [];

      // Find best box art
      let mediaUrl = null;
      for (const type of ['box-2D-US', 'box-2D', 'box-3D-US', 'box-3D']) {
        const m = medias.find(m => m.type === type);
        if (m && m.url) { mediaUrl = m.url; break; }
      }
      if (!mediaUrl) return { success:false, error:'No media found' };

      // Extract metadata
      const mainGenre = jeu.genres ? jeu.genres.find(g => g.principale === '1') : null;
      const metadata = {
        title:     jeu.noms ? getEnglishText(jeu.noms) : '',
        genre:     mainGenre ? getEnglishText(mainGenre.noms) : '',
        year:      jeu.dates ? ((jeu.dates.find(d => d.region === 'us') || jeu.dates[0] || {}).text || '').substring(0,4) : '',
        publisher: (jeu.editeur && jeu.editeur.text) || '',
        players:   (jeu.joueurs && jeu.joueurs.text) || '',
        synopsis:  (jeu.synopsis && getEnglishText(jeu.synopsis)) || (jeu.synopsis_en && jeu.synopsis_en.text) || '',
      };

      // Save metadata JSON
      const metaPath = artPath.replace(/\.jpg$/, '.json');
      fs.writeFileSync(metaPath, JSON.stringify(metadata));

      // Download and save image
      const imgBuf = await httpsGetBinary(mediaUrl);
      fs.writeFileSync(artPath, imgBuf);

      return { success:true, path:artPath, metadata };

    } catch(e) {
      return { success:false, error:e.message };
    }
  }


  async scrapeLibrary(games, ssUser, ssPassword, progressCallback) {
    const results = { success:0, failed:0, cached:0 };
    for (let i = 0; i < games.length; i++) {
      if (progressCallback) progressCallback(i, games.length, games[i].title);
      await new Promise(r => setTimeout(r, 2000));
      const r = await this.scrapeGame(games[i], ssUser, ssPassword);
      if (r.cached) results.cached++; else if (r.success) results.success++; else results.failed++;
    }
    return results;
  }

  async killGame() {
    if (this.retroarchProcess && !this.retroarchProcess.killed) {
      this.retroarchProcess.kill('SIGKILL');
      console.log('[Bridge] Killed game process');
      return { success: true };
    }
    return { success: false, error: 'No game running' };
  }

  async listControllers() { return []; }
  async saveMapping(mapping) { return { success: true }; }
}

module.exports = RetroArchBridge;
