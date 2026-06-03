/**
 * Repositorio de evidence (§5).
 *
 * Metadatos de las imágenes en disco/CIFS + sha256 (cadena de custodia §12).
 * Scopeado por tenant; FK compuesta (tenant_id, session_id) en DDL.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type { Evidence, EvidenceType } from "../../types";

interface EvidenceRow {
  id: string;
  session_id: string;
  tenant_id: string;
  type: EvidenceType;
  storage_path: string;
  sha256: string;
  created_at: Date;
}

function mapEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    type: row.type,
    storagePath: row.storage_path,
    sha256: row.sha256,
    createdAt: iso(row.created_at),
  };
}

export interface CreateEvidenceInput {
  tenantId: string;
  sessionId: string;
  type: EvidenceType;
  storagePath: string;
  sha256: string;
}

export async function create(
  input: CreateEvidenceInput,
  exec: Executor = pool
): Promise<Evidence> {
  const res = await exec.query<EvidenceRow>(
    `INSERT INTO evidence (tenant_id, session_id, type, storage_path, sha256)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.tenantId, input.sessionId, input.type, input.storagePath, input.sha256]
  );
  return mapEvidence(res.rows[0]);
}

export async function listBySession(
  tenantId: string,
  sessionId: string,
  exec: Executor = pool
): Promise<Evidence[]> {
  const res = await exec.query<EvidenceRow>(
    `SELECT * FROM evidence WHERE tenant_id = $1 AND session_id = $2
     ORDER BY created_at ASC`,
    [tenantId, sessionId]
  );
  return res.rows.map(mapEvidence);
}

export async function getById(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<Evidence | null> {
  const res = await exec.query<EvidenceRow>(
    "SELECT * FROM evidence WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return res.rows[0] ? mapEvidence(res.rows[0]) : null;
}

/** Borrado de evidencia de una sesión (retención/supresión §12). */
export async function removeBySession(
  tenantId: string,
  sessionId: string,
  exec: Executor = pool
): Promise<number> {
  const res = await exec.query(
    "DELETE FROM evidence WHERE tenant_id = $1 AND session_id = $2",
    [tenantId, sessionId]
  );
  return res.rowCount ?? 0;
}
