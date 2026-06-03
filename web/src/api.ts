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
