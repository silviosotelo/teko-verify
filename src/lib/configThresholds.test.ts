import { describe, it, expect } from "vitest";
import type { Executor } from "../db/executor";
import { resolveThresholds, withResolvedThresholds } from "./configThresholds";
import { applyWorkflowToPolicy } from "./workflow";
import { MATCH_THRESHOLD, LIVENESS_THRESHOLD, GLASSES_MAX } from "../config";
import type { TenantPolicy } from "../types";

function execWith(values: Partial<Record<string, number>>): Executor {
  return execWithRaw(values);
}

/** Variante tipada como unknown para testear coerción de tipos del plane. */
function execWithRaw(values: Partial<Record<string, unknown>>): Executor {
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

// ---------------------------------------------------------------------------
// Hallazgo 1 — coerción de tipo en resolveThresholds
// ---------------------------------------------------------------------------
describe("resolveThresholds — coerción de tipo (H1)", () => {
  it("acepta string numérico del plane y lo coerciona a number (ej. '0.82')", async () => {
    const t = await resolveThresholds(
      { tenantId: "t1" },
      execWithRaw({ matchCosine: "0.82", livenessScore: "0.61", qualityGlassesPct: "0.49" })
    );
    expect(t.matchCosine).toBe(0.82);
    expect(t.livenessScore).toBe(0.61);
    expect(t.qualityGlassesPct).toBe(0.49);
  });

  it("FAIL-CLOSED: string vacío → fallback seguro (nunca 0, el umbral más laxo)", async () => {
    const t = await resolveThresholds(
      { tenantId: "t1" },
      execWithRaw({ matchCosine: "", livenessScore: "  ", qualityGlassesPct: "" })
    );
    expect(t.matchCosine).toBe(MATCH_THRESHOLD);
    expect(t.livenessScore).toBe(LIVENESS_THRESHOLD);
    expect(t.qualityGlassesPct).toBe(GLASSES_MAX);
  });

  it("FAIL-CLOSED: string no-numérico ('abc') → fallback seguro", async () => {
    const t = await resolveThresholds(
      { tenantId: "t1" },
      execWithRaw({ matchCosine: "abc" })
    );
    expect(t.matchCosine).toBe(MATCH_THRESHOLD);
  });

  it("FAIL-CLOSED: NaN → fallback seguro", async () => {
    const t = await resolveThresholds(
      { tenantId: "t1" },
      execWithRaw({ matchCosine: NaN })
    );
    expect(t.matchCosine).toBe(MATCH_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// Hallazgo 2 — precedencia: workflow.definition ?? plane ?? config.ts (H2)
//
// End-to-end sobre las funciones reales: withResolvedThresholds (plane→policy) +
// applyWorkflowToPolicy (workflow→policy). La policy BASE no tiene thresholds
// explícitos, así que 0.75 viene EXCLUSIVAMENTE del plane; luego el workflow def
// con match.threshold=0.99 debe ganar.
// ---------------------------------------------------------------------------
describe("precedencia workflow ?? plane ?? config.ts (H2)", () => {
  it("workflow.definition.match.threshold gana sobre el valor del plane en matchCosine", async () => {
    // 1) Plane: matchCosine = 0.75 (vía sistema). BASE no tiene thresholds propios.
    const policyWithPlane = await withResolvedThresholds(
      BASE,
      { tenantId: "t1" },
      execWith({ matchCosine: 0.75, livenessScore: 0.61, qualityGlassesPct: 0.45 })
    );
    // Verificar que el plane se aplicó.
    expect(policyWithPlane.thresholds?.matchCosine).toBe(0.75);

    // 2) Workflow: match.threshold = 0.99.
    const effectivePolicy = applyWorkflowToPolicy(policyWithPlane, {
      document: { required: true },
      match: { required: true, threshold: 0.99 },
      quality: {},
      review: { mode: "auto" },
    });

    // El workflow debe ganar sobre el plane.
    expect(effectivePolicy.thresholds?.matchCosine).toBe(0.99);
    // El resto de los thresholds provenientes del plane se conservan.
    expect(effectivePolicy.thresholds?.livenessScore).toBe(0.61);
    expect(effectivePolicy.thresholds?.qualityGlassesPct).toBe(0.45);
  });

  it("cuando el workflow NO fija threshold, el valor del plane se preserva (fallback correcto)", async () => {
    const policyWithPlane = await withResolvedThresholds(
      BASE,
      { tenantId: "t1" },
      execWith({ matchCosine: 0.75 })
    );
    // Workflow sin threshold de match (thresholds vacíos): debe conservar el del plane.
    const effectivePolicy = applyWorkflowToPolicy(policyWithPlane, {
      document: { required: true },
      match: { required: true },          // sin threshold explícito
      quality: {},
      review: { mode: "auto" },
    });
    expect(effectivePolicy.thresholds?.matchCosine).toBe(0.75);
  });
});
