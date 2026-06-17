/**
 * Repositorio de webhook_endpoints (P0 #2) — destinos (suscripciones) por tenant.
 * Scopeado por tenant. El secreto se genera al crear (generateWebhookSecret) y se
 * persiste; sólo se EXPONE en la respuesta de creación (una vez).
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type { WebhookEndpoint, WebhookEvent } from "../../types";

interface EndpointRow {
  id: string;
  tenant_id: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  description: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    url: row.url,
    secret: row.secret,
    events: row.events ?? [],
    description: row.description,
    enabled: row.enabled,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export interface CreateEndpointInput {
  tenantId: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  description?: string | null;
  enabled?: boolean;
}

export async function create(
  input: CreateEndpointInput,
  exec: Executor = pool
): Promise<WebhookEndpoint> {
  const res = await exec.query<EndpointRow>(
    `INSERT INTO webhook_endpoints (tenant_id, url, secret, events, description, enabled)
     VALUES ($1, $2, $3, $4::text[], $5, COALESCE($6, true))
     RETURNING *`,
    [
      input.tenantId,
      input.url,
      input.secret,
      input.events,
      input.description ?? null,
      input.enabled ?? null,
    ]
  );
  return mapEndpoint(res.rows[0]);
}

export async function listByTenant(
  tenantId: string,
  exec: Executor = pool
): Promise<WebhookEndpoint[]> {
  const res = await exec.query<EndpointRow>(
    "SELECT * FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC",
    [tenantId]
  );
  return res.rows.map(mapEndpoint);
}

/** Destinos HABILITADOS de un tenant (para resolver a quién entregar un evento). */
export async function listEnabledByTenant(
  tenantId: string,
  exec: Executor = pool
): Promise<WebhookEndpoint[]> {
  const res = await exec.query<EndpointRow>(
    "SELECT * FROM webhook_endpoints WHERE tenant_id = $1 AND enabled = true",
    [tenantId]
  );
  return res.rows.map(mapEndpoint);
}

export async function getById(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<WebhookEndpoint | null> {
  const res = await exec.query<EndpointRow>(
    "SELECT * FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return res.rows[0] ? mapEndpoint(res.rows[0]) : null;
}

export interface UpdateEndpointInput {
  url?: string;
  events?: WebhookEvent[];
  description?: string | null;
  enabled?: boolean;
}

export async function update(
  tenantId: string,
  id: string,
  patch: UpdateEndpointInput,
  exec: Executor = pool
): Promise<WebhookEndpoint | null> {
  const res = await exec.query<EndpointRow>(
    `UPDATE webhook_endpoints SET
       url         = COALESCE($3, url),
       events      = COALESCE($4::text[], events),
       description = COALESCE($5, description),
       enabled     = COALESCE($6, enabled),
       updated_at  = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [
      id,
      tenantId,
      patch.url ?? null,
      patch.events ?? null,
      patch.description ?? null,
      patch.enabled ?? null,
    ]
  );
  return res.rows[0] ? mapEndpoint(res.rows[0]) : null;
}

export async function remove(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<boolean> {
  const res = await exec.query(
    "DELETE FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return (res.rowCount ?? 0) > 0;
}
