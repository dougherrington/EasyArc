// PPSSPPBridge.js — PPSSPP (PSP) emulator integration for EasyArc
// FIX_2026-06-18_PPSSPP_STAGEA: ROM launch only. Points at the manually-unzipped
// PPSSPP in Downloads on the ATOPNUC for first proof-gate. Bundling/copy-to-appdata
// comes in a later stage. Mirrors the clean DolphinBridge spawn pattern.
//
// PPSSPP needs NO controller config (auto-detects via SDL) and NO config-write for
// fullscreen (passed as a launch flag), so this bridge is far leaner than Dolphin's.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class PPSSPPBridge {
  // STAGE_A: hardcoded test path to the manually-unzipped PPSSPP on the ATOPNUC.
  // Replaced by bundled/app-data resolution in a later stage.
  getPPSSPPBinary() {
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || require('os').homedir();
      return require('path').join(appData, 'easyarc', 'ppsspp', 'PPSSPPWindows64.exe');
    }
    // Mac/Linux not targeted yet — return a path that simply won't exist so callers
    // get a clean "not found" rather than a crash.
    return path.join('/nonexistent', 'PPSSPPWindows64.exe');
  }

  // STAGE_A: launch a ROM. spawn() with an args array does NOT use a shell, so spaces,
  // ampersands, and parentheses in the ROM filename are safe without quoting.
  // cwd is the PPSSPP folder so it finds its assets/ and DLLs (same reason Dolphin
  // sets cwd to its binary's parent).
  // FIX_2026-10-23_DOLPHIN_PPSSPP_SAVELOAD: Select+R1 save, Select+L1 load.
  // Values captured verbatim from PPSSPP's own controls.ini (20 = XInput, 10 = DInput pad).
  // Only the two lines are touched; everything else (including Exit App) is left alone.
  // Also sets [Control] AllowMappingCombos = True in ppsspp.ini. Never blocks a launch.
  writeSaveLoadHotkeys(ppssppDir) {
    const sysDir = path.join(ppssppDir, 'memstick', 'PSP', 'SYSTEM');
    const keyOf = (l) => l.split('=')[0].trim();

    try {
      const ctlPath = path.join(sysDir, 'controls.ini');
      if (fs.existsSync(ctlPath)) {
        const text = fs.readFileSync(ctlPath, 'utf8');
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const lines = text.split(/\r?\n/);
        const want = [
          ['Save State', '20-103:20-109,10-196:10-195'],
          ['Load State', '10-194:10-196,20-102:20-109']
        ];
        let insertAt = lines.findIndex(l => keyOf(l) === 'Exit App') + 1;
        for (const [key, val] of want) {
          const line = key + ' = ' + val;
          const i = lines.findIndex(l => keyOf(l) === key);
          if (i >= 0) {
            lines[i] = line;
          } else if (insertAt > 0) {
            lines.splice(insertAt, 0, line);
            insertAt++;
          } else {
            console.log('[PPSSPP] controls.ini has no Exit App line; skipped', key);
          }
        }
        fs.writeFileSync(ctlPath, lines.join(eol));
        console.log('[PPSSPP] Save/Load hotkeys written to', ctlPath);
      } else {
        console.log('[PPSSPP] controls.ini not found; hotkeys skipped:', ctlPath);
      }
    } catch (err) {
      console.log('[PPSSPP] controls.ini write failed:', err.message);
    }

    try {
      const iniPath = path.join(sysDir, 'ppsspp.ini');
      if (fs.existsSync(iniPath)) {
        const text = fs.readFileSync(iniPath, 'utf8');
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const lines = text.split(/\r?\n/);
        const start = lines.findIndex(l => l.trim() === '[Control]');
        if (start >= 0) {
          let end = lines.findIndex((l, idx) => idx > start && l.trim().startsWith('['));
          if (end < 0) end = lines.length;
          const i = lines.findIndex((l, idx) => idx > start && idx < end && keyOf(l) === 'AllowMappingCombos');
          if (i >= 0) lines[i] = 'AllowMappingCombos = True';
          else lines.splice(start + 1, 0, 'AllowMappingCombos = True');
        } else {
          lines.push('[Control]', 'AllowMappingCombos = True');
        }
        fs.writeFileSync(iniPath, lines.join(eol));
      } else {
        fs.mkdirSync(sysDir, { recursive: true });
        fs.writeFileSync(iniPath, '[Control]\r\nAllowMappingCombos = True\r\n');
      }
      console.log('[PPSSPP] AllowMappingCombos = True set in', iniPath);
    } catch (err) {
      console.log('[PPSSPP] ppsspp.ini write failed:', err.message);
    }
  }

  async launchPPSSPP(romPath) {
    console.log('[PPSSPP] launchPPSSPP called with romPath:', romPath);

    const binaryPath = this.getPPSSPPBinary();
    console.log('[PPSSPP] Binary path:', binaryPath);

    if (!fs.existsSync(binaryPath)) {
      console.log('[PPSSPP] Binary not found at:', binaryPath);
      return { success: false, error: 'PPSSPP not found at: ' + binaryPath };
    }

    if (!romPath || !fs.existsSync(romPath)) {
      console.log('[PPSSPP] ROM path missing or invalid:', romPath);
      return { success: false, error: 'ROM not found at: ' + romPath };
    }

    // FIX_2026-10-23_DOLPHIN_PPSSPP_SAVELOAD: save/load hotkeys before every launch.
    this.writeSaveLoadHotkeys(path.dirname(binaryPath));
    const cwd = path.dirname(binaryPath);
    // STAGE_A: --fullscreen only. Clean-exit flag (--escape-exit) deliberately held
    // back until we observe natural exit behavior first.
    const args = [romPath, '--fullscreen', '--escape-exit'];
    console.log('[PPSSPP] Spawning with cwd:', cwd, 'args:', args);

    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(binaryPath, args, { cwd, detached: false, stdio: 'ignore' });
      } catch (err) {
        console.log('[PPSSPP] spawn() threw synchronously:', err.message);
        resolve({ success: false, error: 'spawn threw: ' + err.message });
        return;
      }

      let settled = false;
      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        console.log('[PPSSPP] spawn error event:', err.message);
        resolve({ success: false, error: 'spawn error: ' + err.message });
      });

      proc.on('spawn', () => {
        if (settled) return;
        settled = true;
        console.log('[PPSSPP] spawn event fired — PID:', proc.pid);
        // FIX_2026-06-19_PSP_GUARD: return the process handle so launchGame can
        // register it in this.retroarchProcess — engaging the "one game at a time"
        // guard that DuckStation/Dolphin/etc. already use. Without this, pressing a
        // face button during a PSP game re-fires launchGame and spawns duplicate
        // PPSSPP instances (the guard sees retroarchProcess===null and allows it).
        // FIX_2026-07-08_PPSSPP_LIFECYCLE: emit game-started so renderer suppresses
        // input bleed during PSP gameplay. game-exited emitted on process exit.
        try {
          const { BrowserWindow } = require('electron');
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('game-started');
          }
        } catch(e) { console.log('[PPSSPP] game-started send failed:', e.message); }
        proc.on('exit', () => {
          console.log('[PPSSPP] process exited');
          try {
            const { BrowserWindow } = require('electron');
            const wins = BrowserWindow.getAllWindows();
            for (const w of wins) { if (!w.isDestroyed()) w.webContents.send('game-exited'); }
            if (wins.length > 0) { wins[0].show(); wins[0].focus(); }
          } catch(e) { console.log('[PPSSPP] game-exited send failed:', e.message); }
        });
        resolve({ success: true, pid: proc.pid, proc: proc });
      });
    });
  }
}

module.exports = PPSSPPBridge;
