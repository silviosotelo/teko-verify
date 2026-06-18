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
 *   - AML potential_match con `aml.onMatch:"review"` → SIEMPRE (independiente del
 *     review.mode): un hit en lista de sanciones/PEP exige ojo humano (P1 #1).
 *   - review.mode "always"        → siempre.
 *   - review.mode "on_borderline" → si match o liveness caen en su banda dudosa.
 *   - "auto" / sin def / sin review → nunca (auto-decisión, comportamiento actual).
 * `scores` son los scores computados (cosine de match, score de liveness) + la
 * decisión del screening AML (clear|potential_match).
 */
export function shouldRouteToReview(
  def: WorkflowDefinition | null | undefined,
  scores: {
    match?: number;
    liveness?: number;
    amlDecision?: "clear" | "potential_match";
    /** Búsqueda 1:N (P1 #2): la cara matcheó una identidad con CI distinto. */
    faceSearchDuplicate?: boolean;
    /** Comprobante de domicilio (P1 #4): el check NO pasó (nombre/fecha/domicilio). */
    proofOfAddressFailed?: boolean;
    /** Estimación de edad (P2): la edad estimada cayó por debajo de minAge (o fail-closed). */
    ageUnderage?: boolean;
  }
): boolean {
  if (!def) return false;
  // Ruteo por AML: un potential_match con onMatch:'review' va a revisión SIEMPRE,
  // aunque el review.mode sea 'auto'. Con 'flag' (default) sólo se persiste el hit.
  if (
    def.aml?.required &&
    def.aml.onMatch === "review" &&
    scores.amlDecision === "potential_match"
  ) {
    return true;
  }
  // Ruteo por FACE SEARCH (P1 #2): un duplicado (cara conocida con CI distinto) con
  // onDuplicate:'review' va a revisión SIEMPRE (posible misma persona con otra
  // identidad). Con 'flag' (default) sólo se persiste el hallazgo. El returning user
  // (mismo CI) NO rutea: no es duplicado, es el mismo titular re-verificándose.
  if (
    def.faceSearch?.required &&
    def.faceSearch.onDuplicate === "review" &&
    scores.faceSearchDuplicate === true
  ) {
    return true;
  }
  // Ruteo por COMPROBANTE DE DOMICILIO (P1 #4): un check fallido (nombre que no
  // coincide / no reciente / sin domicilio) con onFail:'review' va a revisión SIEMPRE.
  // Con 'flag' (default) sólo se persiste el hallazgo. NO es rechazo duro.
  if (
    def.proofOfAddress?.required &&
    def.proofOfAddress.onFail === "review" &&
    scores.proofOfAddressFailed === true
  ) {
    return true;
  }
  // Ruteo por ESTIMACIÓN DE EDAD (P2): una edad estimada por debajo de minAge (o un
  // fail-closed) con onUnderage:'review' va a revisión SIEMPRE. Con 'flag' (default)
  // sólo se persiste; con 'reject' es rechazo duro (lo aplica el pipeline, no acá).
  if (
    def.ageEstimation?.required &&
    def.ageEstimation.onUnderage === "review" &&
    scores.ageUnderage === true
  ) {
    return true;
  }
  const review = def.review;
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

/**
 * ¿La estimación de edad (P2) fuerza un RECHAZO DURO de la sesión? Sólo cuando el
 * workflow exige el check con `onUnderage:'reject'` Y la edad estimada cayó por debajo
 * de `minAge` (o el check fail-closed: modelo ausente / sin rostro → `passed=false`).
 * FAIL-CLOSED: required+reject sin resultado (undefined) ⇒ rechaza (un menor nunca pasa
 * por un modelo ausente). Pura/sin I/O: la consume el pipeline en su decisión terminal.
 */
export function ageEstimationRejects(
  def: WorkflowDefinition | null | undefined,
  age: { passed: boolean } | null | undefined
): boolean {
  if (!def?.ageEstimation?.required) return false;
  if (def.ageEstimation.onUnderage !== "reject") return false;
  if (!age) return true; // fail-closed: el check debía correr y no hay resultado.
  return !age.passed; // underage o error.
}
