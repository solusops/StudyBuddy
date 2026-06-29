import { useEffect, useRef, useState } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"
import { useContextStore } from "../../store/contextStore"
import { useSessionStore } from "../../store/sessionStore"
import { splitFencedBlocks } from "../../lib/chatBlocks"
import { MermaidBlock } from "../study-tools/MermaidBlock"
import { PlotlyBlock } from "../study-tools/PlotlyBlock"
import { VisualSandbox } from "./VisualSandbox"
import type { HTML5VisualPayload } from "../../types"

interface ReportSection {
  id: string
  topic: string
  content: string
  streaming: boolean
  visual?: HTML5VisualPayload | null
}

interface Props {
  isActive: boolean
  sendEvent: (type: string, data?: Record<string, unknown>) => void
}

function renderMath(text: string): string {
  const tex = (src: string, display: boolean) => {
    try {
      return katex.renderToString(src, { displayMode: display, throwOnError: false })
    } catch {
      return display ? `$$${src}$$` : `$${src}$`
    }
  }
  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => tex(m, true))
    .replace(/\$([^$\n]+?)\$/g, (_, m) => tex(m, false))
}

function renderInline(text: string): string {
  let r = renderMath(text)
  r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  return r
}

function renderProse(text: string) {
  const cleaned = text.replace(/\[Source:\s*[^\]]*\]/gi, "")
  const lines = cleaned.split(/\r?\n/)
  const out: React.ReactNode[] = []
  let bullets: string[] = []
  const flush = (k: string | number) => {
    if (bullets.length) {
      out.push(
        <ul key={`u-${k}`} style={{ margin: "0 0 12px", paddingLeft: 22, lineHeight: 1.7 }}>
          {bullets.map((b, i) => <li key={i} dangerouslySetInnerHTML={{ __html: renderInline(b) }} />)}
        </ul>
      )
      bullets = []
    }
  }
  lines.forEach((line, i) => {
    const t = line.trim()
    if (!t) return
    if (t.startsWith("#")) {
      flush(i)
      out.push(
        <h2 key={i} style={{ fontFamily: "var(--font-serif)", color: "#1A3557", fontSize: 20, fontWeight: 700, margin: "18px 0 8px", borderBottom: "1px solid #E8E0D5", paddingBottom: 4 }}
          dangerouslySetInnerHTML={{ __html: renderInline(t.replace(/^#+\s*/, "")) }} />
      )
      return
    }
    if (t.startsWith("* ") || t.startsWith("- ")) { bullets.push(t.replace(/^[*-]\s*/, "")); return }
    flush(i)
    out.push(<p key={i} style={{ margin: "0 0 12px", lineHeight: 1.75 }} dangerouslySetInnerHTML={{ __html: renderInline(t) }} />)
  })
  flush("end")
  return out
}

function ReportMarkdown({ text }: { text: string }) {
  return (
    <>
      {splitFencedBlocks(text).map((b, i) => {
        if (b.type === "mermaid") return <MermaidBlock key={i} code={b.content} />
        if (b.type === "plotly") return <PlotlyBlock key={i} spec={b.content} />
        return <div key={i}>{renderProse(b.content)}</div>
      })}
    </>
  )
}

export function ReportCanvas({ isActive, sendEvent }: Props) {
  const [sections, setSections] = useState<ReportSection[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  const { selectionText, surroundingContext } = useContextStore()
  const { familiarity, knowledgeMode } = useSessionStore()
  const lastFired = useRef("")
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stream events route to sections by section_id.
  useEffect(() => {
    const onToken = (e: Event) => {
      const { section_id, token } = (e as CustomEvent).detail
      setSections((prev) => prev.map((s) => (s.id === section_id ? { ...s, content: s.content + token } : s)))
    }
    const onDone = (e: Event) => {
      const { section_id } = (e as CustomEvent).detail
      setSections((prev) => prev.map((s) => (s.id === section_id ? { ...s, streaming: false } : s)))
    }
    const onVisual = (e: Event) => {
      const { section_id, visual } = (e as CustomEvent).detail
      setSections((prev) => prev.map((s) => (s.id === section_id ? { ...s, visual } : s)))
    }
    window.addEventListener("report-token", onToken)
    window.addEventListener("report-done", onDone)
    window.addEventListener("report-section-visual", onVisual)
    return () => {
      window.removeEventListener("report-token", onToken)
      window.removeEventListener("report-done", onDone)
      window.removeEventListener("report-section-visual", onVisual)
    }
  }, [])

  const addSection = (topic: string, surrounding: string) => {
    if (!topic.trim() || topic === lastFired.current) return
    lastFired.current = topic
    const id = `sec_${Date.now()}`
    setSections((prev) => [...prev, { id, topic, content: "", streaming: true, visual: null }])
    sendEvent("REPORT_REQUEST", {
      section_id: id,
      selection_text: topic,
      surrounding_context: surrounding,
      familiarity,
      knowledge_mode: knowledgeMode,
    })
  }

  // Auto-compile a section when the student highlights text with the Report tab open.
  useEffect(() => {
    if (!isActive || !selectionText) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => addSection(selectionText, surroundingContext), 500)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, selectionText, surroundingContext])

  const submitEdit = (s: ReportSection) => {
    if (!editText.trim()) { setEditing(null); return }
    setSections((prev) => prev.map((x) => (x.id === s.id ? { ...x, content: "", streaming: true, visual: null } : x)))
    sendEvent("REPORT_EDIT", {
      section_id: s.id,
      selection_text: s.topic,
      edit_instruction: editText,
      familiarity,
      knowledge_mode: knowledgeMode,
    })
    setEditing(null)
    setEditText("")
  }

  if (!isActive) return null

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid #E8E0D5", flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--font-hand)", fontSize: 20, color: "#1A3557", flex: 1 }}>Research Report</span>
        {sections.length > 0 && (
          <button onClick={() => window.print()} style={publishBtn}>Publish (Print A4)</button>
        )}
        {sections.length > 0 && (
          <button onClick={() => { setSections([]); lastFired.current = "" }} style={clearBtn}>Clear</button>
        )}
      </div>

      <div className="report-print" style={{ flex: 1, overflow: "auto", padding: "16px 20px 48px" }}>
        {sections.length === 0 ? (
          <div style={{ color: "#9CA3AF", fontSize: 14, fontFamily: "var(--font-serif)", textAlign: "center", paddingTop: 40 }}>
            <p>Highlight a passage in Read mode.</p>
            <p style={{ fontSize: 12, marginTop: 8 }}>The report compiles a textbook-style section — with embedded visuals — for each one.</p>
          </div>
        ) : (
          sections.map((s) => (
            <div key={s.id} style={{ marginBottom: 28, fontFamily: "var(--font-serif)", fontSize: 15.5, color: "#1A1A2E" }}>
              <ReportMarkdown text={s.content} />
              {s.streaming && (
                <span style={{ display: "inline-block", width: 8, height: 14, background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "middle" }} />
              )}
              {s.visual && (
                <div style={{ marginTop: 12 }}>
                  <VisualSandbox visual={s.visual} nodeId={s.id} animationType={s.visual.animation_type} height={300} />
                </div>
              )}
              {!s.streaming && (
                <div className="report-noprint" style={{ marginTop: 8 }}>
                  {editing === s.id ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") submitEdit(s) }}
                        placeholder="e.g. make it simpler, add a bar chart…"
                        style={{ flex: 1, border: "1px solid #E8E0D5", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontFamily: "system-ui" }}
                      />
                      <button onClick={() => submitEdit(s)} style={editBtn}>Rewrite</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditing(s.id); setEditText("") }} style={editBtn}>✎ Edit this section</button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const publishBtn: React.CSSProperties = { background: "#1A3557", color: "#FAF7F2", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }
const clearBtn: React.CSSProperties = { background: "transparent", color: "#9CA3AF", border: "1px solid #E8E0D5", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" }
const editBtn: React.CSSProperties = { background: "#EEF3F8", color: "#1A3557", border: "1px solid #4A7FB5", borderRadius: 7, padding: "5px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }
