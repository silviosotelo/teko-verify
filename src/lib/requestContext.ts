/**
 * Extracción del CONTEXTO de red/dispositivo de un request del flujo de captura — P0 #3.
 *
 * Teko Verify corre detrás de un túnel Cloudflare. El IP real del titular y su país
 * vienen en headers que pone Cloudflare:
 *   * CF-Connecting-IP → IP real del cliente (gratis, siempre presente tras el túnel).
 *   * CF-IPCountry     → código ISO-3166-1 alpha-2 del país del IP (gratis).
 * Fallbacks fail-open si no hay túnel (dev/local o proxy distinto):
 *   * X-Forwarded-First (primer hop de X-Forwarded-For) → req.ip (Express trust proxy).
 *
 * El User-Agent se parsea con el parser liviano propio (lib/userAgent). Todo es
 * best-effort y no-throw: si falta un header, el campo queda null (registrar el
 * evento es fail-open; jamás debe romper la captura).
 */
import type { Request } from "express";
import { parseUserAgent, type ParsedDevice } from "./userAgent";

/** Contexto de red/dispositivo derivado de un request. */
export interface RequestContext {
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  device: ParsedDevice;
}

/** Lee un header normalizando el caso array/duplicado a un único string. */
function header(req: Request, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === "string" && v.length ? v : null;
}

/**
 * Resuelve el IP real del cliente. Prioridad (fail-open hacia abajo):
 *   1. CF-Connecting-IP   (túnel Cloudflare — el caso de producción).
 *   2. True-Client-IP     (Cloudflare Enterprise / algunos CDNs).
 *   3. X-Forwarded-For    (primer hop = cliente original; el resto son proxies).
 *   4. req.ip             (Express con trust proxy; socket en última instancia).
 * Devuelve null si nada resuelve (jamás lanza).
 */
export function extractClientIp(req: Request): string | null {
  const cf = header(req, "CF-Connecting-IP");
  if (cf) return cf.trim();
  const tci = header(req, "True-Client-IP");
  if (tci) return tci.trim();
  const xff = header(req, "X-Forwarded-For");
  if (xff) {
    // "client, proxy1, proxy2" → el primero es el cliente original.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? null;
}

/**
 * País del IP. CF-IPCountry es un alpha-2 en mayúsculas ("PY", "AR", …). Cloudflare
 * usa "XX" para IPs no geolocalizables y "T1" para Tor; los normalizamos a null
 * (no son países reales) salvo que se quiera conservarlos. Devuelve null si no hay.
 */
export function extractCountry(req: Request): string | null {
  const c = header(req, "CF-IPCountry");
  if (!c) return null;
  const up = c.trim().toUpperCase();
  if (!up || up === "XX" || up === "T1") return null;
  return up;
}

/** Construye el RequestContext completo de un request (no-throw). */
export function requestContext(req: Request): RequestContext {
  const userAgent = header(req, "User-Agent");
  return {
    ip: extractClientIp(req),
    country: extractCountry(req),
    userAgent,
    device: parseUserAgent(userAgent),
  };
}
