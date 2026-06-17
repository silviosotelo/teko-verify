import { describe, it, expect } from "vitest";
import type { Executor } from "../executor";
import { resolveAppId, remove, getDefault } from "./apps";

/**
 * Mock de Executor: responde según el SQL. Sin DB — verifica la LÓGICA de
 * App-scoping (fallback a Default, validación cross-tenant, guardas de borrado).
 */
function mockExec(handlers: Array<{ match: RegExp; rows: unknown[]; rowCount?: number }>): Executor {
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

const DEFAULT_APP = {
  id: "app-default",
  tenant_id: "t1",
  name: "Default",
  is_default: true,
  created_at: new Date("2024-01-01T00:00:00Z"),
  updated_at: new Date("2024-01-01T00:00:00Z"),
};
const OTHER_APP = { ...DEFAULT_APP, id: "app-2", name: "Mobile", is_default: false };

describe("apps.resolveAppId — App-scoping con fallback Default", () => {
  it("sin appId → resuelve a la app Default del tenant", async () => {
    const exec = mockExec([{ match: /ORDER BY is_default DESC/i, rows: [DEFAULT_APP] }]);
    expect(await resolveAppId("t1", null, exec)).toBe("app-default");
    expect(await resolveAppId("t1", undefined, exec)).toBe("app-default");
  });

  it("appId válido del tenant → ese app", async () => {
    const exec = mockExec([
      { match: /WHERE tenant_id = \$1 AND id = \$2/i, rows: [OTHER_APP] },
    ]);
    expect(await resolveAppId("t1", "app-2", exec)).toBe("app-2");
  });

  it("FAIL-CLOSED: appId que no pertenece al tenant → app_not_found", async () => {
    const exec = mockExec([{ match: /WHERE tenant_id = \$1 AND id = \$2/i, rows: [] }]);
    await expect(resolveAppId("t1", "app-de-otro-tenant", exec)).rejects.toThrow("app_not_found");
  });

  it("getDefault crea una Default si el tenant no tiene ninguna (fail-safe)", async () => {
    const created = { ...DEFAULT_APP, id: "app-new" };
    const exec = mockExec([
      { match: /SELECT \* FROM apps WHERE tenant_id = \$1 ORDER BY/i, rows: [] },
      { match: /INSERT INTO apps/i, rows: [created] },
    ]);
    const app = await getDefault("t1", exec);
    expect(app.id).toBe("app-new");
    expect(app.isDefault).toBe(true);
  });
});

describe("apps.remove — guardas", () => {
  it("no encuentra la app → not_found", async () => {
    const exec = mockExec([{ match: /WHERE tenant_id = \$1 AND id = \$2/i, rows: [] }]);
    expect(await remove("t1", "nope", exec)).toBe("not_found");
  });

  it("no permite borrar la app Default → is_default", async () => {
    const exec = mockExec([{ match: /WHERE tenant_id = \$1 AND id = \$2/i, rows: [DEFAULT_APP] }]);
    expect(await remove("t1", "app-default", exec)).toBe("is_default");
  });

  it("app en uso (FK 23503) → in_use", async () => {
    const exec: Executor = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async query(text: string): Promise<any> {
        const norm = text.replace(/\s+/g, " ").trim();
        if (/^SELECT \* FROM apps/i.test(norm)) return { rows: [OTHER_APP], rowCount: 1 };
        if (/^DELETE FROM apps/i.test(norm)) {
          const err = new Error("violates foreign key constraint") as Error & { code: string };
          err.code = "23503";
          throw err;
        }
        return { rows: [], rowCount: 0 };
      },
    };
    expect(await remove("t1", "app-2", exec)).toBe("in_use");
  });

  it("app borrable → deleted", async () => {
    const exec = mockExec([
      { match: /SELECT \* FROM apps WHERE tenant_id = \$1 AND id = \$2/i, rows: [OTHER_APP] },
      { match: /DELETE FROM apps/i, rows: [], rowCount: 1 },
    ]);
    expect(await remove("t1", "app-2", exec)).toBe("deleted");
  });
});
