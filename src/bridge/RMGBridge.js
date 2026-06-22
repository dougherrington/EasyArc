// RMGBridge.js — RMG (Rosalie's Mupen GUI / N64) emulator integration for EasyArc
// SLICE 1: download + extract + find exe + launch.
// SLICE 2: single XInput controller config writer.
//
// Mirrors DuckStationBridge.js / DolphinBridge.js, with RMG-specific differences
// (confirmed empirically against v0.9.0):
//   1. PINNED version URL (not rolling "latest").
//   2. Archive is a .zip -> OS built-in unzip, no 7za (like DuckStation).
//   3. Expand-Archive drops the zip CONTENTS into the target (NO root folder),
//      so RMG.exe sits directly in the managed dir.
//   4. portable.txt SHIPS in the zip -> _ensurePortableMode is verification only.
//
// Launch (confirmed via --help): RMG.exe -f -q "rom"  (fullscreen, quit-after-emulation)

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

const RMG_VERSION = 'v0.9.0';
const RMG_WIN_FILENAME = 'RMG-Portable-Windows64-v0.9.0.zip';
const RMG_DOWNLOAD_URL =
  `https://github.com/Rosalie241/RMG/releases/download/${RMG_VERSION}/${RMG_WIN_FILENAME}`;
const RMG_ROOT_FOLDER = 'RMG-Portable-Windows64-v0.9.0';

