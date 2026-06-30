import { useRef, useEffect, useState } from "react"
import { useSessionStore } from "../../store/sessionStore"

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  nodeId: string
  familiarity: string
}

export function StudyBuddyTool({ sendEvent, nodeId, familiarity }: Props) {
  const { studyBuddyHistory, streamingStudyBuddy, addStudyBuddyMessage } = useSessionStore()
  const [draft, setDraft] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<any>(null)
  const hasInitializedRef = useRef(false)

  // Auto-init on mount if history is empty
  useEffect(() => {
    if (studyBuddyHistory.length === 0 && !streamingStudyBuddy && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      sendEvent("STUDY_BUDDY_INIT", { node_id: nodeId, familiarity })
    }
  }, [studyBuddyHistory.length, streamingStudyBuddy, nodeId, familiarity, sendEvent])

  // Reset init flag when nodeId changes
  useEffect(() => {
    hasInitializedRef.current = false
  }, [nodeId])

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 24, background: "#0B0C10" }}>
      <h1 style={{ 
        textAlign: "center", 
        color: "#F5F5F5", 
        fontFamily: "var(--font-serif)", 
        fontSize: "2.5rem", 
        fontWeight: 400,
        marginBottom: 32,
        marginTop: 16
      }}>
        Study Buddy Time
      </h1>
      
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, paddingBottom: 24 }}>
        {studyBuddyHistory.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "student" ? "flex-end" : "flex-start",
              background: msg.role === "student" ? "#2B3240" : "transparent",
              color: msg.role === "student" ? "#E0E6ED" : "#F5F5F5",
              border: msg.role === "student" ? "none" : "1px solid #1F2833",
              padding: msg.role === "student" ? "12px 18px" : "16px 20px",
              borderRadius: msg.role === "student" ? 20 : 12,
              maxWidth: "85%",
              fontSize: msg.role === "study_buddy" ? 20 : 16,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              fontFamily: msg.role === "study_buddy" ? "var(--font-serif)" : "system-ui, sans-serif",
              boxShadow: msg.role === "study_buddy" ? "0 4px 20px rgba(0,0,0,0.15)" : "none",
            }}
          >
            {msg.content}
          </div>
        ))}
        
        {streamingStudyBuddy && (
          <div style={{ 
            alignSelf: "flex-start", 
            background: "transparent", 
            color: "#F5F5F5", 
            border: "1px solid #1F2833", 
            padding: "16px 20px", 
            borderRadius: 12, 
            maxWidth: "85%", 
            fontSize: 20, 
            lineHeight: 1.6, 
            fontFamily: "var(--font-serif)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)"
          }}>
            {streamingStudyBuddy}
            <span style={{ display: "inline-block", width: 8, height: 20, background: "#66FCF1", marginLeft: 4, animation: "blink 1s step-end infinite", verticalAlign: "middle" }} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ 
        display: "flex", 
        gap: 12, 
        background: "#1F2833", 
        padding: "12px 16px", 
        borderRadius: 24,
        alignItems: "center",
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
      }}>
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          style={{
            background: recording ? "rgba(239, 68, 68, 0.2)" : "#2B3240",
            border: "none",
            borderRadius: "50%",
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: recording ? "#EF4444" : "#66FCF1",
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
            color: "#E0E6ED", 
            border: "none", 
            fontSize: 16, 
            resize: "none", 
            outline: "none", 
            fontFamily: "system-ui, sans-serif",
            padding: "10px 0"
          }}
        />
        
        <button 
          onClick={send} 
          disabled={!draft.trim()}
          style={{ 
            background: draft.trim() ? "#66FCF1" : "#2B3240", 
            color: draft.trim() ? "#0B0C10" : "#6B7280", 
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
  )
}
