import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encryptSecret, decryptSecret, encryptConfig, decryptConfig, loadSecretsKey } from './secrets'

// 32-byte key encoded as 64 hex chars
const TEST_KEY = 'a'.repeat(64)

describe('secrets', () => {
  const orig = process.env.TEKO_SECRETS_KEY

  beforeEach(() => {
    process.env.TEKO_SECRETS_KEY = TEST_KEY
  })

  afterEach(() => {
    if (orig === undefined) delete process.env.TEKO_SECRETS_KEY
    else process.env.TEKO_SECRETS_KEY = orig
  })

  it('loadSecretsKey returns 32-byte Buffer when key is set', () => {
    const key = loadSecretsKey()
    expect(key).not.toBeNull()
    expect(key!.length).toBe(32)
  })

  it('loadSecretsKey returns null when key is missing', () => {
    delete process.env.TEKO_SECRETS_KEY
    expect(loadSecretsKey()).toBeNull()
  })

  it('encryptSecret produces gcm$ blob', () => {
    const blob = encryptSecret('hello')
    expect(blob.startsWith('gcm$')).toBe(true)
    const parts = blob.split('$')
    expect(parts.length).toBe(4)
  })

  it('decrypt(encrypt(x)) === x', () => {
    const plain = 'supersecret-password-123'
    const blob = encryptSecret(plain)
    expect(decryptSecret(blob)).toBe(plain)
  })

  it('each encrypt produces different iv (non-deterministic)', () => {
    const a = encryptSecret('same')
    const b = encryptSecret('same')
    expect(a).not.toBe(b)
  })

  it('decryptSecret returns null for garbage input', () => {
    expect(decryptSecret('not-a-blob')).toBeNull()
    expect(decryptSecret('gcm$bad$bad$bad')).toBeNull()
  })

  it('decryptSecret returns null if key is wrong', () => {
    const blob = encryptSecret('secret')
    process.env.TEKO_SECRETS_KEY = 'b'.repeat(64)
    expect(decryptSecret(blob)).toBeNull()
  })

  it('decryptSecret returns null if key is missing', () => {
    const blob = encryptSecret('secret')
    delete process.env.TEKO_SECRETS_KEY
    expect(decryptSecret(blob)).toBeNull()
  })

  it('encryptSecret throws if key is missing', () => {
    delete process.env.TEKO_SECRETS_KEY
    expect(() => encryptSecret('x')).toThrow()
  })

  it('encryptConfig / decryptConfig round-trip', () => {
    const cfg = { host: 'smtp.example.com', password: 'pass123', port: 587 }
    const wrapped = encryptConfig(cfg)
    expect(typeof wrapped.enc).toBe('string')
    const out = decryptConfig<typeof cfg>(wrapped)
    expect(out).toEqual(cfg)
  })

  it('decryptConfig returns null on invalid wrapped', () => {
    expect(decryptConfig({ enc: 'garbage' })).toBeNull()
    expect(decryptConfig({ other: 'key' })).toBeNull()
  })
})
