const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

let pythonProcess = null

function startPython() {
  pythonProcess = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8765'], {
    cwd: path.join(__dirname, '..', 'backend'),
    stdio: 'pipe',
    env: { ...process.env },
  })
  pythonProcess.stderr.on('data', (d) => console.log('[Python]', d.toString()))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1400, minHeight: 860,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  })
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => { startPython(); setTimeout(createWindow, 2000) })
app.on('window-all-closed', () => { pythonProcess?.kill(); app.quit() })

// ------------------------------------------------------------------ //
// File system IPC                                                      //
// ------------------------------------------------------------------ //

ipcMain.handle('save-file', async (_, { filePath, content }) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  return { success: true, filePath }
})

ipcMain.handle('get-home-dir', () => os.homedir())

// Folder picker — returns the selected directory path or null if cancelled
ipcMain.handle('select-folder', async (_, opts = {}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: opts.title || 'Select Folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

// List supported files in a folder
const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.txt'])
ipcMain.handle('list-files', async (_, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) return []
  return fs.readdirSync(folderPath)
    .filter(name => {
      const ext = path.extname(name).toLowerCase()
      return SUPPORTED_EXTS.has(ext) && fs.statSync(path.join(folderPath, name)).isFile()
    })
    .map(name => ({ name, path: path.join(folderPath, name) }))
})

// Read a file as base64 (for sending to backend or rendering PDFs)
ipcMain.handle('read-file', async (_, filePath) => {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
  return fs.readFileSync(filePath).toString('base64')
})

// Read a file as a local file:// URL for pdf.js renderer
ipcMain.handle('get-file-url', async (_, filePath) => {
  return `file://${filePath.replace(/\\/g, '/')}`
})
