// DuckStationBridge.js — DuckStation (PS1) emulator integration for EasyArc
// BACK-END ONLY: architecture detection + auto-download + extract + portable mode.
// No launch logic, no config writing, no BIOS handling, no UI triggers yet.
// Manually invoke ensureDuckStationReady() from DevTools to test.
//
// Mirrors the proven structure of DolphinBridge.js, with three deliberate differences:
//   1. Architecture is auto-detected (process.arch) — no manual ARM64/x64 swap.
//   2. Archive is a .zip (not .7z), so we use the OS's built-in unzip — no 7za.exe.
//   3. The DuckStation zip has NO root folder, so we extract into a dedicated
//      subfolder and locate the executable by scanning (we do not hardcode its name).

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

// DuckStation publishes a rolling "latest" release. These URLs always point at
// the newest build, so there is no version to pin or bump.
//   x64:   https://github.com/stenzek/duckstation/releases/download/latest/duckstation-windows-x64-release.zip
//   arm64: https://github.com/stenzek/duckstation/releases/download/latest/duckstation-windows-arm64-release.zip
const DUCKSTATION_BASE_URL =
  'https://github.com/stenzek/duckstation/releases/download/latest/';

class DuckStationBridge {
  // Returns 'arm64' or 'x64' based on the running Windows architecture.
  // On ARM64 Windows (e.g. Parallels on Apple Silicon, Snapdragon laptops) this
  // returns 'arm64'; on normal Intel/AMD machines (e.g. the Asus) it returns 'x64'.
  _getArch() {
    return process.arch === 'arm64' ? 'arm64' : 'x64';
  }

  // The subfolder name we extract into, keyed by architecture so an ARM64 and an
  // x64 install never collide if a folder is ever carried between machines.
  _getSubfolderName() {
    return `duckstation-${this._getArch()}`;
  }

  // The Windows download filename for the detected architecture.
  _getArchiveFilename() {
    return `duckstation-windows-${this._getArch()}-release.zip`;
  }

  // The full download URL for the detected architecture.
  _getDownloadUrl() {
    return DUCKSTATION_BASE_URL + this._getArchiveFilename();
  }

