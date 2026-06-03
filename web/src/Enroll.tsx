import { useState } from "react"
import { api } from "./api"
import { useCamera } from "./useCamera"
import { CameraView } from "./CameraView"
import { Button, C, Card, Field, Spinner } from "./ui"

export function Enroll({ active }: { active: boolean }) {
  const cam = useCamera(active)
  const [ci, setCi] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const submit = async () => {
    setMsg(null)
    if (!ci.trim()) {
      setMsg({ ok: false, text: "Ingresá el CI." })
      return
    }
    const cap = cam.capture()
    if (!cap) {
      setMsg({ ok: false, text: "Cámara no lista." })
      return
    }
    setPreview(cap.dataUrl)
    setBusy(true)
    try {
      const r = await api.enroll(ci.trim(), name.trim(), cap.base64)
      setMsg({
        ok: true,
        text: `Enrolado: ${r.name} (CI ${r.ci}). Galería: ${r.total}.`,
      })
      setCi("")
      setName("")
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message || e) })
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CameraView active={active} overlay cam={cam} />
      <div style={{ display: "flex", gap: 10 }}>
        <Button variant="ghost" onClick={cam.flip} style={{ width: 54, flex: "none" }}>
          ⟲
        </Button>
      </div>

      <Card>
        <Field
          label="Cédula (CI)"
          value={ci}
          inputMode="numeric"
          placeholder="1234567"
          onChange={(e) => setCi(e.target.value)}
        />
        <Field
          label="Nombre"
          value={name}
          placeholder="Nombre y apellido"
          onChange={(e) => setName(e.target.value)}
        />
        <Button onClick={submit} disabled={!cam.ready || busy}>
          {busy ? <Spinner size={18} /> : "Capturar y enrolar"}
        </Button>
      </Card>

      {preview && (
        <img
          src={preview}
          alt="captura"
          style={{
            width: 120,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            alignSelf: "center",
          }}
        />
      )}

      {msg && (
        <Card
          style={{
            animation: "fadeIn 0.2s ease",
            borderColor: msg.ok ? C.accent : "rgba(239,68,68,0.3)",
            background: msg.ok ? "var(--accent-subtle)" : "rgba(239,68,68,0.08)",
            color: msg.ok ? C.text : C.error,
            fontSize: 14,
          }}
        >
          {msg.text}
        </Card>
      )}
    </div>
  )
}
