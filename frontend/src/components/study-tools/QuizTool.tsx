import { useMemo, useState } from "react"
import { useSessionStore } from "../../store/sessionStore"
import { CheckCircle2, XCircle } from "lucide-react"
import { useInteractionStore } from "../../store/interactionStore"
import type { MCQOption } from "../../types"
import katex from "katex"
import "katex/dist/katex.min.css"

function parseText(text: string, sourceLocation: any, sourceChunkText: string | undefined, setBlinkTarget: any) {
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\[?chunk\s*\d+\]?)/gi)
  return parts.map((part, i) => {
    if (part.startsWith("$$") && part.endsWith("$$")) {
      const math = part.slice(2, -2)
      try { return <div key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: true, throwOnError: false }) }} style={{ margin: "12px 0" }} /> }
      catch { return <div key={i} style={{ margin: "12px 0" }}>{part}</div> }
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      const math = part.slice(1, -1)
      try { return <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: false, throwOnError: false }) }} /> }
      catch { return <span key={i}>{part}</span> }
    }
    if (/^\[?chunk\s*\d+\]?$/i.test(part)) {
      if (!sourceLocation && !sourceChunkText) return null;
      return (
        <button
          key={i}
          onClick={(e) => { 
            e.stopPropagation(); 
            if (sourceLocation) setBlinkTarget(sourceLocation); 
          }}
          style={{
            background: "none", border: "none", padding: 0, margin: "0 4px",
            color: sourceLocation ? "#3B82F6" : "#94A3B8", 
            cursor: sourceLocation ? "pointer" : "help", 
            display: "inline-flex", alignItems: "center", verticalAlign: "middle"
          }}
          title={sourceChunkText || "Source chunk text unavailable"}
        >
          <ViewSourceIcon />
        </button>
      )
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
  nodeLabel: string
  familiarity: string
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

export function QuizTool({ sendEvent, nodeId, nodeLabel, familiarity }: Props) {
  const { quizQuestions, setQuizQuestions } = useSessionStore()
  const { setBlinkTarget } = useInteractionStore()
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    setQuizQuestions([])
    setQIndex(0)
    setSelected(null)
    sendEvent("QUIZ_REQUEST", { node_id: nodeId, node_label: nodeLabel, familiarity })
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
      <div style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>{qIndex + 1} / {quizQuestions.length}</div>
      <h3 style={{ margin: "0 0 16px 0", color: "#1A3557", fontSize: 20, lineHeight: 1.4 }}>
        {parseText(currentQ.question, currentQ.source_location, currentQ.source_chunk_text, setBlinkTarget)}
      </h3>
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
              {selected !== null && isCorrect ? <span style={{ marginRight: 6 }}><CheckCircle2 size={16} color="green" /></span> : selected !== null && isSelected ? <span style={{ marginRight: 6 }}><XCircle size={16} color="red" /></span> : null}
              {parseText(opt.text, currentQ.source_location, currentQ.source_chunk_text, setBlinkTarget)}
            </button>
          )
        })}
      </div>
      {selected !== null && (
        <div style={{ marginTop: 12, padding: 12, background: "#EEF3F8", borderRadius: 8, fontSize: 13, color: "#1A3557" }}>
          <strong>Explanation:</strong> {parseText(currentQ.explanation, currentQ.source_location, currentQ.source_chunk_text, setBlinkTarget)}
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
