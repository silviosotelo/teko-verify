import { useCallback, useEffect, useRef, useState } from "react"
import { apiPost, apiUploadVideo, type QualityResult } from "../api"
import { evalQuality, errorMessage } from "../messages"
import { useCamera } from "../useCamera"
import { useFaceLandmarker } from "../useFaceLandmarker"
import {
  CHALLENGE_LABEL,
  challengeSatisfied,
  initialSeqState,
  isFrontal,
  pickChallenges,
  stepSequence,
  type ChallengeId,
  type LivenessSignals,
  type SeqState,
} from "../liveness/challenges"
import { pickBestFrame, type FrameCandidate } from "../liveness/bestFrame"
import { laplacianVariance } from "../liveness/signals"
import { Button, Card, Notice, BackBar } from "../ui"

// --- Parámetros del flujo de liveness activo ------------------------------- //
// Cuánto hay que SOSTENER cada desafío para contarlo (ms). Los gestos (parpadeo)
// son casi instantáneos; las poses exigen mantenerse un instante (anti-ruido).
const HOLD_MS: Record<ChallengeId, number> = {
  center: 650,
  turn_left: 350,
  turn_right: 350,
  blink: 0,
  smile: 150,
  closer: 350,
}
// Candidatos para el mejor frame: cada cuánto capturamos uno (ms) y cuántos como tope.
const CANDIDATE_EVERY_MS = 300
const MAX_CANDIDATES = 10
// Timeout global de la secuencia: si no se completa, ofrecemos reintentar / manual.
const SESSION_TIMEOUT_MS = 60_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** MIME de grabación soportado (prefiere webm; cae a mp4). null si no hay soporte. */
function pickRecorderMime(): string | null {
  const MR = typeof window !== "undefined" ? window.MediaRecorder : undefined
  if (!MR || typeof MR.isTypeSupported !== "function") return null
  const cands = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ]
  return cands.find((m) => MR.isTypeSupported(m)) ?? null
}

/** Feedback en vivo accionable según el desafío actual y las señales. */
function feedbackFor(
  challenge: ChallengeId,
  s: LivenessSignals,
  awaitingReset: boolean
): string {
  if (!s.hasFace) return "Ubicá tu rostro en el círculo"
  if (awaitingReset) return "Volvé al frente"
  switch (challenge) {
    case "center":
      if (s.faceWidth < 0.3) return "Acercate un poco"
      if (Math.abs(s.cx - 0.5) > 0.16 || Math.abs(s.cy - 0.5) > 0.16)
        return "Centrate en el círculo"
      if (Math.abs(s.yaw) > 10) return "Mirá de frente"
      return "Perfecto, no te muevas"
    case "turn_right":
      return s.yaw >= 18 ? "¡Perfecto!" : "Seguí girando a la derecha"
    case "turn_left":
      return s.yaw <= -18 ? "¡Perfecto!" : "Seguí girando a la izquierda"
    case "blink":
      return "Parpadeá una vez"
    case "smile":
      return s.smile >= 0.5 ? "¡Buena sonrisa!" : "Regalanos una sonrisa"
    case "closer":
      return s.faceWidth >= 0.62 ? "¡Perfecto!" : "Acercate un poco más"
    default:
      return ""
  }
}

/**
 * Selfie con LIVENESS ACTIVO interactivo (estilo KYC moderno):
 *  - Detección con MediaPipe FaceLandmarker (blendshapes + matriz de transformación):
 *    da parpadeo/sonrisa y yaw/pitch de la cabeza.
 *  - Secuencia de desafíos guiados (centrate, girá izq/der, parpadeá, sonreí,
 *    acercate): anillo de progreso, instrucción grande, ✓ por desafío, feedback en
 *    vivo. Anti-trampa: hay que volver a frente entre desafíos.
 *  - Grabación de TODA la sesión con MediaRecorder → video de evidencia (webm/mp4).
 *  - Mejor frame: durante los momentos "de frente y centrado" junta candidatos y los
 *    puntúa (frontalidad + tamaño + nitidez); el mejor es el selfie del match.
 *  - Al terminar: sube el MEJOR frame a /selfie (con el resultado del liveness activo)
 *    + sube el video a /liveness-video. Fallback a captura manual si no hay modelo.
 *
 * Contrato intacto: POST /selfie {image, frames, activeLiveness}.
 */
