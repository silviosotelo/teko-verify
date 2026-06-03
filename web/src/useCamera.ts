import { useCallback, useEffect, useRef, useState } from "react"

type Facing = "user" | "environment"

/**
 * Hook de cámara. PORTA la lógica del HTML vanilla:
 *  - getUserMedia con focusMode:"continuous" (top-level + advanced[]) y res 1920 ideal.
 *  - applyConstraints de autoenfoque en try/catch (best-effort).
 *  - grab(): captura un frame del <video> a dataURL JPEG 0.9.
 *
 * Maneja correctamente el ciclo de vida en React/StrictMode: para los tracks en
 * el cleanup del efecto y al desmontar, evitando streams duplicados o colgados.
 */
export function useCamera(facing: Facing) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setReady(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    stop()
    try {
      // La cámara trasera usa {exact:"environment"}; si el dispositivo no la
      // tiene, caemos a "environment" laxo. La frontal usa "user" directo.
      const facingMode: MediaTrackConstraints["facingMode"] =
        facing === "environment" ? { exact: "environment" } : facing
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          // focusMode no es estándar en los tipos DOM → cast controlado.
          ...({ focusMode: "continuous" } as Record<string, unknown>),
          advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
        },
        audio: false,
      }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch {
        // Fallback: environment laxo (algunos browsers rechazan {exact}).
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
      }
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      try {
        await track.applyConstraints({
          advanced: [
            { focusMode: "continuous" } as unknown as MediaTrackConstraintSet,
          ],
        })
      } catch {
        /* el browser no soporta focusMode: seguimos igual */
      }
      const v = videoRef.current
      if (v) {
        v.srcObject = stream
        await v.play()
        setReady(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [facing, stop])

  // Captura un frame del video actual como dataURL JPEG.
  const grab = useCallback((): string => {
    const v = videoRef.current
    if (!v) return ""
    const c = document.createElement("canvas")
    c.width = v.videoWidth || 1280
    c.height = v.videoHeight || 960
    const ctx = c.getContext("2d")
    if (ctx) ctx.drawImage(v, 0, 0, c.width, c.height)
    return c.toDataURL("image/jpeg", 0.9)
  }, [])

  // Abrir la cámara al montar / cambiar de facing; cerrar en cleanup.
  useEffect(() => {
    void start()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing])

  return { videoRef, grab, start, stop, error, ready }
}
