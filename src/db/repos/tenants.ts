/**
 * Repositorio de tenants (§5).
 *
 * tenants NO tiene tenant_id: se scopea por su propio `id`. Es la única tabla raíz.
 * `policies` es JSONB tipado como TenantPolicy (pg lo parsea/serializa solo).
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import { generateWebhookSecret } from "../../lib/crypto";
import type { Tenant, TenantPolicy, TenantStatus } from "../../types";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  policies: TenantPolicy;
  webhook_secret: string;
  created_at: Date;
  updated_at: Date;
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    policies: row.policies,
    webhookSecret: row.webhook_secret,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  status?: TenantStatus;
  policies: TenantPolicy;
}

export interface UpdateTenantInput {
  name?: string;
  status?: TenantStatus;
  policies?: TenantPolicy;
}

export async function create(
  input: CreateTenantInput,
  exec: Executor = pool
): Promise<Tenant> {
  // Secreto HMAC propio del tenant para firmar SUS webhooks (§8). Se genera al
  // crear el tenant; nunca se expone al titular ni en TenantResponse.
  const webhookSecret = generateWebhookSecret();
  const res = await exec.query<TenantRow>(
    `INSERT INTO tenants (name, slug, status, policies, webhook_secret)
     VALUES ($1, $2, COALESCE($3, 'active'), $4::jsonb, $5)
     RETURNING *`,
    [
      input.name,
      input.slug,
      input.status ?? null,
      JSON.stringify(input.policies),
      webhookSecret,
    ]
  );
  return mapTenant(res.rows[0]);
}

export async function getById(
  id: string,
  exec: Executor = pool
): Promise<Tenant | null> {
  const res = await exec.query<TenantRow>("SELECT * FROM tenants WHERE id = $1", [id]);
  return res.rows[0] ? mapTenant(res.rows[0]) : null;
}

export async function getBySlug(
  slug: string,
  exec: Executor = pool
): Promise<Tenant | null> {
  const res = await exec.query<TenantRow>("SELECT * FROM tenants WHERE slug = $1", [
    slug,
  ]);
  return res.rows[0] ? mapTenant(res.rows[0]) : null;
}

export async function list(
  opts: { limit?: number; offset?: number } = {},
  exec: Executor = pool
): Promise<Tenant[]> {
  const res = await exec.query<TenantRow>(
    "SELECT * FROM tenants ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [opts.limit ?? 100, opts.offset ?? 0]
  );
  return res.rows.map(mapTenant);
}

export async function update(
  id: string,
  patch: UpdateTenantInput,
  exec: Executor = pool
): Promise<Tenant | null> {
  const res = await exec.query<TenantRow>(
    `UPDATE tenants SET
       name      = COALESCE($2, name),
       status    = COALESCE($3, status),
       policies  = COALESCE($4::jsonb, policies),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      patch.name ?? null,
      patch.status ?? null,
      patch.policies !== undefined ? JSON.stringify(patch.policies) : null,
    ]
  );
  return res.rows[0] ? mapTenant(res.rows[0]) : null;
}

export async function remove(id: string, exec: Executor = pool): Promise<boolean> {
  const res = await exec.query("DELETE FROM tenants WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}
