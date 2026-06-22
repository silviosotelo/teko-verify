/**
 * Validadores puros del endpoint de config (testeables sin Express). El router
 * importa estas funciones; mantenerlas puras permite cubrir el scope/namespace/key
 * con tests unitarios (mismo espíritu que isValidDefinition en router.ts).
 */
import type { ConfigScopeType } from "../db/repos/configValues";

/** Namespaces permitidos (spec §3.1). Cierra el set para que la UI no escriba basura. */
export const CONFIG_NAMESPACES = [
  "thresholds", "providers", "rules", "ui", "compliance", "pipeline", "documents",
] as const;

export interface ParsedScope {
  scopeType: ConfigScopeType;
  scopeId: string | null;
}

/**
 * Resuelve el scope desde la query del endpoint, anclado al tenant de la ruta:
 *   - sin scopeType o 'tenant' → tenant scope (scopeId = tenantId).
 *   - 'system'                 → scopeId null (gateado a owner por manage_tenants).
 *   - 'app' | 'workflow'       → NO soportados en Fase 0 → null (400).
 *
 * Por qué app/workflow se rechazan en Fase 0: el scopeId vendría del request y
 * escribir sobre una app/workflow exige verificar que pertenece al tenant de la ruta
 * (defensa cross-tenant, Global Constraint "todo dato scopeado por tenant_id"). El
 * panel admin de Fase 0 sólo expone system+tenant, así que se cierran. Para
 * habilitarlos: antes del set(), validar ownership con
 * `repos.apps.resolveAppId(tenant.id, scopeId)` (app) o
 * `repos.workflows.getById(tenant.id, scopeId)` (workflow) → 404 si no pertenece.
 */
export function parseConfigScope(
  query: Record<string, unknown>,
  tenantId: string
): ParsedScope | null {
  const raw = query.scopeType;
  const scopeType = (raw === undefined ? "tenant" : raw) as string;
  if (scopeType === "tenant") return { scopeType: "tenant", scopeId: tenantId };
  if (scopeType === "system") return { scopeType: "system", scopeId: null };
  // 'app' | 'workflow' diferidos a una fase con ownership check (ver docstring).
  return null;
}

/** ¿el body de PUT trae namespace permitido + key no vacía + value presente? */
export function isValidConfigPut(
  body: unknown
): body is { namespace: string; key: string; value: unknown } {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.namespace !== "string") return false;
  if (!(CONFIG_NAMESPACES as readonly string[]).includes(b.namespace)) return false;
  if (typeof b.key !== "string" || b.key.trim().length === 0) return false;
  if (!("value" in b) || b.value === undefined) return false;
  return true;
}
