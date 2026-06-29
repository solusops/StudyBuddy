import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { NodeData } from "../../types"

const STATUS_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  LOCKED:     { bg: "#F3F0ED", border: "#D1C9C0", text: "#9CA3AF" },
  ACTIVE:     { bg: "#EEF3F8", border: "#1A3557", text: "#1A3557" },
  MASTERED:   { bg: "#E6F4ED", border: "#2D6A4F", text: "#2D6A4F" },
  STRUGGLING: { bg: "#FEF2E8", border: "#92400E", text: "#92400E" },
  DEGRADED:   { bg: "#FEF3C7", border: "#B45309", text: "#B45309" },
}

export function ConceptNode({ id, data, selected }: NodeProps<NodeData>) {
  const avg = Math.round(
    (data.scores.memory + data.scores.comprehension + data.scores.structure + data.scores.application) / 4
  )
  const colors = STATUS_COLOR[data.status] ?? STATUS_COLOR.LOCKED
  const isLocked = data.status === "LOCKED"

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
          cursor: isLocked ? "not-allowed" : "pointer",
          opacity: isLocked ? 0.55 : 1,
          userSelect: "none",
          boxShadow: selected ? `0 0 0 3px ${colors.border}33` : "0 1px 4px rgba(26,53,87,0.08)",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{data.label}</div>
        {avg > 0 && (
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.75 }}>{avg}% mastery</div>
        )}
        {isLocked && (
          <div style={{ fontSize: 10, marginTop: 3, opacity: 0.5 }}>locked</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: colors.border, width: 8, height: 8 }} />
    </>
  )
}
