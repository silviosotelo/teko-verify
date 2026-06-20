/**
 * Repositorio de usage_alerts (Sprint 1 — monetización-lite).
 *
 * Alertas de consumo por umbral (% de la cuota) por tenant. TODO scopeado por
 * tenant_id (aislamiento multi-tenant: el alertId siempre se cruza con tenant_id).
 * Los CHECKs de dominio (threshold 1..100, channel ∈ {email,webhook}) viven en DDL.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso, isoOrNull } from "./mapping";
import type { UsageAlert, UsageAlertChannel } from "../../types";

interface UsageAlertRow {
  id: string;
  tenant_id: string;
  threshold_pct: number;
  channel: UsageAlertChannel;
  target: string;
  enabled: boolean;
  last_fired_at: Date | null;
  created_at: Date;
}

function mapAlert(row: UsageAlertRow): UsageAlert {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    thresholdPct: row.threshold_pct,
    channel: row.channel,
    target: row.target,
    enabled: row.enabled,
    lastFiredAt: isoOrNull(row.last_fired_at),
    createdAt: iso(row.created_at),
  };
}

export async function listByTenant(
  tenantId: string,
  exec: Executor = pool
): Promise<UsageAlert[]> {
  const res = await exec.query<UsageAlertRow>(
    "SELECT * FROM usage_alerts WHERE tenant_id = $1 ORDER BY threshold_pct ASC, created_at ASC",
    [tenantId]
  );
  return res.rows.map(mapAlert);
}

export async function create(
  input: {
    tenantId: string;
    thresholdPct: number;
    channel: UsageAlertChannel;
    target: string;
    enabled?: boolean;
  },
  exec: Executor = pool
): Promise<UsageAlert> {
  const res = await exec.query<UsageAlertRow>(
    `INSERT INTO usage_alerts (tenant_id, threshold_pct, channel, target, enabled)
     VALUES ($1, $2, $3, $4, COALESCE($5, true))
     RETURNING *`,
    [input.tenantId, input.thresholdPct, input.channel, input.target, input.enabled ?? null]
  );
  return mapAlert(res.rows[0]);
}

/**
 * Update parcial scopeado por (tenant_id, id). Devuelve la fila o null si no existe
 * (o pertenece a otro tenant). Sólo se tocan los campos provistos.
 */
export async function update(
  tenantId: string,
  id: string,
  patch: {
    thresholdPct?: number;
    channel?: UsageAlertChannel;
    target?: string;
    enabled?: boolean;
  },
  exec: Executor = pool
): Promise<UsageAlert | null> {
  const res = await exec.query<UsageAlertRow>(
    `UPDATE usage_alerts SET
       threshold_pct = COALESCE($3, threshold_pct),
       channel       = COALESCE($4, channel),
       target        = COALESCE($5, target),
       enabled       = COALESCE($6, enabled)
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [
      id,
      tenantId,
      patch.thresholdPct ?? null,
      patch.channel ?? null,
      patch.target ?? null,
      patch.enabled ?? null,
    ]
  );
  return res.rows[0] ? mapAlert(res.rows[0]) : null;
}

/** Borra la alerta (scopeada por tenant). true si borró una fila. */
export async function remove(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<boolean> {
  const res = await exec.query(
    "DELETE FROM usage_alerts WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return (res.rowCount ?? 0) > 0;
}
