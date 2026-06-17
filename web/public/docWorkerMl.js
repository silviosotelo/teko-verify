/* eslint-disable */
/**
 * Web Worker CLÁSICO del detector ML de documento (DocAligner / onnxruntime-web).
 *
 * POR QUÉ ML: el detector geométrico OpenCV (docWorker.js) localiza el documento
 * buscando el MAYOR cuadrilátero convexo por Canny/findContours. Eso falla con
 * fondos con bordes (teclados, baldosas) y con cédulas de bajo contraste. Este
 * worker reemplaza ESE paso por DocAligner (DocsaidLab, Apache-2.0): una red ONNX
 * preentrenada que regresiona las 4 ESQUINAS del documento (point/lcnet050) +
 * un score `has_obj`. Validado sobre cédulas PY reales (IoU ~0.97 sintético,
 * has_obj<0.5 en teclado/pared/ruido). El GATING geométrico (relleno/esquinas/
 * proporción/nitidez/brillo/reflejo) queda IDÉNTICO como post-filtro → mismo
 * contrato {status, verdict, quad}.
 *
 * Es un worker CLÁSICO (NO module) a propósito, igual que docWorker.js: onnxruntime
 * se carga con `importScripts(ortrt.wasm.min.js)` (UMD → expone self.ortrt). El wasm
 * runtime se sirve same-origin desde public/ortrt/ (sin CDN). Single-thread (sin
 * SharedArrayBuffer) para no exigir COOP/COEP en el túnel.
 *
 * Protocolo (postMessage) — ESPEJO de docWorker.js:
 *   main → worker:
 *     { type:"init", ortUrl, modelUrl, wasmBase }  carga ortrt + crea sesión ONNX
 *     { type:"frame", id, imageData }              analiza un frame (320x202 RGBA)
 *   worker → main:
 *     { type:"ready" }                             modelo cargado, listo
 *     { type:"error", error }                      falló (degradar / fallback)
 *     { type:"result", id, verdict, quad }
 *
 * El gating (umbrales, anti-todo-cuadro, proporción, nitidez) es IDÉNTICO al de
 * docAnalyze.ts / docWorker.js — reimplementado acá en JS plano SIN OpenCV
 * (Laplaciano/brillo/reflejo a mano sobre el ImageData). Si cambia uno, cambiar
 * los tres. Fail-closed.
 */

const SAMPLE_W = 320
const SAMPLE_H = 202
const GUIDE_INSET = 0.08
const AREA_FILL_MIN = 0.55
const CORNER_TOL = 0.22
const EDGE_INSET_MIN = 0.035
const ASPECT_TARGET = 1.585
const ASPECT_TOL = 0.45
const BLUR_VAR = 55
const DARK_MEAN = 55
const GLARE_HOT = 0.16
// Umbral de presencia de documento de DocAligner (mismo que el postprocess del
// paquete docaligner-docsaid: has_obj > 0.5 ⇒ hay documento).
const HAS_OBJ_MIN = 0.5
// Lado de entrada de la red (lcnet050 = 256x256, resize SIN preservar aspecto,
// igual que el preprocess del paquete).
const INFER_SIZE = 256

let ortrt = null
let session = null
let busy = false
// Canvas reusable para el resize a 256x256 (preprocess de la red).
let infCanvas = null
let infCtx = null

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

/** Luminancia (idéntica a cv.COLOR_RGBA2GRAY) del ImageData → Float32 plano. */
function toGray(imageData) {
  const { data, width, height } = imageData
  const gray = new Float32Array(width * height)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return gray
}

/**
 * Stats de nitidez/brillo/reflejo sobre el ROI (bbox del quad) del frame gris.
 * Reproduce: Laplaciano CV_64F (kernel [[0,1,0],[1,-4,1],[0,1,0]]) → varianza,
 * media (brillo), fracción de píxeles >245 (reflejo). SIN OpenCV.
 */
