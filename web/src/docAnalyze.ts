/**
 * Análisis GEOMÉTRICO REAL del documento con OpenCV.js — módulo PURO (sin React).
 *
 * Toda la matemática (cv.Mat/Canny/findContours/approxPolyDP/Laplacian) vive
 * acá para poder correr en DOS contextos sin arrastrar React:
 *   1. El Web Worker (web/public/docWorker.js) — el camino de producción: el
 *      hilo principal NUNCA ejecuta esto, así la UI no se congela.
 *   2. La verificación headless con frames estáticos (classifyFrame): prueba el
 *      gating teclado-vs-cédula sin cámara.
 *
 * Por frame (a 320px + throttle ~6fps):
 *   gris → blur → Canny → findContours → approxPolyDP a 4 vértices → elige el
 *   MAYOR cuadrilátero CONVEXO. Luego valida que sea un documento real:
 *     1. FRAME-EDGE: el quad NO toca los bordes (rechaza "todo-cuadro").
 *     2. FILL: cubre ≥ AREA_FILL_MIN del recuadro guía.
 *     3. ESQUINAS alineadas a las del marco.
 *     4. PROPORCIÓN tipo tarjeta ID-1 (~1.585) tolerante a perspectiva.
 *     5. NITIDEZ (varianza del Laplaciano) + brillo + reflejos.
 *
 * Veredicto: "good" (dispara), "no-doc" (ausencia real), o intermedios de
 * coaching ("partial"/"tilt"/"blurry"/"glare"/"dark") que NO disparan ni cuentan
 * como ausencia. Un teclado/pared jamás llega a "good". Fail-closed.
 */

import type { DocLiveVerdict } from "./messages"

// OpenCV expone un global `cv`. No tenemos types: lo tratamos como any acotado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any

export interface QuadPt {
  x: number
  y: number
}
// Quad NORMALIZADO [0..1] en coords del frame del video (no del canvas chico).
export type Quad = [QuadPt, QuadPt, QuadPt, QuadPt]

// Resolución de análisis. Suficiente para bordes; barato para el loop.
export const SAMPLE_W = 320
export const SAMPLE_H = 202 // ~1.586:1, el mismo aspecto del recuadro guía

// El ROI/guía espeja inset-[8%] del preview (DocCapture). Lo usamos para medir
// "fill" y proximidad de esquinas. Si cambia la guía, ajustar acá.
const GUIDE_INSET = 0.08

// --- Umbrales de gating (calibrables) --------------------------------------
const AREA_FILL_MIN = 0.55
const CORNER_TOL = 0.22
const EDGE_INSET_MIN = 0.035
const ASPECT_TARGET = 1.585
const ASPECT_TOL = 0.45
const BLUR_VAR = 55
const DARK_MEAN = 55
const GLARE_HOT = 0.16
const MIN_CONTOUR_AREA = SAMPLE_W * SAMPLE_H * 0.12

export interface Analysis {
  verdict: DocLiveVerdict
  quad: Quad | null
}

/** Distancia euclídea entre dos puntos (px del canvas chico). */
function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

/** Ordena 4 puntos como TL, TR, BR, BL (por suma y diferencia de coords). */
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
 * Detecta el documento en el frame (cv.Mat RGBA) y emite veredicto + quad
 * normalizado. Toda la matemática OpenCV vive acá.
 */
export function analyze(cv: CV, src: CV): Analysis {
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)
    cv.Canny(blurred, edges, 50, 150)
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

    // 0) ANTI-"todo-cuadro".
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

    // 1) FILL.
    const fill = best.area / guideArea
    if (fill < AREA_FILL_MIN) return { verdict: "partial", quad: normQuad }

    // 2) ESQUINAS.
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

    // 3) PROPORCIÓN.
    const wTop = dist(tl.x, tl.y, tr.x, tr.y)
    const wBot = dist(bl.x, bl.y, br.x, br.y)
    const hLeft = dist(tl.x, tl.y, bl.x, bl.y)
    const hRight = dist(tr.x, tr.y, br.x, br.y)
    const wAvg = (wTop + wBot) / 2
    const hAvg = (hLeft + hRight) / 2
    const ratio = hAvg > 0 ? Math.max(wAvg, hAvg) / Math.min(wAvg, hAvg) : 0
    if (Math.abs(ratio - ASPECT_TARGET) > ASPECT_TOL)
      return { verdict: "tilt", quad: normQuad }

    // 4) NITIDEZ + brillo.
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
    const m = cv.mean(roi)
    const brightness = m[0]
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