export function Selfie({
  onDone,
  onBack,
}: {
  onDone: () => void
  onBack?: () => void
}) {
  const cam = useCamera("user")

  type Phase = "running" | "uploading" | "error"
  const [phase, setPhase] = useState<Phase>("running")
  const [sequence] = useState<ChallengeId[]>(() => pickChallenges())
  const [progress, setProgress] = useState(0) // desafíos completados
  const [current, setCurrent] = useState<ChallengeId>(sequence[0])
  const [feedback, setFeedback] = useState("Ubicá tu rostro en el círculo")
  const [notice, setNotice] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [manualBusy, setManualBusy] = useState(false)

  // Refs vivos (el loop de detección los lee/escribe sin re-montar el efecto).
  const seqRef = useRef<SeqState>(initialSeqState())
  const holdStartRef = useRef<number | null>(null)
  const seqIdxRef = useRef(0)
  const candidatesRef = useRef<FrameCandidate[]>([])
  const lastCandRef = useRef(0)
  const lastFeedbackRef = useRef("")
  const finishedRef = useRef(false)
  const sharpCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Grabación.
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recMimeRef = useRef<string>("video/webm")

  const status = useFaceLandmarkerStatus(cam, phase, {
    seqRef,
    holdStartRef,
    seqIdxRef,
    candidatesRef,
    lastCandRef,
    lastFeedbackRef,
    finishedRef,
    sharpCanvasRef,
    sequence,
    setProgress,
    setCurrent,
    setFeedback,
    onAllDone: () => void finishLiveness(),
    grab: cam.grab,
  })

  const manualMode = status === "unavailable"

  // ---- Grabación: arranca cuando la cámara está lista; junta chunks --------- //
  // OJO con las deps: `cam` cambia de identidad en cada render; usar `cam` acá
  // re-ejecutaría el efecto en cada render (stop+recreate del recorder → blob
  // fragmentado sin header válido). Dependemos sólo de cam.ready/phase + el
  // accessor ESTABLE cam.getStream (useCallback []). Así el recorder se crea UNA vez.
  const getStream = cam.getStream
  useEffect(() => {
    if (!cam.ready || phase !== "running" || recorderRef.current) return
    const stream = getStream()
    if (!stream) return
    const mime = pickRecorderMime()
    try {
      const rec = mime
        ? new MediaRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond: 1_000_000,
          })
        : new MediaRecorder(stream)
      recMimeRef.current = mime ?? "video/webm"
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.start(1000) // chunk cada 1s
      recorderRef.current = rec
    } catch {
      // MediaRecorder no soportado: seguimos sin video (fail-open, evidencia opcional).
      recorderRef.current = null
    }
    return () => {
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive")
          recorderRef.current.stop()
      } catch {
        /* noop */
      }
      recorderRef.current = null
    }
  }, [cam.ready, phase, getStream])

  /** Detiene la grabación y resuelve el Blob final (null si no hubo grabación). */
  const stopRecording = useCallback((): Promise<Blob | null> => {
    const rec = recorderRef.current
    if (!rec) return Promise.resolve(null)
    return new Promise((resolve) => {
      const finalize = () => {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: recMimeRef.current })
          : null
        resolve(blob)
      }
      if (rec.state === "inactive") return finalize()
      rec.onstop = finalize
      try {
        rec.stop()
      } catch {
        finalize()
      }
    })
  }, [])

  // ---- Subida del mejor frame + video --------------------------------------- //
  const finishLiveness = useCallback(async () => {
    if (finishedRef.current) return
    finishedRef.current = true
    setPhase("uploading")
    setNotice(null)
    setFatal(null)
    try {
      // Mejor frame entre los candidatos "de frente"; si no hay, capturamos uno ya.
      const cands = candidatesRef.current
      const bestIdx = pickBestFrame(cands)
      const bestImage = bestIdx >= 0 ? cands[bestIdx].image : cam.grab(0.9)
      // Un 2º frame para el PAD/desafío por-frames del backend (distinto del mejor).
      const frames: string[] = []
      if (cands.length > 1) {
        const other = bestIdx === 0 ? cands[cands.length - 1] : cands[0]
        frames.push(other.image)
      }

      // Detiene la grabación y obtiene el video (evidencia).
      const videoBlob = await stopRecording()
      cam.stop()

      // 1) Sube el mejor frame + el resultado del liveness activo (desafíos cumplidos).
      const resp = await apiPost<{ quality?: QualityResult }>("/selfie", {
        image: bestImage,
        frames,
        activeLiveness: { challenges: sequence, passed: true },
      })

      // 2) Sube el video (fail-open: si falla, no bloquea el avance).
      if (videoBlob && videoBlob.size > 0) {
        void apiUploadVideo(videoBlob)
      }

      const verdict = evalQuality(resp.quality)
      if (verdict.advance) {
        onDone()
        return
      }
      // La calidad del mejor frame no alcanzó (p.ej. anteojos/luz): pedimos reintento.
      setNotice(verdict.msg ?? "Probá de nuevo, con buena luz y de frente.")
      setPhase("error")
    } catch (e) {
      setFatal(errorMessage(e))
      setPhase("error")
    }
  }, [cam, onDone, sequence, stopRecording])

  // ---- Timeout de la secuencia ---------------------------------------------- //
  useEffect(() => {
    if (phase !== "running") return
    const t = setTimeout(() => {
      if (!finishedRef.current) {
        setFatal(
          "No pudimos completar la verificación a tiempo. Probá de nuevo con buena luz."
        )
        setPhase("error")
      }
    }, SESSION_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [phase])

  // ---- Reintento: reinicia la secuencia y la cámara ------------------------- //
  const retry = useCallback(async () => {
    seqRef.current = initialSeqState()
    seqIdxRef.current = 0
    holdStartRef.current = null
    candidatesRef.current = []
    lastCandRef.current = 0
    lastFeedbackRef.current = ""
    finishedRef.current = false
    chunksRef.current = []
    recorderRef.current = null
    setProgress(0)
    setCurrent(sequence[0])
    setFeedback("Ubicá tu rostro en el círculo")
    setNotice(null)
    setFatal(null)
    setPhase("running")
    if (!cam.ready) await cam.start()
  }, [cam, sequence])

  // ---- Captura manual (fallback si no hay modelo o el usuario no puede) ------ //
  const manualCapture = useCallback(async () => {
    if (manualBusy) return
    setManualBusy(true)
    setNotice(null)
    setFatal(null)
    finishedRef.current = true
    try {
      const selfie = cam.grab(0.9)
      await sleep(300)
      const f1 = cam.grab(0.9)
      const videoBlob = await stopRecording()
      cam.stop()
      // Captura manual: SIN activeLiveness (no se reclama liveness activo) → el
      // backend cae al PAD pasivo, honesto/fail-closed.
      const resp = await apiPost<{ quality?: QualityResult }>("/selfie", {
        image: selfie,
        frames: [f1],
      })
      if (videoBlob && videoBlob.size > 0) void apiUploadVideo(videoBlob)
      const verdict = evalQuality(resp.quality)
      if (verdict.advance) {
        onDone()
        return
      }
      setNotice(verdict.msg ?? "Probá de nuevo, con buena luz y de frente.")
      setManualBusy(false)
      finishedRef.current = false
      await cam.start()
    } catch (e) {
      setFatal(errorMessage(e))
      setManualBusy(false)
      finishedRef.current = false
      await cam.start()
    }
  }, [cam, manualBusy, onDone, stopRecording])

  const camDenied = !!cam.error
  const total = sequence.length
  const pct = total > 0 ? progress / total : 0

  // Anillo de progreso (SVG). Verde Teko.
  const R = 130
  const C = 2 * Math.PI * R
  const ringColor = "#16a34a"

  return (
    <Card>
      <BackBar onBack={onBack} />
      <h1 className="text-xl font-bold text-gray-900">Verificá que sos vos</h1>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">
        Seguí las instrucciones en pantalla. Vamos a grabar un video corto para
        confirmar que estás en vivo.
      </p>

      {notice && <Notice>{notice}</Notice>}
      {fatal && (
        <p className="mt-3 text-sm text-error" role="alert">
          {fatal}
        </p>
      )}

      <div className="relative my-4 aspect-square w-full overflow-hidden rounded-full bg-gray-900">
        <video
          ref={cam.videoRef}
          autoPlay
          playsInline
          muted
          className="size-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* Anillo de progreso de la secuencia (verde Teko). */}
        <svg
          className="pointer-events-none absolute inset-0 size-full -rotate-90"
          viewBox="0 0 300 300"
          aria-hidden
        >
          <circle
            cx="150"
            cy="150"
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="8"
          />
          <circle
            cx="150"
            cy="150"
            r={R}
            fill="none"
            stroke={ringColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            style={{ transition: "stroke-dashoffset 400ms ease" }}
          />
        </svg>

        {/* REC indicador */}
        {phase === "running" && (
          <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white">
            <span className="size-2 animate-pulse rounded-full bg-red-500" />
            REC
          </div>
        )}

        {/* Instrucción grande + feedback */}
        {phase === "running" && !camDenied && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex flex-col items-center gap-1 px-6 text-center">
            <span className="rounded-2xl bg-black/55 px-4 py-2 text-lg font-bold text-white backdrop-blur-sm">
              {CHALLENGE_LABEL[current]}
            </span>
            <span className="text-sm font-medium text-white/90 drop-shadow">
              {feedback}
            </span>
          </div>
        )}

        {phase === "uploading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 text-white">
            <div className="size-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
            <span className="text-sm font-medium">Verificando…</span>
          </div>
        )}
      </div>

      {/* Pasos completados (✓) */}
      {phase === "running" && (
        <div className="mb-2 flex items-center justify-center gap-2">
          {sequence.map((c, i) => (
            <span
              key={`${c}-${i}`}
              className={`flex size-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                i < progress
                  ? "bg-primary text-white"
                  : i === progress
                    ? "bg-primary/20 text-primary ring-2 ring-primary"
                    : "bg-gray-100 text-gray-300"
              }`}
              title={CHALLENGE_LABEL[c]}
            >
              {i < progress ? "✓" : i + 1}
            </span>
          ))}
        </div>
      )}

      {/* Cámara denegada/fallida: reintento. */}
      {camDenied && (
        <>
          <Notice>
            No pudimos usar la cámara: {cam.error}. Revisá el permiso del
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

      {/* Error / timeout: reintentar la secuencia. */}
      {phase === "error" && !camDenied && (
        <Button onClick={() => void retry()}>Reintentar la verificación</Button>
      )}

      {/* Captura manual: SIEMPRE como recovery; obligatoria si no hay modelo. */}
      {!camDenied && (
        <>
          <Button
            disabled={manualBusy || !cam.ready || phase === "uploading"}
            onClick={() => void manualCapture()}
            variant={manualMode || phase === "error" ? "primary" : "ghost"}
            className="mt-2"
          >
            {manualBusy
              ? "Revisando tu foto…"
              : manualMode
                ? "Sacar selfie"
                : "Sacar selfie ahora"}
          </Button>
          {!manualMode && phase === "running" && (
            <p className="mt-2 text-center text-xs text-gray-400">
              Seguí los pasos · o sacate la selfie manualmente cuando quieras
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

/**
 * Encapsula el cableado del FaceLandmarker + el loop por-frame de desafíos y captura
 * de candidatos. Devuelve el `status` del modelo. Mantiene el componente legible:
 * toda la lógica viva (refs) entra por `ctx`.
 */
function useFaceLandmarkerStatus(
  cam: ReturnType<typeof useCamera>,
  phase: "running" | "uploading" | "error",
  ctx: {
    seqRef: React.MutableRefObject<SeqState>
    holdStartRef: React.MutableRefObject<number | null>
    seqIdxRef: React.MutableRefObject<number>
    candidatesRef: React.MutableRefObject<FrameCandidate[]>
    lastCandRef: React.MutableRefObject<number>
    lastFeedbackRef: React.MutableRefObject<string>
    finishedRef: React.MutableRefObject<boolean>
    sharpCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>
    sequence: ChallengeId[]
    setProgress: (n: number) => void
    setCurrent: (c: ChallengeId) => void
    setFeedback: (s: string) => void
    onAllDone: () => void
    grab: (q?: number) => string
  }
) {
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  const onFrame = useCallback(
    (s: LivenessSignals, video: HTMLVideoElement, ts: number) => {
      const c = ctxRef.current
      if (c.finishedRef.current) return

      // 1) Captura de candidatos para el mejor frame (sólo de frente y centrado).
      if (
        isFrontal(s) &&
        ts - c.lastCandRef.current > CANDIDATE_EVERY_MS &&
        c.candidatesRef.current.length < MAX_CANDIDATES
      ) {
        c.lastCandRef.current = ts
        const sharp = measureSharpness(video, c.sharpCanvasRef)
        c.candidatesRef.current.push({
          yaw: s.yaw,
          faceWidth: s.faceWidth,
          sharpness: sharp,
          image: c.grab(0.9),
        })
      }

      // 2) Avance de la secuencia de desafíos.
      const seq = c.sequence
      const idx = c.seqRef.current.i
      if (idx >= seq.length) return
      // Reset del hold si cambió el desafío actual.
      if (idx !== c.seqIdxRef.current) {
        c.seqIdxRef.current = idx
        c.holdStartRef.current = null
      }
      const id = seq[idx]
      const frontal = isFrontal(s)

      // Satisfacción con HOLD (poses exigen sostenerse; gestos casi instantáneos).
      let satisfied = false
      if (challengeSatisfied(id, s)) {
        if (c.holdStartRef.current == null) c.holdStartRef.current = ts
        satisfied = ts - c.holdStartRef.current >= HOLD_MS[id]
      } else {
        c.holdStartRef.current = null
      }

      const r = stepSequence(c.seqRef.current, seq, satisfied, frontal)
      c.seqRef.current = r.state
      if (r.justCompleted) {
        c.holdStartRef.current = null
        c.setProgress(r.state.completed)
      }
      if (r.allDone) {
        c.onAllDone()
        return
      }
      // UI: desafío actual + feedback (sólo si cambió, para no re-render por frame).
      const curId = seq[r.state.i] ?? id
      c.setCurrent(curId)
      const fb = feedbackFor(curId, s, r.state.awaitingReset)
      if (fb !== c.lastFeedbackRef.current) {
        c.lastFeedbackRef.current = fb
        c.setFeedback(fb)
      }
    },
    []
  )

  const { status } = useFaceLandmarker(
    cam.videoRef,
    cam.ready && phase === "running",
    onFrame
  )
  return status
}

/**
 * Nitidez (varianza del Laplaciano) del frame actual sobre un canvas chico (96x72)
 * en escala de grises. Barato; reusa el mismo canvas.
 */
function measureSharpness(
  video: HTMLVideoElement,
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>
): number {
  let cv = canvasRef.current
  if (!cv) {
    cv = document.createElement("canvas")
    cv.width = 96
    cv.height = 72
    canvasRef.current = cv
  }
  const ctx = cv.getContext("2d", { willReadFrequently: true })
  if (!ctx) return 0
  try {
    ctx.drawImage(video, 0, 0, cv.width, cv.height)
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height)
    const n = cv.width * cv.height
    const gray = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      gray[i] =
        0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    }
    return laplacianVariance(gray, cv.width, cv.height)
  } catch {
    return 0
  }
}
