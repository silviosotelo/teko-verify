import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import {
  FilesetResolver,
  FaceDetector,
  type Detection,
} from "@mediapipe/tasks-vision"

/**
 * Detección facial EN VIVO con MediaPipe Tasks Vision (FaceDetector).
 *
 * - Carga el wasm + modelo desde el CDN de jsDelivr (sin assets en el bundle).
 * - Corre detección sobre el <video> que le pasamos (mismo ref que useCamera)
 *   en un loop de requestAnimationFrame.
 * - Devuelve un veredicto ACCIONABLE de encuadre (no rostro / lejos / descentrado
 *   / perfecto) que la UI traduce a copy + color del óvalo + auto-captura.
 * - Si MediaPipe no carga (offline/CDN caído), `status` queda en "unavailable"
 *   y la pantalla degrada a botón manual SIN romperse.
 *
 * El frame analizado es el crudo de la cámara (sin espejar). Solo nos importa el
 * CENTRADO y el TAMAÑO, no la dirección, así que el espejado del preview no afecta.
 */

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
const MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"

export type FrameVerdict =
  | "loading" // cargando modelo
  | "no-camera" // el video aún no tiene frames
  | "no-face" // no se detecta rostro
  | "multiple" // más de un rostro
  | "too-far" // rostro muy chico
  | "too-close" // rostro demasiado grande
  | "off-center" // rostro descentrado
  | "low-confidence" // detección pobre (pídele mejor luz)
  | "good" // encuadrado: listo para auto-captura

export type DetectorStatus = "loading" | "ready" | "unavailable"

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Evalúa una detección contra el encuadre objetivo (centro, tamaño). */
function evaluate(
  dets: Detection[],
  videoW: number,
  videoH: number,
): { verdict: FrameVerdict; box: Box | null } {
  if (!videoW || !videoH) return { verdict: "no-camera", box: null }
  if (dets.length === 0) return { verdict: "no-face", box: null }
  if (dets.length > 1) return { verdict: "multiple", box: null }

  const d = dets[0]
  const bb = d.boundingBox
  if (!bb) return { verdict: "no-face", box: null }

  const score = d.categories?.[0]?.score ?? 1
  // Box normalizado [0..1] respecto del frame.
  const w = bb.width / videoW
  const h = bb.height / videoH
  const cx = (bb.originX + bb.width / 2) / videoW
  const cy = (bb.originY + bb.height / 2) / videoH
  const box: Box = {
    x: bb.originX / videoW,
    y: bb.originY / videoH,
    w,
    h,
  }

  if (score < 0.5) return { verdict: "low-confidence", box }

  // El óvalo guía ocupa ~62% ancho × 78% alto. Buscamos que la cara llene
  // una fracción razonable de ese óvalo: ancho de cara objetivo ~ 0.34–0.55.
  const faceW = w
  if (faceW < 0.26) return { verdict: "too-far", box }
  if (faceW > 0.62) return { verdict: "too-close", box }

  // Centrado: tolerancia ~13% del frame respecto del centro.
  const dx = Math.abs(cx - 0.5)
  const dy = Math.abs(cy - 0.46) // un pelín arriba (la frente suele entrar más)
  if (dx > 0.15 || dy > 0.16) return { verdict: "off-center", box }

  return { verdict: "good", box }
}

export function useFaceDetector(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  const [status, setStatus] = useState<DetectorStatus>("loading")
  const [verdict, setVerdict] = useState<FrameVerdict>("loading")
  const [box, setBox] = useState<Box | null>(null)

  const detectorRef = useRef<FaceDetector | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(-1)
  const aliveRef = useRef(true)

  // Carga perezosa del modelo (una vez).
  useEffect(() => {
    aliveRef.current = true
    let cancelled = false
    async function load() {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_CDN)
        const det = await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_CDN, delegate: "GPU" },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.45,
        })
        if (cancelled) {
          det.close()
          return
        }
        detectorRef.current = det
        setStatus("ready")
      } catch (e) {
        // CDN caído / WebGL no disponible / wasm bloqueado → degradamos.
        console.warn("[teko] FaceDetector no disponible:", e)
        if (!cancelled) setStatus("unavailable")
      }
    }
    void load()
    return () => {
      cancelled = true
      aliveRef.current = false
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      const d = detectorRef.current
      detectorRef.current = null
      try {
        d?.close()
      } catch {
        /* noop */
      }
    }
  }, [])

  // Loop de detección sobre el <video>.
  const tick = useCallback(() => {
    if (!aliveRef.current) return
    const det = detectorRef.current
    const v = videoRef.current
    if (det && v && v.readyState >= 2 && v.videoWidth > 0) {
      const ts = performance.now()
      // detectForVideo exige timestamps estrictamente crecientes.
      if (ts > lastTsRef.current) {
        lastTsRef.current = ts
        try {
          const res = det.detectForVideo(v, ts)
          const { verdict: vd, box: bx } = evaluate(
            res.detections ?? [],
            v.videoWidth,
            v.videoHeight,
          )
          setVerdict(vd)
          setBox(bx)
        } catch {
          /* frame suelto: ignoramos y seguimos */
        }
      }
    } else if (v && (v.readyState < 2 || v.videoWidth === 0)) {
      setVerdict("no-camera")
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [videoRef])

  useEffect(() => {
    if (!enabled || status !== "ready") return
    aliveRef.current = true
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [enabled, status, tick])

  return { status, verdict, box }
}
