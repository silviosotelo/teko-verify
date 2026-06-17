/**
 * TTL override de los links de PRUEBA del admin (POST /admin/tenants/:id/test-session).
 *
 * Módulo PURO y sin dependencias (no toca la capa de datos) para ser testeable en
 * aislamiento. Solo afecta al endpoint de prueba del admin: NO toca el flujo público
 * /v1/sessions ni el default global (config.TOKEN_TTL_MIN).
 */

/** Tope razonable del TTL override de los links de PRUEBA del admin (minutos). */
export const TEST_SESSION_TTL_MAX_MIN = 120;

/**
 * Resuelve el TTL (en SEGUNDOS) de un link de PRUEBA del admin.
 *
 * `defaultTtlSec` es el TTL por defecto del tenant (normalmente 900s = 15min).
 * `rawTtlMinutes` es el override OPCIONAL del body: si es un ENTERO POSITIVO se usa,
 * clampeado a TEST_SESSION_TTL_MAX_MIN. Fail-closed: cualquier valor inválido
 * (no-número, no-entero, ≤0, NaN, string) se IGNORA y se devuelve el default.
 */
export function resolveTestSessionTtlSec(
  rawTtlMinutes: unknown,
  defaultTtlSec: number
): number {
  if (
    typeof rawTtlMinutes !== "number" ||
    !Number.isInteger(rawTtlMinutes) ||
    rawTtlMinutes <= 0
  ) {
    return defaultTtlSec;
  }
  const clampedMin = Math.min(rawTtlMinutes, TEST_SESSION_TTL_MAX_MIN);
  return clampedMin * 60;
}
