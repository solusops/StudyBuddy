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
            padding: "9px 16px",
            border: "none",
            borderBottom: active === tab ? "2px solid #1A3557" : "2px solid transparent",
            background: "transparent",
            color: active === tab ? "#1A3557" : "#6B7280",
            fontWeight: active === tab ? 600 : 400,
            fontSize: 13,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
            transition: "color 0.15s",
            flexShrink: 0,
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
