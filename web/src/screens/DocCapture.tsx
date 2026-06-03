import { useRef, useState } from "react"
import { apiPost, type DocCheckResult } from "../api"
import { docMsg } from "../messages"
import { useCamera } from "../useCamera"
import { Button, Card, Notice } from "../ui"

/**
 * Pantalla cédula (frente/dorso). Cámara trasera con autoenfoque continuo.
 * Lógica PORTADA:
 *  - Capturar → POST /doc-check {image, side}. Si el endpoint LANZA, tratamos
 *    como passed:true (el pipeline en /submit es la autoridad). Solo bloqueamos
 *    si passed===false → tip amable + recaptura.
 *  - Frente OK → guardar y pasar a dorso. Dorso OK → POST /document {front,back}
 *    → onDone (procesando).
 */
export function DocCapture({ onDone }: { onDone: () => void }) {
  const cam = useCamera("environment")
  const [side, setSide] = useState<"front" | "back">("front")
  const frontRef = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  const isFront = side === "front"

  async function capture() {
    setBusy(true)
    setNotice(null)
    setFatal(null)
    const img = cam.grab()

    // Pre-check informativo: si el endpoint falla, avanzamos (pipeline manda).
    let check: DocCheckResult = { passed: true, reasons: [] }
    try {
      check = await apiPost<DocCheckResult>("/doc-check", { image: img, side })
    } catch {
      check = { passed: true, reasons: [] }
    }

    if (!check.passed) {
      setNotice(docMsg(check.reasons))
      setBusy(false)
      void cam.start()
      return
    }

    if (isFront) {
      frontRef.current = img
      setBusy(false)
      setSide("back")
      void cam.start()
      return
    }

    // Dorso OK → subimos ambos lados.
    cam.stop()
    try {
      await apiPost("/document", { front: frontRef.current, back: img })
      onDone()
    } catch (e) {
      setBusy(false)
      setFatal(
        "No pudimos subir la foto: " +
          (e instanceof Error ? e.message : String(e)),
      )
      void cam.start()
    }
  }

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">
        Cédula — {isFront ? "frente" : "dorso"}
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">
        {isFront
          ? "Mostranos el frente de tu cédula, con la foto y los datos bien visibles."
          : "Ahora el dorso: que se vean las líneas (MRZ) y el código de barras."}
      </p>

      {notice && <Notice>{notice}</Notice>}
      {fatal && (
        <p className="mt-3 text-sm text-error" role="alert">
          {fatal}
        </p>
      )}

      <div className="relative my-4 aspect-[1.586/1] w-full overflow-hidden rounded-3xl bg-gray-900">
        <video
          ref={cam.videoRef}
          autoPlay
          playsInline
          muted
          className="size-full object-cover"
        />
        <div className="pointer-events-none absolute inset-[10%] rounded-2xl border-[3px] border-dashed border-white/60" />
        {/* línea de escaneo animada (feedback de captura) */}
        {cam.ready && (
          <div className="pointer-events-none absolute inset-[10%] overflow-hidden rounded-2xl">
            <div
              className="h-1 w-full bg-mint/80 shadow-[0_0_12px_2px] shadow-mint/60"
              style={{ animation: "teko-scan 2.2s ease-in-out infinite" }}
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[13px] text-white drop-shadow">
          Que entre completa y sin reflejos
        </div>
      </div>

      {cam.error && (
        <Notice>No se pudo abrir la cámara: {cam.error}.</Notice>
      )}

      <Button disabled={busy || !cam.ready} onClick={capture}>
        {busy
          ? "Revisando la foto…"
          : `Sacar foto del ${isFront ? "frente" : "dorso"}`}
      </Button>
    </Card>
  )
}
