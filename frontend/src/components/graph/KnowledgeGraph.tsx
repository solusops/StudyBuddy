import { useEffect } from "react"
import { Background, Controls, ReactFlow, useEdgesState, useNodesState } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import dagre from "@dagrejs/dagre"
import type { Edge, Node } from "@xyflow/react"
import { ConceptNode } from "./ConceptNode"
import { useGraphStore } from "../../store/graphStore"
import { useSessionStore } from "../../store/sessionStore"
import type { NodeData } from "../../types"

const nodeTypes = { concept: ConceptNode }
const NODE_W = 180
const NODE_H = 64

function applyDagreLayout(
  nodes: Node<NodeData>[],
  edges: Edge[]
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80, marginx: 40, marginy: 40 })

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)

  const laid = nodes.map((n) => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
  })
  return { nodes: laid, edges }
}

interface Props {
  onNodeClick: (id: string, label: string) => void
}

export function KnowledgeGraph({ onNodeClick }: Props) {
  const { nodes: storeNodes, edges: storeEdges } = useGraphStore()
  const { setActiveNode } = useSessionStore()
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Recompute dagre layout whenever the store graph changes
  useEffect(() => {
    if (!storeNodes.length) return
    const { nodes: laid, edges: laidEdges } = applyDagreLayout(storeNodes, storeEdges)
    // Style edges by relationship type
    const styled = laidEdges.map((e) => {
      const rel = (e.data as Record<string, string> | undefined)?.relationship
      if (rel === "related") return { ...e, style: { stroke: "#4A7FB5", strokeWidth: 1.5, strokeDasharray: "5 4" }, animated: false }
      if (rel === "builds-on") return { ...e, style: { stroke: "#2D6A4F", strokeWidth: 2 }, animated: false }
      return { ...e, style: { stroke: "#D1C9C0", strokeWidth: 1.5 } }  // prerequisite / default
    })
    setNodes(laid)
    setEdges(styled)
  }, [storeNodes, storeEdges])

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          const data = node.data as NodeData
          setActiveNode(node.id, data.label)
          onNodeClick(node.id, data.label)
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#E8E0D5" gap={24} style={{ background: "#FAF7F2" }} />
        <Controls style={{ background: "#FFFFFF", border: "1px solid #E8E0D5", borderRadius: 8 }} />
      </ReactFlow>
    </div>
  )
}
