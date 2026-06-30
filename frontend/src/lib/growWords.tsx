import { useEffect } from "react"

/** Render plain text with each word wrapped in a .grow-word span (hover/selection scaling). */
export function GrowText({ text }: { text: string }) {
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((p, i) =>
        /^\s+$/.test(p) || p === "" ? p : <span key={i} className="grow-word">{p}</span>
      )}
    </>
  )
}

/**
 * Document-level hook: while text is selected, marks every .grow-word span intersecting
 * the selection with `.is-selected` so they scale up. Mount once near the app root.
 */
export function useSelectionGrow() {
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection()
      const range = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null
      document.querySelectorAll(".grow-word.is-selected").forEach((el) => el.classList.remove("is-selected"))
      if (!range) return
      document.querySelectorAll(".grow-word").forEach((el) => {
        try {
          if (range.intersectsNode(el)) el.classList.add("is-selected")
        } catch { /* detached node */ }
      })
    }
    document.addEventListener("selectionchange", onSel)
    return () => document.removeEventListener("selectionchange", onSel)
  }, [])
}
