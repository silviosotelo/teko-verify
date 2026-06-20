import { describe, it, expect } from "vitest";
import { isQuotaExceeded, currentCalendarMonth } from "./billing";

/**
 * Lógica PURA de gating de cuota (sin DB). Cubre el límite exacto (used >= quota),
 * el caso ilimitado (quota null nunca bloquea) y la ventana de mes calendario.
 */
describe("isQuotaExceeded — decisión pura de gating", () => {
  it("quota null (ilimitado) → nunca bloquea", () => {
    expect(isQuotaExceeded(0, null)).toBe(false);
    expect(isQuotaExceeded(1_000_000, null)).toBe(false);
  });

  it("permite exactamente `quota` creaciones por período", () => {
    // quota 50: used 0..49 permitido; used 50 bloquea (count-before-create).
    expect(isQuotaExceeded(0, 50)).toBe(false);
    expect(isQuotaExceeded(49, 50)).toBe(false);
    expect(isQuotaExceeded(50, 50)).toBe(true);
    expect(isQuotaExceeded(51, 50)).toBe(true);
  });

  it("cuota 0 → bloquea de entrada", () => {
    expect(isQuotaExceeded(0, 0)).toBe(true);
  });
});

describe("currentCalendarMonth — ventana [inicio, fin) UTC", () => {
  it("devuelve el primer día del mes y el primero del mes siguiente (UTC)", () => {
    const { periodStart, periodEnd } = currentCalendarMonth(new Date("2026-06-20T13:45:00Z"));
    expect(periodStart).toBe("2026-06-01T00:00:00.000Z");
    expect(periodEnd).toBe("2026-07-01T00:00:00.000Z");
  });

  it("cruce de año: diciembre → enero siguiente", () => {
    const { periodStart, periodEnd } = currentCalendarMonth(new Date("2026-12-15T00:00:00Z"));
    expect(periodStart).toBe("2026-12-01T00:00:00.000Z");
    expect(periodEnd).toBe("2027-01-01T00:00:00.000Z");
  });
});
