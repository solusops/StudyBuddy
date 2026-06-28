import { useState } from "react"
import { InitModal } from "./components/init/InitModal"
import { StudyPage } from "./pages/StudyPage"
import type { FamiliarityLevel, NodeData } from "./types"

interface StudySession {
  sessionId: string
  topic: string
  familiarity: FamiliarityLevel
  nodes: NodeData[]
}

export default function App() {
  const [session, setSession] = useState<StudySession | null>(null)

  const handleSessionReady = (
    sessionId: string,
    topic: string,
    familiarity: FamiliarityLevel,
    nodes: unknown[]
  ) => {
    setSession({ sessionId, topic, familiarity, nodes: nodes as NodeData[] })
  }

  if (!session) {
    return <InitModal onSessionReady={handleSessionReady} />
  }

  return (
    <StudyPage
      sessionId={session.sessionId}
      topic={session.topic}
      familiarity={session.familiarity}
      initialNodes={session.nodes}
    />
  )
}
