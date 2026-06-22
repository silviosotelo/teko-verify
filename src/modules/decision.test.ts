/**
 * Tests del módulo puro `decision` y `match` — foco en FAIL-CLOSED (§6/§9).
 *
 * Regresión de bugs bloqueantes hallados en revisión adversarial:
 *   1. decision(): una señal de SEGURIDAD PRESENTE-pero-fallida (match/liveness)
 *      NUNCA debe producir "verified", aunque el LoA requerido sea bajo (L1).
 *   2. match/cosineSimilarity: embeddings con NaN/no-finitos → coseno -1 (sentinela
 *      fail-closed), no NaN (que se serializaría a null en el JSONB de auditoría).
 */
import { describe, it, expect } from "vitest";
import { decision } from "./decision";
import { match, cosineSimilarity } from "./match";
import type {
  DocumentResult,
  LivenessResult,
  MatchResult,
  PipelineChecks,
  QualityResult,
  TenantPolicy,
} from "../types";

const QUALITY_OK: QualityResult = {
  faceOk: true,
  brightness: 0.5,
  sharpness: 100,
  pose: { yaw: 0, pitch: 0, roll: 0 },
  glassesPct: 0,
  passed: true,
  reasons: [],
};

function makeDoc(passed: boolean): DocumentResult {
  return {
    documentType: "ci_py",
    mrz: {
      rawLines: [],
      documentType: "I",
      issuingCountry: "PRY",
      documentNumber: "1234567",
      surname: "PEREZ",
      givenNames: "JUAN",
      nationality: "PRY",
      dateOfBirth: "1990-01-01",
      sex: "M",
      expirationDate: "2030-01-01",
      checkDigits: { documentNumber: passed, dateOfBirth: passed, expirationDate: passed, composite: passed },
      valid: passed,
    },
    barcode: { format: "", text: "" },
    ocr: { rawText: "", fields: {}, confidence: 0.9 },
    docFaceCrop: passed ? { base64Jpeg: "x", bbox: [0, 0, 1, 1] } : null,
    authenticity: { consistent: passed, checks: [] },
    passed,
  };
}

const MATCH_PASS: MatchResult = { cosine: 0.8, threshold: 0.5, passed: true };
const MATCH_FAIL: MatchResult = { cosine: 0.1, threshold: 0.5, passed: false };
const LIVE_PASS: LivenessResult = { score: 0.9, passed: true, attackType: "none" };
const LIVE_FAIL: LivenessResult = { score: 0.1, passed: false, attackType: "replay" };

function policy(req: TenantPolicy["assuranceRequired"]): TenantPolicy {
  return {
    assuranceRequired: req,
    retentionDays: 0,
    livenessChallenges: [],
    consentText: "",
    consentVersion: "1",
    maxRecaptureAttempts: 3,
    linkTokenTtlSeconds: 900,
  };
}

describe("decision — fail-closed ante señal presente-pero-fallida", () => {
  it("L1 con match PRESENTE y FALLIDO → rejected (no verified)", () => {
    const checks: PipelineChecks = { quality: QUALITY_OK, document: makeDoc(true), match: MATCH_FAIL };
    const d = decision(checks, policy("L1"));
    expect(d.verdict).toBe("rejected");
    expect(d.loa).toBe("L0");
    expect(d.reasons).toContain("face_match_failed");
  });

  it("L1 con liveness PRESENTE y FALLIDA → rejected (no verified)", () => {
    const checks: PipelineChecks = { quality: QUALITY_OK, document: makeDoc(true), liveness: LIVE_FAIL };
    const d = decision(checks, policy("L1"));
    expect(d.verdict).toBe("rejected");
    expect(d.loa).toBe("L0");
    expect(d.reasons).toContain("liveness_failed");
  });

  it("L3 con match fallido pero liveness OK → rejected", () => {
    const checks: PipelineChecks = { quality: QUALITY_OK, document: makeDoc(true), match: MATCH_FAIL, liveness: LIVE_PASS };
    const d = decision(checks, policy("L3"));
    expect(d.verdict).toBe("rejected");
    expect(d.loa).toBe("L0");
  });

  it("reasons no duplica el mismo motivo de fallo", () => {
    const checks: PipelineChecks = { quality: QUALITY_OK, document: makeDoc(true), match: MATCH_FAIL };
    const d = decision(checks, policy("L1"));
    const counts = d.reasons.filter((r) => r === "face_match_failed").length;
    expect(counts).toBe(1);
  });
});

