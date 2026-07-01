import { useEffect, useState } from "react"
import { ScoreBar } from "./ScoreBar"
import { useGraphStore } from "../../store/graphStore"
import { useSessionStore } from "../../store/sessionStore"
import type { AppSession } from "../../App"

interface Props {
  session: AppSession | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  onClose: () => void
}

interface TrajectoryItem {
  node_id: string
  classification: string
  reasoning: string
  evidence?: string[]
  ts: number
}

const CLASS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  building_basics: { bg: "#FEF2E8", fg: "#92400E", label: "Building basics" },
  foundational: { bg: "#EEF3F8", fg: "#4A7FB5", label: "Foundational" },
  comfortable: { bg: "#E6F4ED", fg: "#2D6A4F", label: "Comfortable" },
  sophisticated: { bg: "#1A3557", fg: "#FFFFFF", label: "Sophisticated" },
}

function ClassBadge({ c }: { c: string }) {
  const s = CLASS_STYLE[c] ?? { bg: "#EEF3F8", fg: "#1A3557", label: c }
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 10, fontFamily: "system-ui" }}>
      {s.label}
    </span>
  )
}

export function EvaluationView({ session, sendEvent, onClose }: Props) {
  const { nodes, assessments } = useGraphStore()
  const { familiarity } = useSessionStore()
  const [trajectory, setTrajectory] = useState<TrajectoryItem[]>([])
  const [evaluating, setEvaluating] = useState(false)

  const loadTrajectory = () => {
    if (!session?.documentId) return
    fetch(`/session/trajectory/${session.documentId}`)
      .then((r) => r.json())
      .then((d) => setTrajectory(d.trajectory || []))
      .catch(() => { })
  }

  useEffect(() => {
    loadTrajectory()
    const onDone = () => { setEvaluating(false); loadTrajectory() }
    window.addEventListener("evaluation-done", onDone)
    return () => window.removeEventListener("evaluation-done", onDone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reevaluate = () => {
    setEvaluating(true)
    sendEvent("EVALUATE_SESSION", {
      topic: session?.topic,
      familiarity,
      document_id: session?.documentId ?? "",
    })
  }

  const conceptNodes = nodes.filter((n) => n.data.depth !== 0)

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(26,53,87,0.25)", display: "flex", justifyContent: "center", padding: "32px 0" }}>
      <div style={{ width: "min(880px, 92vw)", background: "#FDFBF7", borderRadius: 12, boxShadow: "0 12px 48px rgba(26,53,87,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderBottom: "1px solid #E8E0D5", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-hand)", fontSize: 24, color: "#1A3557", flex: 1 }}>Evaluation & Trajectory</span>
          <button onClick={reevaluate} disabled={evaluating} style={btn(true)}>{evaluating ? "Evaluating…" : "Re-evaluate"}</button>
          <button onClick={onClose} style={{ ...btn(false), border: "none", fontSize: 18 }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 40px" }}>
          {/* Per-node reasoned scores */}
          <h3 style={{ fontFamily: "var(--font-serif)", color: "#1A3557", fontSize: 17, margin: "4px 0 12px" }}>Per-concept mastery</h3>
          {conceptNodes.length === 0 && (
            <p style={{ color: "#9CA3AF", fontSize: 14 }}>No concepts yet.</p>
          )}
          {conceptNodes.map((n) => {
            const a = assessments[n.id]
            return (
              <div key={n.id} style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #EFE9E0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700, color: "#1A1A2E", fontSize: 15, flex: 1 }}>{n.data.label}</span>
                  {a && <ClassBadge c={a.classification} />}
                </div>
                <ScoreBar scores={n.data.scores} />
                {a?.reasoning && (
                  <p style={{ margin: "8px 0 0", fontSize: 13, color: "#4A5568", lineHeight: 1.5, fontStyle: "italic" }}>{a.reasoning}</p>
                )}
                {a?.evidence && a.evidence.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5, color: "#6B7280" }}>
                    {a.evidence.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </div>
            )
          })}

          {/* Trajectory timeline */}
          <h3 style={{ fontFamily: "var(--font-serif)", color: "#1A3557", fontSize: 17, margin: "20px 0 12px" }}>Learning trajectory</h3>
          {trajectory.length === 0 ? (
            <p style={{ color: "#9CA3AF", fontSize: 14 }}>No history yet -&gt; Push / Re-evaluate to record a snapshot.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {trajectory.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13 }}>
                  <span style={{ color: "#9CA3AF", fontSize: 11, minWidth: 110 }}>
                    {new Date(t.ts * 1000).toLocaleString()}
                  </span>
                  <ClassBadge c={t.classification} />
                  <span style={{ color: "#4A5568", flex: 1 }}>{t.reasoning}</span>
                </div>
              ))}
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
