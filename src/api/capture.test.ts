/**
 * Tests de las guardas de la máquina de estados del router de captura.
 *
 * Las guardas se extrajeron como funciones PURAS (`isCapturable`,
 * `consentShouldTransition`) — single source of truth que el router invoca — para
 * poder testearlas sin levantar Express ni cargar engine/onnxruntime (mismo
 * motivo por el que pipeline.test.ts evita el router real).
 *
 * Cubre:
 *  - #1: re-capturar desde 'review' ya es legítimo (isCapturable('review')).
 *  - #4: el consent es no-op idempotente desde 'review' (no transiciona).
 */
import { describe, it, expect } from "vitest";
import { isCapturable, consentShouldTransition } from "./captureGuards";
import type { SessionState } from "../types";

describe("isCapturable — guarda de captura (#1)", () => {
  it("acepta los estados de captura normales", () => {
    for (const s of ["created", "capturing", "needs_recapture"] as SessionState[]) {
      expect(isCapturable(s)).toBe(true);
    }
  });

  it("acepta 'review' → re-capturar desde la pantalla de revisión NO da 409 (#1)", () => {
    // Este es el fix: antes 'review' no era capturable y onRetry→/selfie chocaba.
    expect(isCapturable("review")).toBe(true);
  });

  it("rechaza estados terminales / en proceso", () => {
    for (const s of [
      "processing",
      "verified",
      "rejected",
      "error",
      "expired",
    ] as SessionState[]) {
      expect(isCapturable(s)).toBe(false);
    }
  });
});

describe("consentShouldTransition — guard de re-consentimiento (#4)", () => {
  it("transiciona sólo desde {created, capturing}", () => {
    expect(consentShouldTransition("created")).toBe(true);
    expect(consentShouldTransition("capturing")).toBe(true);
  });

  it("NO transiciona desde 'review' → re-aceptar es no-op idempotente (#4)", () => {
    // Antes: re-aceptar desde 'review' reseteaba review→capturing (perdía progreso).
    expect(consentShouldTransition("review")).toBe(false);
  });

  it("NO transiciona desde estados avanzados/terminales", () => {
    for (const s of [
      "processing",
      "needs_recapture",
      "verified",
      "rejected",
      "error",
      "expired",
    ] as SessionState[]) {
      expect(consentShouldTransition(s)).toBe(false);
    }
  });
});
