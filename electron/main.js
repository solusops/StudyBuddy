const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

let pythonProcess = null

function startPython() {
  pythonProcess = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: path.join(__dirname, '..', 'backend'),
    stdio: 'pipe',
    env: { ...process.env },
  })
  pythonProcess.stderr.on('data', (d) => console.log('[Python]', d.toString()))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1024, minHeight: 700,
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

ipcMain.handle('save-file', async (_, { filePath, content }) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  return { success: true, filePath }
})
ipcMain.handle('get-home-dir', () => os.homedir())
