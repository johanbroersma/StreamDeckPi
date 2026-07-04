const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings:  ()       => ipcRenderer.invoke('get-settings'),
  saveSettings: (data)   => ipcRenderer.send('save-settings', data),
});
