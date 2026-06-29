import { useCallback, useEffect, useState } from "react"
import { useSessionStore } from "../../store/sessionStore"
import { TabBar } from "../panel/TabBar"
import { InfiniteWiki } from "../panel/InfiniteWiki"
import { ScoreBar } from "../panel/ScoreBar"
import { useGraphStore } from "../../store/graphStore"
import { useInteractionStore } from "../../store/interactionStore"
import { useContextStore } from "../../store/contextStore"
import { ChatTool } from "../study-tools/ChatTool"
import { FlashcardTool } from "../study-tools/FlashcardTool"
import { QuizTool } from "../study-tools/QuizTool"
import { FeynmanTool } from "../study-tools/FeynmanTool"

const TABS = ["Chat", "Infinite Wiki", "Flashcards", "Quiz", "Feynman"]

interface Props {
  activeConcept: string | null
  activeNodeId: string | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
}

export function ScientificFigurePanel({ activeConcept, activeNodeId, sendEvent }: Props) {
  const { familiarity } = useSessionStore()
  const { nodes } = useGraphStore()
  const { activeAnnotationId, committedAnnotations, updateAnnotationNote } = useInteractionStore()
  const { setSelection, clearSelection } = useContextStore()
  const activeAnnotation = activeAnnotationId
    ? committedAnnotations.find((a) => a.annotation_id === activeAnnotationId) ?? null
    : null
  const [noteText, setNoteText] = useState(activeAnnotation?.note_text ?? "")
  // Default to Study Tools when arriving with an active node (from TreePage)
  const [activeTab, setActiveTab] = useState("Chat")

  const node = nodes.find((n) => n.id === activeNodeId)

  useEffect(() => {
    setNoteText(activeAnnotation?.note_text ?? "")
  }, [activeAnnotationId])

  // Capture text selections inside the panel and push to contextStore
  // so Infinite Wiki can auto-fire on them
  const handlePanelMouseUp = useCallback(() => {
    const sel = window.getSelection()
    // Don't interfere with InfiniteWiki's own drill-down handler
    if (activeTab === "Infinite Wiki") return
    if (!sel || sel.isCollapsed) {
      return
    }
    const text = sel.toString().trim()
    if (text.length < 3) return
    setSelection([], text, "")
  }, [activeTab, setSelection])

  const saveNote = async () => {
    if (!activeAnnotation) return
    await fetch(`/annotations/${activeAnnotation.annotation_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note_text: noteText }),
    })
    updateAnnotationNote(activeAnnotation.annotation_id, noteText)
  }

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

      {/* Flat tab bar */}
      <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {/* Content — mouseUp captures panel-internal selections for Infinite Wiki */}
      <div style={{ flex: 1, overflow: "auto" }} onMouseUp={handlePanelMouseUp}>
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
      </div>
    </div>
  )
}
