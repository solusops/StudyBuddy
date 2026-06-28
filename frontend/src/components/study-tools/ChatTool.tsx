import { useRef, useEffect } from "react"
import { useSessionStore } from "../../store/sessionStore"

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  nodeId: string
  familiarity: string
}

export function ChatTool({ sendEvent, nodeId, familiarity }: Props) {
  const { chatHistory, streamingChat, chatDraft, setChatDraft, addChatMessage } = useSessionStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatHistory, streamingChat])

  const send = () => {
    const content = chatDraft.trim()
    if (!content) return
    addChatMessage({ role: "student", content })
    setChatDraft("")
    sendEvent("CHAT_TURN", { node_id: nodeId, content, familiarity })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
        {chatHistory.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "student" ? "flex-end" : "flex-start",
              background: msg.role === "student" ? "#3b82f6" : "#1e293b",
              color: "white",
              padding: "8px 12px",
              borderRadius: 8,
              maxWidth: "85%",
              fontSize: 13,
              whiteSpace: "pre-wrap",
            }}
          >
            {msg.content}
          </div>
        ))}
        {streamingChat && (
          <div style={{ alignSelf: "flex-start", background: "#1e293b", color: "white", padding: "8px 12px", borderRadius: 8, maxWidth: "85%", fontSize: 13, whiteSpace: "pre-wrap" }}>
            {streamingChat}
            <span style={{ opacity: 0.5 }}>▌</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          value={chatDraft}
          onChange={(e) => setChatDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Ask about this topic… (Enter to send)"
          rows={2}
          style={{ flex: 1, background: "#1e293b", color: "white", border: "1px solid #334155", borderRadius: 6, padding: 8, fontSize: 13, resize: "none" }}
        />
        <button onClick={send} style={{ background: "#3b82f6", color: "white", border: "none", borderRadius: 6, padding: "0 16px", cursor: "pointer" }}>
          Send
        </button>
      </div>
    </div>
  )
}
