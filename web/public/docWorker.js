/* eslint-disable */
/**
 * Web Worker CLÁSICO del detector de documento (OpenCV.js).
 *
 * POR QUÉ: el análisis OpenCV por frame (cvtColor/Canny/findContours/Laplacian)
 * es PESADO. Corriéndolo en el hilo principal a 6fps, en un teléfono modesto
 * satura el main thread y CONGELA la UI (cámara, overlay y botones dejan de
 * responder → el usuario queda "trabado en capturar el frente"). Acá corre en un
 * worker: el hilo principal solo dibuja overlay y maneja la UI → nunca se freeza.
 *
 * Es un worker CLÁSICO (NO module) a propósito: este build de OpenCV.js es
 * Emscripten y se carga con `importScripts`, que NO existe en module workers.
 * El .wasm va EMBEBIDO como data-URI dentro de opencv.js → no hay locateFile.
 *
 * Protocolo (postMessage):
 *   main → worker:
 *     { type:"init", url }          carga opencv.js desde esa URL same-origin
 *     { type:"frame", id, imageData } analiza un frame (ImageData transferible)
 *   worker → main:
 *     { type:"ready" }              opencv inicializado, listo para frames
 *     { type:"error", error }       falló la carga (degradar a manual)
 *     { type:"result", id, verdict, quad }
 *
 * El gating (umbrales, anti-todo-cuadro, proporción, nitidez) es IDÉNTICO al de
 * docAnalyze.ts — duplicado acá en JS plano porque el worker no comparte el
 * bundle TS. Si cambia uno, cambiar el otro. Fail-closed.
 */

const SAMPLE_W = 320
const SAMPLE_H = 202
const GUIDE_INSET = 0.08
// Umbrales sincronizados con docAnalyze.ts (relajados 2026-06-17).
// AREA_FILL_MIN 0.55→0.42, CORNER_TOL 0.22→0.32, ASPECT_TOL 0.45→0.55.
const AREA_FILL_MIN = 0.42
const CORNER_TOL = 0.32
const EDGE_INSET_MIN = 0.035
const ASPECT_TARGET = 1.585
const ASPECT_TOL = 0.55
const BLUR_VAR = 55
const DARK_MEAN = 55
const GLARE_HOT = 0.16
const MIN_CONTOUR_AREA = SAMPLE_W * SAMPLE_H * 0.12

let cv = null

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by)
}

function orderQuad(pts) {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y))
  const tl = bySum[0]
  const br = bySum[3]
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x))
  const tr = byDiff[0]
  const bl = byDiff[3]
  return [tl, tr, br, bl]
}

function analyze(src) {
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
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

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

    let best = null
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const area = cv.contourArea(cnt)
      if (area < MIN_CONTOUR_AREA) {
        cnt.delete()
        continue
      }
      const peri = cv.arcLength(cnt, true)
      const approx = new cv.Mat()
      // 0.04 tolera las esquinas redondeadas de la cédula PY (~3mm radio) sin
      // aumentar falsos positivos (el resto de los checks filtran igual).
      cv.approxPolyDP(cnt, approx, 0.04 * peri, true)
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts = []
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
    const normQuad = [
      { x: tl.x / SAMPLE_W, y: tl.y / SAMPLE_H },
      { x: tr.x / SAMPLE_W, y: tr.y / SAMPLE_H },
      { x: br.x / SAMPLE_W, y: br.y / SAMPLE_H },
      { x: bl.x / SAMPLE_W, y: bl.y / SAMPLE_H },
    ]

    const exMin = SAMPLE_W * EDGE_INSET_MIN
    const eyMin = SAMPLE_H * EDGE_INSET_MIN
    const touchesFrame = ordered.some(
      (p) => p.x < exMin || p.x > SAMPLE_W - exMin || p.y < eyMin || p.y > SAMPLE_H - eyMin,
    )
    if (touchesFrame) return { verdict: "no-doc", quad: null }

    const fill = best.area / guideArea
    if (fill < AREA_FILL_MIN) return { verdict: "partial", quad: normQuad }

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

    const wTop = dist(tl.x, tl.y, tr.x, tr.y)
    const wBot = dist(bl.x, bl.y, br.x, br.y)
    const hLeft = dist(tl.x, tl.y, bl.x, bl.y)
    const hRight = dist(tr.x, tr.y, br.x, br.y)
    const wAvg = (wTop + wBot) / 2
    const hAvg = (hLeft + hRight) / 2
    const ratio = hAvg > 0 ? Math.max(wAvg, hAvg) / Math.min(wAvg, hAvg) : 0
    if (Math.abs(ratio - ASPECT_TARGET) > ASPECT_TOL) return { verdict: "tilt", quad: normQuad }

    const minX = Math.max(0, Math.floor(Math.min(tl.x, bl.x)))
    const maxX = Math.min(SAMPLE_W, Math.ceil(Math.max(tr.x, br.x)))
    const minY = Math.max(0, Math.floor(Math.min(tl.y, tr.y)))
    const maxY = Math.min(SAMPLE_H, Math.ceil(Math.max(bl.y, br.y)))
    const roi = gray.roi(new cv.Rect(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY)))
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

function handleFrame(id, imageData) {
  if (!cv) return
  let src = null
  try {
    src = cv.matFromImageData(imageData)
    const { verdict, quad } = analyze(src)
    self.postMessage({ type: "result", id, verdict, quad })
  } catch (e) {
    // Frame suelto / error transitorio: no rompemos el loop. Reportamos no-doc
    // para que el hilo principal no quede pegado a un veredicto viejo.
    self.postMessage({ type: "result", id, verdict: "no-doc", quad: null })
  } finally {
    if (src) src.delete()
  }
}

// Cola de frames pendientes hasta que opencv inicialice (normalmente vacía: el
// hilo principal no manda frames hasta recibir "ready").
self.onmessage = (ev) => {
  const msg = ev.data
  if (!msg) return
  if (msg.type === "init") {
    try {
      // Emscripten llama Module.onRuntimeInitialized cuando el wasm está listo.
      // Lo definimos ANTES de importScripts para no perder el callback.
      self.Module = {
        onRuntimeInitialized: () => {
          cv = self.cv
          self.postMessage({ type: "ready" })
        },
      }
      importScripts(msg.url)
      // Algunos builds resuelven sincrónicamente (cv.Mat ya existe).
      if (!cv && self.cv && typeof self.cv.Mat === "function") {
        cv = self.cv
        self.postMessage({ type: "ready" })
      }
    } catch (e) {
      self.postMessage({ type: "error", error: String((e && e.message) || e) })
    }
    return
  }
  if (msg.type === "frame") {
    handleFrame(msg.id, msg.imageData)
    return
  }
}
