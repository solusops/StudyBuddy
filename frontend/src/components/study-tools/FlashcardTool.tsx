import { useState } from "react"
import { useSessionStore } from "../../store/sessionStore"
import { useInteractionStore } from "../../store/interactionStore"
import katex from "katex"
import "katex/dist/katex.min.css"

function parseText(text: string, sourceLocation: any, sourceChunkText: string | undefined, setBlinkTarget: any) {
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\[?chunk\s*\d+\]?)/gi)
  return parts.map((part, i) => {
    if (part.startsWith("$$") && part.endsWith("$$")) {
      const math = part.slice(2, -2)
      try { return <div key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: true }) }} style={{ margin: "12px 0" }} /> }
      catch { return <div key={i} style={{ margin: "12px 0" }}>{part}</div> }
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      const math = part.slice(1, -1)
      try { return <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: false }) }} /> }
      catch { return <span key={i}>{part}</span> }
    }
    if (/^\[?chunk\s*\d+\]?$/i.test(part)) {
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
  familiarity: string
}

const GRADES = [
  { label: "Again", value: 1, color: "#ef4444" },
  { label: "Hard", value: 2, color: "#f59e0b" },
  { label: "Good", value: 3, color: "#3b82f6" },
  { label: "Easy", value: 4, color: "#22c55e" },
]

export function FlashcardTool({ sendEvent, nodeId, familiarity }: Props) {
  const { flashcards, flashcardContextImages, setFlashcards } = useSessionStore()
  const { setBlinkTarget } = useInteractionStore()
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    setFlashcards([])
    setIndex(0)
    setFlipped(false)
    sendEvent("FLASHCARDS_REQUEST", { node_id: nodeId, node_label: nodeId, familiarity })
    // Loading flag is cleared when flashcards arrive via store
    const unsub = useSessionStore.subscribe((state) => {
      if (state.flashcards.length > 0) { setLoading(false); unsub() }
    })
  }

  const grade = (value: number) => {
    sendEvent("FLASHCARD_GRADE", { node_id: nodeId, card_index: index, grade: value })
    setFlipped(false)
    setIndex((i) => i + 1)
  }

  if (!flashcards.length) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <button onClick={load} disabled={loading} style={btnStyle}>
          {loading ? "Generating…" : "Generate Flashcards"}
        </button>
      </div>
    )
  }

  if (index >= flashcards.length) {
    return (
      <div style={{ textAlign: "center", padding: 32, color: "#1A3557", fontFamily: "var(--font-serif)" }}>
        <p style={{ marginBottom: 16 }}>All {flashcards.length} cards done!</p>
        <button onClick={() => { setIndex(0); setFlipped(false) }} style={btnStyle}>
          Review Again
        </button>
      </div>
    )
  }

  const card = flashcards[index]

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 20 }}>
      {flashcardContextImages && flashcardContextImages.length > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, width: "100%", justifyContent: "center" }}>
          {flashcardContextImages.map((img, idx) => (
            <img key={idx} src={`data:image/png;base64,${img}`} alt="Context" style={{ height: 100, borderRadius: 6, objectFit: "contain", border: "1px solid #E2E8F0", background: "#FFFFFF", padding: 4 }} />
          ))}
        </div>
      )}
      <div style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>{index + 1} / {flashcards.length}</div>
      <div
        onClick={() => setFlipped((f) => !f)}
        style={{
          width: "100%",
          minHeight: 160,
          background: "#FFFFFF",
          border: `1.5px solid ${flipped ? "#2D6A4F" : "#1A3557"}`,
          borderRadius: 12,
          padding: 32,
          cursor: "pointer",
          color: "#0F172A",
          display: "block",
          fontSize: 18,
          lineHeight: 1.6,
          textAlign: "left",
          fontFamily: "var(--font-serif)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
          transition: "border 0.2s, box-shadow 0.2s",
        }}
      >
        {parseText(flipped ? card.back : card.front, card.source_location, card.source_chunk_text, setBlinkTarget)}
      </div>
      <div style={{ fontSize: 13, color: "#6B7280", fontFamily: "var(--font-hand)", display: "flex", alignItems: "center", gap: 16 }}>
        {flipped ? "Tap to see question" : "Tap to reveal answer"}
        
        {flipped && card.source_location && (
          <button 
            onClick={(e) => { e.stopPropagation(); setBlinkTarget(card.source_location!) }} 
            title={card.source_chunk_text || "Source chunk text unavailable"}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#3B82F6", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 }}
          >
            <ViewSourceIcon />
            View Source
          </button>
        )}
      </div>
      {flipped && (
        <div style={{ display: "flex", gap: 8 }}>
          {GRADES.map((g) => (
            <button key={g.value} onClick={() => grade(g.value)} style={{ ...btnStyle, background: g.color, minWidth: 64 }}>
              {g.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: "#1A3557",
  color: "#FFFFFF",
  border: "none",
  borderRadius: 8,
  padding: "10px 24px",
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 600,
  transition: "opacity 0.15s",
}
