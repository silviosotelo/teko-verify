/**
 * Disparo de usage_alerts (Sprint 1 — monetización-lite).
 *
 * Las alertas de consumo se CONFIGURAN en `usage_alerts` (repo + endpoints admin),
 * pero hasta ahora nada las disparaba. Esta pieza cierra el loop: un barrido horario
 * (cableado en el scheduler de cleanup.ts) que, por cada alerta habilitada, compara
 * el uso del período contra el umbral y notifica por su canal (email/webhook).
 *
 * Reglas:
 *   - Fuente ÚNICA de uso/cuota/período: `getQuotaStatus(tenantId)` (billing.ts), una
 *     sola llamada por tenant (las alertas se agrupan por tenant antes de resolver).
 *   - Cuota null (ilimitado) o <= 0 ⇒ nunca dispara (no hay umbral de % significativo).
 *   - Re-disparo por período: vuelve a disparar sólo si `last_fired_at` es null o quedó
 *     ANTES del inicio del período actual (reset implícito al rotar el período).
 *   - FAIL-OPEN por alerta: un fallo de notificación no aborta el resto del barrido.
 */
import { repos } from "../db/repos";
import { getQuotaStatus } from "./billing";
import { sendTemplatedEmail } from "./mailer";
import type { UsageAlert } from "../types";

/** Timeout del POST de webhook (alineado con el resto de llamadas HTTP salientes). */
const WEBHOOK_TIMEOUT_MS = 10_000;

/** Subconjunto de la alerta necesario para la decisión de disparo. */
export interface AlertDecisionInput {
  thresholdPct: number;
  /** ISO 8601 o null si nunca disparó. */
  lastFiredAt: string | null;
}

/** Subconjunto del estado de cuota necesario para la decisión de disparo. */
export interface QuotaDecisionInput {
  used: number;
  /** Cuota del período; null = ilimitado. */
  quota: number | null;
  /** Inicio del período actual (ISO 8601). */
  periodStart: string;
}

/**
 * Decisión PURA (sin DB ni red, testeable): ¿debe dispararse la alerta ahora?
 *   - quota null o <= 0 ⇒ false (ilimitado / sin umbral significativo; evita div/0).
 *   - pct = used / quota * 100; sólo se considera disparar si pct >= thresholdPct.
 *   - dispara si nunca disparó (lastFiredAt null) O si disparó en un período anterior
 *     (lastFiredAt < periodStart) ⇒ reset implícito por período.
 */
export function shouldFireAlert(alert: AlertDecisionInput, quota: QuotaDecisionInput): boolean {
  if (quota.quota === null || quota.quota <= 0) return false;
  const pct = (quota.used / quota.quota) * 100;
  if (pct < alert.thresholdPct) return false;
  if (alert.lastFiredAt === null) return true;
  return Date.parse(alert.lastFiredAt) < Date.parse(quota.periodStart);
}

/** Payload enviado al webhook (channel `webhook`). */
interface AlertWebhookPayload {
  tenantId: string;
  alertId: string;
  thresholdPct: number;
  used: number;
  quota: number;
  pct: number;
  periodStart: string;
  periodEnd: string;
}

/** Notifica por email (channel `email`): correo simple al target de la alerta. */
async function notifyEmail(payload: AlertWebhookPayload, target: string): Promise<void> {
  const pctStr = payload.pct.toFixed(1);
  await sendTemplatedEmail(
    target,
    {
      subject: "Teko Verify — alerta de consumo ({pct}% de la cuota)",
      html:
        `<!doctype html><html lang="es"><body style="font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">` +
        `<h2 style="color:#059669;">Teko Verify — alerta de consumo</h2>` +
        `<p>El consumo del tenant <strong>{tenantId}</strong> alcanzó <strong>{pct}%</strong> ` +
        `de la cuota del período (umbral configurado: {thresholdPct}%).</p>` +
        `<p>Uso: <strong>{used}</strong> / <strong>{quota}</strong> verificaciones.</p>` +
        `<p style="font-size:12px;color:#64748b;">Período: {periodStart} — {periodEnd}</p>` +
        `</body></html>`,
      text:
        "Teko Verify — alerta de consumo\n\n" +
        "El tenant {tenantId} alcanzó {pct}% de la cuota del período (umbral {thresholdPct}%).\n" +
        "Uso: {used} / {quota} verificaciones.\nPeríodo: {periodStart} — {periodEnd}",
    },
    {
      tenantId: payload.tenantId,
      pct: pctStr,
      thresholdPct: String(payload.thresholdPct),
      used: String(payload.used),
      quota: String(payload.quota),
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
    }
  );
}

