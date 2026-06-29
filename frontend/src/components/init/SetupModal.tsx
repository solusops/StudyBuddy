import { useState } from "react"
import type { AppSession } from "../../App"
import type { FamiliarityLevel } from "../../types"

const FAMILIARITY_OPTIONS: { value: FamiliarityLevel; label: string; desc: string }[] = [
  { value: "eli5", label: "ELI5", desc: "Sensory analogies, no math" },
  { value: "high_school", label: "High School", desc: "Standard terms, real-world examples" },
  { value: "graduate", label: "Graduate", desc: "Domain competence assumed" },
  { value: "expert", label: "Expert", desc: "Pure synthesis, proofs" },
]

interface Props {
  onSessionReady: (session: AppSession) => void
}

export function SetupModal({ onSessionReady }: Props) {
  const [topic, setTopic] = useState("")
  const [familiarity, setFamiliarity] = useState<FamiliarityLevel>("high_school")
  const [contentFolder, setContentFolder] = useState("")
  const [questionsFolder, setQuestionsFolder] = useState("")
  const [phase, setPhase] = useState<"idle" | "starting" | "error">("idle")
  const [error, setError] = useState("")

  const isElectron = typeof window !== "undefined" && !!window.electronAPI

  const pickContentFolder = async () => {
    if (!isElectron) return
    const path = await window.electronAPI!.selectFolder({ title: "Select Content Folder (textbooks, notes)" })
    if (path) setContentFolder(path)
  }

  const pickQuestionsFolder = async () => {
    if (!isElectron) return
    const path = await window.electronAPI!.selectFolder({ title: "Select Questions Folder (past papers, Q&As)" })
    if (path) setQuestionsFolder(path)
  }

  const start = async () => {
    if (!contentFolder) { setError("Select a content folder first."); return }
    setError("")
    setPhase("starting")

    try {
      // 1. Configure library folders
      const configResp = await fetch("/library/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_folder: contentFolder, questions_folder: questionsFolder || null }),
      })
      if (!configResp.ok) {
        const e = await configResp.json()
        throw new Error(e.detail || "Failed to configure library")
      }

      // 2. Create session
      const sessionResp = await fetch("/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() || "Study Session", familiarity }),
      })
      if (!sessionResp.ok) throw new Error("Failed to create session")
      const { session_id } = await sessionResp.json()

      // 3. Start session — instant tree from document structure
      const startResp = await fetch("/library/start-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id, familiarity, topic_hint: topic.trim() }),
      })
      if (!startResp.ok) {
        const e = await startResp.json()
        throw new Error(e.detail || "Failed to start session")
      }
      const { nodes } = await startResp.json()

      // 4. Trigger background chunking (non-blocking)
      fetch("/library/scan", { method: "POST" }).catch(() => {})

      // 5. Get content file list
      const statusResp = await fetch("/library/status")
      const status = await statusResp.json()

      onSessionReady({
        sessionId: session_id,
        topic: topic.trim() || "Study Session",
        familiarity,
        nodes,
        contentFiles: status.content_files || [],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("error")
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#FAF7F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{
        background: "#FFFFFF",
        border: "1px solid #E8E0D5",
        borderRadius: 16,
        padding: 40,
        width: 500,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        boxShadow: "0 4px 24px rgba(26,53,87,0.08)",
      }}>
        <div>
          <h1 style={{ margin: 0, color: "#1A3557", fontSize: 26, fontWeight: 700, fontFamily: "Georgia, 'Times New Roman', serif" }}>
            Study Buddy
          </h1>
          <p style={{ margin: "6px 0 0", color: "#6B7280", fontSize: 14 }}>
            Your AI study partner. Grounded only in your material.
          </p>
        </div>

        {/* Topic (optional) */}
        <div>
          <label style={labelStyle}>Topic name <span style={{ color: "#9CA3AF", fontWeight: 400 }}>(optional)</span></label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Classical Mechanics, Contract Law…"
            style={inputStyle}
          />
        </div>

        {/* Familiarity */}
        <div>
          <label style={labelStyle}>Familiarity level</label>
          <div style={{ display: "flex", gap: 8 }}>
            {FAMILIARITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFamiliarity(opt.value)}
                title={opt.desc}
                style={{
                  flex: 1,
                  padding: "8px 4px",
                  borderRadius: 8,
                  border: familiarity === opt.value ? "2px solid #1A3557" : "2px solid #E8E0D5",
                  background: familiarity === opt.value ? "#EEF3F8" : "transparent",
                  color: familiarity === opt.value ? "#1A3557" : "#6B7280",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: familiarity === opt.value ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content folder */}
        <div>
          <label style={labelStyle}>Content folder <span style={{ color: "#EF4444" }}>*</span></label>
          <p style={{ margin: "0 0 8px", color: "#9CA3AF", fontSize: 12 }}>
            Textbooks, lecture notes, PDFs, DOCX, TXT
          </p>
          {isElectron ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={pickContentFolder} style={folderBtnStyle}>
                Choose Folder
              </button>
              {contentFolder && (
                <span style={{ color: "#1A3557", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {contentFolder}
                </span>
              )}
            </div>
          ) : (
            <p style={{ color: "#9CA3AF", fontSize: 12 }}>Run in Electron for folder selection.</p>
          )}
        </div>

        {/* Questions folder (optional) */}
        <div>
          <label style={labelStyle}>Questions folder <span style={{ color: "#9CA3AF", fontWeight: 400 }}>(optional)</span></label>
          <p style={{ margin: "0 0 8px", color: "#9CA3AF", fontSize: 12 }}>
            Past exam papers, practice Q&As
          </p>
          {isElectron && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={pickQuestionsFolder} style={folderBtnStyle}>
                Choose Folder
              </button>
              {questionsFolder && (
                <span style={{ color: "#6B7280", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {questionsFolder}
                </span>
              )}
            </div>
          )}
        </div>

        {error && <p style={{ color: "#EF4444", fontSize: 13, margin: 0 }}>{error}</p>}

        {phase === "starting" && (
          <p style={{ color: "#4A7FB5", fontSize: 13, margin: 0 }}>
            Reading document structure and generating your study tree…
          </p>
        )}

        <button
          onClick={start}
          disabled={phase === "starting"}
          style={{
            background: "#1A3557",
            color: "#FAF7F2",
            border: "none",
            borderRadius: 10,
            padding: "14px 0",
            fontSize: 15,
            fontWeight: 600,
            cursor: phase === "starting" ? "not-allowed" : "pointer",
            opacity: phase === "starting" ? 0.7 : 1,
            fontFamily: "Georgia, serif",
            letterSpacing: "0.02em",
          }}
        >
          {phase === "starting" ? "Building your study tree…" : "Start Studying →"}
        </button>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#1A1A2E",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#FAFAFA",
  color: "#1A1A2E",
  border: "1px solid #E8E0D5",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  boxSizing: "border-box",
  outline: "none",
}

const folderBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#1A3557",
  border: "1.5px solid #1A3557",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 13,
  cursor: "pointer",
  fontWeight: 500,
  flexShrink: 0,
}
