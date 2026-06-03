/**
 * Primitivas de seguridad de Teko Verify (§8 Seguridad).
 *   - API keys: secreto plano = prefix.random; se persiste sólo sha256 (nunca plano).
 *   - link_token: inadivinable (base64url de 32 bytes), un solo uso/expirable (el TTL
 *     y el consumo los maneja la lógica de sesión).
 *   - Webhook HMAC: firma SHA-256 del cuerpo con el secreto del tenant (anti-replay
 *     vía timestamp en el payload).
 */
import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

const API_KEY_PREFIX = process.env.TEKO_API_KEY_PREFIX || "tk_live_";

export interface GeneratedApiKey {
  /** Secreto en plano — se devuelve UNA sola vez al tenant. */
  plain: string;
  /** sha256 del plano — lo único que se persiste. */
  hash: string;
  /** Prefijo público mostrable para identificar la key sin revelarla. */
  prefix: string;
}

/** Genera una API key: `tk_live_<id8>_<rand>`; persiste sólo el hash. */
export function generateApiKey(): GeneratedApiKey {
  const id = randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const plain = `${API_KEY_PREFIX}${id}_${secret}`;
  return { plain, hash: sha256(plain), prefix: `${API_KEY_PREFIX}${id}` };
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Token de link de captura: inadivinable, url-safe. */
export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Firma HMAC-SHA256 hex del cuerpo del webhook con el secreto del tenant. */
export function signWebhook(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Comparación en tiempo constante (auth de tokens/firmas). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Secreto HMAC por tenant (§8): firma de webhooks. 256 bits, hex.
// ---------------------------------------------------------------------------

/** Genera un secreto de webhook por tenant (32 bytes aleatorios → hex). */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Password hashing de operadores admin (§8.C): scrypt + salt + verificación en
// tiempo constante. Formato persistido: "scrypt$<saltHex>$<hashHex>".
// NUNCA se persiste la contraseña en plano.
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

/** Hashea una contraseña con scrypt + salt aleatorio. Devuelve "scrypt$salt$hash". */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/**
 * Verifica una contraseña contra un hash "scrypt$salt$hash" en TIEMPO CONSTANTE.
 * Fail-closed: cualquier formato inválido o error → false (nunca lanza/autentica).
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const [, salt, expectedHex] = parts;
    const expected = Buffer.from(expectedHex, "hex");
    if (expected.length !== SCRYPT_KEYLEN) return false;
    const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Token de sesión de operador admin: inadivinable, url-safe (256 bits). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
