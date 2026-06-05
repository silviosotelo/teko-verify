/**
 * Carga PEREZOSA y SELF-HOSTED de OpenCV.js (wasm).
 *
 * On-prem / Ley 7593: NADA de CDN en runtime. El archivo `public/opencv.js`
 * (descargado en build-time) se sirve desde el MISMO origen en `/app/opencv.js`
 * (base "/app/" de Vite + express.static montado en "/app"). El .wasm va
 * EMBEBIDO como data-URI dentro de ese opencv.js, así que no hay un segundo
 * asset ni `locateFile` que resolver.
 *
 * Se carga UNA sola vez, recién cuando la pantalla de documento lo pide
 * (inyección de <script>, NO import npm → no entra al bundle principal). El
 * runtime wasm es asíncrono: resolvemos cuando `cv.onRuntimeInitialized` corre.
 *
 * Fail-closed con timeout: si no inicializa, rechazamos → la pantalla degrada a
 * captura manual sin quedar colgada en "preparando detector…".
 */

// OpenCV expone un global `cv`. No tenemos types: lo tratamos como any acotado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cv?: any
  }
}

// Ruta self-hosted (coincide con base "/app/" de Vite). Si la SPA se sirviera
// bajo otra base, este path la acompaña por usar import.meta.env.BASE_URL.
const OPENCV_URL = `${import.meta.env.BASE_URL}opencv.js`
// Si en ~25s no inicializó, lo damos por no disponible (degradar a manual).
const LOAD_TIMEOUT_MS = 25000

let loadPromise: Promise<CV> | null = null

/**
 * Carga OpenCV.js una vez y resuelve con el objeto `cv` ya inicializado.
 * Llamadas concurrentes/repetidas comparten la MISMA promesa.
 */
export function loadOpenCV(): Promise<CV> {
  if (loadPromise) return loadPromise

  loadPromise = new Promise<CV>((resolve, reject) => {
    // Ya estaba cargado e inicializado (navegación de ida y vuelta).
    if (window.cv && typeof window.cv.Mat === "function") {
      resolve(window.cv)
      return
    }

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      loadPromise = null // permitir reintento futuro
      reject(new Error("opencv_timeout"))
    }, LOAD_TIMEOUT_MS)

    const finish = (cv: CV) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(cv)
    }

    // OpenCV.js llama Module.onRuntimeInitialized cuando el wasm está listo.
    // Definimos el Module ANTES de cargar el script para no perder el callback.
    const w = window as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Module?: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cv?: any
    }

    // Tras cargar el <script>, el runtime wasm puede tardar en compilar. NO
    // tratamos `cv` como Promise: este build de OpenCV expone un Module de
    // Emscripten que es "thenable" pero NO una promesa real (cv.then().catch()
    // rompe). El único disparo confiable es Module.onRuntimeInitialized; si ya
    // está listo (cv.Mat existe) resolvemos directo.
    const onReady = () => {
      const cv = window.cv
      if (cv && typeof cv.Mat === "function") finish(cv)
      // Si aún no, esperamos el callback onRuntimeInitialized (abajo).
    }

    w.Module = {
      ...(w.Module ?? {}),
      onRuntimeInitialized: () => {
        // En este punto window.cv ya tiene la API (cv.Mat, etc.).
        finish(window.cv)
      },
    }

    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-teko-opencv]",
    )
    if (existing) {
      onReady()
      return
    }

    const script = document.createElement("script")
    script.src = OPENCV_URL
    script.async = true
    script.setAttribute("data-teko-opencv", "1")
    script.onload = onReady
    script.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      loadPromise = null
      reject(new Error("opencv_load_failed"))
    }
    document.body.appendChild(script)
  })

  return loadPromise
}
