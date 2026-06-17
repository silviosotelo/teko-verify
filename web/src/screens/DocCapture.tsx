import { useCallback, useEffect, useRef, useState } from "react"
import { apiPost, type DocCheckResult } from "../api"
import { docMsg, DOC_LIVE_MSG, errorMessage } from "../messages"
import { useCamera } from "../useCamera"
import { useDocDetector, type Quad } from "../useDocDetector"
import { Button, Card, Notice } from "../ui"
import { DocReview } from "./DocReview"
import { Prepare } from "./Prepare"
import { DocSubmitted } from "./DocSubmitted"
import { DocHero, IconFrame, IconSun, IconNoGlare } from "../Icons"

// El documento debe quedar VÁLIDO y estable antes de la cuenta regresiva.
// AFLOJADO (2026-06-17): 1500 → 800 ms. Con el gating de docAnalyze ya relajado,
// pedir menos estabilidad hace que el encuadre "agarre" más rápido sin sacrificar
// el anti-falso-positivo (el quad debe ser válido, no sólo presente, esos 800 ms).
const STABLE_MS = 800
const COUNTDOWN = [3, 2, 1]
// Enfriamiento tras una captura RECHAZADA: nunca re-disparamos antes de esto.
const COOLDOWN_MS = 1200
// Re-adquisición: tras un rechazo exigimos que el documento DESAPAREZCA de la
// guía (no-doc real, detector corriendo) por estos frames consecutivos antes de
// volver a habilitar el auto-disparo. Los frames "loading"/"no-camera" del
// reinicio de cámara NO cuentan como ausencia (ese era el bug del loop).
const REACQUIRE_ABSENT_FRAMES = 4

/**
 * Captura de cédula con REVISIÓN/RETAKE POR LADO (estilo Didit) — orquestador:
 *
 *   prep-front → capture-front → review-front → prep-back → capture-back →
 *   review-back → submitted (POST /document {front,back}) → onDone()
 *
 * La cámara real por lado (DocSideCamera) conserva INTACTA la lógica anti-loop
 * del detector geométrico (OpenCV.js) del commit 8b27e42: cooldown, re-adquisición
 * por ausencia real, refs espejo, overlay del contorno en vivo y auto-captura
 * 3·2·1. La diferencia: en vez de auto-avanzar/subir, devuelve el dataURL al
 * orquestador, que muestra la revisión y permite retomar el lado.
 *
 * Backend SIN cambios: las dos imágenes viajan juntas en /document al final;
 * /doc-check sigue siendo informativo por lado.
 */
type Phase =
  | "prep-front"
  | "capture-front"
  | "review-front"
  | "prep-back"
  | "capture-back"
  | "review-back"
  | "submitted"

export function DocCapture({
  onDone,
  onBack,
}: {
  onDone: () => void
  onBack?: () => void
}) {
  const [phase, setPhase] = useState<Phase>("prep-front")
  const [front, setFront] = useState<string | null>(null)
  const [back, setBack] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  // Sube ambos lados al confirmar el dorso. Fail-closed: si falla, dejamos
  // reintentar el dorso (no perdemos el frente).
  const submitBoth = useCallback(
    async (frontImg: string, backImg: string) => {
      setUploading(true)
      setUploadErr(null)
      try {
        await apiPost("/document", { front: frontImg, back: backImg })
        setUploading(false)
        setPhase("submitted")
      } catch (e) {
        setUploading(false)
        setUploadErr(errorMessage(e))
        setPhase("review-back")
      }
    },
    [],
  )

  switch (phase) {
    case "prep-front":
      return (
        <Prepare
          hero={<DocHero className="h-24 w-32" />}
          title="Preparemos tu documento"
          subtitle="Vamos a sacar una foto del frente de tu cédula."
          tips={[
            { icon: <IconFrame className="size-6" />, title: "Frente del documento", desc: "Empezamos por el lado de la foto y los datos." },
            { icon: <IconSun className="size-6" />, title: "Buena luz", desc: "Buscá un lugar bien iluminado, sin sombras." },
            { icon: <IconNoGlare className="size-6" />, title: "Que entre completo, sin reflejos", desc: "Las 4 esquinas dentro del marco." },
          ]}
          cta="Estoy listo"
          onDone={() => setPhase("capture-front")}
          onBack={onBack}
        />
      )

    case "capture-front":
      return (
        <DocSideCamera
          side="front"
          onCaptured={(img) => {
            setFront(img)
            setPhase("review-front")
          }}
        />
      )

    case "review-front":
      return (
        <DocReview
          side="front"
          image={front!}
          onConfirm={() => setPhase("prep-back")}
          onRetake={() => setPhase("capture-front")}
        />
      )

    case "prep-back":
      return (
        <Prepare
          hero={<DocHero className="h-24 w-32" />}
          title="Ahora el dorso de tu cédula"
          subtitle="Damos vuelta la cédula y sacamos el otro lado."
          tips={[
            { icon: <IconFrame className="size-6" />, title: "Dorso del documento", desc: "Que se vean las líneas (MRZ) y el código de barras." },
            { icon: <IconSun className="size-6" />, title: "Buena luz", desc: "Mismo lugar iluminado, sin sombras." },
            { icon: <IconNoGlare className="size-6" />, title: "Sin reflejos", desc: "Inclinala apenas si ves brillos." },
          ]}
          cta="Estoy listo"
          onDone={() => setPhase("capture-back")}
        />
      )

    case "capture-back":
      return (
        <DocSideCamera
          side="back"
          onCaptured={(img) => {
            setBack(img)
            setPhase("review-back")
          }}
        />
      )

    case "review-back":
      return (
        <>
          {uploadErr && (
            <Card>
              <p className="text-sm text-error" role="alert">
                {uploadErr}
              </p>
            </Card>
          )}
          <DocReview
            side="back"
            image={back!}
            onConfirm={() => void submitBoth(front!, back!)}
            onRetake={() => setPhase("capture-back")}
          />
          {uploading && (
            <p className="mt-2 text-center text-xs text-gray-400">
              Subiendo tus fotos…
            </p>
          )}
        </>
      )

    case "submitted":
      return <DocSubmitted onDone={onDone} />
  }
}

