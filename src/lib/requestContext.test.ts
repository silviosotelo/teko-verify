/**
 * Tests de la extracción de contexto de red/dispositivo (P0 #3).
 *
 * Cubre la prioridad de resolución del IP real detrás del túnel Cloudflare
 * (CF-Connecting-IP > True-Client-IP > X-Forwarded-For > req.ip), la normalización
 * del país (CF-IPCountry, con XX/T1 → null) y el parseo del User-Agent.
 */
import { describe, it, expect } from "vitest";
import type { Request } from "express";
import {
  extractClientIp,
  extractCountry,
  requestContext,
} from "./requestContext";

/** Construye un Request mínimo (sólo headers + ip) para las funciones puras. */
function mkReq(headers: Record<string, string>, ip?: string): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { headers: lower, ip } as unknown as Request;
}

describe("extractClientIp — IP real detrás de Cloudflare", () => {
  it("prioriza CF-Connecting-IP sobre todo lo demás", () => {
    const req = mkReq(
      {
        "CF-Connecting-IP": "200.1.2.3",
        "X-Forwarded-For": "10.0.0.1, 172.16.0.1",
      },
      "127.0.0.1"
    );
    expect(extractClientIp(req)).toBe("200.1.2.3");
  });

  it("cae a True-Client-IP si no hay CF-Connecting-IP", () => {
    const req = mkReq({ "True-Client-IP": "190.5.6.7" }, "127.0.0.1");
    expect(extractClientIp(req)).toBe("190.5.6.7");
  });

  it("cae al PRIMER hop de X-Forwarded-For (cliente original)", () => {
    const req = mkReq({ "X-Forwarded-For": "181.9.9.9, 10.0.0.1" }, "127.0.0.1");
    expect(extractClientIp(req)).toBe("181.9.9.9");
  });

  it("cae a req.ip cuando no hay ningún header de proxy", () => {
    const req = mkReq({}, "192.168.1.50");
    expect(extractClientIp(req)).toBe("192.168.1.50");
  });

  it("devuelve null si no hay ni headers ni req.ip", () => {
    const req = mkReq({});
    expect(extractClientIp(req)).toBeNull();
  });
});

describe("extractCountry — país del IP (CF-IPCountry)", () => {
  it("devuelve el alpha-2 en mayúsculas", () => {
    expect(extractCountry(mkReq({ "CF-IPCountry": "py" }))).toBe("PY");
  });

  it("normaliza XX (no geolocalizable) y T1 (Tor) a null", () => {
    expect(extractCountry(mkReq({ "CF-IPCountry": "XX" }))).toBeNull();
    expect(extractCountry(mkReq({ "CF-IPCountry": "T1" }))).toBeNull();
  });

  it("devuelve null si el header no está presente", () => {
    expect(extractCountry(mkReq({}))).toBeNull();
  });
});

describe("requestContext — contexto completo", () => {
  it("compone ip + country + userAgent + device parseado", () => {
    const req = mkReq({
      "CF-Connecting-IP": "200.1.2.3",
      "CF-IPCountry": "PY",
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 (KHTML) Version/17.0 Mobile/15E Safari/604.1",
    });
    const ctx = requestContext(req);
    expect(ctx.ip).toBe("200.1.2.3");
    expect(ctx.country).toBe("PY");
    expect(ctx.device.type).toBe("mobile");
    expect(ctx.device.os).toContain("iOS");
    expect(ctx.device.browser).toBe("Safari");
    expect(ctx.device.suspicious).toBe(false);
  });
});
