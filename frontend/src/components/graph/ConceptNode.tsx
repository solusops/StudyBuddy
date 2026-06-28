import type { NodeProps } from "@xyflow/react"
import type { NodeData } from "../../types"

const STATUS_COLOR: Record<string, string> = {
  LOCKED: "#374151",
  ACTIVE: "#3b82f6",
  MASTERED: "#22c55e",
  STRUGGLING: "#ef4444",
  DEGRADED: "#f59e0b",
}

export function ConceptNode({ id, data, selected }: NodeProps<NodeData>) {
  const avg = Math.round(
    (data.scores.memory + data.scores.comprehension + data.scores.structure + data.scores.application) / 4
  )
  const bg = STATUS_COLOR[data.status] ?? "#374151"

  return (
    <div
      data-testid={`node-${id}`}
      style={{
        background: bg,
        padding: "10px 16px",
        borderRadius: 8,
        minWidth: 130,
        border: selected ? "2px solid white" : "2px solid transparent",
        color: "white",
        cursor: data.status === "LOCKED" ? "not-allowed" : "pointer",
        opacity: data.status === "LOCKED" ? 0.5 : 1,
        userSelect: "none",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13 }}>{data.label}</div>
      <div style={{ fontSize: 11, opacity: 0.75 }}>{avg}% mastery</div>
      {data.status === "LOCKED" && (
        <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>🔒 locked</div>
      )}
    </div>
  )
}
