import { describe, it, expect } from "vitest";
import { shouldFireAlert } from "./usageAlerts";

/**
 * Lógica PURA de disparo de usage_alerts (sin DB ni red). Cubre: umbral no alcanzado,
 * primer disparo, no re-disparo en el mismo período, re-disparo tras rotar período y
 * cuota ilimitada/<=0.
 */
const PERIOD_START = "2026-06-01T00:00:00.000Z";

describe("shouldFireAlert — decisión pura de disparo", () => {
  it("NO dispara si pct < threshold", () => {
    // 40/100 = 40% < 80%
    expect(
      shouldFireAlert(
        { thresholdPct: 80, lastFiredAt: null },
        { used: 40, quota: 100, periodStart: PERIOD_START }
      )
    ).toBe(false);
  });

  it("dispara si pct >= threshold y nunca disparó (lastFiredAt null)", () => {
    // 80/100 = 80% >= 80% (límite exacto)
    expect(
      shouldFireAlert(
        { thresholdPct: 80, lastFiredAt: null },
        { used: 80, quota: 100, periodStart: PERIOD_START }
      )
    ).toBe(true);
    // 95% > 90%
    expect(
      shouldFireAlert(
        { thresholdPct: 90, lastFiredAt: null },
        { used: 95, quota: 100, periodStart: PERIOD_START }
      )
    ).toBe(true);
  });

  it("NO re-dispara en el mismo período (last_fired_at >= periodStart)", () => {
    // ya disparó dentro del período actual
    expect(
      shouldFireAlert(
        { thresholdPct: 80, lastFiredAt: "2026-06-10T12:00:00.000Z" },
        { used: 90, quota: 100, periodStart: PERIOD_START }
      )
    ).toBe(false);
    // igual al inicio del período → tampoco re-dispara (no es estrictamente anterior)
    expect(
      shouldFireAlert(
        { thresholdPct: 80, lastFiredAt: PERIOD_START },
        { used: 90, quota: 100, periodStart: PERIOD_START }
      )
    ).toBe(false);
  });

  it("SÍ re-dispara si last_fired_at < periodStart (período nuevo)", () => {
    // disparó el mes pasado; período rotó → vuelve a disparar
    expect(
      shouldFireAlert(
        { thresholdPct: 80, lastFiredAt: "2026-05-20T12:00:00.000Z" },
        { used: 90, quota: 100, periodStart: PERIOD_START }
      )
    ).toBe(true);
  });

  it("nunca dispara si quota es null (ilimitado)", () => {
    expect(
      shouldFireAlert(
        { thresholdPct: 1, lastFiredAt: null },
        { used: 1_000_000, quota: null, periodStart: PERIOD_START }
      )
    ).toBe(false);
  });

  it("nunca dispara si quota <= 0 (evita división por cero / Infinity)", () => {
    expect(
      shouldFireAlert(
        { thresholdPct: 1, lastFiredAt: null },
        { used: 5, quota: 0, periodStart: PERIOD_START }
      )
    ).toBe(false);
  });
});
