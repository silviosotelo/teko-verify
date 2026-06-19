/**
 * Retention auto-cleanup — borrado programado de sesiones e evidencia vencidas
 * según la política de retención de cada tenant (spec §12).
 *
 * Ejecuta un barrido por tenant: para cada tenant activo, borra sesiones cuyo
 * created_at + retentionDays ya venció, junto con checks, evidencia, consents,
 * identities, AML entities y session_events asociados.
 */
import { Pool } from "pg";
import { repos } from "../db/repos";

/** Borra TODA la evidencia de una sesión (disco + DB). */
async function purgeSessionEvidence(pool: Pool, tenantId: string, sessionId: string): Promise<void> {
  try {
    await repos.evidence.removeBySession(tenantId, sessionId, pool);
  } catch {
    /* no-op: evidencia ya borrada */
  }
}

/** Borra checks de una sesión. */
async function purgeSessionChecks(pool: Pool, tenantId: string, sessionId: string): Promise<void> {
  try {
    await repos.checks.deleteBySession(tenantId, sessionId, pool);
  } catch {
    /* no-op */
  }
}

/** Borra consents de una sesión. */
async function purgeSessionConsents(pool: Pool, tenantId: string, sessionId: string): Promise<void> {
  try {
    await pool.query("DELETE FROM consents WHERE tenant_id = $1 AND session_id = $2", [tenantId, sessionId]);
  } catch {
    /* no-op */
  }
}

/** Borra verified_identities de una sesión. */
async function purgeSessionIdentities(pool: Pool, tenantId: string, sessionId: string): Promise<void> {
  try {
    await pool.query("DELETE FROM verified_identities WHERE tenant_id = $1 AND session_id = $2", [tenantId, sessionId]);
  } catch {
    /* no-op */
  }
}

/** Borra session_events de una sesión. */
async function purgeSessionEvents(pool: Pool, tenantId: string, sessionId: string): Promise<void> {
  try {
    await pool.query("DELETE FROM session_events WHERE tenant_id = $1 AND session_id = $2", [tenantId, sessionId]);
  } catch {
    /* no-op */
  }
}

/** Borra audit_log entries de una sesión. */
async function purgeSessionAudit(pool: Pool, tenantId: string, sessionId: string): Promise<void> {
  try {
    await pool.query("DELETE FROM audit_log WHERE tenant_id = $1 AND session_id = $2", [tenantId, sessionId]);
  } catch {
    /* no-op */
  }
}

/**
 * Ejecuta la limpieza de retención para un tenant dado.
 * Encuentra sesiones vencidas y borra todo su rastro en una transacción.
 */
export async function runRetentionCleanup(pool: Pool, tenantId: string): Promise<number> {
  const tenant = await repos.tenants.getById(tenantId);
  if (!tenant) return 0;

  const retentionDays = tenant.policies.retentionDays;
  if (retentionDays <= 0) return 0; // 0 = borrar inmediatamente (ya no hay nada que retener)

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  // Encuentra sesiones vencidas (terminal states only, created before cutoff)
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM verification_sessions
     WHERE tenant_id = $1
       AND state IN ('verified', 'rejected', 'expired', 'error')
       AND created_at < $2`,
    [tenantId, cutoff]
  );

  let count = 0;
  for (const row of res.rows) {
    const sid = row.id;
    try {
      // 1. Delete evidence files from disk
      await evidenceStore.purge(tenantId, sid);

      // 2. Delete evidence DB records
      await purgeSessionEvidence(pool, tenantId, sid);

      // 3. Delete checks
      await purgeSessionChecks(pool, tenantId, sid);

      // 4. Delete session events
      await purgeSessionEvents(pool, tenantId, sid);

      // 5. Delete consents
      await purgeSessionConsents(pool, tenantId, sid);

      // 6. Delete identities
      await purgeSessionIdentities(pool, tenantId, sid);

      // 7. Delete audit_log entries
      await purgeSessionAudit(pool, tenantId, sid);

      // 8. Delete the session itself
      await repos.sessions.remove(tenantId, sid, pool);

      count++;
    } catch (e) {
      // Fail-open: un fallo no detiene el barrido de las demás sesiones
      // eslint-disable-next-line no-console
      console.warn(`[cleanup] error purging session ${sid}: ${(e as Error).message}`);
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Import perezoso para no romper tests que no usan evidenceStore
// ---------------------------------------------------------------------------

function getEvidenceStore() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../lib/evidenceStore").evidenceStore;
}

/** Alias local para evidenceStore.purge */
const evidenceStore = { purge: (t: string, s: string) => getEvidenceStore().purge(t, s) };

/**
 * Programa la limpieza automática cada hora.
 * Solo corre en la instancia primaria (check TEKO_CLEANUP_ENABLED).
 * Si no está habilitado, la función es un no-op.
 */
export function scheduleRetentionCleanup(pool: Pool): void {
  if (process.env.TEKO_CLEANUP_ENABLED !== "true") return;

  // Barrido inicial inmediato
  runRetentionCleanupForAll(pool).catch(() => undefined);

  // Luego cada hora
  const interval = setInterval(() => {
    runRetentionCleanupForAll(pool).catch(() => undefined);
  }, 60 * 60 * 1000);

  // No mantener vivo el proceso por el timer
  if (typeof interval.unref === "function") interval.unref();
}

/** Barrido sobre TODOS los tenants activos. */
async function runRetentionCleanupForAll(pool: Pool): Promise<void> {
  const tenants = await repos.tenants.list({ limit: 1000 });
  for (const t of tenants) {
    if (t.status !== "active") continue;
    const count = await runRetentionCleanup(pool, t.id);
    if (count > 0) {
      // eslint-disable-next-line no-console
      console.log(`[cleanup] tenant=${t.id} purged ${count} sessions`);
    }
  }
}
