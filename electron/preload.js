const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // File system
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', { filePath, content }),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),

  // File access for PDF viewer
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  getFileUrl: (filePath) => ipcRenderer.invoke('get-file-url', filePath),
})
