/**
 * Config Plane (Fase 0) — repo de config_values + cascada de resolución.
 *
 * Una fila por (scope, namespace, key, version). La versión VIGENTE de una clave =
 * MAX(version). Editar = nueva versión (insert version+1), igual que workflows.
 * `set()` escribe ADEMÁS una fila en config_audit (antes/después) en la MISMA
 * llamada: la auditoría es ininterrumpible. scope_id es polimórfico (tenant|app|
 * workflow id) y NULL ⇔ system.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";

export type ConfigScopeType = "system" | "tenant" | "app" | "workflow";

/** Coordenadas para resolver por cascada. Cada id ausente = ese nivel no aplica. */
export interface ConfigScope {
  tenantId?: string | null;
  appId?: string | null;
  workflowId?: string | null;
}

export interface ConfigValue {
  id: string;
  scopeType: ConfigScopeType;
  scopeId: string | null;
  namespace: string;
  key: string;
  value: unknown;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

interface ConfigRow {
  id: string;
  scope_type: ConfigScopeType;
  scope_id: string | null;
  namespace: string;
  key: string;
  value: unknown;
  version: number;
  updated_by: string;
  updated_at: Date;
}

function mapConfig(row: ConfigRow): ConfigValue {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    namespace: row.namespace,
    key: row.key,
    value: row.value,
    version: row.version,
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at),
  };
}

/** Filtro de scope que trata scope_id NULL (system) con IS NULL. */
function scopeWhere(scopeId: string | null): { clause: string; param: string[] } {
  return scopeId === null
    ? { clause: "scope_id IS NULL", param: [] }
    : { clause: "scope_id = $2", param: [scopeId] };
}

/** Versión VIGENTE (mayor `version`) de una clave en un scope concreto. */
export async function getCurrent(
  scopeType: ConfigScopeType,
  scopeId: string | null,
  namespace: string,
  key: string,
  exec: Executor = pool
): Promise<ConfigValue | null> {
  const sw = scopeWhere(scopeId);
  // params: $1 scope_type, [$2 scope_id], luego namespace/key.
  const nsIdx = 2 + sw.param.length;
  const keyIdx = nsIdx + 1;
  const res = await exec.query<ConfigRow>(
    `SELECT * FROM config_values
     WHERE scope_type = $1 AND ${sw.clause}
       AND namespace = $${nsIdx} AND key = $${keyIdx}
     ORDER BY version DESC LIMIT 1`,
    [scopeType, ...sw.param, namespace, key]
  );
  return res.rows[0] ? mapConfig(res.rows[0]) : null;
}

export interface SetConfigInput {
  scopeType: ConfigScopeType;
  scopeId: string | null;
  namespace: string;
  key: string;
  value: unknown;
  /** Quién hace el cambio (admin:operatorId | system:seed). Requerido para auditoría. */
  actor: string;
}

/**
 * Crea una nueva VERSIÓN de una clave (version = max+1, o 1 si es nueva) y registra
 * la auditoría (antes/después) en la MISMA llamada. Devuelve la fila creada.
 * Mismo `exec` para los 3 statements (patrón de workflows.createVersion).
 */
export async function set(
  input: SetConfigInput,
  exec: Executor = pool
): Promise<ConfigValue> {
  const sw = scopeWhere(input.scopeId);
  const nsIdx = 2 + sw.param.length;
  const keyIdx = nsIdx + 1;

  const maxRes = await exec.query<{ v: number | null }>(
    `SELECT MAX(version) AS v FROM config_values
     WHERE scope_type = $1 AND ${sw.clause} AND namespace = $${nsIdx} AND key = $${keyIdx}`,
    [input.scopeType, ...sw.param, input.namespace, input.key]
  );
  const nextVersion = (maxRes.rows[0]?.v ?? 0) + 1;

  // `before` = valor vigente actual (NULL si es el primer set de la clave).
  const beforeRes = await exec.query<{ value: unknown }>(
    `SELECT value FROM config_values
     WHERE scope_type = $1 AND ${sw.clause} AND namespace = $${nsIdx} AND key = $${keyIdx}
     ORDER BY version DESC LIMIT 1`,
    [input.scopeType, ...sw.param, input.namespace, input.key]
  );
  const before = beforeRes.rows[0] ? beforeRes.rows[0].value : null;

  const ins = await exec.query<ConfigRow>(
    `INSERT INTO config_values (scope_type, scope_id, namespace, key, value, version, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING *`,
    [
      input.scopeType,
      input.scopeId,
      input.namespace,
      input.key,
      JSON.stringify(input.value),
      nextVersion,
      input.actor,
    ]
  );

  await exec.query(
    `INSERT INTO config_audit (scope_type, scope_id, namespace, key, before, after, version, changed_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      input.scopeType,
      input.scopeId,
      input.namespace,
      input.key,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(input.value),
      nextVersion,
      input.actor,
    ]
  );

  return mapConfig(ins.rows[0]);
}

/** Versión vigente de TODAS las claves de un scope (para la UI de config por scope). */
export async function listByScope(
  scopeType: ConfigScopeType,
  scopeId: string | null,
  exec: Executor = pool
): Promise<ConfigValue[]> {
  const sw = scopeWhere(scopeId);
  const res = await exec.query<ConfigRow>(
    `SELECT DISTINCT ON (namespace, key) *
     FROM config_values
     WHERE scope_type = $1 AND ${sw.clause}
     ORDER BY namespace, key, version DESC`,
    [scopeType, ...sw.param]
  );
  return res.rows.map(mapConfig);
}

const SCOPE_PRECEDENCE: Array<{
  type: ConfigScopeType;
  id: (s: ConfigScope) => string | null | undefined;
}> = [
  { type: "workflow", id: (s) => s.workflowId },
  { type: "app", id: (s) => s.appId },
  { type: "tenant", id: (s) => s.tenantId },
  { type: "system", id: () => null },
];

/**
 * Cascada de resolución: devuelve el valor de la fila MÁS ESPECÍFICA vigente
 * (workflow→app→tenant→system) para (namespace,key), o `undefined` si no hay
 * ninguna. El caller hace `?? CONSTANTE` para el fallback a config.ts.
 * Nota: el spec escribe `resolveConfig(key, scope)`; acá `key` se desdobla en
 * (namespace, key) igual que la tabla.
 */
export async function resolveConfig<T = unknown>(
  namespace: string,
  key: string,
  scope: ConfigScope,
  exec: Executor = pool
): Promise<T | undefined> {
  for (const level of SCOPE_PRECEDENCE) {
    const scopeId = level.id(scope) ?? null;
    if (level.type !== "system" && !scopeId) continue; // ese nivel no aplica
    const row = await getCurrent(level.type, scopeId, namespace, key, exec);
    if (row) return row.value as T;
  }
  return undefined;
}
