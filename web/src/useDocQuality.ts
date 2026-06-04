import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import type { DocLiveVerdict } from "./messages"

/**
 * Heurística EN VIVO de la cédula (sin ML). Antes medía SOLO nitidez (varianza
 * Laplaciano) + brillo sobre el frame ENTERO → cualquier pared nítida disparaba
 * la captura (bug: auto-saca sin que haya documento dentro del óvalo).
 *
 * Ahora valida PRESENCIA + ENCUADRE REAL del documento dentro de la GUÍA (ROI),
 * además de nitidez/brillo:
 *
 *  1. ROI = la región de la guía rectangular (inset-[8%] en el preview).
 *  2. Densidad de bordes (gradiente Sobel) DENTRO del ROI → un documento real,
 *     con texto/foto/líneas, tiene bordes abundantes; una pared lisa casi no.
 *  3. FILL: que el documento LLENE la guía → exigimos bordes fuertes cerca de
 *     los 4 lados del ROI (el borde de la tarjeta / su contenido toca los bordes
 *     de la guía). Una escena de fondo no enmarca el ROI por los 4 lados.
 *  4. Nitidez (varianza Laplaciano) + brillo, como antes, pero sobre el ROI.
 *
 * Solo "good" cuando: {documento presente y encuadrado} ∧ {nítido} ∧ {brillo ok}.
 * Veredicto nuevo "no-doc" cuando no se detecta documento encuadrado → la UI
 * pide "Encuadrá el documento" y NO arranca la cuenta regresiva.
 *
 * El borde real / OCR lo valida el backend; acá frenamos el auto-disparo sin doc.
 */

// Lienzo de análisis. Subimos un poco la resolución vs. el viejo 160×100 para
// que los bordes cerca de los lados del ROI se midan con suficiente detalle.
const SAMPLE_W = 200
const SAMPLE_H = 130

// El ROI espeja la guía visual del preview: inset-[8%] (DocCapture.tsx). Si se
// cambia la guía, ajustar acá para mantenerlos alineados.
const ROI_INSET = 0.08

// --- Umbrales (grises 0..255). Calibrables en el dispositivo. ---------------
const BLUR_VAR = 90 // varianza Laplaciano por debajo → borrosa
const DARK_MEAN = 65 // brillo medio por debajo → oscura
const GLARE_MEAN = 205 // brillo medio por encima → sobre-expuesta/reflejo
const GLARE_HOT = 0.14 // fracción de píxeles "quemados" (>245) → reflejo puntual

// Densidad de bordes: fracción de píxeles del ROI con gradiente fuerte.
const EDGE_MAG = 36 // |∇| por encima → "borde" (Sobel sobre grises 0..255)
// Un documento real con texto/foto llena de bordes el ROI; una pared lisa no.
const EDGE_DENSITY_MIN = 0.06 // <6% de bordes en el ROI → no hay documento
// FILL: en cada banda lateral del ROI debe haber bordes (el doc toca/llena la
// guía). Si una banda está casi vacía, el doc no llena ese lado → no encuadrado.
const BAND_FRAC = 0.16 // ancho de cada banda lateral = 16% del ROI
const BAND_EDGE_MIN = 0.03 // <3% de bordes en una banda → ese lado está vacío

interface RoiStats {
  variance: number
  mean: number
  hot: number
  edgeDensity: number
  bandsFilled: number // cuántas de las 4 bandas (top/bottom/left/right) tienen doc
}

/**
 * Analiza SOLO el rectángulo ROI [x0,y0,x1,y1) (en coords del canvas chico).
 * Calcula brillo, varianza Laplaciano (nitidez), densidad de bordes (Sobel) y
 * cuántas de las 4 bandas perimetrales del ROI contienen bordes (fill).
 */
