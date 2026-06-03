import { useCallback, useEffect, useRef, useState } from "react"
import { api, type RecognizeResult } from "./api"
import { useCamera } from "./useCamera"
import { CameraView } from "./CameraView"
import { Button, C, Card, Spinner } from "./ui"

export function Recognize({ active }: { active: boolean }) {
  const cam = useCamera(active)
  const [auto, setAuto] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RecognizeResult | null>(null)
  const cooldownRef = useRef(0)

  const run = useCallback(async () => {
    if (busy) return
    const cap = cam.capture()
    if (!cap) return
    setBusy(true)
    try {
      const r = await api.recognize(cap.base64)
      setResult(r)
    } catch (e) {
      setResult({
        success: false,
        ci: null,
        name: null,
        similarity: 0,
        processing_time: 0,
        error: String((e as Error).message || e),
      })
    } finally {
      setBusy(false)
    }
  }, [busy, cam])

  // Auto-recognize loop with cooldown after a hit.
  useEffect(() => {
    if (!active || !auto || !cam.ready) return
    let stop = false
    const id = setInterval(async () => {
      if (stop || busy) return
      if (Date.now() < cooldownRef.current) return
      await run()
    }, 1300)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [active, auto, cam.ready, busy, run])

  useEffect(() => {
    if (result?.success) cooldownRef.current = Date.now() + 2500
  }, [result])

  const sim = result ? Math.round(result.similarity * 100) : 0

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CameraView active={active} overlay cam={cam} />

      <div style={{ display: "flex", gap: 10 }}>
        <Button onClick={run} disabled={!cam.ready || busy} style={{ flex: 2 }}>
          {busy ? <Spinner size={18} /> : "Reconocer ahora"}
        </Button>
        <Button
          variant={auto ? "primary" : "ghost"}
          onClick={() => setAuto((a) => !a)}
          style={{ flex: 1 }}
        >
          Auto {auto ? "ON" : "OFF"}
        </Button>
        <Button variant="ghost" onClick={cam.flip} style={{ width: 54, flex: "none" }}>
          ⟲
        </Button>
      </div>

      {result && (
        <Card
          style={{
            animation: "fadeIn 0.25s ease",
            borderColor: result.success ? C.accent : C.border,
            background: result.success ? "var(--accent-subtle)" : C.card,
          }}
        >
          {result.success ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: C.accent,
                  color: "#04161a",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 24,
                  fontWeight: 700,
                  flex: "none",
                }}
              >
                ✓
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
                  {result.name}
                </div>
                <div style={{ color: C.text3, fontSize: 14 }}>
                  CI {result.ci} · {sim}% · {Math.round(result.processing_time * 1000)} ms
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: C.text3, fontSize: 15 }}>
              {result.error || "Sin coincidencia"}
              {result.similarity > 0 && (
                <span style={{ color: C.muted }}> · mejor {sim}%</span>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
