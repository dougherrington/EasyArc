# Windows Bundled Resources

This directory contains binaries bundled into the EasyArc Windows build via electron-builder's `extraResources` configuration.

## 7za.exe

Standalone 7-Zip command-line extractor. Used by `DolphinBridge.ensureDolphinReady()` to extract Dolphin's .7z archive at runtime.

**Source:** 7-Zip Extra package from https://www.7-zip.org/

**License:** LGPL-2.1-or-later (with unRAR restriction, fine for this use)

**Version pinned:** 7-Zip 24.07 (7z2407-extra.7z) — bump deliberately when needed.

To update: download `7z<version>-extra.7z` from 7-zip.org, extract `x64/7za.exe`, replace this file, verify it runs with `7za.exe` from a Windows command prompt.
