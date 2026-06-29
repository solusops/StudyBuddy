import { useCallback, useState } from "react"
import { useSessionStore } from "../../store/sessionStore"
import { TabBar } from "../panel/TabBar"
import { InfiniteWiki } from "../panel/InfiniteWiki"
import { ScoreBar } from "../panel/ScoreBar"
import { useGraphStore } from "../../store/graphStore"
import { useContextStore } from "../../store/contextStore"
import { ChatTool } from "../study-tools/ChatTool"
import { FlashcardTool } from "../study-tools/FlashcardTool"
import { QuizTool } from "../study-tools/QuizTool"
import { FeynmanTool } from "../study-tools/FeynmanTool"

interface Props {
  activeConcept: string | null
  activeNodeId: string | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
}

export function ScientificFigurePanel({ activeNodeId, sendEvent }: Props) {
  const { familiarity } = useSessionStore()
  const { nodes } = useGraphStore()
  const { setSelection } = useContextStore()

  // Two independent tab controllers
  const [activeTopTab, setActiveTopTab] = useState("Flashcards")
  const [activeBottomTab, setActiveBottomTab] = useState("Chat")

  const node = nodes.find((n) => n.id === activeNodeId)

  // Capture text selections inside the panel and push to contextStore
  // so Infinite Wiki can auto-fire on them
  const handlePanelMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (activeBottomTab === "Infinite Wiki") return
    if (!sel || sel.isCollapsed) {
      return
    }
    const text = sel.toString().trim()
    if (text.length < 3) return
    setSelection([], text, "")
  }, [activeBottomTab, setSelection])

  const showScoreBar = node && (
    node.data.scores.memory > 0 ||
    node.data.scores.comprehension > 0 ||
    node.data.scores.structure > 0 ||
    node.data.scores.application > 0
  )

  return (
    <div style={{
      width: "44%",
      minWidth: 340,
      display: "flex",
      flexDirection: "column",
      background: "#FAF7F2",
      borderLeft: "1px solid #E8E0D5",
      height: "100%",
    }}>
      {/* Score bar (when a node has progress) */}
      {showScoreBar && (
        <div style={{ padding: "6px 16px", borderBottom: "1px solid #E8E0D5", background: "#FDFBF8", flexShrink: 0 }}>
          <ScoreBar scores={node.data.scores} />
        </div>
      )}

      {/* TOP HALF: Flashcards, Quiz, Feynman */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderBottom: "1px solid #E8E0D5",
      }}>
        <TabBar tabs={["Flashcards", "Quiz", "Feynman"]} active={activeTopTab} onChange={setActiveTopTab} />
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {activeTopTab === "Flashcards" && (
            activeNodeId ? (
              <FlashcardTool sendEvent={sendEvent} nodeId={activeNodeId} familiarity={familiarity} />
            ) : (
              <div style={{ padding: 24, color: "#9CA3AF", fontSize: 13 }}>Select a concept to see flashcards.</div>
            )
          )}
          {activeTopTab === "Quiz" && (
            activeNodeId ? (
              <QuizTool sendEvent={sendEvent} nodeId={activeNodeId} familiarity={familiarity} />
            ) : (
              <div style={{ padding: 24, color: "#9CA3AF", fontSize: 13 }}>Select a concept to take a quiz.</div>
            )
          )}
          {activeTopTab === "Feynman" && (
            activeNodeId ? (
              <FeynmanTool sendEvent={sendEvent} nodeId={activeNodeId} familiarity={familiarity} />
            ) : (
              <div style={{ padding: 24, color: "#9CA3AF", fontSize: 13 }}>Select a concept to use Feynman mode.</div>
            )
          )}
        </div>
      </div>

      {/* BOTTOM HALF: Chat, Infinite Wiki */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }} onMouseUp={handlePanelMouseUp}>
        <TabBar tabs={["Chat", "Infinite Wiki"]} active={activeBottomTab} onChange={setActiveBottomTab} />
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {activeBottomTab === "Chat" && (
            activeNodeId ? (
              <ChatTool sendEvent={sendEvent} nodeId={activeNodeId} familiarity={familiarity} />
            ) : (
              <div style={{ padding: 24, color: "#9CA3AF", fontSize: 13 }}>Select a concept to chat.</div>
            )
          )}
          {activeBottomTab === "Infinite Wiki" && (
            <InfiniteWiki isActive={activeBottomTab === "Infinite Wiki"} sendEvent={sendEvent} />
          )}
        </div>
      </div>
    </div>
  )
}
