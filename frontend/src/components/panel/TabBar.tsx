interface Props {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
  disabledTabs?: string[]
}

export function TabBar({ tabs, active, onChange, disabledTabs }: Props) {
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
      {tabs.map((tab) => {
        const disabled = disabledTabs?.includes(tab) ?? false
        return (
          <button
            key={tab}
            onClick={() => !disabled && onChange(tab)}
            disabled={disabled}
            title={disabled ? "Disabled in demo mode" : undefined}
            style={{
              padding: "14px 18px",
              border: "none",
              borderBottom: active === tab ? "3px solid #1A3557" : "3px solid transparent",
              background: "transparent",
              color: disabled ? "#D1D5DB" : active === tab ? "#1A3557" : "#64748B",
              fontWeight: active === tab ? 700 : 500,
              fontSize: 14,
              cursor: disabled ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
              fontFamily: "system-ui, sans-serif",
              transition: "all 0.2s",
              flexShrink: 0,
            }}
          >
            {tab}
          </button>
        )
      })}
    </div>
  )
}
