import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import {
  FilesetResolver,
  FaceLandmarker,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision"
import { matrixToAngles, bboxFromLandmarks } from "./liveness/signals"
import type { LivenessSignals } from "./liveness/challenges"

/**
 * Detección de LIVENESS ACTIVO con MediaPipe Tasks Vision **FaceLandmarker** (no el
 * FaceDetector simple): habilita `outputFaceBlendshapes` (da eyeBlinkLeft/Right,
 * mouthSmileLeft/Right, etc.) y `outputFacialTransformationMatrixes` (matriz 4x4 →
 * yaw/pitch de la cabeza). Con eso el flujo de la selfie puede pedir y DETECTAR los
 * desafíos guiados (girar, parpadear, sonreír).
 *
 * - Modelo + wasm SELF-HOSTED desde el mismo origen (/app/mediapipe/…) — NADA de CDN
 *   en runtime (on-prem, Ley 7593). `face_landmarker.task` se copia a public/mediapipe.
 * - Mismo patrón de warmup/singleton que useFaceDetector: el arranque (wasm + modelo
 *   + delegate) se precarga en una pantalla previa para que la selfie no pague la
 *   espera fría. Reuso seguro: detectForVideo exige timestamps crecientes y
 *   performance.now() es monotónico.
 * - En vez de re-render por frame, invoca un callback `onFrame(signals, video, ts)`:
 *   el screen lee las señales y corre su máquina de desafíos sin re-montar el efecto.
 * - Si el modelo no carga (offline/sin WebGL) → status "unavailable" y el screen
 *   degrada a captura manual SIN romperse (fail-safe de UX, no de seguridad).
 */

const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/face_landmarker.task`

export type LandmarkerStatus = "loading" | "ready" | "unavailable"

let sharedLandmarkerPromise: Promise<FaceLandmarker | null> | null = null

async function createLandmarker(): Promise<FaceLandmarker | null> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH).catch((e) => {
    console.warn("[teko] FilesetResolver (landmarker) falló:", e)
    return null
  })
  if (!fileset) return null
  const make = (delegate: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })
  try {
    return await make("GPU")
  } catch (e) {
    console.warn("[teko] FaceLandmarker GPU falló, reintento CPU:", e)
    try {
      return await make("CPU")
    } catch (e2) {
      console.warn("[teko] FaceLandmarker no disponible (CPU también):", e2)
      return null
    }
  }
}

function getSharedLandmarker(): Promise<FaceLandmarker | null> {
  if (!sharedLandmarkerPromise) {
    sharedLandmarkerPromise = createLandmarker().catch((e) => {
      console.warn("[teko] getSharedLandmarker falló:", e)
      return null
    })
  }
  return sharedLandmarkerPromise
}

/** Precarga el FaceLandmarker en paralelo (idempotente). Llamala en la pantalla previa. */
export function warmupFaceLandmarker(): void {
  void getSharedLandmarker()
}

/** Convierte el resultado de MediaPipe a las señales puras que consume la lógica de desafíos. */
function toSignals(res: FaceLandmarkerResult): LivenessSignals {
  const landmarks = res.faceLandmarks?.[0]
  if (!landmarks || landmarks.length === 0) {
    return {
      hasFace: false,
      yaw: 0,
      pitch: 0,
      blinkLeft: 0,
      blinkRight: 0,
      smile: 0,
      faceWidth: 0,
      cx: 0.5,
      cy: 0.5,
    }
  }
  const box = bboxFromLandmarks(landmarks)
  const matrix = res.facialTransformationMatrixes?.[0]?.data
  const { yaw, pitch } = matrix
    ? matrixToAngles(Array.from(matrix))
    : { yaw: 0, pitch: 0 }

  // Blendshapes → mapa por nombre de categoría.
  const cats = res.faceBlendshapes?.[0]?.categories ?? []
  const bs = (name: string): number =>
    cats.find((c) => c.categoryName === name)?.score ?? 0

  return {
    hasFace: true,
    yaw,
    pitch,
    blinkLeft: bs("eyeBlinkLeft"),
    blinkRight: bs("eyeBlinkRight"),
    smile: Math.max(bs("mouthSmileLeft"), bs("mouthSmileRight")),
    faceWidth: box?.width ?? 0,
    cx: box?.cx ?? 0.5,
    cy: box?.cy ?? 0.5,
  }
}

export function useFaceLandmarker(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onFrame: (s: LivenessSignals, video: HTMLVideoElement, ts: number) => void
): { status: LandmarkerStatus } {
  const [status, setStatus] = useState<LandmarkerStatus>("loading")
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(-1)
  const aliveRef = useRef(true)
  // El callback en ref: el loop usa siempre el último sin re-montar el efecto.
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  useEffect(() => {
    aliveRef.current = true
    let cancelled = false
    void getSharedLandmarker().then((lm) => {
      if (cancelled) return
      if (!lm) {
        setStatus("unavailable")
        return
      }
      landmarkerRef.current = lm
      setStatus("ready")
    })
    return () => {
      cancelled = true
      aliveRef.current = false
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      // Singleton de sesión: soltamos la referencia local, no cerramos el modelo.
      landmarkerRef.current = null
    }
  }, [])

  const tick = useCallback(() => {
    if (!aliveRef.current) return
    const lm = landmarkerRef.current
    const v = videoRef.current
    if (lm && v && v.readyState >= 2 && v.videoWidth > 0) {
      const ts = performance.now()
      if (ts > lastTsRef.current) {
        lastTsRef.current = ts
        try {
          const res = lm.detectForVideo(v, ts)
          onFrameRef.current(toSignals(res), v, ts)
        } catch {
          /* frame suelto: ignoramos y seguimos */
        }
      }
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

  return { status }
}
