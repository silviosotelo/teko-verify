/**
 * Repositorio de billing_plans (catálogo GLOBAL de planes — Sprint 1).
 *
 * NO es multi-tenant: el catálogo es único para toda la plataforma (lo siembra la
 * migración 0018). `slug` es la PK estable que referencian las suscripciones.
 * `monthly_quota` NULL = ilimitado. Sólo lectura desde la app (el catálogo se
 * gestiona por migración/seed; no hay create/update vía API en este sprint).
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type { BillingPlan } from "../../types";

interface BillingPlanRow {
  slug: string;
  name: string;
  monthly_quota: number | null;
  price_cents: number;
  currency: string;
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at: Date;
}

function mapPlan(row: BillingPlanRow): BillingPlan {
  return {
    slug: row.slug,
    name: row.name,
    monthlyQuota: row.monthly_quota ?? null,
    priceCents: row.price_cents,
    currency: row.currency,
    features: Array.isArray(row.features) ? row.features : [],
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: iso(row.created_at),
  };
}

/** Catálogo completo, ordenado por `sort_order` (presentación del pricing). */
export async function list(exec: Executor = pool): Promise<BillingPlan[]> {
  const res = await exec.query<BillingPlanRow>(
    "SELECT * FROM billing_plans ORDER BY sort_order ASC, slug ASC"
  );
  return res.rows.map(mapPlan);
}

/** Plan por slug (null si no existe). */
export async function getBySlug(
  slug: string,
  exec: Executor = pool
): Promise<BillingPlan | null> {
  const res = await exec.query<BillingPlanRow>(
    "SELECT * FROM billing_plans WHERE slug = $1",
    [slug]
  );
  return res.rows[0] ? mapPlan(res.rows[0]) : null;
}
