/**
 * Rate-limit in-memory (§8 Seguridad: "rate-limit por tenant").
 *
 * Implementación: ventana fija (fixed window) por clave, en memoria del proceso.
 * Suficiente para un despliegue single-container on-prem (§4). Para multi-instancia
 * habría que respaldarlo en Redis (trabajo futuro). Fail-open ante errores internos
 * NO: el contador es determinista; si se excede el límite, se bloquea (429).
 *
 * La clave la define cada montaje: IP, tenantId, token o combinación. Así el mismo
 * limiter sirve para /v1 (por tenant/api-key), /verify (por token/IP) y /admin
 * (por IP, y el login además por usuario).
 */
import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  /** Tamaño de la ventana en milisegundos. */
  windowMs: number;
  /** Máximo de solicitudes permitidas por clave dentro de la ventana. */
  max: number;
  /** Deriva la clave de rate-limit de la request (default: IP). */
  keyGenerator?: (req: Request) => string;
  /** Nombre lógico para el header/diagnóstico. */
  name?: string;
}

interface Counter {
  count: number;
  /** Epoch ms en que se reinicia la ventana. */
  resetAt: number;
}

/** IP del cliente, robusta ante proxy (X-Forwarded-For si está). */
function clientIp(req: Request): string {
  const xff = req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/** Alias semántico para los keyGenerators (misma derivación de IP). */
const reqIp = clientIp;

/**
 * Crea un middleware de rate-limit con su propio store. Cada llamada produce un
 * store independiente (no comparten cuotas distintos montajes).
 */
export function createRateLimiter(opts: RateLimitOptions) {
  const { windowMs, max } = opts;
  const keyGenerator = opts.keyGenerator ?? clientIp;
  const store = new Map<string, Counter>();

  // Limpieza perezosa para no crecer sin límite (purga claves expiradas).
  function sweep(now: number): void {
    if (store.size < 10000) return;
    for (const [k, v] of store) {
      if (v.resetAt <= now) store.delete(k);
    }
  }

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = keyGenerator(req);
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
      sweep(now);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "rate_limited", retryAfterSeconds: retryAfter });
      return;
    }
    next();
  };
}

/** Helpers de parseo de env (centralizan defaults; config.ts no es editable aquí). */
function envInt(name: string, dflt: number): number {
  const v = parseInt(process.env[name] || "", 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

/** Ventana global por defecto (ms). */
export const DEFAULT_WINDOW_MS = envInt("TEKO_RL_WINDOW_MS", 60_000);

/** Limiter para la API del tenant (/v1): por API key (Bearer) o IP. */
export function tenantRateLimiter() {
  return createRateLimiter({
    name: "v1",
    windowMs: DEFAULT_WINDOW_MS,
    max: envInt("TEKO_RL_V1_MAX", 120),
    keyGenerator: (req) => {
      const auth = req.header("authorization") || "";
      const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
      return m ? `v1:key:${m[1].trim()}` : `v1:ip:${reqIp(req)}`;
    },
  });
}

/** Limiter para la captura del titular (/verify): por token de link o IP. */
export function captureRateLimiter() {
  return createRateLimiter({
    name: "verify",
    windowMs: DEFAULT_WINDOW_MS,
    max: envInt("TEKO_RL_VERIFY_MAX", 60),
    keyGenerator: (req) => {
      const token = req.params?.token;
      return token ? `verify:tok:${token}` : `verify:ip:${reqIp(req)}`;
    },
  });
}

/** Limiter general del dashboard admin (/admin): por IP. */
export function adminRateLimiter() {
  return createRateLimiter({
    name: "admin",
    windowMs: DEFAULT_WINDOW_MS,
    max: envInt("TEKO_RL_ADMIN_MAX", 120),
    keyGenerator: (req) => `admin:ip:${reqIp(req)}`,
  });
}

/** Limiter ESTRICTO del login admin: por IP + usuario (anti fuerza-bruta). */
export function adminLoginRateLimiter() {
  return createRateLimiter({
    name: "admin-login",
    windowMs: envInt("TEKO_RL_LOGIN_WINDOW_MS", 300_000),
    max: envInt("TEKO_RL_LOGIN_MAX", 10),
    keyGenerator: (req) => {
      const user =
        req.body && typeof req.body.email === "string" ? req.body.email : "";
      return `admin-login:${reqIp(req)}:${user}`;
    },
  });
}
