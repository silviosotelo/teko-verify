import { useCallback, useEffect, useRef, useState } from "react"
import { apiPost, type DocCheckResult, type DocumentType } from "../api"
import { docMsg, DOC_LIVE_MSG, errorMessage } from "../messages"
import { useCamera } from "../useCamera"
import { useDocDetector } from "../useDocDetector"
import { Button, Card, Notice, ProgressOverlay } from "../ui"
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
 * Captura de documento con REVISIÓN/RETAKE POR LADO (estilo Didit) — orquestador
 * ADAPTATIVO al tipo de documento (multi-documento P1 #3):
 *
 *   - CÉDULA PY ("ci_py", default): frente + dorso (camino histórico INTACTO)
 *       prep-front → capture-front → review-front → prep-back → capture-back →
 *       review-back → submitted (POST /document {front,back,documentType})
 *   - PASAPORTE ("passport"): UNA sola página de datos (sin dorso)
 *       prep-front → capture-front → review-front → submitted
 *       (POST /document {front, back: front, documentType}). El backend ignora
 *       `back` en el camino de pasaporte; reenviamos la página de datos para no
 *       romper el contrato de subida.
 *
 * La cámara real por lado (DocSideCamera) conserva INTACTA la lógica anti-loop
 * del detector geométrico (OpenCV.js) del commit 8b27e42: cooldown, re-adquisición
 * por ausencia real, refs espejo, overlay del contorno en vivo y auto-captura
 * 3·2·1. La diferencia: en vez de auto-avanzar/subir, devuelve el dataURL al
 * orquestador, que muestra la revisión y permite retomar el lado.
 *
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
  documentType = "ci_py",
  onDone,
  onBack,
}: {
  /** Tipo de documento elegido; rige si hay dorso (cédula) o no (pasaporte). */
  documentType?: DocumentType
  onDone: () => void
  onBack?: () => void
}) {
  const isPassport = documentType === "passport"
  const [phase, setPhase] = useState<Phase>("prep-front")
  const [front, setFront] = useState<string | null>(null)
  const [back, setBack] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [overlayErr, setOverlayErr] = useState<string | null>(null)
  const [retryArgs, setRetryArgs] = useState<[string, string] | null>(null)

  // Sube el documento. Para cédula viajan los dos lados; para pasaporte se reenvía
  // la página de datos como `back` (el backend la ignora en ese camino). El
  // `documentType` viaja para que el backend rutee la extracción. Fail-closed: si
  // falla, volvemos a la revisión del último lado (no perdemos lo capturado).
  const submitDoc = useCallback(
    async (frontImg: string, backImg: string) => {
      setUploading(true)
      setUploadErr(null)
      setOverlayErr(null)
      setRetryArgs(null)
      try {
        await apiPost("/document", { front: frontImg, back: backImg, documentType }, { timeoutMs: 60_000 })
        setPhase("submitted")
      } catch (e) {
        const msg = errorMessage(e)
        setUploadErr(msg)
        setOverlayErr(msg)
        setRetryArgs([frontImg, backImg])
        setPhase(isPassport ? "review-front" : "review-back")
      } finally {
        setUploading(false)
      }
    },
    [documentType, isPassport],
  )

  const DOC_UPLOAD_STEPS = [
    { key: "upload", label: "Subir" },
    { key: "review", label: "Revisar" },
    { key: "done", label: "Listo" },
  ]

  switch (phase) {
    case "prep-front":
      return (
        <Prepare
          hero={<DocHero className="h-24 w-32" />}
          title="Preparemos tu documento"
          subtitle={
            isPassport
              ? "Vamos a sacar una foto de la página de datos de tu pasaporte."
              : "Vamos a sacar una foto del frente de tu cédula."
          }
          tips={
            isPassport
              ? [
                  { icon: <IconFrame className="size-6" />, title: "Página de datos", desc: "La página con tu foto y tus datos, abierta y plana." },
                  { icon: <IconNoGlare className="size-6" />, title: "Franja MRZ visible", desc: "Las dos líneas de símbolos del pie deben verse completas." },
                  { icon: <IconSun className="size-6" />, title: "Buena luz, sin reflejos", desc: "Lugar iluminado; que entre completa dentro del marco." },
                ]
              : [
                  { icon: <IconFrame className="size-6" />, title: "Frente del documento", desc: "Empezamos por el lado de la foto y los datos." },
                  { icon: <IconSun className="size-6" />, title: "Buena luz", desc: "Buscá un lugar bien iluminado, sin sombras." },
                  { icon: <IconNoGlare className="size-6" />, title: "Que entre completo, sin reflejos", desc: "Las 4 esquinas dentro del marco." },
                ]
          }
          cta="Estoy listo"
          onDone={() => setPhase("capture-front")}
          onBack={onBack}
        />
      )

    case "capture-front":
      return (
        <DocSideCamera
          side="front"
          isPassport={isPassport}
          onCaptured={(img) => {
            setFront(img)
            setPhase("review-front")
          }}
        />
      )

    case "review-front":
      // Pasaporte: la página de datos es el único lado → confirmar SUBE el documento.
      // Cédula: confirmar avanza al dorso (camino histórico).
      return (
        <>
          <ProgressOverlay
            open={uploading || !!overlayErr}
            title={overlayErr ? "No pudimos subir tu documento" : "Subiendo tu documento"}
            subtitle={overlayErr ? undefined : "Esto puede tardar unos segundos. No cierres esta pantalla."}
            steps={DOC_UPLOAD_STEPS}
            activeStepKey="upload"
            state={overlayErr ? "error" : "loading"}
            errorText={overlayErr ?? undefined}
            onRetry={retryArgs ? () => void submitDoc(retryArgs[0], retryArgs[1]) : undefined}
            onCancel={overlayErr ? () => { setOverlayErr(null); setRetryArgs(null) } : undefined}
          />
          {!overlayErr && uploadErr && <Notice>{uploadErr}</Notice>}
          <DocReview
            side="front"
            label={isPassport ? "la página de datos" : undefined}
            image={front!}
            onConfirm={() =>
              isPassport ? void submitDoc(front!, front!) : setPhase("prep-back")
            }
            onRetake={() => setPhase("capture-front")}
          />
        </>
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
          <ProgressOverlay
            open={uploading || !!overlayErr}
            title={overlayErr ? "No pudimos subir tu documento" : "Subiendo tu documento"}
            subtitle={overlayErr ? undefined : "Esto puede tardar unos segundos. No cierres esta pantalla."}
            steps={DOC_UPLOAD_STEPS}
            activeStepKey="upload"
            state={overlayErr ? "error" : "loading"}
            errorText={overlayErr ?? undefined}
            onRetry={retryArgs ? () => void submitDoc(retryArgs[0], retryArgs[1]) : undefined}
            onCancel={overlayErr ? () => { setOverlayErr(null); setRetryArgs(null) } : undefined}
          />
          {!overlayErr && uploadErr && <Notice>{uploadErr}</Notice>}
          <DocReview
            side="back"
            image={back!}
            onConfirm={() => void submitDoc(front!, back!)}
            onRetake={() => setPhase("capture-back")}
          />
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
  isPassport = false,
  onCaptured,
}: {
  side: "front" | "back"
  /** Pasaporte: el "frente" es la página de datos; coaching apunta a la franja MRZ. */
  isPassport?: boolean
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
      check = await apiPost<DocCheckResult>("/doc-check", { image: img, side }, { timeoutMs: 20_000 })
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
  // El documento se valida CONTRA el recuadro-guía ESTÁTICO (inset-8%, ver
  // GUIDE_INSET en docAnalyze): NO se dibuja un contorno que persiga al documento.
  // El marco fijo es el único indicador y cambia de color (buscando → ajustando →
  // verde "bien ajustado"); cuando queda verde estable, la captura dispara sola.

  // Etiqueta del documento/lado para la guía (adaptativa al tipo).
  const docNoun = isPassport ? "el documento" : "la cédula"
  const inFrameMsg = `Poné ${docNoun} dentro del marco`

  const liveMsg = detLoading
    ? "Preparando el detector…"
    : det.verdict === "loading" || det.verdict === "no-camera"
      ? "Iniciando cámara…"
      : (DOC_LIVE_MSG[det.verdict] ?? inFrameMsg)

  // Estado del marco-guía estático (3 niveles, feedback claro):
  //   searching  → sin documento: borde blanco punteado ("poné el documento")
  //   adjusting  → documento detectado pero no encaja: ámbar ("acercá/enderezá")
  //   good       → bien ajustado dentro del marco: VERDE sólido → autocaptura
  const frameState: "searching" | "adjusting" | "good" = isGood
    ? "good"
    : det.verdict === "no-doc" ||
        det.verdict === "loading" ||
        det.verdict === "no-camera"
      ? "searching"
      : "adjusting"
  const frameClass =
    frameState === "good"
      ? "border-solid border-[#16a34a] shadow-[0_0_0_4px_rgba(22,163,74,0.30)]"
      : frameState === "adjusting"
        ? "border-dashed border-[#f59e0b]"
        : "border-dashed border-white/60"

  // Título/subtítulo: pasaporte = página de datos (con la franja MRZ); cédula =
  // frente/dorso (camino histórico).
  const title = isPassport
    ? "Capturá la página de datos"
    : isFront
      ? "Capturá el frente"
      : "Capturá el dorso"
  const subtitle = isPassport
    ? "Encuadrá la página de datos de tu pasaporte, con la franja MRZ del pie visible. La foto se saca sola."
    : isFront
      ? "Encuadrá el frente de tu cédula dentro del marco. La foto se saca sola."
      : "Encuadrá el dorso dentro del marco. La foto se saca sola."
  // Incluye la preposición para que la frase del botón quede natural en ambos casos.
  const captureNoun = isPassport
    ? "de la página de datos"
    : isFront
      ? "del frente"
      : "del dorso"

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">{subtitle}</p>

      {notice && <Notice>{notice}</Notice>}

      <div className="relative my-4 aspect-[1.586/1] w-full overflow-hidden rounded-3xl bg-gray-900">
        <video
          ref={cam.videoRef}
          autoPlay
          playsInline
          muted
          className="size-full object-cover"
        />

        <div
          className={`pointer-events-none absolute inset-[8%] rounded-2xl border-[3px] ${frameClass} transition-all duration-300`}
        />

        {frameState === "good" && count == null && (
          <div className="pointer-events-none absolute right-[10%] top-[10%] flex size-7 items-center justify-center rounded-full bg-[#16a34a] text-white shadow-lg">
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.29 6.8-6.8a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}

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
              {manualMode ? inFrameMsg : liveMsg}
            </span>
          </div>
        )}
      </div>

      {cam.error && (
        <Notice>No se pudo abrir la cámara: {cam.error}.</Notice>
      )}

      {manualMode && (
        <Notice>
          No pudimos preparar el detector automático. Encuadrá {docNoun}{" "}
          llenando el marco y tocá el botón para sacar la foto.
        </Notice>
      )}

      <Button
        disabled={busy || !cam.ready}
        onClick={() => void doCapture()}
        variant={manualMode ? "primary" : "ghost"}
      >
        {busy ? "Revisando la foto…" : `Sacar foto ${captureNoun} ahora`}
      </Button>
      <p className="mt-2 text-center text-xs text-gray-400">
        {manualMode
          ? `Sacá la foto cuando ${docNoun} llene el marco`
          : "La captura es automática · o tocá el botón cuando quieras"}
      </p>
    </Card>
  )
}
