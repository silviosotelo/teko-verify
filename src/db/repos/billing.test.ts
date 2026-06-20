import { describe, it, expect } from "vitest";
import type { Executor } from "../executor";
import * as billingPlans from "./billingPlans";
import * as subscriptions from "./subscriptions";
import * as usageAlerts from "./usageAlerts";
import { countInPeriod } from "./sessions";

/**
 * Mock de Executor (mismo patrón que apps.test.ts): responde según el SQL
 * normalizado. Sin DB — verifica el MAPEO snake→camel y el scoping por tenant.
 */
function mockExec(
  handlers: Array<{ match: RegExp; rows: unknown[]; rowCount?: number }>
): Executor {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string): Promise<any> {
      const norm = text.replace(/\s+/g, " ").trim();
      for (const h of handlers) {
        if (h.match.test(norm)) {
          return { rows: h.rows, rowCount: h.rowCount ?? h.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const NOW = new Date("2026-06-01T00:00:00Z");

describe("billingPlans — mapeo + orden", () => {
  it("list mapea snake→camel y respeta monthlyQuota null", async () => {
    const exec = mockExec([
      {
        match: /SELECT \* FROM billing_plans ORDER BY sort_order/i,
        rows: [
          {
            slug: "free", name: "Free", monthly_quota: 50, price_cents: 0,
            currency: "USD", features: ["50/mes"], is_active: true, sort_order: 0, created_at: NOW,
          },
          {
            slug: "enterprise", name: "Enterprise", monthly_quota: null, price_cents: 0,
            currency: "USD", features: ["Ilimitado"], is_active: true,
            sort_order: 3, created_at: NOW,
          },
        ],
      },
    ]);
    const plans = await billingPlans.list(exec);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({ slug: "free", monthlyQuota: 50, priceCents: 0 });
    expect(plans[1].monthlyQuota).toBeNull();
    expect(plans[1].features).toEqual(["Ilimitado"]);
  });

  it("getBySlug → null si no existe", async () => {
    const exec = mockExec([{ match: /WHERE slug = \$1/i, rows: [] }]);
    expect(await billingPlans.getBySlug("nope", exec)).toBeNull();
  });
});

describe("subscriptions — free implícito + upsert", () => {
  it("getByTenant → null cuando el tenant no tiene fila (free implícito)", async () => {
    const exec = mockExec([{ match: /FROM tenant_subscriptions WHERE tenant_id = \$1/i, rows: [] }]);
    expect(await subscriptions.getByTenant("t1", exec)).toBeNull();
  });

  it("setPlan mapea la fila upsertada", async () => {
    const exec = mockExec([
      {
        match: /INSERT INTO tenant_subscriptions/i,
        rows: [
          {
            tenant_id: "t1", plan_slug: "pro", status: "active",
            period_start: NOW, period_end: new Date("2026-07-01T00:00:00Z"),
            created_at: NOW, updated_at: NOW,
          },
        ],
      },
    ]);
    const sub = await subscriptions.setPlan("t1", "pro", exec);
    expect(sub).toMatchObject({ tenantId: "t1", planSlug: "pro", status: "active" });
    expect(sub.periodStart).toBe(NOW.toISOString());
  });
});

describe("usageAlerts — CRUD + scoping por tenant", () => {
  it("listByTenant mapea y expone lastFiredAt null", async () => {
    const exec = mockExec([
      {
        match: /SELECT \* FROM usage_alerts WHERE tenant_id = \$1/i,
        rows: [
          {
            id: "a1", tenant_id: "t1", threshold_pct: 80, channel: "email",
            target: "ops@x.com", enabled: true, last_fired_at: null, created_at: NOW,
          },
        ],
      },
    ]);
    const alerts = await usageAlerts.listByTenant("t1", exec);
    expect(alerts[0]).toMatchObject({ id: "a1", thresholdPct: 80, channel: "email", enabled: true });
    expect(alerts[0].lastFiredAt).toBeNull();
  });

  it("update → null cuando la alerta no pertenece al tenant (scoping)", async () => {
    const exec = mockExec([{ match: /UPDATE usage_alerts SET/i, rows: [] }]);
    expect(await usageAlerts.update("t1", "otro", { enabled: false }, exec)).toBeNull();
  });

  it("remove → false cuando no borró ninguna fila", async () => {
    const exec = mockExec([{ match: /DELETE FROM usage_alerts/i, rows: [], rowCount: 0 }]);
    expect(await usageAlerts.remove("t1", "nope", exec)).toBe(false);
  });
});

describe("sessions.countInPeriod — metering", () => {
  it("parsea el COUNT(*)::text a número", async () => {
    const exec = mockExec([
      { match: /SELECT COUNT\(\*\)::text AS count FROM verification_sessions WHERE tenant_id = \$1 AND created_at >= \$2 AND created_at < \$3/i, rows: [{ count: "42" }] },
    ]);
    const n = await countInPeriod("t1", "2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z", exec);
    expect(n).toBe(42);
  });
});
