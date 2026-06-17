/**
 * Tests de la lógica PURA de Device & IP analysis (P0 #3): señales de riesgo
 * derivadas del timeline + score agregado.
 */
import { describe, it, expect } from "vitest";
import { analyzeDeviceIp } from "./deviceIp";
import type { ParsedDevice, SessionEvent } from "../types";

const DEV_MOBILE: ParsedDevice = {
  os: "Android 13",
  browser: "Chrome",
  type: "mobile",
  suspicious: false,
  raw: "ua",
};
const DEV_HEADLESS: ParsedDevice = {
  os: "Linux",
  browser: "Chrome",
  type: "desktop",
  suspicious: true,
  raw: "HeadlessChrome",
};

let seq = 0;
function ev(over: Partial<SessionEvent>): SessionEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    sessionId: "s1",
    tenantId: "t1",
    type: over.type ?? "consent.accepted",
    ip: over.ip ?? "200.1.2.3",
    country: over.country ?? "PY",
    userAgent: over.userAgent ?? "ua",
    device: over.device ?? DEV_MOBILE,
    meta: over.meta ?? {},
    createdAt: over.createdAt ?? new Date(2026, 0, 1, 0, 0, seq).toISOString(),
  };
}

describe("analyzeDeviceIp", () => {
  it("sin anomalías → sin señales, riesgo 0", () => {
    const a = analyzeDeviceIp([ev({}), ev({})], { documentNationality: "PARAGUAYA" });
    expect(a.signals).toHaveLength(0);
    expect(a.riskScore).toBe(0);
    expect(a.ip).toBe("200.1.2.3");
    expect(a.country).toBe("PY");
  });

  it("detecta cambio de IP entre pasos (medium)", () => {
    const a = analyzeDeviceIp([
      ev({ ip: "200.1.2.3" }),
      ev({ ip: "190.9.9.9" }),
    ]);
    const codes = a.signals.map((s) => s.code);
    expect(codes).toContain("ip_changed");
    expect(a.riskScore).toBeGreaterThan(0);
  });

  it("detecta cambio de país (high)", () => {
    const a = analyzeDeviceIp([
      ev({ ip: "200.1.2.3", country: "PY" }),
      ev({ ip: "190.9.9.9", country: "AR" }),
    ]);
    const codes = a.signals.map((s) => s.code);
    expect(codes).toContain("country_changed");
    expect(a.countries).toEqual(["PY", "AR"]);
  });

  it("detecta país del IP ≠ nacionalidad del documento", () => {
    const a = analyzeDeviceIp([ev({ country: "AR" })], {
      documentNationality: "PARAGUAYA",
    });
    expect(a.signals.map((s) => s.code)).toContain("country_vs_nationality_mismatch");
  });

  it("NO marca mismatch si país == nacionalidad", () => {
    const a = analyzeDeviceIp([ev({ country: "PY" })], {
      documentNationality: "REPÚBLICA DEL PARAGUAY",
    });
    expect(a.signals.map((s) => s.code)).not.toContain("country_vs_nationality_mismatch");
  });

  it("detecta User-Agent sospechoso/headless (high)", () => {
    const a = analyzeDeviceIp([ev({ device: DEV_HEADLESS })]);
    expect(a.signals.map((s) => s.code)).toContain("suspicious_user_agent");
  });

  it("acumula varias señales y cappea el score en 100", () => {
    const a = analyzeDeviceIp(
      [
        ev({ ip: "1.1.1.1", country: "PY", device: DEV_HEADLESS }),
        ev({ ip: "2.2.2.2", country: "AR", device: DEV_HEADLESS }),
      ],
      { documentNationality: "PARAGUAYA" }
    );
    expect(a.signals.length).toBeGreaterThanOrEqual(3);
    expect(a.riskScore).toBeLessThanOrEqual(100);
    expect(a.riskScore).toBeGreaterThan(0);
  });

  it("tolera device {} (default DDL) sin romper", () => {
    const a = analyzeDeviceIp([ev({ device: {} as ParsedDevice })]);
    expect(a.device).toBeNull();
    expect(a.signals.map((s) => s.code)).not.toContain("suspicious_user_agent");
  });
});
