import { useEffect, useRef, useState } from "react"
import { api, type DetectFace } from "./api"
import { useCamera } from "./useCamera"
import { C, Spinner } from "./ui"

interface Props {
  active: boolean
  /** If set, runs /v9/detect on an interval and draws boxes. */
  overlay?: boolean
  detectMs?: number
  cam: ReturnType<typeof useCamera>
}

// Live camera with optional face-box overlay. The overlay scales detector
// coords (in captured-frame pixels) to the displayed video size so boxes
// track faces regardless of CSS sizing.
export function CameraView({ active, overlay = true, detectMs = 450, cam }: Props) {
  const { videoRef, ready, error, facingMode } = cam
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [faces, setFaces] = useState<DetectFace[]>([])
  const facesRef = useRef<DetectFace[]>([])
  const busyRef = useRef(false)

  facesRef.current = faces

  // Throttled detection loop.
  useEffect(() => {
    if (!active || !overlay || !ready) {
      setFaces([])
      return
    }
    let stop = false
    const tick = async () => {
      if (stop) return
      if (!busyRef.current) {
        const cap = cam.capture()
        if (cap) {
          busyRef.current = true
          try {
            const r = await api.detect(cap.base64)
            if (!stop) setFaces(r.faces)
          } catch {
            /* transient */
          } finally {
            busyRef.current = false
          }
        }
      }
    }
    const id = setInterval(tick, detectMs)
    void tick()
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [active, overlay, ready, detectMs, cam])

  // Draw overlay scaled to displayed size.
  useEffect(() => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return
    const rect = v.getBoundingClientRect()
    c.width = rect.width
    c.height = rect.height
    const ctx = c.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    if (!v.videoWidth) return
    // object-fit: cover scaling
    const scale = Math.max(rect.width / v.videoWidth, rect.height / v.videoHeight)
    const offX = (rect.width - v.videoWidth * scale) / 2
    const offY = (rect.height - v.videoHeight * scale) / 2
    const mirror = facingMode === "user"
    for (const f of faces) {
      const { x, y, width, height } = f.bbox
      let dx = x * scale + offX
      const dy = y * scale + offY
      const dw = width * scale
      const dh = height * scale
      if (mirror) dx = rect.width - dx - dw
      ctx.strokeStyle = C.accent
      ctx.lineWidth = 2.5
      ctx.shadowColor = "rgba(34,211,238,0.6)"
      ctx.shadowBlur = 8
      const r = 10
      ctx.beginPath()
      ctx.moveTo(dx + r, dy)
      ctx.arcTo(dx + dw, dy, dx + dw, dy + dh, r)
      ctx.arcTo(dx + dw, dy + dh, dx, dy + dh, r)
      ctx.arcTo(dx, dy + dh, dx, dy, r)
      ctx.arcTo(dx, dy, dx + dw, dy, r)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }, [faces, videoRef, facingMode])

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "3 / 4",
        maxHeight: "56vh",
        background: "var(--bg-canvas)",
        borderRadius: 16,
        overflow: "hidden",
        border: `1px solid ${C.border}`,
      }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: facingMode === "user" ? "scaleX(-1)" : "none",
          display: ready ? "block" : "none",
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
      {!ready && !error && (
        <div style={center}>
          <Spinner size={28} />
          <span style={{ color: C.text3, marginTop: 10 }}>Abriendo cámara…</span>
        </div>
      )}
      {error && (
        <div style={{ ...center, padding: 24, textAlign: "center" }}>
          <i
            className="error-ico"
            style={{ fontSize: 30, color: C.error, marginBottom: 8 }}
          >
            ⚠
          </i>
          <span style={{ color: C.text2, fontSize: 14 }}>{error}</span>
        </div>
      )}
    </div>
  )
}

const center: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
}
