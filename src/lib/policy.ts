/**
 * Política por tenant: defaults + merge. La policy es el input de decision() y la
 * fuente de los umbrales/retención/consentimiento (§5/§6/§12).
 */
import { TOKEN_TTL_MIN } from "../config";
import type { TenantPolicy } from "../types";

export function defaultPolicy(): TenantPolicy {
  return {
    assuranceRequired: "L3",
    retentionDays: 90,
    livenessChallenges: [],
    consentText:
      "Autorizo el tratamiento de mis datos biométricos (rostro) y de mi documento " +
      "con la única finalidad de verificar mi identidad, conforme a la Ley N° 7593/2025.",
    consentVersion: "1.0",
    maxRecaptureAttempts: 3,
    linkTokenTtlSeconds: TOKEN_TTL_MIN * 60,
    thresholds: {},
  };
}

/** Mezcla una policy parcial sobre los defaults (alta/edición de tenant). */
export function mergePolicy(partial?: Partial<TenantPolicy>): TenantPolicy {
  const base = defaultPolicy();
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    thresholds: { ...base.thresholds, ...partial.thresholds },
  };
}
