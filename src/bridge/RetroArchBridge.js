const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const https = require('https');

// --- Scraper Subsystem ---
const ScraperPipeline = require('../scraper/ScraperPipeline');





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

const DUCKSTATION_LOCATIONS = {
  darwin: ['/Applications/DuckStation.app/Contents/MacOS/DuckStation'],
  win32:  ['C:\\Program Files\\DuckStation\\duckstation-qt-x64-ReleaseLTCG.exe'],
  linux:  ['/usr/bin/duckstation-qt'],
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
  // FIX_2026-06-13_RETROARCH_WIN_PORT: bundled portable location under easyarc APPDATA.
  win32:  [path.join(process.env.APPDATA || os.homedir(), 'easyarc', 'retroarch', 'retroarch.exe')],
  linux:  ['/usr/bin/retroarch'],
};

// Extensions that uniquely identify a system — no ambiguity
const UNIQUE_EXTENSIONS = {
  // Extensions that belong to exactly one system — no folder hint needed
  gbc:          ['.gbc', '.gbs'],
  gb:           ['.gb'],
  gba:          ['.gba', '.agb'],
  snes:         ['.sfc', '.smc', '.fig', '.bs'],
  nes:          ['.nes', '.fds', '.unf', '.unif'],
  n64:          ['.z64', '.n64', '.v64', '.ndd'],
  jaguar:       ['.j64', '.jag', '.rom'],
  genesis:      ['.md', '.gen', '.smd', '.68k'],
  gamegear:     ['.gg'],
  mastersystem: ['.sms'],
  atari2600:    ['.a26'],
  atari7800:    ['.a78'],
  msdos:        ['.exe', '.com', '.bat', '.img', '.ima', '.iso'],
  switch:       ['.nsp', '.xci', '.nca'],
  gamecube:     ['.gcm', '.gcz', '.nkit'],
  wii:          ['.wbfs', '.wad'],
  wiiu:         ['.wud', '.wux', '.rpx', '.wua'],
};

// Extensions shared by multiple systems — folder hint required to resolve
const SHARED_EXTENSIONS = {
  '.zip':  ['gbc','gb','gba','snes','nes','n64','genesis','gamegear','mastersystem','atari2600','atari7800','jaguar','msdos','psp','pspmini','psx','gamecube','wii','mame','mame2003','arcade','neogeo'],
  '.7z':   ['gbc','gba','snes','nes','n64','genesis','gamegear','mastersystem','atari2600','atari7800','jaguar','msdos','psp','psx','mame','mame2003','arcade','neogeo'],
  '.bin':  ['atari2600','atari7800','genesis','mastersystem','gamegear','saturn'],
  '.iso':  ['ps2','psp','pspmini','gamecube','wii','saturn','dreamcast'],
  '.rvz':  ['gamecube','wii'],
  '.ciso': ['gamecube','wii'],
  '.cso':  ['ps2','psp','pspmini'],
  '.chd':  ['psx','ps2','saturn','dreamcast'],
  '.cdi':  ['dreamcast'],
  '.cue':  ['psx','ps2','saturn','dreamcast'],
  '.pbp':  ['psx','psp','pspmini'],
  '.pkg':  ['ps3'],
};

// Folder hints in priority order — most specific first
// Short hints (3 chars or less) require exact folder name match
const FOLDER_HINTS = [
  { hints: ['playstation 3','playstation3','ps3'],                           system: 'ps3' },
  { hints: ['playstation 2','playstation2','ps2'],                           system: 'ps2' },
  { hints: ['playstation portable','psp'],                                   system: 'psp' },
  { hints: ['psp mini','pspmini','psp-mini','psp_mini','psp minis','pspminis','psp-minis','psp_minis','mini psp','minipsp','mini-psp','playstation portable mini','playstation portable minis','ps portable mini','ps minis','playstation minis','minis','pspgo'], system: 'pspmini' },
  { hints: ['sony playstation','playstation 1','playstation1','psx','ps1'],  system: 'psx' },
  { hints: ['sega dreamcast','dreamcast','dream cast'],                      system: 'dreamcast' },
  { hints: ['sega saturn','saturn'],                                         system: 'saturn' },
  { hints: ['game boy color','gameboy color','gbc'],                         system: 'gbc' },
  { hints: ['game boy advance','gameboy advance','gba'],                     system: 'gba' },
  { hints: ['game boy','gameboy','gb'],                                      system: 'gb' },
  { hints: ['super nintendo','super nes','superfamicom','snes'],             system: 'snes' },
  { hints: ['nintendo 64','nintendo64','n64'],                               system: 'n64' },
  { hints: ['nintendo entertainment system','nintendo entertainment','nes'], system: 'nes' },
  { hints: ['nintendo wii u','wiiu','wii u'],                                system: 'wiiu' },
  { hints: ['nintendo wii','wii nintendo','wii games','wii'],                system: 'wii' },
  { hints: ['nintendo switch','switch','nx'],                                system: 'switch' },
  { hints: ['nintendo 3ds','3ds'],                                           system: '3ds' },
  { hints: ['gamecube','game cube','nintendo gamecube','ngc','gc'],          system: 'gamecube' },
  { hints: ['mega drive','megadrive','sega genesis','genesis'],              system: 'genesis' },
  { hints: ['game gear','gamegear','gg'],                                    system: 'gamegear' },
  { hints: ['master system','mastersystem','sms'],                           system: 'mastersystem' },
  { hints: ['atari 2600','atari2600'],                                       system: 'atari2600' },
  { hints: ['atari 7800','atari7800'],                                       system: 'atari7800' },
  { hints: ['dos','msdos','ms-dos','ms dos','dosbox','pc games','dos games','pc','msdos games','pc dos','ibm pc'], system: 'msdos' },
  { hints: ['atari jaguar','atarijaguar','jaguar'],                          system: 'jaguar' },
  { hints: ['mame2003','mame 2003','mame2003plus'],                          system: 'mame2003' },
  { hints: ['mame'],                                                         system: 'mame' },
  { hints: ['neogeo','neo geo','neo-geo'],                                   system: 'neogeo' },
  { hints: ['arcade','cps1','cps2','cps3','atomiswave','naomi'],             system: 'arcade' },
];

// Folders to skip during scanning
const SKIP_FOLDERS = new Set([
  'logs','logs_arrm','media','images','videos','manuals',
  'cheats','saves','states','backup','extras','artwork',
  'boxart','screenshots','thumbs','bios','themes','tools',
  'bgmusic','launchimages','pico-8','scummvm','easyrpg',
  '.fseventsd','.spotlight-v100','.trashes','.ds_store',
]);

// FIX_2026-06-13_RETROARCH_WIN_PORT: platform-aware cores dir. Windows uses the
// self-contained portable layout %APPDATA%\\easyarc\\retroarch\\cores (cores as a
// subfolder under the bundled RetroArch). Mac keeps its existing full-install path.
const RETROARCH_WIN_DIR = path.join(process.env.APPDATA || os.homedir(), 'easyarc', 'retroarch');
const CORES_PATH = process.platform === 'win32'
  ? path.join(RETROARCH_WIN_DIR, 'cores')
  : path.join(os.homedir(), 'Library/Application Support/RetroArch/cores');
const REMAPS_PATH = process.platform === 'win32'
  ? path.join(process.env.APPDATA || os.homedir(), 'easyarc', 'retroarch', 'remaps')
  : path.join(os.homedir(), 'Library/Application Support/RetroArch/config/remaps');

// Core folder names for remap files (must match RetroArch's core display name)
const CORE_REMAP_FOLDERS = {
  gbc:         'Gambatte',
  gb:          'Gambatte',
  gba:         'mGBA',
  nes:         'Mesen',
  snes:        'Snes9x',
  n64:         'Mupen64Plus-Next',
  jaguar:      'Virtual Jaguar',
  genesis:     'Genesis Plus GX',
  gamegear:    'Genesis Plus GX',
  mastersystem:'Genesis Plus GX',
  psx:         'DuckStation',
  ps2:         'PCSX2',
  psp:         'PPSSPP',
  saturn:      'Beetle Saturn',
  mame:        'MAME',
  mame2003:    'MAME 2003-Plus',
  arcade:      'FinalBurn Neo',
  neogeo:      'FinalBurn Neo',
  dreamcast:   'Flycast',
  gamecube:    'Dolphin',
  atari2600:   'Stella',
  atari7800:   'ProSystem',
  msdos:       'DOSBox-Pure',
};

// Device type values per system (RetroArch internal values)
// These match what RetroArch saves in remap files
const SYSTEM_DEVICE_TYPES = {
  psx:      { p1: '517', p2: '517' },  // 517 = DualShock
  ps2:      { p1: '517', p2: '517' },
  n64:      { p1: '5',   p2: '5'   },  // 5 = N64 controller
  jaguar:   { p1: '1',   p2: '1'   },  // 1 = RetroPad
  gbc:      { p1: '1',   p2: '1'   },
  gb:       { p1: '1',   p2: '1'   },
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
  gb:       { p1: '1', p2: '1' },
  gba:      { p1: '1', p2: '1' },
  snes:     { p1: '1', p2: '1' },
  nes:      { p1: '1', p2: '1' },
  genesis:  { p1: '1', p2: '1' },
  saturn:   { p1: '1', p2: '1' },
  dreamcast:{ p1: '0', p2: '0' },
  mastersystem: { p1: '1', p2: '1' },
  gamecube: { p1: '0', p2: '0' },
};

