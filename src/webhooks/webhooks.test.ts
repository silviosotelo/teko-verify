/**
 * Tests del subsistema de webhooks (P0 #2).
 *   - signing.ts: firma HMAC determinística + verificación (roundtrip), ventana de
 *     replay, selección de eventos, backoff, canonicalización.
 *   - dispatcher.ts: selección de destinos por evento, idempotencia (event_id único),
 *     reintentos con backoff, fail-open (repo que lanza no rompe).
 */
import { describe, it, expect } from "vitest";
import {
  backoffMs,
  canonicalBody,
  eventMatches,
  RETRY_BACKOFF_MS,
  signatureHeader,
  signPayload,
  verifySignature,
} from "./signing";
import { WebhookDispatcher } from "./dispatcher";
import type { DispatcherDeps, HttpResult } from "./dispatcher";
import type {
  VerificationSession,
  WebhookDeliveryRecord,
  WebhookEndpoint,
  WebhookEvent,
} from "../types";

// ----------------------------- signing ----------------------------------- //

describe("signing — firma HMAC determinística + verificación", () => {
  const secret = "s3cr3t-tenant-key";
  const body = canonicalBody({ b: 2, a: 1, nested: { z: 1, y: 2 } });

  it("la firma es determinística para el mismo (secreto, ts, body)", () => {
    const s1 = signPayload(secret, 1700000000, body);
    const s2 = signPayload(secret, 1700000000, body);
    expect(s1).toBe(s2);
    expect(s1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("cambia con el timestamp y con el secreto (anti-replay/aislamiento)", () => {
    const base = signPayload(secret, 1700000000, body);
    expect(signPayload(secret, 1700000001, body)).not.toBe(base);
    expect(signPayload("otro", 1700000000, body)).not.toBe(base);
  });

  it("verifySignature valida el header emitido (roundtrip cliente)", () => {
    const ts = 1700000000;
    const header = signatureHeader(secret, ts, body);
    expect(
      verifySignature({ secret, timestamp: ts, body, signature: header, nowSec: ts + 10 })
    ).toBe(true);
  });

  it("rechaza firma con secreto incorrecto y body manipulado", () => {
    const ts = 1700000000;
    const header = signatureHeader(secret, ts, body);
    expect(verifySignature({ secret: "wrong", timestamp: ts, body, signature: header, nowSec: ts })).toBe(false);
    expect(verifySignature({ secret, timestamp: ts, body: body + "x", signature: header, nowSec: ts })).toBe(false);
  });

  it("rechaza fuera de la ventana de replay (300s)", () => {
    const ts = 1700000000;
    const header = signatureHeader(secret, ts, body);
    expect(verifySignature({ secret, timestamp: ts, body, signature: header, nowSec: ts + 301 })).toBe(false);
    expect(verifySignature({ secret, timestamp: ts, body, signature: header, nowSec: ts + 299 })).toBe(true);
  });
});

describe("signing — canonicalización, selección de eventos, backoff", () => {
  it("canonicalBody es independiente del orden de claves", () => {
    expect(canonicalBody({ a: 1, b: 2 })).toBe(canonicalBody({ b: 2, a: 1 }));
    expect(canonicalBody({ x: { p: 1, q: 2 } })).toBe(canonicalBody({ x: { q: 2, p: 1 } }));
  });

  it("eventMatches respeta la suscripción y el comodín '*'", () => {
    expect(eventMatches(["session.approved"], "session.approved")).toBe(true);
    expect(eventMatches(["session.approved"], "session.declined")).toBe(false);
    expect(eventMatches(["*"], "session.created")).toBe(true);
    expect(eventMatches([], "session.created")).toBe(false); // fail-closed
  });

  it("backoffMs sigue el cronograma y se agota", () => {
    expect(backoffMs(1)).toBe(RETRY_BACKOFF_MS[0]);
    expect(backoffMs(2)).toBe(RETRY_BACKOFF_MS[1]);
    expect(backoffMs(3)).toBe(RETRY_BACKOFF_MS[2]);
    expect(backoffMs(4)).toBeNull(); // sin más reintentos
    expect(backoffMs(0)).toBeNull();
  });
});

// ----------------------------- dispatcher --------------------------------- //

const TENANT = "tenant-aaa";

function makeSession(over: Partial<VerificationSession> = {}): VerificationSession {
  return {
    id: "sess-1",
    tenantId: TENANT,
    externalRef: "ext-1",
    state: "verified",
    linkToken: "tok",
    callbackUrl: null,
    assuranceRequired: "L2",
    redirectUrl: null,
    locale: "es",
    recaptureCount: 0,
    expiresAt: new Date().toISOString(),
    completedAt: null,
    result: { decision: "verified", loa: "L2", reasons: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  } as VerificationSession;
}

function makeEndpoint(over: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: "ep-1",
    tenantId: TENANT,
    url: "https://example.test/hook",
    secret: "ep-secret",
    events: ["*"],
    description: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

/** Fake in-memory de DispatcherDeps. `http` controla el resultado de cada POST. */
function makeDeps(opts: {
  endpoints: WebhookEndpoint[];
  http: () => Promise<HttpResult>;
  tenantSecret?: string | null;
}): {
  deps: DispatcherDeps;
  store: Map<string, WebhookDeliveryRecord>;
  posts: Array<{ url: string; headers: Record<string, string>; body: string }>;
  scheduled: Array<{ ms: number; fn: () => void }>;
} {
  const store = new Map<string, WebhookDeliveryRecord>();
  const posts: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const scheduled: Array<{ ms: number; fn: () => void }> = [];
  let idSeq = 0;
  let evtSeq = 0;
  const epById = new Map(opts.endpoints.map((e) => [e.id, e]));

  const deps: DispatcherDeps = {
    endpoints: {
      listEnabledByTenant: async (t) =>
        opts.endpoints.filter((e) => e.tenantId === t && e.enabled),
      getById: async (_t, id) => epById.get(id) ?? null,
    },
    deliveries: {
      create: async (input) => {
        const id = `del-${++idSeq}`;
        const rec: WebhookDeliveryRecord = {
          id,
          endpointId: input.endpointId,
          tenantId: input.tenantId,
          sessionId: input.sessionId,
          eventId: input.eventId,
          eventType: input.eventType,
          url: input.url,
          payload: input.payload,
          status: "pending",
          attempts: 0,
          maxAttempts: input.maxAttempts ?? 4,
          responseCode: null,
          responseBody: null,
          error: null,
          lastAttemptAt: null,
          nextAttemptAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.set(id, rec);
        return rec;
      },
      getById: async (id) => store.get(id) ?? null,
      recordAttempt: async (id, input) => {
        const rec = store.get(id);
        if (!rec) return null;
        const updated: WebhookDeliveryRecord = {
          ...rec,
          attempts: rec.attempts + 1,
          status: input.status,
          responseCode: input.responseCode ?? null,
          responseBody: input.responseBody ?? null,
          error: input.error ?? null,
          lastAttemptAt: new Date().toISOString(),
          nextAttemptAt:
            input.nextAttemptInMs != null
              ? new Date(Date.now() + input.nextAttemptInMs).toISOString()
              : null,
          updatedAt: new Date().toISOString(),
        };
        store.set(id, updated);
        return updated;
      },
      listDue: async () => [],
    },
    tenantSecret: async () => (opts.tenantSecret === undefined ? "tenant-secret" : opts.tenantSecret),
    httpPost: async (url, headers, body) => {
      posts.push({ url, headers, body });
      return opts.http();
    },
    schedule: (fn, ms) => {
      scheduled.push({ ms, fn });
    },
    now: () => 1700000000000,
    genEventId: () => `evt-${++evtSeq}`,
    backoff: RETRY_BACKOFF_MS,
  };
  return { deps, store, posts, scheduled };
}

describe("dispatcher — selección de destinos por evento", () => {
  it("solo entrega a los endpoints suscritos al evento", async () => {
    const a = makeEndpoint({ id: "ep-a", events: ["session.approved"] });
    const b = makeEndpoint({ id: "ep-b", events: ["session.declined"] });
    const { deps, store } = makeDeps({ endpoints: [a, b], http: async () => ({ status: 200, body: "ok" }) });
    const d = new WebhookDispatcher(deps);

    const created = await d.emitSessionEvent(makeSession(), "session.approved");
    expect(created).toHaveLength(1);
    expect(created[0].endpointId).toBe("ep-a");
    expect([...store.values()].every((r) => r.status === "delivered")).toBe(true);
  });

  it("emite al callbackUrl legacy de la sesión (destino ad-hoc, sin endpoint)", async () => {
    const { deps } = makeDeps({ endpoints: [], http: async () => ({ status: 200, body: "ok" }) });
    const d = new WebhookDispatcher(deps);
    const created = await d.emitSessionEvent(
      makeSession({ callbackUrl: "https://tenant.test/cb" }),
      "session.approved"
    );
    expect(created).toHaveLength(1);
    expect(created[0].endpointId).toBeNull();
    expect(created[0].url).toBe("https://tenant.test/cb");
  });
});

describe("dispatcher — firma e idempotencia", () => {
  it("el POST lleva X-Event-Id, X-Timestamp y X-Signature válida", async () => {
    const ep = makeEndpoint({ secret: "abc123" });
    const { deps, posts } = makeDeps({ endpoints: [ep], http: async () => ({ status: 200, body: "" }) });
    const d = new WebhookDispatcher(deps);
    await d.emitSessionEvent(makeSession(), "session.approved");

    expect(posts).toHaveLength(1);
    const { headers, body } = posts[0];
    expect(headers["X-Event-Id"]).toBe("evt-1");
    expect(headers["X-Teko-Event"]).toBe("session.approved");
    const ts = parseInt(headers["X-Timestamp"], 10);
    // La firma valida con el secreto del endpoint (verificación del cliente).
    expect(
      verifySignature({ secret: "abc123", timestamp: ts, body, signature: headers["X-Signature"], nowSec: ts })
    ).toBe(true);
  });

  it("cada entrega tiene un event_id único (idempotencia por destino)", async () => {
    const a = makeEndpoint({ id: "ep-a", events: ["*"] });
    const b = makeEndpoint({ id: "ep-b", events: ["*"] });
    const { deps, store } = makeDeps({ endpoints: [a, b], http: async () => ({ status: 200, body: "" }) });
    const d = new WebhookDispatcher(deps);
    await d.emitSessionEvent(makeSession(), "session.status_updated");
    const ids = [...store.values()].map((r) => r.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(2);
  });
});

describe("dispatcher — reintentos con backoff", () => {
  it("un endpoint que falla (500) deja la entrega 'failed' y programa reintento", async () => {
    const ep = makeEndpoint();
    const { deps, store, scheduled } = makeDeps({
      endpoints: [ep],
      http: async () => ({ status: 500, body: "err" }),
    });
    const d = new WebhookDispatcher(deps);
    const [rec] = await d.emitSessionEvent(makeSession(), "session.approved");

    const stored = store.get(rec.id)!;
    expect(stored.status).toBe("failed");
    expect(stored.attempts).toBe(1);
    expect(stored.responseCode).toBe(500);
    // Reprogramado con el primer backoff.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(RETRY_BACKOFF_MS[0]);
  });

  it("al agotar maxAttempts la entrega queda 'dead' y NO reprograma", async () => {
    const ep = makeEndpoint();
    const { deps, store, scheduled } = makeDeps({
      endpoints: [ep],
      http: async () => ({ status: 503, body: "down" }),
    });
    const d = new WebhookDispatcher(deps);
    // Pre-cargar una entrega con attempts=3 (maxAttempts=4): el próximo intento es el último.
    store.set("del-x", {
      id: "del-x",
      endpointId: ep.id,
      tenantId: TENANT,
      sessionId: "sess-1",
      eventId: "evt-x",
      eventType: "session.approved",
      url: ep.url,
      payload: {
        id: "evt-x",
        event: "session.approved",
        createdAt: new Date().toISOString(),
        data: { sessionId: "sess-1", tenantId: TENANT, externalRef: null, state: "rejected", assuranceRequired: "L2", result: null },
      },
      status: "failed",
      attempts: 3,
      maxAttempts: 4,
      responseCode: 503,
      responseBody: null,
      error: null,
      lastAttemptAt: null,
      nextAttemptAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const out = await d.attempt("del-x");
    expect(out?.status).toBe("dead");
    expect(out?.attempts).toBe(4);
    expect(scheduled).toHaveLength(0);
  });

  it("un endpoint caído (throw de red) cuenta como fallo (no lanza)", async () => {
    const ep = makeEndpoint();
    const { deps, store } = makeDeps({
      endpoints: [ep],
      http: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const d = new WebhookDispatcher(deps);
    const [rec] = await d.emitSessionEvent(makeSession(), "session.approved");
    const stored = store.get(rec.id)!;
    expect(stored.status).toBe("failed");
    expect(stored.error).toContain("ECONNREFUSED");
  });
});

describe("dispatcher — fail-open", () => {
  it("si resolver/crear entregas lanza, emit no rompe (devuelve [])", async () => {
    const { deps } = makeDeps({ endpoints: [], http: async () => ({ status: 200, body: "" }) });
    deps.endpoints.listEnabledByTenant = async () => {
      throw new Error("db down");
    };
    const d = new WebhookDispatcher(deps);
    await expect(d.emitSessionEvent(makeSession(), "session.approved")).resolves.toEqual([]);
  });

  it("sin secreto resoluble la entrega ad-hoc queda 'dead' (fail-closed en firma)", async () => {
    const { deps, store } = makeDeps({
      endpoints: [],
      http: async () => ({ status: 200, body: "" }),
      tenantSecret: null,
    });
    const d = new WebhookDispatcher(deps);
    const [rec] = await d.emitSessionEvent(makeSession({ callbackUrl: "https://t.test/cb" }), "session.approved");
    expect(store.get(rec.id)!.status).toBe("dead");
  });
});
