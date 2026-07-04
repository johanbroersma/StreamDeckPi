/**
 * ui.js — View management, button rendering, editor UI
 */

// ── View switching ─────────────────────────────────────────

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  if (id === 'wifi') wifiStatus();
}

// ── Settings tabs ──────────────────────────────────────────

function showTab(id) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', b.getAttribute('onclick') === `showTab('${id}')`);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === id);
  });
}

// ── Token ──────────────────────────────────────────────────

let _tokenVisible = true;
let _token = '';

function setToken(tok) {
  _token = tok;
  renderToken();
}

function renderToken() {
  const el = document.getElementById('token-display');
  if (!el) return;
  el.textContent = _tokenVisible ? (_token || '—') : '••••••••••••';
}

function toggleToken() {
  _tokenVisible = !_tokenVisible;
  renderToken();
}

function copyToken() {
  if (!_token) return;
  navigator.clipboard.writeText(_token).then(
    () => showToast('Token copied'),
    () => showToast('Copy failed — long-press to select'),
  );
}

function regenerateToken() {
  showConfirm('Generate a new token? The current agent will be disconnected.', () => {
    WS._send({ type: 'token_regenerate' });
  });
}

function showDownloadPage() {
  window.open('/download/', '_blank');
}

// ── Camera view ────────────────────────────────────────────

function showCameraView(url, label) {
  document.getElementById('camera-label').textContent = label || '';
  document.getElementById('camera-feed').src =
    '/api/camera/stream?url=' + encodeURIComponent(url);
  showView('camera');
}

function closeCameraView() {
  document.getElementById('camera-feed').src = '';
  showView('app');
}

// ── Toast ──────────────────────────────────────────────────

let _toastTimer = null;
function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.add('hidden'), duration);
}

// ── Confirm dialog ─────────────────────────────────────────

let _confirmCb = null;
function showConfirm(msg, cb) {
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-ok').onclick = () => { closeConfirm(); cb(); };
  document.getElementById('confirm-overlay').classList.remove('hidden');
  _confirmCb = cb;
}
function closeConfirm() {
  document.getElementById('confirm-overlay').classList.add('hidden');
  _confirmCb = null;
}

// ── Status indicator ───────────────────────────────────────

function setStatus(state, label) {
  const dot = document.getElementById('status-indicator');
  const lbl = document.getElementById('status-label');
  dot.className = 'status-dot ' + state;
  lbl.textContent = label;
}

// ── Grid rendering ─────────────────────────────────────────

function renderGrid() {
  const grid = document.getElementById('button-grid');
  const cfg = Config.getGridConfig();
  const page = Config.get('currentPage');
  const total = cfg.total;

  grid.style.gridTemplateColumns = `repeat(${cfg.cols}, 1fr)`;

  // Clear existing buttons
  grid.innerHTML = '';

  for (let i = 0; i < total; i++) {
    const btn = Config.getButton(page, i);
    const el = document.createElement('button');
    el.className = 'deck-btn' + (btn.label || btn.icon ? '' : ' empty');
    el.dataset.idx = i;

    // Custom background color
    if (btn.color && btn.color !== '#ffffff' && btn.label) {
      el.style.background = btn.color;
    }

    const iconEl = document.createElement('span');
    iconEl.className = 'btn-icon';
    iconEl.textContent = btn.icon || (btn.label ? '' : '+');

    const labelEl = document.createElement('span');
    labelEl.className = 'btn-label';
    labelEl.textContent = btn.label || (btn.icon ? '' : 'Add Button');

    el.appendChild(iconEl);
    el.appendChild(labelEl);

    setupLongPress(el, () => handleButtonPress(i), () => openEditor(i));

    grid.appendChild(el);
  }

  updatePageControls();
}

function updatePageControls() {
  const page = Config.get('currentPage');
  const total = Config.pageCount();
  document.getElementById('page-label').textContent =
    `Page ${page + 1}${total > 1 ? ' / ' + total : ''}`;
  document.getElementById('prev-page').disabled = page <= 0;
  document.getElementById('next-page').disabled = page >= total - 1;
}

// ── Long press ─────────────────────────────────────────────