const SYSTEM_CORES = {
  gbc:          'gambatte_libretro.dylib',
  gb:           'gambatte_libretro.dylib',
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
  atari7800:    'prosystem_libretro.dylib',
  msdos:        'dosbox_pure_libretro.dylib',
  mame:         'mame_libretro.dylib',
  mame2003:     'mame2003_plus_libretro.dylib',
  arcade:       'fbneo_libretro.dylib',
  neogeo:       'fbneo_libretro.dylib',
};

const CRC32 = require('crc-32');
const yauzl = require('yauzl');

// -----------------------------
// Scraping helper functions
// -----------------------------

function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function httpsGetBinary(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpsGetBinary(res.headers.location));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function safeJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try { return JSON.parse(trimmed); }
  catch { return null; }
}

function scrapeDelay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function computeCrcFromBuffer(buf) {
  const crc = (CRC32.buf(buf) >>> 0).toString(16).toUpperCase();
  return crc.padStart(8, '0');
}

const MAME2003_ALIASES = {
  puckman:   'pacman',
  mspacmnf:  'mspacman',
  galagamw:  'galaga',
  galaxiana: 'galaxian',
  froggers:  'frogger',
  pooyans:   'pooyan',
  scramblb:  'scramble',
  superpcm:  'superpac',
  digdugat:  'digdug',
  digdug2o:  'digdug2',
  bombjac2:  'bombjack',
  popeyebl:  'popeye',
  joustr:    'joust',
  trackfldc: 'trackfld',
  circusc2:  'circusc',
  contrab:   'contra'
};

function readFileBuffer(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    let crc = 0;
    const sha1 = require('crypto').createHash('sha1');
    const md5 = require('crypto').createHash('md5');
    let size = 0;
    stream.on('data', chunk => {
      size += chunk.length;
      sha1.update(chunk);
      md5.update(chunk);
      let c = crc ^ 0xffffffff;
      for (let i = 0; i < chunk.length; i++) {
        c = CRC32_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
      }
      crc = (c ^ 0xffffffff) >>> 0;
    });
    stream.on('end', () => {
      const crcHex = crc.toString(16).toUpperCase().padStart(8, '0');
      resolve({ crc: crcHex, sha1: sha1.digest('hex'), md5: md5.digest('hex'), size });
    });
    stream.on('error', reject);
  });
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function readZipLargestFileBuffer(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) return reject(err);
      let largest = null;
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
        if (!largest || entry.uncompressedSize > largest.uncompressedSize) {
          largest = entry;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        if (!largest) return reject(new Error('Empty ZIP'));
        zipfile.openReadStream(largest, (err, stream) => {
          if (err) return reject(err);
          let crc = 0;
          const sha1 = require('crypto').createHash('sha1');
          const md5 = require('crypto').createHash('md5');
          let size = 0;
          stream.on('data', chunk => {
            size += chunk.length;
            sha1.update(chunk);
            md5.update(chunk);
            let c = crc ^ 0xffffffff;
            for (let i = 0; i < chunk.length; i++) {
              c = CRC32_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
            }
            crc = (c ^ 0xffffffff) >>> 0;
          });
          stream.on('end', () => {
            zipfile.close();
            const crcHex = crc.toString(16).toUpperCase().padStart(8, '0');
            resolve({ crc: crcHex, sha1: sha1.digest('hex'), md5: md5.digest('hex'), size });
          });
          stream.on('error', reject);
        });
      });
    });
  });
}

async function getRomCrc(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    return await readZipLargestFileBuffer(filePath);
  }
  // Use buffered read for small ROMs (cartridge systems) — streaming fails on small files
  // Use streaming for large disc images (PS1 CHD, PS2 ISO etc.) to avoid memory issues
  const STREAM_THRESHOLD = 32 * 1024 * 1024; // 32MB
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= STREAM_THRESHOLD) {
      return await readFileBuffered(filePath);
    }
  } catch {}
  return await readFileBuffer(filePath);
}

function readFileBuffered(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) return reject(err);
      const sha1 = require('crypto').createHash('sha1');
      const md5 = require('crypto').createHash('md5');
      sha1.update(data);
      md5.update(data);
      let crc = 0;
      let c = crc ^ 0xffffffff;
      for (let i = 0; i < data.length; i++) {
        c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
      }
      crc = (c ^ 0xffffffff) >>> 0;
      const crcHex = crc.toString(16).toUpperCase().padStart(8, '0');
      resolve({ crc: crcHex, sha1: sha1.digest('hex'), md5: md5.digest('hex'), size: data.length });
    });
  });
}

function cleanTitleForSearch(raw, system) {
  if (!raw) return "";
  let title = raw;
  title = title.replace(/\.[a-z0-9]{2,4}$/i, "");
  title = title.replace(/\((USA|Europe|Japan|World|En|En,Ja|Ja|Fr|De|Es|It|Nl|Pt|Zh|Ko)\)/gi, "");
  title = title.replace(/\((En|Ja|Fr|De|Es|It|Nl|Pt|Zh|Ko)(,[A-Za-z]{2})+\)/gi, "");
  title = title.replace(/\((GBC Mode|GB Compatible|SGB Enhanced|SGB Compatible)\)/gi, "");
  title = title.replace(/\((Rev [A-Z0-9]+|Rev [0-9]+)\)/gi, "");
  title = title.replace(/\((Proto|Prototype|Sample|Demo|Beta)\)/gi, "");
  title = title.replace(/\[[^\]]+\]/g, "");
  title = title.replace(/\(v[0-9.]+\)/gi, "");
  if (system === 'atari2600') {
    title = title.replace(/\(\d{4}\)/gi, "");
    title = title.replace(/\(PAL(?:-[0-9]+)?\)/gi, "");
    title = title.replace(/\((?:Atari|Activision|Parker\s*Bros|Mattel|Coleco|Imagic|Tigervision|M\s*Network|CBS\s*Electronics|Data\s*Age|Apollo|Salu|HES|Sears|Mystique|CCE|20th\s*Century\s*Fox|Telegames|TNT\s*Games|Bitcorp|Rentacom|Starsoft|HomeVision|Funvision|Dynamics|Goliath|Zellers|Ariola|Rainbow\s*Vision|Spectravideo|Telesys|Supervision|UA|U\.S\.\s*Games|Xonox|Retroactive|ITT\s*Family\s*Games|Spectravision|Starpath|Sega|CommaVid|Bomb|Zimag|Froggo|Panda|Video\s*Gems|Epyx|Dimax|High-Score\s*Games|Gameworld|Answer\s*Software|First\s*Star\s*Software)\)/gi, "");
    title = title.replace(/\(AKA[^)]*\)/gi, "");
    title = title.replace(/\((?:NTSC|PAL)[^)]*(?:by|Conversion)\)/gi, "");
    title = title.replace(/\([^)]*hack[^)]*\)/gi, "");
    title = title.replace(/\([^)]*in-1[^)]*\)/gi, "");
    title = title.replace(/\([^)]*demo[^)]*\)/gi, "");
    title = title.replace(/\((?:proto(?:type)?|beta|demo)\)/gi, "");
  }
  title = title.replace(/\s+/g, " ").trim();
  return title;
}

async function screenScraperHashLookup(baseParams, systemId, game, crc, size) {
  const romnom = encodeURIComponent(path.basename(game.path));
  const romtaille = size;
  const url =
    `https://api.screenscraper.fr/api2/jeuInfos.php?${baseParams}` +
    `&crc=${crc}&systemeid=${systemId}&romtype=rom&romnom=${romnom}&romtaille=${romtaille}`;
  console.log('[Bridge] Hash URL:', url);
  let raw = await httpsGetText(url);
  let json = safeJson(raw);
  if (!json && raw.includes('Trop de requ')) {
    console.log('[Bridge] Rate limit (hash), retrying...');
    await scrapeDelay(1500);
    raw = await httpsGetText(url);
    json = safeJson(raw);
  }
  if (json && json.response && json.response.jeu && json.response.jeu.id) {
    return { ok: true, jeu: json.response.jeu };
  }
  return { ok: false, reason: 'No hash match' };
}

async function screenScraperTitleLookup(baseParams, systemId, game) {
  const cleanTitle = cleanTitleForSearch(game.title, game.system);
  const url =
    `https://api.screenscraper.fr/api2/jeuRecherche.php?${baseParams}` +
    `&recherche=${encodeURIComponent(cleanTitle)}&systemeid=${systemId}`;
  console.log('[Bridge] Title search URL:', url);
  let raw = await httpsGetText(url);
  let json = safeJson(raw);
  if (!json && raw.includes('Trop de requ')) {
    console.log('[Bridge] Rate limit (search), retrying...');
    await scrapeDelay(1500);
    raw = await httpsGetText(url);
    json = safeJson(raw);
  }
  if (json && json.response && json.response.jeux && json.response.jeux.length > 0) {
    const match = json.response.jeux.find(j => j.id && String(j.systemeid) === String(systemId));
    if (match) return { ok: true, jeu: match, cleanTitle };
    const anyValid = json.response.jeux.find(j => j.id);
    if (anyValid) return { ok: true, jeu: anyValid, cleanTitle };
  }
  return { ok: false, reason: 'No title match', cleanTitle };
}

