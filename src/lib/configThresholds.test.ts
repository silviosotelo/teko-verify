import { describe, it, expect } from "vitest";
import type { Executor } from "../db/executor";
import { resolveThresholds, withResolvedThresholds } from "./configThresholds";
import { MATCH_THRESHOLD, LIVENESS_THRESHOLD, GLASSES_MAX } from "../config";
import type { TenantPolicy } from "../types";

function execWith(values: Partial<Record<string, number>>): Executor {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      const norm = text.replace(/\s+/g, " ").trim();
      if (!/SELECT \* FROM config_values WHERE scope_type = \$1/i.test(norm)) return { rows: [], rowCount: 0 };
      const scopeType = String(params?.[0]);
      const key = String(params?.[params.length - 1]);
      if (scopeType === "system" && key in values) {
        return { rows: [{ id: "s", scope_type: "system", scope_id: null, namespace: "thresholds", key, value: values[key], version: 1, updated_by: "x", updated_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const throwingExec: Executor = {
  async query() { throw new Error("db down"); },
};

const BASE: TenantPolicy = { assuranceRequired: "L2" } as TenantPolicy;

describe("resolveThresholds", () => {
  it("usa el valor del plane cuando existe", async () => {
    const t = await resolveThresholds({ tenantId: "t1" }, execWith({ matchCosine: 0.42, livenessScore: 0.61, qualityGlassesPct: 0.49 }));
    expect(t).toEqual({ matchCosine: 0.42, livenessScore: 0.61, qualityGlassesPct: 0.49 });
  });

  it("fallback a config.ts cuando el plane no tiene la clave", async () => {
    const t = await resolveThresholds({ tenantId: "t1" }, execWith({}));
    expect(t).toEqual({ matchCosine: MATCH_THRESHOLD, livenessScore: LIVENESS_THRESHOLD, qualityGlassesPct: GLASSES_MAX });
  });

  it("FAIL-CLOSED: error de DB → defaults SEGUROS de config.ts (nunca más laxo)", async () => {
    const t = await resolveThresholds({ tenantId: "t1" }, throwingExec);
    expect(t).toEqual({ matchCosine: MATCH_THRESHOLD, livenessScore: LIVENESS_THRESHOLD, qualityGlassesPct: GLASSES_MAX });
  });
});

describe("withResolvedThresholds", () => {
  it("puebla thresholds desde el plane sin tocar el resto de la policy", async () => {
    const out = await withResolvedThresholds(BASE, { tenantId: "t1" }, execWith({ matchCosine: 0.42 }));
    expect(out.assuranceRequired).toBe("L2");
    expect(out.thresholds?.matchCosine).toBe(0.42);
    expect(out.thresholds?.livenessScore).toBe(LIVENESS_THRESHOLD);
  });

  it("NO pisa un override ya presente en la policy (no-breaking)", async () => {
    const withOverride = { ...BASE, thresholds: { matchCosine: 0.99 } } as TenantPolicy;
    const out = await withResolvedThresholds(withOverride, { tenantId: "t1" }, execWith({ matchCosine: 0.42 }));
    expect(out.thresholds?.matchCosine).toBe(0.99);
  });
});
