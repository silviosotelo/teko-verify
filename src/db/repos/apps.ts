/**
 * Repositorio de apps (Pieza 2 — App-scoping).
 *
 * Una `app` es un proyecto bajo la org (tenant). El tenant sigue siendo top-level.
 * Cada tenant tiene una app Default (sembrada en 0014) usada como FALLBACK cuando
 * una key/workflow/webhook/sesión no especifica app. Todo scopeado por tenant.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type { App } from "../../types";

interface AppRow {
  id: string;
  tenant_id: string;
  name: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapApp(row: AppRow): App {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    isDefault: row.is_default,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** Lista las apps del tenant (default primero, luego por fecha de creación). */
export async function listByTenant(tenantId: string, exec: Executor = pool): Promise<App[]> {
  const res = await exec.query<AppRow>(
    `SELECT * FROM apps WHERE tenant_id = $1 ORDER BY is_default DESC, created_at ASC`,
    [tenantId]
  );
  return res.rows.map(mapApp);
}

export async function getById(tenantId: string, id: string, exec: Executor = pool): Promise<App | null> {
  const res = await exec.query<AppRow>(
    "SELECT * FROM apps WHERE tenant_id = $1 AND id = $2",
    [tenantId, id]
  );
  return res.rows[0] ? mapApp(res.rows[0]) : null;
}

/**
 * App Default del tenant (la marcada is_default, o la más antigua como respaldo).
 * Garantiza una fila sembrándola si por algún motivo no existiera (idempotente).
 */
export async function getDefault(tenantId: string, exec: Executor = pool): Promise<App> {
  const res = await exec.query<AppRow>(
    `SELECT * FROM apps WHERE tenant_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [tenantId]
  );
  if (res.rows[0]) return mapApp(res.rows[0]);
  // Respaldo fail-safe: ningún app (tenant creado antes de 0014 sin reseed) → crea Default.
  const ins = await exec.query<AppRow>(
    `INSERT INTO apps (tenant_id, name, is_default) VALUES ($1, 'Default', true) RETURNING *`,
    [tenantId]
  );
  return mapApp(ins.rows[0]);
}

/**
 * Resuelve el app_id efectivo para una operación: si `appId` viene, valida que sea
 * del tenant (si no, error). Si no viene, devuelve la app Default. FAIL-CLOSED ante
 * un appId que no pertenece al tenant (defensa cross-tenant en la capa app).
 */
export async function resolveAppId(
  tenantId: string,
  appId: string | null | undefined,
  exec: Executor = pool
): Promise<string> {
  if (appId) {
    const app = await getById(tenantId, appId, exec);
    if (!app) throw new Error("app_not_found");
    return app.id;
  }
  const def = await getDefault(tenantId, exec);
  return def.id;
}

export async function create(
  input: { tenantId: string; name: string; isDefault?: boolean },
  exec: Executor = pool
): Promise<App> {
  const res = await exec.query<AppRow>(
    `INSERT INTO apps (tenant_id, name, is_default) VALUES ($1, $2, COALESCE($3, false)) RETURNING *`,
    [input.tenantId, input.name, input.isDefault ?? null]
  );
  return mapApp(res.rows[0]);
}

export async function update(
  tenantId: string,
  id: string,
  patch: { name?: string },
  exec: Executor = pool
): Promise<App | null> {
  const res = await exec.query<AppRow>(
    `UPDATE apps SET name = COALESCE($3, name), updated_at = now()
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, id, patch.name ?? null]
  );
  return res.rows[0] ? mapApp(res.rows[0]) : null;
}

/**
 * Borra una app del tenant. NO permite borrar la app Default (sería romper el
 * fallback). El borrado falla a nivel DB si la app está EN USO por keys/workflows/
 * webhooks/sesiones (FK NO ACTION) → se traduce a in_use. Devuelve el estado.
 */
export async function remove(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<"deleted" | "not_found" | "is_default" | "in_use"> {
  const app = await getById(tenantId, id, exec);
  if (!app) return "not_found";
  if (app.isDefault) return "is_default";
  try {
    const res = await exec.query("DELETE FROM apps WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
    return (res.rowCount ?? 0) > 0 ? "deleted" : "not_found";
  } catch (e) {
    // 23503 = foreign_key_violation (app referenciada por keys/workflows/webhooks/sesiones).
    if ((e as { code?: string }).code === "23503") return "in_use";
    throw e;
  }
}
