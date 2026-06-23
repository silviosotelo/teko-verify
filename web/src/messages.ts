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
  no_face: "No detectamos bien tu rostro. Centralo en el círculo.",
  align_failed: "No detectamos bien tu rostro. Centralo en el círculo.",
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
  "no-face": "Ubicá tu rostro en el círculo",
  multiple: "Que aparezca un solo rostro",
  "too-far": "Acercate a la cámara",
  "too-close": "Alejate un poco",
  "off-center": "Centrate en el círculo",
  dark: "Necesitamos más luz",
  bright: "Hay demasiada luz",
  "off-pose": "Mirá de frente",
  "low-confidence": "Buscá un lugar con más luz",
  good: "Perfecto, no te muevas",
}

/**
 * Copy en vivo del encuadre de la cédula. Ahora alimentado por el detector
 * GEOMÉTRICO (OpenCV.js): `no-doc` = no hay cuadrilátero; `partial`/`tilt` =
 * hay quad pero no llena/alinea o no tiene proporción de tarjeta (coaching, no
 * dispara); `good` = documento real, lleno, derecho y nítido.
 */
export type DocLiveVerdict =
  | "loading"
  | "no-camera"
  | "no-doc"
  | "partial"
  | "tilt"
  | "blurry"
  | "glare"
  | "dark"
  | "good"

export const DOC_LIVE_MSG: Record<DocLiveVerdict, string> = {
  loading: "Preparando el detector…",
  "no-camera": "Iniciando cámara…",
  "no-doc": "Poné la cédula dentro del marco",
  partial: "Acercá y alineá las 4 esquinas",
  tilt: "Enderezá la cédula dentro del marco",
  blurry: "Mantené quieto, que quede nítida",
  glare: "Hay reflejo, movela un poco",
  dark: "Necesitamos un poco más de luz",
  good: "Perfecto ✓ no te muevas",
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

/**
 * Mapa de CÓDIGOS de error del backend (j.error) → mensajes humanos en español.
 * Antes, el usuario veía el code crudo ("invalid_token", "preview_not_review",
 * etc.). Estos textos cubren todos los `error` que devuelve src/api/capture.ts.
 */
export const ERROR_MSG: Record<string, string> = {
  invalid_token: "Este enlace no es válido. Pedí uno nuevo a quien te lo envió.",
  token_consumed: "Este enlace ya se usó. Pedí uno nuevo para volver a intentar.",
  expired: "El enlace expiró. Pedí uno nuevo para verificar tu identidad.",
  session_terminal: "Esta verificación ya finalizó. Pedí un enlace nuevo si necesitás repetirla.",
  invalid_state_for_capture: "No pudimos continuar desde acá. Reiniciá la verificación.",
  invalid_state_for_submit: "No pudimos enviar tus fotos. Volvé a intentar.",
  invalid_state_for_preview: "No pudimos preparar tus datos. Volvé a intentar.",
  invalid_state_for_confirm: "No pudimos confirmar en este momento. Volvé a intentar.",
  preview_not_review: "Necesitamos que repitas algunas fotos para poder mostrarte tus datos.",
  incomplete_uploads: "Faltan algunas fotos. Volvé a sacar la selfie y la cédula.",
  consent_failed: "No pudimos registrar tu consentimiento. Probá de nuevo.",
  selfie_upload_failed: "No pudimos subir tu selfie. Revisá tu conexión y probá otra vez.",
  document_upload_failed: "No pudimos subir las fotos de tu cédula. Probá de nuevo.",
  submit_failed: "Algo falló al procesar tus fotos. Probá de nuevo en unos minutos.",
  preview_failed: "Algo falló al preparar tus datos. Probá de nuevo en unos minutos.",
  confirm_failed: "Algo falló al confirmar tu identidad. Probá de nuevo en unos minutos.",
  tenant_not_found: "No pudimos identificar la verificación. Pedí un enlace nuevo.",
  evidence_not_found: "No encontramos tus fotos. Volvé a sacarlas.",
  timeout: "No pudimos completar este paso. Revisá tu conexión e intentá de nuevo.",
}

/** Fallback genérico cuando el code no está mapeado (nunca mostramos el code crudo). */
const ERROR_FALLBACK = "Algo no salió bien. Probá de nuevo en unos instantes."

/**
 * Traduce un error del API (ApiError con .code/.reasons, o cualquier Error/valor)
 * a un mensaje humano. Si el error trae `reasons` accionables de calidad/cédula
 * (p.ej. preview/doc-check con needs_recapture), los prioriza para decirle al
 * usuario QUÉ corregir — antes esos reasons se descartaban (#2).
 */
export function errorMessage(e: unknown): string {
  const err = e as {
    code?: string
    reasons?: string[]
    message?: string
  } | null
  // 1) Reasons accionables tienen prioridad: dicen exactamente qué corregir.
  const reasons = Array.isArray(err?.reasons) ? err!.reasons! : []
  const reasonMsg = recaptureReasonsMsg(reasons)
  if (reasonMsg) return reasonMsg
  // 2) Mapa por code.
  if (err?.code && ERROR_MSG[err.code]) return ERROR_MSG[err.code]
  // 3) Si el message ES un code conocido (Error plano), también lo mapeamos.
  if (err?.message && ERROR_MSG[err.message]) return ERROR_MSG[err.message]
  return ERROR_FALLBACK
}

/**
 * Convierte una lista de `reasons` (de quality o doc-check) a UN tip humano,
 * priorizando los accionables. Devuelve null si no hay nada accionable que decir.
 * Usado para mostrar el motivo real cuando /preview o /doc-check piden recaptura.
 */
export function recaptureReasonsMsg(reasons?: string[]): string | null {
  const r = (Array.isArray(reasons) ? reasons : []).filter(
    (x) => !QUALITY_NON_ACTIONABLE.includes(x),
  )
  for (const k of r) {
    if (QUALITY_MSG[k]) return QUALITY_MSG[k]
    if (DOC_MSG[k]) return DOC_MSG[k]
  }
  return null
}
