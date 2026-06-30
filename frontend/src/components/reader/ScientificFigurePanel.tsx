import { useCallback, useEffect, useState } from "react"
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

  // Unified tab controller for all 5 tabs
  const [activeTab, setActiveTab] = useState("Infinite Wiki")

  // A region/figure click can request opening a specific tool tab.
  useEffect(() => {
    const onOpenTool = (e: Event) => {
      const tool = (e as CustomEvent).detail?.tool
      if (tool === "Infinite Wiki" || tool === "Chat") setActiveTab(tool)
    }
    window.addEventListener("studybuddy-open-tool", onOpenTool)
    return () => window.removeEventListener("studybuddy-open-tool", onOpenTool)
  }, [])

  const node = nodes.find((n) => n.id === activeNodeId)

  // Capture text selections inside the panel and push to contextStore
  // so Infinite Wiki can auto-fire on them
  const handlePanelMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (activeTab === "Infinite Wiki") return
    if (!sel || sel.isCollapsed) {
      return
    }
    const text = sel.toString().trim()
    if (text.length < 3) return
    setSelection([], text, "")
  }, [activeTab, setSelection])

  const showScoreBar = node && (
    node.data.scores.memory > 0 ||
    node.data.scores.comprehension > 0 ||
    node.data.scores.structure > 0 ||
    node.data.scores.application > 0
  )

  return (
    <div
      style={{
        width: "40%",
        display: "flex",
        flexDirection: "column",
        background: "#FFFFFF",
        borderLeft: "1px solid #E2E8F0",
        boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.05)",
        height: "100%",
        zIndex: 10,
      }}
    >
      {/* Score bar (when a node has progress) */}
      {showScoreBar && (
        <div style={{ padding: "6px 16px", borderBottom: "1px solid #E8E0D5", background: "#FDFBF8", flexShrink: 0 }}>
          <ScoreBar scores={node.data.scores} />
        </div>
      )}

      {/* Main Tab bar */}
      <TabBar
        tabs={["Infinite Wiki", "Chat", "Flashcards", "Quiz", "Feynman"]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Tab contents */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
        onMouseUp={handlePanelMouseUp}
      >
        {activeTab === "Flashcards" && (
          activeNodeId ? (
            <FlashcardTool sendEvent={sendEvent} nodeId={activeNodeId} familiarity={familiarity} />
          ) : (
            <div style={{ padding: 24, color: "#9CA3AF", fontSize: 13 }}>Select a concept to see flashcards.</div>
          )
        )}
        {activeTab === "Quiz" && (
          activeNodeId ? (
            <QuizTool sendEvent={sendEvent} nodeId={activeNodeId} familiarity={familiarity} />
          ) : (
            <div style={{ padding: 24, color: "#9CA3AF", fontSize: 13 }}>Select a concept to take a quiz.</div>
          )
        )}
        {activeTab === "Feynman" && (
          activeNodeId ? (
            <FeynmanTool sendEvent={sendEvent} nodeId={activeNodeId} familiarity={familiarity} />
          ) : (
            <div style={{ padding: 24, color: "#9CA3AF", fontSize: 13 }}>Select a concept to use Feynman mode.</div>
          )
        )}
        {activeTab === "Chat" && (
          activeNodeId ? (
            <ChatTool sendEvent={sendEvent} nodeId={activeNodeId} familiarity={familiarity} />
          ) : (
            <div style={{ padding: 24, color: "#9CA3AF", fontSize: 13 }}>Select a concept to chat.</div>
          )
        )}
        {activeTab === "Infinite Wiki" && (
          <InfiniteWiki isActive={activeTab === "Infinite Wiki"} sendEvent={sendEvent} />
        )}
      </div>
    </div>
  )
}