  // Returns the directory where EasyArc manages its DuckStation install.
  getEasyArcDuckStationDir() {
    return process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'easyarc', 'duckstation')
      : path.join(process.env.APPDATA || os.homedir(), 'easyarc', 'duckstation');
  }

  // The subfolder (inside the managed dir) that the archive is extracted into.
  getEasyArcDuckStationSubdir() {
    return path.join(this.getEasyArcDuckStationDir(), this._getSubfolderName());
  }

  // Locate the DuckStation Qt executable inside the extracted subfolder by scanning,
  // rather than hardcoding a name. The release exe is named like
  // "duckstation-qt-x64-ReleaseLTCG.exe" (Windows) — but the exact suffix can vary by
  // architecture/build, so we match on the stable "duckstation-qt-*.exe" prefix.
  // Returns the full path if found, or null if not present.
  findDuckStationBinary() {
    const subdir = this.getEasyArcDuckStationSubdir();
    if (!fs.existsSync(subdir)) return null;

    if (process.platform === 'win32') {
      let entries;
      try {
        entries = fs.readdirSync(subdir);
      } catch {
        return null;
      }
      const match = entries.find(
        (name) =>
          name.toLowerCase().startsWith('duckstation-qt-') &&
          name.toLowerCase().endsWith('.exe')
      );
      return match ? path.join(subdir, match) : null;
    } else if (process.platform === 'darwin') {
      // Mac build ships as DuckStation.app — left here for future use; not exercised yet.
      const appBin = path.join(subdir, 'DuckStation.app', 'Contents', 'MacOS', 'DuckStation');
      return fs.existsSync(appBin) ? appBin : null;
    } else {
      const linuxBin = path.join(subdir, 'duckstation-qt');
      return fs.existsSync(linuxBin) ? linuxBin : null;
    }
  }

  // Main entry point. Linear flow with logging at each gate. Mirrors ensureDolphinReady().
  async ensureDuckStationReady() {
    console.log('[DUCKSTATION] Checking for existing DuckStation install...');
    console.log('[DUCKSTATION] Detected architecture:', this._getArch());

    const existing = this.findDuckStationBinary();
    if (existing) {
      console.log('[DUCKSTATION] Already installed at:', existing);
      this._ensurePortableMode();
      return { success: true, path: existing, alreadyInstalled: true };
    }

    console.log('[DUCKSTATION] DuckStation not found — downloading...');
    const installDir = this.getEasyArcDuckStationDir();
    const subdir = this.getEasyArcDuckStationSubdir();
    try {
      fs.mkdirSync(subdir, { recursive: true });
    } catch (err) {
      console.log('[DUCKSTATION] Failed to create install dir:', err.message);
      return { success: false, error: 'mkdir failed: ' + err.message };
    }

    const url = this._getDownloadUrl();
    const archivePath = path.join(installDir, this._getArchiveFilename());
    try {
      await this._downloadFile(url, archivePath);
    } catch (err) {
      console.log('[DUCKSTATION] Download failed:', err.message);
      return { success: false, error: 'download failed: ' + err.message };
    }

    const stats = fs.statSync(archivePath);
    console.log('[DUCKSTATION] Download complete. Size:', stats.size, 'bytes');

    // Extract the zip into the dedicated subfolder (the archive has no root folder).
    console.log('[DUCKSTATION] Extracting DuckStation...');
    try {
      await this._extractZip(archivePath, subdir);
    } catch (err) {
      console.log('[DUCKSTATION] Extraction failed:', err.message);
      return { success: false, error: 'extraction failed: ' + err.message };
    }

    // Verify the binary now exists (scan for it).
    const binaryPath = this.findDuckStationBinary();
    if (!binaryPath) {
      console.log('[DUCKSTATION] Extraction completed but executable not found in:', subdir);
      try {
        const contents = fs.readdirSync(subdir);
        console.log('[DUCKSTATION] Contents of subdir:', contents);
      } catch {}
      return { success: false, error: 'duckstation executable not found after extraction in ' + subdir };
    }

    // Put DuckStation into portable mode so all user data stays inside our managed dir.
    this._ensurePortableMode();

    // Clean up the archive — we no longer need it.
    try { fs.unlinkSync(archivePath); } catch {}

    console.log('[DUCKSTATION] DuckStation installed at:', binaryPath);
    return { success: true, path: binaryPath, alreadyInstalled: false };
  }

  // --- helpers ---

  // Mirrors DolphinBridge._downloadFile: follows redirects (GitHub release assets
  // redirect from github.com to release-assets.githubusercontent.com), streams to disk.
  _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const fetchUrl = (urlToFetch, redirectCount) => {
        if (redirectCount > 10) {
          reject(new Error('Too many redirects'));
          return;
        }
        https.get(urlToFetch, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            console.log('[DUCKSTATION] Following redirect to:', response.headers.location);
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
      console.log('[DUCKSTATION] Downloading from:', url);
      fetchUrl(url, 0);
    });
  }

  // Extract a .zip using the OS's built-in tooling — no bundled 7za needed.
  //   Windows: PowerShell Expand-Archive
  //   macOS:   /usr/bin/ditto (handles zip natively, preserves structure)
  //   Linux:   unzip
  async _extractZip(archivePath, outputDir) {
    if (process.platform === 'win32') {
      // -Force overwrites if a partial extract exists. Quotes guard paths with spaces.
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

  // On Windows, write an empty portable.txt next to the executable so DuckStation
  // keeps all user data (settings.ini, bios, memcards, etc.) inside the EasyArc-managed
  // folder rather than touching the user's Documents (which OneDrive may redirect).
  // No-op on Mac for now (Mac is left as-is, consistent with the Dolphin approach).
  _ensurePortableMode() {
    if (process.platform !== 'win32') return;
    try {
      const binaryPath = this.findDuckStationBinary();
      if (!binaryPath) return;
      const portableMarker = path.join(path.dirname(binaryPath), 'portable.txt');
      if (!fs.existsSync(portableMarker)) {
        fs.writeFileSync(portableMarker, '');
        console.log('[DUCKSTATION] Created portable.txt at:', portableMarker);
      }
    } catch (err) {
      console.log('[DUCKSTATION] Failed to create portable.txt:', err.message);
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

module.exports = DuckStationBridge;
