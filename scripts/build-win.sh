#!/bin/bash
# FIX_2026-09-30_SDL_NINTENDO: build the Windows installer with the Windows SDL files,
# then restore the Mac SDL files so EasyArc still runs on this Mac.
set -e
cd "$(dirname "$0")/.."
SDL=node_modules/@kmamal/sdl
VER=$(node -p "require('./$SDL/package.json').version")
echo "--- CRC check (look for CRCCheck off):"; tail -3 node_modules/app-builder-lib/templates/nsis/common.nsh
rm -rf "$SDL/dist.mac"; mv "$SDL/dist" "$SDL/dist.mac"
restore() { rm -rf "$SDL/dist"; mv "$SDL/dist.mac" "$SDL/dist"; echo "--- Mac SDL files restored"; }
trap restore EXIT
mkdir "$SDL/dist"
curl -sL -o /tmp/sdlwin.tgz "https://github.com/kmamal/node-sdl/releases/download/v$VER/sdl.node-v$VER-win32-x64.tar.gz"
tar xzf /tmp/sdlwin.tgz -C "$SDL/dist"
echo "--- Windows SDL files:"; ls "$SDL/dist"
rm -rf dist
npx electron-builder --win nsis --x64 --publish never  # FIX_2026-10-11_UPDATER: never upload; releases are published by hand
ls -la dist/
