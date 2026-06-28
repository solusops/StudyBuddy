/**
 * File system abstraction.
 * In Electron: uses IPC bridge (window.electronAPI).
 * In browser dev mode: falls back to a download anchor.
 */
export async function saveMarkdownFile(filename: string, content: string): Promise<void> {
  if (window.electronAPI?.isElectron) {
    const home = await window.electronAPI.getHomeDir()
    const fullPath = `${home}/.studybuddy/summaries/${filename}`
    await window.electronAPI.saveFile(fullPath, content)
  } else {
    const blob = new Blob([content], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim()
}
