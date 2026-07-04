/**
 * Pi Stream Deck Agent — Electron main process
 * - Connects to the Pi WebSocket server
 * - Discovers Pi via mDNS (_streamdeckpi._tcp) or manual IP
 * - Authenticates with a security token
 */

const { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain, shell } = require('electron');
const path    = require('path');
const os      = require('os');
const fs      = require('fs');
const ws      = require('ws');
const dns     = require('dns').promises;
const agent   = require('./agent');
const mdns    = require('./mdns');

// ── Single instance ──────────────────────────────────────────

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ── State ─────────────────────────────────────────────────────

let tray        = null;
let settingsWin = null;
let piSocket    = null;
let config      = {};
let reconnectTimer    = null;
let reconnectDelay    = 3000;
let discoveredDevices = []; // [{name, host, port}]

let prefs = {
  host:  '',
  port:  7001,
  token: '',
  autoDiscover: true,
};

// ── App ready ─────────────────────────────────────────────────

app.whenReady().then(() => {
  app.on('window-all-closed', (e) => e.preventDefault());

  createTray();
  prefs = { ...prefs, ...loadPrefs() };

  // Start mDNS discovery
  mdns.start((devices) => {
    discoveredDevices = devices;
    updateTrayMenu();
    // Auto-connect to first discovered device if no manual host set
    if (prefs.autoDiscover && !prefs.host && devices.length > 0 && !isConnected()) {
      autoConnect(devices[0]);
    }
  });

  if (prefs.host) {
    connectToPi(prefs.host, prefs.port, prefs.token);
  }
});

// ── Tray ──────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '..', 'resources', 'tray-icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('StreamDeck Pi Agent');
  updateTrayMenu();
}

function updateTrayMenu(status = 'Not Connected') {
  const discovered = discoveredDevices.map(d => ({
    label: `Connect to ${d.name} (${d.host})`,
    click: () => autoConnect(d),
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'StreamDeck Pi Agent', enabled: false },
    { label: `Status: ${status}`,   enabled: false },
    { type: 'separator' },
    ...(discovered.length > 0
      ? [{ label: 'Discovered Devices:', enabled: false }, ...discovered, { type: 'separator' }]
      : [{ label: 'Searching for devices…', enabled: false }, { type: 'separator' }]
    ),
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => app.exit(0) },
  ]);
  tray.setContextMenu(contextMenu);
}

function isConnected() {
  return piSocket && piSocket.readyState === ws.OPEN;
}

// ── Settings window ───────────────────────────────────────────

function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }

  settingsWin = new BrowserWindow({
    width: 480, height: 440,
    resizable: false,
    title: 'StreamDeck Pi Agent — Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  settingsWin.loadFile(path.join(__dirname, '..', 'resources', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

ipcMain.on('save-settings', (event, data) => {
  prefs = { ...prefs, ...data };
  savePrefs(prefs);
  connectToPi(prefs.host, prefs.port, prefs.token);
  if (settingsWin) settingsWin.close();
});

ipcMain.handle('get-settings', () => ({
  ...prefs,
  discovered: discoveredDevices,
  connected: isConnected(),
}));

// ── mDNS auto-connect ─────────────────────────────────────────

function autoConnect(device) {
  log(`Auto-connecting to ${device.name} at ${device.host}:${device.port}`);
  connectToPi(device.host, device.port, prefs.token);
}

// ── WebSocket connection ───────────────────────────────────────

function connectToPi(host, port, token) {
  clearTimeout(reconnectTimer);

  if (piSocket) {
    piSocket.removeAllListeners();
    piSocket.terminate();
    piSocket = null;
  }

  if (!host) return;

  const url = `ws://${host}:${port}/ws/agent?token=${encodeURIComponent(token || '')}`;
  log(`Connecting to ${url.replace(/token=[^&]+/, 'token=***')}`);
  updateTrayMenu('Connecting…');

  piSocket = new ws.WebSocket(url, {
    headers: {
      'X-Platform': process.platform,
      'X-Hostname': os.hostname(),
    },
  });

  piSocket.on('open', () => {
    reconnectDelay = 3000;
    log('Connected');
    updateTrayMenu(`Connected to ${host}`);
    send({ type: 'status', message: `Agent ready (${os.hostname()})` });
    if (Object.keys(config).length > 0) send({ type: 'config_push', config });
  });

  piSocket.on('message', (data) => {
    try { handleMessage(JSON.parse(data.toString())); }
    catch (e) { log('Bad JSON: ' + e.message); }
  });

  piSocket.on('close', (code) => {
    log(`Disconnected (code=${code})`);
    updateTrayMenu('Disconnected');
    if (code !== 1008) scheduleReconnect(host, port, token); // 1008 = policy violation (bad token)
  });

  piSocket.on('error', (e) => log('WS error: ' + e.message));
}

function scheduleReconnect(host, port, token) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connectToPi(host, port, token), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
}

function send(obj) {
  if (isConnected()) piSocket.send(JSON.stringify(obj));
}

// ── Message handling ──────────────────────────────────────────

async function handleMessage(msg) {
  switch (msg.type) {
    case 'button_press': {
      const { idx, action_type, action, page } = msg;
      log(`Button: page=${page} idx=${idx} ${action_type}="${action}"`);
      try {
        await agent.executeAction(action_type, action);
        send({ type: 'button_feedback', idx, success: true });
      } catch (e) {
        log('Action failed: ' + e.message);
        send({ type: 'button_feedback', idx, success: false, error: e.message });
      }
      break;
    }
    case 'config_push':
      config = msg.config || {};
      break;
  }
}

// ── Prefs ──────────────────────────────────────────────────────

function prefsPath() {
  return path.join(app.getPath('userData'), 'prefs.json');
}

function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(prefsPath(), 'utf8')); }
  catch { return {}; }
}

function savePrefs(p) {
  fs.writeFileSync(prefsPath(), JSON.stringify(p, null, 2));
}

function log(msg) {
  console.log(`[agent] ${msg}`);
}
