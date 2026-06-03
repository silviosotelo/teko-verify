import { useCallback, useEffect, useRef, useState } from "react"

export interface CameraState {
  videoRef: React.RefObject<HTMLVideoElement | null>
  ready: boolean
  error: string | null
  facingMode: "user" | "environment"
  flip: () => void
  /** Capture current frame to a JPEG base64 (no data: prefix) at the video's
   *  native resolution. Returns null if not ready. */
  capture: () => { dataUrl: string; base64: string; width: number; height: number } | null
}

const captureCanvas = document.createElement("canvas")

export function useCamera(active: boolean): CameraState {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user")

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setReady(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!active) {
      stop()
      return
    }
    setError(null)
    setReady(false)

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "La cámara no está disponible. Requiere un contexto seguro (HTTPS o localhost).",
      )
      return
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          v.onloadedmetadata = () => {
            v.play()
              .then(() => setReady(true))
              .catch((e) => setError(String(e)))
          }
        }
      })
      .catch((e: DOMException) => {
        if (cancelled) return
        if (e.name === "NotAllowedError")
          setError("Permiso de cámara denegado.")
        else if (e.name === "NotFoundError")
          setError("No se encontró ninguna cámara.")
        else setError(`No se pudo abrir la cámara: ${e.message || e.name}`)
      })

    return () => {
      cancelled = true
      stop()
    }
  }, [active, facingMode, stop])

  const flip = useCallback(
    () => setFacingMode((m) => (m === "user" ? "environment" : "user")),
    [],
  )

  const capture = useCallback(() => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const w = v.videoWidth
    const h = v.videoHeight
    captureCanvas.width = w
    captureCanvas.height = h
    const ctx = captureCanvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, w, h)
    const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.92)
    return { dataUrl, base64: dataUrl.split(",")[1], width: w, height: h }
  }, [])

  return { videoRef, ready, error, facingMode, flip, capture }
}