function analyzeRoi(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): RoiStats {
  const roiW = x1 - x0
  const roiH = y1 - y0
  // Escala de grises del frame completo (necesitamos vecinos para los kernels).
  const gray = new Float32Array(w * (y1 + 1))
  for (let y = 0; y <= y1; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
  }

  let sum = 0
  let hot = 0
  let lapSum = 0
  let lapSqSum = 0
  let lapN = 0
  let edgeCount = 0
  let edgeN = 0
  // Conteo de bordes por banda perimetral del ROI.
  const bandW = Math.max(2, Math.round(roiW * BAND_FRAC))
  const bandH = Math.max(2, Math.round(roiH * BAND_FRAC))
  const band = { top: 0, bottom: 0, left: 0, right: 0 }
  const bandTot = { top: 0, bottom: 0, left: 0, right: 0 }

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * w + x
      const g = gray[p]
      sum++
      if (g > 245) hot++
      // Laplaciano + Sobel solo en píxeles interiores (con vecinos válidos).
      if (x > x0 && x < x1 - 1 && y > y0 && y < y1 - 1) {
        const left = gray[p - 1]
        const right = gray[p + 1]
        const up = gray[p - w]
        const down = gray[p + w]
        const lap = 4 * g - left - right - up - down
        lapSum += lap
        lapSqSum += lap * lap
        lapN++
        // Sobel-ish gradiente (magnitud aprox |gx|+|gy|).
        const gx = Math.abs(right - left)
        const gy = Math.abs(down - up)
        const mag = gx + gy
        const isEdge = mag > EDGE_MAG
        if (isEdge) edgeCount++
        edgeN++
        // Bandas perimetrales (un píxel puede contar para más de una banda
        // en las esquinas; aceptable para una heurística de fill).
        if (y - y0 < bandH) {
          band.top += isEdge ? 1 : 0
          bandTot.top++
        }
        if (y1 - 1 - y < bandH) {
          band.bottom += isEdge ? 1 : 0
          bandTot.bottom++
        }
        if (x - x0 < bandW) {
          band.left += isEdge ? 1 : 0
          bandTot.left++
        }
        if (x1 - 1 - x < bandW) {
          band.right += isEdge ? 1 : 0
          bandTot.right++
        }
      }
    }
  }

  const mean = sum > 0 ? sumBrightness(data, w, x0, y0, x1, y1) / sum : 0
  const lapMean = lapN > 0 ? lapSum / lapN : 0
  const variance = lapN > 0 ? lapSqSum / lapN - lapMean * lapMean : 0
  const edgeDensity = edgeN > 0 ? edgeCount / edgeN : 0

  const filled = (c: number, t: number) => (t > 0 && c / t >= BAND_EDGE_MIN ? 1 : 0)
  const bandsFilled =
    filled(band.top, bandTot.top) +
    filled(band.bottom, bandTot.bottom) +
    filled(band.left, bandTot.left) +
    filled(band.right, bandTot.right)

  return { variance, mean, hot: hot / Math.max(1, sum), edgeDensity, bandsFilled }
}

/** Brillo medio del ROI (separado para no inflar el cálculo de bandas). */
function sumBrightness(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let s = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
  }
  return s
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

    // ROI = guía (inset). Coords enteras dentro del canvas chico.
    const x0 = Math.round(SAMPLE_W * ROI_INSET)
    const y0 = Math.round(SAMPLE_H * ROI_INSET)
    const x1 = SAMPLE_W - x0
    const y1 = SAMPLE_H - y0

    const sample = () => {
      const v = videoRef.current
      if (ctx && v && v.readyState >= 2 && v.videoWidth > 0) {
        try {
          ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H)
          const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H)
          const s = analyzeRoi(data, SAMPLE_W, x0, y0, x1, y1)
          // Orden de gating (el primero que falla manda el feedback):
          // 1) Brillo: ni quemado ni oscuro (no sirve ningún encuadre).
          if (s.mean > GLARE_MEAN || s.hot > GLARE_HOT) setVerdict("glare")
          else if (s.mean < DARK_MEAN) setVerdict("dark")
          // 2) PRESENCIA + FILL del documento dentro de la guía. Sin esto NO
          //    capturamos (este es el fix del bug de auto-disparo sin doc).
          //    Exigimos densidad de bordes global + que el doc llene ≥3 lados.
          else if (s.edgeDensity < EDGE_DENSITY_MIN || s.bandsFilled < 3)
            setVerdict("no-doc")
          // 3) Nitidez del documento ya encuadrado.
          else if (s.variance < BLUR_VAR) setVerdict("blurry")
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
