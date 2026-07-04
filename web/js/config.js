/**
 * config.js — Persistent configuration for Pi Stream Deck
 * Saves to localStorage; synced to server on connect.
 */

const BUTTON_COLORS = [
  '#ffffff', '#f5f5f5', '#ef9a9a', '#f48fb1', '#ce93d8',
  '#90caf9', '#80cbc4', '#a5d6a7', '#fff176', '#ffcc80',
  '#ffab91', '#bcaaa4',
];

const DEFAULT_GRID = '3x2'; // matches design thumbnail

const GRID_CONFIGS = {
  '4x3': { cols: 4, rows: 3, total: 12 },
  '4x2': { cols: 4, rows: 2, total: 8  },
  '3x2': { cols: 3, rows: 2, total: 6  },
};

const DEFAULT_BUTTON = {
  label: '',
  icon: '',
  color: '#ffffff',
  action_type: 'shortcut',
  action: '',
};

function makeDefaultPage(size) {
  const cfg = GRID_CONFIGS[size] || GRID_CONFIGS[DEFAULT_GRID];
  return Array.from({ length: cfg.total }, () => ({ ...DEFAULT_BUTTON }));
}

const Config = {
  _data: null,

  load() {
    try {
      const raw = localStorage.getItem('streamdeck_config');
      this._data = raw ? JSON.parse(raw) : this._defaults();
    } catch {
      this._data = this._defaults();
    }
    // Migrate / fill missing fields
    if (!this._data.grid) this._data.grid = DEFAULT_GRID;
    if (!this._data.pages || !this._data.pages.length) {
      this._data.pages = [makeDefaultPage(this._data.grid)];
    }
    if (this._data.currentPage === undefined) this._data.currentPage = 0;
    return this;
  },

  _defaults() {
    return {
      agentHost: '',
      agentPort: 7001,
      grid: DEFAULT_GRID,
      brightness: 100,
      currentPage: 0,
      pages: [makeDefaultPage(DEFAULT_GRID)],
    };
  },

  save() {
    localStorage.setItem('streamdeck_config', JSON.stringify(this._data));
  },

  get(key) { return this._data[key]; },

  set(key, value) {
    this._data[key] = value;
    this.save();
  },

  getButton(pageIdx, btnIdx) {
    const page = this._data.pages[pageIdx];
    if (!page) return { ...DEFAULT_BUTTON };
    return page[btnIdx] || { ...DEFAULT_BUTTON };
  },

  setButton(pageIdx, btnIdx, btn) {
    while (this._data.pages.length <= pageIdx) {
      this._data.pages.push(makeDefaultPage(this._data.grid));
    }
    const cfg = GRID_CONFIGS[this._data.grid] || GRID_CONFIGS[DEFAULT_GRID];
    while (this._data.pages[pageIdx].length <= btnIdx) {
      this._data.pages[pageIdx].push({ ...DEFAULT_BUTTON });
    }
    this._data.pages[pageIdx][btnIdx] = { ...DEFAULT_BUTTON, ...btn };
    this.save();
  },

  clearButton(pageIdx, btnIdx) {
    this.setButton(pageIdx, btnIdx, { ...DEFAULT_BUTTON });
  },

  getGridConfig() {
    return GRID_CONFIGS[this._data.grid] || GRID_CONFIGS[DEFAULT_GRID];
  },

  pageCount() { return this._data.pages.length; },

  ensurePages(n) {
    while (this._data.pages.length < n) {
      this._data.pages.push(makeDefaultPage(this._data.grid));
    }
    this.save();
  },

  addPage() {
    this._data.pages.push(makeDefaultPage(this._data.grid));
    this.save();
    return this._data.pages.length - 1;
  },

  exportJSON() {
    return JSON.stringify(this._data, null, 2);
  },

  importJSON(json) {
    try {
      const parsed = JSON.parse(json);
      this._data = parsed;
      this.save();
      return true;
    } catch { return false; }
  },
};
