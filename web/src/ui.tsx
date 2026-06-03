import type { CSSProperties, ReactNode } from "react"

export const C = {
  bg: "var(--bg-primary)",
  card: "var(--card-bg)",
  border: "var(--card-border)",
  borderH: "var(--card-hover-border)",
  accent: "var(--accent)",
  accentH: "var(--accent-hover)",
  accentSub: "var(--accent-subtle)",
  text: "var(--text-primary)",
  text2: "var(--text-secondary)",
  text3: "var(--text-tertiary)",
  muted: "var(--text-muted)",
  error: "var(--error)",
  warning: "var(--warning)",
}

export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        display: "inline-block",
        border: `2.5px solid rgba(255,255,255,0.15)`,
        borderTopColor: C.accent,
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }}
    />
  )
}

export function Card({
  children,
  style,
}: {
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  style,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: "primary" | "ghost" | "danger"
  disabled?: boolean
  style?: CSSProperties
}) {
  const base: CSSProperties = {
    border: "1px solid transparent",
    borderRadius: 12,
    padding: "11px 18px",
    fontSize: 15,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "all 0.15s ease",
    opacity: disabled ? 0.5 : 1,
    pointerEvents: disabled ? "none" : "auto",
    width: "100%",
  }
  const variants: Record<string, CSSProperties> = {
    primary: { background: C.accent, color: "#04161a" },
    ghost: {
      background: "transparent",
      color: C.text2,
      border: `1px solid ${C.border}`,
    },
    danger: {
      background: "rgba(239,68,68,0.12)",
      color: C.error,
      border: "1px solid rgba(239,68,68,0.3)",
    },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  ...props
}: {
  label: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span
        style={{
          display: "block",
          fontSize: 13,
          color: C.text3,
          marginBottom: 6,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <input
        {...props}
        style={{
          width: "100%",
          background: "var(--bg-tertiary)",
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "11px 13px",
          color: C.text,
          fontSize: 15,
          outline: "none",
        }}
      />
    </label>
  )
}
