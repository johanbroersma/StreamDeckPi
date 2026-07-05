/**
 * app.js — Initialisation & wiring for Pi Stream Deck
 */

/** Walk up the DOM to see if el or any ancestor can scroll in the touch direction */
function isScrollable(el) {
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el);
    const overflow = style.overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

document.addEventListener('DOMContentLoaded', () => {
  Config.load();
  populateSettingsForm();
  renderGrid();
  startClock();

  // WS status
  WS.on('status', (state) => {
    switch (state) {
      case 'connected':
        setStatus('connected', 'Connected');
        WS._send({ type: 'token_request' });
        break;
      case 'connecting':
        setStatus('connecting', 'Connecting…');
        break;
      case 'disconnected':
        setStatus('disconnected', 'Not Connected');
        break;
    }
  });

  WS.on('agent_status', (data) => {
    const connected = typeof data === 'boolean' ? data : data.connected;
    const info = typeof data === 'object' ? data.agent_info : null;

    if (connected) {
      setStatus('connected', info?.hostname ? `Agent: ${info.hostname}` : 'Agent Ready');
    } else {
      setStatus('disconnected', 'No Agent');
    }
    updateAgentStatus(connected, info);
  });

  WS.on('button_feedback', ({ idx, success, message }) => {
    flashButton(idx, success);
    if (!success) showToast(message ? `Failed: ${message}` : 'Action failed');
  });

  WS.on('config_updated', () => {
    populateSettingsForm();
    renderGrid();
    showToast('Config updated from agent');
  });

  WS.on('token_info', (tok) => {
    setToken(tok);
  });

  WS.on('error', (msg) => showToast('Error: ' + msg));

  // Connect to local Pi server (always localhost from browser's perspective)
  const localHost = location.hostname || '127.0.0.1';
  WS.connect(localHost, 7001);

  // Prevent context menu
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Block touchmove only on non-scrollable elements (prevents rubber-band/bounce
  // on the deck grid, but allows scroll in settings/wifi lists)
  document.addEventListener('touchmove', (e) => {
    if (!isScrollable(e.target)) e.preventDefault();
  }, { passive: false });
});
