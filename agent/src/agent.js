/**
 * agent.js — Action executor
 * Translates Stream Deck button commands into local system actions.
 * Uses @jitsi/robotjs for keyboard/mouse automation.
 */

const { exec, execFile } = require('child_process');
const { shell } = require('electron');
const os = require('os');

let robot = null;
try {
  robot = require('@jitsi/robotjs');
} catch (e) {
  console.warn('[agent] robotjs not available — keyboard/mouse actions disabled:', e.message);
}

const IS_MAC   = os.platform() === 'darwin';
const IS_WIN   = os.platform() === 'win32';
const IS_LINUX = os.platform() === 'linux';

/**
 * Execute a Stream Deck action.
 * @param {string} type  - 'shortcut' | 'launch' | 'media' | 'text' | 'url' | 'script'
 * @param {string} value - Action-specific value
 */
async function executeAction(type, value) {
  switch (type) {
    case 'shortcut': return executeShortcut(value);
    case 'launch':   return executeLaunch(value);
    case 'media':    return executeMedia(value);
    case 'text':     return executeTypeText(value);
    case 'url':      return executeOpenUrl(value);
    case 'script':   return executeScript(value);
    case 'rest':     return executeRestRequest(value);
    case 'rtsp':     return; // handled locally on the Pi display
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

// ── Keyboard shortcuts ─────────────────────────────────────
// Format: "cmd+shift+s" or "ctrl+c" or "f5"

function parseShortcut(str) {
  const parts = str.toLowerCase().split('+').map(s => s.trim());
  const modifiers = [];
  let key = '';

  const modMap = {
    cmd: 'command', command: 'command',
    ctrl: 'control', control: 'control',
    alt: 'alt', option: 'alt',
    shift: 'shift',
    win: 'command', super: 'command',
  };

  for (const part of parts) {
    if (modMap[part]) {
      modifiers.push(modMap[part]);
    } else {
      key = part;
    }
  }

  // Map common key names
  const keyMap = {
    space: 'space', enter: 'enter', return: 'enter',
    backspace: 'backspace', delete: 'delete', del: 'delete',
    esc: 'escape', escape: 'escape',
    tab: 'tab', up: 'up', down: 'down', left: 'left', right: 'right',
    home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown',
    f1: 'f1', f2: 'f2', f3: 'f3', f4: 'f4', f5: 'f5', f6: 'f6',
    f7: 'f7', f8: 'f8', f9: 'f9', f10: 'f10', f11: 'f11', f12: 'f12',
  };

  return { key: keyMap[key] || key, modifiers };
}

async function executeShortcut(str) {
  if (!robot) throw new Error('robotjs not available');
  if (!str) return;

  const { key, modifiers } = parseShortcut(str);
  if (!key) throw new Error(`Invalid shortcut: ${str}`);

  robot.keyTap(key, modifiers);
}

// ── Launch application ─────────────────────────────────────

async function executeLaunch(app) {
  if (!app) return;

  return new Promise((resolve, reject) => {
    let cmd;

    if (IS_MAC) {
      // Accept both app name and full path
      if (app.endsWith('.app') || app.startsWith('/')) {
        cmd = `open "${app.replace(/"/g, '\\"')}"`;
      } else {
        cmd = `open -a "${app.replace(/"/g, '\\"')}"`;
      }
    } else if (IS_WIN) {
      cmd = `start "" "${app.replace(/"/g, '\\"')}"`;
    } else {
      cmd = app; // Linux: run directly
    }

    exec(cmd, (err) => {
      if (err) reject(new Error(`Launch failed: ${err.message}`));
      else resolve();
    });
  });
}

// ── Media controls ─────────────────────────────────────────

const MEDIA_KEYS = {
  play_pause: 'audio_play',
  next:       'audio_next',
  prev:       'audio_prev',
  vol_up:     'audio_vol_up',
  vol_down:   'audio_vol_down',
  mute:       'audio_mute',
};

async function executeMedia(command) {
  if (!robot) throw new Error('robotjs not available');

  const key = MEDIA_KEYS[command];
  if (!key) throw new Error(`Unknown media command: ${command}`);

  robot.keyTap(key);
}

// ── Type text ──────────────────────────────────────────────

async function executeTypeText(text) {
  if (!robot) throw new Error('robotjs not available');
  if (!text) return;

  // Small delay to ensure focus is on target window
  await delay(100);
  robot.typeString(text);
}

// ── Open URL ───────────────────────────────────────────────

async function executeOpenUrl(url) {
  if (!url) return;
  await shell.openExternal(url);
}

// ── Run script ─────────────────────────────────────────────

async function executeScript(script) {
  if (!script) return;

  return new Promise((resolve, reject) => {
    const shell = IS_WIN ? 'cmd' : '/bin/sh';
    const flag  = IS_WIN ? '/c'  : '-c';

    exec(script, { shell: IS_WIN ? undefined : '/bin/sh', timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Script failed: ${err.message}\n${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ── REST HTTP request ──────────────────────────────────────

async function executeRestRequest(valueStr) {
  let parsed;
  try { parsed = JSON.parse(valueStr); }
  catch { throw new Error('REST action has invalid JSON config'); }

  const { method = 'GET', url, body = '', headers = {} } = parsed;
  if (!url) throw new Error('REST action missing URL');

  const options = {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body && !['GET', 'HEAD'].includes(options.method)) {
    options.body = body;
  }

  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
}

// ── Helpers ────────────────────────────────────────────────

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { executeAction };
