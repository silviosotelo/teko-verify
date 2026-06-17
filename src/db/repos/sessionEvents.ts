/**
 * Repositorio de session_events (P0 #3) — timeline forense + Device & IP.
 *
 * Append-only (sin update/delete): cada paso del flujo deja una fila con su
 * contexto de red/dispositivo. Scopeado por tenant; FK CASCADE a la sesión.
 *
 * `recordSafe` es el seam FAIL-OPEN del registro: registrar un evento NUNCA debe
 * romper la captura/pipeline (a diferencia de la lógica de seguridad, que es
 * fail-closed). Cualquier excepción se traga y se loguea.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type { ParsedDevice, SessionEvent } from "../../types";

interface SessionEventRow {
  id: string;
  session_id: string;
  tenant_id: string;
  type: string;
  ip: string | null;
  country: string | null;
  user_agent: string | null;
  device: ParsedDevice | Record<string, never>;
  meta: Record<string, unknown>;
  created_at: Date;
}

function mapEvent(row: SessionEventRow): SessionEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    type: row.type,
    ip: row.ip,
    country: row.country,
    userAgent: row.user_agent,
    device: row.device ?? {},
    meta: row.meta ?? {},
    createdAt: iso(row.created_at),
  };
}

export interface CreateSessionEventInput {
  tenantId: string;
  sessionId: string;
  type: string;
  ip?: string | null;
  country?: string | null;
  userAgent?: string | null;
  device?: ParsedDevice | Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

export async function record(
  input: CreateSessionEventInput,
  exec: Executor = pool
): Promise<SessionEvent> {
  const res = await exec.query<SessionEventRow>(
    `INSERT INTO session_events
       (tenant_id, session_id, type, ip, country, user_agent, device, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     RETURNING *`,
    [
      input.tenantId,
      input.sessionId,
      input.type,
      input.ip ?? null,
      input.country ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.device ?? {}),
      JSON.stringify(input.meta ?? {}),
    ]
  );
  return mapEvent(res.rows[0]);
}

/**
 * Variante FAIL-OPEN de `record`: jamás lanza. Devuelve la fila creada o null si
 * el registro falló (loguea el motivo). Úsese en los puntos del flujo de captura/
 * pipeline donde registrar el evento es ADITIVO y nunca debe abortar el paso real.
 */
export async function recordSafe(
  input: CreateSessionEventInput,
  exec: Executor = pool
): Promise<SessionEvent | null> {
  try {
    return await record(input, exec);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[session_events] registro fail-open omitido (${input.type}): ${(e as Error).message}`);
    return null;
  }
}

export async function listBySession(
  tenantId: string,
  sessionId: string,
  exec: Executor = pool
): Promise<SessionEvent[]> {
  const res = await exec.query<SessionEventRow>(
    `SELECT * FROM session_events
     WHERE tenant_id = $1 AND session_id = $2
     ORDER BY created_at ASC`,
    [tenantId, sessionId]
  );
  return res.rows.map(mapEvent);
}
