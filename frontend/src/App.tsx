import { useEffect, useState } from "react"
import { SetupModal } from "./components/init/SetupModal"
import { ManualPage } from "./pages/ManualPage"
import { TreePage } from "./pages/TreePage"
import { useWebSocket } from "./hooks/useWebSocket"
import { useSessionStore } from "./store/sessionStore"
import type { FamiliarityLevel, NodeData, KnowledgeEdge } from "./types"
import { FloatingToolbar } from "./components/overlay/FloatingToolbar"
import { useInteractionStore } from "./store/interactionStore"
import { useSelectionGrow } from "./lib/growWords"

export type AppView = "setup" | "manual" | "tree"

export interface AppSession {
  sessionId: string
  topic: string
  familiarity: FamiliarityLevel
  knowledgeMode?: "content_only" | "net_support"
  nodes: NodeData[]
  edges: KnowledgeEdge[]
  contentFiles: string[]
  documentId?: string
  lessonCache?: Record<string, string>
}

export default function App() {
  const [view, setView] = useState<AppView>("setup")
  const [session, setSession] = useState<AppSession | null>(null)
  const [checking, setChecking] = useState(true)

  // Single WebSocket at App level — persists across view transitions
  const { sendEvent } = useWebSocket(session?.sessionId ?? null)
  const setDocumentId = useInteractionStore((s) => s.setDocumentId)
  useSelectionGrow()  // word-grow feedback on selected text (chat + notes)

  // On mount, wait briefly for backend to start, then check if library is already configured
  useEffect(() => {
    // Small delay so Vite proxy doesn't spam ECONNREFUSED while uvicorn initialises
    const t = setTimeout(() => {
    fetch("/library/status")
      .then((r) => r.json())
      .then((status) => {
        if (status.configured && status.content_files.length > 0) {
          // Try to restore a committed session from localStorage
          const saved = localStorage.getItem("studybuddy_session")
          if (saved) {
            try {
              const s: AppSession = JSON.parse(saved)
              setSession(s)
              // Restore lesson cache so previously loaded lessons don't need re-fetching
              if (s.lessonCache && Object.keys(s.lessonCache).length > 0) {
                useSessionStore.getState().setLessonCache(s.lessonCache)
              }
              if (s.knowledgeMode) {
                useSessionStore.getState().setKnowledgeMode(s.knowledgeMode)
              }
              setView("tree")
              return
            } catch { /* corrupt data, fall through */ }
          }
          setView("manual")
        }
      })
      .catch(() => {/* backend not ready yet */})
      .finally(() => setChecking(false))
    }, 2000)
    return () => clearTimeout(t)
  }, [])

  const handleSessionReady = (s: AppSession) => {
    setSession(s)
    localStorage.setItem("studybuddy_session", JSON.stringify(s))
    if (s.documentId) setDocumentId(s.documentId)
    setView("tree")  // show tree first after upload
  }

  if (checking) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#FAF7F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#6B7280", fontFamily: "'Libre Caslon Text', Georgia, serif" }}>Loading Study Buddy…</span>
      </div>
    )
  }

  if (view === "setup") {
    return <SetupModal onSessionReady={handleSessionReady} />
  }

  if (view === "tree") {
    return (
      <TreePage
        session={session}
        sendEvent={sendEvent}
        onBack={() => setView("manual")}
        onNeedSetup={() => setView("setup")}
      />
    )
  }

  return (
    <>
      <FloatingToolbar />
      <ManualPage
        session={session}
        sendEvent={sendEvent}
        onShowTree={() => setView("tree")}
        onNeedSetup={() => setView("setup")}
      />
    </>
  )
}
