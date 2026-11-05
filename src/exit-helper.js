// FIX_2026-11-05_EXIT_WATCHER: watches every connected controller (except Nintendo ones,
// which the SDL helper owns) while a Cemu or RPCS3 game runs. Holding Select (Back) + Start
// for half a second tells EasyArc's main process to close the game. Runs in its own process
// so it keeps reading the controller while the emulator has the screen.
process.env.SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS = '1';
const port = process.parentPort;
let sdl;
try { sdl = require('@kmamal/sdl'); }
catch (e) {
  port.postMessage({ type: 'error', error: 'SDL failed to load in exit watcher: ' + String(e && e.message) });
  setTimeout(() => process.exit(1), 200);
  return;
}
const open = new Map();
const openAll = () => {
  for (const d of sdl.controller.devices) {
    if (open.has(d.id) || d.vendor === 0x057e) continue;
    try {
      const c = sdl.controller.openDevice(d);
      // Empty listeners keep the SDL package polling quickly (same as sdl-helper.js).
      c.on('buttonDown', () => {});
      c.on('axisMotion', () => {});
      c.on('close', () => open.delete(d.id));
      open.set(d.id, c);
    } catch (e) {}
  }
};
openAll();
sdl.controller.on('deviceAdd', () => openAll());
let heldSince = 0, fired = false;
const timer = setInterval(() => {
  let both = false;
  for (const c of open.values()) {
    if (!c.closed && c.buttons && c.buttons.back && c.buttons.start) { both = true; break; }
  }
  if (both) {
    if (!heldSince) heldSince = Date.now();
    if (!fired && Date.now() - heldSince > 500) { fired = true; port.postMessage({ type: 'exit' }); }
  } else heldSince = 0;
}, 33);
port.on('message', (e) => {
  const msg = e && e.data;
  if (msg && msg.type === 'shutdown') {
    clearInterval(timer);
    for (const c of open.values()) { try { if (!c.closed) c.close(); } catch (er) {} }
    setTimeout(() => process.exit(0), 50);
  }
});
