import { useCallback, useEffect, useRef, useState } from "react"
import { useContextStore } from "../../store/contextStore"
import { useSessionStore } from "../../store/sessionStore"

interface WikiPage {
  term: string
  content: string
  streaming: boolean
}

interface Props {
  isActive: boolean
  sendEvent: (type: string, data?: Record<string, unknown>) => void
}

export function InfiniteWiki({ isActive, sendEvent }: Props) {
  const [stack, setStack] = useState<WikiPage[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const { selectionText, surroundingContext, selectionSnippets } = useContextStore()
  const { familiarity } = useSessionStore()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFiredRef = useRef("")

  const fireCard = useCallback(
    (term: string, surrounding: string, parentContext: string = "") => {
      if (!term.trim() || term === lastFiredRef.current) return
      lastFiredRef.current = term
      const page: WikiPage = { term, content: "", streaming: true }
      // Truncate forward history then append the new page.
      // New page index = length of the truncated array (0-based).
      // When stack is empty: truncated = [], new page at index 0.
      // When stack has items: truncated = stack[0..currentIdx], new page at currentIdx+1.
      setStack((prev) => {
        const truncated = prev.slice(0, currentIdx + 1)
        return [...truncated, page]
      })
      // Index of the new page = min(currentIdx + 1, stack.length)
      // handles the empty-stack case: min(0+1, 0) = 0
      // If the stack was empty the new page lands at index 0; otherwise at currentIdx+1
      setCurrentIdx(stack.length === 0 ? 0 : currentIdx + 1)
      sendEvent("CONTEXT_CARD_REQUEST", {
        selection_text: term,
        surrounding_context: surrounding,
        familiarity,
        parent_context: parentContext,
      })
    },
    [currentIdx, familiarity, sendEvent, stack.length]
  )

  // Auto-fire when tab is active and selection changes
  useEffect(() => {
    if (!isActive || !selectionText) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fireCard(selectionText, surroundingContext)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [isActive, selectionText, surroundingContext, fireCard])

  // Listen for WIKI_TOKEN / WIKI_DONE events dispatched from useWebSocket
  useEffect(() => {
    const onToken = (e: Event) => {
      const { token } = (e as CustomEvent).detail
      setStack((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last) next[next.length - 1] = { ...last, content: last.content + token }
        return next
      })
    }
    const onDone = () => {
      setStack((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last) next[next.length - 1] = { ...last, streaming: false }
        return next
      })
    }
    window.addEventListener("wiki-token", onToken)
    window.addEventListener("wiki-done", onDone)
    return () => {
      window.removeEventListener("wiki-token", onToken)
      window.removeEventListener("wiki-done", onDone)
    }
  }, [])

  const currentPage = stack[currentIdx]
  const canGoBack = currentIdx > 0
  const canGoForward = currentIdx < stack.length - 1

  // Drill-down: user selects text inside the wiki output
  const handleDrillDown = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const term = sel.toString().trim()
    if (!term || term.length < 3) return
    fireCard(term, currentPage?.content ?? "", currentPage?.content?.slice(0, 300) ?? "")
    sel.removeAllRanges()
  }

  if (!isActive) return null

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Breadcrumb nav */}
      {stack.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderBottom: "1px solid #E8E0D5", flexShrink: 0, flexWrap: "wrap" }}>
          {stack.slice(0, currentIdx + 1).map((p, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <span style={{ color: "#D1C9C0" }}>›</span>}
              <button
                onClick={() => setCurrentIdx(i)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "2px 6px",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12,
                  color: i === currentIdx ? "#1A3557" : "#4A7FB5",
                  fontWeight: i === currentIdx ? 600 : 400,
                  background: i === currentIdx ? "#EEF3F8" : "transparent",
                }}
              >
                {p.term.length > 28 ? p.term.slice(0, 28) + "…" : p.term}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Content area */}
      <div
        onMouseUp={handleDrillDown}
        style={{ flex: 1, overflow: "auto", padding: "16px 20px", userSelect: "text" }}
      >
        {!currentPage ? (
          <div style={{ color: "#9CA3AF", fontSize: 14, fontFamily: "'Libre Caslon Text', Georgia, serif", textAlign: "center", paddingTop: 40 }}>
            <p>Select text in Read mode</p>
            <p style={{ fontSize: 12, marginTop: 8 }}>The Infinite Wiki will explain and let you drill into any term.</p>
          </div>
        ) : (
          <div>
            <pre
              style={{
                fontFamily: "'Libre Caslon Text', Georgia, serif",
                fontSize: 14,
                lineHeight: 1.7,
                color: "#1A1A2E",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
              }}
            >
              {currentPage.content}
              {currentPage.streaming && (
                <span style={{ display: "inline-block", width: 8, height: 14, background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite" }} />
              )}
            </pre>
            {!currentPage.streaming && currentPage.content && (
              <p style={{ marginTop: 16, fontSize: 12, color: "#9CA3AF", fontStyle: "italic" }}>
                Highlight any word above to drill deeper ↓
              </p>
            )}
          </div>
        )}
      </div>

      <style>{"`@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }`"}</style>
    </div>
  )
}
