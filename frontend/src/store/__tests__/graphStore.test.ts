import { beforeEach, describe, expect, it } from "vitest"
import { useGraphStore } from "../graphStore"
import type { NodeData } from "../../types"

const makeNode = (id: string, overrides: Partial<NodeData> = {}): NodeData => ({
  id,
  label: id,
  description: "",
  status: "ACTIVE",
  depth: 1,
  complexity: 3,
  scores: { memory: 0, comprehension: 0, structure: 0, application: 0 },
  parent_id: null,
  children_ids: [],
  ...overrides,
})

describe("graphStore", () => {
  beforeEach(() => {
    useGraphStore.setState({ nodes: [], edges: [] })
  })

  it("setGraph stores nodes and edges", () => {
    useGraphStore.getState().setGraph(
      [{ id: "n1", type: "concept", position: { x: 0, y: 0 }, data: makeNode("n1") }],
      []
    )
    expect(useGraphStore.getState().nodes).toHaveLength(1)
  })

  it("applyNodePatch updates status", () => {
    useGraphStore.setState({
      nodes: [{ id: "n1", type: "concept", position: { x: 0, y: 0 }, data: makeNode("n1") }],
      edges: [],
    })
    useGraphStore.getState().applyNodePatch({ node_id: "n1", status: "MASTERED" })
    expect(useGraphStore.getState().nodes[0].data.status).toBe("MASTERED")
  })

  it("score patch is monotone -> scores never decrease", () => {
    useGraphStore.setState({
      nodes: [
        {
          id: "n1",
          type: "concept",
          position: { x: 0, y: 0 },
          data: makeNode("n1", { scores: { memory: 70, comprehension: 60, structure: 50, application: 40 } }),
        },
      ],
      edges: [],
    })
    useGraphStore.getState().applyNodePatch({ node_id: "n1", score_patch: { memory: 30 } })
    expect(useGraphStore.getState().nodes[0].data.scores.memory).toBe(70)
  })

  it("score patch increases when higher", () => {
    useGraphStore.setState({
      nodes: [{ id: "n1", type: "concept", position: { x: 0, y: 0 }, data: makeNode("n1") }],
      edges: [],
    })
    useGraphStore.getState().applyNodePatch({ node_id: "n1", score_patch: { memory: 85 } })
    expect(useGraphStore.getState().nodes[0].data.scores.memory).toBe(85)
  })

  it("does not affect other nodes when patching one", () => {
    useGraphStore.setState({
      nodes: [
        { id: "n1", type: "concept", position: { x: 0, y: 0 }, data: makeNode("n1") },
        { id: "n2", type: "concept", position: { x: 0, y: 0 }, data: makeNode("n2") },
      ],
      edges: [],
    })
    useGraphStore.getState().applyNodePatch({ node_id: "n1", status: "MASTERED" })
    expect(useGraphStore.getState().nodes[1].data.status).toBe("ACTIVE")
  })
})