/** Notifica por webhook (channel `webhook`): POST simple del payload al target. */
async function notifyWebhook(payload: AlertWebhookPayload, target: string): Promise<void> {
  const res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`webhook respondió ${res.status}`);
  }
}

/** Dispara la notificación de una alerta por su canal. */
async function notifyAlert(alert: UsageAlert, payload: AlertWebhookPayload): Promise<void> {
  if (alert.channel === "email") {
    await notifyEmail(payload, alert.target);
  } else {
    await notifyWebhook(payload, alert.target);
  }
}

/**
 * Barrido de disparo de alertas: obtiene todas las alertas habilitadas, las agrupa
 * por tenant, resuelve la cuota una vez por tenant y dispara las que correspondan.
 * Devuelve cuántas alertas se evaluaron (checked) y cuántas dispararon (fired).
 */
export async function runUsageAlertsSweep(): Promise<{ checked: number; fired: number }> {
  const alerts = await repos.usageAlerts.listEnabled();

  // Agrupa por tenant para resolver getQuotaStatus una sola vez por tenant.
  const byTenant = new Map<string, UsageAlert[]>();
  for (const a of alerts) {
    const list = byTenant.get(a.tenantId);
    if (list) list.push(a);
    else byTenant.set(a.tenantId, [a]);
  }

  let checked = 0;
  let fired = 0;

  for (const [tenantId, tenantAlerts] of byTenant) {
    let quota;
    try {
      quota = await getQuotaStatus(tenantId);
    } catch (e) {
      // Fail-open: un tenant que falla al resolver cuota no aborta el resto.
      // eslint-disable-next-line no-console
      console.warn(`[usage-alerts] tenant=${tenantId} no se pudo resolver cuota: ${(e as Error).message}`);
      continue;
    }

    for (const alert of tenantAlerts) {
      checked++;
      const decide = shouldFireAlert(
        { thresholdPct: alert.thresholdPct, lastFiredAt: alert.lastFiredAt },
        { used: quota.used, quota: quota.quota, periodStart: quota.periodStart }
      );
      if (!decide) continue;

      // quota.quota es != null y > 0 acá (shouldFireAlert ya filtró ilimitado/<=0).
      const quotaVal = quota.quota as number;
      const pct = (quota.used / quotaVal) * 100;
      const payload: AlertWebhookPayload = {
        tenantId,
        alertId: alert.id,
        thresholdPct: alert.thresholdPct,
        used: quota.used,
        quota: quotaVal,
        pct,
        periodStart: quota.periodStart,
        periodEnd: quota.periodEnd,
      };

      try {
        await notifyAlert(alert, payload);
        await repos.usageAlerts.markFired(tenantId, alert.id);
        fired++;
        // eslint-disable-next-line no-console
        console.log(
          `[usage-alerts] tenant=${tenantId} alert=${alert.id} disparada ` +
            `(${pct.toFixed(1)}% >= ${alert.thresholdPct}%, canal=${alert.channel})`
        );
      } catch (e) {
        // Fail-open por alerta: no marca last_fired_at ⇒ reintenta el próximo barrido.
        // eslint-disable-next-line no-console
        console.warn(
          `[usage-alerts] tenant=${tenantId} alert=${alert.id} fallo al notificar: ${(e as Error).message}`
        );
      }
    }
  }

  return { checked, fired };
}
