/**
 * Pool de PostgreSQL de Teko Verify.
 *
 * Base dedicada `teko` (spec §8/§11): NO se reusa el PG de v6/v9. La conexión
 * sale de DATABASE_URL (o TEKO_DATABASE_URL para evitar choque con otros servicios
 * que corran en el mismo host). Sin valor por defecto productivo: fail-closed.
 */
import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

function resolveDatabaseUrl(): string {
  const url = process.env.TEKO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEKO_DATABASE_URL (o DATABASE_URL) no está definido: la capa de datos no puede arrancar."
    );
  }
  return url;
}

export const pool = new Pool({
  connectionString: resolveDatabaseUrl(),
  max: parseInt(process.env.TEKO_DB_POOL_MAX || process.env.TEKO_PG_POOL_MAX || "25", 10),
  idleTimeoutMillis: parseInt(process.env.TEKO_PG_IDLE_MS || "30000", 10),
  connectionTimeoutMillis: parseInt(process.env.TEKO_PG_CONN_TIMEOUT_MS || "5000", 10),
});

const CONNECTION_ERRORS = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
]);

function isRetryableError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  const message = (err as { message?: string })?.message ?? "";
  return CONNECTION_ERRORS.has(code) || CONNECTION_ERRORS.has(message) || /connection/i.test(message) || /timeout/i.test(message) || /refused/i.test(message);
}

/** Atajo tipado para queries one-shot (sin transacción explícita). */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[] | undefined).catch((err) => {
    if (!isRetryableError(err)) throw err;
    let lastErr = err;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const delay = 100 * 2 ** attempt;
      // eslint-disable-next-line no-loop-func
      return new Promise<QueryResult<T>>((resolve, reject) => {
        setTimeout(async () => {
          try {
            const result = await pool.query<T>(text, params as unknown[] | undefined);
            resolve(result);
          } catch (retryErr) {
            if (!isRetryableError(retryErr) || attempt === 3) {
              reject(retryErr);
            } else {
              lastErr = retryErr;
            }
          }
        }, delay);
      });
    }
    throw lastErr;
  });
}

/**
 * Ejecuta `fn` dentro de una transacción (BEGIN/COMMIT, ROLLBACK ante error).
 * Útil para el pipeline de persistencia (§6.5: identity + checks + evidence + audit).
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Cierre ordenado del pool (tests/shutdown). */
export function closePool(): Promise<void> {
  return pool.end();
}
