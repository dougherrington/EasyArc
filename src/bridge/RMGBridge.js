// RMGBridge.js — RMG (Rosalie's Mupen GUI / N64) emulator integration for EasyArc
// SLICE 1: download + extract + find exe + launch. NO controller config yet.
// Manually invoke ensureRMGReady() / launchRMG(romPath) from DevTools to test.
//
// Mirrors the proven structure of DuckStationBridge.js and DolphinBridge.js,
// with four RMG-specific differences (all confirmed empirically against v0.9.0):
//   1. PINNED version URL (not a rolling "latest"). Bump RMG_VERSION deliberately.
//   2. Archive is a .zip, so we use the OS's built-in unzip — no 7za.exe (like DuckStation).
//   3. The RMG zip extracts WITH a root folder, so RMG.exe is ONE LEVEL DEEP inside
//      "RMG-Portable-Windows64-v0.9.0\RMG.exe" (like Dolphin's "Dolphin-x64\" layout).
//   4. portable.txt SHIPS INSIDE the zip — so _ensurePortableMode() is a NO-OP /
//      verification only. We do NOT write the marker (RMG is portable as-extracted).
//
// Launch (confirmed via RMG.exe --help):
//   RMG.exe -f -q "rom"   ->  -f fullscreen, -q quit-after-emulation (clean exit)

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

// --- Pinned release -----------------------------------------------------------
// RMG publishes discrete, versioned releases. We pin a known-good version whose
// config format matches our captured controller templates. Bump deliberately.
//
// NOTE: confirm the EXACT asset filename + URL from the v0.9.0 release page:
//   https://github.com/Rosalie241/RMG/releases/tag/v0.9.0
// The local zip is "RMG-Portable-Windows64-v0_9_0.zip"; the GitHub asset name may
// use dots ("v0.9.0") rather than underscores. Set RMG_DOWNLOAD_URL accordingly.
const RMG_VERSION = 'v0.9.0';
const RMG_WIN_FILENAME = 'RMG-Portable-Windows64-v0.9.0.zip'; // <-- VERIFY against release page
const RMG_DOWNLOAD_URL =
  `https://github.com/Rosalie241/RMG/releases/download/${RMG_VERSION}/${RMG_WIN_FILENAME}`;

// The folder name created INSIDE our managed dir when the zip is extracted.
// The RMG zip contains a single root folder; on v0.9.0 it is the archive's base name.
const RMG_ROOT_FOLDER = 'RMG-Portable-Windows64-v0.9.0'; // <-- VERIFY: matches extracted folder

