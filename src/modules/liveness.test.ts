/**
 * Tests del ENSEMBLE PAD (liveness) — helpers PUROS, sin el modelo ONNX real.
 *
 * Cubren el "wiring" del ensamble de Silent-Face: softmax estable y el promedio
 * de distribuciones que toma la prob "real" (índice 1) del resultado combinado,
 * tal como hace el repo minivision (`prediction += softmax; value/=n_models`).
 */
import { describe, it, expect } from "vitest";
import { softmax, ensembleRealProb } from "./liveness";
import { LIVENESS_THRESHOLD } from "../config";

describe("softmax", () => {
  it("normaliza a una distribución que suma 1", () => {
    const p = softmax([2, 1, 0]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[2]);
  });

  it("es numéricamente estable con logits grandes (no NaN/Inf)", () => {
    const p = softmax([1000, 999, -1000]);
    expect(p.every((v) => Number.isFinite(v))).toBe(true);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe("ensembleRealProb", () => {
  it("null cuando no hay distribuciones (→ fail-closed en padScore)", () => {
    expect(ensembleRealProb([])).toBeNull();
  });

  it("promedia los softmax y devuelve la prob 'real' (índice 1) del combinado", () => {
    // V2 dice real=0.9, V1SE dice real=0.5 → ensemble real = 0.7
    const v2 = [0.05, 0.9, 0.05];
    const v1se = [0.4, 0.5, 0.1];
    expect(ensembleRealProb([v2, v1se])).toBeCloseTo(0.7, 6);
  });

  it("con un solo modelo (ensemble degradado) devuelve su prob 'real'", () => {
    expect(ensembleRealProb([[0.2, 0.75, 0.05]])).toBeCloseTo(0.75, 6);
  });

  it("el 2º modelo puede BAJAR el score combinado de un dudoso (más robusto)", () => {
    // Un modelo solo aceptaría (0.85 > 0.70); el 2º lo arrastra por debajo.
    const single = ensembleRealProb([[0.1, 0.85, 0.05]])!;
    const ensemble = ensembleRealProb([[0.1, 0.85, 0.05], [0.7, 0.2, 0.1]])!;
    expect(single).toBeGreaterThan(0.7);
    expect(ensemble).toBeLessThan(single);
  });

  it("escalar único se mapea a [fake, real] y promedia (no rompe el ensemble)", () => {
    // distribuciones de distinta longitud: una de 2 (escalar mapeado) y otra de 3.
    const r = ensembleRealProb([[0.2, 0.8], [0.1, 0.6, 0.3]]);
    expect(r).toBeCloseTo((0.8 + 0.6) / 2, 6);
  });
});

/**
 * Calibración del umbral (ver docs/liveness-calibration.md). Estos tests fijan la
 * decisión de separación basada en los scores REALES medidos del ensemble:
 *   - piso genuino (rostro vivo) = 0.6867
 *   - cúmulo de spoofs realistas (cédula/print como selfie) ≤ 0.3166
 * El umbral 0.60 pasa el piso genuino y rechaza el cúmulo de spoofs. Si alguien
 * sube el umbral por encima de 0.6867, este test FALLA avisando que se vuelve a
 * falso-rechazar al usuario genuino de la sesión 5c9b4817.
 */
describe("calibración LIVENESS_THRESHOLD (interina, datos en docs/)", () => {
  const GENUINE_FLOOR = 0.6867; // sesión 5c9b4817 (rostro vivo confirmado)
  const SPOOF_CLUSTER_MAX = 0.3166; // peor spoof realista medido (cédula como selfie)
  const pass = (score: number) => score >= LIVENESS_THRESHOLD;

  it("el default no falso-rechaza el piso genuino (0.6867)", () => {
    expect(pass(GENUINE_FLOOR)).toBe(true);
    expect(LIVENESS_THRESHOLD).toBeLessThanOrEqual(GENUINE_FLOOR);
  });

  it("rechaza el cúmulo de spoofs realistas (≤ 0.3166)", () => {
    expect(pass(SPOOF_CLUSTER_MAX)).toBe(false);
    expect(LIVENESS_THRESHOLD).toBeGreaterThan(SPOOF_CLUSTER_MAX);
  });

  it("el umbral cae en la banda segura (0.3166, 0.6867]", () => {
    expect(LIVENESS_THRESHOLD).toBeGreaterThan(SPOOF_CLUSTER_MAX);
    expect(LIVENESS_THRESHOLD).toBeLessThanOrEqual(GENUINE_FLOOR);
  });
});
