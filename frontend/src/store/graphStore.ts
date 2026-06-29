import { create } from "zustand"
import type { Edge, Node } from "@xyflow/react"
import type { NodeData, NodePatch, NodeScores } from "../types"

interface GraphStore {
  nodes: Node<NodeData>[]
  edges: Edge[]
  setGraph: (nodes: Node<NodeData>[], edges: Edge[]) => void
  addNode: (data: NodeData) => void
  addEdge: (source: string, target: string, relationship?: string) => void
  applyNodePatch: (patch: NodePatch) => void
  reset: () => void
}

// Monotone clamp — scores can only increase. Mirrors backend GraphStateManager.
function clampScores(current: NodeScores, patch: Partial<NodeScores>): NodeScores {
  return {
    memory: Math.max(current.memory, patch.memory ?? 0),
    comprehension: Math.max(current.comprehension, patch.comprehension ?? 0),
    structure: Math.max(current.structure, patch.structure ?? 0),
    application: Math.max(current.application, patch.application ?? 0),
  }
}

export const useGraphStore = create<GraphStore>((set) => ({
  nodes: [],
  edges: [],

  setGraph: (nodes, edges) => set({ nodes, edges }),

  // Incremental streaming (BUILD_GRAPH "fireworks") — append, ignoring duplicates.
  addNode: (data) =>
    set((state) => {
      if (state.nodes.some((n) => n.id === data.id)) return state
      const node: Node<NodeData> = { id: data.id, type: "concept", position: { x: 0, y: 0 }, data }
      return { nodes: [...state.nodes, node] }
    }),

  addEdge: (source, target, relationship = "prerequisite") =>
    set((state) => {
      const id = `${source}-${target}`
      if (state.edges.some((e) => e.id === id)) return state
      const edge: Edge = { id, source, target, type: "smoothstep", data: { relationship } }
      return { edges: [...state.edges, edge] }
    }),

  applyNodePatch: (patch) =>
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== patch.node_id) return n
        const data = { ...n.data }
        if (patch.status) data.status = patch.status
        if (patch.updated_description) data.description = patch.updated_description
        if (patch.new_children) {
          data.children_ids = [
            ...data.children_ids,
            ...patch.new_children.filter((c) => !data.children_ids.includes(c)),
          ]
        }
        if (patch.score_patch) data.scores = clampScores(data.scores, patch.score_patch)
        return { ...n, data }
      }),
    })),

  reset: () => set({ nodes: [], edges: [] }),
}))