class RMGBridge {
  getEasyArcRMGDir() {
    return process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'easyarc', 'rmg')
      : path.join(process.env.APPDATA || os.homedir(), 'easyarc', 'rmg');
  }

  getEasyArcRMGSubdir() {
    return path.join(this.getEasyArcRMGDir(), RMG_ROOT_FOLDER);
  }

  getEasyArcRMGBinary() {
    if (process.platform !== 'win32') return null;
    // Expand-Archive extracts the zip CONTENTS into the target (no root folder),
    // so RMG.exe sits directly in the managed dir.
    return path.join(this.getEasyArcRMGDir(), 'RMG.exe');
  }

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

    console.log('[RMG] Extracting RMG...');
    try {
      await this._extractZip(archivePath, installDir);
    } catch (err) {
      console.log('[RMG] Extraction failed:', err.message);
      return { success: false, error: 'extraction failed: ' + err.message };
    }

    const binaryPath = this.findRMGBinary();
    if (!binaryPath) {
      console.log('[RMG] Extraction completed but RMG.exe not found under:', installDir);
      try {
        const contents = fs.readdirSync(installDir);
        console.log('[RMG] Contents of managed dir:', contents);
      } catch {}
      return { success: false, error: 'RMG.exe not found after extraction in ' + installDir };
    }

    this._ensurePortableMode(binaryPath);

    try { fs.unlinkSync(archivePath); } catch {}

    console.log('[RMG] RMG installed at:', binaryPath);
    return { success: true, path: binaryPath, alreadyInstalled: false };
  }

  // ============================================================================
  // RMG SLICE 2: controller config writer (single XInput controller).
  // Writes Config/mupen64plus.cfg with Profile 0 = the connected XInput controller
  // and Profiles 1-3 = empty ("None"). Surgically replaces ONLY the four
  // [Input Plugin Profile 0..3] sections, preserving all other RMG settings.
  //
  // Verified against RMG v0.9.0 auto-config output (byte-identical profile block):
  //   * RMG ignores the [Input Plugin] "Profiles" line; it uses the PRESENCE of
  //     populated [Profile N] sections. We leave Profiles = "".
  //   * Populated XInput profile uses DevicePath = "XInput#N" (clean index).
  //   * Full button-mapping block written (proven template), not device-only.
  // ============================================================================

  _xinputProfileBody() {
    return "Deadzone = 9\nSensitivity = 100\nPak = 0\nRemoveDuplicateMappings = True\nFilterEventsForButtons = True\nFilterEventsForAxis = True\nA_InputType = \"0\"\nA_Name = \"a\"\nA_Data = \"0\"\nA_ExtraData = \"0\"\nB_InputType = \"0\"\nB_Name = \"x\"\nB_Data = \"2\"\nB_ExtraData = \"0\"\nStart_InputType = \"0\"\nStart_Name = \"start\"\nStart_Data = \"6\"\nStart_ExtraData = \"0\"\nDpadUp_InputType = \"0\"\nDpadUp_Name = \"dpup\"\nDpadUp_Data = \"11\"\nDpadUp_ExtraData = \"0\"\nDpadDown_InputType = \"0\"\nDpadDown_Name = \"dpdown\"\nDpadDown_Data = \"12\"\nDpadDown_ExtraData = \"0\"\nDpadLeft_InputType = \"0\"\nDpadLeft_Name = \"dpleft\"\nDpadLeft_Data = \"13\"\nDpadLeft_ExtraData = \"0\"\nDpadRight_InputType = \"0\"\nDpadRight_Name = \"dpright\"\nDpadRight_Data = \"14\"\nDpadRight_ExtraData = \"0\"\nCButtonUp_InputType = \"1\"\nCButtonUp_Name = \"righty-\"\nCButtonUp_Data = \"3\"\nCButtonUp_ExtraData = \"0\"\nCButtonDown_InputType = \"1\"\nCButtonDown_Name = \"righty+\"\nCButtonDown_Data = \"3\"\nCButtonDown_ExtraData = \"1\"\nCButtonLeft_InputType = \"1\"\nCButtonLeft_Name = \"rightx-\"\nCButtonLeft_Data = \"2\"\nCButtonLeft_ExtraData = \"0\"\nCButtonRight_InputType = \"1\"\nCButtonRight_Name = \"rightx+\"\nCButtonRight_Data = \"2\"\nCButtonRight_ExtraData = \"1\"\nLeftTrigger_InputType = \"0\"\nLeftTrigger_Name = \"leftshoulder\"\nLeftTrigger_Data = \"9\"\nLeftTrigger_ExtraData = \"0\"\nRightTrigger_InputType = \"0\"\nRightTrigger_Name = \"rightshoulder\"\nRightTrigger_Data = \"10\"\nRightTrigger_ExtraData = \"0\"\nZTrigger_InputType = \"1\"\nZTrigger_Name = \"lefttrigger+\"\nZTrigger_Data = \"4\"\nZTrigger_ExtraData = \"1\"\nAnalogStickUp_InputType = \"1\"\nAnalogStickUp_Name = \"lefty-\"\nAnalogStickUp_Data = \"1\"\nAnalogStickUp_ExtraData = \"0\"\nAnalogStickDown_InputType = \"1\"\nAnalogStickDown_Name = \"lefty+\"\nAnalogStickDown_Data = \"1\"\nAnalogStickDown_ExtraData = \"1\"\nAnalogStickLeft_InputType = \"1\"\nAnalogStickLeft_Name = \"leftx-\"\nAnalogStickLeft_Data = \"0\"\nAnalogStickLeft_ExtraData = \"0\"\nAnalogStickRight_InputType = \"1\"\nAnalogStickRight_Name = \"leftx+\"\nAnalogStickRight_Data = \"0\"\nAnalogStickRight_ExtraData = \"1\"\nUseProfile = \"\"\nGameboyRom = \"\"\nGameboySave = \"\"\nHotkey_Shutdown_InputType = \"\"\nHotkey_Shutdown_Name = \"\"\nHotkey_Shutdown_Data = \"\"\nHotkey_Shutdown_ExtraData = \"\"\nHotkey_Exit_InputType = \"\"\nHotkey_Exit_Name = \"\"\nHotkey_Exit_Data = \"\"\nHotkey_Exit_ExtraData = \"\"\nHotkey_SoftReset_InputType = \"\"\nHotkey_SoftReset_Name = \"\"\nHotkey_SoftReset_Data = \"\"\nHotkey_SoftReset_ExtraData = \"\"\nHotkey_HardReset_InputType = \"\"\nHotkey_HardReset_Name = \"\"\nHotkey_HardReset_Data = \"\"\nHotkey_HardReset_ExtraData = \"\"\nHotkey_Resume_InputType = \"\"\nHotkey_Resume_Name = \"\"\nHotkey_Resume_Data = \"\"\nHotkey_Resume_ExtraData = \"\"\nHotkey_Screenshot_InputType = \"\"\nHotkey_Screenshot_Name = \"\"\nHotkey_Screenshot_Data = \"\"\nHotkey_Screenshot_ExtraData = \"\"\nHotkey_LimitFPS_InputType = \"\"\nHotkey_LimitFPS_Name = \"\"\nHotkey_LimitFPS_Data = \"\"\nHotkey_LimitFPS_ExtraData = \"\"\nHotkey_SpeedFactor25_InputType = \"\"\nHotkey_SpeedFactor25_Name = \"\"\nHotkey_SpeedFactor25_Data = \"\"\nHotkey_SpeedFactor25_ExtraData = \"\"\nHotkey_SpeedFactor50_InputType = \"\"\nHotkey_SpeedFactor50_Name = \"\"\nHotkey_SpeedFactor50_Data = \"\"\nHotkey_SpeedFactor50_ExtraData = \"\"\nHotkey_SpeedFactor75_InputType = \"\"\nHotkey_SpeedFactor75_Name = \"\"\nHotkey_SpeedFactor75_Data = \"\"\nHotkey_SpeedFactor75_ExtraData = \"\"\nHotkey_SpeedFactor100_InputType = \"\"\nHotkey_SpeedFactor100_Name = \"\"\nHotkey_SpeedFactor100_Data = \"\"\nHotkey_SpeedFactor100_ExtraData = \"\"\nHotkey_SpeedFactor125_InputType = \"\"\nHotkey_SpeedFactor125_Name = \"\"\nHotkey_SpeedFactor125_Data = \"\"\nHotkey_SpeedFactor125_ExtraData = \"\"\nHotkey_SpeedFactor150_InputType = \"\"\nHotkey_SpeedFactor150_Name = \"\"\nHotkey_SpeedFactor150_Data = \"\"\nHotkey_SpeedFactor150_ExtraData = \"\"\nHotkey_SpeedFactor175_InputType = \"\"\nHotkey_SpeedFactor175_Name = \"\"\nHotkey_SpeedFactor175_Data = \"\"\nHotkey_SpeedFactor175_ExtraData = \"\"\nHotkey_SpeedFactor200_InputType = \"\"\nHotkey_SpeedFactor200_Name = \"\"\nHotkey_SpeedFactor200_Data = \"\"\nHotkey_SpeedFactor200_ExtraData = \"\"\nHotkey_SpeedFactor225_InputType = \"\"\nHotkey_SpeedFactor225_Name = \"\"\nHotkey_SpeedFactor225_Data = \"\"\nHotkey_SpeedFactor225_ExtraData = \"\"\nHotkey_SpeedFactor250_InputType = \"\"\nHotkey_SpeedFactor250_Name = \"\"\nHotkey_SpeedFactor250_Data = \"\"\nHotkey_SpeedFactor250_ExtraData = \"\"\nHotkey_SpeedFactor275_InputType = \"\"\nHotkey_SpeedFactor275_Name = \"\"\nHotkey_SpeedFactor275_Data = \"\"\nHotkey_SpeedFactor275_ExtraData = \"\"\nHotkey_SpeedFactor300_InputType = \"\"\nHotkey_SpeedFactor300_Name = \"\"\nHotkey_SpeedFactor300_Data = \"\"\nHotkey_SpeedFactor300_ExtraData = \"\"\nHotkey_SaveState_InputType = \"\"\nHotkey_SaveState_Name = \"\"\nHotkey_SaveState_Data = \"\"\nHotkey_SaveState_ExtraData = \"\"\nHotkey_LoadState_InputType = \"\"\nHotkey_LoadState_Name = \"\"\nHotkey_LoadState_Data = \"\"\nHotkey_LoadState_ExtraData = \"\"\nHotkey_GSButton_InputType = \"\"\nHotkey_GSButton_Name = \"\"\nHotkey_GSButton_Data = \"\"\nHotkey_GSButton_ExtraData = \"\"\nHotkey_IncreaseSaveStateSlot_InputType = \"\"\nHotkey_IncreaseSaveStateSlot_Name = \"\"\nHotkey_IncreaseSaveStateSlot_Data = \"\"\nHotkey_IncreaseSaveStateSlot_ExtraData = \"\"\nHotkey_DecreaseSaveStateSlot_InputType = \"\"\nHotkey_DecreaseSaveStateSlot_Name = \"\"\nHotkey_DecreaseSaveStateSlot_Data = \"\"\nHotkey_DecreaseSaveStateSlot_ExtraData = \"\"\nHotkey_TakeScreenshot_InputType = \"\"\nHotkey_TakeScreenshot_Name = \"\"\nHotkey_TakeScreenshot_Data = \"\"\nHotkey_TakeScreenshot_ExtraData = \"\"\nHotkey_Mute_InputType = \"\"\nHotkey_Mute_Name = \"\"\nHotkey_Mute_Data = \"\"\nHotkey_Mute_ExtraData = \"\"\nHotkey_IncreaseVolume_InputType = \"\"\nHotkey_IncreaseVolume_Name = \"\"\nHotkey_IncreaseVolume_Data = \"\"\nHotkey_IncreaseVolume_ExtraData = \"\"\nHotkey_DecreaseVolume_InputType = \"\"\nHotkey_DecreaseVolume_Name = \"\"\nHotkey_DecreaseVolume_Data = \"\"\nHotkey_DecreaseVolume_ExtraData = \"\"\nHotkey_FastForward_InputType = \"\"\nHotkey_FastForward_Name = \"\"\nHotkey_FastForward_Data = \"\"\nHotkey_FastForward_ExtraData = \"\"\nHotkey_SpeedLimiter_InputType = \"\"\nHotkey_SpeedLimiter_Name = \"\"\nHotkey_SpeedLimiter_Data = \"\"\nHotkey_SpeedLimiter_ExtraData = \"\"\nHotkey_GoBack_InputType = \"\"\nHotkey_GoBack_Name = \"\"\nHotkey_GoBack_Data = \"\"\nHotkey_GoBack_ExtraData = \"\"\nHotkey_AdvanceFrame_InputType = \"\"\nHotkey_AdvanceFrame_Name = \"\"\nHotkey_AdvanceFrame_Data = \"\"\nHotkey_AdvanceFrame_ExtraData = \"\"\nHotkey_RumblePak_InputType = \"\"\nHotkey_RumblePak_Name = \"\"\nHotkey_RumblePak_Data = \"\"\nHotkey_RumblePak_ExtraData = \"\"\nHotkey_NoPak_InputType = \"\"\nHotkey_NoPak_Name = \"\"\nHotkey_NoPak_Data = \"\"\nHotkey_NoPak_ExtraData = \"\"\nHotkey_Fullscreen_InputType = \"\"\nHotkey_Fullscreen_Name = \"\"\nHotkey_Fullscreen_Data = \"\"\nHotkey_Fullscreen_ExtraData = \"\"\nHotkey_SaveStateSlot0_InputType = \"\"\nHotkey_SaveStateSlot0_Name = \"\"\nHotkey_SaveStateSlot0_Data = \"\"\nHotkey_SaveStateSlot0_ExtraData = \"\"\nHotkey_SaveStateSlot1_InputType = \"\"\nHotkey_SaveStateSlot1_Name = \"\"\nHotkey_SaveStateSlot1_Data = \"\"\nHotkey_SaveStateSlot1_ExtraData = \"\"\nHotkey_SaveStateSlot2_InputType = \"\"\nHotkey_SaveStateSlot2_Name = \"\"\nHotkey_SaveStateSlot2_Data = \"\"\nHotkey_SaveStateSlot2_ExtraData = \"\"\nHotkey_SaveStateSlot3_InputType = \"\"\nHotkey_SaveStateSlot3_Name = \"\"\nHotkey_SaveStateSlot3_Data = \"\"\nHotkey_SaveStateSlot3_ExtraData = \"\"\nHotkey_SaveStateSlot4_InputType = \"\"\nHotkey_SaveStateSlot4_Name = \"\"\nHotkey_SaveStateSlot4_Data = \"\"\nHotkey_SaveStateSlot4_ExtraData = \"\"\nHotkey_SaveStateSlot5_InputType = \"\"\nHotkey_SaveStateSlot5_Name = \"\"\nHotkey_SaveStateSlot5_Data = \"\"\nHotkey_SaveStateSlot5_ExtraData = \"\"\nHotkey_SaveStateSlot6_InputType = \"\"\nHotkey_SaveStateSlot6_Name = \"\"\nHotkey_SaveStateSlot6_Data = \"\"\nHotkey_SaveStateSlot6_ExtraData = \"\"\nHotkey_SaveStateSlot7_InputType = \"\"\nHotkey_SaveStateSlot7_Name = \"\"\nHotkey_SaveStateSlot7_Data = \"\"\nHotkey_SaveStateSlot7_ExtraData = \"\"\nHotkey_SaveStateSlot8_InputType = \"\"\nHotkey_SaveStateSlot8_Name = \"\"\nHotkey_SaveStateSlot8_Data = \"\"\nHotkey_SaveStateSlot8_ExtraData = \"\"\nHotkey_SaveStateSlot9_InputType = \"\"\nHotkey_SaveStateSlot9_Name = \"\"\nHotkey_SaveStateSlot9_Data = \"\"\nHotkey_SaveStateSlot9_ExtraData = \"\"\nHotkey_MemoryPak_InputType = \"\"\nHotkey_MemoryPak_Name = \"\"\nHotkey_MemoryPak_Data = \"\"\nHotkey_MemoryPak_ExtraData = \"\"";
  }

  _emptyProfileBody() {
    return this._xinputProfileBody()
      .replace(/^(A_InputType = )"0"/m, '$1""')
      .replace(/(_InputType = )"[^"]*"/g, '$1""')
      .replace(/(_Name = )"[^"]*"/g, '$1""')
      .replace(/(_Data = )"[^"]*"/g, '$1""')
      .replace(/(_ExtraData = )"[^"]*"/g, '$1""')
      .replace(/^(Deadzone = )9/m, '$19')
      .replace(/^(Sensitivity = )100/m, '$1100')
      .replace(/^(Pak = )0/m, '$10');
  }

  _switchProfileBody() {
    return this._xinputProfileBody()
      .replace('A_Name = "a"', 'A_Name = "b"')
      .replace('B_Name = "x"', 'B_Name = "y"');
  }

  _buildProfileSection(profileNum, controller) {
    const header = "[Rosalie's Mupen GUI - Input Plugin Profile " + profileNum + "]";
    let identity, body;
    if (controller && controller.type === 'xinput' && typeof controller.xinputIndex === 'number') {
      identity =
        'PluggedIn = True\n' +
        'DeviceName = "XInput Controller"\n' +
        'DeviceType = 4\n' +
        'DevicePath = "XInput#' + controller.xinputIndex + '"\n' +
        'DeviceSerial = ""';
      body = this._xinputProfileBody();
    } else if (controller && controller.type === 'hid' && controller.devicePath) {
      const name = controller.deviceName || "Controller";
      const serial = controller.deviceSerial || "";
      identity =
        'PluggedIn = True\n' +
        'DeviceName = "' + name + '"\n' +
        'DeviceType = 4\n' +
        'DevicePath = "' + controller.devicePath + '"\n' +
        'DeviceSerial = "' + serial + '"';
      body = (controller.hidLayout === 'switch') ? this._switchProfileBody() : this._xinputProfileBody();
    } else {
      identity =
        'PluggedIn = False\n' +
        'DeviceName = "None"\n' +
        'DeviceType = 0\n' +
        'DevicePath = ""\n' +
        'DeviceSerial = ""';
      body = this._emptyProfileBody();
    }
    return header + '\n\n' + identity + '\n' + body + '\n';
  }

  _buildAllProfiles(controllers) {
    const sections = [];
    for (let port = 0; port < 4; port++) {
      sections.push(this._buildProfileSection(port, controllers[port] || null));
    }
    return sections.join('\n\n');
  }

  matchHidControllers(targets) {
    if (process.platform !== 'win32') return { success: false, error: 'HID matching is Windows-only' };
    let HID;
    try { HID = require('node-hid'); }
    catch (err) { return { success: false, stage: 'require', error: err.message }; }
    let devices;
    try { devices = HID.devices(); }
    catch (err) { return { success: false, stage: 'enumerate', error: err.message }; }
    const results = (targets || []).map((t) => ({
      vendorId: t.vendorId, productId: t.productId,
      controller: this._matchOneHid(devices, t.vendorId, t.productId)
    }));
    return { success: true, results };
  }

  // RMG stores Bluetooth MACs dash-separated (e.g. 03-c4-80-fc-0e-a3); node-hid
  // reports them separatorless (03c480fc0ea3). Match RMG's format for HID binding.
  _formatHidSerial(s) {
    if (!s) return '';
    if (/^[0-9a-fA-F]{12}$/.test(s)) return s.match(/.{1,2}/g).join('-');
    return s;
  }

  // Single source of truth for HID controller-object construction (naming / layout / serial format).
  _hidControllerFromDevice(d) {
    const isSwitch = (d.vendorId === 0x057E);
    const isSony   = (d.vendorId === 0x054C);
    return {
      type: 'hid', devicePath: d.path,
      deviceName: isSwitch ? 'Nintendo Switch Pro Controller'
                : isSony   ? 'PS4 Controller'
                : (d.product || 'Controller'),
      deviceSerial: this._formatHidSerial(d.serialNumber),
      hidLayout: (isSwitch || isSony) ? 'switch' : 'standard'
    };
  }

  _matchOneHid(devices, vendorId, productId) {
    const candidates = devices.filter((d) =>
      d.vendorId === vendorId && d.productId === productId &&
      d.usagePage === 1 && (d.usage === 4 || d.usage === 5)
    );
    if (candidates.length === 0) return null;
    const ctrl = this._hidControllerFromDevice(candidates[0]);
    ctrl._candidateCount = candidates.length;
    return ctrl;
  }

  // SLICE5.3: build a controller object for ONE specific HID device by its path. The join flow
  // needs this because two identical pads share VID/PID and can only be told apart by the exact
  // path (and serial) that fired during press-detection.
  matchHidByPath(path) {
    if (process.platform !== 'win32') return { success: false, error: 'HID matching is Windows-only' };
    let HID;
    try { HID = require('node-hid'); }
    catch (err) { return { success: false, stage: 'require', error: err.message }; }
    let devices;
    try { devices = HID.devices(); }
    catch (err) { return { success: false, stage: 'enumerate', error: err.message }; }
    const d = devices.find(dv => dv.path === path);
    if (!d) return { success: false, error: 'path not found in current device list' };
    return { success: true, controller: this._hidControllerFromDevice(d) };
  }

  // SLICE5.4: re-resolve a cached HID controller by its (stable) serial to its CURRENT path.
  matchHidBySerial(serial) {
    if (process.platform !== 'win32') return { success: false, error: 'HID matching is Windows-only' };
    let HID;
    try { HID = require('node-hid'); }
    catch (err) { return { success: false, stage: 'require', error: err.message }; }
    let devices;
    try { devices = HID.devices(); }
    catch (err) { return { success: false, stage: 'enumerate', error: err.message }; }
    const want = (serial || '').replace(/-/g, '').toLowerCase();
    const d = devices.find(dv => {
      if (!dv.serialNumber) return false;
      if (dv.usagePage !== 1 || !(dv.usage === 4 || dv.usage === 5)) return false;
      return dv.serialNumber.replace(/-/g, '').toLowerCase() === want;
    });
    if (!d) return { success: false, error: 'serial not found among connected HID gamepads' };
    return { success: true, controller: this._hidControllerFromDevice(d) };
  }

  getRMGConfigPath() {
    return path.join(this.getEasyArcRMGDir(), 'Config', 'mupen64plus.cfg');
  }

  writeControllerConfig(controllers) {
    if (process.platform !== 'win32') {
      return { success: false, error: 'RMG controller config is Windows-only' };
    }
    const cfgPath = this.getRMGConfigPath();
    if (!fs.existsSync(cfgPath)) {
      console.log('[RMG] writeControllerConfig: config not found at', cfgPath);
      return { success: false, error: 'mupen64plus.cfg not found (RMG must run once to create it): ' + cfgPath };
    }

    let cfg;
    try {
      cfg = fs.readFileSync(cfgPath, 'utf8');
    } catch (err) {
      return { success: false, error: 'read failed: ' + err.message };
    }

    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(cfgPath + '.easyarc_bak_' + stamp, cfg);
    } catch (err) {
      console.log('[RMG] backup warning:', err.message);
    }

    const profile0Header = "[Rosalie's Mupen GUI - Input Plugin Profile 0]";
    const coreHeader = "[Rosalie's Mupen GUI Core]";
    const startIdx = cfg.indexOf(profile0Header);
    const endIdx = cfg.indexOf(coreHeader);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      return { success: false, error: 'profile section boundaries not found in config; no changes made' };
    }

    const before = cfg.slice(0, startIdx);
    const after = cfg.slice(endIdx);
    const newProfiles = this._buildAllProfiles(controllers);
    const rebuilt = before + newProfiles + '\n\n' + after;

    try {
      fs.writeFileSync(cfgPath, rebuilt);
    } catch (err) {
      return { success: false, error: 'write failed: ' + err.message };
    }

    console.log('[RMG] Controller config written to', cfgPath);
    return { success: true, path: cfgPath };
  }

  launchRMG(romPath, controllers) {
    const binaryPath = this.findRMGBinary();
    if (!binaryPath) {
      console.log('[RMG] launchRMG: RMG not installed.');
      return { success: false, error: 'RMG not installed' };
    }
    if (!romPath || !fs.existsSync(romPath)) {
      console.log('[RMG] launchRMG: ROM not found:', romPath);
      return { success: false, error: 'ROM not found: ' + romPath };
    }

    // SLICE 2: write controller config before launch. If no controllers passed,
    // default to a single XInput controller on port 0 (XInput#0) for testing.
    const ctrls = controllers || [{ type: 'xinput', xinputIndex: 0 }];
    const cfgResult = this.writeControllerConfig(ctrls);
    if (!cfgResult.success) {
      console.log('[RMG] WARNING: controller config not written:', cfgResult.error);
    }

    const args = ['-f', '-q', romPath];
    console.log('[RMG] Launching:', binaryPath, args.join(' '));

    let proc;
    try {
      proc = spawn(binaryPath, args, {
        cwd: path.dirname(binaryPath),
        detached: false,
        stdio: 'ignore',
      });
    } catch (err) {
      console.log('[RMG] Failed to spawn RMG:', err.message);
      return { success: false, error: 'spawn failed: ' + err.message };
    }

    // SLICE4_LIFECYCLE_2026-06-21: mirror PPSSPP/RetroArch game-running lifecycle so the
    // renderer's gamepad nav loop is hard-disabled during play (stops input bleed-through
    // and the relaunch-on-button-press bug). Renderer obeys 'game-started'/'game-exited'.
    const sendToRenderer = (channel) => {
      try {
        const { BrowserWindow } = require('electron');
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send(channel);
        }
      } catch (e) { console.log('[RMG] sendToRenderer ' + channel + ' failed:', e.message); }
    };

    sendToRenderer('game-started');

    let settled = false;
    const finish = (why) => {
      if (settled) return;
      settled = true;
      console.log('[RMG] RMG ended (' + why + ') — re-enabling EasyArc nav');
      sendToRenderer('game-exited');
    };
    proc.on('error', (err) => { console.log('[RMG] Process error:', err.message); finish('error'); });
    proc.on('exit',  (code) => { console.log('[RMG] RMG exited with code', code); finish('exit'); });
    proc.on('close', () => finish('close'));

    console.log('[RMG] RMG launched, pid', proc.pid);
    return { success: true, pid: proc.pid, proc };
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

  _ensurePortableMode(binaryPath) {
    if (process.platform !== 'win32') return;
    try {
      const dir = path.dirname(binaryPath);
      const portableMarker = path.join(dir, 'portable.txt');
      if (fs.existsSync(portableMarker)) {
        console.log('[RMG] portable.txt present (portable mode active):', portableMarker);
      } else {
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
