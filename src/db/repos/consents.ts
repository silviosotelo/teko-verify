/**
 * Repositorio de consents (§5/§12).
 *
 * Registro legal del consentimiento del titular para tratar el dato biométrico
 * (Ley 7593/2025: consentimiento previo, libre, informado e inequívoco). Append-only.
 * Scopeado por tenant; FK compuesta (tenant_id, session_id) en DDL.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type { Consent } from "../../types";

interface ConsentRow {
  id: string;
  session_id: string;
  tenant_id: string;
  text: string;
  version: string;
  accepted_at: Date;
  ip: string | null;
}

function mapConsent(row: ConsentRow): Consent {
  return {
    id: row.id,
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    text: row.text,
    version: row.version,
    acceptedAt: iso(row.accepted_at),
    ip: row.ip,
  };
}

export interface CreateConsentInput {
  tenantId: string;
  sessionId: string;
  text: string;
  version: string;
  /** ISO 8601; si se omite usa now() en la DB. */
  acceptedAt?: string;
  ip?: string | null;
}

export async function create(
  input: CreateConsentInput,
  exec: Executor = pool
): Promise<Consent> {
  const res = await exec.query<ConsentRow>(
    `INSERT INTO consents (tenant_id, session_id, text, version, accepted_at, ip)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6)
     RETURNING *`,
    [
      input.tenantId,
      input.sessionId,
      input.text,
      input.version,
      input.acceptedAt ?? null,
      input.ip ?? null,
    ]
  );
  return mapConsent(res.rows[0]);
}

export async function listBySession(
  tenantId: string,
  sessionId: string,
  exec: Executor = pool
): Promise<Consent[]> {
  const res = await exec.query<ConsentRow>(
    `SELECT * FROM consents WHERE tenant_id = $1 AND session_id = $2
     ORDER BY accepted_at ASC`,
    [tenantId, sessionId]
  );
  return res.rows.map(mapConsent);
}

export async function getById(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<Consent | null> {
  const res = await exec.query<ConsentRow>(
    "SELECT * FROM consents WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return res.rows[0] ? mapConsent(res.rows[0]) : null;
}
