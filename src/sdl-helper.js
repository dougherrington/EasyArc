// FIX_2026-10-02_SDL_HELPER: SDL runs in this separate, restartable helper process.
// It reads the Nintendo controller (vendor 057e) and posts its state to EasyArc's main process.
// On 'shutdown' it closes the controller and exits, so the next helper gets a fresh SDL start.
process.env.SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS = '1';
const port = process.parentPort;
let sdl;
try { sdl = require('@kmamal/sdl'); }
catch (e) {
  port.postMessage({ type: 'error', error: 'SDL failed to load in helper: ' + String(e && e.message) });
  setTimeout(() => process.exit(1), 200);
  return;
}
let inst = null;
const openNintendo = () => {
  if (inst && !inst.closed) return;
  const dev = sdl.controller.devices.find(d => d.vendor === 0x057e);
  if (!dev) return;
  try {
    inst = sdl.controller.openDevice(dev);
    // These listeners look empty but are required: the SDL package only polls the
    // controller quickly while something is listening. Without them, input lags ~1 second.
    inst.on('axisMotion', () => {});
    inst.on('buttonDown', () => {});
    inst.on('close', () => { inst = null; });
  } catch (e) { inst = null; }
};
openNintendo();
sdl.controller.on('deviceAdd', () => openNintendo());
sdl.controller.on('deviceRemove', () => { if (inst && inst.closed) inst = null; });
const timer = setInterval(() => {
  const on = !!(inst && !inst.closed);
  port.postMessage({ type: 'state', connected: on, buttons: on ? inst.buttons : {}, axes: on ? inst.axes : {} });
}, 16);
port.on('message', (e) => {
  const msg = e && e.data;
  if (msg && msg.type === 'shutdown') {
    clearInterval(timer);
    try { if (inst && !inst.closed) inst.close(); } catch (er) {}
    setTimeout(() => process.exit(0), 50);
  }
});