class RMGBridge {
  // Returns the directory where EasyArc manages its RMG install.
  getEasyArcRMGDir() {
    return process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'easyarc', 'rmg')
      : path.join(process.env.APPDATA || os.homedir(), 'easyarc', 'rmg');
  }

  // The extracted root subfolder (inside the managed dir) that contains RMG.exe.
  getEasyArcRMGSubdir() {
    return path.join(this.getEasyArcRMGDir(), RMG_ROOT_FOLDER);
  }

  // Returns the expected full path to RMG's executable.
  // The zip extracts to a root folder, so the exe is one level deep:
  //   <managedDir>/RMG-Portable-Windows64-v0.9.0/RMG.exe
  // RMG is Windows-only for our purposes; Mac/Linux return null (N64 falls back to
  // the existing RetroArch path on non-Windows).
  getEasyArcRMGBinary() {
    if (process.platform !== 'win32') return null;
    // Expand-Archive extracts the zip CONTENTS into the target (no root folder),
    // so RMG.exe sits directly in the managed dir.
    return path.join(this.getEasyArcRMGDir(), 'RMG.exe');
  }

  // Locate RMG.exe. We first check the expected path; if absent (e.g. the root
  // folder name differs slightly for a future version), we scan one level deep
  // for RMG.exe rather than hardcoding blindly.
  findRMGBinary() {
    if (process.platform !== 'win32') return null;

    const expected = this.getEasyArcRMGBinary();
    if (expected && fs.existsSync(expected)) return expected;

    // Fallback: check the managed dir top level, then immediate subfolders.
    const managedDir = this.getEasyArcRMGDir();
    if (!fs.existsSync(managedDir)) return null;
    const topLevel = path.join(managedDir, 'RMG.exe');
    if (fs.existsSync(topLevel)) return topLevel;
    let entries;
    try {
      entries = fs.readdirSync(managedDir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(managedDir, entry.name, 'RMG.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  // Main entry point. Linear flow with logging at each gate.
  // Mirrors ensureDuckStationReady() / ensureDolphinReady().
  async ensureRMGReady() {
    console.log('[RMG] Checking for existing RMG install...');

    if (process.platform !== 'win32') {
      console.log('[RMG] Non-Windows platform — RMG not supported here (use RetroArch fallback).');
      return { success: false, error: 'RMG is Windows-only; use RetroArch N64 fallback' };
    }

    const existing = this.findRMGBinary();
    if (existing) {
      console.log('[RMG] Already installed at:', existing);
      this._ensurePortableMode(existing);
      return { success: true, path: existing, alreadyInstalled: true };
    }

    console.log('[RMG] RMG not found — downloading', RMG_VERSION, '...');
    const installDir = this.getEasyArcRMGDir();
    try {
      fs.mkdirSync(installDir, { recursive: true });
    } catch (err) {
      console.log('[RMG] Failed to create install dir:', err.message);
      return { success: false, error: 'mkdir failed: ' + err.message };
    }

    const archivePath = path.join(installDir, RMG_WIN_FILENAME);
    try {
      await this._downloadFile(RMG_DOWNLOAD_URL, archivePath);
    } catch (err) {
      console.log('[RMG] Download failed:', err.message);
      return { success: false, error: 'download failed: ' + err.message };
    }

    const stats = fs.statSync(archivePath);
    console.log('[RMG] Download complete. Size:', stats.size, 'bytes');

    // Extract the zip into the managed dir. The archive contains its own root
    // folder, so we extract directly into the managed dir (NOT a dedicated
    // subfolder like DuckStation) — the root folder becomes that subfolder.
    console.log('[RMG] Extracting RMG...');
    try {
      await this._extractZip(archivePath, installDir);
    } catch (err) {
      console.log('[RMG] Extraction failed:', err.message);
      return { success: false, error: 'extraction failed: ' + err.message };
    }

    // Verify the binary now exists (one level deep, inside the root folder).
    const binaryPath = this.findRMGBinary();
    if (!binaryPath) {
      console.log('[RMG] Extraction completed but RMG.exe not found under:', installDir);
      try {
        const contents = fs.readdirSync(installDir);
        console.log('[RMG] Contents of managed dir:', contents);
      } catch {}
      return { success: false, error: 'RMG.exe not found after extraction in ' + installDir };
    }

    // RMG ships portable.txt inside the zip, so portable mode is automatic.
    // This call only verifies/logs; it does NOT write the marker.
    this._ensurePortableMode(binaryPath);

    // Clean up the archive — we no longer need it.
    try { fs.unlinkSync(archivePath); } catch {}

    console.log('[RMG] RMG installed at:', binaryPath);
    return { success: true, path: binaryPath, alreadyInstalled: false };
  }

  // Launch an N64 ROM in RMG. SLICE 1: no controller config written yet —
  // RMG uses whatever default/keyboard input it has. Controllers come in later slices.
  //
  // Flags (confirmed via --help):
  //   -f / --fullscreen          launch ROM in fullscreen
  //   -q / --quit-after-emulation  quit RMG when the user exits the game (clean return)
  //
  // Returns { success, pid, proc } on spawn, or { success:false, error } on failure.
  launchRMG(romPath) {
    const binaryPath = this.findRMGBinary();
    if (!binaryPath) {
      console.log('[RMG] launchRMG: RMG not installed.');
      return { success: false, error: 'RMG not installed' };
    }
    if (!romPath || !fs.existsSync(romPath)) {
      console.log('[RMG] launchRMG: ROM not found:', romPath);
      return { success: false, error: 'ROM not found: ' + romPath };
    }

    const args = ['-f', '-q', romPath];
    console.log('[RMG] Launching:', binaryPath, args.join(' '));

    let proc;
    try {
      // cwd set to the exe's own folder so RMG finds its Config/Data/Plugin folders
      // and writes portable config locally (mirrors how Dolphin is launched).
      proc = spawn(binaryPath, args, {
        cwd: path.dirname(binaryPath),
        detached: false,
        stdio: 'ignore',
      });
    } catch (err) {
      console.log('[RMG] Failed to spawn RMG:', err.message);
      return { success: false, error: 'spawn failed: ' + err.message };
    }

    proc.on('error', (err) => {
      console.log('[RMG] Process error:', err.message);
    });
    proc.on('exit', (code) => {
      console.log('[RMG] RMG exited with code', code);
    });

    console.log('[RMG] RMG launched, pid', proc.pid);
    return { success: true, pid: proc.pid, proc };
  }

  // --- helpers ---

  // Follows redirects (GitHub release assets redirect to release-assets.githubusercontent.com),
  // streams to disk. Identical pattern to DuckStation/Dolphin _downloadFile.
  _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const fetchUrl = (urlToFetch, redirectCount) => {
        if (redirectCount > 10) {
          reject(new Error('Too many redirects'));
          return;
        }
        https.get(urlToFetch, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            console.log('[RMG] Following redirect to:', response.headers.location);
            fetchUrl(response.headers.location, redirectCount + 1);
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }
          const file = fs.createWriteStream(destPath);
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
      console.log('[RMG] Downloading from:', url);
      fetchUrl(url, 0);
    });
  }

  // Extract a .zip using the OS's built-in tooling — no bundled 7za needed.
  //   Windows: PowerShell Expand-Archive
  //   macOS:   /usr/bin/ditto
  //   Linux:   unzip
  async _extractZip(archivePath, outputDir) {
    if (process.platform === 'win32') {
      const psCommand =
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${outputDir}' -Force`;
      await this._spawnAndWait('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psCommand,
      ]);
    } else if (process.platform === 'darwin') {
      await this._spawnAndWait('ditto', ['-x', '-k', archivePath, outputDir]);
    } else {
      await this._spawnAndWait('unzip', ['-o', archivePath, '-d', outputDir]);
    }
  }

  // RMG ships portable.txt inside the zip, so portable mode is automatic.
  // This is verification/logging ONLY — we never write the marker (unlike DuckStation).
  _ensurePortableMode(binaryPath) {
    if (process.platform !== 'win32') return;
    try {
      const dir = path.dirname(binaryPath);
      const portableMarker = path.join(dir, 'portable.txt');
      if (fs.existsSync(portableMarker)) {
        console.log('[RMG] portable.txt present (portable mode active):', portableMarker);
      } else {
        // Unexpected for v0.9.0 — log loudly so we notice if a future build drops it.
        console.log('[RMG] WARNING: portable.txt NOT found next to RMG.exe. Config may not stay local.');
      }
    } catch (err) {
      console.log('[RMG] portable mode check failed:', err.message);
    }
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
}

module.exports = RMGBridge;
