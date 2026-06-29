import { useEffect, useState } from "react"
import type { Edge, Node } from "@xyflow/react"
import { KnowledgeGraph } from "../components/graph/KnowledgeGraph"
import { NodePanel } from "../components/panel/NodePanel"
import { useGraphStore } from "../store/graphStore"
import { useSessionStore } from "../store/sessionStore"
import { useWebSocket } from "../hooks/useWebSocket"
import { saveMarkdownFile, sanitizeFilename } from "../lib/fileSystem"
import type { FamiliarityLevel, NodeData } from "../types"

interface Props {
  sessionId: string
  topic: string
  familiarity: FamiliarityLevel
  initialNodes: NodeData[]
}

function buildFlowGraph(nodes: NodeData[]): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const COLS = 4
  const flowNodes: Node<NodeData>[] = nodes.map((n, i) => ({
    id: n.id,
    type: "concept",
    position: { x: (i % COLS) * 200, y: Math.floor(i / COLS) * 120 },
    data: n,
  }))
  const edges: Edge[] = nodes.flatMap((n) =>
    (n.children_ids ?? []).map((childId) => ({
      id: `${n.id}-${childId}`,
      source: n.id,
      target: childId,
      type: "smoothstep",
    }))
  )
  return { nodes: flowNodes, edges }
}

interface Props {
  sessionId: string
  topic: string
  familiarity: FamiliarityLevel
  knowledgeMode?: "content_only" | "net_support"
  initialNodes: NodeData[]
}

export function StudyPage({ sessionId, topic, familiarity, knowledgeMode, initialNodes }: Props) {
  const { setGraph } = useGraphStore()
  const { setSession, setActiveNode, resetNodeData, lesson, setLesson, activeNodeId } = useSessionStore()
  const { sendEvent } = useWebSocket(sessionId)
  const [panelOpen, setPanelOpen] = useState(false)
  const [ending, setEnding] = useState(false)

  useEffect(() => {
    setSession(sessionId, topic, familiarity, knowledgeMode)
    const { nodes, edges } = buildFlowGraph(initialNodes)
    setGraph(nodes, edges)
  }, [])

  const handleNodeClick = (id: string, label: string) => {
    resetNodeData()
    setActiveNode(id, label)
    setPanelOpen(true)
    sendEvent("LEARN_NODE", { node_id: id, node_label: label, familiarity })
  }

  const handleEndSession = async () => {
    setEnding(true)
    sendEvent("END_SESSION", { topic, familiarity })

    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { markdown: string }
      window.removeEventListener("session-complete", handler)
      const filename = `${sanitizeFilename(topic)}_Summary.md`
      await saveMarkdownFile(filename, detail.markdown)
      setEnding(false)
      alert(`Session complete! Summary saved as ${filename}`)
    }
    window.addEventListener("session-complete", handler)
  }

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#020617", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{
        height: 52,
        background: "#0f172a",
        borderBottom: "1px solid #1e293b",
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        gap: 12,
        zIndex: 50,
      }}>
        <span style={{ color: "white", fontWeight: 700, fontSize: 15 }}>{topic}</span>
        <span style={{ color: "#334155", fontSize: 12 }}>·</span>
        <span style={{ color: "#64748b", fontSize: 12 }}>{familiarity}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleEndSession}
          disabled={ending}
          style={{
            background: ending ? "#374151" : "#ef4444",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "6px 16px",
            cursor: ending ? "not-allowed" : "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {ending ? "Saving…" : "End Session"}
        </button>
      </div>

      {/* Graph */}
      <div style={{ flex: 1, position: "relative" }}>
        <KnowledgeGraph onNodeClick={handleNodeClick} />
        {panelOpen && activeNodeId && (
          <NodePanel sendEvent={sendEvent} onClose={() => setPanelOpen(false)} />
        )}
      </div>
    </div>
  )
}
