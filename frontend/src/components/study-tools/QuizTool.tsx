import { useMemo, useState } from "react"
import { useSessionStore } from "../../store/sessionStore"
import type { MCQOption } from "../../types"

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  nodeId: string
  familiarity: string
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

export function QuizTool({ sendEvent, nodeId, familiarity }: Props) {
  const { quizQuestions, setQuizQuestions } = useSessionStore()
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
      <div style={{ textAlign: "center", padding: 32, color: "white" }}>
        <p style={{ marginBottom: 16 }}>Quiz complete!</p>
        <button onClick={() => { setQIndex(0); setSelected(null) }} style={btnStyle}>
          Retake
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <div style={{ fontSize: 12, color: "#64748b" }}>{qIndex + 1} / {quizQuestions.length}</div>
      <p style={{ color: "white", fontSize: 14, fontWeight: 600 }}>{currentQ.question}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shuffledOptions.map((opt, i) => {
          const isSelected = selected === i
          const isCorrect = opt.is_correct
          let bg = "#1e293b"
          if (selected !== null) {
            if (isCorrect) bg = "#166534"
            else if (isSelected) bg = "#7f1d1d"
          }
          return (
            <button
              key={i}
              onClick={() => choose(i)}
              style={{
                background: bg,
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "10px 14px",
                cursor: selected !== null ? "default" : "pointer",
                textAlign: "left",
                fontSize: 13,
                transition: "background 0.2s",
              }}
            >
              {opt.text}
            </button>
          )
        })}
      </div>
      {selected !== null && (
        <div style={{ color: "#94a3b8", fontSize: 12, fontStyle: "italic" }}>
          {currentQ.explanation}
        </div>
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
  background: "#3b82f6",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "8px 20px",
  cursor: "pointer",
  fontSize: 13,
}
