const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', { filePath, content }),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  isElectron: true,
})
