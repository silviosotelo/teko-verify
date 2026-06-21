/**
 * Puente Config Plane → motor (Fase 0). Resuelve los umbrales de decisión desde el
 * plane (cascada workflow→app→tenant→system) con FALLBACK a las constantes de
 * src/config.ts, y enriquece la policy del tenant que recibe el pipeline.
 *
 * Precedencia final del motor: workflow.definition ?? plane ?? config.ts. La cara
 * (workflow.definition) la aplica applyWorkflowToPolicy DESPUÉS, sobre la `base`
 * que acá poblamos. Mantener processSession() con su firma actual: sólo cambia el
 * ORIGEN de policy.thresholds.
 *
 * FAIL-CLOSED: cualquier error de DB cae a los defaults SEGUROS de config.ts; jamás
 * propaga ni produce un umbral más laxo (un error nunca relaja la verificación).
 */
import type { Executor } from "../db/executor";
import { pool } from "../db/pool";
import { resolveConfig, type ConfigScope } from "../db/repos/configValues";
import { MATCH_THRESHOLD, LIVENESS_THRESHOLD, GLASSES_MAX } from "../config";
import type { TenantPolicy } from "../types";

/**
 * Coerciona un valor crudo del plane a número. Acepta:
 *   - number finito → directo.
 *   - string numérico no vacío (ej. "0.82") → Number(x) si es finito.
 *   - cualquier otra cosa (null, undefined, NaN, "", "abc") → fallback SEGURO.
 *
 * FAIL-CLOSED: nunca devuelve NaN, Infinity ni 0-por-string-vacío, porque 0 es el
 * umbral más laxo posible (todo pasaría). Cuando hay duda → fallback a config.ts.
 */
function coerceThreshold(raw: unknown, fallback: number): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : fallback;
  if (typeof raw === "string") {
    if (raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export interface ResolvedThresholds {
  matchCosine: number;
  livenessScore: number;
  qualityGlassesPct: number;
}

export async function resolveThresholds(
  scope: ConfigScope,
  exec: Executor = pool
): Promise<ResolvedThresholds> {
  try {
    const [m, l, g] = await Promise.all([
      resolveConfig<number>("thresholds", "matchCosine", scope, exec),
      resolveConfig<number>("thresholds", "livenessScore", scope, exec),
      resolveConfig<number>("thresholds", "qualityGlassesPct", scope, exec),
    ]);
    return {
      matchCosine: coerceThreshold(m, MATCH_THRESHOLD),
      livenessScore: coerceThreshold(l, LIVENESS_THRESHOLD),
      qualityGlassesPct: coerceThreshold(g, GLASSES_MAX),
    };
  } catch {
    // Fail-closed: nunca un umbral más laxo; defaults seguros de config.ts.
    return {
      matchCosine: MATCH_THRESHOLD,
      livenessScore: LIVENESS_THRESHOLD,
      qualityGlassesPct: GLASSES_MAX,
    };
  }
}

/**
 * Enriquece la policy con los thresholds resueltos del plane. NO pisa un override ya
 * presente en `policy.thresholds` (compat con tenants.policies legacy; su migración
 * al plane es trabajo futuro — spec §6). El resto de la policy queda intacto.
 */
export async function withResolvedThresholds(
  policy: TenantPolicy,
  scope: ConfigScope,
  exec: Executor = pool
): Promise<TenantPolicy> {
  const t = await resolveThresholds(scope, exec);
  return {
    ...policy,
    thresholds: {
      matchCosine: policy.thresholds?.matchCosine ?? t.matchCosine,
      livenessScore: policy.thresholds?.livenessScore ?? t.livenessScore,
      qualityGlassesPct: policy.thresholds?.qualityGlassesPct ?? t.qualityGlassesPct,
    },
  };
}
