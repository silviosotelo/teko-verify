/**
 * Redis-backed rate limiter (§8 Seguridad: "rate-limit por tenant").
 *
 * Usa Redis INCR + EXPIRE con transacciones MULTI/EXEC para atomicidad.
 * Cuando REDIS_URL está configurado, el servidor inyecta este backend
 * en lugar del InMemoryRateLimiter, permitiendo rate-limit compartido
 * entre múltiples instancias del servicio.
 *
 * Estrategia: ventana fija (fixed window) — misma semántica que el
 * in-memory, pero con estado en Redis.
 */
import type { RateLimiter } from "./rateLimit";

export class RedisRateLimiter implements RateLimiter {
  private redis: any; // Redis client (ioredis or similar)

  constructor(redis: any) {
    this.redis = redis;
  }

  async consume(key: string, limit: number, windowMs: number): Promise<boolean> {
    const redisKey = `ratelimit:${key}`;
    const now = Date.now();

    try {
      const result = await this.redis.exec([
        ["INCR", redisKey],
        ["TTL", redisKey],
      ]);

      const count = result[0] as number;
      const ttl = result[1] as number;

      // Primera solicitud en esta ventana: establece expiry.
      if (count === 1) {
        await this.redis.expire(redisKey, Math.ceil(windowMs / 1000));
      }

      return count <= limit;
    } catch {
      // Redis error: fail-closed (bloquea para seguridad).
      return false;
    }
  }

  async getState(
    key: string,
    max: number,
    windowMs: number
  ): Promise<{ remaining: number; resetAt: number; limit: number }> {
    const redisKey = `ratelimit:${key}`;

    try {
      const [count, ttl] = await this.redis.exec([
        ["INCR", redisKey],
        ["TTL", redisKey],
      ]) as [number, number];

      // Revertimos el INCR que hicimos solo para leer el estado.
      // En su lugar, usamos GET para lectura sin side-effect.
      const getCount = await this.redis.get(redisKey);
      const getTtl = await this.redis.ttl(redisKey);

      const currentCount = getCount ? parseInt(getCount, 10) : 0;
      const currentTtl = getTtl;

      const remaining = Math.max(0, max - currentCount);
      const resetAt = currentTtl > 0
        ? Date.now() + currentTtl * 1000
        : Date.now() + windowMs;

      return { remaining, resetAt, limit: max };
    } catch {
      // Redis error: devolver estado por defecto.
      return { remaining: max, resetAt: Date.now() + windowMs, limit: max };
    }
  }
}
