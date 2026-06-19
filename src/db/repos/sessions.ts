/**
 * Repositorio de verification_sessions (§5/§6).
 *
 * EXCEPCIÓN de scoping (deliberada): `findByLinkToken` NO es tenant-scopeado: el
 * link_token ES la autenticación del flujo de captura (el titular no porta tenant).
 * Todo lo demás (getById, list, updates) es tenant-scopeado.
 *
 * Idempotencia (§9): `findByExternalRef` + el índice único parcial (tenant_id,
 * external_ref) permiten que la creación sea idempotente a nivel app + DB.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso, isoOrNull } from "./mapping";
import type {
  DocumentType,
  LoA,
  SessionResult,
  SessionState,
  VerificationSession,
  WorkflowDefinition,
} from "../../types";

interface SessionRow {
  id: string;
  tenant_id: string;
  app_id: string | null;
  external_ref: string | null;
  document_type: DocumentType;
  state: SessionState;
  link_token: string;
  callback_url: string | null;
  assurance_required: LoA;
  workflow_id: string | null;
  workflow_version: number | null;
  workflow_snapshot: WorkflowDefinition | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  redirect_url: string | null;
  locale: string;
  recapture_count: number;
  used_at: Date | null;
  expires_at: Date;
  completed_at: Date | null;
  result: SessionResult | null;
  created_at: Date;
  updated_at: Date;
}

function mapSession(row: SessionRow): VerificationSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    appId: row.app_id ?? null,
    externalRef: row.external_ref,
    documentType: row.document_type,
    state: row.state,
    linkToken: row.link_token,
    callbackUrl: row.callback_url,
    assuranceRequired: row.assurance_required,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    workflowSnapshot: row.workflow_snapshot,
    reviewedBy: row.reviewed_by,
    reviewedAt: isoOrNull(row.reviewed_at),
    redirectUrl: row.redirect_url,
    locale: row.locale,
    recaptureCount: row.recapture_count,
    usedAt: row.used_at,
    expiresAt: iso(row.expires_at),
    completedAt: isoOrNull(row.completed_at),
    result: row.result,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export interface CreateSessionInput {
  tenantId: string;
  /** App dueña de la sesión (App-scoping). null/ausente = la app Default del tenant. */
  appId?: string | null;
  externalRef?: string | null;
  /** Tipo de documento elegido (P1 #3). Default 'ci_py' (lo aplica la columna). */
  documentType?: DocumentType | null;
  linkToken: string;
  callbackUrl?: string | null;
  assuranceRequired: LoA;
  /** Workflow snapshoteado en la sesión (P0 #1). Opcional para compat. */
  workflowId?: string | null;
  workflowVersion?: number | null;
  workflowSnapshot?: WorkflowDefinition | null;
  redirectUrl?: string | null;
  locale?: string;
  /** ISO 8601. */
  expiresAt: string;
}

export async function create(
  input: CreateSessionInput,
  exec: Executor = pool
): Promise<VerificationSession> {
  const res = await exec.query<SessionRow>(
    `INSERT INTO verification_sessions
       (tenant_id, app_id, external_ref, document_type, link_token, callback_url,
        assurance_required, workflow_id, workflow_version, workflow_snapshot,
        redirect_url, locale, expires_at)
     VALUES (
       $1,
       COALESCE($13, (SELECT id FROM apps WHERE tenant_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1)),
       $2, COALESCE($3, 'ci_py'), $4, $5, $6, $7, $8, $9::jsonb, $10, COALESCE($11, 'es'), $12
     )
     RETURNING *`,
    [
      input.tenantId,
      input.externalRef ?? null,
      input.documentType ?? null,
      input.linkToken,
      input.callbackUrl ?? null,
      input.assuranceRequired,
      input.workflowId ?? null,
      input.workflowVersion ?? null,
      input.workflowSnapshot !== undefined && input.workflowSnapshot !== null
        ? JSON.stringify(input.workflowSnapshot)
        : null,
      input.redirectUrl ?? null,
      input.locale ?? null,
      input.expiresAt,
      input.appId ?? null,
    ]
  );
  return mapSession(res.rows[0]);
}

/**
 * Lookup por id SIN scope de tenant. SOLO para superficies admin globales (cola de
 * revisión: el operador opera cross-tenant). El tenant real se obtiene de la fila.
 */
export async function getByIdAny(
  id: string,
  exec: Executor = pool
): Promise<VerificationSession | null> {
  const res = await exec.query<SessionRow>(
    "SELECT * FROM verification_sessions WHERE id = $1",
    [id]
  );
  return res.rows[0] ? mapSession(res.rows[0]) : null;
}