describe("decision — caminos verified legítimos (sin regresión)", () => {
  it("L1 con sólo quality+document OK → verified L1", () => {
    const d = decision({ quality: QUALITY_OK, document: makeDoc(true) }, policy("L1"));
    expect(d.verdict).toBe("verified");
    expect(d.loa).toBe("L1");
  });

  it("L3 con todo OK → verified L3", () => {
    const d = decision(
      { quality: QUALITY_OK, document: makeDoc(true), match: MATCH_PASS, liveness: LIVE_PASS },
      policy("L3")
    );
    expect(d.verdict).toBe("verified");
    expect(d.loa).toBe("L3");
  });

  it("L3 pero falta liveness (señal ausente) → rejected por LoA no alcanzado", () => {
    const d = decision({ quality: QUALITY_OK, document: makeDoc(true), match: MATCH_PASS }, policy("L3"));
    expect(d.verdict).toBe("rejected");
    expect(d.reasons.some((r) => r.startsWith("assurance_not_met"))).toBe(true);
  });
});

/**
 * SECURITY INVARIANT — "nonsensical config" edge case (T3 Fase 3 resolver concern).
 *
 * A workflow definition like:
 *   { liveness.required:true, match.required:true,
 *     pipeline.checks:[{key:'match', enabled:false}] }
 * yields assuranceRequired=L3 BUT resolveCheckList disables match → match never runs →
 * checks.match is undefined when decision() is called.
 *
 * decision() MUST be fail-closed: match absent means the L3 ladder cannot be completed,
 * so the session is REJECTED (assurance_not_met), NEVER "verified".
 *
 * These tests anchor that invariant before T4 consumes the resolver.
 */
describe("decision — fail-closed invariant: check ausente en LoA requerido (nonsensical config)", () => {
  it("L3 con match AUSENTE (undefined) → rejected, nunca verified", () => {
    // Simula el nonsensical config: assuranceRequired=L3 pero match no corrió.
    const checks: PipelineChecks = {
      quality: QUALITY_OK,
      document: makeDoc(true),
      // match: undefined — no corrió
      liveness: LIVE_PASS,
    };
    const d = decision(checks, policy("L3"));
    expect(d.verdict).toBe("rejected");
    expect(d.loa).toBe("L0");
    expect(d.reasons.some((r) => r.startsWith("assurance_not_met"))).toBe(true);
  });

  it("L3 con match Y liveness ambos AUSENTES → rejected (no verified)", () => {
    const checks: PipelineChecks = {
      quality: QUALITY_OK,
      document: makeDoc(true),
      // match: undefined, liveness: undefined
    };
    const d = decision(checks, policy("L3"));
    expect(d.verdict).toBe("rejected");
    expect(d.loa).toBe("L0");
    expect(d.reasons.some((r) => r.startsWith("assurance_not_met"))).toBe(true);
  });

  it("L2 con match AUSENTE → rejected (no verified)", () => {
    const checks: PipelineChecks = {
      quality: QUALITY_OK,
      document: makeDoc(true),
      // match: undefined
    };
    const d = decision(checks, policy("L2"));
    expect(d.verdict).toBe("rejected");
    expect(d.loa).toBe("L0");
    expect(d.reasons.some((r) => r.startsWith("assurance_not_met"))).toBe(true);
  });

  it("liveness AUSENTE con assuranceRequired=L3 (variant: match corre) → rejected (ya existía, confirma escalera)", () => {
    // Re-ancla la escalera: aunque match pasa, sin liveness no hay L3.
    const checks: PipelineChecks = {
      quality: QUALITY_OK,
      document: makeDoc(true),
      match: MATCH_PASS,
      // liveness: undefined
    };
    const d = decision(checks, policy("L3"));
    expect(d.verdict).toBe("rejected");
    expect(d.reasons.some((r) => r.startsWith("assurance_not_met"))).toBe(true);
  });
});

describe("match — coseno fail-closed con embeddings inválidos", () => {
  it("embedding con NaN → coseno -1, passed false (no NaN/null)", () => {
    const r = match(new Float32Array([NaN, 0, 0]), new Float32Array([1, 0, 0]), 0.5);
    expect(r.cosine).toBe(-1);
    expect(r.passed).toBe(false);
    expect(Number.isFinite(r.cosine)).toBe(true);
  });

  it("vector cero → coseno -1 (denominador ~0)", () => {
    expect(cosineSimilarity(new Float32Array([0, 0, 0]), new Float32Array([1, 0, 0]))).toBe(-1);
  });

  it("vectores idénticos normalizados → coseno ~1, passed", () => {
    const v = new Float32Array([1, 0, 0]);
    const r = match(v, v, 0.5);
    expect(r.cosine).toBeCloseTo(1, 5);
    expect(r.passed).toBe(true);
  });
});
