import { useEffect, useState } from "react"
import { SetupModal } from "./components/init/SetupModal"
import { ManualPage } from "./pages/ManualPage"
import { TreePage } from "./pages/TreePage"
import type { FamiliarityLevel, NodeData } from "./types"

export type AppView = "setup" | "manual" | "tree"

export interface AppSession {
  sessionId: string
  topic: string
  familiarity: FamiliarityLevel
  nodes: NodeData[]
  contentFiles: string[]  // file paths
}

export default function App() {
  const [view, setView] = useState<AppView>("setup")
  const [session, setSession] = useState<AppSession | null>(null)
  const [checking, setChecking] = useState(true)

  // On mount, check if library is already configured
  useEffect(() => {
    fetch("/library/status")
      .then((r) => r.json())
      .then((status) => {
        if (status.configured && status.content_files.length > 0) {
          // Library ready — go directly to manual view (setup in background)
          setView("manual")
        }
      })
      .catch(() => {/* network not ready yet */})
      .finally(() => setChecking(false))
  }, [])

  const handleSessionReady = (s: AppSession) => {
    setSession(s)
    setView("manual")
  }

  if (checking) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#FAF7F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#6B7280", fontFamily: "Georgia, serif" }}>Loading Study Buddy…</span>
      </div>
    )
  }

  if (view === "setup") {
    return <SetupModal onSessionReady={handleSessionReady} />
  }

  if (view === "tree") {
    return (
      <TreePage
        nodes={session?.nodes ?? []}
        onBack={() => setView("manual")}
      />
    )
  }

  return (
    <ManualPage
      session={session}
      onShowTree={() => setView("tree")}
      onNeedSetup={() => setView("setup")}
    />
  )
}
