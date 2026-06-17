/**
 * Contrato con el backend de captura. NO cambiar las rutas ni los payloads:
 * el router /verify/:token/* del backend (src/api/capture.ts) los espera tal cual.
 *
 * El token se obtiene del path: /verify/:token  → último segmento no vacío.
 */
export const TOKEN: string =
  location.pathname.split("/").filter(Boolean).pop() ?? ""

/**
 * Tipo de documento elegido por el titular (multi-documento P1 #3). Espejo del
 * literal del backend (src/types.ts DocumentType). Viaja en POST /sessions y en
 * POST /document; el backend rutea la extracción por él.
 *   - "ci_py"    cédula de identidad paraguaya (frente + dorso MRZ TD1).
 *   - "passport" pasaporte ICAO (página de datos, MRZ TD3; un solo lado).
 */
export type DocumentType = "ci_py" | "passport"

export interface QualityResult {
  passed?: boolean
  reasons?: string[]
}

export interface DocCheckResult {
  passed: boolean
  reasons?: string[]
}

export type VerifyState =
  | "pending"
  | "processing"
  | "verified"
  | "rejected"
  | "needs_recapture"
  | "error"
  | "expired"
  | string

export interface StatusBranding {
  displayName?: string
  logoUrl?: string | null
  primaryColor?: string
  welcomeText?: string | null
  supportEmail?: string | null
}

export interface StatusResult {
  state: VerifyState
  reasons?: string[]
  redirectUrl?: string
  /**
   * ¿El workflow exige comprobante de domicilio (P1 #4)? La SPA inserta el paso
   * "Comprobante de domicilio" sólo cuando es true (adaptativo por workflow).
   */
  requiresProofOfAddress?: boolean
  /**
   * Branding del tenant (white-label P1 #5) YA resuelto por el backend. La SPA
   * theme-a el flujo con `primaryColor` y muestra logo/nombre/textos propios.
   */
  branding?: StatusBranding
}

/**
 * Error tipado del API de captura: además del mensaje humano (que ya viene
 * traducido vía mapApiError en messages.ts), expone el `code` crudo del backend,
 * el `status` HTTP y los `reasons` accionables si los hubo (p.ej. de /preview o
 * /doc-check que devuelven needs_recapture con motivos). Las pantallas pueden
 * leer estos campos para reaccionar (mostrar tips, ir a error, etc.).
 */
export class ApiError extends Error {
  code: string
  status: number
  reasons?: string[]
  state?: string
  constructor(args: {
    message: string
    code: string
    status: number
    reasons?: string[]
    state?: string
  }) {
    super(args.message)
    this.name = "ApiError"
    this.code = args.code
    this.status = args.status
    this.reasons = args.reasons
    this.state = args.state
  }
}

/**
 * Datos extraídos del documento que muestra la pantalla de Revisión.
 * Espejo de `ExtractedDocument` del backend (src/types.ts) pero con TODOS los
 * campos OPCIONALES: el backend se construye en paralelo y la selfie/cédula
 * pueden quedar incompletas (fail-closed). Render defensivo → "—" si falta.
 */
export interface PreviewTitular {
  apellidos?: string
  nombres?: string
  fechaNacimiento?: string
  sexo?: string
  nacionalidad?: string
  estadoCivil?: string
  donante?: boolean
  lugarNacimiento?: { ciudad?: string; departamento?: string }
}
export interface PreviewDocumento {
  pais?: string
  tipo?: string
  numeroCedula?: string
  specimen?: boolean
}
export interface PreviewDocumentoFisico {
  fechaEmision?: string
  fechaVencimiento?: string
  chip?: boolean
  codigoBarras?: boolean
}
export interface PreviewExtracted {
  titular?: PreviewTitular
  documento?: PreviewDocumento
  documentoFisico?: PreviewDocumentoFisico
}
export interface PreviewMatch {
  cosine?: number
  passed?: boolean
}
export interface PreviewDecision {
  loa?: string
  wouldPass?: boolean
}
export interface PreviewPhotos {
  selfieCrop?: string
  docFaceCrop?: string
  docFrontCrop?: string
}
/** Respuesta de POST /verify/:token/preview (pipeline SIN finalizar). */
export interface PreviewResult {
  state?: string
  extracted?: PreviewExtracted
  match?: PreviewMatch
  decisionPreview?: PreviewDecision
  photos?: PreviewPhotos
}

/** POST a /verify/:token<path> con JSON. Lanza Error con mensaje del backend si !ok. */
export async function apiPost<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/verify/${TOKEN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  let j: Record<string, unknown> = {}
  try {
    j = (await r.json()) as Record<string, unknown>
  } catch {
    /* respuesta sin body JSON */
  }
  if (!r.ok) {
    // El backend manda { error: "<code>", state?, reasons? }. Lanzamos un ApiError
    // que conserva el code crudo (para mapear a un mensaje humano en la pantalla)
    // + status + reasons accionables. El `message` queda como el code crudo: las
    // pantallas lo traducen con errorMessage() de messages.ts.
    const code = typeof j.error === "string" ? j.error : `HTTP ${r.status}`
    const reasons = Array.isArray(j.reasons)
      ? (j.reasons as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined
    throw new ApiError({
      message: code,
      code,
      status: r.status,
      reasons,
      state: typeof j.state === "string" ? j.state : undefined,
    })
  }
  return j as T
}

/**
 * POST multipart /verify/:token/liveness-video — sube el video de la sesión de
 * liveness activo (campo `video`). Es evidencia ADITIVA: fail-open en el caller
 * (un fallo de subida del video NO debe bloquear el avance del flujo; la selfie y
 * el resultado del liveness activo ya viajaron por /selfie). Devuelve true si el
 * backend la aceptó (200).
 */
export async function apiUploadVideo(blob: Blob): Promise<boolean> {
  try {
    const form = new FormData()
    // Nombre con extensión coherente con el tipo del blob (webm por defecto).
    const ext = blob.type.includes("mp4") ? "mp4" : "webm"
    form.append("video", blob, `liveness.${ext}`)
    const r = await fetch(`/verify/${TOKEN}/liveness-video`, {
      method: "POST",
      body: form,
    })
    return r.ok
  } catch {
    return false
  }
}

/**
 * POST /verify/:token/proof-of-address — sube el comprobante de domicilio (P1 #4).
 * `image` es un data-URL base64 (imagen JPEG/PNG o PDF). El backend lo persiste como
 * evidencia y el pipeline corre el check en /preview /submit. Reusa apiPost (mismo
 * envelope de error que el resto de la captura).
 */
export async function uploadProofOfAddress(image: string): Promise<void> {
  await apiPost("/proof-of-address", { image })
}

/**
 * GET /verify/:token/status — polling/rehidratación de estado.
 * Status-aware: si el backend responde !ok (404 token inválido, 410 expirado/
 * consumido), lanza ApiError para que el caller (App.tsx al montar) muestre la
 * pantalla de error directamente en vez de parsear ciegamente un JSON de error.
 */
export async function getStatus(): Promise<StatusResult> {
  const r = await fetch(`/verify/${TOKEN}/status`)
  let j: Record<string, unknown> = {}
  try {
    j = (await r.json()) as Record<string, unknown>
  } catch {
    /* sin body JSON */
  }
  if (!r.ok) {
    const code = typeof j.error === "string" ? j.error : `HTTP ${r.status}`
    throw new ApiError({
      message: code,
      code,
      status: r.status,
      state: typeof j.state === "string" ? j.state : undefined,
    })
  }
  return j as unknown as StatusResult
}

export const CONSENT_VERSION = "1.0"