function roiStats(gray, minX, minY, maxX, maxY) {
  const x0 = Math.max(1, minX)
  const y0 = Math.max(1, minY)
  const x1 = Math.min(SAMPLE_W - 1, maxX)
  const y1 = Math.min(SAMPLE_H - 1, maxY)
  let n = 0
  let sum = 0
  let hot = 0
  let lapSum = 0
  let lapSqSum = 0
  let lapN = 0
  for (let y = y0; y < y1; y++) {
    const row = y * SAMPLE_W
    for (let x = x0; x < x1; x++) {
      const g = gray[row + x]
      sum += g
      if (g > 245) hot++
      n++
      // Laplaciano 4-vecinos.
      const lap =
        gray[row + x - 1] +
        gray[row + x + 1] +
        gray[row - SAMPLE_W + x] +
        gray[row + SAMPLE_W + x] -
        4 * g
      lapSum += lap
      lapSqSum += lap * lap
      lapN++
    }
  }
  if (n === 0 || lapN === 0) {
    return { brightness: 0, hotFrac: 1, variance: 0 }
  }
  const mean = lapSum / lapN
  const variance = lapSqSum / lapN - mean * mean
  return { brightness: sum / n, hotFrac: hot / n, variance }
}

/** Preprocess: ImageData (320x202 RGBA) → Float32 tensor CHW [1,3,256,256] /255. */
function preprocess(imageData) {
  if (!infCanvas) {
    infCanvas = new OffscreenCanvas(INFER_SIZE, INFER_SIZE)
    infCtx = infCanvas.getContext("2d", { willReadFrequently: true })
  }
  // El ImageData no se puede escalar directo: lo pasamos por un canvas de origen.
  // Reusar un bitmap es caro; dibujamos vía putImageData en un canvas temporal
  // del tamaño del frame y luego drawImage escalando a 256x256.
  const tmp = new OffscreenCanvas(imageData.width, imageData.height)
  const tctx = tmp.getContext("2d")
  tctx.putImageData(imageData, 0, 0)
  infCtx.drawImage(tmp, 0, 0, INFER_SIZE, INFER_SIZE)
  const rgba = infCtx.getImageData(0, 0, INFER_SIZE, INFER_SIZE).data
  const area = INFER_SIZE * INFER_SIZE
  const out = new Float32Array(3 * area)
  for (let i = 0, p = 0; p < area; i += 4, p++) {
    out[p] = rgba[i] / 255 // R
    out[area + p] = rgba[i + 1] / 255 // G
    out[2 * area + p] = rgba[i + 2] / 255 // B
  }
  return out
}

