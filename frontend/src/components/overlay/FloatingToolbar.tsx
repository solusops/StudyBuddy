import { useEffect } from "react"
import { useInteractionStore, type CursorMode } from "../../store/interactionStore"
import { useContextStore } from "../../store/contextStore"

export function FloatingToolbar() {
  const { cursorMode, setCursorMode, clearGroup } = useInteractionStore()

  // Hotkeys: V = default, N = note-append, Esc = clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "v" || e.key === "V") setCursorMode("DEFAULT")
      if (e.key === "n" || e.key === "N") setCursorMode("NOTE_APPEND")
      if (e.key === "Escape") {
        clearGroup()
        useContextStore.getState().clearSelection()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [setCursorMode, clearGroup])

  const btn = (mode: CursorMode, icon: string, label: string, hotkey: string) => (
    <button
      title={`${label} (${hotkey})`}
      onClick={() => setCursorMode(mode)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        borderRadius: 20,
        border: "none",
        background: cursorMode === mode ? "#1A3557" : "transparent",
        color: cursorMode === mode ? "#FAF7F2" : "#6B7280",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: cursorMode === mode ? 600 : 400,
        transition: "background 0.15s",
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      {label}
    </button>
  )

  return (
    <div
      style={{
        position: "fixed",
        top: 56,           // below the 48px topbar
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        background: "#FFFFFF",
        border: "1px solid #E8E0D5",
        borderRadius: 24,
        boxShadow: "0 2px 12px rgba(26,53,87,0.12)",
        padding: "4px 6px",
        display: "flex",
        gap: 2,
      }}
    >
      {btn("DEFAULT", "↖", "Read", "V")}
      {btn("NOTE_APPEND", "✏️", "Annotate", "N")}
    </div>
  )
}
