/**
 * Verificación de la firma de webhooks de Teko Verify.
 *
 * Replica EXACTAMENTE el algoritmo del server (src/webhooks/signing.ts). El server
 * firma hoy con el esquema **v2** (el dispatcher emite `sha256v2=` + cabecera
 * `X-Signature-Version: 2`); este módulo soporta v2 y mantiene v1 por compatibilidad,
 * detectando la versión por el prefijo del header `X-Signature` igual que el server:
 *
 *   v1:  firma = HMAC_SHA256(secret, `${timestamp}.${rawBody}`)          (hex)
 *        header X-Signature = "sha256=" + firma   (o el hex pelado)
 *
 *   v2:  firma = HMAC_SHA256(secret, `2.${timestamp}.${rawBody}`)        (hex)   ← actual
 *        header X-Signature = "sha256v2=" + firma + X-Signature-Version: 2
 *
 *   header X-Timestamp = unix seconds usados al firmar (parte del input firmado).
 *
 * Anti-replay: se rechaza si |now - X-Timestamp| > windowSec (300s por defecto).
 * Comparación en tiempo constante (timingSafeEqual). Fail-closed: cualquier
 * formato inválido o desfase → false, nunca lanza.
 *
 * IMPORTANTE: `rawBody` DEBEN ser los BYTES EXACTOS recibidos en el cuerpo HTTP
 * (string crudo o Buffer). No re-serialices el JSON: el server firma el cuerpo
 * canónico tal cual lo envía (claves ordenadas recursivamente, separadores
 * compactos), y volver a serializar puede cambiar el orden de las claves y romper
 * la firma.
 */
import { createHmac, timingSafeEqual } from "crypto";

/** Ventana anti-replay por defecto (segundos). Igual al server. */
export const REPLAY_WINDOW_SEC = 300;

/** Nombres de header (case-insensitive al leer). */
export const SIGNATURE_HEADER = "x-signature";
export const TIMESTAMP_HEADER = "x-timestamp";
export const EVENT_ID_HEADER = "x-event-id";
export const EVENT_TYPE_HEADER = "x-teko-event";

/** Firma HMAC-SHA256 hex v1 de `${timestamp}.${body}` (idéntica a signPayload del server). */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Firma HMAC-SHA256 hex v2 de `2.${timestamp}.${body}` (idéntica a signPayloadV2 del
 * server). La versión "2" se incluye en el HMAC para evitar replay entre versiones.
 */
export function signPayloadV2(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`2.${timestamp}.${body}`).digest("hex");
}

/**
 * Determina la versión de firma a partir del header X-Signature recibido, igual que
 * el server: "sha256v2=" → v2; "sha256=" o hex pelado → v1 (compat).
 */
export function detectSignatureVersion(signature: string): 1 | 2 {
  return signature.startsWith("sha256v2=") ? 2 : 1;
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
    // Detecta la versión por el prefijo del header (igual que el server) y firma con
    // el input correcto: v2 = `2.${ts}.${body}`, v1 = `${ts}.${body}`.
    const version = detectSignatureVersion(opts.signature);
    const expected =
      version === 2
        ? signPayloadV2(opts.secret, opts.timestamp, opts.body)
        : signPayload(opts.secret, opts.timestamp, opts.body);
    const received = opts.signature.replace(/^sha256v2=/, "").replace(/^sha256=/, "");
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