/** Gating geométrico + de calidad sobre el quad normalizado (0..1). */
function gate(normPts, gray) {
  // A px del frame chico.
  const pxPts = normPts.map((p) => ({ x: p.x * SAMPLE_W, y: p.y * SAMPLE_H }))
  const ordered = orderQuad(pxPts)
  const [tl, tr, br, bl] = ordered
  const normQuad = [
    { x: tl.x / SAMPLE_W, y: tl.y / SAMPLE_H },
    { x: tr.x / SAMPLE_W, y: tr.y / SAMPLE_H },
    { x: br.x / SAMPLE_W, y: br.y / SAMPLE_H },
    { x: bl.x / SAMPLE_W, y: bl.y / SAMPLE_H },
  ]

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

  // 0) ANTI-"todo-cuadro": el quad no toca los bordes del frame.
  const exMin = SAMPLE_W * EDGE_INSET_MIN
  const eyMin = SAMPLE_H * EDGE_INSET_MIN
  const touchesFrame = ordered.some(
    (p) => p.x < exMin || p.x > SAMPLE_W - exMin || p.y < eyMin || p.y > SAMPLE_H - eyMin,
  )
  if (touchesFrame) return { verdict: "no-doc", quad: null }

  // Área del quad (shoelace) para el "fill".
  let a2 = 0
  for (let i = 0; i < 4; i++) {
    const p = ordered[i]
    const q = ordered[(i + 1) % 4]
    a2 += p.x * q.y - q.x * p.y
  }
  const area = Math.abs(a2) / 2

  // 1) FILL.
  const fill = area / guideArea
  if (fill < AREA_FILL_MIN) return { verdict: "partial", quad: normQuad }

  // 2) ESQUINAS alineadas a la guía.
  for (let c = 0; c < 4; c++) {
    if (dist(ordered[c].x, ordered[c].y, guideCorners[c].x, guideCorners[c].y) / guideDiag > CORNER_TOL) {
      return { verdict: "partial", quad: normQuad }
    }
  }

  // 3) PROPORCIÓN tipo ID-1.
  const wTop = dist(tl.x, tl.y, tr.x, tr.y)
  const wBot = dist(bl.x, bl.y, br.x, br.y)
  const hLeft = dist(tl.x, tl.y, bl.x, bl.y)
  const hRight = dist(tr.x, tr.y, br.x, br.y)
  const wAvg = (wTop + wBot) / 2
  const hAvg = (hLeft + hRight) / 2
  const ratio = hAvg > 0 ? Math.max(wAvg, hAvg) / Math.min(wAvg, hAvg) : 0
  if (Math.abs(ratio - ASPECT_TARGET) > ASPECT_TOL) return { verdict: "tilt", quad: normQuad }

  // 4) NITIDEZ + brillo + reflejo sobre el ROI.
  const minX = Math.floor(Math.min(tl.x, bl.x))
  const maxX = Math.ceil(Math.max(tr.x, br.x))
  const minY = Math.floor(Math.min(tl.y, tr.y))
  const maxY = Math.ceil(Math.max(bl.y, br.y))
  const { brightness, hotFrac, variance } = roiStats(gray, minX, minY, maxX, maxY)
  if (brightness < DARK_MEAN) return { verdict: "dark", quad: normQuad }
  if (hotFrac > GLARE_HOT) return { verdict: "glare", quad: normQuad }
  if (variance < BLUR_VAR) return { verdict: "blurry", quad: normQuad }

  return { verdict: "good", quad: normQuad }
}

async function handleFrame(id, imageData) {
  if (!session || busy) {
    // Sin sesión o ocupado: no encolamos (el main hace back-pressure de 1 frame).
    if (!busy) self.postMessage({ type: "result", id, verdict: "no-doc", quad: null })
    return
  }
  busy = true
  try {
    const gray = toGray(imageData)
    const input = preprocess(imageData)
    const tensor = new ortrt.Tensor("float32", input, [1, 3, INFER_SIZE, INFER_SIZE])
    const out = await session.run({ img: tensor })
    const points = out.points.data // Float32 [8], normalizado 0..1
    const hasObj = out.has_obj.data[0]
    if (hasObj < HAS_OBJ_MIN) {
      self.postMessage({ type: "result", id, verdict: "no-doc", quad: null })
      return
    }
    const normPts = [
      { x: points[0], y: points[1] },
      { x: points[2], y: points[3] },
      { x: points[4], y: points[5] },
      { x: points[6], y: points[7] },
    ]
    const { verdict, quad } = gate(normPts, gray)
    self.postMessage({ type: "result", id, verdict, quad })
  } catch (e) {
    self.postMessage({ type: "result", id, verdict: "no-doc", quad: null })
  } finally {
    busy = false
  }
}

self.onmessage = (ev) => {
  const msg = ev.data
  if (!msg) return
  if (msg.type === "init") {
    ;(async () => {
      try {
        importScripts(msg.ortUrl)
        // El bundle UMD declara el global `ort` (var ort=...). Lo leemos de self.
        ortrt = self.ort
        if (!ortrt) throw new Error("ort global no disponible tras importScripts")
        ortrt.env.wasm.wasmPaths = msg.wasmBase
        ortrt.env.wasm.numThreads = 1 // single-thread: no exige SharedArrayBuffer
        ortrt.env.wasm.simd = true
        session = await ortrt.InferenceSession.create(msg.modelUrl, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        })
        self.postMessage({ type: "ready" })
      } catch (e) {
        self.postMessage({ type: "error", error: String((e && e.message) || e) })
      }
    })()
    return
  }
  if (msg.type === "frame") {
    void handleFrame(msg.id, msg.imageData)
    return
  }
}
