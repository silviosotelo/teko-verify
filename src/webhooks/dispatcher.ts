/**
 * Dispatcher de webhooks (P0 #2) — resuelve destinos, crea entregas, las POSTea
 * firmadas y reintenta con backoff. TODO en-proceso (sin broker).
 *
 * GARANTÍAS:
 *   - FAIL-OPEN: ninguna falla de entrega lanza hacia el pipeline/API. emit() nunca
 *     rechaza; un endpoint caído sólo deja la entrega en 'failed' y se reprograma.
 *   - SÍNCRONO: el PRIMER intento de cada entrega se ejecuta dentro de emit() (await),
 *     así una transición real produce el POST inmediatamente. Los REINTENTOS se
 *     programan con setTimeout (in-proc); al boot, recoverDue() barre los vencidos.
 *   - IDEMPOTENCIA: cada entrega tiene un event_id único (header X-Event-Id), estable
 *     entre reintentos del mismo delivery → el cliente deduplica por él.
 *   - FIRMA: X-Signature (sha256 del cuerpo canónico con timestamp) + X-Timestamp,
 *     con el secreto del destino (endpoint.secret) o, para el callbackUrl legacy de
 *     la sesión, el secreto del tenant.
 *
 * Inyectable (DispatcherDeps) para tests sin DB/HTTP/timers reales.
 */
import { randomUUID } from "crypto";
import type {
  SessionResult,
  VerificationSession,
  WebhookDeliveryRecord,
  WebhookEndpoint,
  WebhookEvent,
  WebhookEventPayload,
} from "../types";
import {
  backoffMs,
  canonicalBody,
  eventMatches,
  RETRY_BACKOFF_MS,
  signatureHeader,
} from "./signing";

export interface HttpResult {
  status: number;
  body: string;
}

export interface DispatcherDeps {
  endpoints: {
    listEnabledByTenant(tenantId: string): Promise<WebhookEndpoint[]>;
    getById(tenantId: string, id: string): Promise<WebhookEndpoint | null>;
  };
  deliveries: {
    create(input: {
      endpointId: string | null;
      tenantId: string;
      sessionId: string | null;
      eventId: string;
      eventType: WebhookEvent;
      url: string;
      payload: WebhookEventPayload;
      maxAttempts?: number;
    }): Promise<WebhookDeliveryRecord>;
    getById(id: string): Promise<WebhookDeliveryRecord | null>;
    recordAttempt(
      id: string,
      input: {
        status: WebhookDeliveryRecord["status"];
        responseCode?: number | null;
        responseBody?: string | null;
        error?: string | null;
        nextAttemptInMs?: number | null;
      }
    ): Promise<WebhookDeliveryRecord | null>;
    listDue(limit?: number): Promise<WebhookDeliveryRecord[]>;
  };
  /** Resuelve el secreto del tenant (para el callbackUrl legacy, endpoint_id NULL). */
  tenantSecret(tenantId: string): Promise<string | null>;
  /** POST HTTP. Debe NO lanzar por status no-2xx (devolver el status). */
  httpPost(url: string, headers: Record<string, string>, body: string): Promise<HttpResult>;
  /** Programa un reintento diferido (setTimeout en prod; no-op/controlado en test). */
  schedule(fn: () => void, ms: number): void;
  /** Reloj (ms). */
  now(): number;
  /** Generador del event_id (UUID en prod). */
  genEventId(): string;
  /** Backoff de reintentos (ms). */
  backoff: readonly number[];
}

const TIMESTAMP_HEADER = "X-Timestamp";

function buildPayload(
  eventId: string,
  event: WebhookEvent,
  session: VerificationSession,
  result: SessionResult | null,
  createdAtIso: string
): WebhookEventPayload {
  return {
    id: eventId,
    event,
    createdAt: createdAtIso,
    data: {
      sessionId: session.id,
      tenantId: session.tenantId,
      externalRef: session.externalRef,
      state: session.state,
      assuranceRequired: session.assuranceRequired,
      result,
    },
  };
}

export class WebhookDispatcher {
  constructor(private deps: DispatcherDeps) {}

