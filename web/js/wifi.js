/**
 * wifi.js — WiFi management UI logic
 */

let _connectingSSID = '';

async function wifiScan() {
  const btn = document.getElementById('wifi-scan-btn');
  btn.style.opacity = '0.5';
  document.getElementById('wifi-list').innerHTML = '<div class="wifi-loading">Scanning…</div>';

  try {
    const r = await fetch('/api/wifi/scan');
    const data = await r.json();
    renderWifiList(data);
  } catch {
    document.getElementById('wifi-list').innerHTML =
      '<div class="wifi-loading">Scan failed — check connection</div>';
  } finally {
    btn.style.opacity = '';
  }
}

async function wifiStatus() {
  try {
    const r = await fetch('/api/wifi/status');
    const data = await r.json();
    renderWifiList(data);
  } catch {}
}

function renderWifiList(data) {
  const currentEl = document.getElementById('wifi-current');
  const ssidEl    = document.getElementById('wifi-current-ssid');
  const listEl    = document.getElementById('wifi-list');

  if (data.current) {
    currentEl.style.display = '';
    ssidEl.textContent = data.current;
  } else {
    currentEl.style.display = 'none';
  }

  const others = (data.networks || []).filter(n => n.ssid !== data.current);
  if (!others.length) {
    listEl.innerHTML = '<div class="wifi-loading">No networks found</div>';
    return;
  }

  listEl.innerHTML = others.map(n => {
    const bars  = signalBars(n.signal);
    const lock  = n.security && n.security !== 'none' ? '🔒' : '';
    return `
      <div class="wifi-item" onclick="openWifiDialog('${escAttr(n.ssid)}', '${escAttr(n.security)}')">
        <div class="wifi-signal">${bars}</div>
        <div class="wifi-info">
          <div class="wifi-ssid-name">${escHtml(n.ssid)}</div>
          <div class="wifi-security">${lock} ${escHtml(n.security || 'Open')}</div>
        </div>
        <div class="wifi-arrow">›</div>
      </div>`;
  }).join('');
}

function signalBars(signal) {
  const pct = parseInt(signal) || 0;
  // Return signal icon
  if (pct >= 75) return '▂▄▆█';
  if (pct >= 50) return '▂▄▆<span style="opacity:.3">█</span>';
  if (pct >= 25) return '▂▄<span style="opacity:.3">▆█</span>';
  return '▂<span style="opacity:.3">▄▆█</span>';
}

function openWifiDialog(ssid, security) {
  _connectingSSID = ssid;
  document.getElementById('wifi-dialog-ssid').textContent = ssid;
  document.getElementById('wifi-password').value = '';

  const needsPassword = security && security.toLowerCase() !== 'none' && security !== '';
  document.getElementById('wifi-password').placeholder =
    needsPassword ? 'Password' : 'No password required';

  document.getElementById('wifi-dialog').classList.remove('hidden');
  if (needsPassword) setTimeout(() => document.getElementById('wifi-password').focus(), 100);
}

function closeWifiDialog() {
  document.getElementById('wifi-dialog').classList.add('hidden');
  _connectingSSID = '';
}

async function wifiConnect() {
  const ssid     = _connectingSSID;
  const password = document.getElementById('wifi-password').value;
  closeWifiDialog();

  showToast(`Connecting to ${ssid}…`);

  try {
    const r = await fetch('/api/wifi/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssid, password }),
    });
    const data = await r.json();
    if (data.ok) {
      showToast(`Connected to ${ssid}`);
      wifiStatus();
    } else {
      showToast(`Failed: ${data.error || 'Unknown error'}`);
    }
  } catch {
    showToast('Connection failed');
  }
}

async function wifiDisconnect() {
  showConfirm('Disconnect from current WiFi network?', async () => {
    try {
      await fetch('/api/wifi/disconnect', { method: 'POST' });
      showToast('Disconnected');
      wifiStatus();
    } catch {
      showToast('Failed to disconnect');
    }
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) {
  return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');
}
