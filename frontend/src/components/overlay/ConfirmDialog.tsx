interface Props {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(26,26,46,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 500,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#FAF7F2",
          border: "1px solid #E8E0D5",
          borderRadius: 14,
          padding: 24,
          width: 380,
          boxShadow: "0 12px 40px rgba(26,53,87,0.25)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h3 style={{ margin: 0, color: "#1A3557", fontSize: 18, fontWeight: 700, fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
          {title}
        </h3>
        <p style={{ margin: 0, color: "#4B5563", fontSize: 14, lineHeight: 1.6 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
          <button
            onClick={onCancel}
            style={{
              background: "transparent",
              color: "#6B7280",
              border: "1px solid #E8E0D5",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: danger ? "#B91C1C" : "#1A3557",
              color: "#FAF7F2",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
