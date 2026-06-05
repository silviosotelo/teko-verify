import { useCallback, useEffect, useRef, useState } from "react"
import { apiPost, type DocCheckResult } from "../api"
import { docMsg, DOC_LIVE_MSG, errorMessage } from "../messages"
import { useCamera } from "../useCamera"
import { useDocDetector, type Quad } from "../useDocDetector"
import { Button, Card, Notice } from "../ui"

// El documento debe quedar VÁLIDO y estable ~1.5s antes de la cuenta regresiva.
const STABLE_MS = 1500
const COUNTDOWN = [3, 2, 1]
// Enfriamiento tras una captura RECHAZADA: nunca re-disparamos antes de esto.
const COOLDOWN_MS = 1200
// Re-adquisición: tras un rechazo exigimos que el documento DESAPAREZCA de la
// guía (no-doc real, detector corriendo) por estos frames consecutivos antes de
// volver a habilitar el auto-disparo. Los frames "loading"/"no-camera" del
// reinicio de cámara NO cuentan como ausencia (ese era el bug del loop).
const REACQUIRE_ABSENT_FRAMES = 4

/**
 * Cédula (frente/dorso) con AUTO-CAPTURA por DETECCIÓN GEOMÉTRICA REAL:
 *  - useDocDetector (OpenCV.js, self-hosted, lazy) detecta el CUADRILÁTERO del
 *    documento en vivo y valida fill + esquinas + proporción ID-1 + nitidez.
 *  - Dibujamos el contorno detectado EN VIVO sobre la cámara (overlay): verde
 *    cuando es válido, ámbar cuando es parcial → el usuario VE que se detectó.
 *  - Coaching accionable: "poné la cédula", "acercá/alineá", "enderezá",
 *    "mantené quieto", "perfecto ✓ 3·2·1".
 *  - Cuando el quad es válido y estable ~1.5s → cuenta 3·2·1 → captura.
 *  - Botón manual SIEMPRE disponible como recovery (obligatorio si OpenCV no
 *    cargó → modo manual, sin colgarse en "preparando detector…").
 *
 * Un teclado/pared NO forma un quad con proporción de tarjeta que llene la
 * guía → NO dispara. El backend valida el borde real; acá pre-chequeamos
 * (POST /doc-check) y subimos ambos lados (POST /document). La trasera NO se espeja.
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

  const det = useDocDetector(cam.videoRef, cam.ready && !busy)
  // OpenCV no disponible (offline/timeout) → degradar a captura manual.
  const manualMode = det.status === "unavailable"
  const detLoading = det.status === "loading"
  // "good" = quad válido, lleno, derecho y nítido → habilita la cuenta.
  const isGood = det.verdict === "good"
  // "Ausencia real": sin cuadrilátero, con el detector corriendo (no warm-up).
  // Solo esto cuenta como re-adquisición tras un rechazo.
  const isAbsent = det.verdict === "no-doc"

  const stableSinceRef = useRef<number | null>(null)
  const capturingRef = useRef(false)
  const countingRef = useRef(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // --- Guard anti-loop robusto (sobrevive al warm-up de cámara) -------------
  // Tras un rechazo: enfriamiento por tiempo (cooldownUntilRef) + exigir que el
  // documento SALGA de la guía de verdad (absentFramesRef llega al umbral) antes
  // de volver a auto-disparar. El warm-up de cámara (loading/no-camera) NO
  // satisface la re-adquisición (si no, el bloqueo caía solo y re-disparaba).
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
      // poner (el frente seguía válido y disparaba al instante).
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
  // render, solo si se rompe la validez/estabilidad o al desmontar.
  useEffect(() => {
    if (manualMode || busy) {
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
          // Documento detectado (quad válido + lleno + derecho + nítido),
          // cooldown cumplido y ya re-adquirido. Acumulamos estabilidad.
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
          // No detectado/válido aún (o en cooldown): reseteamos estabilidad y
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
  }, [manualMode, busy, cancelCountdown])

  // --- Overlay: dibuja el contorno detectado EN VIVO sobre la cámara ---------
  // El quad viene NORMALIZADO [0..1] en coords del frame del video. El <video>
  // usa object-cover dentro de un box 1.586:1, así que mapeamos por el mismo
  // escalado+recorte de "cover" para que el contorno caiga donde corresponde.
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const quadRef = useRef<Quad | null>(det.quad)
  quadRef.current = det.quad
  const isGoodForDraw = isGood
  const isGoodDrawRef = useRef(isGoodForDraw)
  isGoodDrawRef.current = isGoodForDraw

  useEffect(() => {
    if (manualMode) return
    let raf = 0
    const draw = () => {
      const cnv = overlayRef.current
      const v = cam.videoRef.current
      if (cnv && v && v.videoWidth > 0) {
        const cw = cnv.clientWidth
        const ch = cnv.clientHeight
        if (cnv.width !== cw) cnv.width = cw
        if (cnv.height !== ch) cnv.height = ch
        const ctx = cnv.getContext("2d")
        if (ctx) {
          ctx.clearRect(0, 0, cw, ch)
          const q = quadRef.current
          if (q && count == null) {
            // Mapa object-cover: el video (vw×vh) llena el box (cw×ch) por el
            // lado que sobra; el resto se recorta y centra.
            const vw = v.videoWidth
            const vh = v.videoHeight
            const scale = Math.max(cw / vw, ch / vh)
            const dw = vw * scale
            const dh = vh * scale
            const ox = (cw - dw) / 2
            const oy = (ch - dh) / 2
            const map = (p: { x: number; y: number }) => ({
              x: ox + p.x * dw,
              y: oy + p.y * dh,
            })
            const good = isGoodDrawRef.current
            ctx.beginPath()
            const pts = q.map(map)
            ctx.moveTo(pts[0].x, pts[0].y)
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
            ctx.closePath()
            ctx.lineWidth = 3
            ctx.strokeStyle = good ? "#16a34a" : "#f59e0b"
            ctx.fillStyle = good
              ? "rgba(22,163,74,0.14)"
              : "rgba(245,158,11,0.10)"
            ctx.fill()
            ctx.stroke()
            // Marcas en las 4 esquinas para reforzar la guía.
            ctx.fillStyle = good ? "#16a34a" : "#f59e0b"
            for (const p of pts) {
              ctx.beginPath()
              ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [manualMode, count, cam.videoRef])

  // Copy de coaching en vivo (mapeo veredicto → texto accionable).
  const liveMsg = detLoading
    ? "Preparando el detector…"
    : det.verdict === "loading" || det.verdict === "no-camera"
      ? "Iniciando cámara…"
      : (DOC_LIVE_MSG[det.verdict] ?? "Poné la cédula dentro del marco")

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

      {/* Mini-ejemplo ilustrado: cómo sostener la cédula dentro del marco. */}
      <div className="mt-3 flex items-center gap-3 rounded-2xl bg-gray-50 p-3 ring-1 ring-gray-100">
        <svg
          viewBox="0 0 64 44"
          className="h-11 w-16 shrink-0"
          fill="none"
          aria-hidden
        >
          <rect
            x="3"
            y="3"
            width="58"
            height="38"
            rx="4"
            className="text-primary"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          <rect
            x="10"
            y="10"
            width="44"
            height="24"
            rx="3"
            className="text-primary"
            fill="currentColor"
            opacity="0.18"
          />
          <circle cx="20" cy="20" r="5" className="text-primary" fill="currentColor" opacity="0.5" />
          <rect x="30" y="16" width="18" height="3" rx="1.5" className="text-primary" fill="currentColor" opacity="0.5" />
          <rect x="30" y="23" width="13" height="3" rx="1.5" className="text-primary" fill="currentColor" opacity="0.35" />
        </svg>
        <p className="text-xs leading-snug text-gray-500">
          Encuadrá la cédula <span className="font-semibold text-gray-700">llenando el marco</span> y alineá las
          4 esquinas. Cuando el contorno se ponga <span className="font-semibold text-primary">verde</span>, no te muevas.
        </p>
      </div>

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

        {/* overlay del contorno detectado en vivo (verde válido / ámbar parcial) */}
        {!manualMode && (
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 size-full"
          />
        )}

        {/* guía rectangular redondeada: gris → verde según validez */}
        <div
          className={`pointer-events-none absolute inset-[8%] rounded-2xl border-[3px] ${
            isGood ? "border-solid" : "border-dashed"
          } ${frameColor} transition-colors duration-300`}
        />

        {/* preparando detector OpenCV (lazy) */}
        {detLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
            <span className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white">
              <span className="size-3 animate-pulse rounded-full bg-mint" />
              Preparando el detector…
            </span>
          </div>
        )}

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

        {/* feedback / coaching en vivo */}
        {count == null && !detLoading && (
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
              {manualMode ? "Poné la cédula dentro del marco" : liveMsg}
            </span>
          </div>
        )}
      </div>

      {cam.error && (
        <Notice>No se pudo abrir la cámara: {cam.error}.</Notice>
      )}

      {manualMode && (
        <Notice>
          No pudimos preparar el detector automático. Encuadrá la cédula
          llenando el marco y tocá el botón para sacar la foto.
        </Notice>
      )}

      <Button
        disabled={busy || !cam.ready}
        onClick={() => void doCapture()}
        variant={manualMode ? "primary" : "ghost"}
      >
        {busy
          ? "Revisando la foto…"
          : `Sacar foto del ${isFront ? "frente" : "dorso"} ahora`}
      </Button>
      <p className="mt-2 text-center text-xs text-gray-400">
        {manualMode
          ? "Sacá la foto cuando la cédula llene el marco"
          : "La captura es automática · o tocá el botón cuando quieras"}
      </p>
      <p className="mt-3 text-center text-[11px] leading-snug text-gray-400">
        Tus datos se usan solo para verificar tu identidad · Ley 7593
      </p>
    </Card>
  )
}
