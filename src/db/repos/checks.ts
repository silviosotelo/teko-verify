/**
 * Repositorio de verification_checks (§5).
 *
 * Resultado granular por módulo (quality|liveness|document|match), auditable.
 * `detail` es JSONB tipado como CheckDetail (unión de los *Result de types.ts).
 * Scopeado por tenant; FK compuesta (tenant_id, session_id) garantizada en DDL.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type { CheckDetail, CheckType, VerificationCheck } from "../../types";

interface CheckRow {
  id: string;
  session_id: string;
  tenant_id: string;
  type: CheckType;
  score: number | null;
  passed: boolean;
  detail: CheckDetail;
  created_at: Date;
}

function mapCheck(row: CheckRow): VerificationCheck {
  return {
    id: row.id,
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    type: row.type,
    score: row.score,
    passed: row.passed,
    detail: row.detail,
    createdAt: iso(row.created_at),
  };
}

export interface CreateCheckInput {
  tenantId: string;
  sessionId: string;
  type: CheckType;
  score?: number | null;
  passed: boolean;
  detail: CheckDetail;
}

export async function create(
  input: CreateCheckInput,
  exec: Executor = pool
): Promise<VerificationCheck> {
  const res = await exec.query<CheckRow>(
    `INSERT INTO verification_checks (tenant_id, session_id, type, score, passed, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [
      input.tenantId,
      input.sessionId,
      input.type,
      input.score ?? null,
      input.passed,
      JSON.stringify(input.detail),
    ]
  );
  return mapCheck(res.rows[0]);
}

export async function listBySession(
  tenantId: string,
  sessionId: string,
  exec: Executor = pool
): Promise<VerificationCheck[]> {
  const res = await exec.query<CheckRow>(
    `SELECT * FROM verification_checks
     WHERE tenant_id = $1 AND session_id = $2
     ORDER BY created_at ASC`,
    [tenantId, sessionId]
  );
  return res.rows.map(mapCheck);
}

/**
 * Borra todos los checks de una sesión (idempotencia de /preview: un segundo
 * preview no debe duplicar filas que /confirm luego reconstruiría como dobles).
 * Scopeado por tenant. Devuelve la cantidad borrada.
 */
export async function deleteBySession(
  tenantId: string,
  sessionId: string,
  exec: Executor = pool
): Promise<number> {
  const res = await exec.query(
    "DELETE FROM verification_checks WHERE tenant_id = $1 AND session_id = $2",
    [tenantId, sessionId]
  );
  return res.rowCount ?? 0;
}

export async function getById(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<VerificationCheck | null> {
  const res = await exec.query<CheckRow>(
    "SELECT * FROM verification_checks WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return res.rows[0] ? mapCheck(res.rows[0]) : null;
}
