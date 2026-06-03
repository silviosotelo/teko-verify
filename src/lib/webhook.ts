/**
 * WebhookSender: POST firmado HMAC al callback_url del tenant al completar
 * (session.verified / session.rejected) — §8.
 *
 * Seguridad (hardening):
 *   - FIRMA POR TENANT: cada webhook se firma con el secreto del tenant DUEÑO de la
 *     sesión (tenants.webhook_secret), NO con un TEKO_WEBHOOK_SECRET global.
 *   - FAIL-CLOSED: si no hay secreto del tenant (o está vacío) NO se firma con clave
 *     vacía ni se envía: se LANZA. El pipeline (safeWebhook) traga el throw sin
 *     cambiar el veredicto, de modo que una falla de webhook nunca produce "verified".
 *
 * Reintentos con backoff (best-effort en proceso). Dead-letter real + persistencia
 * de WebhookDelivery quedan como trabajo futuro. El timestamp del payload es
 * anti-replay; la firma va en headers.
 */
import type {
  SessionResult,
  VerificationSession,
  WebhookEventType,
  WebhookPayload,
} from "../types";
import { repos } from "../db/repos";
import { signWebhook } from "./crypto";

const MAX_ATTEMPTS = parseInt(process.env.TEKO_WEBHOOK_ATTEMPTS || "5", 10);

/** Resuelve el secreto HMAC del tenant dueño de la sesión. */
type SecretResolver = (tenantId: string) => Promise<string | null>;

const defaultSecretResolver: SecretResolver = async (tenantId) => {
  const tenant = await repos.tenants.getById(tenantId);
  return tenant ? tenant.webhookSecret : null;
};

export class HttpWebhookSender {
  constructor(private resolveSecret: SecretResolver = defaultSecretResolver) {}

  async send(
    session: VerificationSession,
    event: WebhookEventType,
    result: SessionResult
  ): Promise<void> {
    if (!session.callbackUrl) return;

    // Fail-closed: secreto por tenant obligatorio. Sin secreto → NO firmar/enviar.
    const secret = await this.resolveSecret(session.tenantId);
    if (!secret) {
      throw new Error(
        `[webhook] sin secreto para tenant=${session.tenantId}: no se firma/envía (fail-closed)`
      );
    }

    const payload: WebhookPayload = {
      event,
      sessionId: session.id,
      externalRef: session.externalRef,
      state: session.state,
      result,
      timestamp: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const signature = signWebhook(secret, body);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(session.callbackUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Teko-Event": event,
            "X-Teko-Signature": `sha256=${signature}`,
          },
          body,
        });
        if (res.ok) return;
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
      // Backoff exponencial simple (no en el último intento).
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, Math.min(30000, 2 ** attempt * 250)));
      }
    }
    // eslint-disable-next-line no-console
    console.error(
      `[webhook] dead-letter ${event} session=${session.id}: ${(lastErr as Error)?.message}`
    );
  }
}

export const webhookSender = new HttpWebhookSender();
