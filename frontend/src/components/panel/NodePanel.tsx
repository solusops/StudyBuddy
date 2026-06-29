import { useEffect, useState } from "react"
import { useGraphStore } from "../../store/graphStore"
import { useSessionStore } from "../../store/sessionStore"
import { ScoreBar } from "./ScoreBar"
import { VisualSandbox } from "./VisualSandbox"
import { StudyToolsTabs } from "../study-tools/StudyToolsTabs"

const PANEL_TABS = ["Lesson", "Visual", "Study Tools"] as const
type PanelTab = (typeof PANEL_TABS)[number]

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  onClose: () => void
}

export function NodePanel({ sendEvent, onClose }: Props) {
  const { nodes } = useGraphStore()
  const { activeNodeId, activeNodeLabel, lesson, visual, familiarity, streamingLesson, lessonStreaming } = useSessionStore()
  const [activeTab, setActiveTab] = useState<PanelTab>("Lesson")
  const [deepDiveResult, setDeepDiveResult] = useState<{ video_url: string | null; summary: string } | null>(null)
  const [deepDiveLoading, setDeepDiveLoading] = useState(false)

  const node = nodes.find((n) => n.id === activeNodeId)

  // When switching to Visual tab, trigger lazy generation
  useEffect(() => {
    if (activeTab === "Visual" && !visual && activeNodeId) {
      sendEvent("GENERATE_VISUAL", {
        node_id: activeNodeId,
        node_label: activeNodeLabel,
        animation_type: lesson?.visual_suggestion || "canvas",
        familiarity,
      })
    }
  }, [activeTab])

  // Listen for deep dive result
  useEffect(() => {
    const handler = (e: Event) => {
      setDeepDiveResult((e as CustomEvent).detail)
      setDeepDiveLoading(false)
    }
    window.addEventListener("infinity-wiki-result", handler)
    return () => window.removeEventListener("infinity-wiki-result", handler)
  }, [])

  if (!activeNodeId || !node) return null

  const data = node.data

  const handleDeepDive = () => {
    setDeepDiveLoading(true)
    setDeepDiveResult(null)
    sendEvent("INFINITY_WIKI_REQUEST", {
      node_id: activeNodeId,
      node_label: activeNodeLabel,
      familiarity,
    })
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: 440,
        background: "#0f172a",
        borderLeft: "1px solid #1e293b",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, color: "white", fontSize: 16, fontWeight: 700 }}>{data.label}</h2>
          <p style={{ margin: 0, color: "#64748b", fontSize: 12 }}>{data.description}</p>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>
      </div>

      {/* Scores */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #1e293b" }}>
        <ScoreBar scores={data.scores} />
      </div>

      {/* Panel tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e293b" }}>
        {PANEL_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: "10px 0",
              background: "none",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
              color: activeTab === tab ? "#3b82f6" : "#64748b",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: activeTab === tab ? 600 : 400,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "16px 20px", overflow: "auto" }}>
        {activeTab === "Lesson" && (
          <div style={{ color: "white" }}>
            {lessonStreaming ? (
              <p style={{ fontSize: 13, lineHeight: 1.8, color: "#e2e8f0", whiteSpace: "pre-wrap" }}>
                {streamingLesson}
                <span style={{ display: "inline-block", width: 2, height: "1em", background: "#3b82f6", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
              </p>
            ) : lesson ? (
              <>
                <p style={{ fontSize: 13, lineHeight: 1.8, color: "#e2e8f0", whiteSpace: "pre-wrap" }}>{lesson.grounded_truth}</p>
                {/* Deep Dive */}
                <div style={{ marginTop: 20, borderTop: "1px solid #1e293b", paddingTop: 16 }}>
                  <button onClick={handleDeepDive} disabled={deepDiveLoading} style={{ background: "#0f172a", color: "#f59e0b", border: "1px solid #f59e0b", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>
                    {deepDiveLoading ? "Searching…" : "🔭 Deep Dive (YouTube)"}
                  </button>
                  {deepDiveResult && deepDiveResult.video_url && (
                    <div style={{ marginTop: 12 }}>
                      <a href={deepDiveResult.video_url} target="_blank" rel="noreferrer" style={{ color: "#3b82f6", fontSize: 13 }}>
                        ▶ Watch video
                      </a>
                      <p style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{deepDiveResult.summary}</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p style={{ color: "#64748b" }}>Loading lesson…</p>
            )}
          </div>
        )}

        {activeTab === "Visual" && (
          <VisualSandbox
            visual={visual}
            nodeId={activeNodeId}
            animationType={lesson?.visual_suggestion}
          />
        )}

        {activeTab === "Study Tools" && (
          <div style={{ height: 500 }}>
            <StudyToolsTabs
              sendEvent={sendEvent}
              nodeId={activeNodeId}
              nodeLabel={activeNodeLabel}
              familiarity={familiarity}
            />
          </div>
        )}
      </div>
    </div>
  )
}
