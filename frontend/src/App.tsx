import { useEffect, useState } from "react"
import { SetupModal } from "./components/init/SetupModal"
import { ManualPage } from "./pages/ManualPage"
import { TreePage } from "./pages/TreePage"
import { useWebSocket } from "./hooks/useWebSocket"
import type { FamiliarityLevel, NodeData } from "./types"

export type AppView = "setup" | "manual" | "tree"

export interface AppSession {
  sessionId: string
  topic: string
  familiarity: FamiliarityLevel
  nodes: NodeData[]
  contentFiles: string[]
}

export default function App() {
  const [view, setView] = useState<AppView>("setup")
  const [session, setSession] = useState<AppSession | null>(null)
  const [checking, setChecking] = useState(true)

  // Single WebSocket at App level — persists across view transitions
  const { sendEvent } = useWebSocket(session?.sessionId ?? null)

  // On mount, check if library is already configured and restore any saved session
  useEffect(() => {
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
              setView("tree")
              return
            } catch { /* corrupt data, fall through */ }
          }
          setView("manual")
        }
      })
      .catch(() => {/* backend not ready yet */})
      .finally(() => setChecking(false))
  }, [])

  const handleSessionReady = (s: AppSession) => {
    setSession(s)
    localStorage.setItem("studybuddy_session", JSON.stringify(s))
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
    <ManualPage
      session={session}
      sendEvent={sendEvent}
      onShowTree={() => setView("tree")}
      onNeedSetup={() => setView("setup")}
    />
  )
}
