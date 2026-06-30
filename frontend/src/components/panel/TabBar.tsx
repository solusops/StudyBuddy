interface Props {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
}

export function TabBar({ tabs, active, onChange }: Props) {
  return (
    <div
      style={{
        display: "flex",
        borderBottom: "1px solid #E8E0D5",
        background: "#FFFFFF",
        flexShrink: 0,
        overflowX: "auto",
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          style={{
            padding: "14px 18px",
            border: "none",
            borderBottom: active === tab ? "3px solid #1A3557" : "3px solid transparent",
            background: "transparent",
            color: active === tab ? "#1A3557" : "#64748B",
            fontWeight: active === tab ? 700 : 500,
            fontSize: 14,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
            transition: "all 0.2s",
            flexShrink: 0,
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
