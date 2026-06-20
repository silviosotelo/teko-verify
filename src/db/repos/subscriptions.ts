/**
 * Repositorio de tenant_subscriptions (Sprint 1 — monetización-lite).
 *
 * Suscripción 1:1 por tenant (tenant_id = PK). Los tenants SIN fila se tratan como
 * plan 'free' implícito: `getByTenant` devuelve null y la capa de billing aplica el
 * default. `setPlan` hace upsert (idempotente por tenant_id) y RESETEA la ventana de
 * cuota al período actual (now()..now()+1 mes). Scopeado por tenant_id.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type { SubscriptionStatus, TenantSubscription } from "../../types";

interface SubscriptionRow {
  tenant_id: string;
  plan_slug: string;
  status: SubscriptionStatus;
  period_start: Date;
  period_end: Date;
  created_at: Date;
  updated_at: Date;
}

function mapSubscription(row: SubscriptionRow): TenantSubscription {
  return {
    tenantId: row.tenant_id,
    planSlug: row.plan_slug,
    status: row.status,
    periodStart: iso(row.period_start),
    periodEnd: iso(row.period_end),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** Suscripción del tenant, o null si no tiene (→ plan 'free' implícito). */
export async function getByTenant(
  tenantId: string,
  exec: Executor = pool
): Promise<TenantSubscription | null> {
  const res = await exec.query<SubscriptionRow>(
    "SELECT * FROM tenant_subscriptions WHERE tenant_id = $1",
    [tenantId]
  );
  return res.rows[0] ? mapSubscription(res.rows[0]) : null;
}

/**
 * Upsert del plan del tenant (idempotente por tenant_id). Al (re)asignar un plan se
 * RESETEA la ventana de cuota al período actual y el status vuelve a 'active'.
 */
export async function setPlan(
  tenantId: string,
  planSlug: string,
  exec: Executor = pool
): Promise<TenantSubscription> {
  const res = await exec.query<SubscriptionRow>(
    `INSERT INTO tenant_subscriptions (tenant_id, plan_slug, status, period_start, period_end)
     VALUES ($1, $2, 'active', now(), now() + interval '1 month')
     ON CONFLICT (tenant_id) DO UPDATE
       SET plan_slug    = EXCLUDED.plan_slug,
           status       = 'active',
           period_start = now(),
           period_end   = now() + interval '1 month',
           updated_at   = now()
     RETURNING *`,
    [tenantId, planSlug]
  );
  return mapSubscription(res.rows[0]);
}

/**
 * Garantiza que exista una fila para el tenant (default 'free' si no había). Útil
 * para materializar la suscripción sin cambiar de plan. Idempotente.
 */
export async function ensure(
  tenantId: string,
  exec: Executor = pool
): Promise<TenantSubscription> {
  const res = await exec.query<SubscriptionRow>(
    `INSERT INTO tenant_subscriptions (tenant_id, plan_slug)
     VALUES ($1, 'free')
     ON CONFLICT (tenant_id) DO UPDATE SET updated_at = tenant_subscriptions.updated_at
     RETURNING *`,
    [tenantId]
  );
  return mapSubscription(res.rows[0]);
}
