import { useCallback, useEffect, useRef, useState } from "react"
import { apiPost, type QualityResult } from "../api"
import { evalQuality, FACE_LIVE_MSG, errorMessage } from "../messages"
import { useCamera } from "../useCamera"
import { useFaceDetector } from "../useFaceDetector"
import { Button, Card, Notice } from "../ui"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Tiempo que el encuadre debe MANTENERSE "good" antes de arrancar la cuenta.
const STABLE_MS = 1500
// Pasos de la cuenta regresiva de auto-captura.
const COUNTDOWN = [3, 2, 1]
// Enfriamiento tras una captura RECHAZADA: nunca re-disparamos antes de esto.
const COOLDOWN_MS = 1200
// Re-adquisición: tras un rechazo exigimos que el rostro SALGA del óvalo
// (no-face real, MediaPipe corriendo) por estos frames consecutivos antes de
// re-habilitar el auto-disparo. Los frames "loading"/"no-camera" del reinicio
// de cámara NO cuentan (ese era el bug del loop: el warm-up "rompía" el encuadre
// y re-armaba la captura solo, sin que el usuario re-encuadre).
const REACQUIRE_ABSENT_FRAMES = 4

/**
 * Selfie con AUTO-CAPTURA real (estilo Behance):
 *  - Detección facial EN VIVO con MediaPipe (useFaceDetector) sobre el <video>.
 *  - Feedback accionable dentro del óvalo; el óvalo va de gris → verde.
 *  - Cuando el rostro queda bien encuadrado ~1s, arranca cuenta 3·2·1 y dispara.
 *  - Preview ESPEJADO (scaleX(-1), como un espejo); la captura al canvas va
 *    SIN espejar (useCamera.grab dibuja el frame crudo) → la foto sale correcta.
 *  - Fallback: si MediaPipe no carga, mostramos botón manual "Sacar selfie".
 *
 * Pipeline (contrato intacto): POST /selfie {image, frames}.
 */