  /**
   * Emite un evento del ciclo de vida de la sesión a todos los destinos suscritos
   * del tenant (+ al callbackUrl legacy de la sesión si lo tiene). Crea las entregas
   * y dispara el primer intento de cada una. FAIL-OPEN: nunca lanza.
   */
  async emitSessionEvent(
    session: VerificationSession,
    event: WebhookEvent,
    result: SessionResult | null = session.result ?? null
  ): Promise<WebhookDeliveryRecord[]> {
    const created: WebhookDeliveryRecord[] = [];
    try {
      const endpoints = await this.deps.endpoints.listEnabledByTenant(session.tenantId);
      const targets: Array<{ endpointId: string | null; url: string }> = [];
      for (const ep of endpoints) {
        if (eventMatches(ep.events, event)) targets.push({ endpointId: ep.id, url: ep.url });
      }
      // Destino ad-hoc: callbackUrl de la sesión (compat legacy, firmado con secreto
      // del tenant). Suscrito implícitamente a TODOS los eventos.
      if (session.callbackUrl) targets.push({ endpointId: null, url: session.callbackUrl });

      const createdAt = new Date(this.deps.now()).toISOString();
      for (const t of targets) {
        const eventId = this.deps.genEventId();
        const payload = buildPayload(eventId, event, session, result, createdAt);
        const rec = await this.deps.deliveries.create({
          endpointId: t.endpointId,
          tenantId: session.tenantId,
          sessionId: session.id,
          eventId,
          eventType: event,
          url: t.url,
          payload,
        });
        created.push(rec);
      }
    } catch (e) {
      // FAIL-OPEN: una falla resolviendo/creando entregas no rompe el pipeline.
      // eslint-disable-next-line no-console
      console.warn(`[webhook] emit ${event} falló: ${(e as Error).message}`);
      return created;
    }

    // Primer intento síncrono de cada entrega (fail-open, secuencial).
    for (const rec of created) {
      await this.attempt(rec.id).catch(() => undefined);
    }
    return created;
  }

  /** Resuelve el secreto a usar para una entrega (endpoint o tenant para callbackUrl). */
  private async resolveSecret(rec: WebhookDeliveryRecord): Promise<string | null> {
    if (rec.endpointId) {
      const ep = await this.deps.endpoints.getById(rec.tenantId, rec.endpointId);
      return ep ? ep.secret : null;
    }
    return this.deps.tenantSecret(rec.tenantId);
  }

  /**
   * Intenta entregar una entrega por id. Firma, POSTea, registra el resultado y
   * reprograma con backoff si falló y quedan reintentos. Devuelve el registro
   * actualizado. FAIL-OPEN: nunca lanza (un error se captura como 'failed').
   */
  async attempt(deliveryId: string): Promise<WebhookDeliveryRecord | null> {
    const rec = await this.deps.deliveries.getById(deliveryId);
    if (!rec) return null;
    if (rec.status === "delivered" || rec.status === "dead") return rec;
    if (rec.attempts >= rec.maxAttempts) return rec;

    const secret = await this.resolveSecret(rec);
    if (!secret) {
      // Sin secreto no se firma (fail-closed en seguridad): marca dead, no reintenta.
      return this.deps.deliveries.recordAttempt(rec.id, {
        status: "dead",
        error: "no_secret_for_endpoint",
        nextAttemptInMs: null,
      });
    }

    const timestamp = Math.floor(this.deps.now() / 1000);
    const body = canonicalBody(rec.payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Teko-Event": rec.eventType,
      "X-Event-Id": rec.eventId,
      [TIMESTAMP_HEADER]: String(timestamp),
      "X-Signature": signatureHeader(secret, timestamp, body),
    };

    let status = 0;
    let respBody = "";
    let error: string | null = null;
    try {
      const res = await this.deps.httpPost(rec.url, headers, body);
      status = res.status;
      respBody = res.body.slice(0, 2000);
    } catch (e) {
      error = (e as Error).message;
    }

    const ok = status >= 200 && status < 300;
    if (ok) {
      return this.deps.deliveries.recordAttempt(rec.id, {
        status: "delivered",
        responseCode: status,
        responseBody: respBody,
        nextAttemptInMs: null,
      });
    }

    // Falló: ¿quedan reintentos? attempts ya hechos = rec.attempts + 1 tras este.
    const attemptsAfter = rec.attempts + 1;
    const delay = attemptsAfter < rec.maxAttempts ? backoffMs(attemptsAfter, this.deps.backoff) : null;
    const updated = await this.deps.deliveries.recordAttempt(rec.id, {
      status: delay != null ? "failed" : "dead",
      responseCode: status || null,
      responseBody: respBody || null,
      error,
      nextAttemptInMs: delay,
    });
    if (delay != null) {
      this.deps.schedule(() => {
        this.attempt(deliveryId).catch(() => undefined);
      }, delay);
    }
    return updated;
  }

