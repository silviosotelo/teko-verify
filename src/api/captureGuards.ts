/**
 * Guardas PURAS de la máquina de estados de captura (§6).
 *
 * Extraídas a su propio módulo SIN dependencias (sólo el tipo `SessionState`)
 * para que el router (`capture.ts`) las use como single source of truth y, a la
 * vez, sean testeables sin levantar la capa de datos (pool de Postgres) ni el
 * engine/onnxruntime, que `capture.ts` importa de forma eager.
 */
import type { SessionState } from "../types";

/**
 * Estados en los que la captura (selfie/document/doc-check) es legítima.
 *
 * 'review' está incluido para soportar el LOOP "Volver a intentar" desde la
 * pantalla de revisión (#1): tras /preview la sesión queda en 'review'; el
 * reintento manda al usuario de vuelta a la selfie y re-captura. Sin 'review'
 * aquí, ese primer POST /selfie chocaba con requireCapturable → 409.
 *
 * El re-capture explícito (review→capturing) lo hace `resetForRecapture` en
 * /selfie; los checks/crops previos del preview los pisa el próximo /preview
 * (computeChecks hace deleteBySession + saveCrop idempotente), así que no queda
 * dato viejo. (submit usa su propia guarda, NO acepta 'review'.)
 */
export const CAPTURABLE_STATES = new Set<SessionState>([
  "created",
  "capturing",
  "needs_recapture",
  "review",
]);

/** Pura: ¿la captura (selfie/document/doc-check) es legítima en este estado? */
export function isCapturable(state: SessionState): boolean {
  return CAPTURABLE_STATES.has(state);
}

/**
 * Pura: ¿el handler de consent debe transicionar (crear consent + →capturing)?
 * Sólo desde {created}: la consentimiento debe aceptarse antes de cualquier captura.
 * Re-aceptar desde 'capturing' o cualquier otro estado es un no-op idempotente
 * para no resetear el progreso (#4).
 */
export function consentShouldTransition(state: SessionState): boolean {
  return state === "created";
}
