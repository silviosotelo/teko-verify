/**
 * Selección PURA del MEJOR frame para el match (sin React/DOM): durante los
 * momentos "de frente y centrado" el screen junta candidatos y los puntúa por
 * frontalidad (yaw≈0), tamaño del rostro y nitidez (varianza del Laplaciano). El
 * de mayor score es el selfie que se manda al backend (no un frame cualquiera).
 *
 * La nitidez es relativa al lote (se normaliza por el máximo de los candidatos),
 * porque la varianza del Laplaciano no está acotada y depende de la cámara.
 */

export interface FrameCandidate {
  /** yaw en grados (0 = de frente). */
  yaw: number
  /** ancho del rostro normalizado 0..1 (bbox/frame). */
  faceWidth: number
  /** nitidez (varianza del Laplaciano); mayor = más nítido. */
  sharpness: number
  /** dataURL JPEG del frame capturado (se arrastra, no se puntúa). */
  image: string
}

// Pesos de la combinación (suman 1). Frontalidad pesa más (es lo que el match exige).
export const W_FRONTAL = 0.4
export const W_SIZE = 0.25
export const W_SHARP = 0.35

/** Frontalidad 0..1: 1 cuando yaw=0, cae linealmente y llega a 0 a ±30°. */
export function frontalScore(yaw: number): number {
  return Math.max(0, 1 - Math.abs(yaw) / 30)
}

/** Tamaño 0..1: ideal ~0.5 del frame; cae al alejarse de esa banda. */
export function sizeScore(faceWidth: number): number {
  return Math.max(0, 1 - Math.abs(faceWidth - 0.5) / 0.35)
}

/**
 * Score combinado de un candidato. `maxSharpness` normaliza la nitidez al lote
 * (si 0, la componente de nitidez aporta 0). Resultado 0..1.
 */
export function scoreCandidate(c: FrameCandidate, maxSharpness: number): number {
  const sharp = maxSharpness > 0 ? Math.min(1, c.sharpness / maxSharpness) : 0
  return (
    W_FRONTAL * frontalScore(c.yaw) +
    W_SIZE * sizeScore(c.faceWidth) +
    W_SHARP * sharp
  )
}

/**
 * Índice del mejor candidato (-1 si la lista está vacía). Normaliza la nitidez por
 * el máximo del lote y elige el de mayor score combinado.
 */
export function pickBestFrame(cands: FrameCandidate[]): number {
  if (cands.length === 0) return -1
  const maxSharp = cands.reduce((m, c) => Math.max(m, c.sharpness), 0)
  let best = -1
  let bestScore = -Infinity
  cands.forEach((c, i) => {
    const s = scoreCandidate(c, maxSharp)
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  })
  return best
}
