import { useState } from "react"
import { ChatTool } from "./ChatTool"
import { FlashcardTool } from "./FlashcardTool"
import { QuizTool } from "./QuizTool"
import { FeynmanTool } from "./FeynmanTool"

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  nodeId: string
  nodeLabel: string
  familiarity: string
}

const TABS = ["Chat", "Flashcards", "Quiz", "Feynman"] as const
type Tab = (typeof TABS)[number]

export function StudyToolsTabs({ sendEvent, nodeId, nodeLabel, familiarity }: Props) {
  const [active, setActive] = useState<Tab>("Chat")

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", borderBottom: "1px solid #1e293b", marginBottom: 12 }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            style={{
              padding: "8px 16px",
              background: "none",
              border: "none",
              borderBottom: active === tab ? "2px solid #3b82f6" : "2px solid transparent",
              color: active === tab ? "#3b82f6" : "#64748b",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: active === tab ? 600 : 400,
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {active === "Chat" && <ChatTool sendEvent={sendEvent} nodeId={nodeId} familiarity={familiarity} />}
        {active === "Flashcards" && <FlashcardTool sendEvent={sendEvent} nodeId={nodeId} familiarity={familiarity} />}
        {active === "Quiz" && <QuizTool sendEvent={sendEvent} nodeId={nodeId} familiarity={familiarity} />}
        {active === "Feynman" && <FeynmanTool sendEvent={sendEvent} nodeId={nodeId} familiarity={familiarity} />}
      </div>
    </div>
  )
}
