import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import type { DocLiveVerdict } from "./messages"

/**
 * Heurística EN VIVO de calidad de la cédula (sin ML): mide NITIDEZ (varianza
 * del Laplaciano) y BRILLO medio sobre un canvas chico muestreado del <video>.
 * Devuelve un veredicto accionable para auto-captura por estabilidad.
 *
 * La detección de borde/encuadre REAL la hace el backend; acá basta con que la
 * imagen esté nítida y bien expuesta de forma estable.
 */

// Lienzo de análisis (downscale agresivo: barato y suficiente para varianza).
const SAMPLE_W = 160
const SAMPLE_H = 100

// Umbrales calibrados sobre el canvas 160×100 (grises 0..255).
// NOTA: calibrables en el dispositivo. Subimos BLUR_VAR para exigir nitidez
// REAL (la cédula bien enfocada y cerca supera holgado este umbral; una pared
// borrosa o el documento lejos no), evitando capturas prematuras.
const BLUR_VAR = 90 // varianza Laplaciano por debajo → borrosa
const DARK_MEAN = 65 // brillo medio por debajo → oscura
const GLARE_MEAN = 205 // brillo medio por encima → sobre-expuesta/reflejo
const GLARE_HOT = 0.14 // fracción de píxeles "quemados" (>245) → reflejo puntual

function analyze(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): { variance: number; mean: number; hot: number } {
  // Escala de grises + brillo medio + conteo de píxeles quemados.
  const gray = new Float32Array(w * h)
  let sum = 0
  let hot = 0
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    gray[p] = g
    sum += g
    if (g > 245) hot++
  }
  const mean = sum / (w * h)

  // Laplaciano 4-vecinos; acumulamos varianza de la respuesta.
  let lapSum = 0
  let lapSqSum = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
      lapSum += lap
      lapSqSum += lap * lap
      n++
    }
  }
  const lapMean = lapSum / n
  const variance = lapSqSum / n - lapMean * lapMean
  return { variance, mean, hot: hot / (w * h) }
}

export function useDocQuality(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  const [verdict, setVerdict] = useState<DocLiveVerdict>("loading")
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    if (!enabled) {
      setVerdict("loading")
      return
    }
    aliveRef.current = true
    if (!canvasRef.current) {
      const c = document.createElement("canvas")
      c.width = SAMPLE_W
      c.height = SAMPLE_H
      canvasRef.current = c
    }
    const ctx = canvasRef.current.getContext("2d", {
      willReadFrequently: true,
    })

    const sample = () => {
      const v = videoRef.current
      if (ctx && v && v.readyState >= 2 && v.videoWidth > 0) {
        try {
          // Muestreamos el frame entero a escala chica (la cédula ocupa el
          // centro; la varianza global responde bien a su nitidez).
          ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H)
          const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H)
          const { variance, mean, hot } = analyze(data, SAMPLE_W, SAMPLE_H)
          if (mean > GLARE_MEAN || hot > GLARE_HOT) setVerdict("glare")
          else if (mean < DARK_MEAN) setVerdict("dark")
          else if (variance < BLUR_VAR) setVerdict("blurry")
          else setVerdict("good")
        } catch {
          /* getImageData puede fallar puntualmente: ignoramos */
        }
      } else {
        setVerdict("no-camera")
      }
    }

    // ~12fps basta para esta heurística: throttle dentro de un único rAF.
    let last = 0
    const loop = (t: number) => {
      if (!aliveRef.current) return
      if (t - last > 80) {
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
    }
  }, [enabled, videoRef])

  return { verdict }
}