export function Selfie({ onDone }: { onDone: () => void }) {
  const cam = useCamera("user")
  // La detección corre solo cuando la cámara está lista y no estamos procesando.
  const [busy, setBusy] = useState(false)
  const detect = useFaceDetector(cam.videoRef, cam.ready && !busy)

  const [notice, setNotice] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [flash, setFlash] = useState(false)

  const stableSinceRef = useRef<number | null>(null)
  const capturingRef = useRef(false)
  const countingRef = useRef(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // --- Guard anti-loop robusto (sobrevive al warm-up de cámara) -------------
  // Tras un rechazo: enfriamiento por tiempo (cooldownUntilRef) + exigir que el
  // rostro SALGA del óvalo de verdad (absentFramesRef llega al umbral) antes de
  // re-disparar. El viejo blockedRef se levantaba con CUALQUIER frame no-good —
  // y el reinicio de cámara produce frames "loading"/"no-camera", así que el
  // bloqueo caía solo y re-disparaba en loop. Ahora el warm-up NO satisface la
  // re-adquisición.
  const cooldownUntilRef = useRef(0)
  const needReacquireRef = useRef(false)
  const absentFramesRef = useRef(0)
  const manualMode = detect.status === "unavailable"
  const isGood = detect.verdict === "good"
  // "Ausencia real" del rostro: MediaPipe corriendo y NO ve cara (no es el
  // transitorio de warm-up). Solo esto cuenta como re-adquisición tras rechazo.
  const isAbsent = detect.verdict === "no-face"

  // Refs espejo de valores vivos: el loop de auto-captura los lee SIN que su
  // efecto se reejecute (clave para que la cuenta 3·2·1 no se autocancele).
  const isGoodRef = useRef(isGood)
  isGoodRef.current = isGood
  const isAbsentRef = useRef(isAbsent)
  isAbsentRef.current = isAbsent

  // Arma el enfriamiento + re-adquisición tras un rechazo de captura.
  const armCooldown = () => {
    cooldownUntilRef.current = Date.now() + COOLDOWN_MS
    needReacquireRef.current = true
    absentFramesRef.current = 0
  }

  // --- Captura + subida (compartida entre auto y manual) -------------------
  const doCapture = useCallback(async () => {
    if (capturingRef.current) return
    capturingRef.current = true
    // Matamos cualquier timer de cuenta pendiente (evita disparos zombis si el
    // usuario tocó el botón manual durante la cuenta).
    countingRef.current = false
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setBusy(true)
    setNotice(null)
    setFatal(null)
    setCount(null)
    setFlash(true)
    setTimeout(() => setFlash(false), 450)
    try {
      // grab() dibuja el frame CRUDO (sin espejar) → la imagen sale correcta
      // aunque el preview se vea como espejo.
      const selfie = cam.grab()
      await sleep(320)
      const f1 = cam.grab()
      await sleep(320)
      const f2 = cam.grab()
      cam.stop()
      const resp = await apiPost<{ quality?: QualityResult }>("/selfie", {
        image: selfie,
        frames: [f1, f2],
      })
      const verdict = evalQuality(resp.quality)
      if (verdict.advance) {
        onDone()
        return
      }
      // Recapturar: reabrimos cámara, mostramos tip y reanudamos detección.
      // Bloqueamos el re-arme automático hasta que el usuario re-encuadre.
      setNotice(verdict.msg ?? null)
      setBusy(false)
      stableSinceRef.current = null
      capturingRef.current = false
      countingRef.current = false
      armCooldown()
      void cam.start()
    } catch (e) {
      setBusy(false)
      capturingRef.current = false
      countingRef.current = false
      stableSinceRef.current = null
      armCooldown()
      setFatal(errorMessage(e))
      void cam.start()
    }
  }, [cam, onDone])

  // Ref siempre apuntando a la última doCapture, para que el timer la invoque
  // sin meter doCapture (inestable) en las deps del efecto de countdown.
  const doCaptureRef = useRef(doCapture)
  doCaptureRef.current = doCapture

  // Cancela la cuenta regresiva en curso (timers + estado visible).
  const cancelCountdown = useCallback(() => {
    countingRef.current = false
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setCount(null)
  }, [])

  // --- Estabilidad + cuenta regresiva de auto-captura ----------------------
  // El loop lee SOLO refs (isGoodRef/capturingRef/countingRef) y programa los
  // timers UNA vez en timersRef. NO se cancelan en cada render: solo si el
  // encuadre se rompe o al desmontar. Así "setCount(3)" no se autocancela.
  useEffect(() => {
    if (manualMode || busy) {
      cancelCountdown()
      stableSinceRef.current = null
      return
    }
    let raf = 0
    const loop = () => {
      if (!capturingRef.current) {
        // Re-adquisición tras rechazo: contamos AUSENCIA REAL (no-face con
        // MediaPipe corriendo). El warm-up de cámara (loading/no-camera) NO
        // cuenta — por eso el loop ya no se re-arma solo.
        if (needReacquireRef.current) {
          if (isAbsentRef.current) {
            absentFramesRef.current++
            if (absentFramesRef.current >= REACQUIRE_ABSENT_FRAMES)
              needReacquireRef.current = false
          }
          stableSinceRef.current = null
          if (countingRef.current) cancelCountdown()
        } else if (
          isGoodRef.current &&
          Date.now() >= cooldownUntilRef.current
        ) {
          if (stableSinceRef.current == null)
            stableSinceRef.current = Date.now()
          const held = Date.now() - stableSinceRef.current
          if (held >= STABLE_MS && !countingRef.current) {
            // Arrancamos la secuencia 3·2·1 y disparamos al final (una sola vez).
            countingRef.current = true
            COUNTDOWN.forEach((n, i) => {
              timersRef.current.push(setTimeout(() => setCount(n), i * 1000))
            })
            timersRef.current.push(
              setTimeout(() => {
                void doCaptureRef.current()
              }, COUNTDOWN.length * 1000),
            )
          }
        } else {
          // Encuadre roto / en cooldown / aún no good: reseteamos estabilidad y
          // abortamos cuenta. NO tocamos los guards de re-adquisición acá (ese
          // era el bug: se levantaban con el warm-up de cámara).
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
  }, [manualMode, busy, cancelCountdown])

  // Si la cámara falló/denegó el permiso, NO mostramos "Preparando la cámara…"
  // (mentira que dejaba al usuario esperando). El pill pasa a un estado de error
  // y aparece un botón de reintento (#5).
  const camDenied = !!cam.error
  const liveMsg = camDenied
    ? "No pudimos usar la cámara"
    : detect.status === "loading"
      ? "Preparando detección…"
      : (FACE_LIVE_MSG[detect.verdict] ?? "Ubicá tu rostro en el óvalo")

  // Color del óvalo: verde cuando está bien, gris cuando no.
  const ovalColor = isGood ? "border-primary" : "border-white/70"
  const ovalGlow = isGood ? "shadow-[0_0_0_4px_rgba(22,163,74,0.25)]" : ""

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">Sacate una selfie</h1>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">
        Ubicá tu rostro dentro del óvalo, con buena luz y de frente. Cuando
        estés bien encuadrado, la foto se saca sola.
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
          // ESPEJADO solo en el preview (como un espejo, fácil de encuadrar).
          className="size-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* óvalo guía: gris → verde según el encuadre en vivo */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`h-[78%] w-[62%] rounded-[50%] border-[3px] ${
              isGood ? "border-solid" : "border-dashed"
            } ${ovalColor} ${ovalGlow} transition-all duration-300`}
          />
        </div>

        {/* destello de captura */}
        {flash && (
          <div className="teko-flash pointer-events-none absolute inset-0 bg-white" />
        )}

        {/* cuenta regresiva 3·2·1 */}
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

        {/* feedback en vivo (accionable) */}
        {count == null && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur-sm transition-colors ${
                camDenied
                  ? "bg-error/90 text-white"
                  : isGood
                    ? "bg-primary/90 text-white"
                    : "bg-black/45 text-white"
              }`}
            >
              <span
                className={`size-2 rounded-full ${
                  camDenied ? "bg-white" : isGood ? "bg-white" : "bg-mint"
                }`}
              />
              {camDenied
                ? liveMsg
                : manualMode
                  ? "Encuadrá tu rostro"
                  : liveMsg}
            </span>
          </div>
        )}
      </div>

      {/* Cámara denegada/fallida (#5): mensaje claro + botón para reintentar el
          permiso. start() vuelve a llamar getUserMedia → re-dispara el prompt; si
          el usuario lo bloqueó a nivel navegador, ofrecemos recargar la página. */}
      {camDenied && (
        <>
          <Notice>
            No pudimos usar la cámara: {cam.error}. Revisá que le diste permiso al
            navegador y volvé a intentar.
          </Notice>
          <Button onClick={() => void cam.start()}>
            Volver a pedir permiso
          </Button>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-2 w-full text-center text-xs font-medium text-gray-400 underline"
          >
            Sigue sin funcionar — recargar la página
          </button>
        </>
      )}

      {/* Botón manual: SIEMPRE disponible como recovery; obligatorio si
          MediaPipe no cargó (manualMode). Oculto si la cámara está denegada
          (ahí mandan los botones de reintento de arriba). */}
      {!camDenied && (
        <>
          <Button
            disabled={busy || !cam.ready}
            onClick={() => void doCapture()}
            variant={manualMode ? "primary" : "ghost"}
          >
            {busy
              ? "Revisando tu foto…"
              : manualMode
                ? "Sacar selfie"
                : "Sacar foto ahora"}
          </Button>
          {!manualMode && (
            <p className="mt-2 text-center text-xs text-gray-400">
              La captura es automática · o tocá el botón cuando quieras
            </p>
          )}
        </>
      )}
      <p className="mt-3 text-center text-[11px] leading-snug text-gray-400">
        Tus datos se usan solo para verificar tu identidad · Ley 7593
      </p>
    </Card>
  )
}