/**
 * Cámara de un lado de la cédula. Lógica IDÉNTICA al detector del commit 8b27e42:
 * auto-captura por detección geométrica real con OpenCV.js + overlay del contorno
 * en vivo + botón manual de recovery. ÚNICA diferencia: al pasar el /doc-check
 * informativo, en vez de subir o auto-avanzar, llama onCaptured(dataURL) y deja
 * que el orquestador muestre la revisión/retake.
 */
function DocSideCamera({
  side,
  onCaptured,
}: {
  side: "front" | "back"
  onCaptured: (image: string) => void
}) {
  const cam = useCamera("environment")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [flash, setFlash] = useState(false)

  const det = useDocDetector(cam.videoRef, cam.ready && !busy)
  const manualMode = det.status === "unavailable"
  const detLoading = det.status === "loading"
  const isGood = det.verdict === "good"
  const isAbsent = det.verdict === "no-doc"

  const stableSinceRef = useRef<number | null>(null)
  const capturingRef = useRef(false)
  const countingRef = useRef(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const cooldownUntilRef = useRef(0)
  const needReacquireRef = useRef(false)
  const absentFramesRef = useRef(0)

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    countingRef.current = false
  }

  const armCooldown = () => {
    cooldownUntilRef.current = Date.now() + COOLDOWN_MS
    needReacquireRef.current = true
    absentFramesRef.current = 0
  }

  const isGoodRef = useRef(isGood)
  isGoodRef.current = isGood
  const isAbsentRef = useRef(isAbsent)
  isAbsentRef.current = isAbsent

  const isFront = side === "front"

  const doCapture = useCallback(async () => {
    if (capturingRef.current) return
    capturingRef.current = true
    clearTimers()
    setBusy(true)
    setNotice(null)
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
      // Rechazo: enfriamiento + exigir que el usuario reacomode la cédula.
      armCooldown()
      void cam.start()
      return
    }

    // OK → paramos la cámara y devolvemos la foto al orquestador (revisión).
    cam.stop()
    onCaptured(img)
  }, [cam, side, onCaptured])

  const doCaptureRef = useRef(doCapture)
  doCaptureRef.current = doCapture

  const cancelCountdown = useCallback(() => {
    clearTimers()
    setCount(null)
  }, [])

  // Estabilidad + cuenta regresiva — re-render-immune (mismo patrón que Selfie).
  useEffect(() => {
    if (manualMode || busy) {
      cancelCountdown()
      stableSinceRef.current = null
      return
    }
    let raf = 0
    const loop = () => {
      if (!capturingRef.current) {
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
            countingRef.current = true
            COUNTDOWN.forEach((n, i) => {
              timersRef.current.push(setTimeout(() => setCount(n), i * 1000))
            })
            timersRef.current.push(
              setTimeout(() => void doCaptureRef.current(), COUNTDOWN.length * 1000),
            )
          }
        } else {
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

  const liveMsg = detLoading
    ? "Preparando el detector…"
    : det.verdict === "loading" || det.verdict === "no-camera"
      ? "Iniciando cámara…"
      : (DOC_LIVE_MSG[det.verdict] ?? "Poné la cédula dentro del marco")

  const frameColor = isGood ? "border-primary" : "border-white/60"

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">
        {isFront ? "Capturá el frente" : "Capturá el dorso"}
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">
        {isFront
          ? "Encuadrá el frente de tu cédula dentro del marco. La foto se saca sola."
          : "Encuadrá el dorso dentro del marco. La foto se saca sola."}
      </p>

      {notice && <Notice>{notice}</Notice>}

      <div className="relative my-4 aspect-[1.586/1] w-full overflow-hidden rounded-3xl bg-gray-900">
        <video
          ref={cam.videoRef}
          autoPlay
          playsInline
          muted
          className="size-full object-cover"
        />

        {!manualMode && (
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 size-full"
          />
        )}

        <div
          className={`pointer-events-none absolute inset-[8%] rounded-2xl border-[3px] ${
            isGood ? "border-solid" : "border-dashed"
          } ${frameColor} transition-colors duration-300`}
        />

        {detLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
            <span className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white">
              <span className="size-3 animate-pulse rounded-full bg-mint" />
              Preparando el detector…
            </span>
          </div>
        )}

        {flash && (
          <div className="teko-flash pointer-events-none absolute inset-0 bg-white" />
        )}

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
    </Card>
  )
}
