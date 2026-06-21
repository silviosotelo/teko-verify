import { describe, it, expect } from "vitest";
import type { Executor } from "../executor";
import * as configValues from "./configValues";

/**
 * Mock de Executor (mismo patrón que billing.test.ts): responde según el SQL
 * normalizado y captura las queries emitidas para verificar el versionado + audit.
 */
function mockExec(
  handlers: Array<{ match: RegExp; rows: unknown[]; rowCount?: number }>,
  sink?: string[]
): Executor {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string): Promise<any> {
      const norm = text.replace(/\s+/g, " ").trim();
      if (sink) sink.push(norm);
      for (const h of handlers) {
        if (h.match.test(norm)) return { rows: h.rows, rowCount: h.rowCount ?? h.rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const NOW = new Date("2026-06-21T00:00:00Z");

describe("configValues.getCurrent", () => {
  it("mapea snake→camel y devuelve la fila vigente", async () => {
    const exec = mockExec([
      {
        match: /SELECT \* FROM config_values WHERE scope_type = \$1/i,
        rows: [{
          id: "c1", scope_type: "system", scope_id: null, namespace: "thresholds",
          key: "matchCosine", value: 0.4, version: 1, updated_by: "system:seed", updated_at: NOW,
        }],
      },
    ]);
    const row = await configValues.getCurrent("system", null, "thresholds", "matchCosine", exec);
    expect(row).toMatchObject({ scopeType: "system", scopeId: null, key: "matchCosine", value: 0.4, version: 1 });
    expect(row!.updatedAt).toBe(NOW.toISOString());
  });

  it("devuelve null cuando no hay fila", async () => {
    const exec = mockExec([{ match: /SELECT \* FROM config_values/i, rows: [] }]);
    expect(await configValues.getCurrent("tenant", "t1", "thresholds", "matchCosine", exec)).toBeNull();
  });
});

describe("configValues.set", () => {
  it("crea version = max+1 e inserta config_audit con before/after", async () => {
    const sink: string[] = [];
    const exec = mockExec([
      { match: /SELECT MAX\(version\) AS v FROM config_values/i, rows: [{ v: 2 }] },
      { match: /SELECT value FROM config_values WHERE/i, rows: [{ value: 0.4 }] },
      {
        match: /INSERT INTO config_values/i,
        rows: [{
          id: "c9", scope_type: "tenant", scope_id: "t1", namespace: "thresholds",
          key: "matchCosine", value: 0.5, version: 3, updated_by: "admin:op1", updated_at: NOW,
        }],
      },
    ], sink);

    const out = await configValues.set(
      { scopeType: "tenant", scopeId: "t1", namespace: "thresholds", key: "matchCosine", value: 0.5, actor: "admin:op1" },
      exec
    );

    expect(out).toMatchObject({ scopeType: "tenant", scopeId: "t1", value: 0.5, version: 3 });
    // Auditoría ininterrumpible: set() SIEMPRE inserta en config_audit.
    expect(sink.some((q) => /INSERT INTO config_audit/i.test(q))).toBe(true);
  });

  it("primera versión (max null) → version 1, before null", async () => {
    const exec = mockExec([
      { match: /SELECT MAX\(version\) AS v FROM config_values/i, rows: [{ v: null }] },
      { match: /SELECT value FROM config_values WHERE/i, rows: [] },
      {
        match: /INSERT INTO config_values/i,
        rows: [{
          id: "c1", scope_type: "app", scope_id: "a1", namespace: "thresholds",
          key: "livenessScore", value: 0.7, version: 1, updated_by: "admin:op1", updated_at: NOW,
        }],
      },
    ]);
    const out = await configValues.set(
      { scopeType: "app", scopeId: "a1", namespace: "thresholds", key: "livenessScore", value: 0.7, actor: "admin:op1" },
      exec
    );
    expect(out.version).toBe(1);
  });
});

describe("configValues.listByScope", () => {
  it("lista la versión vigente por (namespace,key) del scope", async () => {
    const exec = mockExec([
      {
        match: /FROM config_values .* DISTINCT ON|SELECT DISTINCT ON .* FROM config_values/i,
        rows: [
          { id: "c1", scope_type: "tenant", scope_id: "t1", namespace: "thresholds", key: "matchCosine", value: 0.42, version: 2, updated_by: "admin:op1", updated_at: NOW },
        ],
      },
    ]);
    const rows = await configValues.listByScope("tenant", "t1", exec);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "matchCosine", value: 0.42, version: 2 });
  });
});

describe("resolveConfig — cascada workflow→app→tenant→system", () => {
  // Mock que responde getCurrent según el scope_type embebido en params.
  function cascadeExec(present: Record<string, number>): Executor {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async query(text: string, params?: unknown[]): Promise<any> {
        const norm = text.replace(/\s+/g, " ").trim();
        if (!/SELECT \* FROM config_values WHERE scope_type = \$1/i.test(norm)) {
          return { rows: [], rowCount: 0 };
        }
        const scopeType = String(params?.[0]);
        if (scopeType in present) {
          return {
            rows: [{
              id: scopeType, scope_type: scopeType, scope_id: scopeType === "system" ? null : `${scopeType}-id`,
              namespace: "thresholds", key: "matchCosine", value: present[scopeType],
              version: 1, updated_by: "x", updated_at: new Date(),
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };
  }

  const scope = { tenantId: "t1", appId: "a1", workflowId: "w1" };

  it("herencia: sólo system seeded → devuelve el valor system", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({ system: 0.4 }));
    expect(v).toBe(0.4);
  });

  it("override tenant gana sobre system", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({ system: 0.4, tenant: 0.45 }));
    expect(v).toBe(0.45);
  });

  it("override app gana sobre tenant y system", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({ system: 0.4, tenant: 0.45, app: 0.5 }));
    expect(v).toBe(0.5);
  });

  it("override workflow gana sobre todos (más específico)", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({ system: 0.4, tenant: 0.45, app: 0.5, workflow: 0.6 }));
    expect(v).toBe(0.6);
  });

  it("sin ninguna fila → undefined (el caller hace ?? config.ts)", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({}));
    expect(v).toBeUndefined();
  });

  it("salta niveles sin id: scope sólo-tenant no consulta app/workflow", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", { tenantId: "t1" }, cascadeExec({ system: 0.4, tenant: 0.45 }));
    expect(v).toBe(0.45);
  });
});
