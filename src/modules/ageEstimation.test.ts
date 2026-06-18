/**
 * Tests del módulo `ageEstimation` (P2) — helpers PUROS + el wiring fail-closed de
 * run(), sin el modelo ONNX real. Cubren:
 *   - softmax estable.
 *   - ageFromLogits: usa SÓLO la cabeza de edad (índices 9..17) de los 18 logits de
 *     FairFace, devuelve la edad esperada, el bucket argmax y la confianza.
 *   - run(): fail-closed cuando el modelo no está cargado (passed=false + error), sin
 *     tocar el engine.
 */
import { describe, it, expect } from "vitest";
import {
  softmax,
  ageFromLogits,
  AGE_BUCKETS,
  AGE_MIDPOINTS,
  AgeEstimationModule,
} from "./ageEstimation";
import type { Engine } from "../engine";

describe("softmax", () => {
  it("normaliza a una distribución que suma 1", () => {
    const p = softmax([2, 1, 0]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(p[0]).toBeGreaterThan(p[1]);
  });
  it("es estable con logits grandes (sin NaN/Inf)", () => {
    const p = softmax([1000, 999, -1000]);
    expect(p.every((v) => Number.isFinite(v))).toBe(true);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe("ageFromLogits", () => {
  it("ignora raza/género y usa la cabeza de edad (9..17)", () => {
    // 18 logits: raza(0..6) y género(7..8) ruidosos; edad(9..17) con pico en "30-39".
    const logits = new Array(18).fill(0);
    logits[2] = 9; // raza alta — NO debe influir
    logits[7] = 9; // género alto — NO debe influir
    const ageIdx = AGE_BUCKETS.indexOf("30-39"); // 4
    logits[9 + ageIdx] = 8; // pico de edad
    const r = ageFromLogits(logits);
    expect(r).not.toBeNull();
    expect(r!.range).toBe("30-39");
    expect(r!.confidence).toBeGreaterThan(0.9);
    // La edad esperada cae cerca del midpoint del bucket dominante.
    expect(r!.estimatedAge).toBeGreaterThan(30);
    expect(r!.estimatedAge).toBeLessThan(40);
    expect(r!.buckets).toHaveLength(9);
  });

  it("la edad esperada de una distribución uniforme = media de los midpoints", () => {
    const logits = new Array(18).fill(0); // edad uniforme tras softmax
    const mean =
      AGE_MIDPOINTS.reduce((a, b) => a + b, 0) / AGE_MIDPOINTS.length;
    const r = ageFromLogits(logits);
    expect(r!.estimatedAge).toBeCloseTo(mean, 1);
  });

  it("devuelve null si el vector no tiene 18 valores (fail-closed)", () => {
    expect(ageFromLogits([1, 2, 3])).toBeNull();
  });
});

describe("AgeEstimationModule.run — fail-closed sin modelo", () => {
  it("sin modelo cargado: passed=false + error, sin tocar el engine", async () => {
    const mod = new AgeEstimationModule(); // init() NO llamado → modelo no cargado
    let detectCalled = false;
    const engine = {
      detect: async () => {
        detectCalled = true;
        return [];
      },
    } as unknown as Engine;
    const res = await mod.run(Buffer.from(""), engine, { minAge: 18 });
    expect(res.passed).toBe(false);
    expect(res.error).toBe("age_model_unavailable");
    expect(res.minAge).toBe(18);
    expect(res.underage).toBe(false); // fail-closed: no afirma una edad
    expect(detectCalled).toBe(false); // corta antes de tocar el engine
  });
});
