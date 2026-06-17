/**
 * Repositorio de webhook_deliveries (P0 #2) — un intento de entrega por (endpoint,
 * evento). Registra estado/reintentos. `event_id` único = idempotencia (X-Event-Id).
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso, isoOrNull } from "./mapping";
import type {
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  WebhookEvent,
  WebhookEventPayload,
} from "../../types";

interface DeliveryRow {
  id: string;
  endpoint_id: string | null;
  tenant_id: string;
  session_id: string | null;
  event_id: string;
  event_type: WebhookEvent;
  url: string;
  payload: WebhookEventPayload;
  status: WebhookDeliveryStatus;
  attempts: number;
  max_attempts: number;
  response_code: number | null;
  response_body: string | null;
  error: string | null;
  last_attempt_at: Date | null;
  next_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapDelivery(row: DeliveryRow): WebhookDeliveryRecord {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    eventId: row.event_id,
    eventType: row.event_type,
    url: row.url,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    responseCode: row.response_code,
    responseBody: row.response_body,
    error: row.error,
    lastAttemptAt: isoOrNull(row.last_attempt_at),
    nextAttemptAt: isoOrNull(row.next_attempt_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export interface CreateDeliveryInput {
  endpointId: string | null;
  tenantId: string;
  sessionId: string | null;
  eventId: string;
  eventType: WebhookEvent;
  url: string;
  payload: WebhookEventPayload;
  maxAttempts?: number;
}

export async function create(
  input: CreateDeliveryInput,
  exec: Executor = pool
): Promise<WebhookDeliveryRecord> {
  const res = await exec.query<DeliveryRow>(
    `INSERT INTO webhook_deliveries
       (endpoint_id, tenant_id, session_id, event_id, event_type, url, payload, max_attempts, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8, 4), now())
     RETURNING *`,
    [
      input.endpointId,
      input.tenantId,
      input.sessionId,
      input.eventId,
      input.eventType,
      input.url,
      JSON.stringify(input.payload),
      input.maxAttempts ?? null,
    ]
  );
  return mapDelivery(res.rows[0]);
}

export async function getById(
  id: string,
  exec: Executor = pool
): Promise<WebhookDeliveryRecord | null> {
  const res = await exec.query<DeliveryRow>(
    "SELECT * FROM webhook_deliveries WHERE id = $1",
    [id]
  );
  return res.rows[0] ? mapDelivery(res.rows[0]) : null;
}

/** Registra el resultado de un intento (incrementa attempts, fija estado/próximo). */
export interface RecordAttemptInput {
  status: WebhookDeliveryStatus;
  responseCode?: number | null;
  responseBody?: string | null;
  error?: string | null;
  /** ms hasta el próximo reintento (null = no reprogramar). */
  nextAttemptInMs?: number | null;
}

export async function recordAttempt(
  id: string,
  input: RecordAttemptInput,
  exec: Executor = pool
): Promise<WebhookDeliveryRecord | null> {
  const next =
    input.nextAttemptInMs != null
      ? new Date(Date.now() + input.nextAttemptInMs)
      : null;
  const res = await exec.query<DeliveryRow>(
    `UPDATE webhook_deliveries SET
       attempts        = attempts + 1,
       status          = $2,
       response_code   = $3,
       response_body   = $4,
       error           = $5,
       last_attempt_at = now(),
       next_attempt_at = $6,
       updated_at      = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.status,
      input.responseCode ?? null,
      input.responseBody ?? null,
      input.error ?? null,
      next,
    ]
  );
  return res.rows[0] ? mapDelivery(res.rows[0]) : null;
}

/** Entregas de un endpoint (log para el admin). */
export async function listByEndpoint(
  tenantId: string,
  endpointId: string,
  opts: { limit?: number; offset?: number } = {},
  exec: Executor = pool
): Promise<WebhookDeliveryRecord[]> {
  const res = await exec.query<DeliveryRow>(
    `SELECT * FROM webhook_deliveries
     WHERE tenant_id = $1 AND endpoint_id = $2
     ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [tenantId, endpointId, opts.limit ?? 100, opts.offset ?? 0]
  );
  return res.rows.map(mapDelivery);
}

/**
 * Entregas pendientes/fallidas cuyo next_attempt_at ya venció (recuperación tras
 * reinicio del proceso: el worker in-memory pierde los timers). Acotado a `limit`.
 */
export async function listDue(
  limit = 50,
  exec: Executor = pool
): Promise<WebhookDeliveryRecord[]> {
  const res = await exec.query<DeliveryRow>(
    `SELECT * FROM webhook_deliveries
     WHERE status IN ('pending', 'failed')
       AND attempts < max_attempts
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );
  return res.rows.map(mapDelivery);
}
