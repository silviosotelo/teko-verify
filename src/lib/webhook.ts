/**
 * WebhookSender (P0 #2): adapta el disparo del PIPELINE (verified/rejected) al
 * subsistema de webhooks por SUSCRIPCIÓN (webhooks/dispatcher.ts).
 *
 * El pipeline llama send(session, "session.verified"|"session.rejected", result) en
 * los puntos terminales (igual que en P0 #1). Aquí lo TRADUCIMOS a la taxonomía
 * pública de eventos y lo entregamos a los destinos suscritos del tenant:
 *   - session.verified → session.approved + session.status_updated
 *                        (+ session.data_updated si hay datos extraídos)
 *   - session.rejected → session.declined + session.status_updated
 *
 * El dispatcher resuelve los destinos, firma (HMAC), entrega y reintenta con backoff
 * de forma FAIL-OPEN: una falla de webhook nunca cambia el veredicto del pipeline.
 * (El callbackUrl legacy de la sesión sigue funcionando: el dispatcher lo trata como
 * destino ad-hoc firmado con el secreto del tenant.)
 */
import type {
  SessionResult,
  VerificationSession,
  WebhookEvent,
  WebhookEventType,
} from "../types";
import { webhookDispatcher } from "../webhooks/dispatcher";

/** Eventos públicos a emitir para cada evento terminal del pipeline. */
function publicEventsFor(
  event: WebhookEventType,
  result: SessionResult
): WebhookEvent[] {
  if (event === "session.verified") {
    const out: WebhookEvent[] = ["session.approved", "session.status_updated"];
    if (result.extracted) out.push("session.data_updated");
    return out;
  }
  // session.rejected
  return ["session.declined", "session.status_updated"];
}

export class HttpWebhookSender {
  async send(
    session: VerificationSession,
    event: WebhookEventType,
    result: SessionResult
  ): Promise<void> {
    const dispatcher = webhookDispatcher();
    for (const ev of publicEventsFor(event, result)) {
      // emitSessionEvent es fail-open (nunca lanza); aun así, defensa en profundidad.
      await dispatcher.emitSessionEvent(session, ev, result).catch(() => undefined);
    }
  }
}

export const webhookSender = new HttpWebhookSender();
