/**
 * In-process TTL cache for `extraction_fields` per docTypeKey.
 *
 * Fail-open en disponibilidad: si el repo lanza (DB de config caída) devuelve `[]`
 * y loguea un warn SIN PII. El motor de document.ts usará el baseline hardcodeado.
 * Fail-closed en seguridad: los fieldDefs del admin sólo AGREGAN requisitos (piso
 * KYC garantizado por el motor, no acá).
 *
 * Exportado por nombre para tests (loader injectable como parámetro → sin vi.mock).
 */
import { repos } from '../db/repos'
import type { FieldDefinition } from '../db/repos/extractionFields'

export const FIELD_DEFS_TTL_MS = 60_000

interface CacheEntry { defs: FieldDefinition[]; expiresAt: number }

const _cache = new Map<string, CacheEntry>()

/** Para tests — vacía el caché entre casos. No usar en producción. */
export function _resetFieldDefsCache(): void {
  _cache.clear()
}

/**
 * Carga los FieldDefinitions para un docTypeKey con caché en proceso.
 * El parámetro `loader` es inyectable para tests (sin vi.mock).
 * Si el loader lanza → devuelve `[]` (fail-open) y no propaga la excepción.
 */
export async function loadFieldDefsForDocType(
  docTypeKey: string,
  loader: (k: string) => Promise<FieldDefinition[]> = (k) =>
    repos.extractionFields.listFieldsForDocType(k),
): Promise<FieldDefinition[]> {
  const now = Date.now()
  const hit = _cache.get(docTypeKey)
  if (hit && hit.expiresAt > now) return hit.defs
  try {
    const defs = await loader(docTypeKey)
    _cache.set(docTypeKey, { defs, expiresAt: now + FIELD_DEFS_TTL_MS })
    return defs
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[fieldDefsCache] error al cargar field defs para "${docTypeKey}": ${(err as Error).message}`,
    )
    return []
  }
}
