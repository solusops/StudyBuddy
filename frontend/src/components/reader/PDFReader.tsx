import { useCallback, useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"
import { useInteractionStore, type SelectionSnippet } from "../../store/interactionStore"
import { HighlightLayer } from "./HighlightLayer"

// pdf.js worker — Vite serves this from node_modules
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()

interface Props {
  fileUrl: string
  concepts: string[]
  onPageTextReady?: (pageNum: number, text: string) => void
  onConceptClick?: (concept: string) => void
  documentId?: string
  sessionId?: string
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function PDFReader({ fileUrl, concepts, onPageTextReady, onConceptClick, documentId, sessionId }: Props) {
  const [numPages, setNumPages] = useState<number>(0)
  const [pageWidth, setPageWidth] = useState(600)
  const containerRef = useRef<HTMLDivElement>(null)
  const pageTexts = useRef<Map<number, string>>(new Map())
  const { cursorMode, pushSnippet, clearGroup, addAnnotation, setAnnotations } = useInteractionStore()
  const [pendingNote, setPendingNote] = useState("")
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [noteAnchorPos, setNoteAnchorPos] = useState<{x: number, y: number} | null>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Resize observer to match PDF to container
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      setPageWidth(Math.max(400, w - 32))
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Load committed annotations from backend when document is known
  useEffect(() => {
    if (!documentId) return
    fetch(`/annotations/${documentId}`)
      .then((r) => r.json())
      .then((data) => setAnnotations(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [documentId, setAnnotations])

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
  }

  // Highlight concept terms in page text layer
  const customTextRenderer = useCallback(
    ({ str }: { str: string }) => {
      if (!str.trim() || !concepts.length) return escapeHtml(str)
      let result = escapeHtml(str)
      for (const concept of concepts) {
        if (!concept.trim()) continue
        const re = new RegExp(`(${escapeRegex(concept)})`, "gi")
        result = result.replace(
          re,
          `<mark class="concept-hl" data-concept="$1" style="background:rgba(26,53,87,0.15);color:inherit;border-radius:2px;padding:1px 2px;cursor:pointer;">$1</mark>`
        )
      }
      return result
    },
    [concepts]
  )

  // Capture page text for concept identification
  const handlePageRenderSuccess = (page: { pageNumber: number }) => {
    // The text layer is in the DOM after render — extract it
    setTimeout(() => {
      const pageEl = containerRef.current?.querySelector(
        `[data-page-number="${page.pageNumber}"] .react-pdf__Page__textContent`
      )
      if (!pageEl) return
      const text = pageEl.textContent || ""
      if (!pageTexts.current.has(page.pageNumber)) {
        pageTexts.current.set(page.pageNumber, text)
        onPageTextReady?.(page.pageNumber, text)
      }
    }, 200)
  }

  // Convert a DOMRect to normalised coords relative to the page element
  const toNorm = (rect: DOMRect, pageEl: Element): {x: number, y: number, w: number, h: number} => {
    const pr = pageEl.getBoundingClientRect()
    return {
      x: (rect.left - pr.left) / pr.width,
      y: (rect.top - pr.top) / pr.height,
      w: rect.width / pr.width,
      h: rect.height / pr.height,
    }
  }

  const handlePointerUp = useCallback((pageNumber: number, e: React.PointerEvent) => {
    if (cursorMode !== "NOTE_APPEND") return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    const text = range.toString().trim()
    if (!text) return
    const pageEl = pageRefs.current.get(pageNumber)
    if (!pageEl) return
    const rects = Array.from(range.getClientRects())
    const boxes = rects
      .filter((r) => r.width > 2)
      .map((r) => ({ page: pageNumber, ...toNorm(r, pageEl) }))
    const snippet: SelectionSnippet = { page_number: pageNumber, text, boxes }
    pushSnippet(snippet)
    sel.removeAllRanges()
    // Show note input near the last box
    const lastBox = rects[rects.length - 1]
    if (lastBox) setNoteAnchorPos({ x: e.clientX, y: lastBox.bottom + 8 })
    setShowNoteInput(true)
  }, [cursorMode, pushSnippet])

  const commitAnnotation = async () => {
    const { activeSelectionGroup, documentId: docId } = useInteractionStore.getState()
    if (!activeSelectionGroup.length || !docId || !sessionId) return
    const annotation = {
      document_id: docId,
      session_id: sessionId,
      target_snippets: activeSelectionGroup,
      note_text: pendingNote || null,
    }
    const resp = await fetch("/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotation),
    })
    if (resp.ok) {
      const created = await resp.json()
      addAnnotation(created)
      clearGroup()
      setPendingNote("")
      setShowNoteInput(false)
      setNoteAnchorPos(null)
    }
  }

  // Delegate concept clicks from text layer
  useEffect(() => {
    const el = containerRef.current
    if (!el || !onConceptClick) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const concept = target.getAttribute("data-concept")
      if (concept) onConceptClick(concept)
    }
    el.addEventListener("click", handler)
    return () => el.removeEventListener("click", handler)
  }, [onConceptClick])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflowY: "auto",
        background: "#F5F0EB",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
      }}
    >
      <Document
        file={fileUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={
          <div style={{ color: "#9CA3AF", padding: 40, fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
            Loading document…
          </div>
        }
        error={
          <div style={{ color: "#EF4444", padding: 40 }}>
            Could not load PDF. Check the file path.
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => {
          const pgNum = i + 1
          return (
            <div
              key={pgNum}
              data-page-number={pgNum}
              ref={(el) => { if (el) pageRefs.current.set(pgNum, el as HTMLDivElement) }}
              onPointerUp={(e) => handlePointerUp(pgNum, e)}
              style={{
                position: "relative",
                boxShadow: "0 2px 16px rgba(26,53,87,0.12)",
                borderRadius: 4,
                overflow: "hidden",
                background: "#FFFFFF",
              }}
            >
              <Page
                pageNumber={pgNum}
                width={pageWidth}
                renderTextLayer
                renderAnnotationLayer
                customTextRenderer={customTextRenderer}
                onRenderSuccess={() => handlePageRenderSuccess({ pageNumber: pgNum })}
              />
              <HighlightLayer
                pageNumber={pgNum}
                pageRef={{ current: pageRefs.current.get(pgNum) ?? null }}
              />
            </div>
          )
        })}
      </Document>
      {/* Floating note commit panel */}
      {showNoteInput && noteAnchorPos && (
        <div
          style={{
            position: "fixed",
            left: Math.min(noteAnchorPos.x, window.innerWidth - 320),
            top: noteAnchorPos.y,
            zIndex: 1001,
            background: "#FFFFFF",
            border: "1px solid #E8E0D5",
            borderRadius: 10,
            boxShadow: "0 4px 20px rgba(26,53,87,0.15)",
            padding: 12,
            width: 300,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>
            Add a note (optional)
          </p>
          <textarea
            autoFocus
            value={pendingNote}
            onChange={(e) => setPendingNote(e.target.value)}
            placeholder="Type your note…"
            rows={3}
            style={{
              width: "100%",
              border: "1px solid #E8E0D5",
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 14,
              resize: "none",
              boxSizing: "border-box",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => { clearGroup(); setShowNoteInput(false); setPendingNote("") }}
              style={{ background: "transparent", border: "1px solid #E8E0D5", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 13, color: "#6B7280" }}
            >
              Cancel
            </button>
            <button
              onClick={commitAnnotation}
              style={{ background: "#1A3557", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 13, color: "#FAF7F2", fontWeight: 600 }}
            >
              Save annotation
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
