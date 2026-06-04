/**
 * Mensajes amables — PORTADOS TAL CUAL del HTML vanilla (web/dist/index.html).
 * Mapean los códigos `reasons` reales que devuelven los módulos quality.ts y
 * el endpoint /doc-check a textos humanos en español.
 */
import type { QualityResult } from "./api"

export const QUALITY_MSG: Record<string, string> = {
  glasses: "Quitate los anteojos y volvé a intentar 🙂",
  blur: "La foto salió movida. Sostené firme el teléfono.",
  over_exposed: "Hay demasiada luz o reflejo. Probá en otro lugar.",
  low_light: "Necesitamos un poco más de luz.",
  off_pose: "Mirá de frente a la cámara.",
  no_face: "No detectamos bien tu rostro. Centralo en el óvalo.",
  align_failed: "No detectamos bien tu rostro. Centralo en el óvalo.",
}

// Reasons que el usuario NO puede corregir → no tiene sentido bloquearlo.
export const QUALITY_NON_ACTIONABLE = [
  "glasses_model_unavailable",
  "quality_error",
]

export interface QualityVerdict {
  advance: boolean
  msg?: string
}

/** Decide si la calidad de la selfie permite avanzar, y si no, qué tip mostrar. */
export function evalQuality(quality?: QualityResult): QualityVerdict {
  if (!quality || quality.passed) return { advance: true }
  const reasons = Array.isArray(quality.reasons) ? quality.reasons : []
  const actionable = reasons.filter(
    (r) => !QUALITY_NON_ACTIONABLE.includes(r),
  )
  if (actionable.length === 0) return { advance: true }
  const msg =
    QUALITY_MSG[actionable[0]] ||
    "Probá sacarte la selfie de nuevo, con buena luz y de frente."
  return { advance: false, msg }
}

/**
 * Copy en vivo del encuadre facial (auto-captura selfie). Mapea cada veredicto
 * del FaceDetector a un mensaje ACCIONABLE y corto. Mostrado dentro del óvalo.
 */
import type { FrameVerdict } from "./useFaceDetector"

export const FACE_LIVE_MSG: Record<FrameVerdict, string> = {
  loading: "Preparando la cámara…",
  "no-camera": "Iniciando cámara…",
  "no-face": "Ubicá tu rostro en el óvalo",
  multiple: "Que aparezca un solo rostro",
  "too-far": "Acercate un poco",
  "too-close": "Alejate un poco",
  "off-center": "Centrate en el óvalo",
  "low-confidence": "Buscá un lugar con más luz",
  good: "Perfecto, no te muevas",
}

/**
 * Copy en vivo del encuadre de la cédula (auto-captura por nitidez + brillo).
 */
export type DocLiveVerdict =
  | "loading"
  | "no-camera"
  | "blurry"
  | "glare"
  | "dark"
  | "good"

export const DOC_LIVE_MSG: Record<DocLiveVerdict, string> = {
  loading: "Preparando la cámara…",
  "no-camera": "Iniciando cámara…",
  blurry: "Acercá la cédula y mantené firme",
  glare: "Hay reflejo, movela un poco",
  dark: "Necesitamos un poco más de luz",
  good: "Perfecto, no te muevas",
}

export const DOC_MSG: Record<string, string> = {
  blurry:
    "La cédula salió borrosa. Acercala un poco y mantené firme el teléfono.",
  no_doc_face:
    "No se ve bien el frente de la cédula. Que entre completa, con la foto visible.",
  mrz_unreadable:
    "No podemos leer el dorso. Que se vean las líneas de abajo, sin reflejos.",
}

export function docMsg(reasons?: string[]): string {
  const r = Array.isArray(reasons) ? reasons : []
  for (const k of r) {
    if (DOC_MSG[k]) return DOC_MSG[k]
  }
  return "Probá la foto de la cédula de nuevo, enfocada y sin reflejos."
}
