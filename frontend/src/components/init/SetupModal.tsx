import { useCallback, useEffect, useRef, useState } from "react"
import type { AppSession } from "../../App"
import type { FamiliarityLevel } from "../../types"

const FAMILIARITY_OPTIONS: { value: FamiliarityLevel; label: string; desc: string }[] = [
  { value: "eli5",        label: "ELI5",        desc: "Sensory analogies, no math" },
  { value: "high_school", label: "High School",  desc: "Standard terms, real-world examples" },
  { value: "graduate",    label: "Graduate",     desc: "Domain competence assumed" },
  { value: "expert",      label: "Expert",       desc: "Pure synthesis, proofs" },
]

interface Props {
  onSessionReady: (session: AppSession) => void
}

export function SetupModal({ onSessionReady }: Props) {
  const [topic, setTopic] = useState("")
  const [familiarity, setFamiliarity] = useState<FamiliarityLevel>("high_school")
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [backendReady, setBackendReady] = useState(false)
  const [phase, setPhase] = useState<"idle" | "starting" | "error">("idle")
  const [error, setError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Poll until backend is reachable — disables the button during cold start
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      while (!cancelled) {
        try {
          const r = await fetch("/api/health", { signal: AbortSignal.timeout(2000) })
          if (r.ok) { setBackendReady(true); return }
        } catch { /* not ready yet */ }
        await new Promise((res) => setTimeout(res, 1000))
      }
    }
    poll()
    return () => { cancelled = true }
  }, [])

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const supported = Array.from(incoming).filter((f) =>
      /\.(pdf|docx|txt)$/i.test(f.name)
    )
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
      return [...prev, ...supported.filter((f) => !names.has(f.name))]
    })
  }

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name))

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [])

  const start = async () => {
    if (files.length === 0) { setError("Drop at least one PDF, DOCX or TXT file."); return }
    setError("")
    setPhase("starting")

    try {
      // 1. Create session
      const sessionResp = await fetch("/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() || "Study Session", familiarity }),
      })
      if (!sessionResp.ok) throw new Error("Failed to create session")
      const { session_id } = await sessionResp.json()

      // 2. Upload files + instant tree generation
      const form = new FormData()
      form.append("session_id", session_id)
      form.append("familiarity", familiarity)
      form.append("topic_hint", topic.trim())
      files.forEach((f) => form.append("files", f))

      const uploadResp = await fetch("/library/upload-and-start", {
        method: "POST",
        body: form,
      })
      if (!uploadResp.ok) {
        const e = await uploadResp.json()
        throw new Error(e.detail || "Failed to process files")
      }
      const { nodes, edges, filenames, document_id } = await uploadResp.json()

      onSessionReady({
        sessionId: session_id,
        topic: topic.trim() || "Study Session",
        familiarity,
        nodes,
        edges: edges ?? [],
        contentFiles: filenames || files.map((f) => f.name),
        documentId: document_id,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("error")
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#FAF7F2",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 28 }}>

        {/* Header */}
        <div>
          <h1 style={{ margin: 0, color: "#1A3557", fontSize: 32, fontWeight: 700, fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
            Study Buddy
          </h1>
          <p style={{ margin: "8px 0 0", color: "#6B7280", fontSize: 16 }}>
            Drop your material. Get an instant curriculum, interactive figures and self-graded drills.
          </p>
        </div>

        {/* Drag-and-drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "#1A3557" : "#D1C9C0"}`,
            borderRadius: 16,
            background: dragging ? "#EEF3F8" : "#FDFCFA",
            padding: "36px 24px",
            textAlign: "center",
            cursor: "pointer",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.6 }}>📄</div>
          <p style={{ margin: 0, color: "#1A1A2E", fontWeight: 600, fontSize: 17 }}>
            Drop PDFs, DOCX or TXT here
          </p>
          <p style={{ margin: "6px 0 0", color: "#9CA3AF", fontSize: 15 }}>
            or{" "}
            <span style={{ color: "#1A3557", textDecoration: "underline" }}>
              browse files
            </span>
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt"
            style={{ display: "none" }}
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {files.map((f) => (
              <div key={f.name} style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "#FFFFFF", border: "1px solid #E8E0D5",
                borderRadius: 8, padding: "8px 12px",
              }}>
                <span style={{ flex: 1, fontSize: 15, color: "#1A1A2E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 14, color: "#9CA3AF", flexShrink: 0 }}>
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(f.name) }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

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
                  padding: "9px 4px",
                  borderRadius: 8,
                  border: familiarity === opt.value ? "2px solid #1A3557" : "2px solid #E8E0D5",
                  background: familiarity === opt.value ? "#EEF3F8" : "transparent",
                  color: familiarity === opt.value ? "#1A3557" : "#6B7280",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: familiarity === opt.value ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p style={{ color: "#EF4444", fontSize: 15, margin: 0 }}>{error}</p>}

        {phase === "starting" && (
          <p style={{ color: "#4A7FB5", fontSize: 15, margin: 0 }}>
            Reading document structure and building your curriculum tree…
          </p>
        )}

        <button
          onClick={start}
          disabled={!backendReady || phase === "starting"}
          style={{
            background: "#1A3557",
            color: "#FAF7F2",
            border: "none",
            borderRadius: 10,
            padding: "15px 0",
            fontSize: 17,
            fontWeight: 600,
            cursor: (!backendReady || phase === "starting") ? "not-allowed" : "pointer",
            opacity: (!backendReady || phase === "starting") ? 0.6 : 1,
            fontFamily: "'Libre Caslon Text', Georgia, serif",
            letterSpacing: "0.02em",
            transition: "opacity 0.3s",
          }}
        >
          {phase === "starting"
            ? "Building your study tree…"
            : !backendReady
              ? "Connecting to backend…"
              : "Start Studying →"}
        </button>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#1A1A2E",
  fontSize: 15,
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
  fontSize: 15,
  boxSizing: "border-box",
  outline: "none",
}
