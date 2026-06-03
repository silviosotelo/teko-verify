/**
 * Repositorio de audit_log (§5/§12).
 *
 * Traza append-only para cumplimiento. session_id es nullable (eventos a nivel
 * tenant, p.ej. "apikey.created"). `detail` es JSONB (Record<string, unknown>).
 * Scopeado por tenant. No expone update/delete: la auditoría no se reescribe.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type { AuditEntry } from "../../types";

interface AuditRow {
  id: string;
  tenant_id: string;
  session_id: string | null;
  actor: string;
  event: string;
  detail: Record<string, unknown>;
  ip: string | null;
  created_at: Date;
}

function mapAudit(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    actor: row.actor,
    event: row.event,
    detail: row.detail,
    ip: row.ip,
    createdAt: iso(row.created_at),
  };
}

export interface CreateAuditInput {
  tenantId: string;
  sessionId?: string | null;
  actor: string;
  event: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

export async function record(
  input: CreateAuditInput,
  exec: Executor = pool
): Promise<AuditEntry> {
  const res = await exec.query<AuditRow>(
    `INSERT INTO audit_log (tenant_id, session_id, actor, event, detail, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING *`,
    [
      input.tenantId,
      input.sessionId ?? null,
      input.actor,
      input.event,
      JSON.stringify(input.detail ?? {}),
      input.ip ?? null,
    ]
  );
  return mapAudit(res.rows[0]);
}

export async function listByTenant(
  tenantId: string,
  opts: { from?: string; to?: string; limit?: number; offset?: number } = {},
  exec: Executor = pool
): Promise<AuditEntry[]> {
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
  const res = await exec.query<AuditRow>(
    `SELECT * FROM audit_log WHERE ${conds.join(" AND ")}
     ORDER BY created_at DESC LIMIT $${p++} OFFSET $${p++}`,
    [...params, opts.limit ?? 100, opts.offset ?? 0]
  );
  return res.rows.map(mapAudit);
}

export async function listBySession(
  tenantId: string,
  sessionId: string,
  exec: Executor = pool
): Promise<AuditEntry[]> {
  const res = await exec.query<AuditRow>(
    `SELECT * FROM audit_log WHERE tenant_id = $1 AND session_id = $2
     ORDER BY created_at ASC`,
    [tenantId, sessionId]
  );
  return res.rows.map(mapAudit);
}
