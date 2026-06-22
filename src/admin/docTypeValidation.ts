/**
 * Validadores puros para los endpoints CRUD de tipos de documento y campos.
 * Testeables directamente sin Express (mismo patrón que configValidation.ts).
 */

const VALID_MRZ   = new Set(['td1', 'td3'])
const VALID_SCOPE = new Set(['system', 'tenant'])
const KEY_RE      = /^[a-z0-9_]{1,64}$/

export function isValidDocTypePost(body: unknown): body is {
  key: string; label: string; country?: string; mrzFormat?: string | null;
  enabled?: boolean; scopeType?: string; scopeId?: string | null
} {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (typeof b.key !== 'string' || !KEY_RE.test(b.key)) return false
  if (typeof b.label !== 'string' || !b.label.trim()) return false
  if (b.mrzFormat !== undefined && b.mrzFormat !== null &&
      !VALID_MRZ.has(b.mrzFormat as string)) return false
  if (b.scopeType !== undefined && !VALID_SCOPE.has(b.scopeType as string)) return false
  return true
}

export function isValidDocTypePatch(body: unknown): body is Partial<{
  label: string; country: string; mrzFormat: string | null; enabled: boolean
}> {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (b.label !== undefined && (typeof b.label !== 'string' || !b.label.trim())) return false
  if (b.mrzFormat !== undefined && b.mrzFormat !== null &&
      !VALID_MRZ.has(b.mrzFormat as string)) return false
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return false
  return true
}