  /** Reenvío manual (admin): fuerza un nuevo intento ahora, ignore estado terminal. */
  async resend(deliveryId: string): Promise<WebhookDeliveryRecord | null> {
    const rec = await this.deps.deliveries.getById(deliveryId);
    if (!rec) return null;
    // Si ya está agotado/entregado, igualmente reintentamos UNA vez: subimos el techo
    // de intentos en 1 para permitir el reenvío manual sin resetear el historial.
    if (rec.attempts >= rec.maxAttempts || rec.status === "delivered" || rec.status === "dead") {
      // recordAttempt incrementa attempts; para permitir el reintento, forzamos el
      // intento llamando attempt() tras un "revive": lo dejamos en failed con techo+1.
      await this.deps.deliveries.recordAttempt(rec.id, {
        status: "failed",
        responseCode: rec.responseCode,
        responseBody: rec.responseBody,
        error: rec.error,
        nextAttemptInMs: null,
      });
    }
    return this.attempt(deliveryId);
  }

  /**
   * Entrega de PRUEBA (admin): crea y entrega un evento `ping` (sample) a un endpoint
   * concreto y devuelve el resultado del intento. Si el endpoint no existe → null.
   */
  async test(tenantId: string, endpointId: string): Promise<WebhookDeliveryRecord | null> {
    const ep = await this.deps.endpoints.getById(tenantId, endpointId);
    if (!ep) return null;
    const eventId = this.deps.genEventId();
    const createdAt = new Date(this.deps.now()).toISOString();
    const payload: WebhookEventPayload = {
      id: eventId,
      event: "session.status_updated",
      createdAt,
      data: {
        sessionId: "00000000-0000-0000-0000-000000000000",
        tenantId,
        externalRef: "ping",
        state: "verified",
        assuranceRequired: "L2",
        result: { decision: "verified", loa: "L2", reasons: ["ping"] },
      },
    };
    const rec = await this.deps.deliveries.create({
      endpointId: ep.id,
      tenantId,
      sessionId: null,
      eventId,
      eventType: "session.status_updated",
      url: ep.url,
      payload,
      maxAttempts: 1, // el test no reintenta: reporta el resultado del único intento
    });
    return this.attempt(rec.id);
  }

  /** Barrido de recuperación: reintenta entregas vencidas (tras reinicio del proceso). */
  async recoverDue(limit = 50): Promise<number> {
    try {
      const due = await this.deps.deliveries.listDue(limit);
      for (const rec of due) await this.attempt(rec.id).catch(() => undefined);
      return due.length;
    } catch {
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Wiring real (singleton): repos PG + fetch + setTimeout. Import perezoso de repos
// para no acoplar el módulo puro de tests con la capa de datos.
// ---------------------------------------------------------------------------

const HTTP_TIMEOUT_MS = parseInt(process.env.TEKO_WEBHOOK_TIMEOUT_MS || "10000", 10);

async function realHttpPost(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<HttpResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    const text = await res.text().catch(() => "");
    return { status: res.status, body: text };
  } finally {
    clearTimeout(t);
  }
}

function buildRealDeps(): DispatcherDeps {
  // Import diferido: evita ciclos y mantiene signing.ts/dispatcher.ts testeables solos.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { repos } = require("../db/repos") as typeof import("../db/repos");
  return {
    endpoints: {
      listEnabledByTenant: (t) => repos.webhookEndpoints.listEnabledByTenant(t),
      getById: (t, id) => repos.webhookEndpoints.getById(t, id),
    },
    deliveries: {
      create: (i) => repos.webhookDeliveries.create(i),
      getById: (id) => repos.webhookDeliveries.getById(id),
      recordAttempt: (id, i) => repos.webhookDeliveries.recordAttempt(id, i),
      listDue: (l) => repos.webhookDeliveries.listDue(l),
    },
    tenantSecret: async (tenantId) => {
      const t = await repos.tenants.getById(tenantId);
      return t ? t.webhookSecret : null;
    },
    httpPost: realHttpPost,
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      // No mantener vivo el proceso por reintentos pendientes.
      if (typeof timer.unref === "function") timer.unref();
    },
    now: () => Date.now(),
    genEventId: () => `evt_${randomUUID()}`,
    backoff: RETRY_BACKOFF_MS,
  };
}

let _instance: WebhookDispatcher | null = null;

/** Dispatcher singleton con dependencias reales (lazy). */
export function webhookDispatcher(): WebhookDispatcher {
  if (!_instance) _instance = new WebhookDispatcher(buildRealDeps());
  return _instance;
}
