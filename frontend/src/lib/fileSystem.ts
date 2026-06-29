/**
 * File system abstraction.
 * In Electron: uses IPC bridge (window.electronAPI).
 * In browser dev mode: falls back to a download anchor.
 */
export async function saveMarkdownFile(filePath: string, content: string): Promise<void> {
  if (window.electronAPI?.isElectron) {
    await window.electronAPI.saveFile(filePath, content)
  } else {
    const filename = filePath.split(/[/\\]/).pop() ?? "summary.md"
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
