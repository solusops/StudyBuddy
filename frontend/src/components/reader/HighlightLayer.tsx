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
  const { activeSelectionGroup, committedAnnotations, activeAnnotationId, setActiveAnnotation, cursorMode } =
    useInteractionStore()
  const { selectionSnippets } = useContextStore()
  const [size, setSize] = useState<PageSize>({ width: 0, height: 0 })

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
                onClick={(e) => { e.stopPropagation(); setActiveAnnotation(ann.annotation_id) }}
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
              />
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
    </div>
  )
}
