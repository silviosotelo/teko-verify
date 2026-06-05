import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import { loadOpenCV, type CV } from "./opencv"
import type { DocLiveVerdict } from "./messages"

/**
 * Detector GEOMÉTRICO REAL del documento con OpenCV.js (reemplaza la vieja
 * heurística de luz/bordes que un teclado o una pared engañaban).
 *
 * Por frame (a baja resolución + throttle ~8fps para no trabar el teléfono):
 *   gris → blur → Canny → findContours → approxPolyDP a 4 vértices → elige el
 *   MAYOR cuadrilátero CONVEXO. Luego valida que sea un documento real:
 *
 *   1. FILL: el quad cubre ≥ AREA_MIN del recuadro guía.
 *   2. ESQUINAS alineadas a las del marco (cada vértice cerca de una esquina
 *      de la guía) → el doc "llena" la guía, no es un rectángulo cualquiera.
 *   3. PROPORCIÓN tipo tarjeta ID-1 (~1.585) tolerante a perspectiva.
 *   4. NITIDEZ (varianza del Laplaciano) dentro del quad.
 *
 * Veredicto:
 *   - "good"   → quad válido, lleno, proporción ok y nítido → la UI dispara la
 *                cuenta regresiva (igual contrato que antes con useDocQuality).
 *   - "no-doc" → no hay quad → reacquire + "poné la cédula en el marco".
 *   - intermedios ("partial"/"far"/"tilt"/"blurry"/"glare"/"dark") → coaching,
 *     NO disparan y NO cuentan como ausencia (no son ni good ni no-doc).
 *
 * Devuelve también `quad` (4 puntos NORMALIZADOS [0..1] sobre el frame del
 * video) para dibujar el contorno en vivo, y `status` de carga del detector.
 *
 * Un teclado/pared: o NO forma un quad de 4 vértices convexo que llene la guía,
 * o no tiene proporción de tarjeta → jamás llega a "good". Fail-closed.
 */

export type DocDetStatus = "loading" | "ready" | "unavailable"

export interface QuadPt {
  x: number
  y: number
}
// Quad NORMALIZADO [0..1] en coords del frame del video (no del canvas chico).
export type Quad = [QuadPt, QuadPt, QuadPt, QuadPt]

// Resolución de análisis. Suficiente para bordes; barato para el loop.
const SAMPLE_W = 320
const SAMPLE_H = 202 // ~1.586:1, el mismo aspecto del recuadro guía

// El ROI/guía espeja inset-[8%] del preview (DocCapture). Lo usamos para medir
// "fill" y proximidad de esquinas. Si cambia la guía, ajustar acá.
const GUIDE_INSET = 0.08

// --- Umbrales de gating (calibrables) --------------------------------------
// El quad debe cubrir al menos esta fracción del ÁREA DE LA GUÍA.
const AREA_FILL_MIN = 0.55
// Cada vértice del quad debe estar a ≤ esta fracción de la diagonal de la guía
// de la esquina de guía más cercana (alineación de esquinas).
const CORNER_TOL = 0.22
// FRAME-EDGE: un documento sostenido frente a la cámara deja FONDO alrededor;
// su cuadrilátero NO toca los bordes absolutos del frame. Un teclado/pared/
// pantalla que llena TODO el cuadro forma un quad pegado a los bordes (y, como
// el frame es ~1.586, hasta engaña la proporción). Exigimos que cada vértice
// esté INSET al menos esta fracción del borde del frame → rechaza "todo-cuadro".
// La guía está a 8% de inset, así que una cédula bien encuadrada (que llena la
// guía, con fondo afuera) cumple holgado; el full-frame (vértices ~0%/100%) no.
const EDGE_INSET_MIN = 0.035
// Proporción ID-1 = 85.6/53.98 ≈ 1.585. Tolerante a perspectiva.
const ASPECT_TARGET = 1.585
const ASPECT_TOL = 0.45 // ratio admitido: ~1.14 .. 2.03 (perspectiva/rotación)
// Nitidez: varianza del Laplaciano dentro del quad por debajo → borrosa.
const BLUR_VAR = 55
// Brillo medio del quad (0..255).
const DARK_MEAN = 55
const GLARE_HOT = 0.16 // fracción de píxeles quemados (>245) → reflejo
// Área mínima de contorno (en px² del canvas chico) para considerarlo candidato.
const MIN_CONTOUR_AREA = SAMPLE_W * SAMPLE_H * 0.12

