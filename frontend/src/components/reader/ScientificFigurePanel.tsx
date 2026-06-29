import { useEffect, useRef, useState } from "react"
import { useSessionStore } from "../../store/sessionStore"
import { VisualSandbox } from "../panel/VisualSandbox"
import { StudyToolsTabs } from "../study-tools/StudyToolsTabs"
import { ScoreBar } from "../panel/ScoreBar"
import { useGraphStore } from "../../store/graphStore"

type PanelTab = "Figure" | "Study Tools"

interface Props {
  activeConcept: string | null
  activeNodeId: string | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
}

export function ScientificFigurePanel({ activeConcept, activeNodeId, sendEvent }: Props) {
  const { visual, lesson, familiarity, streamingLesson, lessonStreaming } = useSessionStore()
  const { nodes } = useGraphStore()
  const [tab, setTab] = useState<PanelTab>("Figure")
  const [figureRequested, setFigureRequested] = useState(false)

  const node = nodes.find((n) => n.id === activeNodeId)

  // When a concept is clicked, trigger visual generation
  useEffect(() => {
    if (!activeConcept || !activeNodeId) return
    setFigureRequested(false)
  }, [activeConcept, activeNodeId])

  const requestFigure = () => {
    if (!activeNodeId || figureRequested) return
    setFigureRequested(true)
    sendEvent("GENERATE_VISUAL", {
      node_id: activeNodeId,
      node_label: activeConcept || "",
      animation_type: lesson?.visual_suggestion || "canvas",
      familiarity,
    })
  }

  const isEmpty = !activeConcept && !activeNodeId

  return (
    <div style={{
      width: "44%",
      minWidth: 340,
      display: "flex",
      flexDirection: "column",
      background: "#FAF7F2",
      borderLeft: "1px solid #E8E0D5",
    }}>
      {/* Panel header */}
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid #E8E0D5",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#FFFFFF",
      }}>
        <div style={{ flex: 1 }}>
          {activeConcept ? (
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1A3557", fontFamily: "Georgia, serif" }}>
              {activeConcept}
            </h3>
          ) : (
            <span style={{ color: "#9CA3AF", fontSize: 13 }}>Click a highlighted concept</span>
          )}
        </div>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["Figure", "Study Tools"] as PanelTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                background: tab === t ? "#1A3557" : "transparent",
                color: tab === t ? "#FAF7F2" : "#6B7280",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Score bar (when a node is selected) */}
      {node && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #E8E0D5", background: "#FDFBF8" }}>
          <ScoreBar scores={node.data.scores} />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "Figure" ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            {isEmpty ? (
              <div style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                color: "#9CA3AF",
                padding: 32,
                textAlign: "center",
              }}>
                <div style={{ fontSize: 40 }}>✦</div>
                <p style={{ margin: 0, fontSize: 14, fontFamily: "Georgia, serif" }}>
                  Click any highlighted concept in the document to see its interactive figure here.
                </p>
              </div>
            ) : visual ? (
              <VisualSandbox visual={visual} nodeId={activeNodeId || ""} animationType={lesson?.visual_suggestion} />
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                {/* Streaming lesson text while figure loads */}
                {lessonStreaming && (
                  <div style={{ padding: 20, width: "100%", boxSizing: "border-box" }}>
                    <p style={{ fontSize: 13, lineHeight: 1.8, color: "#1A1A2E", fontFamily: "Georgia, serif", whiteSpace: "pre-wrap", margin: 0 }}>
                      {streamingLesson}
                      <span style={{ display: "inline-block", width: 2, height: "1em", background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
                    </p>
                  </div>
                )}
                {!lessonStreaming && (
                  <button
                    onClick={requestFigure}
                    disabled={figureRequested}
                    style={{
                      background: "#1A3557",
                      color: "#FAF7F2",
                      border: "none",
                      borderRadius: 10,
                      padding: "12px 28px",
                      fontSize: 14,
                      cursor: figureRequested ? "default" : "pointer",
                      opacity: figureRequested ? 0.6 : 1,
                      fontFamily: "Georgia, serif",
                    }}
                  >
                    {figureRequested ? "Generating figure…" : "Generate Figure →"}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          activeNodeId ? (
            <StudyToolsTabs
              sendEvent={sendEvent}
              nodeId={activeNodeId}
              nodeLabel={activeConcept || ""}
              familiarity={familiarity}
            />
          ) : (
            <div style={{ padding: 24, color: "#9CA3AF", fontSize: 13 }}>
              Select a concept to access study tools.
            </div>
          )
        )}
      </div>
    </div>
  )
}
