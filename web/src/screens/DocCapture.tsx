import { useCallback, useEffect, useRef, useState } from "react"
import { apiPost, type DocCheckResult } from "../api"
import { docMsg, DOC_LIVE_MSG, errorMessage } from "../messages"
import { useCamera } from "../useCamera"
import { useDocQuality } from "../useDocQuality"
import { Button, Card, Notice } from "../ui"

// El documento debe quedar nítido y estable ~1.5s antes de la cuenta regresiva.
const STABLE_MS = 1500
const COUNTDOWN = [3, 2, 1]
// Enfriamiento tras una captura RECHAZADA: nunca re-disparamos antes de esto.
const COOLDOWN_MS = 1200
// Re-adquisición: tras un rechazo exigimos que el documento DESAPAREZCA de la
// guía (no-doc real, detector corriendo) por estos frames consecutivos antes de
// volver a habilitar el auto-disparo. Los frames "loading"/"no-camera" del
// reinicio de cámara NO cuentan como ausencia (ese era el bug del loop: el
// warm-up "rompía" el encuadre y re-armaba solo, sin que el usuario reacomode).
const REACQUIRE_ABSENT_FRAMES = 4

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
  // "Ausencia real": documento NO encuadrado, con el detector efectivamente
  // corriendo (no es el transitorio de warm-up de cámara). Solo esto cuenta
  // como re-adquisición tras un rechazo.
  const isAbsent = quality.verdict === "no-doc"

  const stableSinceRef = useRef<number | null>(null)
  const capturingRef = useRef(false)
  const countingRef = useRef(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // --- Guard anti-loop robusto (sobrevive al warm-up de cámara) -------------
  // Tras un rechazo: enfriamiento por tiempo (cooldownUntilRef) + exigir que el
  // documento SALGA de la guía de verdad (absentFramesRef llega al umbral) antes
  // de volver a auto-disparar. El viejo blockedRef se levantaba con CUALQUIER
  // frame no-good — y el reinicio de cámara produce frames "loading"/"no-camera",
  // así que el bloqueo caía solo y re-disparaba en loop. Ahora el warm-up NO
  // satisface la re-adquisición.
  const cooldownUntilRef = useRef(0)
  const needReacquireRef = useRef(false)
  const absentFramesRef = useRef(0)

  // Limpia todos los timers de cuenta pendientes (clearTimeout real, no solo []).
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    countingRef.current = false
  }

  // Arma el enfriamiento + re-adquisición tras un rechazo de captura.
  const armCooldown = () => {
    cooldownUntilRef.current = Date.now() + COOLDOWN_MS
    needReacquireRef.current = true
    absentFramesRef.current = 0
  }

  // Refs espejo de los veredictos vivos (leídos por el loop sin reejecutar su
  // efecto, para que la cuenta 3·2·1 no se autocancele).
  const isGoodRef = useRef(isGood)
  isGoodRef.current = isGood
  const isAbsentRef = useRef(isAbsent)
  isAbsentRef.current = isAbsent

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
      // Rechazo: enfriamiento + exigir que el usuario reacomode la cédula
      // (sacarla y volver a encuadrarla) antes de re-disparar.
      armCooldown()
      void cam.start()
      return
    }

    if (isFront) {
      frontRef.current = img
      setBusy(false)
      stableSinceRef.current = null
      capturingRef.current = false
      clearTimers()
      // Cambio de lado: re-armar limpio para el dorso (no es un rechazo). Pero
      // pedimos re-adquisición igual para que no dispare con el dorso a medio
      // poner (el frente seguía nítido y disparaba al instante).
      armCooldown()
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
      armCooldown()
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
        // Re-adquisición tras rechazo: contamos AUSENCIA REAL (no-doc con el
        // detector corriendo). El warm-up de cámara (loading/no-camera) NO
        // cuenta — por eso el loop ya no se re-arma solo.
        if (needReacquireRef.current) {
          if (isAbsentRef.current) {
            absentFramesRef.current++
            if (absentFramesRef.current >= REACQUIRE_ABSENT_FRAMES)
              needReacquireRef.current = false
          }
          // Mientras re-adquirimos, jamás contamos estabilidad ni disparamos.
          stableSinceRef.current = null
          if (countingRef.current) cancelCountdown()
        } else if (
          isGoodRef.current &&
          Date.now() >= cooldownUntilRef.current
        ) {
          // Documento presente + encuadrado + nítido (good), cooldown cumplido y
          // ya re-adquirido. Acumulamos estabilidad y disparamos la cuenta.
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
          // No encuadrado/nítido aún (o en cooldown): reseteamos estabilidad y
          // cancelamos cualquier cuenta en curso. NO tocamos los guards de
          // re-adquisición acá (ese era el bug: se levantaban con el warm-up).
          stableSinceRef.current = null
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
