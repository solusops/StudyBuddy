import { useMemo, useState } from "react"
import { useSessionStore } from "../../store/sessionStore"
import { useInteractionStore } from "../../store/interactionStore"
import type { MCQOption } from "../../types"
import katex from "katex"
import "katex/dist/katex.min.css"

function renderMath(text: string) {
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g)
  return parts.map((part, i) => {
    if (part.startsWith("$$") && part.endsWith("$$")) {
      const math = part.slice(2, -2)
      try { return <div key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: true }) }} /> }
      catch { return <div key={i}>{part}</div> }
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      const math = part.slice(1, -1)
      try { return <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: false }) }} /> }
      catch { return <span key={i}>{part}</span> }
    }
    return <span key={i}>{part}</span>
  })
}

const ViewSourceIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
)

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  nodeId: string
  familiarity: string
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

export function QuizTool({ sendEvent, nodeId, familiarity }: Props) {
  const { quizQuestions, quizContextImages, setQuizQuestions } = useSessionStore()
  const { setBlinkTarget } = useInteractionStore()
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    setQuizQuestions([])
    setQIndex(0)
    setSelected(null)
    sendEvent("QUIZ_REQUEST", { node_id: nodeId, node_label: nodeId, familiarity })
    const unsub = useSessionStore.subscribe((state) => {
      if (state.quizQuestions.length > 0) { setLoading(false); unsub() }
    })
  }

  const currentQ = quizQuestions[qIndex]

  // Shuffle options once per question
  const shuffledOptions = useMemo<MCQOption[]>(
    () => (currentQ ? shuffle(currentQ.options) : []),
    [qIndex, quizQuestions.length]
  )

  const choose = (i: number) => {
    if (selected !== null) return
    setSelected(i)
    const wasCorrect = shuffledOptions[i].is_correct
    const correct = shuffledOptions.find((o) => o.is_correct)?.text ?? ""
    sendEvent("QUIZ_SUBMIT", {
      node_id: nodeId,
      question: currentQ.question,
      chosen: shuffledOptions[i].text,
      was_correct: wasCorrect,
      correct,
    })
  }

  if (!quizQuestions.length) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <button onClick={load} disabled={loading} style={btnStyle}>
          {loading ? "Generating…" : "Generate Quiz"}
        </button>
      </div>
    )
  }

  if (qIndex >= quizQuestions.length) {
    return (
      <div style={{ textAlign: "center", padding: 32, color: "#1A3557", fontFamily: "var(--font-serif)" }}>
        <p style={{ marginBottom: 16 }}>Quiz complete!</p>
        <button onClick={() => { setQIndex(0); setSelected(null) }} style={btnStyle}>
          Retake
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 20 }}>
      {quizContextImages && quizContextImages.length > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, borderBottom: "1px solid #E2E8F0" }}>
          {quizContextImages.map((img, idx) => (
            <img key={idx} src={`data:image/png;base64,${img}`} alt="Context" style={{ height: 100, borderRadius: 6, objectFit: "contain", border: "1px solid #E2E8F0", background: "#FFFFFF", padding: 4 }} />
          ))}
        </div>
      )}
      <div style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>{qIndex + 1} / {quizQuestions.length}</div>
      <p style={{ color: "#0F172A", fontSize: 18, fontWeight: 700, fontFamily: "var(--font-serif)", lineHeight: 1.5, margin: 0 }}>
        {renderMath(currentQ.question)}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shuffledOptions.map((opt, i) => {
          const isSelected = selected === i
          const isCorrect = opt.is_correct
          let bg = "#FFFFFF"
          let border = "#E8E0D5"
          let color = "#1A1A2E"
          if (selected !== null) {
            if (isCorrect) { bg = "#E6F4ED"; border = "#2D6A4F"; color = "#2D6A4F" }
            else if (isSelected) { bg = "#FEF2E8"; border = "#92400E"; color = "#92400E" }
          }
          return (
            <button
              key={i}
              onClick={() => choose(i)}
              style={{
                background: bg,
                color,
                border: `1.5px solid ${border}`,
                borderRadius: 10,
                padding: "14px 18px",
                cursor: selected !== null ? "default" : "pointer",
                textAlign: "left",
                fontSize: 16,
                lineHeight: 1.4,
                fontWeight: selected !== null && (isCorrect || isSelected) ? 600 : 500,
                transition: "all 0.2s",
              }}
            >
              {selected !== null && isCorrect ? "✓ " : selected !== null && isSelected ? "✗ " : ""}
              {renderMath(opt.text)}
            </button>
          )
        })}
      </div>
      {selected !== null && (
        <div style={{ color: "#6B7280", fontSize: 13, fontStyle: "italic", fontFamily: "var(--font-serif)" }}>
          {renderMath(currentQ.explanation)}
        </div>
      )}
      {selected !== null && currentQ.source_location && (
        <button 
          onClick={() => setBlinkTarget(currentQ.source_location)} 
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#3B82F6", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0, marginTop: 4, width: "fit-content" }}
        >
          <ViewSourceIcon />
          View Source in PDF
        </button>
      )}
      {selected !== null && (
        <button onClick={() => { setQIndex((q) => q + 1); setSelected(null) }} style={{ ...btnStyle, alignSelf: "flex-end" }}>
          Next →
        </button>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: "#1A3557",
  color: "#FAF7F2",
  border: "none",
  borderRadius: 8,
  padding: "8px 20px",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
}
