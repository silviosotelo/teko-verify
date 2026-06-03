import { useState } from "react"
import { Recognize } from "./Recognize"
import { Enroll } from "./Enroll"
import { Persons } from "./Persons"
import { Settings } from "./Settings"
import { History } from "./History"
import { C } from "./ui"

type Tab = "recognize" | "enroll" | "persons" | "history" | "settings"

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "recognize", label: "Reconocer", icon: "◎" },
  { id: "enroll", label: "Enrolar", icon: "+" },
  { id: "persons", label: "Personas", icon: "☰" },
  { id: "history", label: "Historial", icon: "◷" },
  { id: "settings", label: "Ajustes", icon: "⚙" },
]

export default function App() {
  const [tab, setTab] = useState<Tab>("recognize")

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        maxWidth: 560,
        margin: "0 auto",
        position: "relative",
      }}
    >
      <header
        style={{
          padding: "16px 18px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: C.accent,
            color: "#04161a",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 17,
          }}
        >
          ◎
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, lineHeight: 1 }}>
            Reconocimiento Facial
          </div>
          <div style={{ color: C.muted, fontSize: 12 }}>v9 · motor facenox ONNX</div>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 16px 92px",
        }}
      >
        {/* Keep camera screens mounted only when active so streams release. */}
        <div style={{ display: tab === "recognize" ? "block" : "none" }}>
          <Recognize active={tab === "recognize"} />
        </div>
        <div style={{ display: tab === "enroll" ? "block" : "none" }}>
          <Enroll active={tab === "enroll"} />
        </div>
        {tab === "persons" && <Persons active />}
        {tab === "history" && <History active />}
        {tab === "settings" && <Settings active />}
      </main>

      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          maxWidth: 560,
          margin: "0 auto",
          background: "var(--surface-glass)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: `1px solid ${C.border}`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {TABS.map((t) => {
          const on = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: on ? C.accent : C.text3,
                padding: "11px 0 13px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                fontSize: 11,
                fontWeight: 600,
                transition: "color 0.15s",
              }}
            >
              <span style={{ fontSize: 19 }}>{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
