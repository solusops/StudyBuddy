import { useCallback, useEffect, useRef, useState } from "react"
import type { AppSession } from "../../App"
import type { FamiliarityLevel } from "../../types"

const FAMILIARITY_OPTIONS: { value: FamiliarityLevel; label: string; desc: string }[] = [
  { value: "eli5",        label: "ELI5",        desc: "Sensory analogies, no math" },
  { value: "high_school", label: "High School",  desc: "Standard terms, real-world examples" },
  { value: "graduate",    label: "Graduate",     desc: "Domain competence assumed" },
  { value: "expert",      label: "Expert",       desc: "Pure synthesis, proofs" },
]

const KEY_FIELDS: { env: string; label: string; hint: string; required: boolean }[] = [
  { env: "CEREBRAS_API_KEY", label: "Cerebras", hint: "csk-…", required: true },
  { env: "TAVILY_API_KEY",   label: "Tavily",   hint: "tvly-… (enables Net Support)", required: false },
  { env: "YOUTUBE_API_KEY",  label: "YouTube",  hint: "AIza… (enables Deep Dive)", required: false },
]

interface Props {
  onSessionReady: (session: AppSession) => void
}

export function SetupModal({ onSessionReady }: Props) {
  const [topic, setTopic] = useState(() => localStorage.getItem("sb_topic") || "")
  const [familiarity, setFamiliarity] = useState<FamiliarityLevel>(() => (localStorage.getItem("sb_familiarity") as FamiliarityLevel) || "high_school")
  const [knowledgeMode, setKnowledgeMode] = useState<"content_only" | "net_support">(() => (localStorage.getItem("sb_knowledgeMode") as "content_only" | "net_support") || "content_only")
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [backendReady, setBackendReady] = useState(false)
  const [phase, setPhase] = useState<"idle" | "starting" | "error">("idle")
  const [error, setError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [existingFiles, setExistingFiles] = useState<string[]>([])

  // ── API Keys state ──────────────────────────────────────────────────
  const [keysOpen, setKeysOpen] = useState(false)
  const [keyValues, setKeyValues] = useState<Record<string, string>>({})
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({})
  const [keySaving, setKeySaving] = useState(false)
  const [keySaved, setKeySaved] = useState(false)

  // ── Persist Settings ────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem("sb_topic", topic) }, [topic])
  useEffect(() => { localStorage.setItem("sb_familiarity", familiarity) }, [familiarity])
  useEffect(() => { localStorage.setItem("sb_knowledgeMode", knowledgeMode) }, [knowledgeMode])

  // Poll until backend is reachable — disables the button during cold start
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      while (!cancelled) {
        try {
          const r = await fetch("/api/health", { signal: AbortSignal.timeout(2000) })
          if (r.ok) { setBackendReady(true); return }
        } catch { /* not ready yet */ }
        await new Promise((res) => setTimeout(res, 3000))
      }
    }
    poll()
    return () => { cancelled = true }
  }, [])

  // Once backend is ready, fetch which keys are already configured and check library
  useEffect(() => {
    if (!backendReady) return
    fetch("/api/keys")
      .then((r) => r.json())
      .then((data) => setKeyStatus(data))
      .catch(() => {})
    fetch("/library/status")
      .then((r) => r.json())
      .then((status) => {
        if (status.configured && status.content_files?.length > 0) {
          setExistingFiles(status.content_files)
          if (!topic && status.content_files[0]) {
            setTopic(status.content_files[0].replace(/\.[^.]+$/, ""))
          }
        }
      })
      .catch(() => {})
  }, [backendReady])

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

  const saveKeys = async () => {
    const toSave = Object.fromEntries(
      Object.entries(keyValues).filter(([, v]) => v.trim())
    )
    if (Object.keys(toSave).length === 0) return
    setKeySaving(true)
    try {
      await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      })
      // Refresh status
      const r = await fetch("/api/keys")
      setKeyStatus(await r.json())
      setKeyValues({})
      setKeySaved(true)
      setTimeout(() => setKeySaved(false), 2500)
    } catch {
      setError("Failed to save API keys")
    } finally {
      setKeySaving(false)
    }
  }

  const startFromExisting = async () => {
    setError("")
    setPhase("starting")
    try {
      const sessionResp = await fetch("/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() || "Study Session", familiarity }),
      })
      if (!sessionResp.ok) throw new Error("Failed to create session")
      const { session_id } = await sessionResp.json()

      const startResp = await fetch("/library/start-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id, familiarity, topic_hint: topic.trim() }),
      })
      if (!startResp.ok) {
        const e = await startResp.json()
        throw new Error(e.detail || "Failed to start session")
      }
      const { nodes, edges, document_id } = await startResp.json()

      onSessionReady({
        sessionId: session_id,
        topic: topic.trim() || "Study Session",
        familiarity,
        knowledgeMode,
        nodes,
        edges: edges ?? [],
        contentFiles: existingFiles,
        documentId: document_id,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("error")
    }
  }

  const start = async () => {
    if (files.length === 0 && existingFiles.length === 0) { setError("Drop at least one PDF, DOCX or TXT file."); return }
    if (files.length === 0 && existingFiles.length > 0) { return startFromExisting() }
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
        knowledgeMode,
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

        {/* Existing library — quick continue */}
        {existingFiles.length > 0 && files.length === 0 && (
          <div style={{
            background: "#EEF3F8",
            border: "1.5px solid #1A3557",
            borderRadius: 12,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#1A3557" }}>Continuing from last session</span>
              <button
                onClick={async () => {
                  await fetch("/library/clear", { method: "POST" })
                  setExistingFiles([])
                }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 13 }}
              >
                Start fresh
              </button>
            </div>
            {existingFiles.map((f) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#374151" }}>
                <span style={{ opacity: 0.5 }}>📄</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
              </div>
            ))}
          </div>
        )}

        {/* Drag-and-drop zone — shown when no existing library or user chose fresh start */}
        {(existingFiles.length === 0 || files.length > 0) && (
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
        )}

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

        {/* Knowledge Mode */}
        <div>
          <label style={labelStyle}>Knowledge Mode</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setKnowledgeMode("content_only")}
              title="Only answer using uploaded materials. Grounded and strict."
              style={{
                flex: 1,
                padding: "9px 4px",
                borderRadius: 8,
                border: knowledgeMode === "content_only" ? "2px solid #1A3557" : "2px solid #E8E0D5",
                background: knowledgeMode === "content_only" ? "#EEF3F8" : "transparent",
                color: knowledgeMode === "content_only" ? "#1A3557" : "#6B7280",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: knowledgeMode === "content_only" ? 600 : 400,
              }}
            >
              Content Only
            </button>
            <button
              onClick={() => setKnowledgeMode("net_support")}
              title="Search the web if information is missing from your documents."
              style={{
                flex: 1,
                padding: "9px 4px",
                borderRadius: 8,
                border: knowledgeMode === "net_support" ? "2px solid #1A3557" : "2px solid #E8E0D5",
                background: knowledgeMode === "net_support" ? "#EEF3F8" : "transparent",
                color: knowledgeMode === "net_support" ? "#1A3557" : "#6B7280",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: knowledgeMode === "net_support" ? 600 : 400,
              }}
            >
              Net Support
            </button>
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

      {/* ── API Keys — bottom center toggle ──────────────────────────── */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        display: "flex", flexDirection: "column", alignItems: "center",
        width: "100%", maxWidth: 520,
        zIndex: 20,
      }}>
        {/* Collapsible panel */}
        {keysOpen && (
          <div style={{
            width: "100%",
            background: "#FFFFFF",
            border: "1px solid #E8E0D5",
            borderRadius: "14px 14px 0 0",
            boxShadow: "0 -4px 24px rgba(26,53,87,0.10)",
            padding: "20px 24px 16px",
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <p style={{ margin: 0, fontSize: 13, color: "#6B7280", lineHeight: 1.5 }}>
              Keys are saved to <code style={{ background: "#F3F0EB", padding: "1px 5px", borderRadius: 4, fontSize: 12 }}>backend/.env</code> and
              loaded instantly. They never leave your machine.
            </p>

            {KEY_FIELDS.map((kf) => (
              <div key={kf.env}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: keyStatus[kf.env] ? "#22C55E" : "#D1D5DB",
                    flexShrink: 0,
                  }} />
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#1A1A2E" }}>
                    {kf.label}
                    {kf.required && <span style={{ color: "#EF4444", marginLeft: 2 }}>*</span>}
                  </label>
                  {keyStatus[kf.env] && (
                    <span style={{ fontSize: 11, color: "#22C55E", marginLeft: "auto" }}>configured</span>
                  )}
                </div>
                <input
                  type="password"
                  placeholder={keyStatus[kf.env] ? "••••••• (already set — leave blank to keep)" : kf.hint}
                  value={keyValues[kf.env] || ""}
                  onChange={(e) => setKeyValues((prev) => ({ ...prev, [kf.env]: e.target.value }))}
                  style={{
                    ...inputStyle,
                    fontSize: 13,
                    padding: "8px 12px",
                    fontFamily: "monospace",
                  }}
                />
              </div>
            ))}

            <button
              onClick={saveKeys}
              disabled={keySaving}
              style={{
                background: keySaved ? "#22C55E" : "#1A3557",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "9px 0",
                fontSize: 14,
                fontWeight: 600,
                cursor: keySaving ? "wait" : "pointer",
                transition: "background 0.25s",
              }}
            >
              {keySaved ? "✓ Saved" : keySaving ? "Saving…" : "Save Keys"}
            </button>
          </div>
        )}

        {/* Toggle button */}
        <button
          onClick={() => setKeysOpen((o) => !o)}
          style={{
            background: keysOpen ? "#1A3557" : "#FFFFFF",
            color: keysOpen ? "#FAF7F2" : "#1A3557",
            border: keysOpen ? "none" : "1px solid #E8E0D5",
            borderRadius: keysOpen ? "0 0 10px 10px" : "10px 10px 0 0",
            padding: "8px 28px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.06em",
            boxShadow: keysOpen ? "none" : "0 -2px 8px rgba(26,53,87,0.06)",
            transition: "all 0.2s",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <span style={{ fontSize: 14 }}></span>
          API KEYS
          <span style={{
            fontSize: 10, transform: keysOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s", display: "inline-block",
          }}>▲</span>
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

