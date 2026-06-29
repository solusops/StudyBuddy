import { useCallback, useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"

// pdf.js worker — Vite serves this from node_modules
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()

interface Props {
  fileUrl: string               // file:// URL or blob URL
  concepts: string[]            // concept terms to highlight
  onPageTextReady?: (pageNum: number, text: string) => void
  onConceptClick?: (concept: string) => void
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

export function PDFReader({ fileUrl, concepts, onPageTextReady, onConceptClick }: Props) {
  const [numPages, setNumPages] = useState<number>(0)
  const [pageWidth, setPageWidth] = useState(600)
  const containerRef = useRef<HTMLDivElement>(null)
  const pageTexts = useRef<Map<number, string>>(new Map())

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
        {Array.from({ length: numPages }, (_, i) => (
          <div
            key={i + 1}
            data-page-number={i + 1}
            style={{
              boxShadow: "0 2px 16px rgba(26,53,87,0.12)",
              borderRadius: 4,
              overflow: "hidden",
              background: "#FFFFFF",
            }}
          >
            <Page
              pageNumber={i + 1}
              width={pageWidth}
              renderTextLayer
              renderAnnotationLayer
              customTextRenderer={customTextRenderer}
              onRenderSuccess={() => handlePageRenderSuccess({ pageNumber: i + 1 })}
            />
          </div>
        ))}
      </Document>
    </div>
  )
}