async function screenScraperGameIdLookup(baseParams, gameId) {
  const url =
    `https://api.screenscraper.fr/api2/jeuInfos.php?${baseParams}&gameid=${gameId}`;
  console.log('[Bridge] Full metadata URL:', url);
  let raw = await httpsGetText(url);
  let json = safeJson(raw);
  if (!json && raw.includes('Trop de requ')) {
    console.log('[Bridge] Rate limit (gameid), retrying...');
    await scrapeDelay(1500);
    raw = await httpsGetText(url);
    json = safeJson(raw);
  }
  if (json && json.response && json.response.jeu && json.response.jeu.id) {
    return { ok: true, jeu: json.response.jeu };
  }
  return { ok: false, reason: 'No full metadata found' };
}

async function screenScraperMameLookup(baseParams, game) {
  const rawRomnom = path.basename(game.path, '.zip').toLowerCase();
  const resolvedRomnom = (game.system === 'mame2003' && MAME2003_ALIASES[rawRomnom]) ? MAME2003_ALIASES[rawRomnom] : rawRomnom;
  const romnom = encodeURIComponent(resolvedRomnom);
  const url =
    `https://api.screenscraper.fr/api2/jeuInfos.php?${baseParams}` +
    `&systemeid=75&romtype=rom&romnom=${romnom}`;
  console.log('[Bridge] MAME URL:', url);
  let raw = await httpsGetText(url);
  let json = safeJson(raw);
  if (!json && raw && raw.includes('Trop de requ')) {
    console.log('[Bridge] Rate limit (MAME), retrying...');
    await scrapeDelay(1500);
    raw = await httpsGetText(url);
    json = safeJson(raw);
  }
  if (json && json.response && json.response.jeu && json.response.jeu.id) {
    const jeu = json.response.jeu;
    if (jeu.cloneofid && jeu.cloneofid !== '0') {
      const parent = await screenScraperFetchParent(baseParams, jeu.cloneofid);
      if (parent) {
        const mergedMedias = {
          media: [
            ...(parent.medias?.media || []),
            ...(jeu.medias?.media || [])
          ]
        };
        const merged = {
          ...parent,
          roms: jeu.roms,
          medias: mergedMedias
        };
        return { ok: true, jeu: merged };
      }
    }
    return { ok: true, jeu };
  }
  return { ok: false, reason: 'No MAME match' };
}

async function screenScraperFetchParent(baseParams, parentId) {
  const url =
    `https://api.screenscraper.fr/api2/jeuInfos.php?${baseParams}` +
    `&gameid=${encodeURIComponent(parentId)}`;
  try {
    const raw = await httpsGetText(url);
    const json = safeJson(raw);
    return json && json.response && json.response.jeu ? json.response.jeu : null;
  } catch (err) {
    console.log('[Bridge] Parent fetch error:', err.message);
    return null;
  }
}

async function downloadArtworkAndMetadata(baseParams, gameId, artPath, metaPath, jeuData) {
  const isMame = jeuData && jeuData.systeme && String(jeuData.systeme.id) === '75';
  const mediaTypes = isMame
    ? ['wheel', 'marquee', 'snap', 'cabinet', 'flyer', 'sstitle', 'box-2D', 'box-3D']
    : ['box-2D', 'box-3D', 'box-texture', 'mixrbv1', 'mixrbv2', 'ss', 'sstitle', 'fanart', 'wheel', 'screenmarquee', 'title'];
  const medias = jeuData.medias || [];

  for (const type of mediaTypes) {
    const media = medias.find(m => m.type === type || m.type.startsWith(type + '('));
    if (!media || !media.url) {
      console.log(`[Bridge] No media entry for type: ${type}`);
      continue;
    }
    console.log(`[Bridge] Trying media type: ${type} — URL: ${media.url}`);
    try {
      const img = await httpsGetBinary(media.url);
      if (!img || img.length < 1000) {
        console.log(`[Bridge] Image too small for type: ${type}`);
        continue;
      }
      fs.writeFileSync(artPath, img);
      fs.writeFileSync(metaPath, JSON.stringify(jeuData, null, 2));
      console.log(`[Bridge] Artwork saved using type: ${type}`);
      return true;
    } catch (err) {
      console.log(`[Bridge] Failed for type ${type}:`, err.message);
    }
  }
  console.log('[Bridge] No artwork available for this game.');
  fs.writeFileSync(metaPath, JSON.stringify(jeuData, null, 2));
  return false;
}

class RetroArchBridge {
  constructor(config = {}) {
    this.config = config;
    this.retroarchPath = null;
    this.retroarchProcess = null;
    const _fs = require("fs"), _path = require("path"), _os = require("os");
    ["cores","system","config"].forEach(d => { try { _fs.mkdirSync(_path.join(_os.homedir(),"Library/Application Support/RetroArch/"+d),{recursive:true}); } catch(e) {} });
    // --- ScraperPipeline integration ---
    this.scraper = new ScraperPipeline({
      baseDir: config.artworkDir || this._getDefaultArtworkDir(),
      regionOrder: config.regionOrder,
      devId: config.devId || 'jelos',
      devPassword: config.devPassword || 'jelos',
      ssid: config.ssid || '',
      ssPassword: config.ssPassword || ''
    });
  }

  // Returns the platform-appropriate artwork directory.
  // Mac:     ~/Library/Application Support/easyarc/artwork
  // Windows: %APPDATA%\\easyarc\\artwork
  // Linux:   ~/.config/easyarc/artwork
  _getDefaultArtworkDir() {
    const { app } = require('electron');
    return require('path').join(app.getPath('userData'), 'artwork');
  }

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

  async findDuckStation() {
    // FIX_2026-05-22_DUCKSTATION_INSTALL: prefer EasyArc's managed copy over
    // any user-installed copy. EasyArc's copy has settings we've configured;
    // a user's copy may not, leading to inconsistent UX.
    console.log('[FIND-DS] findDuckStation() called');
    const easyArcBinary = this.getEasyArcDuckStationBinary();
    console.log('[FIND-DS] EasyArc binary path:', easyArcBinary);
    const easyArcBinaryExists = fs.existsSync(easyArcBinary);
    console.log('[FIND-DS] EasyArc binary exists?:', easyArcBinaryExists);
    if (easyArcBinaryExists) return { found: true, path: easyArcBinary };
    // Fall back to standard locations if our copy isn't installed yet.
    const locations = DUCKSTATION_LOCATIONS[process.platform] || [];
    console.log('[FIND-DS] Checking fallback locations:', locations);
    for (const loc of locations) {
      const exists = fs.existsSync(loc);
      console.log('[FIND-DS]   ' + loc + ' exists?:', exists);
      if (exists) return { found: true, path: loc };
    }
    console.log('[FIND-DS] Not found in any location');
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
    let coreFile = SYSTEM_CORES[system];
    if (!coreFile) return false;
    // FIX_2026-06-13_RETROARCH_WIN_PORT: SYSTEM_CORES stores Mac .dylib names; the file on
    // Windows is .dll. Without this swap, coreExists never finds the core on Windows and the
    // "download plugin?" modal reappears on every launch (download itself is correctly skipped
    // by installCore, which already does the swap).
    if (process.platform === 'win32') coreFile = coreFile.replace(/\.dylib$/, '.dll');
    return fs.existsSync(path.join(CORES_PATH, coreFile));
  }

