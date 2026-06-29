import { useEffect, useRef, useState } from "react"
import { useInteractionStore, type CommittedAnnotation } from "../../store/interactionStore"

interface GutterNote {
  annotation: CommittedAnnotation
  yNorm: number  // normalised 0..1 of first box's top edge on this page
}

interface Props {
  pageNumber: number
  pageHeightPx: number  // actual rendered pixel height of the page
  documentId?: string
  sessionId?: string
}

export function MarginGutter({ pageNumber, pageHeightPx, documentId, sessionId }: Props) {
  const {
    committedAnnotations,
    activeAnnotationId,
    setActiveAnnotation,
    activeSelectionGroup,
    clearGroup,
    addAnnotation,
    cursorMode,
  } = useInteractionStore()

  const [draftNote, setDraftNote] = useState("")
  const [draftStatus, setDraftStatus] = useState<"idle" | "draft" | "saving" | "error">("idle")
  const [draftError, setDraftError] = useState("")
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Collect committed notes whose FIRST box lands on this page
  const gutterNotes: GutterNote[] = committedAnnotations
    .map((ann) => {
      const firstSnippet = ann.target_snippets.find((s) => s.page_number === pageNumber)
      if (!firstSnippet || !firstSnippet.boxes[0]) return null
      return { annotation: ann, yNorm: firstSnippet.boxes[0].y }
    })
    .filter(Boolean) as GutterNote[]

  // Check if there is an active draft selection on this page
  const draftOnThisPage = activeSelectionGroup.some((s) => s.page_number === pageNumber)
  const draftYNorm = draftOnThisPage
    ? activeSelectionGroup.find((s) => s.page_number === pageNumber)?.boxes[0]?.y ?? 0
    : null

  useEffect(() => {
    if (draftOnThisPage && cursorMode === "NOTE_APPEND") {
      setDraftStatus("draft")
      setTimeout(() => textRef.current?.focus(), 50)
    }
  }, [draftOnThisPage, cursorMode])

  const saveAnnotation = async () => {
    if (!activeSelectionGroup.length) return
    setDraftError("")
    setDraftStatus("saving")
    try {
      if (!documentId || !sessionId) {
        // No session yet — store locally in interactionStore only (no backend persist)
        addAnnotation({
          annotation_id: `local-${Date.now()}`,
          document_id: documentId ?? "local",
          session_id: sessionId ?? "local",
          target_snippets: activeSelectionGroup,
          note_text: draftNote || null,
          created_at: Date.now() / 1000,
          updated_at: Date.now() / 1000,
        })
        clearGroup()
        setDraftNote("")
        setDraftStatus("idle")
        return
      }
      const body = {
        document_id: documentId,
        session_id: sessionId,
        target_snippets: activeSelectionGroup,
        note_text: draftNote || null,
      }
      const resp = await fetch("/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      const created = await resp.json()
      addAnnotation(created)
      clearGroup()
      setDraftNote("")
      setDraftStatus("idle")
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Save failed")
      setDraftStatus("error")
    }
  }

  const cancelDraft = () => {
    clearGroup()
    setDraftNote("")
    setDraftStatus("idle")
    setDraftError("")
  }

  if (!pageHeightPx) return null

  return (
    <div
      style={{
        position: "relative",
        width: 272,
        minWidth: 272,
        height: pageHeightPx,
        flexShrink: 0,
        background: "#FAF7F2",
        borderLeft: "1px solid #E8E0D5",
        overflowY: "visible",
      }}
    >
      {/* Committed notes */}
      {gutterNotes.map(({ annotation, yNorm }) => {
        const topPx = Math.round(yNorm * pageHeightPx)
        const isActive = annotation.annotation_id === activeAnnotationId
        return (
          <div
            key={annotation.annotation_id}
            onClick={() => setActiveAnnotation(isActive ? null : annotation.annotation_id)}
            style={{
              position: "absolute",
              top: topPx,
              left: 8,
              right: 8,
              background: isActive ? "#EEF3F8" : "#FFFFFF",
              border: `1.5px solid ${isActive ? "#1A3557" : "#E8E0D5"}`,
              borderRadius: 6,
              padding: "6px 8px",
              cursor: "pointer",
              zIndex: 5,
              boxShadow: isActive ? "0 2px 8px rgba(26,53,87,0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
              transition: "border-color 0.15s",
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: "#1A3557", lineHeight: 1.45, fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
              {annotation.note_text || (
                <span style={{ color: "#9CA3AF", fontStyle: "italic" }}>No note</span>
              )}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "#9CA3AF" }}>
              {annotation.target_snippets.map((s) => s.text).join(" … ").slice(0, 60)}…
            </p>
          </div>
        )
      })}

      {/* Draft note (only in NOTE_APPEND mode) */}
      {draftStatus !== "idle" && draftYNorm !== null && (
        <div
          style={{
            position: "absolute",
            top: Math.round(draftYNorm * pageHeightPx),
            left: 8,
            right: 8,
            background: "#FFFBEB",
            border: "1.5px solid #F59E0B",
            borderRadius: 6,
            padding: "8px",
            zIndex: 10,
            boxShadow: "0 2px 12px rgba(245,158,11,0.2)",
          }}
        >
          <textarea
            ref={textRef}
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="Add a note… (Enter to save, Esc to cancel)"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveAnnotation() }
              if (e.key === "Escape") cancelDraft()
            }}
            style={{
              width: "100%",
              border: "none",
              background: "transparent",
              resize: "none",
              outline: "none",
              fontSize: 13,
              color: "#1A1A2E",
              fontFamily: "'Libre Caslon Text', Georgia, serif",
              boxSizing: "border-box",
            }}
          />
          {draftError && (
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#EF4444" }}>{draftError}</p>
          )}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
            <button onClick={cancelDraft} style={{ background: "transparent", border: "1px solid #E8E0D5", borderRadius: 4, padding: "3px 8px", fontSize: 12, cursor: "pointer", color: "#6B7280" }}>
              Cancel
            </button>
            <button
              onClick={draftStatus === "error" ? saveAnnotation : saveAnnotation}
              disabled={draftStatus === "saving"}
              style={{ background: draftStatus === "error" ? "#EF4444" : "#1A3557", border: "none", borderRadius: 4, padding: "3px 10px", fontSize: 12, cursor: draftStatus === "saving" ? "not-allowed" : "pointer", color: "#FAF7F2", fontWeight: 600 }}
            >
              {draftStatus === "saving" ? "Saving…" : draftStatus === "error" ? "Retry" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