interface Analysis {
  verdict: DocLiveVerdict
  quad: Quad | null
}

/** Distancia euclídea entre dos puntos (px del canvas chico). */
function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

/**
 * Ordena 4 puntos como TL, TR, BR, BL (por suma y diferencia de coords).
 */
function orderQuad(pts: QuadPt[]): QuadPt[] {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y))
  const tl = bySum[0]
  const br = bySum[3]
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x))
  const tr = byDiff[0]
  const bl = byDiff[3]
  return [tl, tr, br, bl]
}

/**
 * Detecta el documento en el frame del canvas chico (data RGBA) y emite el
 * veredicto + quad normalizado. Toda la matemática OpenCV vive acá.
 */
function analyze(cv: CV, src: CV): Analysis {
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)
    cv.Canny(blurred, edges, 50, 150)
    // Dilatar un poco para cerrar bordes del documento (texto interrumpe líneas).
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    cv.dilate(edges, edges, k)
    k.delete()
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    )

    // Geometría de la guía (en px del canvas chico).
    const gx0 = SAMPLE_W * GUIDE_INSET
    const gy0 = SAMPLE_H * GUIDE_INSET
    const gx1 = SAMPLE_W - gx0
    const gy1 = SAMPLE_H - gy0
    const guideArea = (gx1 - gx0) * (gy1 - gy0)
    const guideDiag = dist(gx0, gy0, gx1, gy1)
    const guideCorners = [
      { x: gx0, y: gy0 },
      { x: gx1, y: gy0 },
      { x: gx1, y: gy1 },
      { x: gx0, y: gy1 },
    ]

    let best: { pts: QuadPt[]; area: number } | null = null
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const area = cv.contourArea(cnt)
      if (area < MIN_CONTOUR_AREA) {
        cnt.delete()
        continue
      }
      const peri = cv.arcLength(cnt, true)
      const approx = new cv.Mat()
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true)
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts: QuadPt[] = []
        for (let j = 0; j < 4; j++) {
          pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
        }
        if (!best || area > best.area) best = { pts, area }
      }
      approx.delete()
      cnt.delete()
    }

    if (!best) return { verdict: "no-doc", quad: null }

    const ordered = orderQuad(best.pts)
    const [tl, tr, br, bl] = ordered
    const normQuad: Quad = [
      { x: tl.x / SAMPLE_W, y: tl.y / SAMPLE_H },
      { x: tr.x / SAMPLE_W, y: tr.y / SAMPLE_H },
      { x: br.x / SAMPLE_W, y: br.y / SAMPLE_H },
      { x: bl.x / SAMPLE_W, y: bl.y / SAMPLE_H },
    ]

    // 0) ANTI-"todo-cuadro": si el quad toca los bordes del frame, es la escena
    //    entera (teclado/pared/pantalla), no un documento sostenido con fondo.
    //    Rechazamos como "no-doc" (no hay documento real encuadrado).
    const exMin = SAMPLE_W * EDGE_INSET_MIN
    const eyMin = SAMPLE_H * EDGE_INSET_MIN
    const touchesFrame = ordered.some(
      (p) =>
        p.x < exMin ||
        p.x > SAMPLE_W - exMin ||
        p.y < eyMin ||
        p.y > SAMPLE_H - eyMin,
    )
    if (touchesFrame) return { verdict: "no-doc", quad: null }

    // 1) FILL por área respecto de la guía.
    const fill = best.area / guideArea
    if (fill < AREA_FILL_MIN) return { verdict: "partial", quad: normQuad }

    // 2) ESQUINAS alineadas con las de la guía.
    let cornersOk = true
    for (let c = 0; c < 4; c++) {
      const p = ordered[c]
      const g = guideCorners[c]
      if (dist(p.x, p.y, g.x, g.y) / guideDiag > CORNER_TOL) {
        cornersOk = false
        break
      }
    }
    if (!cornersOk) return { verdict: "partial", quad: normQuad }

    // 3) PROPORCIÓN tipo tarjeta (lados promedio).
    const wTop = dist(tl.x, tl.y, tr.x, tr.y)
    const wBot = dist(bl.x, bl.y, br.x, br.y)
    const hLeft = dist(tl.x, tl.y, bl.x, bl.y)
    const hRight = dist(tr.x, tr.y, br.x, br.y)
    const wAvg = (wTop + wBot) / 2
    const hAvg = (hLeft + hRight) / 2
    const ratio = hAvg > 0 ? Math.max(wAvg, hAvg) / Math.min(wAvg, hAvg) : 0
    if (Math.abs(ratio - ASPECT_TARGET) > ASPECT_TOL)
      return { verdict: "tilt", quad: normQuad }

    // 4) NITIDEZ + brillo dentro del bounding box del quad (sobre gris).
    const minX = Math.max(0, Math.floor(Math.min(tl.x, bl.x)))
    const maxX = Math.min(SAMPLE_W, Math.ceil(Math.max(tr.x, br.x)))
    const minY = Math.max(0, Math.floor(Math.min(tl.y, tr.y)))
    const maxY = Math.min(SAMPLE_H, Math.ceil(Math.max(bl.y, br.y)))
    const roi = gray.roi(
      new cv.Rect(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY)),
    )
    const lap = new cv.Mat()
    const mean = new cv.Mat()
    const stddev = new cv.Mat()
    cv.Laplacian(roi, lap, cv.CV_64F)
    cv.meanStdDev(lap, mean, stddev)
    const sd = stddev.doubleAt(0, 0)
    const variance = sd * sd
    // Brillo + quemados.
    const m = cv.mean(roi)
    const brightness = m[0]
    // Contar píxeles quemados (>245).
    const hotMask = new cv.Mat()
    cv.threshold(roi, hotMask, 245, 255, cv.THRESH_BINARY)
    const hotFrac = cv.countNonZero(hotMask) / (roi.rows * roi.cols)
    roi.delete()
    lap.delete()
    mean.delete()
    stddev.delete()
    hotMask.delete()

    if (brightness < DARK_MEAN) return { verdict: "dark", quad: normQuad }
    if (hotFrac > GLARE_HOT) return { verdict: "glare", quad: normQuad }
    if (variance < BLUR_VAR) return { verdict: "blurry", quad: normQuad }

    return { verdict: "good", quad: normQuad }
  } finally {
    gray.delete()
    blurred.delete()
    edges.delete()
    contours.delete()
    hierarchy.delete()
  }
}

