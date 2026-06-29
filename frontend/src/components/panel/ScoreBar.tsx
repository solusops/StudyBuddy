import type { NodeScores } from "../../types"

const AXES = [
  { key: "memory" as const, label: "Memory", color: "#3b82f6" },
  { key: "comprehension" as const, label: "Comprehension", color: "#8b5cf6" },
  { key: "structure" as const, label: "Structure", color: "#f59e0b" },
  { key: "application" as const, label: "Application", color: "#22c55e" },
]

export function ScoreBar({ scores }: { scores: NodeScores }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {AXES.map(({ key, label, color }) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, lineHeight: 1 }}>
          <div style={{ width: 100, fontSize: 11, color: "#6B7280", lineHeight: 1 }}>{label}</div>
          <div style={{ flex: 1, height: 6, background: "#E8E0D5", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                width: `${scores[key]}%`,
                height: "100%",
                background: color,
                borderRadius: 3,
                transition: "width 0.4s ease",
              }}
            />
          </div>
          <div style={{ width: 28, fontSize: 11, color: "#6B7280", textAlign: "right", lineHeight: 1 }}>
            {scores[key]}
          </div>
        </div>
      ))}
    </div>
  )
}
