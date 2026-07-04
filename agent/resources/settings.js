let settings = {};
let tokenVisible = false;

async function init() {
  settings = await window.electronAPI.getSettings();

  document.getElementById('host').value         = settings.host  || '';
  document.getElementById('port').value         = settings.port  || 7001;
  document.getElementById('token').value        = settings.token || '';
  document.getElementById('auto-discover').checked = settings.autoDiscover !== false;

  const dot  = document.getElementById('dot');
  const text = document.getElementById('status-text');
  if (settings.connected) {
    dot.className = 'dot ok';
    text.textContent = `Connected to ${settings.host}`;
  } else {
    dot.className = 'dot no';
    text.textContent = 'Not connected';
  }

  renderDiscovered(settings.discovered || []);
}

function renderDiscovered(devices) {
  const el = document.getElementById('discovered-list');
  if (!devices.length) {
    el.innerHTML = '<div class="no-devices">No devices found yet…</div>';
    return;
  }
  el.innerHTML = devices.map(d => `
    <div class="device-item">
      <span>${d.name} <span style="color:#aaa;font-size:11px">${d.host}:${d.port}</span></span>
      <button onclick="useDevice('${d.host}', ${d.port})">Use</button>
    </div>`).join('');
}

function useDevice(host, port) {
  document.getElementById('host').value = host;
  document.getElementById('port').value = port;
}

function toggleToken() {
  tokenVisible = !tokenVisible;
  document.getElementById('token').type = tokenVisible ? 'text' : 'password';
}

function save() {
  window.electronAPI.saveSettings({
    host:         document.getElementById('host').value.trim(),
    port:         parseInt(document.getElementById('port').value) || 7001,
    token:        document.getElementById('token').value.trim(),
    autoDiscover: document.getElementById('auto-discover').checked,
  });
}

init();
