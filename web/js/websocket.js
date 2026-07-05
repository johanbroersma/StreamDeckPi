/**
 * websocket.js — WebSocket client for Pi Stream Deck
 * Connects to the local Pi server which proxies commands to the desktop agent.
 */

const WS = {
  _socket: null,
  _reconnectTimer: null,
  _reconnectDelay: 3000,
  _handlers: {},

  // Derived from Config at connect time
  _host: null,
  _port: null,

  on(event, fn) {
    this._handlers[event] = fn;
  },

  _emit(event, data) {
    if (this._handlers[event]) this._handlers[event](data);
  },

  connect(host, port) {
    this._host = host;
    this._port = port;
    this._tryConnect();
  },

  _tryConnect() {
    if (this._socket) {
      this._socket.onclose = null;
      this._socket.close();
    }

    const url = `ws://${this._host}:${this._port}/ws/ui`;
    this._emit('status', 'connecting');

    try {
      this._socket = new WebSocket(url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }

    this._socket.onopen = () => {
      this._reconnectDelay = 3000;
      this._emit('status', 'connected');
      // Send full config so server knows button layout
      this._send({ type: 'config_sync', config: Config._data });
    };

    this._socket.onclose = () => {
      this._emit('status', 'disconnected');
      this._scheduleReconnect();
    };

    this._socket.onerror = () => {
      // onclose will fire too
    };

    this._socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        this._handleMessage(msg);
      } catch {}
    };
  },

  _handleMessage(msg) {
    switch (msg.type) {
      case 'agent_status':
        this._emit('agent_status', msg.connected);
        break;
      case 'button_feedback':
        this._emit('button_feedback', { idx: msg.idx, success: msg.success, message: msg.message });
        break;
      case 'config_push':
        // Agent pushed new config (e.g. via desktop app)
        if (Config.importJSON(JSON.stringify(msg.config))) {
          this._emit('config_updated');
        }
        break;
      case 'token_info':
        this._emit('token_info', msg.token);
        break;
      case 'error':
        this._emit('error', msg.message);
        break;
    }
  },

  sendButtonPress(pageIdx, btnIdx, button) {
    this._send({
      type: 'button_press',
      page: pageIdx,
      idx: btnIdx,
      action_type: button.action_type,
      action: button.action,
      label: button.label,
    });
  },

  sendConfigSync() {
    this._send({ type: 'config_sync', config: Config._data });
  },

  _send(obj) {
    if (this._socket && this._socket.readyState === WebSocket.OPEN) {
      this._socket.send(JSON.stringify(obj));
    }
  },

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      if (this._host) this._tryConnect();
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30000);
  },

  disconnect() {
    clearTimeout(this._reconnectTimer);
    this._host = null;
    if (this._socket) {
      this._socket.onclose = null;
      this._socket.close();
      this._socket = null;
    }
  },
};
