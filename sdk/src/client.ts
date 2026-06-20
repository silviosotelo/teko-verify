/**
 * Cliente server-side de la API del tenant de Teko Verify (Bearer API key).
 * Cubre los endpoints reales bajo /v1: crear sesión, consultar estado/decisión,
 * listar y borrar. Sin dependencias: usa el `fetch` global (Node >=18).
 *
 * USAR SÓLO EN BACKEND: la API key es un secreto del tenant, nunca en el browser.
 */
import type {
  CreateSessionOptions,
  CreateSessionResponse,
  DeleteSessionResponse,
  ListSessionsOptions,
  ListSessionsResponse,
  SessionResult,
  SessionStatusResponse,
} from "./types";
import { verifySignature } from "./signature";

/** Argumentos del helper de verificación de firma de webhooks (forma por objeto). */
export interface VerifyWebhookSignatureInput {
  /** Cuerpo CRUDO recibido (los bytes exactos del POST; no re-serializar). */
  payload: string | Buffer;
  /** Valor del header `X-Signature` ("sha256v2=...", "sha256=..." o hex pelado). */
  signature: string;
  /** Valor del header `X-Timestamp` (unix seconds; string o number). */
  timestamp: number | string;
  /** Secreto del endpoint (o del tenant para el callbackUrl legacy). */
  secret: string;
  /** Ventana anti-replay en segundos (default 300). */
  windowSec?: number;
  /** Reloj inyectable (unix seconds) para tests. */
  nowSec?: number;
}

export interface TekoClientOptions {
  /** Base de la API, p.ej. "https://teko.rohekawebservices.online". Sin barra final. */
  baseUrl: string;
  /** API key del tenant (formato tk_live_...). Secreto: sólo server-side. */
  apiKey: string;
  /** Timeout por request en ms (default 15000). */
  timeoutMs?: number;
  /** fetch inyectable (tests). Por defecto el global. */
  fetch?: typeof fetch;
}

/** Error de API: status HTTP + cuerpo de error parseado del server. */
export class TekoApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Teko API error ${status}`);
    this.name = "TekoApiError";
    this.status = status;
    this.body = body;
  }
}

export class TekoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TekoClientOptions) {
    if (!opts.baseUrl) throw new Error("TekoClient: baseUrl requerido");
    if (!opts.apiKey) throw new Error("TekoClient: apiKey requerida");
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    const f = opts.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new Error("TekoClient: no hay fetch disponible (Node >=18 o pasá opts.fetch)");
    }
    this.fetchImpl = f;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== "") qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          Accept: "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      const parsed: unknown = text ? safeJson(text) : null;
      if (!res.ok) {
        throw new TekoApiError(res.status, parsed, errMessage(parsed, res.status));
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Crea una verificación. Devuelve { sessionId, verificationUrl, expiresAt }.
   * Redirigí al titular a `verificationUrl` (flujo HOSTED). Si pasás `externalRef`
   * y ya existía una sesión con esa ref, devuelve la MISMA (idempotencia).
   */
  createSession(opts: CreateSessionOptions = {}): Promise<CreateSessionResponse> {
    return this.request<CreateSessionResponse>("POST", "/v1/sessions", opts);
  }

  /** Estado + resultado de una sesión por id. */
  getSession(sessionId: string): Promise<SessionStatusResponse> {
    return this.request<SessionStatusResponse>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}`
    );
  }

  /**
   * Atajo: la DECISIÓN de una sesión. Devuelve el `result` (decision/loa/reasons),
   * o null si todavía no hay decisión. Usa el mismo endpoint que getSession.
   */
  async getDecision(sessionId: string): Promise<SessionResult | null> {
    const s = await this.getSession(sessionId);
    return s.result;
  }

  /** Lista sesiones del tenant con filtros opcionales. */
  listSessions(opts: ListSessionsOptions = {}): Promise<ListSessionsResponse> {
    return this.request<ListSessionsResponse>("GET", "/v1/sessions", undefined, {
      state: opts.state,
      externalRef: opts.externalRef,
      from: opts.from,
      to: opts.to,
      limit: opts.limit,
      offset: opts.offset,
    });
  }

  /** Borra una sesión y su evidencia (derecho a supresión). */
  deleteSession(sessionId: string): Promise<DeleteSessionResponse> {
    return this.request<DeleteSessionResponse>(
      "DELETE",
      `/v1/sessions/${encodeURIComponent(sessionId)}`
    );
  }
}

/**
 * Cliente principal del SDK: `new TekoVerify({ apiKey, baseUrl })`.
 *
 * Es `TekoClient` con un nombre alineado al paquete (`@teko/verify-sdk`) más el
 * helper ESTÁTICO `verifyWebhookSignature` para validar la firma v2 de los webhooks
 * sin instanciar el cliente.
 *
 *   const teko = new TekoVerify({ apiKey, baseUrl });
 *   const { verificationUrl } = await teko.createSession({ externalRef: "user-42" });
 *
 *   // en el handler del webhook (con el cuerpo CRUDO):
 *   const ok = TekoVerify.verifyWebhookSignature({
 *     payload: rawBody,
 *     signature: req.header("x-signature")!,
 *     timestamp: req.header("x-timestamp")!,
 *     secret: WEBHOOK_SECRET,
 *   });
 *   if (!ok) return res.sendStatus(401);
 */
export class TekoVerify extends TekoClient {
  /**
   * Verifica la firma de un webhook (HMAC v2, replica EXACTA de src/webhooks/signing.ts).
   * Detecta la versión por el prefijo del header: `sha256v2=` → input `2.${ts}.${body}`;
   * `sha256=`/hex → input `${ts}.${body}`. Comparación en tiempo constante + ventana
   * anti-replay (300s). Fail-closed: cualquier dato inválido → false (nunca lanza).
   *
   * `payload` DEBEN ser los bytes CRUDOS recibidos (no re-serializar el JSON).
   */
  static verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
    const body =
      typeof input.payload === "string" ? input.payload : input.payload.toString("utf8");
    const timestamp =
      typeof input.timestamp === "number" ? input.timestamp : parseInt(input.timestamp, 10);
    return verifySignature({
      secret: input.secret,
      timestamp,
      body,
      signature: input.signature,
      windowSec: input.windowSec,
      nowSec: input.nowSec,
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errMessage(parsed: unknown, status: number): string {
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const e = parsed as { error?: unknown; detail?: unknown };
    const base = String(e.error);
    return e.detail ? `${base}: ${String(e.detail)}` : base;
  }
  return `Teko API error ${status}`;
}
