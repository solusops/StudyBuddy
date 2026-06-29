import { useEffect, useRef, useState } from "react"
import { useSessionStore } from "../../store/sessionStore"
import { VisualSandbox } from "../panel/VisualSandbox"
import { StudyToolsTabs } from "../study-tools/StudyToolsTabs"
import { ScoreBar } from "../panel/ScoreBar"
import { useGraphStore } from "../../store/graphStore"
import { useInteractionStore } from "../../store/interactionStore"

type PanelTab = "Figure" | "Study Tools"

interface Props {
  activeConcept: string | null
  activeNodeId: string | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
}

export function ScientificFigurePanel({ activeConcept, activeNodeId, sendEvent }: Props) {
  const { visual, lesson, familiarity, streamingLesson, lessonStreaming } = useSessionStore()
  const { nodes } = useGraphStore()
  const { activeAnnotationId, committedAnnotations, updateAnnotationNote } = useInteractionStore()
  const activeAnnotation = activeAnnotationId
    ? committedAnnotations.find((a) => a.annotation_id === activeAnnotationId) ?? null
    : null
  const [noteText, setNoteText] = useState(activeAnnotation?.note_text ?? "")
  // Default to Study Tools when arriving with an active node (from TreePage)
  const [tab, setTab] = useState<PanelTab>(activeNodeId ? "Study Tools" : "Figure")
  const [figureRequested, setFigureRequested] = useState(false)

  const node = nodes.find((n) => n.id === activeNodeId)

  // When a concept is clicked, reset figure state and switch to Study Tools
  useEffect(() => {
    if (!activeConcept || !activeNodeId) return
    setFigureRequested(false)
    setTab("Study Tools")
  }, [activeConcept, activeNodeId])

  useEffect(() => {
    setNoteText(activeAnnotation?.note_text ?? "")
  }, [activeAnnotationId])

  const saveNote = async () => {
    if (!activeAnnotation) return
    await fetch(`/annotations/${activeAnnotation.annotation_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note_text: noteText }),
    })
    updateAnnotationNote(activeAnnotation.annotation_id, noteText)
  }

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
          {activeAnnotation ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#4A7FB5", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                Annotation
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#1A1A2E", fontFamily: "'Libre Caslon Text', Georgia, serif", maxHeight: 48, overflow: "hidden", textOverflow: "ellipsis" }}>
                {activeAnnotation.target_snippets.map((s) => s.text).join(" … ")}
              </p>
            </div>
          ) : activeConcept ? (
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1A3557", fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
              {activeConcept}
            </h3>
          ) : (
            <span style={{ color: "#9CA3AF", fontSize: 13 }}>Click a highlighted concept or annotation</span>
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

      {/* Annotation note canvas (visible when an annotation is the active anchor) */}
      {activeAnnotation && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #E8E0D5", background: "#FDFBF8" }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Note</label>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={saveNote}
            placeholder="Add a note about this selection…"
            rows={3}
            style={{
              width: "100%",
              border: "1px solid #E8E0D5",
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 13,
              resize: "vertical",
              boxSizing: "border-box",
              outline: "none",
              background: "#FAF7F2",
              fontFamily: "'Libre Caslon Text', Georgia, serif",
              color: "#1A1A2E",
            }}
          />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "Figure" ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            {visual ? (
              <VisualSandbox visual={visual} nodeId={activeNodeId || ""} animationType={lesson?.visual_suggestion} />
            ) : isEmpty ? (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", gap: 12, color: "#9CA3AF", padding: 32, textAlign: "center",
              }}>
                <div style={{ fontSize: 40 }}>✦</div>
                <p style={{ margin: 0, fontSize: 14, fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
                  Click any highlighted concept in the document to see its interactive figure here.
                </p>
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {/* Lesson text — streaming or committed */}
                <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
                  {lessonStreaming ? (
                    <p style={{ fontSize: 14, lineHeight: 1.8, color: "#1A1A2E", fontFamily: "'Libre Caslon Text', Georgia, serif", whiteSpace: "pre-wrap", margin: 0 }}>
                      {streamingLesson}
                      <span style={{ display: "inline-block", width: 2, height: "1em", background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
                    </p>
                  ) : lesson?.grounded_truth ? (
                    <div style={{ fontSize: 14, lineHeight: 1.8, color: "#1A1A2E", fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
                      {lesson.grounded_truth.split(/\n\n+/).map((para, i) => {
                        const parts = para.split(/(\*\*[^*]+\*\*)/g)
                        return (
                          <p key={i} style={{ margin: "0 0 12px" }}>
                            {parts.map((part, j) =>
                              part.startsWith("**") && part.endsWith("**")
                                ? <strong key={j}>{part.slice(2, -2)}</strong>
                                : <span key={j}>{part}</span>
                            )}
                          </p>
                        )
                      })}
                    </div>
                  ) : (
                    <p style={{ color: "#9CA3AF", fontSize: 14, margin: 0 }}>Loading lesson…</p>
                  )}
                </div>
                {/* Generate Figure button — only when lesson is done */}
                {!lessonStreaming && (
                  <div style={{ padding: "12px 20px", borderTop: "1px solid #E8E0D5", display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={requestFigure}
                      disabled={figureRequested}
                      style={{
                        background: "#1A3557", color: "#FAF7F2", border: "none", borderRadius: 10,
                        padding: "10px 24px", fontSize: 14, cursor: figureRequested ? "default" : "pointer",
                        opacity: figureRequested ? 0.6 : 1, fontFamily: "'Libre Caslon Text', Georgia, serif",
                      }}
                    >
                      {figureRequested ? "Generating figure…" : "Generate Figure →"}
                    </button>
                  </div>
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
