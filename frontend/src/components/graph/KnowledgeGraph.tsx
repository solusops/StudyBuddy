import { Background, Controls, MiniMap, ReactFlow } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { ConceptNode } from "./ConceptNode"
import { useGraphStore } from "../../store/graphStore"
import { useSessionStore } from "../../store/sessionStore"
import type { NodeData } from "../../types"

const nodeTypes = { concept: ConceptNode }

interface Props {
  onNodeClick: (id: string, label: string) => void
}

export function KnowledgeGraph({ onNodeClick }: Props) {
  const { nodes, edges } = useGraphStore()
  const { setActiveNode } = useSessionStore()

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => {
          const data = node.data as NodeData
          if (data.status === "LOCKED") return
          setActiveNode(node.id, data.label)
          onNodeClick(node.id, data.label)
        }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e293b" gap={24} />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const d = n.data as NodeData
            return d?.status === "MASTERED" ? "#22c55e" : "#3b82f6"
          }}
          style={{ background: "#0f172a" }}
        />
      </ReactFlow>
    </div>
  )
}
