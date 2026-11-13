// FIX_2026-11-12_METRICS: anonymous usage ping.
// Sends only: a random install ID, the EasyArc version, the operating system and the event name.
// No names, no file paths, no game lists. Every failure is ignored so EasyArc always starts normally.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

// Set after the Cloudflare Worker is deployed. Until then no ping is sent.
const ENDPOINT = 'https://easyarc-metrics.doug-herrington.workers.dev/ping';
const CONFIG_FILE = 'metrics.json';
const DEV_MARKER = 'easyarc-developer.txt';
const TIMEOUT_MS = 5000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function dataDir() {
  return process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'easyarc')
    : path.join(os.homedir(), 'Library', 'Application Support', 'easyarc');
}

function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dataDir(), CONFIG_FILE), 'utf8'));
    if (c && typeof c === 'object') return c;
  } catch (e) {}
  return {};
}

function writeConfig(c) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(path.join(dataDir(), CONFIG_FILE), JSON.stringify(c, null, 2));
  } catch (e) {}
}

function isEnabled() { return readConfig().enabled !== false; } // on unless the user turned it off

function isDeveloper() {
  try { return fs.existsSync(path.join(dataDir(), DEV_MARKER)); } catch (e) { return false; }
}

function installId() {
  const c = readConfig();
  if (typeof c.id === 'string' && ID_RE.test(c.id)) return c.id;
  c.id = crypto.randomUUID();
  writeConfig(c);
  return c.id;
}

function send(event, version) {
  return new Promise((resolve) => {
    try {
      if (ENDPOINT.includes('REPLACE_ME')) return resolve('not-configured');
      const body = JSON.stringify({ id: installId(), v: String(version || ''), os: process.platform, event });
      const req = https.request(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: TIMEOUT_MS
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('timeout', () => { req.destroy(); });
      req.on('error', () => resolve('error'));
      req.end(body);
    } catch (e) { resolve('error'); }
  });
}

// Called once per launch. Never awaited by startup.
function launchPing(app) {
  try {
    if (!app.isPackaged) return Promise.resolve('dev-build');
    if (!isEnabled()) return Promise.resolve('off');
    if (isDeveloper()) return Promise.resolve('developer');
    return send('launch', app.getVersion()).then((r) => { console.log('[METRICS] launch ping:', r); return r; });
  } catch (e) { return Promise.resolve('error'); }
}

// Advanced toggle. Turning it off sends one final "optout" ping, then nothing more.
function setEnabled(app, on) {
  try {
    const c = readConfig();
    const wasOn = c.enabled !== false;
    c.enabled = !!on;
    writeConfig(c);
    if (wasOn && !on && app.isPackaged && !isDeveloper()) send('optout', app.getVersion()).catch(() => {});
  } catch (e) {}
  return isEnabled();
}

module.exports = { launchPing, setEnabled, isEnabled, _dataDir: dataDir, _send: send };
