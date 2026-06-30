import { useRef, useEffect, useState } from "react"
import { GrowText } from "../../lib/growWords"
import katex from "katex"
import "katex/dist/katex.min.css"
import { useSessionStore } from "../../store/sessionStore"
import { useContextStore } from "../../store/contextStore"
import { useInteractionStore } from "../../store/interactionStore"
import { splitFencedBlocks } from "../../lib/chatBlocks"
import { useTokenRate } from "../../lib/useTokenRate"
import { useShallow } from "zustand/react/shallow"
import { Globe, X } from "lucide-react"
import { MermaidBlock } from "./MermaidBlock"
import { PlotlyBlock } from "./PlotlyBlock"

// Render $$display$$, $inline$, \[display\], \(inline\) LaTeX to HTML; leave bad math as-is.
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

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  nodeId: string
  familiarity: string
}

export function ChatTool({ sendEvent, nodeId, familiarity }: Props) {
  const { chatHistory, streamingChat, chatDraft, setChatDraft, addChatMessage, setChatHistory, knowledgeMode } = useSessionStore()
  const { selectionText, surroundingContext, selectionImageBase64, clearSelection } = useContextStore()
  const { chatSessions, activeChatSessionId, setActiveChatSession, addChatSession, updateChatSession } = useInteractionStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [webSearching, setWebSearching] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const hasContext = !!selectionText || !!selectionImageBase64
  const chatRate = useTokenRate(streamingChat, !!streamingChat)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatHistory, streamingChat])

  // Show a transient "searching the web" indicator when the model calls the web_search tool.
  useEffect(() => {
    const onTool = () => setWebSearching(true)
    window.addEventListener("chat-tool", onTool)
    return () => window.removeEventListener("chat-tool", onTool)
  }, [])

  // Clear the indicator once the answer starts streaming or a new message commits.
  useEffect(() => {
    if (streamingChat || chatHistory.length) setWebSearching(false)
  }, [streamingChat, chatHistory.length])

  // Sync to interactionStore when a chat finishes or user sends
  useEffect(() => {
    if (chatHistory.length > 0 && !streamingChat) {
      if (!activeChatSessionId) {
        const newId = Date.now().toString()
        setActiveChatSession(newId)
        addChatSession({
          id: newId,
          title: chatHistory[0].content.slice(0, 30) || "New Chat",
          messages: [...chatHistory],
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      } else {
        updateChatSession(activeChatSessionId, [...chatHistory])
      }
    }
  }, [chatHistory, streamingChat])

  const send = () => {
    const content = chatDraft.trim()
    if (!content && !selectionText && !selectionImageBase64) return
    const userMessage = content || `Explain: "${selectionText ? selectionText.slice(0, 120) : "this image"}"`
    addChatMessage({
      role: "user",
      content: userMessage,
      selectionText: selectionText || undefined,
      selectionImageBase64: selectionImageBase64 || undefined
    })
    setChatDraft("")
    sendEvent("CHAT_TURN", {
      node_id: nodeId,
      content: content || "",
      familiarity,
      knowledge_mode: knowledgeMode,
      selection_text: selectionText || undefined,
      surrounding_context: surroundingContext || undefined,
      selection_image_base64: selectionImageBase64 || undefined,
      history: chatHistory,
    })
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

  const renderProse = (text: string, keyPrefix: string) => {
    const cleaned = text.replace(/\[Source:\s*[^\]]*\]/gi, "")
    const lines = cleaned.split(/\r?\n/)
    const elements: React.ReactNode[] = []
    let listItems: string[] = []

    const flushList = (key: string | number) => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`${keyPrefix}-list-${key}`} style={{ margin: "0 0 10px", paddingLeft: 20, lineHeight: 1.55 }}>
            {listItems.map((item, li) => (
              <li key={li} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
            ))}
          </ul>
        )
        listItems = []
      }
    }

    const isTableSep = (s: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(s) && s.includes("-")
    const splitRow = (s: string) =>
      s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())

    let i = 0
    while (i < lines.length) {
      const trimmed = lines[i].trim()
      if (!trimmed) { i++; continue }

      // Markdown table: a `| … |` header row followed by a `| :--- |` separator row.
      if (trimmed.startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushList(i)
        const header = splitRow(trimmed)
        const rows: string[][] = []
        let j = i + 2
        while (j < lines.length && lines[j].trim().startsWith("|")) {
          rows.push(splitRow(lines[j]))
          j++
        }
        elements.push(
          <div key={`${keyPrefix}-tbl-${i}`} style={{ overflowX: "auto", margin: "0 0 12px" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  {header.map((h, hi) => (
                    <th key={hi} style={{ border: "1px solid #E8E0D5", padding: "6px 10px", background: "#EEF3F8", color: "#1A3557", textAlign: "left", fontWeight: 700 }}
                        dangerouslySetInnerHTML={{ __html: renderInline(h) }} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci} style={{ border: "1px solid #E8E0D5", padding: "6px 10px", color: "#1A1A2E", verticalAlign: "top" }}
                          dangerouslySetInnerHTML={{ __html: renderInline(c) }} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        i = j
        continue
      }

      // Headings
      if (trimmed.startsWith("#")) {
        flushList(i)
        const headerText = trimmed.replace(/^#+\s*/, "")
        elements.push(
          <h4 key={`${keyPrefix}-${i}`} style={{
            fontFamily: "'Libre Caslon Text', Georgia, serif",
            color: "#1A3557",
            fontSize: 16,
            fontWeight: 700,
            margin: "14px 0 6px 0",
            borderBottom: "1px solid #E8E0D5",
            paddingBottom: 2
          }}>
            {headerText}
          </h4>
        )
        i++
        continue
      }

      // Bullets
      if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
        listItems.push(trimmed.replace(/^[*-]\s*/, ""))
        i++
        continue
      }

      flushList(i)

      // Paragraph
      elements.push(
        <p key={`${keyPrefix}-${i}`} style={{ margin: "0 0 10px", lineHeight: 1.55 }}
           dangerouslySetInnerHTML={{ __html: renderInline(trimmed) }} />
      )
      i++
    }

    flushList("trailing")
    return elements
  }

  const renderChatContent = (text: string) => {
    // Intercept ```mermaid / ```plotly fenced blocks; prose flows through renderProse.
    return splitFencedBlocks(text).map((block, i) => {
      if (block.type === "mermaid") return <MermaidBlock key={`b-${i}`} code={block.content} />
      if (block.type === "plotly") return <PlotlyBlock key={`b-${i}`} spec={block.content} />
      return <div key={`b-${i}`}>{renderProse(block.content, `b-${i}`)}</div>
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* Top Bar for History */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid #E8E0D5", flexShrink: 0, background: "#F8F9FA" }}>
        <button
          onClick={() => {
            setActiveChatSession(null);
            setChatHistory([]);
            setHistoryOpen(false);
          }}
          style={{
            background: "transparent",
            color: "#1A3557",
            border: "1px solid #1A3557",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + New Chat
        </button>
        {chatSessions.length > 0 && (
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            style={{
              background: historyOpen ? "#1A3557" : "transparent",
              color: historyOpen ? "white" : "#4A7FB5",
              border: "1px solid",
              borderColor: historyOpen ? "#1A3557" : "#4A7FB5",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            History
          </button>
        )}
      </div>

      {/* History Drawer */}
      {historyOpen && chatSessions.length > 0 && (
        <div style={{ background: "#F8F9FA", borderBottom: "1px solid #E8E0D5", padding: "8px 12px", maxHeight: 150, overflowY: "auto", flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Past Chat Sessions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {chatSessions.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setActiveChatSession(s.id);
                  setChatHistory(s.messages);
                  setHistoryOpen(false);
                }}
                style={{
                  background: s.id === activeChatSessionId ? "#EEF3F8" : "white",
                  border: "1px solid #E2E8F0",
                  borderRadius: 4,
                  padding: "6px 10px",
                  fontSize: 13,
                  color: "#1A3557",
                  cursor: "pointer",
                  textAlign: "left",
                  fontWeight: s.id === activeChatSessionId ? 600 : 400,
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message history */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "12px" }}>
        {chatHistory.length === 0 && !streamingChat && (
          <p style={{ color: "#9CA3AF", fontSize: 14, margin: 0, fontStyle: "italic", textAlign: "center", paddingTop: 24 }}>
            {hasContext
              ? "Ask something about the selected passage, or type a question."
              : "Ask anything about this topic. Select text in the PDF first to ground your question."}
          </p>
        )}
        {chatHistory.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              background: msg.role === "user" ? "#EEF3F8" : "#FFFFFF",
              color: "#1A1A2E",
              border: "1px solid #E8E0D5",
              padding: "8px 12px",
              borderRadius: 10,
              maxWidth: "85%",
              fontSize: 14,
              lineHeight: 1.55,
              fontFamily: msg.role === "assistant" ? "'Libre Caslon Text', Georgia, serif" : "system-ui, sans-serif",
            }}
          >
            {(msg.selectionImageBase64 || msg.selectionText) && (
              <div style={{ marginBottom: 8, padding: 8, background: "#FFFFFF", borderRadius: 6, border: "1px solid #E2E8F0" }}>
                {msg.selectionImageBase64 && (
                  <img
                    src={`data:image/png;base64,${msg.selectionImageBase64}`}
                    alt="Context"
                    style={{ maxWidth: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 4, display: "block", marginBottom: msg.selectionText ? 8 : 0 }}
                  />
                )}
                {msg.selectionText && (
                  <div style={{ fontSize: 12, color: "#4A7FB5", fontStyle: "italic", borderLeft: "2px solid #4A7FB5", paddingLeft: 8 }}>
                    "<GrowText text={`${msg.selectionText.slice(0, 150)}${msg.selectionText.length > 150 ? "..." : ""}`} />"
                  </div>
                )}
              </div>
            )}
            {msg.role === "assistant" ? renderChatContent(msg.content) : msg.content}
          </div>
        ))}
        {webSearching && !streamingChat && (
          <div style={{
            alignSelf: "flex-start",
            color: "#4A7FB5",
            fontSize: 13,
            fontStyle: "italic",
            fontFamily: "system-ui, sans-serif",
            padding: "4px 6px",
          }}>
            <Globe size={14} style={{ marginRight: 6 }} /> Searching the web…
          </div>
        )}
        {streamingChat && (
          <div style={{
            alignSelf: "flex-start",
            background: "#FFFFFF",
            color: "#1A1A2E",
            border: "1px solid #E8E0D5",
            padding: "8px 12px",
            borderRadius: 10,
            maxWidth: "85%",
            fontSize: 14,
            lineHeight: 1.55,
            fontFamily: "'Libre Caslon Text', Georgia, serif",
          }}>
            {renderChatContent(streamingChat)}
            <span style={{ display: "inline-block", width: 8, height: 14, background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "middle" }} />
            {chatRate > 0 && <span className="ts-badge">{chatRate} t/s</span>}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area — context chip sits above the textarea, inside the input block */}
      <div style={{ borderTop: "1px solid #E8E0D5", flexShrink: 0 }}>
        {hasContext && (
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 12px 0",
          }}>
            <span style={{ color: "#9CA3AF", fontSize: 14, marginTop: 1, flexShrink: 0 }}>↳</span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              {selectionText && (
                <p style={{
                  margin: 0,
                  fontSize: 14.5,
                  color: "#4A7FB5",
                  lineHeight: 1.4,
                  fontFamily: "'Libre Caslon Text', Georgia, serif",
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                }}>
                  "{selectionText.length > 280 ? selectionText.slice(0, 280) + "…" : selectionText}"
                </p>
              )}
              {selectionImageBase64 && (
                <img 
                  src={`data:image/png;base64,${selectionImageBase64}`} 
                  alt="Selection context"
                  style={{ maxHeight: 300, maxWidth: "100%", objectFit: "contain", borderRadius: 4, border: "1px solid #E8E0D5" }} 
                />
              )}
            </div>
            <button
              onClick={clearSelection}
              title="Clear selection"
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div style={{ padding: "8px 12px", display: "flex", gap: 8 }}>
          <textarea
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={hasContext ? "Ask about the selection… (Enter to send)" : "Ask about this topic… (Enter to send)"}
            rows={2}
            style={{
              flex: 1,
              background: "#FAF7F2",
              color: "#1A1A2E",
              border: "1px solid #E8E0D5",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 14,
              resize: "none",
              outline: "none",
              fontFamily: "system-ui, sans-serif",
            }}
          />
          <button
            onClick={send}
            style={{
              background: "#1A3557",
              color: "#FAF7F2",
              border: "none",
              borderRadius: 8,
              padding: "0 16px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
