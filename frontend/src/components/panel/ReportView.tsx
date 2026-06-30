import { useEffect, useState } from "react"
import { ReportMarkdown } from "./ReportMarkdown"
import { VisualSandbox } from "./VisualSandbox"
import { useTokenRate } from "../../lib/useTokenRate"
import { useSessionStore } from "../../store/sessionStore"
import type { AppSession } from "../../App"
import type { HTML5VisualPayload } from "../../types"

interface Props {
  session: AppSession | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  onClose: () => void
}

export function ReportView({ session, sendEvent, onClose }: Props) {
  const { knowledgeMode } = useSessionStore()
  const [content, setContent] = useState("")
  const [streaming, setStreaming] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string } | null>(null)
  const [visual, setVisual] = useState<HTML5VisualPayload | null>(null)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState("")
  const rate = useTokenRate(content, streaming)

  const compile = (edit_instruction = "") => {
    setContent("")
    setVisual(null)
    setStreaming(true)
    setProgress(null)
    sendEvent("REPORT_COMPILE", {
      document_id: session?.documentId ?? "",
      topic: session?.topic ?? "",
      familiarity: session?.familiarity ?? "high_school",
      knowledge_mode: knowledgeMode,
      edit_instruction,
    })
  }

  // Compile on open.
  useEffect(() => {
    compile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onProg = (e: Event) => setProgress((e as CustomEvent).detail)
    const onToken = (e: Event) => setContent((c) => c + (e as CustomEvent).detail.token)
    const onDone = () => { setStreaming(false); setProgress(null) }
    const onVisual = (e: Event) => setVisual((e as CustomEvent).detail.visual)
    window.addEventListener("report-progress", onProg)
    window.addEventListener("report-token", onToken)
    window.addEventListener("report-done", onDone)
    window.addEventListener("report-section-visual", onVisual)
    return () => {
      window.removeEventListener("report-progress", onProg)
      window.removeEventListener("report-token", onToken)
      window.removeEventListener("report-done", onDone)
      window.removeEventListener("report-section-visual", onVisual)
    }
  }, [])

  const submitEdit = () => {
    if (!editText.trim()) { setEditing(false); return }
    compile(editText)
    setEditing(false)
    setEditText("")
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(26,53,87,0.25)", display: "flex", justifyContent: "center", padding: "32px 0" }}>
      <div style={{ width: "min(900px, 92vw)", background: "#FDFBF7", borderRadius: 12, boxShadow: "0 12px 48px rgba(26,53,87,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div className="report-noprint" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderBottom: "1px solid #E8E0D5", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-hand)", fontSize: 24, color: "#1A3557", flex: 1 }}>Research Report</span>
          {!streaming && (
            <>
              <button onClick={() => setEditing((v) => !v)} style={btn(false)}>✎ Revise</button>
              <button onClick={() => window.print()} style={btn(true)}>Publish (A4)</button>
            </>
          )}
          <button onClick={onClose} style={{ ...btn(false), border: "none", fontSize: 18 }}>×</button>
        </div>

        {editing && (
          <div className="report-noprint" style={{ display: "flex", gap: 8, padding: "10px 20px", borderBottom: "1px solid #E8E0D5" }}>
            <input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitEdit() }}
              placeholder="e.g. make it more concise, group by theme, add a comparison table…"
              style={{ flex: 1, border: "1px solid #E8E0D5", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "system-ui" }} />
            <button onClick={submitEdit} style={btn(true)}>Rewrite</button>
          </div>
        )}

        {progress && (
          <div className="report-noprint" style={{ padding: "8px 20px", fontSize: 13, color: "#4A7FB5", fontFamily: "system-ui" }}>
            {progress.stage === "reading notes"
              ? `Reading your notes… ${progress.done}/${progress.total}`
              : "Writing the report…"}
          </div>
        )}

        {/* Body */}
        <div className="report-print" style={{ flex: 1, overflow: "auto", padding: "20px 32px 48px", fontFamily: "var(--font-serif)", fontSize: 16, color: "#1A1A2E" }}>
          <ReportMarkdown text={content} />
          {streaming && <span style={{ display: "inline-block", width: 8, height: 16, background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "middle" }} />}
          {streaming && rate > 0 && <span className="ts-badge">{rate} t/s</span>}
          {visual && (
            <div style={{ marginTop: 16 }}>
              <VisualSandbox visual={visual} nodeId="report" animationType={visual.animation_type} height={320} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function btn(primary: boolean): React.CSSProperties {
  return {
    background: primary ? "#1A3557" : "transparent",
    color: primary ? "#FAF7F2" : "#1A3557",
    border: primary ? "none" : "1px solid #E8E0D5",
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  }
}
