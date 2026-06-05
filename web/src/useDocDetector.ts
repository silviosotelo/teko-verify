import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import { SAMPLE_W, SAMPLE_H, type Quad } from "./docAnalyze"
import type { DocLiveVerdict } from "./messages"

/**
 * Detector GEOMÉTRICO del documento — orquestador del HILO PRINCIPAL.
 *
 * EL FIX ANTI-FREEZE: todo el trabajo pesado de OpenCV (cvtColor/Canny/
 * findContours/Laplacian) corre en un WEB WORKER (web/public/docWorker.js).
 * Antes corría sincrónicamente en el hilo principal a 6fps y, en un teléfono
 * modesto, saturaba el main thread → la UI (cámara, overlay y BOTONES) se
 * congelaba y el usuario quedaba TRABADO en "capturar el frente". Ahora el hilo
 * principal SOLO: captura el frame a un canvas chico (320px), lo manda al worker
 * (ImageData transferible) y dibuja el overlay con el quad que devuelve. La UI
 * nunca se freeza; el botón manual SIEMPRE responde.
 *
 * GARANTÍAS DE NO-TRABA (fail-open hacia manual, fail-closed en gating):
 *   - El preview y el botón manual funcionan desde el primer momento,
 *     independientemente del detector (esta lógica vive en DocCapture; acá solo
 *     exponemos `status`).
 *   - TIMEOUT de arranque (READY_TIMEOUT_MS ~7s): si opencv/worker no quedó
 *     listo, pasamos a status="unavailable" → DocCapture muestra "encuadrá y
 *     tocá el botón" con captura manual plena. NADA de quedar en "Preparando el
 *     detector…" para siempre. (opencv.js sigue cargando en background por si
 *     llega tarde, pero la UI ya no espera.)
 *   - Sin soporte de Worker → "unavailable" (degradar a manual, no crashear).
 *
 * Contrato de salida INTACTO: { status, verdict, quad } — DocCapture no cambia su
 * lógica de gating/cooldown/reacquire/kill-loop.
 */

export type DocDetStatus = "loading" | "ready" | "unavailable"
export type { Quad, QuadPt, CV } from "./docAnalyze"
// Re-export para compatibilidad: la verificación headless con frames estáticos
// importa classifyFrame desde acá. La impl vive en el módulo puro docAnalyze.
export { classifyFrame } from "./docAnalyze"

// Ruta self-hosted del runtime OpenCV (misma base "/app/" de Vite). Se la pasamos
// al worker por postMessage (no confiamos en import.meta.env dentro del worker).
const OPENCV_URL = `${import.meta.env.BASE_URL}opencv.js`
// Worker clásico servido same-origin desde public/ (base "/app/").
const WORKER_URL = `${import.meta.env.BASE_URL}docWorker.js`
// Si en ~7s el detector no está listo, degradamos a manual (no bloquear al
// usuario). opencv.js (~11MB) puede tardar por el túnel/celu: que NO trabe.
const READY_TIMEOUT_MS = 7000
// Throttle del envío de frames al worker (~6fps). El worker procesa de a uno.
const FRAME_INTERVAL_MS = 160

export function useDocDetector(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  const [status, setStatus] = useState<DocDetStatus>("loading")
  const [verdict, setVerdict] = useState<DocLiveVerdict>("loading")
  const [quad, setQuad] = useState<Quad | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const readyRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const aliveRef = useRef(true)
  // Hay como mucho UN frame en vuelo en el worker (back-pressure): no inundamos.
  const inFlightRef = useRef(false)
  const frameIdRef = useRef(0)

  // --- Arranque del worker + carga de OpenCV (una vez, al entrar a la pantalla)
  useEffect(() => {
    let timedOut = false
    setStatus("loading")
    readyRef.current = false

    // Sin soporte de Worker → degradar a manual (no crashear).
    if (typeof Worker === "undefined") {
      setStatus("unavailable")
      return
    }

    let worker: Worker
    try {
      worker = new Worker(WORKER_URL) // CLÁSICO (no { type:"module" }): usa importScripts
    } catch {
      setStatus("unavailable")
      return
    }
    workerRef.current = worker

    // Timeout de arranque: si no llegó "ready", caemos a manual. El worker sigue
    // vivo y cargando por si termina tarde, pero la UI NO espera más.
    const timer = setTimeout(() => {
      if (readyRef.current) return
      timedOut = true
      setStatus("unavailable")
    }, READY_TIMEOUT_MS)

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data
      if (!msg) return
      if (msg.type === "ready") {
        readyRef.current = true
        clearTimeout(timer)
        // Si ya habíamos caído a manual por timeout, NO volvemos atrás: el
        // usuario ya tiene la captura manual operativa; cambiar de UI ahora sería
        // peor. (El worker queda disponible pero ocioso.)
        if (!timedOut) setStatus("ready")
        return
      }
      if (msg.type === "error") {
        clearTimeout(timer)
        if (!readyRef.current) setStatus("unavailable")
        return
      }
      if (msg.type === "result") {
        inFlightRef.current = false
        // Descartamos resultados viejos si llegan fuera de orden.
        if (msg.id !== frameIdRef.current) return
        setVerdict(msg.verdict as DocLiveVerdict)
        setQuad((msg.quad as Quad | null) ?? null)
        return
      }
    }
    worker.onerror = () => {
      clearTimeout(timer)
      if (!readyRef.current) setStatus("unavailable")
    }

    worker.postMessage({ type: "init", url: new URL(OPENCV_URL, location.href).href })

    return () => {
      clearTimeout(timer)
      worker.terminate()
      workerRef.current = null
      readyRef.current = false
    }
  }, [])

  // --- Loop de muestreo: captura frame chico y lo manda al worker -------------
  useEffect(() => {
    if (!enabled || status !== "ready") {
      if (status !== "ready") setVerdict("loading")
      return
    }
    aliveRef.current = true
    const worker = workerRef.current
    if (!worker) return

    if (!canvasRef.current) {
      const c = document.createElement("canvas")
      c.width = SAMPLE_W
      c.height = SAMPLE_H
      canvasRef.current = c
    }
    const ctx = canvasRef.current.getContext("2d", { willReadFrequently: true })

    const sample = () => {
      const v = videoRef.current
      if (!ctx || !v || v.readyState < 2 || v.videoWidth === 0) {
        setVerdict("no-camera")
        return
      }
      // Back-pressure: si el worker aún no contestó el frame anterior, saltamos
      // este (mantiene la latencia baja y no encola trabajo).
      if (inFlightRef.current) return
      try {
        ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H)
        const img = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H)
        const id = ++frameIdRef.current
        inFlightRef.current = true
        // Transferimos el buffer del ImageData (zero-copy). El ctx reusa su propio
        // backing store, así que perder este buffer no afecta al canvas.
        worker.postMessage({ type: "frame", id, imageData: img }, [img.data.buffer])
      } catch {
        inFlightRef.current = false
        /* frame suelto: ignoramos */
      }
    }

    // ~6fps vía rAF + throttle. El trabajo pesado YA NO está acá (va al worker),
    // pero limitamos el ritmo de captura/transfer para no malgastar.
    let last = 0
    const loop = (t: number) => {
      if (!aliveRef.current) return
      if (t - last > FRAME_INTERVAL_MS) {
        last = t
        sample()
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      aliveRef.current = false
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      inFlightRef.current = false
    }
  }, [enabled, status, videoRef])

  return { status, verdict, quad }
}
