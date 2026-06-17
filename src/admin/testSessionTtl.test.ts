/**
 * Tests del helper puro `resolveTestSessionTtlSec` — TTL override de los links de
 * PRUEBA del admin (POST /admin/tenants/:id/test-session).
 *
 * Contrato (fail-closed): solo un ENTERO POSITIVO en `ttlMinutes` overridea el TTL,
 * clampeado a ≤120min; cualquier otra cosa (ausente, no-número, no-entero, ≤0, NaN,
 * string) cae al default del tenant. NO afecta el flujo público ni el default global.
 */
import { describe, it, expect } from "vitest";
import { resolveTestSessionTtlSec, TEST_SESSION_TTL_MAX_MIN } from "./testSessionTtl";

const DEFAULT_SEC = 900; // 15 min (default de producción)

describe("resolveTestSessionTtlSec", () => {
  it("usa el default cuando no viene ttlMinutes (undefined/null)", () => {
    expect(resolveTestSessionTtlSec(undefined, DEFAULT_SEC)).toBe(DEFAULT_SEC);
    expect(resolveTestSessionTtlSec(null, DEFAULT_SEC)).toBe(DEFAULT_SEC);
  });

  it("overridea con un entero positivo (60min → 3600s)", () => {
    expect(resolveTestSessionTtlSec(60, DEFAULT_SEC)).toBe(3600);
    expect(resolveTestSessionTtlSec(1, DEFAULT_SEC)).toBe(60);
  });

  it("clampea a TEST_SESSION_TTL_MAX_MIN (≤120min)", () => {
    expect(resolveTestSessionTtlSec(120, DEFAULT_SEC)).toBe(120 * 60);
    expect(resolveTestSessionTtlSec(121, DEFAULT_SEC)).toBe(TEST_SESSION_TTL_MAX_MIN * 60);
    expect(resolveTestSessionTtlSec(99999, DEFAULT_SEC)).toBe(TEST_SESSION_TTL_MAX_MIN * 60);
  });

  it("fail-closed: valores inválidos caen al default", () => {
    expect(resolveTestSessionTtlSec(0, DEFAULT_SEC)).toBe(DEFAULT_SEC);
    expect(resolveTestSessionTtlSec(-5, DEFAULT_SEC)).toBe(DEFAULT_SEC);
    expect(resolveTestSessionTtlSec(15.5, DEFAULT_SEC)).toBe(DEFAULT_SEC);
    expect(resolveTestSessionTtlSec(Number.NaN, DEFAULT_SEC)).toBe(DEFAULT_SEC);
    expect(resolveTestSessionTtlSec("60", DEFAULT_SEC)).toBe(DEFAULT_SEC);
    expect(resolveTestSessionTtlSec({}, DEFAULT_SEC)).toBe(DEFAULT_SEC);
  });
});
