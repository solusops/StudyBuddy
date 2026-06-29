import { useEffect, useRef } from "react"
import { annotate } from "rough-notation"
import { useInteractionStore, type CursorMode } from "../../store/interactionStore"
import { useContextStore } from "../../store/contextStore"

const ITEMS = [
  { key: "DEFAULT", icon: "↖", label: "Read", hotkey: "V" },
  { key: "NOTE_APPEND", icon: "✏️", label: "Annotate", hotkey: "N" },
  { key: "regions", icon: "▦", label: "Regions", hotkey: "R" },
] as const

export function FloatingToolbar() {
  const { cursorMode, setCursorMode, clearGroup, regionsOn, toggleRegions } = useInteractionStore()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const annoRef = useRef<ReturnType<typeof annotate> | null>(null)
  const activeKey = regionsOn ? "regions" : cursorMode

  // Hotkeys: V = default, N = note-append, R = toggle regions, Esc = clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "v" || e.key === "V") setCursorMode("DEFAULT")
      if (e.key === "n" || e.key === "N") setCursorMode("NOTE_APPEND")
      if (e.key === "r" || e.key === "R") toggleRegions()
      if (e.key === "Escape") {
        clearGroup()
        useContextStore.getState().clearSelection()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [setCursorMode, clearGroup, toggleRegions])

  // Hand-drawn (RoughNotation) box around the active control — the toolbar is fixed,
  // so RoughNotation positions reliably (no scroll drift).
  useEffect(() => {
    annoRef.current?.remove()
    const el = refs.current[activeKey]
    if (el) {
      const a = annotate(el, {
        type: "box", color: "#1A3557", strokeWidth: 1.6, padding: 3, animationDuration: 320,
      })
      a.show()
      annoRef.current = a
    }
    return () => { annoRef.current?.remove(); annoRef.current = null }
  }, [activeKey])

  const onClick = (key: string) => {
    if (key === "regions") toggleRegions()
    else setCursorMode(key as CursorMode)
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 56,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        background: "#FFFFFF",
        border: "1px solid #E8E0D5",
        borderRadius: 24,
        boxShadow: "0 2px 12px rgba(26,53,87,0.12)",
        padding: "5px 8px",
        display: "flex",
        gap: 4,
      }}
    >
      {ITEMS.map((it) => {
        const active = it.key === activeKey
        return (
          <button
            key={it.key}
            ref={(el) => { refs.current[it.key] = el }}
            title={`${it.label} (${it.hotkey})`}
            onClick={() => onClick(it.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 14px",
              borderRadius: 20,
              border: "none",
              background: "transparent",
              color: active ? "#1A3557" : "#6B7280",
              cursor: "pointer",
              fontSize: 17,
              fontFamily: "var(--font-hand)",
              fontWeight: active ? 700 : 600,
            }}
          >
            <span style={{ fontSize: 16, fontFamily: "system-ui" }}>{it.icon}</span>
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