function setupLongPress(el, shortCb, longCb) {
  let timer = null;
  let longFired = false;
  const THRESHOLD = 600; // ms

  const start = (e) => {
    e.preventDefault();
    longFired = false;
    el.classList.add('long-press');
    timer = setTimeout(() => {
      longFired = true;
      el.classList.remove('long-press');
      longCb();
    }, THRESHOLD);
  };

  const end = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      el.classList.remove('long-press');
      if (!longFired) shortCb();
    }
  };

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    longFired = true; // prevent short-press on swipe-away
    el.classList.remove('long-press');
  };

  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', end);
  el.addEventListener('touchmove', cancel);
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', end);
  el.addEventListener('mouseleave', cancel);
}

// ── Page navigation ─────────────────────────────────────────

function changePage(delta) {
  let page = Config.get('currentPage') + delta;
  const total = Config.pageCount();

  if (delta > 0 && page >= total) {
    // Auto-add a page
    Config.addPage();
  }

  page = Math.max(0, Math.min(page, Config.pageCount() - 1));
  Config.set('currentPage', page);
  renderGrid();
}

// ── Button press ───────────────────────────────────────────

function handleButtonPress(idx) {
  const page = Config.get('currentPage');
  const btn = Config.getButton(page, idx);

  if (!btn.label && !btn.icon) {
    openEditor(idx);
    return;
  }

  // Camera streams are handled locally on the Pi display
  if (btn.action_type === 'rtsp' && btn.action) {
    showCameraView(btn.action, btn.label);
    return;
  }

  // Visual feedback
  const el = document.querySelector(`.deck-btn[data-idx="${idx}"]`);
  if (el) {
    el.classList.remove('firing');
    void el.offsetWidth; // reflow
    el.classList.add('firing');
    el.addEventListener('animationend', () => el.classList.remove('firing'), { once: true });
  }

  WS.sendButtonPress(page, idx, btn);
}

function flashButton(idx, success) {
  const el = document.querySelector(`.deck-btn[data-idx="${idx}"]`);
  if (!el) return;
  el.style.outline = `3px solid ${success ? 'var(--success)' : 'var(--danger)'}`;
  setTimeout(() => { el.style.outline = ''; }, 600);
}

// ── Editor ─────────────────────────────────────────────────

let _editingIdx = null;

function openEditor(idx) {
  _editingIdx = idx;
  const page = Config.get('currentPage');
  const btn = Config.getButton(page, idx);

  document.getElementById('edit-label').value   = btn.label   || '';
  document.getElementById('edit-icon').value    = btn.icon    || '';
  document.getElementById('edit-action-type').value = btn.action_type || 'shortcut';

  // Populate action fields
  document.getElementById('edit-shortcut').value = '';
  document.getElementById('edit-launch').value   = '';
  document.getElementById('edit-text').value     = '';
  document.getElementById('edit-url').value      = '';
  document.getElementById('edit-script').value   = '';

  const at = btn.action_type || 'shortcut';
  const av = btn.action || '';
  switch (at) {
    case 'shortcut': document.getElementById('edit-shortcut').value = av; break;
    case 'launch':   document.getElementById('edit-launch').value   = av; break;
    case 'media':    document.getElementById('edit-media').value    = av; break;
    case 'text':     document.getElementById('edit-text').value     = av; break;
    case 'url':      document.getElementById('edit-url').value      = av; break;
    case 'script':   document.getElementById('edit-script').value   = av; break;
    case 'rtsp':     document.getElementById('edit-rtsp').value     = av; break;
    case 'rest': {
      let rest = {};
      try { rest = JSON.parse(av); } catch { /**/ }
      document.getElementById('edit-rest-method').value = rest.method || 'GET';
      document.getElementById('edit-rest-url').value    = rest.url    || '';
      document.getElementById('edit-rest-body').value   = rest.body   || '';
      break;
    }
  }

  updateActionFields();
  buildColorSwatches(btn.color || '#ffffff');
  updatePreview();
  showView('editor');
}

function updateActionFields() {
  const at = document.getElementById('edit-action-type').value;
  const allFields = ['shortcut', 'launch', 'media', 'text', 'url', 'script', 'rtsp', 'rest'];
  allFields.forEach(f => {
    const el = document.getElementById('action-' + f);
    if (el) el.classList.toggle('hidden', f !== at);
  });
}

