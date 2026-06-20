/**
 * Billing / metering (Sprint 1 — monetización-lite, SIN pasarela de pagos).
 *
 * Punto único de resolución de plan + uso por período. Lo consumen TANTO el gate de
 * POST /v1/sessions (bloqueo 402 por cuota) COMO el endpoint admin GET subscription,
 * para que `used/quota/periodStart/periodEnd` siempre coincidan (una sola fuente).
 *
 * Reglas:
 *   - Tenant SIN fila de suscripción ⇒ plan 'free' implícito + ventana = MES CALENDARIO
 *     actual (UTC). Con fila ⇒ su plan + su [period_start, period_end).
 *   - `monthlyQuota` null ⇒ ILIMITADO (nunca bloquea).
 *   - Cuenta sesiones por created_at en la ventana, CUALQUIER estado (igual que el
 *     endpoint de usage). Se cuenta ANTES de crear y se bloquea con used >= quota.
 */
import { repos } from "../db/repos";
import type { BillingPlan, TenantSubscription } from "../types";

/** slug del plan por defecto cuando el tenant no tiene suscripción. */
export const DEFAULT_PLAN_SLUG = "free";

/** Estado consolidado de cuota de un tenant (lo que consumen gate y admin). */
export interface QuotaStatus {
  subscription: TenantSubscription | null;
  plan: BillingPlan;
  used: number;
  /** Cuota mensual del plan; null = ilimitado. */
  quota: number | null;
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
  /** true si la cuota está agotada (used >= quota). false si ilimitado. */
  exceeded: boolean;
}

/**
 * Decisión PURA de gating (testeable sin DB): ¿el uso agota la cuota?
 * quota null (ilimitado) ⇒ nunca. Permite exactamente `quota` creaciones por período
 * (bloquea cuando used >= quota).
 */
export function isQuotaExceeded(used: number, quota: number | null): boolean {
  if (quota === null) return false;
  return used >= quota;
}

/** Ventana del mes calendario actual (UTC) como [inicio, fin) en ISO 8601. */
export function currentCalendarMonth(now: Date = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

/**
 * Cuenta las verificaciones del tenant en [periodStart, periodEnd) (ISO 8601).
 * Delegado en el repo de sesiones (mismo criterio que el endpoint de usage).
 */
export async function getUsageForPeriod(
  tenantId: string,
  periodStart: string,
  periodEnd: string
): Promise<number> {
  return repos.sessions.countInPeriod(tenantId, periodStart, periodEnd);
}

/**
 * Resuelve plan + suscripción + ventana del tenant. Sin fila ⇒ plan 'free' + mes
 * calendario. Si el plan referenciado no existe (catálogo incompleto), cae a 'free'.
 */
async function resolvePlan(tenantId: string): Promise<{
  subscription: TenantSubscription | null;
  plan: BillingPlan;
  periodStart: string;
  periodEnd: string;
}> {
  const subscription = await repos.subscriptions.getByTenant(tenantId);
  if (subscription) {
    const plan =
      (await repos.billingPlans.getBySlug(subscription.planSlug)) ??
      (await repos.billingPlans.getBySlug(DEFAULT_PLAN_SLUG));
    if (plan) {
      return {
        subscription,
        plan,
        periodStart: subscription.periodStart,
        periodEnd: subscription.periodEnd,
      };
    }
  }
  // Sin suscripción (o catálogo sin 'free'): free implícito + mes calendario actual.
  const free = await repos.billingPlans.getBySlug(DEFAULT_PLAN_SLUG);
  const { periodStart, periodEnd } = currentCalendarMonth();
  const plan: BillingPlan = free ?? {
    slug: DEFAULT_PLAN_SLUG,
    name: "Free",
    monthlyQuota: 50,
    priceCents: 0,
    currency: "USD",
    features: [],
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(0).toISOString(),
  };
  return { subscription: null, plan, periodStart, periodEnd };
}

/**
 * Estado de cuota completo del tenant: plan + suscripción + uso del período. Fuente
 * ÚNICA para el gate del POST y el GET admin de suscripción.
 */
export async function getQuotaStatus(tenantId: string): Promise<QuotaStatus> {
  const { subscription, plan, periodStart, periodEnd } = await resolvePlan(tenantId);
  const used = await getUsageForPeriod(tenantId, periodStart, periodEnd);
  const quota = plan.monthlyQuota;
  return {
    subscription,
    plan,
    used,
    quota,
    periodStart,
    periodEnd,
    exceeded: isQuotaExceeded(used, quota),
  };
}