  async installCore(system) {
    let coreFile = SYSTEM_CORES[system];
    if (!coreFile) return { success: false, error: 'No core mapped for system: ' + system };
    if (process.platform === 'win32') coreFile = coreFile.replace(/\.dylib$/, '.dll');

    const corePath = path.join(CORES_PATH, coreFile);
    if (fs.existsSync(corePath)) return { success: true, already: true };

    // FIX_2026-06-13_RETROARCH_WIN_PORT: platform-correct buildbot URL + extraction.
    const isWin = process.platform === 'win32';
    let url;
    if (isWin) {
      url = 'https://buildbot.libretro.com/nightly/windows/x86_64/latest/' + coreFile + '.zip';
    } else {
      const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
      url = 'https://buildbot.libretro.com/nightly/apple/osx/' + arch + '/latest/' + coreFile + '.zip';
    }
    console.log('[Bridge] Core download URL:', url);
    const zipPath = corePath + '.zip';

    try { fs.mkdirSync(CORES_PATH, { recursive: true }); } catch(e) {}

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
          // Windows has no `unzip`; use PowerShell Expand-Archive (as installDuckStation does).
          let cmd, args;
          if (isWin) {
            cmd = 'powershell';
            args = ['-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${CORES_PATH}" -Force`];
          } else {
            cmd = 'unzip';
            args = ['-o', zipPath, '-d', CORES_PATH];
          }
          const unzip = spawn(cmd, args, { stdio: 'ignore' });
          unzip.on('exit', (code) => {
            try { fs.unlinkSync(zipPath); } catch(e) {}
            if (fs.existsSync(corePath)) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: 'Core file not found after extraction' });
            }
          });
          unzip.on('error', (err) => {
            resolve({ success: false, error: 'Extraction failed: ' + err.message });
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

  _matchFolderHint(folderPath) {
    // Shared word-boundary-safe hint matcher used by both _detectSystem and scanCollection
    // Check ALL path segments so games in subfolders are correctly identified
    const fullPath = folderPath.toLowerCase();
    const segments = fullPath.split(/[\/\\]/).filter(Boolean);  // Windows port: split on both / and \
    for (const hint of FOLDER_HINTS) {
      if (hint.hints.some(h => {
        // For short hints (3 chars or less) — exact match against ANY path segment
        if (h.length <= 3) return segments.some(seg => seg === h);
        // For longer hints — word boundary check against full path
        const idx = fullPath.indexOf(h);
        if (idx === -1) return false;
        const before = idx === 0 || !/[a-z0-9]/.test(fullPath[idx-1]);
        const after = idx+h.length >= fullPath.length || !/[a-z0-9]/.test(fullPath[idx+h.length]);
        return before && after;
      })) {
        return hint.system;
      }
    }
    return null;
  }

  _detectSystem(fullPath, ext) {
    // 1. Check unique extensions first — no ambiguity
    for (const [system, exts] of Object.entries(UNIQUE_EXTENSIONS)) {
      if (exts.includes(ext)) return system;
    }

    // 2. For shared extensions, use folder hints to resolve
    if (SHARED_EXTENSIONS[ext]) {
      const folderName = path.dirname(fullPath).toLowerCase();
      const system = this._matchFolderHint(folderName);
      if (system && SHARED_EXTENSIONS[ext].includes(system)) return system;
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
      'input_libretro_device_p3 = "' + deviceTypes.p2 + '"',
      'input_libretro_device_p4 = "' + deviceTypes.p2 + '"',
      'input_libretro_device_p5 = "1"',
      'input_libretro_device_p6 = "1"',
      'input_libretro_device_p7 = "1"',
      'input_libretro_device_p8 = "1"',
      'input_player1_analog_dpad_mode = "' + analogModes.p1 + '"',
      'input_player2_analog_dpad_mode = "' + analogModes.p2 + '"',
      'input_player3_analog_dpad_mode = "' + analogModes.p2 + '"',
      'input_player4_analog_dpad_mode = "' + analogModes.p2 + '"',
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

  writeXInputFallback() {
    const autoconfigDir = path.join(os.homedir(), 'Library/Application Support/RetroArch/autoconfig');
    try { fs.mkdirSync(autoconfigDir, { recursive: true }); } catch(e) {}
    const fallbackPath = path.join(autoconfigDir, 'Generic_XInput_Fallback.cfg');
    const content = [
      'input_driver = "udev"',
      'input_device = "Generic XInput Fallback"',
      'input_b_btn = "0"',
      'input_y_btn = "2"',
      'input_select_btn = "6"',
      'input_start_btn = "7"',
      'input_up_btn = "h0up"',
      'input_down_btn = "h0down"',
      'input_left_btn = "h0left"',
      'input_right_btn = "h0right"',
      'input_a_btn = "1"',
      'input_x_btn = "3"',
      'input_l_btn = "4"',
      'input_r_btn = "5"',
      'input_l2_axis = "+2"',
      'input_r2_axis = "+5"',
      'input_l3_btn = "9"',
      'input_r3_btn = "10"',
      'input_l_x_plus_axis = "+0"',
      'input_l_x_minus_axis = "-0"',
      'input_l_y_plus_axis = "+1"',
      'input_l_y_minus_axis = "-1"',
      'input_r_x_plus_axis = "+3"',
      'input_r_x_minus_axis = "-3"',
      'input_r_y_plus_axis = "+4"',
      'input_r_y_minus_axis = "-4"',
    ].join('\n');
    try {
      fs.writeFileSync(fallbackPath, content);
      console.log('[Bridge] Wrote XInput fallback autoconfig');
    } catch(e) {
      console.error('[Bridge] Failed to write XInput fallback autoconfig:', e.message);
    }
  }

  writeRetroArchConfig() {
    // FIX_2026-06-13_RETROARCH_WIN_PORT: Windows writes cfg next to retroarch.exe (triggers
    // portable mode) with :-relative dirs so the tree stays relocatable.
    const cfgPath = process.platform === 'win32'
      ? path.join(RETROARCH_WIN_DIR, 'retroarch.cfg')
      : require('path').join(require('os').homedir(), 'Library/Application Support/RetroArch/retroarch.cfg');
    try {
      let cfg = '';
      const fs = require('fs');
      if (fs.existsSync(cfgPath)) cfg = fs.readFileSync(cfgPath, 'utf8');
      const settings = {
        ...(process.platform === 'win32' ? {
          'libretro_directory': ':\\cores',
          'system_directory': ':\\system',
          'savefile_directory': ':\\saves',
          'savestate_directory': ':\\states'
        } : {}),
        'video_driver': 'gl',
        'input_enable_hotkey': 'nul',
        'input_exit_emulator': 'nul',
        'auto_remaps_enable': 'true',
        'input_player1_analog_dpad_mode': '1',
        'input_player2_analog_dpad_mode': '1',
        'input_player3_analog_dpad_mode': '1',
        'input_player4_analog_dpad_mode': '1',
        // FIX_2026-07-08_MULTIPAD_V3: deterministic pad-to-port pins in connection
        // order. Safe now because config_save_on_exit=false stops RetroArch re-dumping
        // and mutating them (that — not pinning itself — caused the July 1 incident).
        // The scrub below clears any pre-existing pins first, so these four are written
        // fresh every launch. Fixes autodetect collapsing P2's pad onto both ports.
        'input_autodetect_enable': 'true',
        'input_max_users': '8',
        'config_save_on_exit': 'false',
        'input_player1_joypad_index': '0',
        'input_player2_joypad_index': '1',
        'input_player3_joypad_index': '2',
        'input_player4_joypad_index': '3',

        'input_remaps_directory': ':\\remaps',
        'input_menu_toggle': 'nul',
        'input_menu_toggle_btn': 'nul',
        'input_menu_toggle_gamepad_combo': '0',
        // FIX_2026-06-14_RETROARCH_SDL2_CLEAN_EXIT: sdl2 driver (works across DualShock/
        // 8BitDo/GameSir + dongle/Bluetooth/wired) + Select+Start logical quit combo,
        // controller-independent, single press. Proven on ATOPNUC.
        'input_joypad_driver': 'sdl2',
        'input_quit_gamepad_combo': '4',
        'quit_press_twice': 'false',
        'input_pause_toggle': 'nul',
        'input_pause_toggle_btn': 'nul',
        'input_rewind': 'nul',
        'input_rewind_btn': 'nul',
        'input_exit_emulator_btn': 'nul',
        'input_hold_fast_forward_btn': 'nul',
        'ui_companion_start_on_boot': 'false',
        'video_fullscreen': 'true',
        'quit_on_close_content': '2'
      };
      // FIX_2026-07-01_MULTIPAD_V2: scrub stale pad-to-port pins so an orphaned
      // index can never make a controller invisible again.
      cfg = cfg.replace(/^input_player\d+_joypad_index\s*=.*$\n?/gm, '');
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
    this.writeXInputFallback();
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
      if (options.system === 'wii') this.writeWiiConfig(options.controllerName, options.controllerType);
      if (options.system === 'gamecube') this.writeGCPadConfig(options.controllerName, options.controllerType);
      const dolphin = await this.findDolphin();
      if (!dolphin.found) return { success: false, error: 'Dolphin not found. Please install Dolphin first.' };
      console.log('[Bridge] Launching GameCube/Wii game via Dolphin:', options.romPath);
      try {
        this.retroarchProcess = spawn(dolphin.path, ['--batch', '--exec=' + options.romPath], { detached: false, stdio: 'ignore' });
        // Maximize Dolphin window after 3 seconds (handles slow hardware like 2013 Intel MBP)
        setTimeout(() => {
          require('child_process').exec('osascript -e \'tell application "Dolphin" to activate\' -e \'tell application "System Events" to keystroke "f" using {command down, control down}\'');
        }, 3000);
        // FIX_2026-05-22_NO_MINIMIZE: don't hide EasyArc before Dolphin appears.
        // The previous hide() caused brief desktop visibility between EasyArc
        // disappearing and Dolphin's fullscreen window taking over. Letting
        // Dolphin's fullscreen cover EasyArc naturally is cleaner.
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

    // FIX_2026-05-22_DUCKSTATION: PSX games launch via DuckStation instead of RetroArch
    if (options.system === 'psx') {
      console.log('[PSX-LAUNCH] Entered PSX launch branch. romPath:', options.romPath);
      console.log('[PSX-LAUNCH] Calling writeDuckStationConfig()');
      this.writeDuckStationConfig();
      console.log('[PSX-LAUNCH] writeDuckStationConfig() returned');
      console.log('[PSX-LAUNCH] Calling findDuckStation()');
      const duckstation = await this.findDuckStation();
      console.log('[PSX-LAUNCH] findDuckStation returned:', JSON.stringify(duckstation));
      if (!duckstation.found) {
        console.log('[PSX-LAUNCH] DuckStation not found — returning error');
        return { success: false, error: 'DuckStation not found. Please install DuckStation first.' };
      }
      console.log('[Bridge] Launching PSX game via DuckStation:', options.romPath);
      console.log('[PSX-LAUNCH] About to spawn:', duckstation.path, 'with args:', ['-batch', '--', options.romPath]);
      try {
        this.retroarchProcess = spawn(duckstation.path, ['-batch', '--', options.romPath], { detached: false, stdio: 'inherit' });
        console.log('[PSX-LAUNCH] spawn() returned. PID:', this.retroarchProcess && this.retroarchProcess.pid);

        // FIX_2026-06-30_DUCKSTATION_LIFECYCLE (Bug #7): emit game-started / game-exited
        // so the renderer disables nav and the launch guard blocks duplicate launches
        // during play. Without this, __easyarcGameRunning stayed false and A-button
        // presses during gameplay triggered the whoosh sound (input bleed).
        const sendToRenderer = (channel) => {
          try {
            const { BrowserWindow } = require('electron');
            for (const w of BrowserWindow.getAllWindows()) {
              if (!w.isDestroyed()) w.webContents.send(channel);
            }
          } catch (e) { console.log('[PSX-LAUNCH] sendToRenderer ' + channel + ' failed:', e.message); }
        };

        sendToRenderer('game-started');

        const onDuckStationExit = () => {
          if (!this.retroarchProcess) return;
          this.retroarchProcess = null;
          sendToRenderer('game-exited');
          const { BrowserWindow } = require('electron');
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) { wins[0].show(); wins[0].focus(); }
        };

        this.retroarchProcess.on('error', (err) => {
          console.log('[PSX-LAUNCH] spawn error event:', err.message);
          onDuckStationExit();
        });
        this.retroarchProcess.on('spawn', () => {
          console.log('[PSX-LAUNCH] spawn event fired — process actually started');
        });
        this.retroarchProcess.on('exit', () => {
          console.log('[Bridge] DuckStation exited');
          onDuckStationExit();
        });
        return { success: true };
      } catch(err) {
        return { success: false, error: err.message };
      }
    }

    // FIX_2026-06-18_PSP_BRANCH: PSP games launch via standalone PPSSPP instead of
    // RetroArch's ppsspp_libretro core. Without this branch, PSP falls through to the
    // default RetroArch path below — causing BOTH RetroArch and PPSSPP to run when the
    // DevTools launchPPSSPP path is also used. This branch returns, so RetroArch is
    // never started for PSP. Also wires PSP into the UI launch flow (clicking a PSP
    // game now uses PPSSPP). Uses the separate PPSSPPBridge (its own file).
    if (options.system === 'psp' || options.system === 'pspmini') {
      console.log('[Bridge] Launching PSP game via PPSSPP:', options.romPath);
      try {
        const PPSSPPBridge = require('./PPSSPPBridge');
        const ppssppBridge = new PPSSPPBridge();
        const result = await ppssppBridge.launchPPSSPP(options.romPath);

        // FIX_2026-06-19_PSP_LIFECYCLE: explicit game-running lifecycle.
        // The renderer's gamepad nav loop is hard-disabled while a game runs (via the
        // 'game-started' / 'game-exited' IPC events below), instead of relying on
        // window focus/minimize (which proved nondeterministic). This is the single
        // source of truth: main process knows the process state; renderer obeys it.
        // No minimize, no focus juggling — the nav loop is simply OFF during gameplay.
        const sendToRenderer = (channel) => {
          try {
            const { BrowserWindow } = require('electron');
            for (const w of BrowserWindow.getAllWindows()) {
              if (!w.isDestroyed()) w.webContents.send(channel);
            }
          } catch (e) { console.log('[Bridge] sendToRenderer ' + channel + ' failed:', e.message); }
        };

        if (result && result.success && result.proc) {
          // Register in the process guard so duplicate launches are blocked.
          this.retroarchProcess = result.proc;

          // Tell the renderer a game is now running -> it disables nav + launch.
          sendToRenderer('game-started');

          // Bulletproof exit: fire 'game-exited' on EVERY terminal outcome so the
          // renderer can NEVER stay frozen. 'exit' covers normal close, self-quit,
          // user-closes-window, and kill; 'error' covers spawn-side failures. We guard
          // with a 'settled' flag so the renderer is re-enabled exactly once.
          let settled = false;
          const finish = (why) => {
            if (settled) return;
            settled = true;
            console.log('[Bridge] PPSSPP ended (' + why + ') — re-enabling EasyArc nav');
            this.retroarchProcess = null;
            sendToRenderer('game-exited');
          };
          this.retroarchProcess.on('exit',  () => finish('exit'));
          this.retroarchProcess.on('close', () => finish('close'));
          this.retroarchProcess.on('error', (e) => { console.log('[Bridge] PPSSPP proc error:', e.message); finish('error'); });
        } else {
          // Launch failed before a process existed — make sure the renderer is NOT
          // left disabled (we never sent game-started, but be defensive anyway).
          sendToRenderer('game-exited');
        }
        return result;
      } catch (err) {
        console.log('[Bridge] PSP launch error:', err.message);
        // On any thrown error, ensure the renderer is re-enabled.
        try {
          const { BrowserWindow } = require('electron');
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('game-exited');
          }
        } catch (e) {}
        return { success: false, error: 'PPSSPP launch failed: ' + err.message };
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
    let coreFile = SYSTEM_CORES[options.system];
    if (!coreFile) return { success: false, error: 'No core mapped for system: ' + options.system };
    if (process.platform === 'win32') coreFile = coreFile.replace(/\.dylib$/, '.dll');

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

    const sendToRenderer = (channel) => {
      try {
        const { BrowserWindow } = require('electron');
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send(channel);
        }
      } catch (e) { console.log('[Bridge] sendToRenderer ' + channel + ' failed:', e.message); }
    };

    try {
      this.retroarchProcess = spawn(this.retroarchPath, args, { detached: false, stdio: 'ignore' });

      const onRetroArchExit = () => {
        if (!this.retroarchProcess) return;
        this.retroarchProcess = null;
        sendToRenderer('game-exited');
        const { BrowserWindow } = require('electron');
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) { wins[0].show(); wins[0].focus(); }
      };

      this.retroarchProcess.on('error', (err) => {
        console.log('[Bridge] RetroArch spawn error:', err.message);
        onRetroArchExit();
      });

      this.retroarchProcess.on('exit', () => {
        console.log('[Bridge] RetroArch exited');
        onRetroArchExit();
      });

      sendToRenderer('game-started');
      return { success: true, pid: this.retroarchProcess.pid };
    } catch(err) {
      return { success: false, error: err.message };
    }
  }

  writeGCPadConfig(controllerName, controllerType) {
    const dolphinConfigDir = require('path').join(require('os').homedir(), 'Library/Application Support/Dolphin/Config');
    try { require('fs').mkdirSync(dolphinConfigDir, { recursive: true }); } catch(e) {}
    const lower = (controllerName || '').toLowerCase();
    const type = (controllerType || '').toLowerCase();
    let sdlDevice = 'SDL/0/0';
    if (type === 'xbox' || lower.includes('xbox')) sdlDevice = 'SDL/0/Xbox One S Controller';
    else if (type === 'ds4' || type === 'dualsense' || lower.includes('dualshock') || lower.includes('dualsense')) sdlDevice = 'SDL/0/PS4 Controller';
    else if (type === 'switch' || lower.includes('switch pro') || lower.includes('nintendo switch pro')) sdlDevice = 'SDL/0/Nintendo Switch Pro Controller';
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
      const gcpadPath = require('path').join(dolphinConfigDir, 'GCPadNew.ini');
      require('fs').writeFileSync(gcpadPath, gcpadConfig);
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
      const fs = require('fs');

      // Section-aware settings — Dolphin.ini requires keys in correct sections
      const sectionSettings = {
        'Interface': { 'ConfirmStop': 'False' },
        'Graphics': { 'StartFullscreen': 'True' },
        'Core': { 'SIDevice0': '6', 'SIDevice1': '6', 'SIDevice2': '6', 'SIDevice3': '6' }
      };

      let cfg = '';
      if (fs.existsSync(cfgPath)) cfg = fs.readFileSync(cfgPath, 'utf8');

      for (const [section, settings] of Object.entries(sectionSettings)) {
        const sectionHeader = '[' + section + ']';
        if (!cfg.includes(sectionHeader)) cfg += '\n' + sectionHeader + '\n';
        for (const [key, val] of Object.entries(settings)) {
          const line = key + ' = ' + val;
          const regex = new RegExp('^' + key + '\s*=.*$', 'm');
          // Find the section and update/insert within it
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
      console.log('[Bridge] Wrote Dolphin config with section-aware settings');
    } catch(e) {
      console.error('[Bridge] Failed to write Dolphin config:', e.message);
    }
  }

  // FIX_2026-05-22_DUCKSTATION_INSTALL: returns the directory where EasyArc keeps
  // its own copy of DuckStation. Sandboxed to EasyArc's app-data folder so no admin
  // is needed and we have full control over the install.
  getEasyArcDuckStationDir() {
    return process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'easyarc', 'duckstation')
      : path.join(process.env.APPDATA || os.homedir(), 'easyarc', 'duckstation');
  }

  // FIX_2026-05-28_DUCKSTATION_PORTABLE: detect Windows architecture so we pick the
  // correct ARM64 vs x64 build automatically. Returns 'arm64' or 'x64'.
  _getDuckStationArch() {
    return process.arch === 'arm64' ? 'arm64' : 'x64';
  }

  // FIX_2026-05-28_DUCKSTATION_PORTABLE: single source of truth for the portable
  // subfolder under our managed dir. On Windows, every install/find/config path
  // derives from this so they cannot disagree. On Mac/Linux, returns the base dir
  // unchanged (no change in current Mac behavior).
  getEasyArcDuckStationSubdir() {
    const baseDir = this.getEasyArcDuckStationDir();
    if (process.platform === 'win32') {
      return path.join(baseDir, `duckstation-${this._getDuckStationArch()}`);
    }
    return baseDir;
  }

  // Returns the path to the actual DuckStation executable inside our install dir.
  // FIX_2026-05-28_DUCKSTATION_PORTABLE: on Windows, scan the portable subfolder
  // for duckstation-qt-*.exe rather than hardcoding the x64 name — this works for
  // both ARM64 and x64 builds regardless of the exact exe suffix.
  getEasyArcDuckStationBinary() {
    const baseDir = this.getEasyArcDuckStationDir();
    if (process.platform === 'darwin') {
      return path.join(baseDir, 'DuckStation.app', 'Contents', 'MacOS', 'DuckStation');
    } else if (process.platform === 'win32') {
      const subdir = this.getEasyArcDuckStationSubdir();
      // Return a deterministic default path if nothing's installed yet, so callers
      // doing fs.existsSync() get a clean "not installed" answer instead of crashing.
      const defaultPath = path.join(subdir, `duckstation-qt-${this._getDuckStationArch()}-ReleaseLTCG.exe`);
      if (!fs.existsSync(subdir)) return defaultPath;
      try {
        const entries = fs.readdirSync(subdir);
        const match = entries.find(name =>
          name.toLowerCase().startsWith('duckstation-qt-') &&
          name.toLowerCase().endsWith('.exe')
        );
        return match ? path.join(subdir, match) : defaultPath;
      } catch (e) {
        return defaultPath;
      }
    } else {
      return path.join(baseDir, 'duckstation-qt');
    }
  }

  // FIX_2026-05-22_DUCKSTATION_INSTALL: download DuckStation from GitHub release.
  // Returns path to downloaded archive. progressCallback(received, total) for UI.
  // Pinned version — bump periodically as part of EasyArc maintenance.
  async downloadDuckStation(progressCallback) {
    const VERSION = 'latest';  // DuckStation uses a rolling 'latest' tag, not version tags
    // FIX_2026-05-28_DUCKSTATION_PORTABLE: pick the arch-correct Windows archive
    // (arm64 vs x64) so EasyArc works on Parallels/Snapdragon ARM64 as well as x64.
    const filename = process.platform === 'darwin'
      ? 'duckstation-mac-release.zip'
      : process.platform === 'win32'
        ? `duckstation-windows-${this._getDuckStationArch()}-release.zip`
        : 'DuckStation-x64.AppImage';
    const url = `https://github.com/stenzek/duckstation/releases/download/${VERSION}/${filename}`;
    const downloadDir = this.getEasyArcDuckStationDir();
    try { fs.mkdirSync(downloadDir, { recursive: true }); } catch(e) {}
    const downloadPath = path.join(downloadDir, filename);
    console.log('[Bridge] Downloading DuckStation from', url);
    return new Promise((resolve, reject) => {
      const fetchUrl = (urlToFetch) => {
        https.get(urlToFetch, (response) => {
          // GitHub redirects releases to a CDN URL
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            fetchUrl(response.headers.location);
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${response.statusCode}`));
            return;
          }
          const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
          let bytesReceived = 0;
          const fileStream = fs.createWriteStream(downloadPath);
          response.on('data', (chunk) => {
            bytesReceived += chunk.length;
            if (progressCallback) progressCallback(bytesReceived, totalBytes);
          });
          response.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            console.log('[Bridge] DuckStation downloaded to', downloadPath);
            resolve(downloadPath);
          });
          fileStream.on('error', (err) => reject(err));
        }).on('error', (err) => reject(err));
      };
      fetchUrl(url);
    });
  }

  // FIX_2026-05-22_DUCKSTATION_INSTALL: extract the downloaded DuckStation archive
  // into our install directory. Uses unzip on Mac/Linux, Expand-Archive on Windows.
  async installDuckStation(archivePath) {
    // FIX_2026-05-28_DUCKSTATION_PORTABLE: on Windows, extract into the arch-named
    // portable subfolder (the DuckStation zip has no root folder, so a flat extract
    // would scatter files). On Mac/Linux, extract flat into the base dir as before.
    const installDir = process.platform === 'win32'
      ? this.getEasyArcDuckStationSubdir()
      : this.getEasyArcDuckStationDir();
    try { fs.mkdirSync(installDir, { recursive: true }); } catch(e) {}
    console.log('[Bridge] Extracting DuckStation to', installDir);
    return new Promise((resolve, reject) => {
      let cmd, args;
      if (process.platform === 'darwin' || process.platform === 'linux') {
        cmd = 'unzip';
        args = ['-o', archivePath, '-d', installDir];
      } else if (process.platform === 'win32') {
        cmd = 'powershell.exe';
        args = ['-Command', `Expand-Archive -Path "${archivePath}" -DestinationPath "${installDir}" -Force`];
      } else {
        reject(new Error('Unsupported platform'));
        return;
      }
      const proc = spawn(cmd, args, { stdio: 'ignore' });
      proc.on('exit', (code) => {
        if (code === 0) {
          const binary = this.getEasyArcDuckStationBinary();
          if (fs.existsSync(binary)) {
            if (process.platform === 'darwin') {
              try { fs.chmodSync(binary, 0o755); } catch(e) {}
            }
            // FIX_2026-05-28_DUCKSTATION_PORTABLE: write portable.txt next to the exe
            // so DuckStation keeps all user data (settings.ini, BIOS, memcards, etc.)
            // inside the EasyArc-managed folder, not in Documents (which OneDrive may
            // redirect). Windows-only — no-op on Mac/Linux.
            if (process.platform === 'win32') {
              try {
                const portableMarker = path.join(path.dirname(binary), 'portable.txt');
                if (!fs.existsSync(portableMarker)) {
                  fs.writeFileSync(portableMarker, '');
                  console.log('[Bridge] Created DuckStation portable.txt at:', portableMarker);
                }
              } catch (e) {
                console.log('[Bridge] Failed to create DuckStation portable.txt:', e.message);
              }
            }
            try { fs.unlinkSync(archivePath); } catch(e) {}
            console.log('[Bridge] DuckStation installed successfully');
            resolve({ success: true, binary });
          } else {
            reject(new Error(`Extraction completed but binary not found at: ${binary}`));
          }
        } else {
          reject(new Error(`Extraction failed with exit code ${code}`));
        }
      });
      proc.on('error', (err) => reject(err));
    });
  }

  // FIX_2026-06-06_DUCKSTATION_BIOS_COPY: copy PS1 BIOS files from a user-specified
  // directory into DuckStation's portable bios/ subfolder. Replaces the previous
  // approach of writing [BIOS] SearchDirectory to settings.ini (which was writing to
  // the wrong settings.ini path on Windows). With files at DuckStation's default
  // location, DuckStation finds them naturally with no path configuration needed.
  // Also protects user's original BIOS files from accidental modification/deletion.
  copyPSXBiosToPortable(sourceDir) {
    const biosPatterns = [
      /^scph1001\.bin$/i,
      /^scph7001\.bin$/i,
      /^scph7003\.bin$/i,
      /^scph5500\.bin$/i,
      /^scph5501\.bin$/i,
      /^scph5502\.bin$/i,
      /^scph7502\.bin$/i,
      /^ps-30[aej]\.bin$/i,
    ];
    let targetDir;
    if (process.platform === 'win32') {
      targetDir = path.join(this.getEasyArcDuckStationSubdir(), 'bios');
    } else if (process.platform === 'darwin') {
      targetDir = path.join(os.homedir(), 'Library', 'Application Support', 'DuckStation', 'bios');
    } else {
      targetDir = path.join(process.env.APPDATA || os.homedir(), 'DuckStation', 'bios');
    }
    console.log('[BIOS-COPY] Source:', sourceDir);
    console.log('[BIOS-COPY] Target:', targetDir);
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch(e) {
      console.error('[BIOS-COPY] Failed to create target directory:', e.message);
      return { success: false, error: 'Could not create target directory: ' + e.message, copied: 0 };
    }
    let copiedCount = 0;
    const copiedFiles = [];
    try {
      const files = fs.readdirSync(sourceDir);
      console.log('[BIOS-COPY] Found', files.length, 'files in source');
      for (const filename of files) {
        for (const pattern of biosPatterns) {
          if (pattern.test(filename)) {
            const sourcePath = path.join(sourceDir, filename);
            const targetPath = path.join(targetDir, filename);
            try {
              const stats = fs.statSync(sourcePath);
              if (stats.size >= 256 * 1024) {
                fs.copyFileSync(sourcePath, targetPath);
                copiedCount++;
                copiedFiles.push(filename);
                console.log('[BIOS-COPY] Copied', filename, '(' + stats.size + ' bytes)');
              } else {
                console.log('[BIOS-COPY] Skipped', filename, '— too small');
              }
            } catch(e) {
              console.log('[BIOS-COPY] Failed to copy', filename, ':', e.message);
            }
          }
        }
      }
    } catch(e) {
      console.error('[BIOS-COPY] Failed to read source directory:', e.message);
      return { success: false, error: 'Could not read source directory: ' + e.message, copied: copiedCount };
    }
    if (copiedCount === 0) {
      return { success: false, error: 'No valid BIOS files found in source directory', copied: 0 };
    }
    console.log('[BIOS-COPY] Successfully copied', copiedCount, 'BIOS files');
    return { success: true, copied: copiedCount, files: copiedFiles, targetDir };
  }

  // FIX_2026-05-22_DUCKSTATION_INSTALL: scan common locations for PS1 BIOS files.
  // Returns first directory found with a valid BIOS file, or null if none.
  // Validates by canonical filename pattern and file size (>= 256KB).
  async scanForPSXBios() {
    const biosPatterns = [
      /^scph1001\.bin$/i,
      /^scph7001\.bin$/i,
      /^scph7003\.bin$/i,
      /^scph5500\.bin$/i,
      /^scph5501\.bin$/i,
      /^scph5502\.bin$/i,
      /^scph7502\.bin$/i,
      /^ps-30[aej]\.bin$/i,
    ];
    const home = os.homedir();
    const candidates = [
      path.join(home, 'Downloads'),
      path.join(home, 'Documents'),
      home,
      path.join(home, 'Desktop'),
    ];
    if (process.platform === 'darwin') {
      candidates.unshift(path.join(home, 'Library', 'Application Support', 'DuckStation', 'bios'));
    } else if (process.platform === 'win32') {
      // FIX_2026-06-06_SCAN_PSX_BIOS_PATH: check EasyArc's portable DuckStation bios folder,
      // not the non-portable %APPDATA%\DuckStation\bios path. After copyPSXBiosToPortable
      // copies files into the portable location, this scan needs to find them there so the
      // user isn't prompted to browse for BIOS files on every game launch.
      candidates.unshift(path.join(this.getEasyArcDuckStationSubdir(), 'bios'));
    }
    console.log('[BIOS-SCAN] Starting scan. Platform:', process.platform);
    console.log('[BIOS-SCAN] Home dir:', os.homedir());
    console.log('[BIOS-SCAN] Candidates to check:', candidates);
    for (const dir of candidates) {
      const exists = fs.existsSync(dir);
      console.log('[BIOS-SCAN] Checking', dir, '— exists:', exists);
      if (!exists) continue;
      try {
        const files = fs.readdirSync(dir);
        console.log('[BIOS-SCAN]   Found', files.length, 'files in', dir);
        for (const filename of files) {
          for (const pattern of biosPatterns) {
            if (pattern.test(filename)) {
              const fullPath = path.join(dir, filename);
              console.log('[BIOS-SCAN]   Pattern match:', filename, 'in', dir);
              try {
                const stats = fs.statSync(fullPath);
                console.log('[BIOS-SCAN]   Size:', stats.size, 'bytes (need >=', 256 * 1024, ')');
                if (stats.size >= 256 * 1024) {
                  console.log('[BIOS-SCAN] PSX BIOS found:', fullPath);
                  return { found: true, directory: dir, sample: filename };
                }
              } catch(e) {
                console.log('[BIOS-SCAN]   statSync error:', e.message);
              }
            }
          }
        }
      } catch(e) {
        console.error('[BIOS-SCAN] Error scanning', dir, e.message);
      }
    }
    console.log('[BIOS-SCAN] No PSX BIOS found in any candidate directory');
    return { found: false, directory: null };
  }

  writeDuckStationConfig() {
    // FIX_2026-05-22_DUCKSTATION: enforce EasyArc-required settings in DuckStation's
    // settings.ini so the user experience is consistent across platforms and they
    // never have to touch DuckStation's own UI. Section-aware INI edit modeled on
    // writeDolphinConfig pattern. Settings enforced:
    // - ConfirmPowerOff = false (no exit-confirm dialog, Cmd+Q just quits)
    // - StartFullscreen = true (game opens fullscreen immediately)
    // - HideCursorInFullscreen = true (mouse cursor hidden during gameplay)
    // - HideMainWindowWhenRunning = true (DuckStation UI not visible alongside game)
    // - SaveStateOnExit = true (state preserved when user quits — for resume next launch)
    // FIX_2026-05-28_DUCKSTATION_PORTABLE: on Windows, write settings.ini into the
    // portable subfolder so DuckStation (running in portable mode) actually reads it.
    // Previously this wrote to %APPDATA%\\DuckStation\\settings.ini, which a portable
    // DuckStation would IGNORE — silent config failure. Mac path unchanged.
    const cfgPath = process.platform === 'darwin'
      ? require('path').join(require('os').homedir(), 'Library/Application Support/DuckStation/settings.ini')
      : process.platform === 'win32'
        ? require('path').join(this.getEasyArcDuckStationSubdir(), 'settings.ini')
        : require('path').join(process.env.APPDATA || require('os').homedir(), 'DuckStation/settings.ini');
    try {
      const fs = require('fs');
      // FIX_2026-05-23_MKDIR_BRIDGE: ensure DuckStation's AppData folder exists before
      // writing settings.ini. On first launch the directory may not exist yet, causing
      // ENOENT and silent config failure. Use recursive: true so it's a no-op if present.
      fs.mkdirSync(require('path').dirname(cfgPath), { recursive: true });
      const sectionSettings = {
        'Main': {
          'ConfirmPowerOff': 'false',
          'StartFullscreen': 'true',
          'HideCursorInFullscreen': 'true',
          'HideMainWindowWhenRunning': 'true',
          'SaveStateOnExit': 'true',
          // FIX_2026-05-28_DUCKSTATION_WIZARD_SUPPRESS: tell DuckStation the first-run
          // wizard is already complete so it never appears on a fresh portable install.
          'SetupWizardIncomplete': 'false',
        },
        'AutoUpdater': {
          'CheckAtStartup': 'false',
        },
        // FIX_2026-06-06_DUCKSTATION_PAD_BINDINGS: write [Pad1] and [Pad2] sections so
        // controllers work without user having to map them through DuckStation's own UI.
        // Binding strings captured from working DuckStation config on x64 Windows.
        // Same template works for DualShock and XInput families (SDL2 normalizes both to
        // standard A/B/X/Y naming internally regardless of UI display). Pad2 written
        // unconditionally so two-player works automatically when second controller plugged in.
        'Pad1': {
          'Analog': 'SDL-0/Guide',
          'Circle': 'SDL-0/B',
          'Cross': 'SDL-0/A',
          'Down': 'SDL-0/DPadDown',
          'L1': 'SDL-0/LeftShoulder',
          'L2': 'SDL-0/+LeftTrigger',
          'L3': 'SDL-0/LeftStick',
          'LDown': 'SDL-0/+LeftY',
          'LLeft': 'SDL-0/-LeftX',
          'LRight': 'SDL-0/+LeftX',
          'LUp': 'SDL-0/-LeftY',
          'LargeMotor': 'SDL-0/LargeMotor',
          'Left': 'SDL-0/DPadLeft',
          'R1': 'SDL-0/RightShoulder',
          'R2': 'SDL-0/+RightTrigger',
          'R3': 'SDL-0/RightStick',
          'RDown': 'SDL-0/+RightY',
          'RLeft': 'SDL-0/-RightX',
          'RRight': 'SDL-0/+RightX',
          'RUp': 'SDL-0/-RightY',
          'Right': 'SDL-0/DPadRight',
          'Select': 'SDL-0/Back',
          'SmallMotor': 'SDL-0/SmallMotor',
          'Square': 'SDL-0/X',
          'Start': 'SDL-0/Start',
          'Triangle': 'SDL-0/Y',
          'Type': 'AnalogController',
          'Up': 'SDL-0/DPadUp',
        },
        'Pad2': {
          'Analog': 'SDL-1/Guide',
          'Circle': 'SDL-1/B',
          'Cross': 'SDL-1/A',
          'Down': 'SDL-1/DPadDown',
          'L1': 'SDL-1/LeftShoulder',
          'L2': 'SDL-1/+LeftTrigger',
          'L3': 'SDL-1/LeftStick',
          'LDown': 'SDL-1/+LeftY',
          'LLeft': 'SDL-1/-LeftX',
          'LRight': 'SDL-1/+LeftX',
          'LUp': 'SDL-1/-LeftY',
          'LargeMotor': 'SDL-1/LargeMotor',
          'Left': 'SDL-1/DPadLeft',
          'R1': 'SDL-1/RightShoulder',
          'R2': 'SDL-1/+RightTrigger',
          'R3': 'SDL-1/RightStick',
          'RDown': 'SDL-1/+RightY',
          'RLeft': 'SDL-1/-RightX',
          'RRight': 'SDL-1/+RightX',
          'RUp': 'SDL-1/-RightY',
          'Right': 'SDL-1/DPadRight',
          'Select': 'SDL-1/Back',
          'SmallMotor': 'SDL-1/SmallMotor',
          'Square': 'SDL-1/X',
          'Start': 'SDL-1/Start',
          'Triangle': 'SDL-1/Y',
          'Type': 'AnalogController',
          'Up': 'SDL-1/DPadUp',
        },
        // FIX_2026-06-09_DUCKSTATION_EXIT_HOTKEY: bind controller Select+Start to
        // DuckStation's Power Off hotkey so couch/TV users can cleanly exit a PSX
        // game without a keyboard. Combined with -batch (set at launch) and
        // ConfirmPowerOff=false (set above), this quits DuckStation entirely and
        // returns to EasyArc. String captured verbatim from DuckStation's own
        // settings.ini after binding through its UI. SDL naming works identically
        // on Mac and Windows (DuckStation uses the SDL input backend on both).
        // Keyboard defaults (OpenPauseMenu=Escape etc.) are preserved by the
        // section-aware merge below, so a keyboard fallback always remains.
        'Hotkeys': {
          'PowerOff': 'SDL-0/Back & SDL-0/Start',
        }
      };
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
      console.log('[Bridge] Wrote DuckStation config with EasyArc-required settings');
    } catch(e) {
      console.error('[Bridge] Failed to write DuckStation config:', e.message);
    }
  }

  writeWiiConfig(controllerName, controllerType) {
    const dolphinConfigDir = path.join(os.homedir(), 'Library/Application Support/Dolphin/Config');
    try { require('fs').mkdirSync(dolphinConfigDir, { recursive: true }); } catch(e) {}
    const lower = (controllerName || '').toLowerCase();
    const type = (controllerType || '').toLowerCase();
    let sdlDevice = 'SDL/0/0';
    if (type === 'xbox' || lower.includes('xbox')) sdlDevice = 'SDL/0/Xbox One S Controller';
    else if (type === 'ds4' || type === 'dualsense' || lower.includes('054c') || lower.includes('dualshock') || lower.includes('wireless controller')) sdlDevice = 'SDL/0/PS4 Controller';
    else if (type === 'switch' || lower.includes('switch pro') || lower.includes('nintendo switch pro')) sdlDevice = 'SDL/0/Nintendo Switch Pro Controller';
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
    const dir = this._getDefaultArtworkDir();
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
        // Try to detect system from folder name using shared hint matcher
        const detectedSystem = this._matchFolderHint(folderName);
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
    const SS_IDS = {
      gbc: 10, gb: 9, gba: 12, nes: 3, snes: 4, n64: 14, gamecube: 13, wii: 38, mame: 75, mame2003: 75, arcade: 75, atari2600: 26, atari7800: 43, msdos: 135,
      psx: 57, ps2: 58, switch: 203, dreamcast: 23, genesis: 1, jaguar: 27,
      gamegear: 21, mastersystem: 2, saturn: 22, psp: 61, pspmini: 62, ps3: 59
    };
    const systemId = SS_IDS[game.system];
    if (!systemId) {
      console.log('[Bridge] Unsupported system:', game.system);
      return { success: false, error: 'Unsupported system' };
    }
    const artPath = this.getArtworkPath(game);
    const metaPath = artPath.replace(/\.jpg$/i, '.json');
    if (fs.existsSync(artPath) && fs.existsSync(metaPath)) {
      return { success: true, path: artPath, cached: true };
    }
    // PS1: skip BIOS, demo discs, prototypes and preproduction builds
    if (game.system === 'psx') {
      const lower = (game.title || '').toLowerCase();
      const ps1SkipPatterns = [
        '[bios]', '(beta)', '(proto)', '(trial)', '(preproduction)',
        'demo disc', 'euro demo', 'essential playstation',
        'jampack', 'pizza hut', 'interactive cd sampler'
      ];
      if (ps1SkipPatterns.some(p => lower.includes(p))) {
        console.log('[Bridge] Skipping non-game ROM:', game.title);
        return { success: false, error: 'Skipped: non-game ROM' };
      }
    }

    // Atari 2600: skip guaranteed non-matches before any API call
    if (game.system === 'atari2600') {
      const lower = (game.title || '').toLowerCase();
      const skipPatterns = [
        'pd', 'demo', 'hack', 'in-1', 'v0.', 'v1.',
        'test', 'sprite', 'clock', 'frame', 'scroll', 'animation',
        '2001', '2002', '2003',
        '[h1]', '[h2]', '[h3]', '[h4]', '[h5]',
        '(preproduction)', '(prototype)', 'pre-release', 'wip'
      ];
      const shouldSkip = skipPatterns.some(p => lower.includes(p));
      if (shouldSkip) {
        console.log('[Bridge] Skipping non-game ROM:', game.title);
        return { success: false, error: 'Skipped: non-game ROM' };
      }
    }

    const baseParams =
      'devid=dnherrington67&devpassword=LpQS8obmTnC&softname=EasyArc' +
      '&ssid=' + encodeURIComponent(ssUser) +
      '&sspassword=' + encodeURIComponent(ssPassword) +
      '&output=json';
    let jeuData = null;
    // MAME: romnom-based lookup, no hash needed
    if (['mame', 'mame2003', 'mame2010', 'mame2015', 'arcade'].includes(game.system)) {
      try {
        const mameResult = await screenScraperMameLookup(baseParams, game);
        if (mameResult.ok) {
          jeuData = mameResult.jeu;
          console.log('[Bridge] MAME hit:', game.title);
        } else {
          console.log('[Bridge] MAME no match, falling back:', game.title);
          jeuData = null;
        }
      } catch (err) {
        console.log('[Bridge] MAME error:', err.message);
        jeuData = null;
      }
    }
    // Phase 1: CRC + hash lookup
    try {
      const { crc, size } = await getRomCrc(game.path);
      console.log('[Bridge] CRC:', crc, 'size:', size, '|', game.title);
      const hashResult = await screenScraperHashLookup(baseParams, systemId, game, crc, size);
      if (hashResult.ok) {
        jeuData = hashResult.jeu;
        console.log('[Bridge] Hash hit:', game.title);
      } else {
        console.log('[Bridge] Hash lookup failed:', hashResult.reason);
      }
    } catch (err) {
      console.log('[Bridge] CRC/hash error:', err.message);
    }
    // Phase 2: Title fallback
    if (!jeuData) {
      const titleResult = await screenScraperTitleLookup(baseParams, systemId, game);
      if (titleResult.ok) {
        console.log('[Bridge] Title hit:', titleResult.cleanTitle);
        const fullResult = await screenScraperGameIdLookup(baseParams, titleResult.jeu.id);
        jeuData = fullResult.ok ? fullResult.jeu : titleResult.jeu;
        if (!fullResult.ok) console.log('[Bridge] Full metadata fetch failed, using summary');
      } else {
        console.log('[Bridge] No match for:', titleResult.cleanTitle);
        return { success: false, error: 'No match found' };
      }
    }
    // Phase 3: Download media + metadata
    try {
      await downloadArtworkAndMetadata(baseParams, jeuData.id, artPath, metaPath, jeuData);
      if (fs.existsSync(artPath)) {
        return { success: true, path: artPath, cached: false, metadata: jeuData };
      } else {
        return { success: true, partial: true, error: 'No artwork available', metadata: jeuData };
      }
    } catch (err) {
      console.log('[Bridge] Media download failed:', err.message);
      return { success: false, error: 'Media download failed' };
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

  // --- ScraperPipeline integration ---
  async scrapeOne(romEntry) {
    const { systemId, romPath } = romEntry;
    const result = await this.scraper.scrape({
      systemId,
      romPath,
      regionOrder: this.config.regionOrder,
      overrides: {}
    });
    if (this.config.enableScrapeLogs && typeof this.writeScrapeLog === 'function') {
      this.writeScrapeLog(result);
    }
    return result;
  }

  writeScrapeLog(result) {
    try {
      const logDir = this.config.logDir || path.join(process.cwd(), 'logs', 'scraper');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const fileName = `${Date.now()}-${result.gameId || 'unknown'}.json`;
      const full = path.join(logDir, fileName);
      fs.writeFileSync(full, JSON.stringify(result, null, 2));
    } catch {}
  }
}

module.exports = RetroArchBridge;
