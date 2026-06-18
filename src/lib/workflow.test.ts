/**
 * Tests de la lógica PURA de workflows (P0 #1): resolución workflow→checks (LoA
 * equivalente + thresholds) y ruteo a revisión humana (always / on_borderline / auto).
 */
import { describe, it, expect } from "vitest";
import {
  ageEstimationRejects,
  applyWorkflowToPolicy,
  assuranceFromDefinition,
  defaultWorkflowName,
  shouldRouteToReview,
  workflowDefForLoA,
} from "./workflow";
import type { TenantPolicy, WorkflowDefinition } from "../types";

function basePolicy(over: Partial<TenantPolicy> = {}): TenantPolicy {
  return {
    assuranceRequired: "L3",
    retentionDays: 90,
    livenessChallenges: [],
    consentText: "c",
    consentVersion: "1.0",
    maxRecaptureAttempts: 3,
    linkTokenTtlSeconds: 900,
    thresholds: {},
    ...over,
  };
}

describe("assuranceFromDefinition — LoA equivalente", () => {
  it("liveness.required → L3", () => {
    expect(assuranceFromDefinition(workflowDefForLoA("L3"))).toBe("L3");
  });
  it("match.required (sin liveness) → L2", () => {
    expect(assuranceFromDefinition(workflowDefForLoA("L2"))).toBe("L2");
  });
  it("sólo document → L1", () => {
    expect(assuranceFromDefinition(workflowDefForLoA("L1"))).toBe("L1");
  });
  it("definición vacía → L1 (fail-safe, nunca sube solo)", () => {
    expect(assuranceFromDefinition({})).toBe("L1");
  });
});

describe("defaultWorkflowName", () => {
  it("mapea L1/L2/L3 a default-l1/-l2/-l3", () => {
    expect(defaultWorkflowName("L1")).toBe("default-l1");
    expect(defaultWorkflowName("L2")).toBe("default-l2");
    expect(defaultWorkflowName("L3")).toBe("default-l3");
    expect(defaultWorkflowName("L4")).toBe("default-l3");
  });
});

describe("applyWorkflowToPolicy — compatibilidad e override de thresholds", () => {
  it("default L3 reproduce assuranceRequired L3 sin tocar thresholds", () => {
    const p = applyWorkflowToPolicy(basePolicy({ assuranceRequired: "L1" }), workflowDefForLoA("L3"));
    expect(p.assuranceRequired).toBe("L3");
    expect(p.thresholds?.matchCosine).toBeUndefined();
  });
  it("override de thresholds de la definición gana sobre el base", () => {
    const def: WorkflowDefinition = {
      document: { required: true },
      match: { required: true, threshold: 0.55 },
      liveness: { required: true, threshold: 0.8 },
      quality: { glassesMaxPct: 0.3 },
    };
    const p = applyWorkflowToPolicy(basePolicy(), def);
    expect(p.assuranceRequired).toBe("L3");
    expect(p.thresholds).toEqual({ matchCosine: 0.55, livenessScore: 0.8, qualityGlassesPct: 0.3 });
  });
});

