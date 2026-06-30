import { useCallback, useEffect, useRef, useState } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"
import { useContextStore } from "../../store/contextStore"
import { useSessionStore } from "../../store/sessionStore"
import { useInteractionStore } from "../../store/interactionStore"
import { useTokenRate } from "../../lib/useTokenRate"
import { VisualSandbox } from "./VisualSandbox"
import type { AnimationType, HTML5VisualPayload } from "../../types"

// Render $$display$$, $inline$, \[...\], \(...\) LaTeX to HTML; leave bad math as-is.
function renderMath(text: string): string {
  const tex = (src: string, displayMode: boolean) => {
    try {
      return katex.renderToString(src, { displayMode, throwOnError: false })
    } catch {
      return displayMode ? `$$${src}$$` : `$${src}$`
    }
  }
  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => tex(m, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => tex(m, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => tex(m, false))
    .replace(/\$([^$\n]+?)\$/g, (_, m) => tex(m, false))
}

interface VisualOffer {
  modality: "STATIC_PLOT" | "INTERACTIVE_SIMULATION"
  recommended_tool: string
  label: string
}

interface ScholarPaper {
  title: string
  authors: string
  year: number | null
  cited_by: number
  url: string
}

interface DeepDiveVideo {
  video_id: string
  title: string
  channel: string
  thumbnail: string
  url: string
}

interface WikiPage {
  term: string
  content: string
  streaming: boolean
  visual?: HTML5VisualPayload | null
  visualLoading?: boolean
  visualOffer?: VisualOffer | null
  papers?: ScholarPaper[]
  imageBase64?: string
  recallGenerated?: boolean
  videos?: DeepDiveVideo[]
  videosLoading?: boolean
  activeVideoId?: string
  videoSummary?: { video_id: string; summary: string; key_points?: string[] }
}

interface Props {
  isActive: boolean
  sendEvent: (type: string, data?: Record<string, unknown>) => void
}

export function InfiniteWiki({ isActive, sendEvent }: Props) {
  const [stack, setStack] = useState<WikiPage[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const { selectionText, surroundingContext, selectionImageBase64 } = useContextStore()
  const { documentId, wikiHistory, pushWikiPage, updateWikiPage } = useInteractionStore()
  const { familiarity, knowledgeMode } = useSessionStore()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFiredRef = useRef("")
  const [historyOpen, setHistoryOpen] = useState(false)

  const fireCard = useCallback(
    (term: string, surrounding: string, parentContext: string = "", imageBase64?: string) => {
      if (!term.trim() || term === lastFiredRef.current) return
      lastFiredRef.current = term
      const page: WikiPage = { term, content: "", streaming: true, visual: null, visualLoading: false, visualOffer: null, imageBase64 }
      setStack((prev) => {
        const truncated = prev.slice(0, currentIdx + 1)
        return [...truncated, page]
      })
      setCurrentIdx(stack.length === 0 ? 0 : currentIdx + 1)
      sendEvent("CONTEXT_CARD_REQUEST", {
        selection_text: term,
        surrounding_context: surrounding,
        selection_image_base64: imageBase64,
        familiarity,
        parent_context: parentContext,
        knowledge_mode: knowledgeMode,
      })
    },
    [currentIdx, familiarity, sendEvent, stack.length]
  )

  // Auto-fire when tab is active and selection changes
  useEffect(() => {
    if (!isActive || (!selectionText && !selectionImageBase64)) return
    const term = selectionText || "Selected Image"
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fireCard(term, surroundingContext, "", selectionImageBase64)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [isActive, selectionText, surroundingContext, selectionImageBase64, fireCard])

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
        if (last) {
          const updated = { ...last, streaming: false }
          next[next.length - 1] = updated
          if (documentId) pushWikiPage(documentId, updated)
        }
        return next
      })
    }
    const onVisualAvailable = (e: Event) => {
      const { term, modality, recommended_tool, label } = (e as CustomEvent).detail
      setStack((prev) => {
        const next = prev.map((p) =>
          p.term === term ? { ...p, visualOffer: { modality, recommended_tool, label } } : p
        )
        if (documentId) updateWikiPage(documentId, term, { visualOffer: { modality, recommended_tool, label } })
        return next
      })
    }
    const onFurtherReading = (e: Event) => {
      const { term, papers } = (e as CustomEvent).detail
      setStack((prev) => {
        const next = prev.map((p) => (p.term === term ? { ...p, papers } : p))
        if (documentId) updateWikiPage(documentId, term, { papers })
        return next
      })
    }
    const onDeepDiveVideos = (e: Event) => {
      const { term, videos } = (e as CustomEvent).detail
      setStack((prev) => {
        const next = prev.map((p) =>
          p.term === term ? { ...p, videos, videosLoading: false, activeVideoId: videos?.[0]?.video_id } : p
        )
        if (documentId) updateWikiPage(documentId, term, { videos })
        return next
      })
    }
    const onDeepDiveSummary = (e: Event) => {
      const { term, video_id, summary, key_points } = (e as CustomEvent).detail
      setStack((prev) =>
        prev.map((p) => (p.term === term ? { ...p, videoSummary: { video_id, summary, key_points } } : p))
      )
    }
    const onVisualStart = (e: Event) => {
      const { term } = (e as CustomEvent).detail
      setStack((prev) =>
        prev.map((p) => (p.term === term ? { ...p, visualLoading: true } : p))
      )
    }
    const onVisualPayload = (e: Event) => {
      const { term, visual } = (e as CustomEvent).detail
      setStack((prev) => {
        const next = prev.map((p) => (p.term === term ? { ...p, visualLoading: false, visual } : p))
        if (documentId) updateWikiPage(documentId, term, { visual })
        return next
      })
    }

    window.addEventListener("wiki-token", onToken)
    window.addEventListener("wiki-done", onDone)
    window.addEventListener("wiki-visual-available", onVisualAvailable)
    window.addEventListener("wiki-further-reading", onFurtherReading)
    window.addEventListener("wiki-deepdive-videos", onDeepDiveVideos)
    window.addEventListener("wiki-deepdive-summary", onDeepDiveSummary)
    window.addEventListener("wiki-visual-start", onVisualStart)
    window.addEventListener("wiki-visual-payload", onVisualPayload)
    return () => {
      window.removeEventListener("wiki-token", onToken)
      window.removeEventListener("wiki-done", onDone)
      window.removeEventListener("wiki-visual-available", onVisualAvailable)
      window.removeEventListener("wiki-further-reading", onFurtherReading)
      window.removeEventListener("wiki-deepdive-videos", onDeepDiveVideos)
      window.removeEventListener("wiki-deepdive-summary", onDeepDiveSummary)
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
  const wikiRate = useTokenRate(currentPage?.content ?? "", !!currentPage?.streaming)

  // On-demand YouTube Deep Dive — fetch watchable videos (played in-app) + summaries.
  const requestDeepDive = (page: WikiPage) => {
    setStack((prev) => prev.map((p) => (p.term === page.term ? { ...p, videosLoading: true } : p)))
    sendEvent("WIKI_DEEPDIVE_REQUEST", { selection_text: page.term, familiarity })
  }

  const selectVideo = (page: WikiPage, v: DeepDiveVideo) => {
    setStack((prev) => prev.map((p) => (p.term === page.term ? { ...p, activeVideoId: v.video_id } : p)))
    // Summarize on demand if we don't already have this video's summary.
    if (page.videoSummary?.video_id !== v.video_id) {
      sendEvent("WIKI_DEEPDIVE_SUMMARIZE", { video_id: v.video_id, term: page.term, title: v.title, familiarity })
    }
  }

  // Generate the offered visual on demand, grounded in this card's content.
  const requestVisual = (page: WikiPage) => {
    if (!page.visualOffer) return
    setStack((prev) =>
      prev.map((p) => (p.term === page.term ? { ...p, visualLoading: true } : p))
    )
    sendEvent("WIKI_VISUAL_GENERATE", {
      selection_text: page.term,
      familiarity,
      modality: page.visualOffer.modality,
      recommended_tool: page.visualOffer.recommended_tool,
      card_content: page.content,
    })
  }

  // Generate active recall quiz on demand
  const requestRecall = (page: WikiPage) => {
    setStack((prev) =>
      prev.map((p) => (p.term === page.term ? { ...p, recallGenerated: true } : p))
    )
    if (documentId) updateWikiPage(documentId, page.term, { recallGenerated: true })
    sendEvent("WIKI_RECALL_GENERATE", {
      selection_text: page.term,
      familiarity,
      card_content: page.content,
    })
  }

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
          <div key={index} style={{ marginBottom: 10 }}>
            <h3 style={{
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
            {currentPage?.imageBase64 && (
              <img 
                src={`data:image/png;base64,${currentPage.imageBase64}`} 
                alt="Source region"
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: 180,
                  objectFit: "contain",
                  borderRadius: 6,
                  border: "1px solid #E8E0D5",
                  marginTop: 12,
                  marginBottom: 16
                }} 
              />
            )}
          </div>
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
    // Math first (KaTeX HTML must not be touched by the markdown regexes below).
    let result = renderMath(text)
    // Bold: **text**
    result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Links: [text](url)
    result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #3b82f6; text-decoration: underline; font-weight: 500;">$1</a>')
    return result
  }

  if (!isActive) return null

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Breadcrumb nav & History Toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid #E8E0D5", flexShrink: 0 }}>
        {stack.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {stack.slice(0, currentIdx + 1).map((p, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <span style={{ color: "#D1C9C0" }}>›</span>}
                <button
                  onClick={() => { setCurrentIdx(i); setHistoryOpen(false); }}
                  style={{
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
        ) : <div />}
        
        {documentId && (wikiHistory[documentId]?.length > 0) && (
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            style={{
              background: historyOpen ? "#1A3557" : "transparent",
              color: historyOpen ? "white" : "#4A7FB5",
              border: "1px solid",
              borderColor: historyOpen ? "#1A3557" : "#4A7FB5",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 12,
              cursor: "pointer",
              marginLeft: 8,
            }}
          >
            History
          </button>
        )}
      </div>

      {/* History Drawer */}
      {historyOpen && documentId && (wikiHistory[documentId]?.length > 0) && (
        <div style={{ background: "#F8F9FA", borderBottom: "1px solid #E8E0D5", padding: "8px 16px", maxHeight: 150, overflowY: "auto" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Past Wiki Sessions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {wikiHistory[documentId].map((p, i) => (
              <button
                key={i}
                onClick={() => {
                  setStack([p]);
                  setCurrentIdx(0);
                  setHistoryOpen(false);
                }}
                style={{
                  background: "white",
                  border: "1px solid #E2E8F0",
                  borderRadius: 4,
                  padding: "4px 8px",
                  fontSize: 12,
                  color: "#1A3557",
                  cursor: "pointer",
                }}
              >
                {p.term.length > 28 ? p.term.slice(0, 28) + "…" : p.term}
              </button>
            ))}
          </div>
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
              {currentPage.streaming && wikiRate > 0 && <span className="ts-badge">{wikiRate} t/s</span>}
            </div>
            
            {/* On-demand visual: show a button once the card is done; generate only on click. */}
            {!currentPage.streaming && currentPage.visualOffer && !currentPage.visual && !currentPage.visualLoading && (
              <div style={{ marginTop: 20 }}>
                <button
                  onClick={() => requestVisual(currentPage)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#EEF3F8",
                    border: "1.5px solid #4A7FB5",
                    borderRadius: 10,
                    padding: "10px 16px",
                    cursor: "pointer",
                    color: "#1A3557",
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="11" fill="#1A3557" />
                    <path d="M10 8.5v7l5.5-3.5L10 8.5z" fill="#FFFFFF" />
                  </svg>
                  Click to view {currentPage.visualOffer.label}
                </button>
              </div>
            )}

            {(currentPage.visual || currentPage.visualLoading) && (
              <div style={{ marginTop: 24, borderTop: "1px solid #E8E0D5", paddingTop: 16 }}>
                <h4 style={{
                  fontFamily: "'Libre Caslon Text', Georgia, serif",
                  color: "#1A3557",
                  fontSize: 15,
                  fontWeight: 700,
                  margin: "0 0 12px 0"
                }}>
                  {currentPage.visualOffer?.label ?? "Visualization"}
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
                    Generating visualization…
                  </div>
                ) : (
                  <VisualSandbox
                    visual={currentPage.visual || null}
                    nodeId={currentPage.term}
                    animationType={(currentPage.visual?.animation_type as AnimationType) ?? "canvas"}
                    height={330}
                  />
                )}
              </div>
            )}

            {currentPage.papers && currentPage.papers.length > 0 && (
              <div style={{ marginTop: 24, borderTop: "1px solid #E8E0D5", paddingTop: 16 }}>
                <h4 style={{
                  fontFamily: "'Libre Caslon Text', Georgia, serif",
                  color: "#1A3557",
                  fontSize: 15,
                  fontWeight: 700,
                  margin: "0 0 10px 0"
                }}>
                  Further Reading
                </h4>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                  {currentPage.papers.map((p, i) => (
                    <li key={i} style={{ fontSize: 13, lineHeight: 1.4, color: "#1A1A2E" }}>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#3b82f6", textDecoration: "underline", fontWeight: 600 }}
                      >
                        {p.title}
                      </a>
                      <span style={{ color: "#6B7280" }}>
                        {p.authors ? ` — ${p.authors}` : ""}
                        {p.year ? ` (${p.year})` : ""}
                        {typeof p.cited_by === "number" ? ` · ${p.cited_by.toLocaleString()} citations` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Deep Dive — on-demand YouTube videos, played in-app */}
            {!currentPage.streaming && (
              <div style={{ marginTop: 24, borderTop: "1px solid #E8E0D5", paddingTop: 16 }}>
                {!currentPage.videos && !currentPage.videosLoading && (
                  <button
                    onClick={() => requestDeepDive(currentPage)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 10,
                      background: "#EEF3F8", border: "1.5px solid #4A7FB5", borderRadius: 10,
                      padding: "10px 16px", cursor: "pointer", color: "#1A3557", fontSize: 14, fontWeight: 600,
                    }}
                  >
                    🎥 Deep Dive — find videos
                  </button>
                )}
                {currentPage.videosLoading && (
                  <p style={{ color: "#6B7280", fontSize: 13, fontStyle: "italic", margin: 0 }}>Finding videos…</p>
                )}
                {currentPage.videos && currentPage.videos.length === 0 && (
                  <p style={{ color: "#9CA3AF", fontSize: 13, margin: 0 }}>No videos found (check YOUTUBE_API_KEY).</p>
                )}
                {currentPage.videos && currentPage.videos.length > 0 && (
                  <div>
                    <h4 style={{ fontFamily: "'Libre Caslon Text', Georgia, serif", color: "#1A3557", fontSize: 15, fontWeight: 700, margin: "0 0 10px 0" }}>
                      Deep Dive
                    </h4>
                    {/* In-app player */}
                    {currentPage.activeVideoId && (
                      <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 8, overflow: "hidden", border: "1px solid #E8E0D5", marginBottom: 10 }}>
                        <iframe
                          title="deep-dive-video"
                          src={`https://www.youtube.com/embed/${currentPage.activeVideoId}`}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                        />
                      </div>
                    )}
                    {/* Thumbnail picker */}
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6 }}>
                      {currentPage.videos.map((v) => (
                        <button
                          key={v.video_id}
                          onClick={() => selectVideo(currentPage, v)}
                          title={`${v.title} — ${v.channel}`}
                          style={{
                            flexShrink: 0, width: 140, textAlign: "left", cursor: "pointer",
                            background: "transparent", padding: 0,
                            border: v.video_id === currentPage.activeVideoId ? "2px solid #1A3557" : "1px solid #E8E0D5",
                            borderRadius: 8, overflow: "hidden",
                          }}
                        >
                          {v.thumbnail && <img src={v.thumbnail} alt="" style={{ width: "100%", display: "block" }} />}
                          <span style={{ display: "block", padding: "4px 6px", fontSize: 11, lineHeight: 1.3, color: "#1A1A2E", fontFamily: "system-ui, sans-serif" }}>
                            {v.title.length > 55 ? v.title.slice(0, 55) + "…" : v.title}
                          </span>
                        </button>
                      ))}
                    </div>
                    {/* Summary (also fed into Quiz/Flashcards) */}
                    {currentPage.videoSummary && currentPage.videoSummary.video_id === currentPage.activeVideoId && (
                      <div style={{ marginTop: 10, padding: 10, background: "#F0F5FA", borderLeft: "4px solid #4A7FB5", borderRadius: "0 8px 8px 0", fontSize: 13, lineHeight: 1.5, color: "#1A3557", fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
                        <strong style={{ display: "block", marginBottom: 4 }}>Video summary</strong>
                        {currentPage.videoSummary.summary}
                        {currentPage.videoSummary.key_points && currentPage.videoSummary.key_points.length > 0 && (
                          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                            {currentPage.videoSummary.key_points.map((k, i) => <li key={i}>{k}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Active Recall Button */}
            {!currentPage.streaming && !currentPage.recallGenerated && (
              <div style={{ marginTop: 24, borderTop: "1px solid #E8E0D5", paddingTop: 16 }}>
                <button
                  onClick={() => requestRecall(currentPage)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#EEF3F8",
                    border: "1.5px solid #4A7FB5",
                    borderRadius: 10,
                    padding: "10px 16px",
                    cursor: "pointer",
                    color: "#1A3557",
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Generate Active Recall Quiz
                </button>
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
