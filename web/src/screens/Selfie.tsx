import { useState } from "react"
import { apiPost, type QualityResult } from "../api"
import { evalQuality } from "../messages"
import { useCamera } from "../useCamera"
import { Button, Card, Notice } from "../ui"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Pantalla selfie con indicador de confianza/calidad (estilo Behance).
 * Lógica PORTADA: capturar selfie + 2 frames (con micro-pausa de 350ms para
 * liveness) → POST /selfie {image, frames}. Si quality.passed===false por algo
 * accionable, mostrar tip amable y dejar recapturar SIN avanzar.
 */
export function Selfie({ onDone }: { onDone: () => void }) {
  const cam = useCamera("user")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  async function capture() {
    setBusy(true)
    setNotice(null)
    setFatal(null)
    try {
      const selfie = cam.grab()
      await sleep(350)
      const f1 = cam.grab()
      await sleep(350)
      const f2 = cam.grab()
      cam.stop()
      const resp = await apiPost<{ quality?: QualityResult }>("/selfie", {
        image: selfie,
        frames: [f1, f2],
      })
      const verdict = evalQuality(resp.quality)
      if (verdict.advance) {
        onDone()
      } else {
        // Recapturar: reabrimos cámara y mostramos el tip.
        setNotice(verdict.msg ?? null)
        setBusy(false)
        void cam.start()
      }
    } catch (e) {
      setBusy(false)
      setFatal(
        "No pudimos procesar la selfie: " +
          (e instanceof Error ? e.message : String(e)),
      )
      void cam.start()
    }
  }

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">Sacate una selfie</h1>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">
        Ubicá tu rostro dentro del óvalo, con buena luz, de frente y sin
        anteojos.
      </p>

      {notice && <Notice>{notice}</Notice>}
      {fatal && (
        <p className="mt-3 text-sm text-error" role="alert">
          {fatal}
        </p>
      )}

      <div className="relative my-4 aspect-[3/4] w-full overflow-hidden rounded-3xl bg-gray-900">
        <video
          ref={cam.videoRef}
          autoPlay
          playsInline
          muted
          className="size-full object-cover"
        />
        {/* óvalo guía */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[78%] w-[62%] rounded-[50%] border-[3px] border-dashed border-white/60" />
        </div>
        {/* indicador de confianza en tiempo real */}
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <span
            className="flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm"
            style={{ animation: "teko-pulse 1.6s ease-in-out infinite" }}
          >
            <span className="size-2 rounded-full bg-mint" />
            {cam.ready ? "Analizando rostro…" : "Iniciando cámara…"}
          </span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[13px] text-white drop-shadow">
          Mirá a la cámara
        </div>
      </div>

      {cam.error && (
        <Notice>
          No se pudo abrir la cámara: {cam.error}. Revisá los permisos del
          navegador.
        </Notice>
      )}

      <Button disabled={busy || !cam.ready} onClick={capture}>
        {busy ? "Revisando tu foto…" : "Sacar selfie"}
      </Button>
      <div className="mt-2.5">
        <Button variant="ghost" onClick={() => void cam.start()}>
          Reintentar cámara
        </Button>
      </div>
    </Card>
  )
}
