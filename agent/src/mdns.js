/**
 * mdns.js — mDNS discovery for _streamdeckpi._tcp services
 * Uses platform-native tools: dns-sd (macOS), avahi-browse (Linux),
 * and a fallback network scan on Windows.
 */

const { exec } = require('child_process');
const os = require('os');

const IS_MAC   = os.platform() === 'darwin';
const IS_WIN   = os.platform() === 'win32';
const IS_LINUX = os.platform() === 'linux';

const SERVICE_TYPE = '_streamdeckpi._tcp';
let _callback = null;
let _proc     = null;
const _devices = new Map(); // host → device

/**
 * Start mDNS browsing. callback(devices) called whenever the list changes.
 */
function start(callback) {
  _callback = callback;

  if (IS_MAC) {
    startMac();
  } else if (IS_LINUX) {
    startLinux();
  } else if (IS_WIN) {
    startWindows();
  }
}

function notify() {
  if (_callback) _callback(Array.from(_devices.values()));
}

// ── macOS — dns-sd ────────────────────────────────────────────

function startMac() {
  // Browse for service registrations
  _proc = exec(`dns-sd -B ${SERVICE_TYPE} local.`);

  _proc.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 7) continue;

      const op   = parts[1]; // Add / Remove
      const name = parts.slice(6).join(' ');

      if (op === 'Add') {
        resolveServiceMac(name);
      } else if (op === 'Remove') {
        _devices.delete(name);
        notify();
      }
    }
  });
}

function resolveServiceMac(name) {
  const proc = exec(`dns-sd -L "${name}" ${SERVICE_TYPE} local.`);
  let resolved = false;

  proc.stdout.on('data', (data) => {
    if (resolved) return;
    const match = data.toString().match(/can be reached at\s+([\w\-\.]+):(\d+)/i);
    if (match) {
      resolved = true;
      proc.kill();
      const host = match[1];
      const port = parseInt(match[2]);
      _devices.set(name, { name, host, port });
      notify();
    }
  });

  setTimeout(() => { if (!resolved) proc.kill(); }, 5000);
}

// ── Linux — avahi-browse ──────────────────────────────────────

function startLinux() {
  _proc = exec(`avahi-browse -rp ${SERVICE_TYPE}`);

  _proc.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      const parts = line.split(';');
      // avahi-browse -rp resolve output:
      // = ; iface ; IPv4 ; name ; type ; domain ; host ; addr ; port ; txt
      if (parts[0] === '=' && parts.length >= 9) {
        const name = parts[3];
        const host = parts[7] || parts[6];
        const port = parseInt(parts[8]);
        if (host && port) {
          _devices.set(name, { name, host, port });
          notify();
        }
      } else if ((parts[0] === '-') && parts.length >= 4) {
        const name = parts[3];
        _devices.delete(name);
        notify();
      }
    }
  });
}

// ── Windows — poll with dns-sd (Bonjour) or fallback scan ─────

function startWindows() {
  // Try dns-sd first (requires Apple Bonjour for Windows)
  exec('where dns-sd', (err) => {
    if (!err) {
      startMac(); // dns-sd syntax is the same on Windows
    } else {
      // Fallback: scan common local IPs for the streamdeck service
      pollNetworkScan();
    }
  });
}

function pollNetworkScan() {
  const http = require('http');
  const nets = os.networkInterfaces();
  const bases = new Set();

  for (const iface of Object.values(nets).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) {
      const parts = iface.address.split('.');
      parts[3] = '';
      bases.add(parts.join('.'));
    }
  }

  const scan = async () => {
    for (const base of bases) {
      for (let i = 1; i < 255; i++) {
        const host = base + i;
        checkHost(host, 7001);
      }
    }
  };

  scan();
  setInterval(scan, 30000);
}

function checkHost(host, port) {
  const http = require('http');
  const req = http.get(`http://${host}:${port}/health`, { timeout: 1000 }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      try {
        const j = JSON.parse(body);
        if (j.status === 'ok') {
          _devices.set(host, { name: `StreamDeck Pi (${host})`, host, port });
          notify();
        }
      } catch {}
    });
  });
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
}

module.exports = { start };
