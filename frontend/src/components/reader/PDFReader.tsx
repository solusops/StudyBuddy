import { useCallback, useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"
import { useInteractionStore, type SelectionSnippet } from "../../store/interactionStore"
import { useContextStore } from "../../store/contextStore"
import { HighlightLayer } from "./HighlightLayer"
import { RegionLayer } from "./RegionLayer"
import { MarginGutter } from "./MarginGutter"
import { PdfLoupe } from "./PdfLoupe"

// pdf.js worker -> Vite serves this from node_modules
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
  const { cursorMode, pushSnippet, setAnnotations, blinkTarget } = useInteractionStore()
  const { setSelection } = useContextStore()
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [pageHeights, setPageHeights] = useState<Map<number, number>>(new Map())

  // Resize observer to match PDF to container
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      setPageWidth(Math.max(300, w - 32 - 280))
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
      .catch(() => { })
  }, [documentId, setAnnotations])

  // Scroll to blinkTarget
  useEffect(() => {
    if (blinkTarget && blinkTarget.page) {
      const el = pageRefs.current.get(blinkTarget.page)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }
  }, [blinkTarget])

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
    // The text layer is in the DOM after render -> extract it
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
  const toNorm = (rect: DOMRect, pageEl: Element): { x: number, y: number, w: number, h: number } => {
    const pr = pageEl.getBoundingClientRect()
    return {
      x: (rect.left - pr.left) / pr.width,
      y: (rect.top - pr.top) / pr.height,
      w: rect.width / pr.width,
      h: rect.height / pr.height,
    }
  }

  const handlePointerUp = useCallback((pageNumber: number, _e: React.PointerEvent) => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return
    }
    const range = sel.getRangeAt(0)
    const text = range.toString().trim()
    if (!text) {
      return
    }
    const pageEl = pageRefs.current.get(pageNumber)
    if (!pageEl) return
    const rects = Array.from(range.getClientRects())
    const boxes = rects
      .filter((r) => r.width > 2)
      .map((r) => ({ page: pageNumber, ...toNorm(r, pageEl) }))
    const snippet: SelectionSnippet = { page_number: pageNumber, text, boxes }

    if (cursorMode === "NOTE_APPEND") {
      pushSnippet(snippet)
      sel.removeAllRanges()
    } else {
      // Read (DEFAULT) mode -> push to Context Broker for Chat/Infinite Wiki
      const pageText = pageTexts.current.get(pageNumber) ?? ""
      const idx = pageText.indexOf(text.slice(0, 40))
      const surrounding = idx >= 0
        ? pageText.slice(Math.max(0, idx - 200), idx + text.length + 200)
        : pageText.slice(0, 400)

      const store = useContextStore.getState()
      const isFirst = !store.selectionText
      const nextSnippets = isFirst ? [snippet] : [...store.selectionSnippets, snippet]
      const nextText = isFirst ? text : `${store.selectionText} … ${text}`
      const nextSurrounding = isFirst ? surrounding : `${store.surroundingContext}\n---\n${surrounding}`

      setSelection(nextSnippets, nextText, nextSurrounding)
      // Clear native range so only custom highlight layers remain
      sel.removeAllRanges()
    }
  }, [cursorMode, pushSnippet, setSelection])

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
              style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 0 }}
            >
              <div
                data-page-number={pgNum}
                ref={(el) => { if (el) pageRefs.current.set(pgNum, el as HTMLDivElement) }}
                onPointerUp={(e) => handlePointerUp(pgNum, e)}
                style={{
                  position: "relative",
                  boxShadow: "0 2px 16px rgba(26,53,87,0.12)",
                  borderRadius: 4,
                  overflow: "hidden",
                  background: "#FFFFFF",
                  flexShrink: 0,
                }}
              >
                <Page
                  pageNumber={pgNum}
                  width={pageWidth}
                  renderTextLayer
                  renderAnnotationLayer
                  customTextRenderer={customTextRenderer}
                  onRenderSuccess={(page) => {
                    handlePageRenderSuccess({ pageNumber: pgNum })
                    const el = pageRefs.current.get(pgNum)
                    if (el) {
                      setPageHeights((prev) => {
                        const next = new Map(prev)
                        next.set(pgNum, el.offsetHeight || page.height)
                        return next
                      })
                    }
                  }}
                />
                <HighlightLayer
                  pageNumber={pgNum}
                  pageRef={{ current: pageRefs.current.get(pgNum) ?? null }}
                />
                <RegionLayer
                  pageNumber={pgNum}
                  pageIndex={pgNum - 1}
                  documentId={documentId}
                  sessionId={sessionId}
                  fileUrl={fileUrl}
                />
              </div>
              <MarginGutter
                pageNumber={pgNum}
                pageHeightPx={pageHeights.get(pgNum) ?? 0}
                documentId={documentId}
                sessionId={sessionId}
              />
            </div>
          )
        })}
      </Document>
      <PdfLoupe active={cursorMode === "MAGNIFY"} containerRef={containerRef} />
    </div>
  )
}
