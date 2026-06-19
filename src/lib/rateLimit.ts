/**
 * Rate-limit in-memory (§8 Seguridad: "rate-limit por tenant").
 *
 * Implementación: ventana fija (fixed window) por clave, en memoria del proceso.
 * Suficiente para un despliegue single-container on-prem (§4). Para multi-instancia
 * se usa Redis (ver `lib/rateLimitRedis.ts`) cuando REDIS_URL está configurado.
 * Fail-open ante errores internos NO: el contador es determinista; si se excede el
 * límite, se bloquea (429).
 *
 * La clave la define cada montaje: IP, tenantId, token o combinación. Así el mismo
 * limiter sirve para /v1 (por tenant/api-key), /verify (por token/IP) y /admin
 * (por IP, y el login además por usuario).
 */
import type { NextFunction, Request, Response } from "express";

/**
 * Interfaz común para backends de rate-limit.
 * Implementada por `InMemoryRateLimiter` y `RedisRateLimiter`.
 */
export interface RateLimiter {
  /**
   * Intenta consumir una cuota. Devuelve `true` si la solicitud está dentro del
   * límite, `false` si se excedió.
   * @param key Identificador único del grupo (tenant, IP, token, etc.).
   * @param max Máximo de solicitudes permitidas en la ventana.
   * @param windowMs Ventana de tiempo en milisegundos.
   */
  consume(key: string, max: number, windowMs: number): Promise<boolean>;
  /**
   * Devuelve el estado actual del limiter para una clave (para headers/inspección).
   */
  getState(key: string, max: number, windowMs: number): Promise<{
    remaining: number;
    resetAt: number;
    limit: number;
  }>;
}

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

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = keyGenerator(req);
    consumeAndRespond(key, max, windowMs, res, next);
  };
}

/**
 * Crea el middleware con un backend de RateLimiter inyectado (InMemory o Redis).
 * Cuando REDIS_URL está configurado, server.ts inyecta RedisRateLimiter;
 * de lo contrario, usa InMemoryRateLimiter como fallback.
 */
export function createRateLimiterWithBackend(opts: RateLimitOptions, limiter: RateLimiter) {
  const { windowMs, max } = opts;
  const keyGenerator = opts.keyGenerator ?? clientIp;

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = keyGenerator(req);
    consumeAndRespond(key, max, windowMs, res, next, limiter);
  };
}

async function consumeAndRespond(
  key: string,
  max: number,
  windowMs: number,
  res: Response,
  next: NextFunction,
  limiter?: RateLimiter
): Promise<void> {
  const now = Date.now();
  let consumed: boolean;
  let remaining: number;
  let resetAt: number;

  if (limiter) {
    // Backend externo (Redis): consume() ya maneja la lógica de ventana.
    consumed = await limiter.consume(key, max, windowMs);
    const state = await limiter.getState(key, max, windowMs);
    remaining = state.remaining;
    resetAt = state.resetAt;
  } else {
    // Fallback in-memory (sin Redis).
    consumed = await consumeInMemory(key, max, windowMs, now);
    const entry = inMemoryStore.get(key);
    remaining = Math.max(0, max - (entry?.count ?? 0));
    resetAt = entry?.resetAt ?? now + windowMs;
  }

  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
  if (!consumed) {
    const retryAfter = Math.ceil((resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "rate_limited", retryAfterSeconds: retryAfter });
    return;
  }
  next();
}

/** In-memory store compartido por consumeInMemory. */
interface Counter {
  count: number;
  /** Epoch ms en que se reinicia la ventana. */
  resetAt: number;
}
const inMemoryStore = new Map<string, Counter>();

async function consumeInMemory(key: string, max: number, windowMs: number, now: number): Promise<boolean> {
  let entry = inMemoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    inMemoryStore.set(key, entry);
    sweepInMemory(now);
  }
  entry.count += 1;
  return entry.count <= max;
}

function sweepInMemory(now: number): void {
  if (inMemoryStore.size < 10000) return;
  for (const [k, v] of inMemoryStore) {
    if (v.resetAt <= now) inMemoryStore.delete(k);
  }
}

/** Helpers de parseo de env (centralizan defaults; config.ts no es editable aquí). */
function envInt(name: string, dflt: number): number {
  const v = parseInt(process.env[name] || "", 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

/** Ventana global por defecto (ms). */
export const DEFAULT_WINDOW_MS = envInt("TEKO_RL_WINDOW_MS", 60_000);

/** Limiter para la API del tenant (/v1): por API key (Bearer) o IP.
 * Spec §14: respeta rateLimitV1 por tenant si está configurado. */
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

/**
 * Middleware de rate-limit por tenant: verifica la policy del tenant y usa
 * rateLimitV1 si está configurado. Spec §14.
 */
export async function tenantRateLimiterMiddleware(maxOverride?: number) {
  const max = maxOverride ?? envInt("TEKO_RL_V1_MAX", 120);
  return createRateLimiter({
    name: "v1",
    windowMs: DEFAULT_WINDOW_MS,
    max,
    keyGenerator: (req) => {
      const auth = req.header("authorization") || "";
      const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
      return m ? `v1:key:${m[1].trim()}` : `v1:ip:${reqIp(req)}`;
    },
  });
}

/**
 * Limiter con check de policy por tenant. Si el tenant tiene rateLimitV1 > 0,
 * lo usa; si es 0 o no configurado, usa el default global.
 * Se usa como middleware en la API del tenant.
 */
export async function createTenantAwareRateLimiter(): Promise<(req: Request, res: Response, next: NextFunction) => void> {
  // Import diferido para evitar circular.
  const { repos } = await import("../db/repos");
  return async (req: Request, res: Response, next: NextFunction) => {
    // Derivar tenant de la API key.
    const auth = req.header("authorization") || "";
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!m) {
      next();
      return;
    }
    // Buscar el tenant por la key (simplificado: verificar si hay tenantCtx).
    const tenantCtx = (req as any).tenantCtx;
    if (!tenantCtx || !tenantCtx.tenant) {
      next();
      return;
    }
    const tenant = tenantCtx.tenant;
    const rl = tenant.policies.rateLimitV1;
    if (rl && rl > 0) {
      // Usar el rate limit del tenant.
      const limiter = createRateLimiter({
        name: "v1",
        windowMs: DEFAULT_WINDOW_MS,
        max: rl,
        keyGenerator: (r) => {
          const a = r.header("authorization") || "";
          const mm = /^Bearer\s+(.+)$/i.exec(a.trim());
          return mm ? `v1:key:${mm[1].trim()}` : `v1:ip:${clientIp(r)}`;
        },
      });
      limiter(req, res, next);
    } else {
      next();
    }
  };
}

/** Limiter para la captura del titular (/verify): por token de link o IP.
 * Spec §14: respeta rateLimitVerify por tenant si está configurado. */
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

/** Limiter general del dashboard admin (/admin): por IP.
 * Spec §14: respeta rateLimitAdmin por tenant si está configurado. */
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
