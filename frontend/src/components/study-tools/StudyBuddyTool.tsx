import { useRef, useEffect, useState } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"
import { useSessionStore } from "../../store/sessionStore"
import { useInteractionStore } from "../../store/interactionStore"

function renderMath(text: string): string {
  const tex = (src: string, displayMode: boolean) => {
    try {
      return katex.renderToString(src, { displayMode, throwOnError: false })
    } catch {
      return displayMode ? `$$${src}$$` : `$${src}$`
    }
  }
  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => tex(m, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => tex(m, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => tex(m, false))
    .replace(/\$([^$\n]+?)\$/g, (_, m) => tex(m, false))
}

function renderInline(text: string): string {
  let result = renderMath(text)
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #3b82f6; text-decoration: underline; font-weight: 500;">$1</a>')
  return result
}

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  nodeId: string
  familiarity: string
}

export function StudyBuddyTool({ sendEvent, nodeId, familiarity }: Props) {
  const { studyBuddyHistory, streamingStudyBuddy, addStudyBuddyMessage, setStudyBuddyHistory, studyBuddyInitializing, setStudyBuddyInitializing } = useSessionStore()
  const { studyBuddySessions, activeStudyBuddySessionId, setActiveStudyBuddySession, addStudyBuddySession, updateStudyBuddySession } = useInteractionStore()
  const [draft, setDraft] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const [recording, setRecording] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<any>(null)
  const initializedNodeId = useRef<string | null>(null)

  // Auto-init on mount if history is empty
  useEffect(() => {
    if (studyBuddyHistory.length === 0 && !streamingStudyBuddy && initializedNodeId.current !== nodeId) {
      initializedNodeId.current = nodeId
      sendEvent("STUDY_BUDDY_INIT", { node_id: nodeId, familiarity })
    }
  }, [studyBuddyHistory.length, streamingStudyBuddy, nodeId, familiarity, sendEvent])

  // Clear initializing flag when history populates
  useEffect(() => {
    if (studyBuddyHistory.length > 0 || streamingStudyBuddy) {
      setStudyBuddyInitializing(false)
    }
  }, [studyBuddyHistory.length, streamingStudyBuddy, setStudyBuddyInitializing])

  // Reset local ref if node changes to allow re-init on new nodes
  useEffect(() => {
    if (studyBuddyHistory.length === 0 && initializedNodeId.current !== nodeId) {
       initializedNodeId.current = null
    }
  }, [nodeId, studyBuddyHistory.length])

  useEffect(() => {
    const onTranscribed = (e: Event) => {
      const { text } = (e as CustomEvent).detail
      if (text) {
        setDraft((prev) => prev ? prev.trim() + " " + text.trim() : text.trim())
      }
    }
    window.addEventListener("study-buddy-transcribed", onTranscribed)
    return () => {
      window.removeEventListener("study-buddy-transcribed", onTranscribed)
      if (recognitionRef.current) recognitionRef.current.stop()
      if (mediaRef.current) mediaRef.current.stop()
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [studyBuddyHistory, streamingStudyBuddy])

  // Sync to interactionStore when a session progresses
  useEffect(() => {
    if (studyBuddyHistory.length > 0 && !streamingStudyBuddy) {
      if (!activeStudyBuddySessionId) {
        const newId = Date.now().toString()
        setActiveStudyBuddySession(newId)
        addStudyBuddySession({
          id: newId,
          title: studyBuddyHistory.find(m => m.role === "study_buddy")?.content.slice(0, 30) || "New Session",
          messages: [...studyBuddyHistory],
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      } else {
        updateStudyBuddySession(activeStudyBuddySessionId, [...studyBuddyHistory])
      }
    }
  }, [studyBuddyHistory, streamingStudyBuddy])

  const startRecording = async () => {
    let backendAvailable = false
    try {
      const resp = await fetch("/annotations/stt-status")
      if (resp.ok) {
        const status = await resp.json()
        if (status.available) {
          backendAvailable = true
        }
      }
    } catch (err) {
      // Ignore
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!backendAvailable && !SpeechRec) {
      alert("Voice input is currently unavailable.")
      return
    }

    if (!backendAvailable && SpeechRec) {
      const rec = new SpeechRec()
      rec.continuous = true
      rec.interimResults = false
      rec.lang = "en-US"

      rec.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join("")
        if (transcript.trim()) {
          setDraft((prev) => prev ? prev.trim() + " " + transcript.trim() : transcript.trim())
        }
      }

      rec.onerror = (e: any) => {
        console.error("Speech recognition error:", e)
        stopRecording()
      }

      rec.onend = () => {
        setRecording(false)
        recognitionRef.current = null
      }

      rec.start()
      recognitionRef.current = rec
      setRecording(true)
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const rec = new MediaRecorder(stream)
        chunksRef.current = []
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        rec.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" })
          const arrayBuf = await blob.arrayBuffer()
          const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)))
          const historyToSend = studyBuddyHistory.map(m => ({ role: m.role, content: m.content }))
          sendEvent("STUDY_BUDDY_AUDIO", { audio_base64: base64, node_id: nodeId, familiarity, history: historyToSend })
          stream.getTracks().forEach((t) => t.stop())
        }
        rec.start()
        mediaRef.current = rec
        setRecording(true)
      } catch (err) {
        console.error("Failed to access media devices:", err)
      }
    }
  }

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    } else if (mediaRef.current) {
      mediaRef.current.stop()
    }
    setRecording(false)
  }

  const send = () => {
    const text = draft.trim()
    if (!text) return
    addStudyBuddyMessage({ role: "student", content: text })
    setDraft("")
    const historyToSend = studyBuddyHistory.map(m => ({ role: m.role, content: m.content }))
    sendEvent("STUDY_BUDDY_TURN", { node_id: nodeId, student_text: text, familiarity, history: historyToSend })
  }

  const renderProse = (text: string, keyPrefix: string) => {
    const cleaned = text.replace(/\[?chunk\s*\d+\]?/gi, "").replace(/\[Source:\s*[^\]]*\]/gi, "")
    const lines = cleaned.split(/\r?\n/)
    const elements: React.ReactNode[] = []
    let listItems: string[] = []

    const flushList = (key: string | number) => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`${keyPrefix}-list-${key}`} style={{ margin: "0 0 10px", paddingLeft: 20, lineHeight: 1.55 }}>
            {listItems.map((item, li) => (
              <li key={li} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
            ))}
          </ul>
        )
        listItems = []
      }
    }

    const isTableSep = (s: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(s) && s.includes("-")
    const splitRow = (s: string) => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())

    let i = 0
    while (i < lines.length) {
      const trimmed = lines[i].trim()
      if (!trimmed) { i++; continue }

      if (trimmed.startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushList(i)
        const header = splitRow(trimmed)
        const rows: string[][] = []
        let j = i + 2
        while (j < lines.length && lines[j].trim().startsWith("|")) {
          rows.push(splitRow(lines[j]))
          j++
        }
        elements.push(
          <div key={`${keyPrefix}-tbl-${i}`} style={{ overflowX: "auto", margin: "0 0 12px" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead>
                <tr>{header.map((h, hi) => <th key={hi} style={{ border: "1px solid #E8E0D5", padding: "6px 10px", background: "#EEF3F8", color: "#1A3557", textAlign: "left", fontWeight: 700 }} dangerouslySetInnerHTML={{ __html: renderInline(h) }} />)}</tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ border: "1px solid #E8E0D5", padding: "6px 10px", color: "#1A1A2E", verticalAlign: "top" }} dangerouslySetInnerHTML={{ __html: renderInline(c) }} />)}</tr>)}
              </tbody>
            </table>
          </div>
        )
        i = j
        continue
      }

      if (trimmed.startsWith("#")) {
        flushList(i)
        const headerText = trimmed.replace(/^#+\s*/, "")
        elements.push(<h4 key={`${keyPrefix}-${i}`} style={{ fontFamily: "'Libre Caslon Text', Georgia, serif", color: "#1A3557", fontSize: 16, fontWeight: 700, margin: "14px 0 6px 0", borderBottom: "1px solid #E8E0D5", paddingBottom: 2 }}>{headerText}</h4>)
        i++
        continue
      }

      if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
        listItems.push(trimmed.replace(/^[*-]\s*/, ""))
        i++
        continue
      }

      flushList(i)
      elements.push(<p key={`${keyPrefix}-${i}`} style={{ margin: "0 0 10px", lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: renderInline(trimmed) }} />)
      i++
    }
    flushList("trailing")
    return elements
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* Top Bar for History */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid #E8E0D5", flexShrink: 0, background: "#F8F9FA" }}>
        <button
          onClick={() => {
            setActiveStudyBuddySession(null);
            setStudyBuddyHistory([]);
            setHistoryOpen(false);
          }}
          style={{
            background: "transparent",
            color: "#1A3557",
            border: "1px solid #1A3557",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + New Session
        </button>
        {studyBuddySessions.length > 0 && (
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            style={{
              background: historyOpen ? "#1A3557" : "transparent",
              color: historyOpen ? "white" : "#4A7FB5",
              border: "1px solid",
              borderColor: historyOpen ? "#1A3557" : "#4A7FB5",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            History
          </button>
        )}
      </div>

      {/* History Drawer */}
      {historyOpen && studyBuddySessions.length > 0 && (
        <div style={{ background: "#F8F9FA", borderBottom: "1px solid #E8E0D5", padding: "8px 12px", maxHeight: 150, overflowY: "auto", flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Past Study Buddy Sessions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {studyBuddySessions.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setActiveStudyBuddySession(s.id);
                  setStudyBuddyHistory(s.messages);
                  setHistoryOpen(false);
                }}
                style={{
                  background: s.id === activeStudyBuddySessionId ? "#EEF3F8" : "white",
                  border: "1px solid #E2E8F0",
                  borderRadius: 4,
                  padding: "6px 10px",
                  fontSize: 13,
                  color: "#1A3557",
                  cursor: "pointer",
                  textAlign: "left",
                  fontWeight: s.id === activeStudyBuddySessionId ? 600 : 400,
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <h1 style={{ 
        textAlign: "center", 
        color: "#1A3557", 
        fontFamily: "var(--font-serif)", 
        fontSize: "2.2rem", 
        fontWeight: 600,
        margin: "24px 0",
      }}>
        Study Buddy Time
      </h1>
      
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, padding: "0 24px 24px 24px" }}>
        {studyBuddyHistory.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "student" ? "flex-end" : "flex-start",
              background: msg.role === "student" ? "#EEF3F8" : "#FFFFFF",
              color: "#1A1A2E",
              border: msg.role === "student" ? "none" : "1px solid #E8E0D5",
              padding: msg.role === "student" ? "12px 18px" : "16px 20px",
              borderRadius: msg.role === "student" ? 20 : 12,
              maxWidth: "85%",
              fontSize: msg.role === "study_buddy" ? 17 : 15,
              lineHeight: 1.6,
              fontFamily: msg.role === "study_buddy" ? "var(--font-serif)" : "system-ui, sans-serif",
              boxShadow: msg.role === "study_buddy" ? "0 4px 16px rgba(0,0,0,0.06)" : "none",
            }}
          >
            {msg.role === "study_buddy" ? renderProse(msg.content, `msg-${i}`) : msg.content}
          </div>
        ))}
        
        {streamingStudyBuddy && (
          <div style={{ 
            alignSelf: "flex-start", 
            background: "#FFFFFF", 
            color: "#1A1A2E", 
            border: "1px solid #E8E0D5", 
            padding: "16px 20px", 
            borderRadius: 12, 
            maxWidth: "85%", 
            fontSize: 18, 
            lineHeight: 1.6, 
            fontFamily: "var(--font-serif)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.06)"
          }}>
            {renderProse(streamingStudyBuddy, "stream")}
            <span style={{ display: "inline-block", width: 8, height: 18, background: "#1A3557", marginLeft: 4, animation: "blink 1s step-end infinite", verticalAlign: "middle" }} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ 
        borderTop: "1px solid #E8E0D5", 
        padding: "12px 16px",
        background: "#FFFFFF",
        flexShrink: 0
      }}>
        <div style={{ 
          display: "flex", 
          gap: 12, 
          background: "#F8F9FA", 
          padding: "8px 12px", 
          borderRadius: 24,
          alignItems: "center",
          border: "1px solid #E8E0D5",
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
        }}>
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          style={{
            background: recording ? "rgba(239, 68, 68, 0.1)" : "#FFFFFF",
            border: "1px solid",
            borderColor: recording ? "rgba(239, 68, 68, 0.3)" : "#E2E8F0",
            borderRadius: "50%",
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: recording ? "#EF4444" : "#4A7FB5",
            fontSize: 20,
            transition: "all 0.2s ease",
          }}
          title={recording ? "Stop recording" : "Use microphone"}
        >
          {recording ? "⏹" : "🎤"}
        </button>
        
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Respond to Study Buddy..."
          rows={1}
          style={{ 
            flex: 1, 
            background: "transparent", 
            color: "#1A1A2E", 
            border: "none", 
            fontSize: 15, 
            resize: "none", 
            outline: "none", 
            fontFamily: "system-ui, sans-serif",
            padding: "10px 0",
            margin: "0 4px"
          }}
        />
        
        <button 
          onClick={send} 
          disabled={!draft.trim()}
          style={{ 
            background: draft.trim() ? "#1A3557" : "#E2E8F0", 
            color: draft.trim() ? "#FAF7F2" : "#94A3B8", 
            border: "none", 
            borderRadius: "50%", 
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: draft.trim() ? "pointer" : "not-allowed", 
            transition: "all 0.2s ease"
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
        </div>
      </div>
    </div>
  )
}