/**
 * Wrapper testeable/headless: clasifica UN frame (ImageData) con OpenCV ya
 * cargado, sin cámara. Usado por la verificación con frames estáticos (teclado
 * vs. cédula) para probar el gating sin depender de la cámara falsa.
 */
export function classifyFrame(
  cv: CV,
  imageData: ImageData,
): { verdict: DocLiveVerdict; quad: Quad | null } {
  const src = cv.matFromImageData(imageData)
  try {
    return analyze(cv, src)
  } finally {
    src.delete()
  }
}

export function useDocDetector(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  const [status, setStatus] = useState<DocDetStatus>("loading")
  const [verdict, setVerdict] = useState<DocLiveVerdict>("loading")
  const [quad, setQuad] = useState<Quad | null>(null)

  const cvRef = useRef<CV | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const aliveRef = useRef(true)

  // Carga perezosa del runtime OpenCV (una vez, al entrar a la pantalla).
  useEffect(() => {
    let cancelled = false
    setStatus("loading")
    loadOpenCV()
      .then((cv) => {
        if (cancelled) return
        cvRef.current = cv
        setStatus("ready")
      })
      .catch(() => {
        if (cancelled) return
        // Fail-closed sin colgar: degradamos a captura manual.
        setStatus("unavailable")
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Loop de detección sobre el <video>.
  useEffect(() => {
    if (!enabled || status !== "ready") {
      if (status !== "ready") setVerdict("loading")
      return
    }
    aliveRef.current = true
    const cv = cvRef.current
    if (!cv) return

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
      try {
        ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H)
        const img = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H)
        const src = cv.matFromImageData(img)
        try {
          const { verdict: vd, quad: q } = analyze(cv, src)
          setVerdict(vd)
          setQuad(q)
        } finally {
          src.delete()
        }
      } catch {
        /* frame suelto: ignoramos */
      }
    }

    // ~6fps: throttle dentro de un único rAF (cada frame de OpenCV —cvtColor,
    // blur, Canny, findContours, Laplacian a 320×202— es caro; a más fps el hilo
    // principal del teléfono se satura y la cámara/overlay se traban). 6fps entra
    // holgado en el rango pedido (6–10fps) y deja respirar al render.
    let last = 0
    const loop = (t: number) => {
      if (!aliveRef.current) return
      if (t - last > 160) {
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
  }, [enabled, status, videoRef])

  return { status, verdict, quad }
}
