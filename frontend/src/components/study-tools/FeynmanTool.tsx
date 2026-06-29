import { useRef, useEffect, useState } from "react"
import { useSessionStore } from "../../store/sessionStore"

interface Props {
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  nodeId: string
  familiarity: string
}

export function FeynmanTool({ sendEvent, nodeId, familiarity }: Props) {
  const { feynmanHistory, streamingFeynman, addFeynmanMessage } = useSessionStore()
  const [draft, setDraft] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    const onTranscribed = (e: Event) => {
      const { text } = (e as CustomEvent).detail
      if (text) {
        setDraft((prev) => prev ? prev.trim() + " " + text.trim() : text.trim())
      }
    }
    window.addEventListener("feynman-transcribed", onTranscribed)
    return () => {
      window.removeEventListener("feynman-transcribed", onTranscribed)
      if (recognitionRef.current) recognitionRef.current.stop()
      if (mediaRef.current) mediaRef.current.stop()
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [feynmanHistory, streamingFeynman])

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
      // Backend status endpoint unreachable or failed
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!backendAvailable && !SpeechRec) {
      alert("Voice input is currently unavailable because the backend transcription model is not yet loaded, and this browser does not support native speech recognition.")
      return
    }

    if (!backendAvailable && SpeechRec) {
      // Use browser Web Speech API
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
          setDraft((prev) => {
            const combined = prev ? prev.trim() + " " + transcript.trim() : transcript.trim()
            return combined
          })
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
      // Use backend MediaRecorder (when STT is available)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const rec = new MediaRecorder(stream)
        chunksRef.current = []
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        rec.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" })
          const arrayBuf = await blob.arrayBuffer()
          const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)))
          sendEvent("FEYNMAN_AUDIO", { audio_base64: base64, node_id: nodeId, familiarity })
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
    addFeynmanMessage({ role: "student", content: text })
    setDraft("")
    sendEvent("FEYNMAN_TURN", { node_id: nodeId, student_text: text, familiarity })
  }

  const getPersonaName = (fam: string): string => {
    switch (fam) {
      case "eli5": return "Study Buddy (Age 5)"
      case "high_school": return "Study Buddy (Age 15)"
      case "graduate": return "Study Buddy (Age 22)"
      case "expert": return "Study Buddy (Age 30)"
      default: return "Study Buddy (Age 15)"
    }
  }

  const personaName = getPersonaName(familiarity)

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>
        Explain the concept to {personaName}. They will ask follow-up questions.
      </p>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {feynmanHistory.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "student" ? "flex-end" : "flex-start",
              background: msg.role === "student" ? "#7c3aed" : "#1e293b",
              color: "white",
              padding: "8px 12px",
              borderRadius: 8,
              maxWidth: "85%",
              fontSize: 13,
              whiteSpace: "pre-wrap",
            }}
          >
            {msg.role === "clara" && <span style={{ fontWeight: 700, color: "#fbbf24" }}>{personaName}: </span>}
            {msg.content}
          </div>
        ))}
        {streamingFeynman && (
          <div style={{ alignSelf: "flex-start", background: "#1e293b", color: "white", padding: "8px 12px", borderRadius: 8, maxWidth: "85%", fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: "#fbbf24" }}>{personaName}: </span>
            {streamingFeynman}
            <span style={{ opacity: 0.5 }}>▌</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Explain the concept in your own words…"
          rows={3}
          style={{ flex: 1, background: "#1e293b", color: "white", border: "1px solid #334155", borderRadius: 6, padding: 8, fontSize: 13, resize: "none" }}
        />
        <button onClick={send} style={{ background: "#7c3aed", color: "white", border: "none", borderRadius: 6, padding: "0 16px", cursor: "pointer" }}>
          Send
        </button>
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          style={{
            background: recording ? "#FEE2E2" : "transparent",
            border: `1px solid ${recording ? "#EF4444" : "#E8E0D5"}`,
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
            color: recording ? "#EF4444" : "#6B7280",
            fontSize: 18,
            transition: "all 0.15s",
          }}
          title={recording ? "Stop recording" : "Start voice input"}
        >
          {recording ? "⏹" : "🎤"}
        </button>
      </div>
    </div>
  )
}
