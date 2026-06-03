/**
 * Módulo `decision` — combina las 4 señales del pipeline → veredicto + LoA + motivos
 * (§6.e). Es puro (sin I/O, sin modelos): testeable y determinista.
 *
 * Reglas duras:
 *   - FAIL-CLOSED: ante cualquier señal faltante o no superada que el LoA requerido
 *     necesite, el veredicto NUNCA es "verified" (loa = "L0").
 *   - Escalera de aseguramiento (spec §6):
 *       L1 = documento legible + datos consistentes (sin match ni liveness).
 *       L2 = L1 + match 1:1 doc↔selfie OK.
 *       L3 = L2 + liveness OK (persona viva).
 *       L4 = futuro (chip eMRTD/NFC) — fuera de alcance de captura web.
 *   - El LoA ALCANZADO se calcula por la escalera; el veredicto es "verified" sólo si
 *     el alcanzado ≥ el requerido por la policy del tenant. Si no, "rejected" (L0).
 *
 * Nota de orden: el pipeline ya cortocircuita (quality→needs_recapture,
 * liveness/document/match→rejected). decision() es la fusión FINAL cuando todos los
 * módulos que debían correr corrieron. Aun así re-evalúa fail-closed: no confía en
 * que el pipeline haya filtrado todo.
 */
import type { Decision, LoA, PipelineChecks, TenantPolicy } from "../types";

/** Orden de los niveles para comparar "alcanzado ≥ requerido". L0 = sin aseguramiento. */
const LOA_RANK: Record<LoA, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

/** ¿`achieved` cumple o supera `required`? */
function meets(achieved: LoA, required: LoA): boolean {
  return LOA_RANK[achieved] >= LOA_RANK[required];
}

/**
 * Calcula el LoA ALCANZADO según qué señales pasaron, de forma incremental:
 * no se puede alcanzar L2 sin L1, ni L3 sin L2 (escalera).
 */
function achievedLoA(checks: PipelineChecks): { loa: LoA; reasons: string[] } {
  const reasons: string[] = [];

  // --- Base: calidad debe estar OK (gate de recaptura ya pasó si llegamos acá). ---
  if (!checks.quality.passed) {
    reasons.push("quality_failed");
    return { loa: "L0", reasons };
  }

  // --- L1: documento legible + autenticidad consistente. ---
  const docOk = checks.document.passed && checks.document.authenticity.consistent;
  if (!docOk) {
    reasons.push("document_not_consistent");
    return { loa: "L0", reasons };
  }
  reasons.push("document_consistent");
  let loa: LoA = "L1";

  // --- L2: + match 1:1 doc↔selfie. ---
  if (checks.match) {
    if (checks.match.passed) {
      reasons.push("face_match_ok");
      loa = "L2";
    } else {
      reasons.push("face_match_failed");
      // Sin match no se sube de L1; fail-closed para cualquier requerido ≥ L2.
      return { loa, reasons };
    }
  }

  // --- L3: + liveness (persona viva). Sólo cuenta si ya hay L2. ---
  if (checks.liveness) {
    if (loa !== "L2") {
      // liveness sin match no acredita L3 (la escalera lo impide).
      reasons.push("liveness_present_without_match");
    } else if (checks.liveness.passed) {
      reasons.push("liveness_ok");
      loa = "L3";
    } else {
      reasons.push("liveness_failed");
      // No sube a L3; queda en L2.
    }
  }

  return { loa, reasons };
}

/**
 * Veredicto final. `verified` sólo si el LoA alcanzado cumple el requerido por la
 * policy; en cualquier otro caso `rejected` con loa "L0" (fail-closed).
 *
 * Nota: el veredicto `needs_recapture` lo decide el PIPELINE (cuando quality falla
 * y aún quedan reintentos), no decision(): decision() ya recibe checks "finales".
 */
export function decision(
  checks: PipelineChecks,
  policy: TenantPolicy
): Decision {
  const required = policy.assuranceRequired;
  const { loa, reasons } = achievedLoA(checks);

  // FAIL-CLOSED DURO: cualquier señal de SEGURIDAD que efectivamente corrió y NO
  // pasó es un rechazo duro (spec §6/§9: liveness/match/document que fallan →
  // rejected), independientemente de que el LoA requerido sea bajo. decision() no
  // confía en que el pipeline haya cortocircuitado: re-evalúa. Un match o liveness
  // PRESENTE-pero-fallido NUNCA puede producir "verified", aunque el LoA pedido sea
  // L1 (que no exige esas señales). Si la señal no corrió (undefined) no aplica.
  const hardFailures: string[] = [];
  if (checks.match && !checks.match.passed) hardFailures.push("face_match_failed");
  if (checks.liveness && !checks.liveness.passed) hardFailures.push("liveness_failed");
  if (!checks.document.passed || !checks.document.authenticity.consistent) {
    hardFailures.push("document_not_consistent");
  }

  if (hardFailures.length === 0 && meets(loa, required)) {
    return { verdict: "verified", loa, reasons };
  }

  const rejectReasons =
    hardFailures.length > 0
      ? [...reasons, ...hardFailures, `hard_signal_failed`]
      : [...reasons, `assurance_not_met:required=${required},achieved=${loa}`];

  return {
    verdict: "rejected",
    loa: "L0",
    reasons: [...new Set(rejectReasons)],
  };
}
