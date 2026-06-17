/**
 * Primitivas PURAS del subsistema de webhooks (P0 #2). Sin I/O ni estado: todo
 * lo aquí definido es determinístico y testeable de forma aislada.
 *
 * Firma (inspirada en Didit §4): HMAC-SHA256 sobre el cuerpo CANÓNICO precedido del
 * timestamp, en la forma `${timestamp}.${body}`. El header X-Signature lleva
 * `sha256=<hexhmac>` y X-Timestamp el unix-seconds usado. Atar el timestamp a la
 * firma da anti-replay: el receptor rechaza si |now - X-Timestamp| > ventana (300s).
 *
 * Verificación del lado del CLIENTE (se documenta para el integrador):
 *   const expected = "sha256=" + hmacSHA256Hex(secret, `${xTimestamp}.${rawBody}`)
 *   timingSafeEqual(expected, xSignature)  &&  abs(now - xTimestamp) <= 300
 * El `rawBody` DEBE ser los bytes exactos recibidos (no re-serializar el JSON).
 */
import { createHmac, timingSafeEqual } from "crypto";

/** Ventana anti-replay por defecto (segundos): rechazar firmas más viejas que esto. */
export const REPLAY_WINDOW_SEC = 300;

/** Backoff de reintentos (ms) por número de reintento ya realizado (0-indexed). */
export const RETRY_BACKOFF_MS = [60_000, 240_000, 900_000];

/**
 * Cuerpo canónico determinístico: JSON con claves ORDENADas recursivamente y
 * separadores compactos. Garantiza que emisor y receptor firmen exactamente los
 * mismos bytes con independencia del orden de inserción de las claves.
 */
export function canonicalBody(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortDeep(obj[key]);
    return out;
  }
  return value;
}

/** Firma HMAC-SHA256 hex de `${timestamp}.${body}` con el secreto del destino. */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Valor del header X-Signature: `sha256=<hexhmac>`. */
export function signatureHeader(secret: string, timestamp: number, body: string): string {
  return `sha256=${signPayload(secret, timestamp, body)}`;
}

/**
 * Verifica una firma de webhook en TIEMPO CONSTANTE + ventana anti-replay.
 * Fail-closed: cualquier formato inválido o desfase de reloj → false (nunca lanza).
 * `nowSec` inyectable para tests; por defecto el reloj real.
 */
export function verifySignature(opts: {
  secret: string;
  timestamp: number;
  body: string;
  signature: string; // valor recibido del header X-Signature ("sha256=..." o hex pelado)
  windowSec?: number;
  nowSec?: number;
}): boolean {
  try {
    const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
    const window = opts.windowSec ?? REPLAY_WINDOW_SEC;
    if (!Number.isFinite(opts.timestamp)) return false;
    if (Math.abs(now - opts.timestamp) > window) return false; // replay / reloj
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
 * ¿El destino (suscrito a `subscribed`) recibe el evento `event`?
 * '*' = comodín (todos). Lista vacía = no recibe nada (fail-closed por defecto).
 */
export function eventMatches(subscribed: readonly string[], event: string): boolean {
  return subscribed.includes("*") || subscribed.includes(event);
}

/**
 * Backoff (ms) para programar el PRÓXIMO reintento, dado cuántos intentos ya se
 * hicieron (attempts: 1 = falló el 1er intento → esperar RETRY_BACKOFF_MS[0]).
 * Devuelve null si ya se agotaron los reintentos (no se reprograma).
 */
export function backoffMs(attempts: number, schedule: readonly number[] = RETRY_BACKOFF_MS): number | null {
  const idx = attempts - 1;
  if (idx < 0 || idx >= schedule.length) return null;
  return schedule[idx];
}
