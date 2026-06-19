/**
 * Reportes de cumplimiento — genera resúmenes para auditoría externa
 * (Ley 7593/2025, GDPR-like). Produce JSON con métricas de retención,
 * consentimiento, accesos y supresiones.
 */
import type { Pool } from "pg";
import { repos } from "../db/repos";
import type { Tenant } from "../types";

export interface ComplianceSummary {
  tenant: { id: string; name: string; status: string };
  generatedAt: string;
  /** Período cubierto. */
  period: { from: string; to: string };
  /** Total de verificaciones por estado. */
  verificationStats: { total: number; byState: Record<string, number> };
  /** Consentimientos: total aceptados, versiones usadas. */
  consentStats: { total: number; byVersion: Record<string, number> };
  /** Supresiones: cuántas sesiones fueron borradas por derecho a supresión. */
  suppressionStats: { total: number };
  /** Retención: días configurados vs. sesiones vencidas. */
  retentionStats: {
    retentionDays: number;
    sessionsPastRetention: number;
  };
  /** Auditoría: accesos del admin por operador. */
  adminAccessStats: { totalEntries: number; byOperator: Record<string, number> };
}

/**
 * Genera un resumen de cumplimiento para un tenant dado.
 * Útil para reportes trimestrales / auditorías externas.
 */
export async function generateComplianceReport(
  pool: Pool,
  tenant: Tenant,
  periodFrom: string,
  periodTo: string
): Promise<ComplianceSummary> {
  // Verificaciones por estado
  const sessionRes = await pool.query<{ state: string; count: string }>(
    `SELECT state, COUNT(*)::int FROM verification_sessions
     WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3
     GROUP BY state`,
    [tenant.id, periodFrom, periodTo]
  );

  const byState: Record<string, number> = {};
  let total = 0;
  for (const row of sessionRes.rows) {
    byState[row.state] = parseInt(row.count, 10);
    total += parseInt(row.count, 10);
  }

  // Consentimientos
  const consentRes = await pool.query<{ version: string; count: string }>(
    `SELECT version, COUNT(*)::int FROM consents
     WHERE tenant_id = $1 AND accepted_at BETWEEN $2 AND $3
     GROUP BY version`,
    [tenant.id, periodFrom, periodTo]
  );
  const byVersion: Record<string, number> = {};
  let consentTotal = 0;
  for (const row of consentRes.rows) {
    byVersion[row.version] = parseInt(row.count, 10);
    consentTotal += parseInt(row.count, 10);
  }

  // Supresiones (auditable via audit_log event=session.deleted)
  const suppressionRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int FROM audit_log
     WHERE tenant_id = $1 AND event = 'session.deleted' AND created_at BETWEEN $2 AND $3`,
    [tenant.id, periodFrom, periodTo]
  );
  const suppressionTotal = parseInt(suppressionRes.rows[0]?.count ?? "0", 10);

  // Retención
  const cutoff = new Date(
    Date.now() - tenant.policies.retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const pastRetentionRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int FROM verification_sessions
     WHERE tenant_id = $1 AND created_at < $2
       AND state IN ('verified','rejected','expired','error')`,
    [tenant.id, cutoff]
  );
  const pastRetention = parseInt(pastRetentionRes.rows[0]?.count ?? "0", 10);

  // Acceso admin
  const adminRes = await pool.query<{ actor: string; count: string }>(
    `SELECT actor, COUNT(*)::int FROM audit_log
     WHERE tenant_id = $1 AND actor LIKE 'admin:%' AND created_at BETWEEN $2 AND $3
     GROUP BY actor`,
    [tenant.id, periodFrom, periodTo]
  );
  const byOperator: Record<string, number> = {};
  let adminTotal = 0;
  for (const row of adminRes.rows) {
    byOperator[row.actor] = parseInt(row.count, 10);
    adminTotal += parseInt(row.count, 10);
  }

  return {
    tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
    generatedAt: new Date().toISOString(),
    period: { from: periodFrom, to: periodTo },
    verificationStats: { total, byState },
    consentStats: { total: consentTotal, byVersion },
    suppressionStats: { total: suppressionTotal },
    retentionStats: { retentionDays: tenant.policies.retentionDays, sessionsPastRetention: pastRetention },
    adminAccessStats: { totalEntries: adminTotal, byOperator },
  };
}
