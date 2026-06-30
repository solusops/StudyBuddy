import { useEffect, useRef, useState } from "react"
import { useInteractionStore, type CommittedAnnotation } from "../../store/interactionStore"
import { GrowText } from "../../lib/growWords"

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
    notePositions,
    updateNotePosition,
    updateAnnotationNote,
    removeAnnotation,
  } = useInteractionStore()

  // Editing states
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState("")

  // Draggable states
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragStartYRef = useRef(0)
  const dragStartNormYRef = useRef(0)

  // Drag listeners
  useEffect(() => {
    if (!draggingId) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - dragStartYRef.current
      const deltaNormY = deltaY / pageHeightPx
      let nextNormY = dragStartNormYRef.current + deltaNormY
      nextNormY = Math.max(0, Math.min(1, nextNormY))
      updateNotePosition(draggingId, nextNormY)
    }

    const handleMouseUp = () => {
      setDraggingId(null)
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [draggingId, pageHeightPx, updateNotePosition])

  const handleMouseDown = (e: React.MouseEvent, annotationId: string, currentYNorm: number) => {
    if (e.button !== 0) return // only left click
    // Don't drag if we are editing this note
    if (editingNoteId === annotationId) return
    e.stopPropagation()
    setDraggingId(annotationId)
    dragStartYRef.current = e.clientY
    dragStartNormYRef.current = currentYNorm
  }

  const finishEditing = async (annotationId: string) => {
    setEditingNoteId(null)
    const trimmed = editingNoteText.trim()

    if (trimmed === "") {
      // Empty note text -> delete the note and its highlights
      try {
        await fetch(`/annotations/${annotationId}`, {
          method: "DELETE",
        })
      } catch (err) {
        console.error("Failed to delete annotation on backend:", err)
      }
      removeAnnotation(annotationId)
    } else {
      // Save changes
      try {
        await fetch(`/annotations/${annotationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note_text: trimmed }),
        })
        updateAnnotationNote(annotationId, trimmed)
      } catch (err) {
        console.error("Failed to update annotation note on backend:", err)
      }
    }
  }

  const [draftNote, setDraftNote] = useState("")
  const [draftStatus, setDraftStatus] = useState<"idle" | "draft" | "saving" | "error">("idle")
  const [draftError, setDraftError] = useState("")
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Collect committed notes whose FIRST box lands on this page
  const gutterNotes: GutterNote[] = committedAnnotations
    .map((ann) => {
      const firstSnippet = ann.target_snippets.find((s) => s.page_number === pageNumber)
      if (!firstSnippet || !firstSnippet.boxes[0]) return null
      // Use override position if exists, otherwise fallback to the first snippet box y
      const savedYNorm = notePositions[ann.annotation_id]
      const yNorm = typeof savedYNorm === "number" ? savedYNorm : firstSnippet.boxes[0].y
      return { annotation: ann, yNorm }
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
        width: 320,
        minWidth: 320,
        height: pageHeightPx,
        flexShrink: 0,
        background: "#F8F9FA",
        borderLeft: "1px solid #E2E8F0",
        overflowY: "visible",
      }}
    >
      {/* Committed notes */}
      {gutterNotes.map(({ annotation, yNorm }) => {
        const topPx = Math.round(yNorm * pageHeightPx)
        const isActive = annotation.annotation_id === activeAnnotationId
        const isDraggingThis = annotation.annotation_id === draggingId
        const isEditingThis = annotation.annotation_id === editingNoteId

        return (
          <div
            key={annotation.annotation_id}
            onClick={(e) => {
              if (cursorMode === "NOTE_APPEND") {
                e.stopPropagation()
                setEditingNoteId(annotation.annotation_id)
                setEditingNoteText(annotation.note_text || "")
              } else {
                setActiveAnnotation(isActive ? null : annotation.annotation_id)
              }
            }}
            onMouseDown={(e) => handleMouseDown(e, annotation.annotation_id, yNorm)}
            style={{
              position: "absolute",
              top: topPx,
              left: 12,
              right: 12,
              background: isActive ? "#FDF8E3" : "#FFFCEB",
              border: `1.5px solid ${isEditingThis ? "#F59E0B" : isActive ? "#EAB308" : "#FDE68A"}`,
              borderRadius: 8,
              padding: isEditingThis ? "6px" : "12px 14px",
              cursor: isEditingThis ? "text" : isDraggingThis ? "grabbing" : "grab",
              zIndex: isEditingThis ? 10 : 5,
              boxShadow: isEditingThis
                ? "0 4px 16px rgba(245,158,11,0.25)"
                : isActive
                  ? "0 4px 12px rgba(234,179,8,0.2)"
                  : "0 2px 6px rgba(0,0,0,0.06)",
              transition: isDraggingThis ? "none" : "border-color 0.15s, top 0.1s, box-shadow 0.15s",
              userSelect: isEditingThis ? "text" : "none",
            }}
          >
            {isEditingThis ? (
              <textarea
                autoFocus
                value={editingNoteText}
                onChange={(e) => setEditingNoteText(e.target.value)}
                onBlur={() => finishEditing(annotation.annotation_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    ;(e.target as HTMLElement).blur()
                  }
                }}
                rows={2}
                style={{
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  resize: "none",
                  outline: "none",
                  fontSize: 16,
                  color: "#1A1A2E",
                  fontFamily: "var(--font-hand)",
                  boxSizing: "border-box",
                  lineHeight: 1.3,
                  padding: 2,
                }}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {annotation.image_base64 && (
                  <img 
                    src={`data:image/png;base64,${annotation.image_base64}`}
                    alt="Pinned region"
                    style={{ maxWidth: "100%", borderRadius: 6, objectFit: "contain", border: "1px solid #FDE68A" }}
                  />
                )}
                <p style={{ margin: 0, fontSize: 18, color: "#451A03", lineHeight: 1.4, fontFamily: "var(--font-hand)", fontWeight: 500 }}>
                  {annotation.note_text ? (
                    <GrowText text={annotation.note_text} />
                  ) : (
                    <span style={{ color: "#9CA3AF", fontStyle: "italic" }}>No note</span>
                  )}
                </p>
              </div>
            )}
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
              fontSize: 17,
              color: "#1A1A2E",
              fontFamily: "var(--font-hand)",
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
