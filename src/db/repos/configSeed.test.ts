import { describe, it, expect } from "vitest";
import type { Executor } from "../executor";
import { resolveConfig } from "./configValues";
import { MATCH_THRESHOLD, LIVENESS_THRESHOLD, GLASSES_MAX } from "../../config";

/**
 * Mock del estado POST-seed (migración 0020): sólo el system scope tiene filas, con
 * los valores espejo de config.ts. Verifica que un tenant SIN overrides resuelve a
 * los defaults del system, y que el seed NO derivó de config.ts (mismo número).
 */
function seededSystemExec(): Executor {
  const seed: Record<string, number> = {
    matchCosine: 0.4,
    livenessScore: 0.6,
    qualityGlassesPct: 0.5,
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      const norm = text.replace(/\s+/g, " ").trim();
      if (!/SELECT \* FROM config_values WHERE scope_type = \$1/i.test(norm)) return { rows: [], rowCount: 0 };
      const scopeType = String(params?.[0]);
      const key = String(params?.[params.length - 1]);
      if (scopeType === "system" && key in seed) {
        return { rows: [{ id: "s", scope_type: "system", scope_id: null, namespace: "thresholds", key, value: seed[key], version: 1, updated_by: "system:seed", updated_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe("system seed mirrors config.ts", () => {
  const scope = { tenantId: "t-fresh" }; // tenant sin overrides

  it("matchCosine system == MATCH_THRESHOLD default (0.40)", async () => {
    expect(MATCH_THRESHOLD).toBe(0.4); // guard de drift del default de código
    expect(await resolveConfig<number>("thresholds", "matchCosine", scope, seededSystemExec())).toBe(0.4);
  });

  it("livenessScore system == LIVENESS_THRESHOLD default (0.60)", async () => {
    expect(LIVENESS_THRESHOLD).toBe(0.6);
    expect(await resolveConfig<number>("thresholds", "livenessScore", scope, seededSystemExec())).toBe(0.6);
  });

  it("qualityGlassesPct system == GLASSES_MAX default (0.50)", async () => {
    expect(GLASSES_MAX).toBe(0.5);
    expect(await resolveConfig<number>("thresholds", "qualityGlassesPct", scope, seededSystemExec())).toBe(0.5);
  });
});