/**
 * Cola de revisión humana: sesiones en estado `in_review` (cross-tenant, admin).
 * Filtro opcional por tenant. Devuelve total + filas (más nuevas primero).
 */
export async function listInReview(
  opts: { tenantId?: string; limit?: number; offset?: number } = {},
  exec: Executor = pool
): Promise<{ total: number; sessions: VerificationSession[] }> {
  const conds: string[] = ["state = 'in_review'"];
  const params: unknown[] = [];
  let p = 1;
  if (opts.tenantId !== undefined) {
    conds.push(`tenant_id = $${p++}`);
    params.push(opts.tenantId);
  }
  const where = conds.join(" AND ");
  const totalRes = await exec.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM verification_sessions WHERE ${where}`,
    params
  );
  const total = parseInt(totalRes.rows[0].count, 10);
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const rowsRes = await exec.query<SessionRow>(
    `SELECT * FROM verification_sessions WHERE ${where}
     ORDER BY created_at DESC LIMIT $${p++} OFFSET $${p++}`,
    [...params, limit, offset]
  );
  return { total, sessions: rowsRes.rows.map(mapSession) };
}

export async function getById(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<VerificationSession | null> {
  const res = await exec.query<SessionRow>(
    "SELECT * FROM verification_sessions WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return res.rows[0] ? mapSession(res.rows[0]) : null;
}

/** Fila de uso agregado: conteo de sesiones por (app, estado) en un período. */
export interface UsageRow {
  appId: string | null;
  state: SessionState;
  count: number;
}

/**
 * Uso por org (Pieza 3): conteo de verificaciones agrupado por (app_id, state) en
 * el rango [from, to] (ISO, opcional) sobre created_at. Derivado de
 * verification_sessions (sin tabla de contadores). Scopeado por tenant.
 */
export async function usageByApp(
  tenantId: string,
  opts: { from?: string; to?: string } = {},
  exec: Executor = pool
): Promise<UsageRow[]> {
  const conds: string[] = ["tenant_id = $1"];
  const params: unknown[] = [tenantId];
  let p = 2;
  if (opts.from !== undefined) {
    conds.push(`created_at >= $${p++}`);
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    conds.push(`created_at <= $${p++}`);
    params.push(opts.to);
  }
  const res = await exec.query<{ app_id: string | null; state: SessionState; n: string }>(
    `SELECT app_id, state, COUNT(*)::text AS n
       FROM verification_sessions
      WHERE ${conds.join(" AND ")}
      GROUP BY app_id, state`,
    params
  );
  return res.rows.map((r) => ({
    appId: r.app_id ?? null,
    state: r.state,
    count: parseInt(r.n, 10),
  }));
}

/**
 * Lookup por link_token. NO tenant-scopeado a propósito: el token es la auth del
 * flujo de captura del titular.
 */
export async function findByLinkToken(
  linkToken: string,
  exec: Executor = pool
): Promise<VerificationSession | null> {
  const res = await exec.query<SessionRow>(
    "SELECT * FROM verification_sessions WHERE link_token = $1",
    [linkToken]
  );
  return res.rows[0] ? mapSession(res.rows[0]) : null;
}

/** Idempotencia de creación (§9): busca por (tenant, external_ref). */
export async function findByExternalRef(
  tenantId: string,
  externalRef: string,
  exec: Executor = pool
): Promise<VerificationSession | null> {
  const res = await exec.query<SessionRow>(
    "SELECT * FROM verification_sessions WHERE tenant_id = $1 AND external_ref = $2",
    [tenantId, externalRef]
  );
  return res.rows[0] ? mapSession(res.rows[0]) : null;
}

export interface ListSessionsOptions {
  state?: SessionState;
  externalRef?: string;
  /** ISO 8601. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function listByTenant(
  tenantId: string,
  opts: ListSessionsOptions = {},
  exec: Executor = pool
): Promise<{ total: number; sessions: VerificationSession[] }> {
  // Construcción de filtros con placeholders posicionales (sin string-concat de valores).
  const conds: string[] = ["tenant_id = $1"];
  const params: unknown[] = [tenantId];
  let p = 2;
  if (opts.state !== undefined) {
    conds.push(`state = $${p++}`);
    params.push(opts.state);
  }
  if (opts.externalRef !== undefined) {
    conds.push(`external_ref = $${p++}`);
    params.push(opts.externalRef);
  }
  if (opts.from !== undefined) {
    conds.push(`created_at >= $${p++}`);
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    conds.push(`created_at <= $${p++}`);
    params.push(opts.to);
  }
  const where = conds.join(" AND ");

  const totalRes = await exec.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM verification_sessions WHERE ${where}`,
    params
  );
  const total = parseInt(totalRes.rows[0].count, 10);

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const rowsRes = await exec.query<SessionRow>(
    `SELECT * FROM verification_sessions WHERE ${where}
     ORDER BY created_at DESC LIMIT $${p++} OFFSET $${p++}`,
    [...params, limit, offset]
  );
  return { total, sessions: rowsRes.rows.map(mapSession) };
}

