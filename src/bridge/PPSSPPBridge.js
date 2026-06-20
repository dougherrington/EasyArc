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
      return 'C:\\Users\\dough\\Downloads\\ppsspp_win\\PPSSPPWindows64.exe';
    }
    // Mac/Linux not targeted yet — return a path that simply won't exist so callers
    // get a clean "not found" rather than a crash.
    return path.join('/nonexistent', 'PPSSPPWindows64.exe');
  }

  // STAGE_A: launch a ROM. spawn() with an args array does NOT use a shell, so spaces,
  // ampersands, and parentheses in the ROM filename are safe without quoting.
  // cwd is the PPSSPP folder so it finds its assets/ and DLLs (same reason Dolphin
  // sets cwd to its binary's parent).
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

    const cwd = path.dirname(binaryPath);
    // STAGE_A: --fullscreen only. Clean-exit flag (--escape-exit) deliberately held
    // back until we observe natural exit behavior first.
    const args = [romPath, '--fullscreen'];
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
        resolve({ success: true, pid: proc.pid, proc: proc });
      });
    });
  }
}

module.exports = PPSSPPBridge;
