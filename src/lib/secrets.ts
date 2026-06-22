/**
 * Cifrado simétrico de secretos de providers por tenant (Fase 2).
 * AES-256-GCM usando el módulo nativo node:crypto.
 *
 * Master key: TEKO_SECRETS_KEY (64 hex chars = 32 bytes).
 * Blob format: "gcm$<ivHex>$<authTagHex>$<cipherHex>"
 *
 * Reglas de seguridad:
 *   - encryptSecret lanza si la key falta → escritura falla cerrada (mejor que guardar en plano).
 *   - decryptSecret devuelve null en cualquier fallo → lectura falla cerrada (usa proveedor global).
 *   - NUNCA se loguea el texto descifrado ni la key.
 *   - encryptConfig cifra el objeto entero; decryptConfig lo reconstruye.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12  // 96-bit IV recomendado para GCM
const TAG_LEN = 16

/** Carga la master key desde env. Devuelve null si falta o si tiene formato inválido. */
export function loadSecretsKey(): Buffer | null {
  const hex = process.env.TEKO_SECRETS_KEY
  if (!hex || hex.length !== 64) return null
  try {
    const buf = Buffer.from(hex, 'hex')
    if (buf.length !== 32) return null
    return buf
  } catch {
    return null
  }
}

/**
 * Cifra `plain` con AES-256-GCM.
 * Lanza (no devuelve) si TEKO_SECRETS_KEY no está configurada — el llamador
 * no debe persistir config de provider si no hay key.
 */
export function encryptSecret(plain: string): string {
  const key = loadSecretsKey()
  if (!key) throw new Error('[secrets] TEKO_SECRETS_KEY no configurada: no se puede cifrar')
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `gcm$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`
}

/**
 * Descifra un blob "gcm$<iv>$<tag>$<cipher>".
 * Fail-closed: devuelve null en cualquier error (key ausente, formato inválido, GCM fail).
 * NUNCA lanza. NUNCA loguea el resultado descifrado.
 */
export function decryptSecret(blob: string): string | null {
  try {
    const key = loadSecretsKey()
    if (!key) return null
    const parts = blob.split('$')
    if (parts.length !== 4 || parts[0] !== 'gcm') return null
    const [, ivHex, tagHex, cipherHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const cipherBuf = Buffer.from(cipherHex, 'hex')
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return null
    const decipher = createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(cipherBuf), decipher.final()])
    return plain.toString('utf8')
  } catch {
    return null
  }
}

/**
 * Serializa `config` a JSON y lo cifra.
 * Devuelve `{ enc: "<blob>" }` listo para persistir como JSONB.
 * Lanza si TEKO_SECRETS_KEY no está configurada.
 */
export function encryptConfig(config: Record<string, unknown>): { enc: string } {
  return { enc: encryptSecret(JSON.stringify(config)) }
}

/**
 * Desenvuelve `{ enc: blob }` → JSON.parse → T.
 * Fail-closed: devuelve null si el wrapper no tiene `enc`, decrypt falla, o JSON.parse falla.
 */
export function decryptConfig<T>(wrapped: { enc?: string } | Record<string, unknown>): T | null {
  try {
    const blob = (wrapped as { enc?: string }).enc
    if (typeof blob !== 'string') return null
    const plain = decryptSecret(blob)
    if (plain === null) return null
    return JSON.parse(plain) as T
  } catch {
    return null
  }
}