describe("shouldRouteToReview — política de revisión", () => {
  it("auto / sin def / sin review → nunca", () => {
    expect(shouldRouteToReview(undefined, { match: 0.5 })).toBe(false);
    expect(shouldRouteToReview({}, { match: 0.5 })).toBe(false);
    expect(shouldRouteToReview({ review: { mode: "auto" } }, { match: 0.5 })).toBe(false);
  });
  it("always → siempre, sin importar scores", () => {
    expect(shouldRouteToReview({ review: { mode: "always" } }, {})).toBe(true);
    expect(shouldRouteToReview({ review: { mode: "always" } }, { match: 0.99 })).toBe(true);
  });
  it("on_borderline sin banda → nunca", () => {
    expect(shouldRouteToReview({ review: { mode: "on_borderline" } }, { match: 0.42 })).toBe(false);
  });
  it("on_borderline: match dentro de la banda → revisión", () => {
    const def: WorkflowDefinition = {
      review: { mode: "on_borderline", borderlineBand: { matchMin: 0.38, matchMax: 0.45 } },
    };
    expect(shouldRouteToReview(def, { match: 0.4 })).toBe(true);
    expect(shouldRouteToReview(def, { match: 0.6 })).toBe(false);
  });
  it("on_borderline: liveness dentro de la banda → revisión", () => {
    const def: WorkflowDefinition = {
      review: { mode: "on_borderline", borderlineBand: { livenessMin: 0.55, livenessMax: 0.7 } },
    };
    expect(shouldRouteToReview(def, { liveness: 0.6 })).toBe(true);
    expect(shouldRouteToReview(def, { liveness: 0.95 })).toBe(false);
  });

  describe("ruteo por AML (P1 #1)", () => {
    it("aml.onMatch:'review' + potential_match → revisión, aunque review.mode sea auto", () => {
      const def: WorkflowDefinition = {
        aml: { required: true, onMatch: "review" },
        review: { mode: "auto" },
      };
      expect(shouldRouteToReview(def, { amlDecision: "potential_match" })).toBe(true);
    });
    it("aml.onMatch:'review' + clear → no rutea (por AML)", () => {
      const def: WorkflowDefinition = { aml: { required: true, onMatch: "review" } };
      expect(shouldRouteToReview(def, { amlDecision: "clear" })).toBe(false);
    });
    it("aml.onMatch:'flag' + potential_match → NO rutea (sólo persiste el hit)", () => {
      const def: WorkflowDefinition = { aml: { required: true, onMatch: "flag" } };
      expect(shouldRouteToReview(def, { amlDecision: "potential_match" })).toBe(false);
    });
    it("aml.required:false → ignora amlDecision", () => {
      const def: WorkflowDefinition = { aml: { required: false, onMatch: "review" } };
      expect(shouldRouteToReview(def, { amlDecision: "potential_match" })).toBe(false);
    });
  });

  describe("ruteo por ESTIMACIÓN DE EDAD (P2)", () => {
    it("ageEstimation.onUnderage:'review' + underage → revisión, aunque review.mode sea auto", () => {
      const def: WorkflowDefinition = {
        ageEstimation: { required: true, minAge: 18, onUnderage: "review" },
        review: { mode: "auto" },
      };
      expect(shouldRouteToReview(def, { ageUnderage: true })).toBe(true);
    });
    it("ageEstimation.onUnderage:'review' + edad OK → no rutea (por edad)", () => {
      const def: WorkflowDefinition = {
        ageEstimation: { required: true, minAge: 18, onUnderage: "review" },
      };
      expect(shouldRouteToReview(def, { ageUnderage: false })).toBe(false);
    });
    it("ageEstimation.onUnderage:'flag' + underage → NO rutea (sólo persiste)", () => {
      const def: WorkflowDefinition = {
        ageEstimation: { required: true, minAge: 18, onUnderage: "flag" },
      };
      expect(shouldRouteToReview(def, { ageUnderage: true })).toBe(false);
    });
    it("ageEstimation.onUnderage:'reject' NO rutea a revisión (lo aplica el pipeline)", () => {
      const def: WorkflowDefinition = {
        ageEstimation: { required: true, minAge: 18, onUnderage: "reject" },
      };
      expect(shouldRouteToReview(def, { ageUnderage: true })).toBe(false);
    });
  });

  describe("ageEstimationRejects (rechazo duro por edad, P2)", () => {
    const def: WorkflowDefinition = {
      ageEstimation: { required: true, minAge: 18, onUnderage: "reject" },
    };
    it("required+reject + check fallido (underage/error) → rechaza", () => {
      expect(ageEstimationRejects(def, { passed: false })).toBe(true);
    });
    it("required+reject + check OK → NO rechaza", () => {
      expect(ageEstimationRejects(def, { passed: true })).toBe(false);
    });
    it("required+reject + sin resultado (undefined) → fail-closed rechaza", () => {
      expect(ageEstimationRejects(def, undefined)).toBe(true);
    });
    it("onUnderage:'review' (no reject) → NO rechaza duro", () => {
      const r: WorkflowDefinition = {
        ageEstimation: { required: true, minAge: 18, onUnderage: "review" },
      };
      expect(ageEstimationRejects(r, { passed: false })).toBe(false);
    });
    it("ageEstimation.required:false → nunca rechaza", () => {
      const r: WorkflowDefinition = {
        ageEstimation: { required: false, onUnderage: "reject" },
      };
      expect(ageEstimationRejects(r, { passed: false })).toBe(false);
    });
  });
});