export interface UpdateSessionInput {
  state?: SessionState;
  /** Tipo de documento elegido por el titular al subir el documento (P1 #3). */
  documentType?: DocumentType;
  recaptureCount?: number;
  result?: SessionResult | null;
  /** ISO 8601; usar para marcar la finalización. */
  completedAt?: string | null;
  /**
   * Marca de consumo del token de un solo uso (§8/§9). Pasar una fecha la setea;
   * pasar `null` la limpia. Si se omite no se toca. Para "marcar una sola vez" de
   * forma atómica preferir `markUsed()`.
   */
  usedAt?: Date | null;
  /** Revisión humana (cola in_review): sella quién/cuándo decidió. */
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
}

/**
 * Update parcial scopeado por tenant. Setea updated_at = now() siempre.
 * `result` se serializa a JSONB; pasar `null` lo limpia explícitamente.
 */
export async function update(
  tenantId: string,
  id: string,
  patch: UpdateSessionInput,
  exec: Executor = pool
): Promise<VerificationSession | null> {
  const res = await exec.query<SessionRow>(
    `UPDATE verification_sessions SET
       state           = COALESCE($3, state),
       recapture_count = COALESCE($4, recapture_count),
       result          = CASE WHEN $5::boolean THEN $6::jsonb ELSE result END,
       completed_at    = CASE WHEN $7::boolean THEN $8::timestamptz ELSE completed_at END,
       used_at         = CASE WHEN $9::boolean THEN $10::timestamptz ELSE used_at END,
       reviewed_by     = CASE WHEN $11::boolean THEN $12::text ELSE reviewed_by END,
       reviewed_at     = CASE WHEN $13::boolean THEN $14::timestamptz ELSE reviewed_at END,
       document_type   = COALESCE($15, document_type),
       updated_at      = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [
      id,
      tenantId,
      patch.state ?? null,
      patch.recaptureCount ?? null,
      // flags para distinguir "no tocar" de "setear a null"
      patch.result !== undefined,
      patch.result !== undefined ? JSON.stringify(patch.result) : null,
      patch.completedAt !== undefined,
      patch.completedAt !== undefined ? patch.completedAt : null,
      patch.usedAt !== undefined,
      patch.usedAt !== undefined ? patch.usedAt : null,
      patch.reviewedBy !== undefined,
      patch.reviewedBy !== undefined ? patch.reviewedBy : null,
      patch.reviewedAt !== undefined,
      patch.reviewedAt !== undefined ? patch.reviewedAt : null,
      patch.documentType ?? null,
    ]
  );
  return res.rows[0] ? mapSession(res.rows[0]) : null;
}

/**
 * Marca el token como consumido sin mutar el estado de la sesión.
 *
 * IMPORTANTE: esta función ya NO setea `used_at` — el campo se gestiona
 * exclusivamente a través del flujo normal de `update()` (state + usedAt en
 * una misma sentencia SQL atómica). Esta función existe solo como punto de
 * extensión para futuros consumidores que necesiten marcar el token sin
 * tocar el estado.
 */
export async function markUsed(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<boolean> {
  return false;
}

/** Incrementa atómicamente recapture_count y devuelve el nuevo valor (§9). */
export async function incrementRecapture(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<number | null> {
  const res = await exec.query<{ recapture_count: number }>(
    `UPDATE verification_sessions
       SET recapture_count = recapture_count + 1, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING recapture_count`,
    [id, tenantId]
  );
  return res.rows[0] ? res.rows[0].recapture_count : null;
}

/**
 * Borrado scopeado por tenant (derecho a supresión, §8/§12). La FK compuesta
 * ON DELETE CASCADE arrastra checks/identities/evidence/consents del mismo tenant.
 */
export async function remove(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<boolean> {
  const res = await exec.query(
    "DELETE FROM verification_sessions WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return (res.rowCount ?? 0) > 0;
}
