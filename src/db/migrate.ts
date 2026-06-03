/**
 * Runner de migraciones SQL versionadas (spec §11: "Migraciones SQL versionadas").
 *
 * Comportamiento:
 *   - Asegura la tabla schema_migrations(filename PK, applied_at).
 *   - Lee migrations/*.sql, las ordena por nombre y aplica solo las no registradas.
 *   - Cada archivo corre en su PROPIA transacción: si falla, ROLLBACK y se aborta
 *     (no se registra), de modo que un reintento la vuelve a intentar (fail-closed).
 *
 * Ruta de migrations: los .sql NO se compilan a dist/ (están fuera de rootDir=src),
 * así que se resuelven relativos a la ubicación del módulo compilado: dist/db → ../../migrations.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pool } from "./pool";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedFilenames(): Promise<Set<string>> {
  const res = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations"
  );
  return new Set(res.rows.map((r) => r.filename));
}

function pendingMigrations(applied: Set<string>): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort() // orden lexicográfico: 0001_, 0002_, ...
    .filter((f) => !applied.has(f));
}

/** Aplica todas las migraciones pendientes. Devuelve los nombres aplicados en esta corrida. */
export async function migrate(): Promise<string[]> {
  await ensureMigrationsTable();
  const applied = await appliedFilenames();
  const pending = pendingMigrations(applied);

  const done: string[] = [];
  for (const filename of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      await client.query("COMMIT");
      done.push(filename);
      console.log(`[migrate] aplicada: ${filename}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[migrate] FALLÓ ${filename}:`, err);
      throw err; // abortar: no seguir con migraciones posteriores
    } finally {
      client.release();
    }
  }

  if (done.length === 0) console.log("[migrate] sin migraciones pendientes.");
  return done;
}

// Permite ejecutarlo como script: `node dist/db/migrate.js`.
if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      return pool.end().finally(() => process.exit(1));
    });
}
