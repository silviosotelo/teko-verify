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
  | "dark" // poca luz (luma media baja)
  | "bright" // demasiada luz / quemado
  | "off-pose" // rostro de costado (no de frente)
  | "low-confidence" // detección pobre (pídele mejor luz)
  | "good" // encuadrado: listo para auto-captura

export type DetectorStatus = "loading" | "ready" | "unavailable"

interface Box {
  x: number
  y: number
  w: number
  h: number
}

// ---- Umbrales de gating (calibrables en el dispositivo) -------------------
// Tamaño del rostro (ancho bbox / ancho frame). Pedido: ~35%–70%.
const FACE_W_MIN = 0.35
const FACE_W_MAX = 0.7
// Centrado: tolerancia del centro del bbox respecto del centro del frame.
const CENTER_TOL_X = 0.13
const CENTER_TOL_Y = 0.14
// Brillo (luma media 0..255 de un canvas chico del video).
const LUMA_DARK = 70 // por debajo → "Necesitamos más luz"
const LUMA_BRIGHT = 200 // por encima → "Hay demasiada luz"
// Frontalidad (sobre keypoints normalizados de BlazeFace):
//   idx 0 = ojo derecho, 1 = ojo izquierdo, 2 = nariz.
// Ojos a la misma altura: |Δy ojos| / ancho-entre-ojos por debajo del umbral.
const EYES_LEVEL_MAX = 0.45
// Nariz centrada entre los ojos: |nariz - punto medio ojos| / ancho-ojos.
const NOSE_CENTER_MAX = 0.34

interface NKP {
  x: number
  y: number
}

/** Chequea frontalidad con los keypoints de BlazeFace (ojos + nariz). */
function isFrontal(keypoints: NKP[] | undefined): boolean | null {
  if (!keypoints || keypoints.length < 3) return null // sin keypoints: no bloquea
  const rEye = keypoints[0]
  const lEye = keypoints[1]
  const nose = keypoints[2]
  if (!rEye || !lEye || !nose) return null
  const eyeDx = Math.abs(lEye.x - rEye.x)
  if (eyeDx < 1e-4) return false
  const eyeDy = Math.abs(lEye.y - rEye.y)
  // Ojos nivelados (cabeza no inclinada de costado/rotada).
  if (eyeDy / eyeDx > EYES_LEVEL_MAX) return false
  // Nariz centrada horizontalmente entre los ojos (no de perfil).
  const midX = (lEye.x + rEye.x) / 2
  if (Math.abs(nose.x - midX) / eyeDx > NOSE_CENTER_MAX) return false
  return true
}

/**
 * Evalúa una detección contra el encuadre objetivo: tamaño, centrado,
 * brillo (luma) y frontalidad (keypoints). `luma` es la luma media del frame.
 */
function evaluate(
  dets: Detection[],
  videoW: number,
  videoH: number,
  luma: number,
): { verdict: FrameVerdict; box: Box | null } {
  if (!videoW || !videoH) return { verdict: "no-camera", box: null }
  // Brillo primero: si está muy oscuro/quemado, ningún encuadre sirve.
  if (luma > 0) {
    if (luma < LUMA_DARK) return { verdict: "dark", box: null }
    if (luma > LUMA_BRIGHT) return { verdict: "bright", box: null }
  }
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

  // Tamaño correcto (ni muy lejos ni muy cerca).
  const faceW = w
  if (faceW < FACE_W_MIN) return { verdict: "too-far", box }
  if (faceW > FACE_W_MAX) return { verdict: "too-close", box }

  // Centrado en el óvalo (centro del bbox cerca del centro del frame).
  const dx = Math.abs(cx - 0.5)
  const dy = Math.abs(cy - 0.46) // un pelín arriba (la frente suele entrar más)
  if (dx > CENTER_TOL_X || dy > CENTER_TOL_Y) return { verdict: "off-center", box }

  // De frente (ojos nivelados + nariz centrada). Si no hay keypoints, no bloquea.
  const frontal = isFrontal(d.keypoints as NKP[] | undefined)
  if (frontal === false) return { verdict: "off-pose", box }

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
  // Canvas chico para medir luma media del frame (brillo).
  const lumaCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Carga perezosa del modelo (una vez).
  useEffect(() => {
    aliveRef.current = true
    let cancelled = false
    async function load() {
      const fileset = await FilesetResolver.forVisionTasks(WASM_CDN).catch(
        (e) => {
          console.warn("[teko] FilesetResolver falló:", e)
          return null
        },
      )
      if (!fileset) {
        if (!cancelled) setStatus("unavailable")
        return
      }
      // Intentamos GPU (rápido) y si el delegate no inicializa (WebGL ausente en
      // headless / algunos teléfonos), reintentamos con CPU antes de degradar a
      // modo manual. Así el gating facial sigue activo aunque no haya GPU.
      const make = (delegate: "GPU" | "CPU") =>
        FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_CDN, delegate },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.45,
        })
      let det: FaceDetector | null = null
      try {
        det = await make("GPU")
      } catch (e) {
        console.warn("[teko] FaceDetector GPU falló, reintento CPU:", e)
        try {
          det = await make("CPU")
        } catch (e2) {
          console.warn("[teko] FaceDetector no disponible (CPU también):", e2)
        }
      }
      if (!det) {
        if (!cancelled) setStatus("unavailable")
        return
      }
      if (cancelled) {
        det.close()
        return
      }
      detectorRef.current = det
      setStatus("ready")
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

  // Mide la luma media del frame en un canvas chico (32×24). Barato.
  const sampleLuma = useCallback((v: HTMLVideoElement): number => {
    let c = lumaCanvasRef.current
    if (!c) {
      c = document.createElement("canvas")
      c.width = 32
      c.height = 24
      lumaCanvasRef.current = c
    }
    const ctx = c.getContext("2d", { willReadFrequently: true })
    if (!ctx) return 0
    try {
      ctx.drawImage(v, 0, 0, c.width, c.height)
      const { data } = ctx.getImageData(0, 0, c.width, c.height)
      let sum = 0
      const n = data.length / 4
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      }
      return sum / n
    } catch {
      return 0 // getImageData puede fallar puntualmente: 0 = no bloquea por luz
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
          const luma = sampleLuma(v)
          const { verdict: vd, box: bx } = evaluate(
            res.detections ?? [],
            v.videoWidth,
            v.videoHeight,
            luma,
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
  }, [videoRef, sampleLuma])

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
