import React, { useEffect, useState, useRef } from "react"
import { useContextStore } from "../../store/contextStore"
import { useInteractionStore } from "../../store/interactionStore"

interface Region {
  id: string
  type: string
  bbox_norm: { x: number; y: number; w: number; h: number }
  caption: string
  extracted_content: string
  crop_base64: string
}

interface Props {
  pageNumber: number // 1-based (display + snippet)
  pageIndex: number // 0-based (backend)
  documentId?: string
  sessionId?: string
  fileUrl: string
}

// Read the PDF bytes once per document, shared across all page layers.
const _pdfB64Cache = new Map<string, Promise<string>>()

async function pdfToBase64(fileUrl: string): Promise<string> {
  const buf = await (await fetch(fileUrl)).arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function RegionLayer({ pageNumber, pageIndex, documentId, sessionId, fileUrl }: Props) {
  const regionsOn = useInteractionStore((s) => s.regionsOn)
  const addAnnotation = useInteractionStore((s) => s.addAnnotation)
  const { setSelection } = useContextStore()
  const [regions, setRegions] = useState<Region[] | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [selected, setSelected] = useState<string | null>(null)

  // Drag-to-select state
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)
  const [tempSnip, setTempSnip] = useState<Region | null>(null)

  const fetchStartedRef = React.useRef(false)

  // Reset when page or document changes so we re-fetch for the new page.
  useEffect(() => {
    setRegions(null)
    setStatus("idle")
    fetchStartedRef.current = false
  }, [documentId, pageIndex])

  useEffect(() => {
    if (!regionsOn || !documentId || fetchStartedRef.current) return
    fetchStartedRef.current = true
    let cancelled = false

    const run = async () => {
      setStatus("loading")
      try {
        const post = (pdf_base64?: string) =>
          fetch("/regions/segment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ document_id: documentId, page_number: pageIndex, pdf_base64 }),
          })

        let resp = await post()
        if (resp.status === 409) {
          // Server hasn't cached the PDF yet -> upload the bytes once, then retry.
          if (!_pdfB64Cache.has(documentId!)) _pdfB64Cache.set(documentId!, pdfToBase64(fileUrl))
          const b64 = await _pdfB64Cache.get(documentId!)!
          resp = await post(b64)
        }
        if (!resp.ok) throw new Error(`segment failed: ${resp.status}`)
        const data = await resp.json()
        if (!cancelled) {
          setRegions(data.regions || [])
          setStatus("idle")
        }
      } catch (e) {
        if (!cancelled) {
          console.error("RegionLayer segment error:", e)
          setRegions([])   // Mark as resolved (empty) to stop infinite retry loop
          setStatus("error")
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [regionsOn, documentId, pageIndex, fileUrl])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!regionsOn || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setDragStart({ x, y })
    setDragCurrent({ x, y })
    setIsDragging(true)
    setSelected(null)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !containerRef.current || !dragStart) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    setDragCurrent({ x, y })
  }

  const handlePointerUp = async () => {
    if (!isDragging || !dragStart || !dragCurrent) return
    setIsDragging(false)

    const x0 = Math.min(dragStart.x, dragCurrent.x)
    const x1 = Math.max(dragStart.x, dragCurrent.x)
    const y0 = Math.min(dragStart.y, dragCurrent.y)
    const y1 = Math.max(dragStart.y, dragCurrent.y)

    setDragStart(null)
    setDragCurrent(null)

    // Ignore tiny accidental clicks
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return

    const bbox_norm = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    const snipId = `snip_temp_${Date.now()}`

    // Show a loading temporary region
    setTempSnip({
      id: snipId,
      type: "Snipping...",
      bbox_norm,
      caption: "",
      extracted_content: "",
      crop_base64: ""
    })
    setSelected(snipId)

    try {
      const post = (pdf_base64?: string) =>
        fetch("/regions/snip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_id: documentId, page_number: pageIndex, bbox_norm, pdf_base64 }),
        })

      let resp = await post()
      if (resp.status === 409) {
        if (!_pdfB64Cache.has(documentId!)) _pdfB64Cache.set(documentId!, pdfToBase64(fileUrl))
        const b64 = await _pdfB64Cache.get(documentId!)!
        resp = await post(b64)
      }

      if (resp.ok) {
        const finalSnip = await resp.json()
        setRegions((prev) => [...(prev || []), finalSnip])
        setTempSnip(null)
        setSelected(finalSnip.id)
      } else {
        setTempSnip(null)
      }
    } catch (e) {
      console.error("Snip failed", e)
      setTempSnip(null)
    }
  }


  if (!regionsOn || !documentId) return null

  const buildSnippet = (r: Region) => ({
    page_number: pageNumber,
    text: r.caption || r.type,
    boxes: [{ page: pageNumber, ...r.bbox_norm }],
  })

  const sendToTool = (r: Region, tool: "Infinite Wiki" | "Chat") => {
    const text = r.caption || r.type
    const surrounding = r.extracted_content || ""
    setSelection([buildSnippet(r)], text, surrounding, r.crop_base64)
    window.dispatchEvent(new CustomEvent("studybuddy-open-tool", { detail: { tool } }))
    setSelected(null)
  }

  const pin = async (r: Region) => {
    const note = [r.caption, r.extracted_content].filter(Boolean).join("\n\n")
    const annotation = {
      annotation_id: crypto.randomUUID(),
      document_id: documentId,
      session_id: sessionId || "",
      target_snippets: [buildSnippet(r)],
      note_text: note,
      image_base64: r.crop_base64,
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
    }
    try {
      if (documentId && sessionId) {
        await fetch("/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotation),
        })
      }
      addAnnotation(annotation)
    } catch (e) {
      console.error("pin region error:", e)
    }
    setSelected(null)
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: regionsOn ? "auto" : "none",
        zIndex: 5,
        cursor: regionsOn ? "crosshair" : "default",
        touchAction: regionsOn ? "none" : "auto"
      }}
    >
      {status === "loading" && (
        <div style={{
          position: "absolute", top: 8, left: 8, pointerEvents: "none",
          background: "rgba(26,53,87,0.85)", color: "#fff", fontSize: 11,
          padding: "3px 8px", borderRadius: 6, fontFamily: "system-ui, sans-serif",
        }}>
          Finding figures & tables…
        </div>
      )}

      {/* Dragging Selection Box */}
      {isDragging && dragStart && dragCurrent && (
        <div style={{
          position: "absolute",
          left: `${Math.min(dragStart.x, dragCurrent.x) * 100}%`,
          top: `${Math.min(dragStart.y, dragCurrent.y) * 100}%`,
          width: `${Math.abs(dragCurrent.x - dragStart.x) * 100}%`,
          height: `${Math.abs(dragCurrent.y - dragStart.y) * 100}%`,
          border: "2px dashed #4A7FB5",
          background: "rgba(74,127,181,0.2)",
          pointerEvents: "none"
        }} />
      )}

      {[...(regions || []), ...(tempSnip ? [tempSnip] : [])].map((r) => {
        const { x, y, w, h } = r.bbox_norm
        const isSel = selected === r.id
        return (
          <div key={r.id}>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setSelected(isSel ? null : r.id)}
              title={`${r.type}${r.caption ? ": " + r.caption : ""}`}
              style={{
                position: "absolute",
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
                pointerEvents: "auto",
                border: `2px ${isSel ? "solid" : "dashed"} #4A7FB5`,
                background: isSel ? "rgba(74,127,181,0.12)" : "rgba(74,127,181,0.05)",
                borderRadius: 4,
                cursor: "pointer",
                padding: 0,
              }}
            >
              <span style={{
                position: "absolute", top: -9, left: 6, background: "#1A3557", color: "#fff",
                fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                padding: "1px 5px", borderRadius: 4, fontFamily: "system-ui, sans-serif",
              }}>
                {r.type}
              </span>
            </button>

            {isSel && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  left: `${x * 100}%`,
                  top: `calc(${(y + h) * 100}% + 4px)`,
                  pointerEvents: "auto",
                  background: "#FFFFFF",
                  border: "1px solid #E8E0D5",
                  borderRadius: 10,
                  boxShadow: "0 4px 16px rgba(26,53,87,0.18)",
                  padding: 10,
                  width: 260,
                  zIndex: 10,
                  fontFamily: "system-ui, sans-serif",
                }}>
                {r.caption && (
                  <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "#1A1A2E", lineHeight: 1.4 }}>
                    {r.caption}
                  </p>
                )}
                {r.extracted_content && (
                  <pre style={{
                    margin: "0 0 8px", fontSize: 11, color: "#4A7FB5", background: "#FAF7F2",
                    border: "1px solid #E8E0D5", borderRadius: 6, padding: "6px 8px",
                    whiteSpace: "pre-wrap", maxHeight: 90, overflow: "auto",
                  }}>{r.extracted_content}</pre>
                )}
                {r.type === "Snipping..." ? (
                  <div style={{ fontSize: 12, color: "#1A1A2E", fontStyle: "italic", textAlign: "center", padding: "10px 0" }}>
                    Analyzing snippet via Gemma 4...
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => sendToTool(r, "Infinite Wiki")} style={popBtn(true)}>Wiki</button>
                    <button onClick={() => sendToTool(r, "Chat")} style={popBtn(false)}>Ask in Chat</button>
                    <button onClick={() => pin(r)} style={popBtn(false)}>Pin</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
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
