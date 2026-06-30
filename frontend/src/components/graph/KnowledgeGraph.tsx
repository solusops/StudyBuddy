import { useEffect } from "react"
import { Background, Controls, ReactFlow, useEdgesState, useNodesState, useReactFlow } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import dagre from "@dagrejs/dagre"
import type { Edge, Node, NodeTypes } from "@xyflow/react"
import { ConceptNode } from "./ConceptNode"
import { useGraphStore } from "../../store/graphStore"
import { useSessionStore } from "../../store/sessionStore"
import type { NodeData } from "../../types"

const nodeTypes: NodeTypes = { concept: ConceptNode }

/** Compute per-node width/height based on complexity + depth */
function getNodeDimensions(data: NodeData): { w: number; h: number } {
  const c = Math.max(1, Math.min(5, data.complexity ?? 3))
  const isRoot = data.depth === 0
  // Matches ConceptNode sizing logic
  const w = isRoot ? 200 : 100 + (c - 1) * 20 + 40 // minWidth + padding
  const h = isRoot ? 56 : 40 + (c - 1) * 4 + 16    // base + padding
  return { w, h }
}

function applyDagreLayout(
  nodes: Node<NodeData>[],
  edges: Edge[]
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: "TB",
    nodesep: 50,
    ranksep: 100,    // increased for better vertical spacing in deeper trees
    marginx: 40,
    marginy: 40,
  })

  // Set per-node dimensions so dagre allocates the right space
  nodes.forEach((n) => {
    const { w, h } = getNodeDimensions(n.data)
    g.setNode(n.id, { width: w, height: h })
  })

  // Only use parent_id edges for the dagre layout — these define the hierarchy.
  // Cross-links (edges) are drawn but don't influence rank placement.
  const parentEdgeIds = new Set<string>()
  nodes.forEach((n) => {
    if (n.data.parent_id) {
      const edgeId = `${n.data.parent_id}-${n.id}`
      parentEdgeIds.add(edgeId)
      g.setEdge(n.data.parent_id, n.id)
    }
  })

  dagre.layout(g)

  const laid = nodes.map((n) => {
    const pos = g.node(n.id)
    const { w, h } = getNodeDimensions(n.data)
    return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } }
  })
  return { nodes: laid, edges }
}

// Re-fit the viewport as nodes stream in during BUILD_GRAPH so the graph stays framed.
function FitOnChange({ count }: { count: number }) {
  const rf = useReactFlow()
  useEffect(() => {
    if (count > 0) rf.fitView({ padding: 0.2, duration: 350 })
  }, [count, rf])
  return null
}

interface Props {
  onNodeClick: (id: string, label: string) => void
}

export function KnowledgeGraph({ onNodeClick }: Props) {
  const { nodes: storeNodes, edges: storeEdges } = useGraphStore()
  const { setActiveNode } = useSessionStore()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

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
        <FitOnChange count={nodes.length} />
        <Background color="#E8E0D5" gap={24} style={{ background: "#FAF7F2" }} />
        <Controls style={{ background: "#FFFFFF", border: "1px solid #E8E0D5", borderRadius: 8 }} />
      </ReactFlow>
    </div>
  )
}
