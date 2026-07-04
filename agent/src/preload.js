const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings:  ()       => ipcRenderer.invoke('get-settings'),
  saveSettings: (data)   => ipcRenderer.send('save-settings', data),
  getConfig:      ()       => ipcRenderer.invoke('get-config'),
  setConfig:      (cfg)    => ipcRenderer.send('set-config', cfg),
  onConfigUpdate: (fn)     => ipcRenderer.on('config-update', (_, cfg) => fn(cfg)),
});
