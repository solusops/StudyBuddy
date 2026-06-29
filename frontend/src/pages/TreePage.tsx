import { useCallback, useEffect, useState } from "react"
import { KnowledgeGraph } from "../components/graph/KnowledgeGraph"
import { useGraphStore } from "../store/graphStore"
import { useSessionStore } from "../store/sessionStore"
import type { AppSession } from "../App"
import type { NodeData } from "../types"
import type { Edge, Node } from "@xyflow/react"

interface Props {
  session: AppSession | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  onBack: () => void
  onNeedSetup: () => void
}

export function TreePage({ session, sendEvent, onBack, onNeedSetup }: Props) {
  const { nodes, setGraph } = useGraphStore()
  const { streamingLesson, lessonStreaming, lesson } = useSessionStore()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editedDesc, setEditedDesc] = useState("")
  const [refinementText, setRefinementText] = useState("")
  const [isRefining, setIsRefining] = useState(false)
  const [refineError, setRefineError] = useState("")

  const selectedNode = nodes.find((n) => n.id === selectedId)

  // When node is selected, pre-fill the description edit box
  useEffect(() => {
    if (selectedNode) {
      setEditedDesc(selectedNode.data.description)
    }
  }, [selectedId])

  const handleNodeClick = useCallback(
    (id: string, label: string) => {
      setSelectedId(id)
      sendEvent("LEARN_NODE", {
        node_id: id,
        node_label: label,
        familiarity: session?.familiarity ?? "high_school",
      })
    },
    [sendEvent, session?.familiarity]
  )

  // Apply local description edit to the graph store
  const applyDescEdit = () => {
    if (!selectedId) return
    const { nodes: storeNodes, edges } = useGraphStore.getState()
    const updated = storeNodes.map((n) =>
      n.id === selectedId
        ? { ...n, data: { ...n.data, description: editedDesc } }
        : n
    )
    setGraph(updated, edges)
  }

  // Regenerate tree with student guidance
  const refineTree = async () => {
    if (!refinementText.trim() || !session) return
    setRefineError("")
    setIsRefining(true)
    try {
      const resp = await fetch("/library/refine-tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.sessionId,
          user_feedback: refinementText,
          familiarity: session.familiarity,
        }),
      })
      if (!resp.ok) {
        const e = await resp.json()
        throw new Error(e.detail || "Refinement failed")
      }
      const { nodes: newNodes } = await resp.json()
      applyNodes(newNodes)
      setRefinementText("")
      setSelectedId(null)
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRefining(false)
    }
  }

  const applyNodes = (rawNodes: NodeData[]) => {
    const flowNodes: Node<NodeData>[] = rawNodes.map((n, i) => ({
      id: n.id,
      type: "concept",
      position: { x: i * 200, y: 0 },
      data: n,
    }))
    const edges: Edge[] = rawNodes.flatMap((n) =>
      (n.children_ids ?? []).map((cid) => ({
        id: `${n.id}-${cid}`,
        source: n.id,
        target: cid,
        type: "smoothstep",
      }))
    )
    setGraph(flowNodes, edges)
  }

  const lessonText = lessonStreaming ? streamingLesson : (lesson?.grounded_truth ?? "")

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#FAF7F2" }}>
      {/* Top bar */}
      <div style={{
        height: 48,
        background: "#FFFFFF",
        borderBottom: "1px solid #E8E0D5",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 12,
        flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{ background: "transparent", color: "#1A3557", border: "none", cursor: "pointer", fontSize: 20, padding: "0 8px 0 0", lineHeight: 1 }}
          aria-label="Back to reading"
        >
          ←
        </button>
        <span style={{ fontFamily: "Georgia, serif", fontWeight: 700, color: "#1A3557", fontSize: 15, flex: 1 }}>
          {session?.topic || "Knowledge Tree"}
        </span>
        <span style={{ color: "#9CA3AF", fontSize: 12 }}>
          Click a node to explore · edit its description · refine the whole tree below
        </span>
        <button
          onClick={() => { setSelectedId(null); onNeedSetup() }}
          style={{ background: "transparent", color: "#9CA3AF", border: "1px solid #E8E0D5", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}
        >
          New session
        </button>
      </div>

      {/* Main area: graph + sliding node panel */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Knowledge graph */}
        <div style={{ flex: 1 }}>
          <KnowledgeGraph onNodeClick={handleNodeClick} />
        </div>

        {/* Sliding node panel */}
        {selectedNode && (
          <div style={{
            width: 360,
            display: "flex",
            flexDirection: "column",
            background: "#FFFFFF",
            borderLeft: "1px solid #E8E0D5",
            overflow: "hidden",
            flexShrink: 0,
          }}>
            {/* Panel header */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #E8E0D5", display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1A3557", fontFamily: "Georgia, serif" }}>
                  {selectedNode.data.label}
                </h3>
                <span style={{
                  display: "inline-block", marginTop: 4, fontSize: 11, fontWeight: 500,
                  color: selectedNode.data.status === "MASTERED" ? "#2D6A4F" : selectedNode.data.status === "ACTIVE" ? "#1A3557" : "#9CA3AF",
                  background: selectedNode.data.status === "MASTERED" ? "#E6F4ED" : selectedNode.data.status === "ACTIVE" ? "#EEF3F8" : "#F3F0ED",
                  borderRadius: 4, padding: "2px 8px",
                }}>
                  {selectedNode.data.status}
                </span>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 18, padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Editable description */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Node description
                </label>
                <textarea
                  value={editedDesc}
                  onChange={(e) => setEditedDesc(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%",
                    background: "#FAF7F2",
                    border: "1px solid #E8E0D5",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 13,
                    color: "#1A1A2E",
                    resize: "vertical",
                    boxSizing: "border-box",
                    fontFamily: "Georgia, serif",
                    outline: "none",
                  }}
                />
                {editedDesc !== selectedNode.data.description && (
                  <button
                    onClick={applyDescEdit}
                    style={{
                      marginTop: 6,
                      background: "#1A3557",
                      color: "#FAF7F2",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 14px",
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Apply changes
                  </button>
                )}
              </div>

              {/* Lesson content */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Lesson
                </label>
                {lessonStreaming && (
                  <div style={{ fontSize: 13, lineHeight: 1.75, color: "#1A1A2E", fontFamily: "Georgia, serif", whiteSpace: "pre-wrap" }}>
                    {streamingLesson}
                    <span style={{ display: "inline-block", width: 2, height: "1em", background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
                  </div>
                )}
                {!lessonStreaming && lessonText && (
                  <div style={{ fontSize: 13, lineHeight: 1.75, color: "#1A1A2E", fontFamily: "Georgia, serif", whiteSpace: "pre-wrap" }}>
                    {lessonText}
                  </div>
                )}
                {!lessonStreaming && !lessonText && (
                  <p style={{ color: "#9CA3AF", fontSize: 13, margin: 0 }}>Loading lesson…</p>
                )}
              </div>

              {/* Study tools shortcut */}
              <button
                onClick={onBack}
                style={{
                  background: "transparent",
                  color: "#1A3557",
                  border: "1.5px solid #1A3557",
                  borderRadius: 8,
                  padding: "9px 0",
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontFamily: "Georgia, serif",
                }}
              >
                Open study tools →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom: curriculum refinement bar */}
      <div style={{
        borderTop: "1px solid #E8E0D5",
        background: "#FFFFFF",
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Refine curriculum
            </label>
            <textarea
              value={refinementText}
              onChange={(e) => setRefinementText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) refineTree() }}
              placeholder='e.g. "Focus more on thermodynamics", "The tree is missing fluid dynamics", "Too many sub-nodes for chapter 1"'
              rows={2}
              style={{
                width: "100%",
                background: "#FAF7F2",
                border: "1px solid #E8E0D5",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 13,
                color: "#1A1A2E",
                resize: "none",
                boxSizing: "border-box",
                outline: "none",
                fontFamily: "system-ui, sans-serif",
              }}
            />
          </div>
          <button
            onClick={refineTree}
            disabled={isRefining || !refinementText.trim()}
            style={{
              background: isRefining || !refinementText.trim() ? "#E8E0D5" : "#1A3557",
              color: isRefining || !refinementText.trim() ? "#9CA3AF" : "#FAF7F2",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              cursor: isRefining || !refinementText.trim() ? "not-allowed" : "pointer",
              flexShrink: 0,
              alignSelf: "flex-end",
            }}
          >
            {isRefining ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
        {refineError && <p style={{ color: "#EF4444", fontSize: 12, margin: 0 }}>{refineError}</p>}
      </div>
    </div>
  )
}
