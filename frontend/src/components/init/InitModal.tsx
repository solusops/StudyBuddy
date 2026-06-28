import { useState } from "react"
import type { FamiliarityLevel } from "../../types"

const API_BASE = "http://127.0.0.1:8000"

const FAMILIARITY_OPTIONS: { value: FamiliarityLevel; label: string; desc: string }[] = [
  { value: "eli5", label: "ELI5", desc: "Sensory analogies, no math" },
  { value: "high_school", label: "High School", desc: "Standard terms, real-world examples" },
  { value: "graduate", label: "Graduate", desc: "Domain competence assumed" },
  { value: "expert", label: "Expert", desc: "Pure synthesis, proofs, no analogies" },
]

interface Props {
  onSessionReady: (
    sessionId: string,
    topic: string,
    familiarity: FamiliarityLevel,
    nodes: unknown[]
  ) => void
}

export function InitModal({ onSessionReady }: Props) {
  const [topic, setTopic] = useState("")
  const [familiarity, setFamiliarity] = useState<FamiliarityLevel>("high_school")
  const [contentFiles, setContentFiles] = useState<File[]>([])
  const [questionFiles, setQuestionFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<"form" | "uploading" | "extracting" | "error">("form")
  const [error, setError] = useState("")

  const start = async () => {
    if (!topic.trim()) { setError("Enter a topic name."); return }
    if (!contentFiles.length) { setError("Upload at least one content file."); return }
    setError("")
    setPhase("uploading")

    try {
      // Create session
      const sessionResp = await fetch(`${API_BASE}/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), familiarity }),
      })
      if (!sessionResp.ok) throw new Error("Failed to create session")
      const { session_id } = await sessionResp.json()

      // Upload content files
      for (const file of contentFiles) {
        const fd = new FormData()
        fd.append("session_id", session_id)
        fd.append("chunk_type", "content")
        fd.append("file", file)
        const r = await fetch(`${API_BASE}/ingest/file`, { method: "POST", body: fd })
        if (!r.ok) throw new Error(`Failed to upload ${file.name}`)
      }

      // Upload question files (optional)
      for (const file of questionFiles) {
        const fd = new FormData()
        fd.append("session_id", session_id)
        fd.append("chunk_type", "question")
        fd.append("file", file)
        await fetch(`${API_BASE}/ingest/file`, { method: "POST", body: fd })
      }

      setPhase("extracting")

      // Finalize — triggers extract_curriculum
      const finalResp = await fetch(`${API_BASE}/ingest/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id, topic: topic.trim(), familiarity }),
      })
      if (!finalResp.ok) {
        const err = await finalResp.json()
        throw new Error(err.detail || "Extraction failed")
      }
      const { nodes } = await finalResp.json()
      onSessionReady(session_id, topic.trim(), familiarity, nodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("error")
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#020617",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
    >
      <div
        style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 16,
          padding: 40,
          width: 480,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <h1 style={{ margin: 0, color: "white", fontSize: 24, fontWeight: 700 }}>Study Buddy</h1>
        <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
          Upload your material. The AI will only teach from what you provide.
        </p>

        {/* Topic */}
        <div>
          <label style={labelStyle}>Topic name</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Quantum Mechanics, Contract Law…"
            style={inputStyle}
            disabled={phase !== "form" && phase !== "error"}
          />
        </div>

        {/* Familiarity */}
        <div>
          <label style={labelStyle}>Familiarity level</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {FAMILIARITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFamiliarity(opt.value)}
                title={opt.desc}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: familiarity === opt.value ? "2px solid #3b82f6" : "2px solid #1e293b",
                  background: familiarity === opt.value ? "#1e3a5f" : "#1e293b",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content dropbox */}
        <div>
          <label style={labelStyle}>Content files <span style={{ color: "#ef4444" }}>*</span></label>
          <p style={{ margin: "0 0 6px", color: "#64748b", fontSize: 11 }}>
            Textbook chapters, lecture notes, PDFs, DOCX, TXT
          </p>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.txt"
            onChange={(e) => setContentFiles(Array.from(e.target.files ?? []))}
            style={{ color: "white", fontSize: 12 }}
          />
          {contentFiles.length > 0 && (
            <ul style={{ margin: "6px 0 0", padding: "0 0 0 16px" }}>
              {contentFiles.map((f, i) => (
                <li key={i} style={{ color: "#94a3b8", fontSize: 11 }}>{f.name}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Question dropbox */}
        <div>
          <label style={labelStyle}>Question files <span style={{ color: "#64748b" }}>(optional)</span></label>
          <p style={{ margin: "0 0 6px", color: "#64748b", fontSize: 11 }}>
            Past exam papers, practice Q&amp;As — used for flashcards and quizzes
          </p>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.txt"
            onChange={(e) => setQuestionFiles(Array.from(e.target.files ?? []))}
            style={{ color: "white", fontSize: 12 }}
          />
        </div>

        {error && <p style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>{error}</p>}

        {(phase === "uploading" || phase === "extracting") && (
          <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
            {phase === "uploading" ? "Uploading and indexing…" : "Extracting curriculum from your material…"}
          </p>
        )}

        <button
          onClick={start}
          disabled={phase === "uploading" || phase === "extracting"}
          style={{
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "12px 0",
            fontSize: 14,
            fontWeight: 600,
            cursor: phase === "uploading" || phase === "extracting" ? "not-allowed" : "pointer",
            opacity: phase === "uploading" || phase === "extracting" ? 0.6 : 1,
          }}
        >
          {phase === "uploading" ? "Uploading…" : phase === "extracting" ? "Extracting curriculum…" : "Start Studying →"}
        </button>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#e2e8f0",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#1e293b",
  color: "white",
  border: "1px solid #334155",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 13,
  boxSizing: "border-box",
}
