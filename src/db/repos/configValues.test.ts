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
