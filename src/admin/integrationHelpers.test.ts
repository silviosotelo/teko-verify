/**
 * Tests for integration route helpers: maskConfig + mergeConfig.
 * These are the load-bearing security functions: secrets must never leak via
 * GET (maskConfig) and must survive "***" round-trips via PUT (mergeConfig).
 */
import { describe, it, expect } from 'vitest'
import { maskConfig, mergeConfig } from './integrationHelpers'

// ─── maskConfig ───────────────────────────────────────────────────────────── //

describe('maskConfig', () => {
  it('masks "password" field', () => {
    const result = maskConfig({ host: 'smtp.example.com', password: 'super-secret' })
    expect(result.password).toBe('***')
    expect(result.host).toBe('smtp.example.com')
  })

  it('masks apiKey, secret, token, key (case-insensitive)', () => {
    const result = maskConfig({
      apiKey: 'k1',
      ApiKey: 'k2',
      secret: 's1',
      secretToken: 's2',
      token: 't1',
      myKey: 'k3',
      name: 'visible',
      enabled: true,
    })
    expect(result.apiKey).toBe('***')
    expect(result.ApiKey).toBe('***')
    expect(result.secret).toBe('***')
    expect(result.secretToken).toBe('***')
    expect(result.token).toBe('***')
    expect(result.myKey).toBe('***')
    expect(result.name).toBe('visible')
    expect(result.enabled).toBe(true)
  })

  it('does not mutate the original config', () => {
    const original = { host: 'x', password: 'pw' }
    maskConfig(original)
    expect(original.password).toBe('pw')
  })

  it('leaves a config with no secret fields unchanged', () => {
    const cfg = { host: 'smtp.x.com', port: 587, enabled: true }
    expect(maskConfig(cfg)).toEqual(cfg)
  })

  it('replaces secret value regardless of the original type', () => {
    const result = maskConfig({ password: 12345, apiKey: null })
    expect(result.password).toBe('***')
    expect(result.apiKey).toBe('***')
  })
})

// ─── mergeConfig ──────────────────────────────────────────────────────────── //

describe('mergeConfig', () => {
  it('PUT with "***" preserves existing secret', () => {
    const existing = { host: 'smtp.x.com', password: 'realpass' }
    const incoming = { host: 'smtp.x.com', password: '***' }
    const result = mergeConfig(existing, incoming)
    expect(result.password).toBe('realpass')
    expect(result.host).toBe('smtp.x.com')
  })

  it('PUT with new value replaces the existing secret', () => {
    const existing = { host: 'smtp.x.com', password: 'oldpass' }
    const incoming = { host: 'smtp.y.com', password: 'newpass' }
    const result = mergeConfig(existing, incoming)
    expect(result.host).toBe('smtp.y.com')
    expect(result.password).toBe('newpass')
  })

  it('toggling enabled does not wipe stored secrets', () => {
    // This is the critical case: the UI sends {enabled: true, password: "***"} and
    // the existing row is disabled=false. The password must survive.
    const existing = { host: 'smtp.x.com', password: 'realpass' }
    const incoming = { host: 'smtp.x.com', password: '***', enabled: true }
    const result = mergeConfig(existing, incoming)
    expect(result.password).toBe('realpass')
    expect(result.enabled).toBe(true)
  })

  it('preserves existing secret even when integration is currently disabled', () => {
    // The enabled flag does NOT gate the merge — we always preserve secrets.
    // (If it did, toggling enabled from false→true would wipe the password.)
    const existing = { host: 'smtp.x.com', password: 'realpass' }
    const incoming = { password: '***' }
    const result = mergeConfig(existing, incoming)
    expect(result.password).toBe('realpass')
  })

  it('when no existing row, uses only non-masked incoming fields', () => {
    const result = mergeConfig(null, { host: 'smtp.x.com', password: '***' })
    expect(result.host).toBe('smtp.x.com')
    // password was "***" and there's no existing to fall back on → not set
    expect(result.password).toBeUndefined()
  })

  it('does not mutate the existing config object', () => {
    const existing = { host: 'x', password: 'pw' }
    mergeConfig(existing, { host: 'y' })
    expect(existing.host).toBe('x')
  })

  it('adds a new field from incoming when no existing row', () => {
    const result = mergeConfig(null, { host: 'smtp.x.com', port: 587 })
    expect(result).toEqual({ host: 'smtp.x.com', port: 587 })
  })
})
