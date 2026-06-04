import { useCallback, useEffect, useRef, useState } from "react"
import { apiPost, type DocCheckResult } from "../api"
import { docMsg, DOC_LIVE_MSG, errorMessage } from "../messages"
import { useCamera } from "../useCamera"
import { useDocQuality } from "../useDocQuality"
import { Button, Card, Notice } from "../ui"

// El documento debe quedar nítido y estable ~1.5s antes de la cuenta regresiva.
const STABLE_MS = 1500
const COUNTDOWN = [3, 2, 1]

/**
 * Cédula (frente/dorso) con AUTO-CAPTURA por heurística en vivo:
 *  - useDocQuality mide nitidez (varianza Laplaciano) + brillo sobre el stream.
 *  - Feedback accionable: borrosa/lejos, reflejo, oscura, o "perfecto".
 *  - Cuando queda nítida y estable ~0.9s → cuenta 3·2·1 → captura.
 *  - Botón manual SIEMPRE disponible como recovery.
 *
 * El backend recorta la evidencia y valida el borde real; acá pre-chequeamos
 * (POST /doc-check informativo) y subimos ambos lados (POST /document).
 * La cámara trasera NO se espeja.
 */
export function DocCapture({ onDone }: { onDone: () => void }) {
  const cam = useCamera("environment")
  const [side, setSide] = useState<"front" | "back">("front")
  const frontRef = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [flash, setFlash] = useState(false)

  const quality = useDocQuality(cam.videoRef, cam.ready && !busy)
  const isGood = quality.verdict === "good"

  const stableSinceRef = useRef<number | null>(null)
  const capturingRef = useRef(false)
  const countingRef = useRef(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // Guard anti-loop: tras una captura rechazada NO re-armamos hasta que la
  // nitidez se rompa y se rehaga (evita capturar→rechazar→capturar en bucle).
  const blockedRef = useRef(false)

  // Limpia todos los timers de cuenta pendientes (clearTimeout real, no solo []).
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    countingRef.current = false
  }

  // Ref espejo del veredicto vivo (leído por el loop sin reejecutar su efecto).
  const isGoodRef = useRef(isGood)
  isGoodRef.current = isGood

  const isFront = side === "front"

  const doCapture = useCallback(async () => {
    if (capturingRef.current) return
    capturingRef.current = true
    // Matamos timers de cuenta pendientes (evita disparo zombi tras tap manual).
    clearTimers()
    setBusy(true)
    setNotice(null)
    setFatal(null)
    setCount(null)
    setFlash(true)
    setTimeout(() => setFlash(false), 450)

    // Cédula a calidad ALTA (0.95): preserva los campos chicos para el OCR.
    const img = cam.grab(0.95)

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
      stableSinceRef.current = null
      capturingRef.current = false
      clearTimers()
      // Rechazo: bloqueamos re-arme hasta que el usuario reacomode la cédula.
      blockedRef.current = true
      void cam.start()
      return
    }

    if (isFront) {
      frontRef.current = img
      setBusy(false)
      stableSinceRef.current = null
      capturingRef.current = false
      clearTimers()
      // Cambio de lado: re-armar limpio para el dorso (no es un rechazo).
      blockedRef.current = false
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
      capturingRef.current = false
      clearTimers()
      stableSinceRef.current = null
      blockedRef.current = true
      setFatal(errorMessage(e))
      void cam.start()
    }
  }, [cam, isFront, side, onDone])

  // Ref siempre a la última doCapture (evita meterla en deps del countdown).
  const doCaptureRef = useRef(doCapture)
  doCaptureRef.current = doCapture

  const cancelCountdown = useCallback(() => {
    clearTimers()
    setCount(null)
  }, [])

  // Estabilidad + cuenta regresiva — re-render-immune (mismo patrón que Selfie):
  // el loop lee refs y programa los timers UNA vez; no se cancelan en cada
  // render, solo si se rompe la nitidez/estabilidad o al desmontar.
  useEffect(() => {
    if (busy) {
      cancelCountdown()
      stableSinceRef.current = null
      return
    }
    let raf = 0
    const loop = () => {
      if (!capturingRef.current) {
        if (isGoodRef.current && !blockedRef.current) {
          if (stableSinceRef.current == null)
            stableSinceRef.current = Date.now()
          const held = Date.now() - stableSinceRef.current
          if (held >= STABLE_MS && !countingRef.current) {
            countingRef.current = true
            COUNTDOWN.forEach((n, i) => {
              timersRef.current.push(setTimeout(() => setCount(n), i * 1000))
            })
            timersRef.current.push(
              setTimeout(() => void doCaptureRef.current(), COUNTDOWN.length * 1000),
            )
          }
        } else {
          // No nítido (o aún no): reseteamos estabilidad, cancelamos cuenta y
          // levantamos el bloqueo de re-arme (el usuario ya reacomodó).
          stableSinceRef.current = null
          blockedRef.current = false
          if (countingRef.current) cancelCountdown()
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
      countingRef.current = false
    }
  }, [busy, cancelCountdown])

  const liveMsg =
    quality.verdict === "loading"
      ? "Preparando la cámara…"
      : (DOC_LIVE_MSG[quality.verdict] ?? "Acercá la cédula y mantené firme")

  const frameColor = isGood ? "border-primary" : "border-white/60"

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">
        Cédula — {isFront ? "frente" : "dorso"}
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">
        {isFront
          ? "Mostranos el frente de tu cédula, con la foto y los datos bien visibles. La foto se saca sola."
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

        {/* guía rectangular redondeada: gris → verde según nitidez */}
        <div
          className={`pointer-events-none absolute inset-[8%] rounded-2xl border-[3px] ${
            isGood ? "border-solid" : "border-dashed"
          } ${frameColor} transition-colors duration-300`}
        />

        {/* destello de captura */}
        {flash && (
          <div className="teko-flash pointer-events-none absolute inset-0 bg-white" />
        )}

        {/* cuenta regresiva */}
        {count != null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              key={count}
              className="teko-count text-7xl font-black text-white drop-shadow-lg"
            >
              {count}
            </span>
          </div>
        )}

        {/* feedback en vivo */}
        {count == null && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur-sm transition-colors ${
                isGood ? "bg-primary/90 text-white" : "bg-black/45 text-white"
              }`}
            >
              <span
                className={`size-2 rounded-full ${
                  isGood ? "bg-white" : "bg-mint"
                }`}
              />
              {liveMsg}
            </span>
          </div>
        )}
      </div>

      {cam.error && (
        <Notice>No se pudo abrir la cámara: {cam.error}.</Notice>
      )}

      <Button
        disabled={busy || !cam.ready}
        onClick={() => void doCapture()}
        variant="ghost"
      >
        {busy
          ? "Revisando la foto…"
          : `Sacar foto del ${isFront ? "frente" : "dorso"} ahora`}
      </Button>
      <p className="mt-2 text-center text-xs text-gray-400">
        La captura es automática · o tocá el botón cuando quieras
      </p>
    </Card>
  )
}
