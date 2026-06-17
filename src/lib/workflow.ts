/**
 * Workflows — lógica PURA (sin I/O) de resolución de la definición de un workflow
 * a la policy efectiva del pipeline + ruteo a revisión humana (P0 #1).
 *
 * La arquitectura Didit separa Workflow (config versionada de checks/umbrales/
 * revisión) de Session (instancia que snapshotea la def usada). Para NO reescribir
 * el pipeline (que razona por LoA L1/L2/L3 + `decision()`), este módulo DERIVA de la
 * definición:
 *   - el LoA equivalente (qué checks corren: liveness→L3, match→L2, document→L1),
 *   - los umbrales (override de los defaults del tenant),
 * y deja todo lo demás (consentimiento, retención, challenges) tal cual la policy.
 *
 * COMPATIBILIDAD: los workflows default-l1/-l2/-l3 producen exactamente el mismo
 * `assuranceRequired` + thresholds vacíos → comportamiento idéntico al actual.
 */
import type { LoA, TenantPolicy, WorkflowDefinition } from "../types";

/** Definición default por LoA (mapea EXACTO a la escalera L1/L2/L3 actual). */
export function workflowDefForLoA(loa: LoA): WorkflowDefinition {
  const base: WorkflowDefinition = {
    document: { required: true },
    quality: {},
    review: { mode: "auto" },
  };
  if (loa === "L2") return { ...base, match: { required: true } };
  if (loa === "L3" || loa === "L4") {
    return {
      ...base,
      match: { required: true },
      liveness: { required: true, mode: "active" },
    };
  }
  // L1 / L0 → sólo documento.
  return base;
}

/** Nombre del workflow default que corresponde a un LoA (default-l1/-l2/-l3). */
export function defaultWorkflowName(loa: LoA): string {
  if (loa === "L2") return "default-l2";
  if (loa === "L3" || loa === "L4") return "default-l3";
  return "default-l1";
}

/** Los 3 workflows default que se siembran por tenant. */
export function defaultWorkflows(): Array<{ name: string; definition: WorkflowDefinition }> {
  return [
    { name: "default-l1", definition: workflowDefForLoA("L1") },
    { name: "default-l2", definition: workflowDefForLoA("L2") },
    { name: "default-l3", definition: workflowDefForLoA("L3") },
  ];
}

/**
 * Deriva el LoA EQUIVALENTE de una definición de workflow (qué checks exige).
 * Escalera: liveness.required → L3; match.required → L2; document.required → L1.
 * Definición vacía/sin checks → L1 (fail-safe conservador: nunca sube solo).
 */
export function assuranceFromDefinition(def: WorkflowDefinition): LoA {
  if (def.liveness?.required) return "L3";
  if (def.match?.required) return "L2";
  return "L1";
}

/**
 * Aplica una definición de workflow sobre la policy base del tenant → policy EFECTIVA
 * para el pipeline. Sólo cambia `assuranceRequired` (derivado) y `thresholds` (override
 * si la def los fija). Todo lo demás se conserva. Para los defaults (thresholds vacíos)
 * el resultado es idéntico a usar el `assuranceRequired` snapshoteado.
 */
export function applyWorkflowToPolicy(
  base: TenantPolicy,
  def: WorkflowDefinition
): TenantPolicy {
  return {
    ...base,
    assuranceRequired: assuranceFromDefinition(def),
    thresholds: {
      matchCosine: def.match?.threshold ?? base.thresholds?.matchCosine,
      livenessScore: def.liveness?.threshold ?? base.thresholds?.livenessScore,
      qualityGlassesPct: def.quality?.glassesMaxPct ?? base.thresholds?.qualityGlassesPct,
    },
  };
}

/** ¿`v` cae dentro de la banda [min,max] (extremos inclusive, min/max opcionales)? */
function inBand(v: number | undefined, min?: number, max?: number): boolean {
  if (v === undefined) return false;
  if (min !== undefined && v < min) return false;
  if (max !== undefined && v > max) return false;
  // Si ni min ni max están definidos, no hay banda → no es borderline.
  return min !== undefined || max !== undefined;
}

/**
 * ¿La sesión debe ir a la COLA DE REVISIÓN HUMANA (in_review) en vez de auto-decidir?
 *   - review.mode "always"        → siempre.
 *   - review.mode "on_borderline" → si match o liveness caen en su banda dudosa.
 *   - "auto" / sin def / sin review → nunca (auto-decisión, comportamiento actual).
 * `scores` son los scores computados (cosine de match, score de liveness).
 */
export function shouldRouteToReview(
  def: WorkflowDefinition | null | undefined,
  scores: { match?: number; liveness?: number }
): boolean {
  const review = def?.review;
  if (!review) return false;
  if (review.mode === "always") return true;
  if (review.mode === "on_borderline") {
    const b = review.borderlineBand;
    if (!b) return false;
    return (
      inBand(scores.match, b.matchMin, b.matchMax) ||
      inBand(scores.liveness, b.livenessMin, b.livenessMax)
    );
  }
  return false;
}
