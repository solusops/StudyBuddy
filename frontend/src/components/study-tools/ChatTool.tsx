import { useRef, useEffect } from "react"
import { useSessionStore } from "../../store/sessionStore"
import { useContextStore } from "../../store/contextStore"

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  nodeId: string
  familiarity: string
}

export function ChatTool({ sendEvent, nodeId, familiarity }: Props) {
  const { chatHistory, streamingChat, chatDraft, setChatDraft, addChatMessage } = useSessionStore()
  const { selectionText, surroundingContext, selectionSnippets, clearSelection } = useContextStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatHistory, streamingChat])

  const send = () => {
    const content = chatDraft.trim()
    if (!content && !selectionText) return
    const userMessage = content || `Explain: "${selectionText.slice(0, 120)}"`
    addChatMessage({ role: "student", content: userMessage })
    setChatDraft("")
    sendEvent("CHAT_TURN", {
      node_id: nodeId,
      content: content || "",
      familiarity,
      selection_text: selectionText || undefined,
      surrounding_context: surroundingContext || undefined,
    })
  }

  const hasContext = !!selectionText

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>

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
              alignSelf: msg.role === "student" ? "flex-end" : "flex-start",
              background: msg.role === "student" ? "#EEF3F8" : "#FFFFFF",
              color: "#1A1A2E",
              border: "1px solid #E8E0D5",
              padding: "8px 12px",
              borderRadius: 10,
              maxWidth: "85%",
              fontSize: 14,
              whiteSpace: "pre-wrap",
              lineHeight: 1.55,
              fontFamily: msg.role === "assistant" ? "'Libre Caslon Text', Georgia, serif" : "system-ui, sans-serif",
            }}
          >
            {msg.content}
          </div>
        ))}
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
            whiteSpace: "pre-wrap",
            lineHeight: 1.55,
            fontFamily: "'Libre Caslon Text', Georgia, serif",
          }}>
            {streamingChat}
            <span style={{ opacity: 0.4 }}>▌</span>
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
            <p style={{
              flex: 1,
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
            <button
              onClick={clearSelection}
              title="Clear selection"
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0 }}
            >
              ×
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
