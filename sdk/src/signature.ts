/**
 * Verificación de la firma de webhooks de Teko Verify.
 *
 * Replica EXACTAMENTE el algoritmo del server (src/webhooks/signing.ts):
 *
 *   firma_esperada = HMAC_SHA256(secret, `${timestamp}.${rawBody}`)   (hex)
 *   header X-Signature  = "sha256=" + firma_esperada
 *   header X-Timestamp  = unix seconds usados al firmar
 *
 * Anti-replay: se rechaza si |now - X-Timestamp| > windowSec (300s por defecto).
 * Comparación en tiempo constante (timingSafeEqual). Fail-closed: cualquier
 * formato inválido o desfase → false, nunca lanza.
 *
 * IMPORTANTE: `rawBody` DEBEN ser los BYTES EXACTOS recibidos en el cuerpo HTTP
 * (string crudo o Buffer). No re-serialices el JSON: el server firma el cuerpo
 * canónico tal cual lo envía, y volver a serializar puede cambiar el orden de las
 * claves y romper la firma.
 */
import { createHmac, timingSafeEqual } from "crypto";

/** Ventana anti-replay por defecto (segundos). Igual al server. */
export const REPLAY_WINDOW_SEC = 300;

/** Nombres de header (case-insensitive al leer). */
export const SIGNATURE_HEADER = "x-signature";
export const TIMESTAMP_HEADER = "x-timestamp";
export const EVENT_ID_HEADER = "x-event-id";
export const EVENT_TYPE_HEADER = "x-teko-event";

/** Firma HMAC-SHA256 hex de `${timestamp}.${body}` (idéntica a signPayload del server). */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

type HeaderValue = string | string[] | number | undefined;
export type HeadersLike =
  | Headers
  | Record<string, HeaderValue>
  | { get(name: string): string | null };

/** Lee un header de forma case-insensitive desde varias formas de objeto. */
function readHeader(headers: HeadersLike, name: string): string | undefined {
  const lower = name.toLowerCase();
  // Web Headers / objeto con get()
  if (typeof (headers as { get?: unknown }).get === "function") {
    const v = (headers as { get(n: string): string | null }).get(name);
    return v == null ? undefined : v;
  }
  const obj = headers as Record<string, HeaderValue>;
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) {
      const v = obj[key];
      if (Array.isArray(v)) return v[0];
      if (v === undefined) return undefined;
      return String(v);
    }
  }
  return undefined;
}

export interface VerifyWebhookOptions {
  /** Ventana anti-replay en segundos (default 300). */
  windowSec?: number;
  /** Reloj inyectable (unix seconds) para tests. */
  nowSec?: number;
}

/**
 * Verifica primitiva: dado timestamp/body/signature/secret, ¿es válida?
 * Útil si ya extrajiste los valores; equivalente a verifySignature del server.
 */
export function verifySignature(opts: {
  secret: string;
  timestamp: number;
  body: string;
  signature: string;
  windowSec?: number;
  nowSec?: number;
}): boolean {
  try {
    const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
    const windowSec = opts.windowSec ?? REPLAY_WINDOW_SEC;
    if (!Number.isFinite(opts.timestamp)) return false;
    if (Math.abs(now - opts.timestamp) > windowSec) return false;
    const expected = signPayload(opts.secret, opts.timestamp, opts.body);
    const received = opts.signature.replace(/^sha256=/, "");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(received, "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verifica una entrega de webhook a partir del cuerpo crudo + los headers HTTP.
 * Extrae X-Timestamp y X-Signature, valida la firma y la ventana anti-replay.
 * Fail-closed: devuelve false ante cualquier header faltante/mal formado.
 *
 * @param rawBody  bytes EXACTOS del cuerpo recibido (string o Buffer).
 * @param headers  headers de la request (Express req.headers, Web Headers, etc.).
 * @param secret   secreto del endpoint (o del tenant para callbackUrl legacy).
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  headers: HeadersLike,
  secret: string,
  options: VerifyWebhookOptions = {}
): boolean {
  const sig = readHeader(headers, SIGNATURE_HEADER);
  const tsRaw = readHeader(headers, TIMESTAMP_HEADER);
  if (!sig || !tsRaw) return false;
  const timestamp = parseInt(tsRaw, 10);
  if (!Number.isFinite(timestamp)) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return verifySignature({
    secret,
    timestamp,
    body,
    signature: sig,
    windowSec: options.windowSec,
    nowSec: options.nowSec,
  });
}
