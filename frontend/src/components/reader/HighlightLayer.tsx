import { useEffect, useState } from "react"
import { useInteractionStore, type CommittedAnnotation, type SelectionSnippet } from "../../store/interactionStore"
import { useContextStore } from "../../store/contextStore"

interface PageSize {
  width: number
  height: number
}

interface Props {
  pageNumber: number
  pageRef: React.RefObject<HTMLDivElement | null>
}

function snippetsForPage(snippets: SelectionSnippet[], page: number) {
  return snippets.filter((s) => s.page_number === page).flatMap((s) => s.boxes)
}

export function HighlightLayer({ pageNumber, pageRef }: Props) {
  const { activeSelectionGroup, committedAnnotations, activeAnnotationId, setActiveAnnotation, cursorMode, blinkTarget } =
    useInteractionStore()
  const { selectionSnippets, setSelection } = useContextStore()
  const [size, setSize] = useState<PageSize>({ width: 0, height: 0 })

  const sendToTool = (ann: CommittedAnnotation, tool: "Infinite Wiki" | "Chat") => {
    const text = ann.note_text || "Pinned Region"
    const surrounding = ann.target_snippets?.map((s) => s.text).join("\n") || ""
    setSelection(ann.target_snippets || [], text, surrounding, ann.image_base64)
    window.dispatchEvent(new CustomEvent("studybuddy-open-tool", { detail: { tool } }))
    useInteractionStore.getState().setActiveAnnotation(null)
  }

  const editPin = (ann: CommittedAnnotation) => {
    const store = useInteractionStore.getState()
    store.setCursorMode("NOTE_APPEND")
    // activeAnnotation is already set (it's the popover trigger)
  }

  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ width: el.offsetWidth, height: el.offsetHeight })
    })
    ro.observe(el)
    setSize({ width: el.offsetWidth, height: el.offsetHeight })
    return () => ro.disconnect()
  }, [pageRef])

  useEffect(() => {
    if (blinkTarget && blinkTarget.page === pageNumber) {
      const timer = setTimeout(() => {
        useInteractionStore.getState().setBlinkTarget(null)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [blinkTarget, pageNumber])

  if (!size.width) return null

  const liveBoxes = cursorMode === "NOTE_APPEND"
    ? snippetsForPage(activeSelectionGroup, pageNumber)
    : snippetsForPage(selectionSnippets, pageNumber)

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {/* Committed annotations — pink and dashed */}
      {committedAnnotations.map((ann: CommittedAnnotation) =>
        ann.target_snippets
          .filter((s) => s.page_number === pageNumber)
          .flatMap((s, si) =>
            s.boxes.map((box, bi) => (
              <div
                key={`${ann.annotation_id}-${si}-${bi}`}
                className="doodle-mark doodle-mark--pink"
                onClick={(e) => { e.stopPropagation(); setActiveAnnotation(activeAnnotationId === ann.annotation_id ? null : ann.annotation_id) }}
                style={{
                  position: "absolute",
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                  opacity: activeAnnotationId === ann.annotation_id ? 1 : 0.7,
                  cursor: "pointer",
                  pointerEvents: "auto",
                }}
              >
                {activeAnnotationId === ann.annotation_id && (
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: `calc(100% + 4px)`,
                      pointerEvents: "auto",
                      background: "#FFFFFF",
                      border: "1px solid #E8E0D5",
                      borderRadius: 10,
                      boxShadow: "0 4px 16px rgba(26,53,87,0.18)",
                      padding: 10,
                      width: 260,
                      zIndex: 20,
                      fontFamily: "system-ui, sans-serif",
                    }}
                  >
                    {ann.note_text && (
                      <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "#1A1A2E", lineHeight: 1.4 }}>
                        {ann.note_text}
                      </p>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => sendToTool(ann, "Infinite Wiki")} style={popBtn(true)}>Wiki</button>
                      <button onClick={() => sendToTool(ann, "Chat")} style={popBtn(false)}>Ask in Chat</button>
                      <button onClick={() => editPin(ann)} style={popBtn(false)}>Edit Pin</button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )
      )}
      {/* Live selection — hand-drawn yellow marker */}
      {liveBoxes.map((box, i) => (
        <div
          key={`live-${i}`}
          className="doodle-mark doodle-mark--yellow"
          style={{
            position: "absolute",
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
          }}
        />
      ))}
      
      {/* Blinking Target overlay */}
      {blinkTarget && blinkTarget.page === pageNumber && blinkTarget.boxes.map((box, i) => (
        <div
          key={`blink-${i}`}
          style={{
            position: "absolute",
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
            background: "rgba(234, 179, 8, 0.4)",
            animation: "blink 0.5s alternate infinite",
            borderRadius: 4,
            pointerEvents: "none",
          }}
        />
      ))}
    </div>
  )
}

function popBtn(primary: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "6px 8px",
    borderRadius: 7,
    border: primary ? "none" : "1px solid #E8E0D5",
    background: primary ? "#1A3557" : "#FFFFFF",
    color: primary ? "#FAF7F2" : "#1A3557",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  }
}
