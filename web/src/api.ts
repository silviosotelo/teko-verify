/**
 * Contrato con el backend de captura. NO cambiar las rutas ni los payloads:
 * el router /verify/:token/* del backend (src/api/capture.ts) los espera tal cual.
 *
 * El token se obtiene del path: /verify/:token  → último segmento no vacío.
 */
export const TOKEN: string =
  location.pathname.split("/").filter(Boolean).pop() ?? ""

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

export interface StatusResult {
  state: VerifyState
  reasons?: string[]
  redirectUrl?: string
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
    const msg =
      typeof j.error === "string" ? j.error : `HTTP ${r.status}`
    throw new Error(msg)
  }
  return j as T
}

/** GET /verify/:token/status — polling de estado del pipeline. */
export async function getStatus(): Promise<StatusResult> {
  const r = await fetch(`/verify/${TOKEN}/status`)
  return (await r.json()) as StatusResult
}

export const CONSENT_VERSION = "1.0"
