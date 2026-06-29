import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { NodeData } from "../../types"

// Status colours — all nodes are open/accessible
const STATUS_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  LOCKED:     { bg: "#EEF3F8", border: "#1A3557", text: "#1A3557" },  // same as ACTIVE — nothing is locked
  ACTIVE:     { bg: "#EEF3F8", border: "#1A3557", text: "#1A3557" },
  MASTERED:   { bg: "#E6F4ED", border: "#2D6A4F", text: "#2D6A4F" },
  STRUGGLING: { bg: "#FEF2E8", border: "#92400E", text: "#92400E" },
  DEGRADED:   { bg: "#FEF3C7", border: "#B45309", text: "#B45309" },
}

export function ConceptNode({ id, data, selected }: NodeProps<NodeData>) {
  const avg = Math.round(
    (data.scores.memory + data.scores.comprehension + data.scores.structure + data.scores.application) / 4
  )
  const colors = STATUS_COLOR[data.status] ?? STATUS_COLOR.ACTIVE

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: colors.border, width: 8, height: 8 }} />
      <div
        data-testid={`node-${id}`}
        style={{
          background: colors.bg,
          padding: "10px 16px",
          borderRadius: 10,
          minWidth: 140,
          maxWidth: 180,
          border: selected ? `2px solid ${colors.border}` : `1.5px solid ${colors.border}`,
          color: colors.text,
          cursor: "pointer",
          userSelect: "none",
          boxShadow: selected ? `0 0 0 3px ${colors.border}33` : "0 1px 4px rgba(26,53,87,0.08)",
          fontFamily: "'Libre Caslon Text', Georgia, serif",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{data.label}</div>
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.75 }}>{avg}% mastery</div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: colors.border, width: 8, height: 8 }} />
    </>
  )
}
