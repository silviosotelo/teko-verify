/**
 * Repositorio de api_keys (§5).
 *
 * EXCEPCIÓN de scoping (deliberada): `findByHash` NO es tenant-scopeado, porque
 * el tenant se DERIVA de la key durante la autenticación. Todo el resto sí lleva
 * tenant_id. El secreto plano nunca se persiste: solo key_hash.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso, isoOrNull } from "./mapping";
import type { ApiKey, ApiKeyStatus } from "../../types";

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  key_hash: string;
  prefix: string;
  label: string;
  scopes: string[];
  status: ApiKeyStatus;
  last_used_at: Date | null;
  created_at: Date;
}

function mapApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    keyHash: row.key_hash,
    prefix: row.prefix,
    label: row.label,
    scopes: row.scopes,
    status: row.status,
    lastUsedAt: isoOrNull(row.last_used_at),
    createdAt: iso(row.created_at),
  };
}

export interface CreateApiKeyInput {
  tenantId: string;
  keyHash: string;
  prefix: string;
  label: string;
  scopes: string[];
}

export async function create(
  input: CreateApiKeyInput,
  exec: Executor = pool
): Promise<ApiKey> {
  const res = await exec.query<ApiKeyRow>(
    `INSERT INTO api_keys (tenant_id, key_hash, prefix, label, scopes)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [input.tenantId, input.keyHash, input.prefix, input.label, JSON.stringify(input.scopes)]
  );
  return mapApiKey(res.rows[0]);
}

/**
 * Lookup de autenticación por hash. NO tenant-scopeado a propósito: establece el
 * contexto de tenant. Solo devuelve keys 'active' (revocadas no autentican).
 */
export async function findByHash(
  keyHash: string,
  exec: Executor = pool
): Promise<ApiKey | null> {
  const res = await exec.query<ApiKeyRow>(
    "SELECT * FROM api_keys WHERE key_hash = $1 AND status = 'active'",
    [keyHash]
  );
  return res.rows[0] ? mapApiKey(res.rows[0]) : null;
}

export async function getById(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<ApiKey | null> {
  const res = await exec.query<ApiKeyRow>(
    "SELECT * FROM api_keys WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return res.rows[0] ? mapApiKey(res.rows[0]) : null;
}

export async function listByTenant(
  tenantId: string,
  exec: Executor = pool
): Promise<ApiKey[]> {
  const res = await exec.query<ApiKeyRow>(
    "SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC",
    [tenantId]
  );
  return res.rows.map(mapApiKey);
}

/** Marca last_used_at = now(). Scopeado por tenant para no cruzar tenants. */
export async function touchLastUsed(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<void> {
  await exec.query(
    "UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
}

export async function revoke(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<ApiKey | null> {
  const res = await exec.query<ApiKeyRow>(
    `UPDATE api_keys SET status = 'revoked'
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [id, tenantId]
  );
  return res.rows[0] ? mapApiKey(res.rows[0]) : null;
}