function updatePreview() {
  document.getElementById('preview-icon').textContent  =
    document.getElementById('edit-icon').value || '?';
  document.getElementById('preview-label').textContent =
    document.getElementById('edit-label').value || 'Button';
}

function buildColorSwatches(selected) {
  const container = document.getElementById('color-swatches');
  container.innerHTML = '';
  BUTTON_COLORS.forEach(color => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (color === selected ? ' selected' : '');
    sw.style.background = color;
    sw.addEventListener('click', () => {
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      document.getElementById('btn-preview').style.background = color;
    });
    container.appendChild(sw);
  });
  document.getElementById('btn-preview').style.background = selected;
}

function saveButton() {
  if (_editingIdx === null) return;

  const at = document.getElementById('edit-action-type').value;
  let action = '';
  switch (at) {
    case 'shortcut': action = document.getElementById('edit-shortcut').value; break;
    case 'launch':   action = document.getElementById('edit-launch').value;   break;
    case 'media':    action = document.getElementById('edit-media').value;    break;
    case 'text':     action = document.getElementById('edit-text').value;     break;
    case 'url':      action = document.getElementById('edit-url').value;      break;
    case 'script':   action = document.getElementById('edit-script').value;   break;
    case 'rtsp':     action = document.getElementById('edit-rtsp').value;     break;
    case 'rest':     action = JSON.stringify({
      method: document.getElementById('edit-rest-method').value,
      url:    document.getElementById('edit-rest-url').value.trim(),
      body:   document.getElementById('edit-rest-body').value.trim(),
    }); break;
  }

  const selected = document.querySelector('.color-swatch.selected');
  const color = selected ? selected.style.background : '#ffffff';

  const btn = {
    label:       document.getElementById('edit-label').value.trim(),
    icon:        document.getElementById('edit-icon').value.trim(),
    color,
    action_type: at,
    action,
  };

  const page = Config.get('currentPage');
  Config.setButton(page, _editingIdx, btn);
  WS.sendConfigSync();
  renderGrid();
  showView('app');
  showToast('Button saved');
}

function clearButton() {
  if (_editingIdx === null) return;
  showConfirm('Clear this button?', () => {
    Config.clearButton(Config.get('currentPage'), _editingIdx);
    WS.sendConfigSync();
    renderGrid();
    showView('app');
  });
}

function setGridSize(val) {
  Config.set('grid', val);
  renderGrid();
}

function exportConfig() {
  const data = Config.exportJSON();
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'streamdeck-config.json';
  a.click();
}

function importConfig() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (Config.importJSON(ev.target.result)) {
        renderGrid();
        showToast('Config imported');
      } else {
        showToast('Import failed — invalid file');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function confirmReset() {
  showConfirm('Reset all buttons and settings to defaults?', () => {
    localStorage.removeItem('streamdeck_config');
    Config.load();
    renderGrid();
    showToast('Reset complete');
  });
}

// ── Settings form population ───────────────────────────────

function populateSettingsForm() {
  const brightness = Config.get('brightness') || 100;
  document.getElementById('brightness').value   = brightness;
  document.getElementById('brightness-val').textContent = brightness + '%';
  document.getElementById('grid-size').value    = Config.get('grid') || '3x2';
}

function updateAgentStatus(connected, info) {
  const dot  = document.getElementById('agent-status-dot');
  const lbl  = document.getElementById('agent-status-label');
  const row  = document.getElementById('agent-info-row');
  const info_el = document.getElementById('agent-info-text');
  if (!dot) return;
  dot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
  lbl.textContent = connected ? 'Agent connected' : 'No agent connected';
  if (connected && info) {
    row.style.display = '';
    info_el.textContent = `${info.hostname || ''} (${info.host || ''})`;
  } else {
    row.style.display = 'none';
  }
}

// ── Brightness ──────────────────────────────────────────────

function setBrightness(val) {
  const pct = Number(val);
  document.getElementById('brightness-val').textContent = pct + '%';
  Config.set('brightness', pct);
  fetch('/api/backlight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brightness: pct }),
  }).catch(() => {});
  // CSS fallback for non-backlight displays
  document.body.style.filter = pct < 100 ? `brightness(${pct / 100})` : '';
}
