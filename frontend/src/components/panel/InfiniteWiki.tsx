import { useCallback, useEffect, useRef, useState } from "react"
import { useContextStore } from "../../store/contextStore"
import { useSessionStore } from "../../store/sessionStore"
import { VisualSandbox } from "./VisualSandbox"

interface WikiPage {
  term: string
  content: string
  streaming: boolean
  visual?: { html_code: string; animation_type: string } | null
  visualLoading?: boolean
}

interface Props {
  isActive: boolean
  sendEvent: (type: string, data?: Record<string, unknown>) => void
}

export function InfiniteWiki({ isActive, sendEvent }: Props) {
  const [stack, setStack] = useState<WikiPage[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const { selectionText, surroundingContext } = useContextStore()
  const { familiarity, knowledgeMode } = useSessionStore()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFiredRef = useRef("")

  const fireCard = useCallback(
    (term: string, surrounding: string, parentContext: string = "") => {
      if (!term.trim() || term === lastFiredRef.current) return
      lastFiredRef.current = term
      const page: WikiPage = { term, content: "", streaming: true, visual: null, visualLoading: false }
      setStack((prev) => {
        const truncated = prev.slice(0, currentIdx + 1)
        return [...truncated, page]
      })
      setCurrentIdx(stack.length === 0 ? 0 : currentIdx + 1)
      sendEvent("CONTEXT_CARD_REQUEST", {
        selection_text: term,
        surrounding_context: surrounding,
        familiarity,
        parent_context: parentContext,
        knowledge_mode: knowledgeMode,
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

  // Listen for WIKI_TOKEN / WIKI_DONE and WIKI_VISUAL events dispatched from useWebSocket
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
    const onVisualStart = (e: Event) => {
      const { term } = (e as CustomEvent).detail
      setStack((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.term === term) {
          next[next.length - 1] = { ...last, visualLoading: true }
        }
        return next
      })
    }
    const onVisualPayload = (e: Event) => {
      const { term, visual } = (e as CustomEvent).detail
      setStack((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.term === term) {
          next[next.length - 1] = { ...last, visualLoading: false, visual }
        }
        return next
      })
    }

    window.addEventListener("wiki-token", onToken)
    window.addEventListener("wiki-done", onDone)
    window.addEventListener("wiki-visual-start", onVisualStart)
    window.addEventListener("wiki-visual-payload", onVisualPayload)
    return () => {
      window.removeEventListener("wiki-token", onToken)
      window.removeEventListener("wiki-done", onDone)
      window.removeEventListener("wiki-visual-start", onVisualStart)
      window.removeEventListener("wiki-visual-payload", onVisualPayload)
    }
  }, [])

  // Clear wiki stack and reset context when Escape is pressed
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "Escape") {
        setStack([])
        setCurrentIdx(0)
        lastFiredRef.current = ""
      }
    }
    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [])

  const currentPage = stack[currentIdx]

  // Drill-down: user selects text inside the wiki output
  const handleDrillDown = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const term = sel.toString().trim()
    if (!term || term.length < 3) return
    fireCard(term, currentPage?.content ?? "", currentPage?.content?.slice(0, 300) ?? "")
    sel.removeAllRanges()
  }

  // Parse and render streamed markdown
  const renderWikiContent = (text: string) => {
    // Strip [Source: X, chunk N] citations
    const cleaned = text.replace(/\[Source:\s*[^\]]*\]/gi, "")

    const lines = cleaned.split(/\r?\n/)
    const elements: React.ReactNode[] = []
    let listItems: string[] = []

    const flushList = (key: string | number) => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`list-${key}`} style={{ margin: "0 0 12px", paddingLeft: 20, lineHeight: 1.6, color: "#1A1A2E" }}>
            {listItems.map((item, li) => (
              <li key={li} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
            ))}
          </ul>
        )
        listItems = []
      }
    }

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed) return

      // Headings (## or ###)
      if (trimmed.startsWith("#")) {
        flushList(index)
        const headerText = trimmed.replace(/^#+\s*/, "")
        elements.push(
          <h3 key={index} style={{
            fontFamily: "'Libre Caslon Text', Georgia, serif",
            color: "#1A3557",
            fontSize: 18,
            fontWeight: 700,
            margin: "20px 0 10px 0",
            borderBottom: "2px solid #E8E0D5",
            paddingBottom: 4
          }}>
            {headerText}
          </h3>
        )
        return
      }

      // Bullet points
      if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
        const bulletContent = trimmed.replace(/^[*-]\s*/, "")
        listItems.push(bulletContent)
        return
      }

      // Regular line, flush any buffered list first
      flushList(index)

      // Check if the line starts with one of the key headers (e.g. **Contextual Definition:**)
      // or similar bold/regular label
      const matchLabel = trimmed.match(/^(\*\*[^*]+\*\*|[A-Za-z\s]+:)\s*(.*)$/)
      if (matchLabel) {
        const label = matchLabel[1].replace(/\*\*/g, "").trim()
        const content = matchLabel[2].trim()
        elements.push(
          <p key={index} style={{ margin: "0 0 12px", lineHeight: 1.6, color: "#1A1A2E" }}>
            <span style={{ fontWeight: 700, color: "#1A3557", display: "inline-block", marginRight: 6 }}>
              {label}
            </span>
            <span dangerouslySetInnerHTML={{ __html: renderInline(content) }} />
          </p>
        )
      } else {
        elements.push(
          <p key={index} style={{ margin: "0 0 12px", lineHeight: 1.6, color: "#1A1A2E" }}
             dangerouslySetInnerHTML={{ __html: renderInline(trimmed) }} />
        )
      }
    })

    flushList("trailing")
    return elements
  }

  const renderInline = (text: string): string => {
    // Bold: **text**
    let result = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Links: [text](url)
    result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #3b82f6; text-decoration: underline; font-weight: 500;">$1</a>')
    return result
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
        style={{ flex: 1, overflow: "auto", padding: "16px 20px 48px", userSelect: "text" }}
      >
        {!currentPage ? (
          <div style={{ color: "#9CA3AF", fontSize: 14, fontFamily: "'Libre Caslon Text', Georgia, serif", textAlign: "center", paddingTop: 40 }}>
            <p>Select text in Read mode</p>
            <p style={{ fontSize: 12, marginTop: 8 }}>The Infinite Wiki will explain and let you drill into any term.</p>
          </div>
        ) : (
          <div style={{ fontFamily: "'Libre Caslon Text', Georgia, serif", fontSize: 14.5 }}>
            <div>
              {renderWikiContent(currentPage.content)}
              {currentPage.streaming && (
                <span style={{ display: "inline-block", width: 8, height: 14, background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "middle" }} />
              )}
            </div>
            
            {(currentPage.visual || currentPage.visualLoading) && (
              <div style={{ marginTop: 24, borderTop: "1px solid #E8E0D5", paddingTop: 16 }}>
                <h4 style={{
                  fontFamily: "'Libre Caslon Text', Georgia, serif",
                  color: "#1A3557",
                  fontSize: 15,
                  fontWeight: 700,
                  margin: "0 0 12px 0"
                }}>
                  Interactive Simulation
                </h4>
                {currentPage.visualLoading ? (
                  <div style={{
                    height: 240,
                    background: "#0f0f0f",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                    fontSize: 13,
                    fontFamily: "system-ui, sans-serif"
                  }}>
                    Generating simulation...
                  </div>
                ) : (
                  <VisualSandbox 
                    visual={currentPage.visual || null} 
                    nodeId={currentPage.term} 
                    animationType="canvas" 
                    height={330}
                  />
                )}
              </div>
            )}

            {!currentPage.streaming && currentPage.content && (
              <p style={{ marginTop: 18, fontSize: 12, color: "#9CA3AF", fontStyle: "italic", fontFamily: "system-ui, sans-serif" }}>
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
