import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mockear secrets para tests sin TEKO_SECRETS_KEY real
vi.mock('../../lib/secrets', () => ({
  encryptConfig: (cfg: Record<string, unknown>) => ({ enc: 'gcm$fake$fake$' + JSON.stringify(cfg) }),
  decryptConfig: <T>(wrapped: { enc?: string }): T | null => {
    if (!wrapped.enc) return null
    const suffix = wrapped.enc.slice('gcm$fake$fake$'.length)
    try { return JSON.parse(suffix) as T } catch { return null }
  },
}))

import * as repo from './tenantIntegrations'
import type { Executor } from '../executor'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

function mockExec(rows: Record<string, unknown>[]): Executor {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  } as unknown as Executor
}

describe('tenantIntegrations repo', () => {
  it('upsert encrypts config and returns TenantIntegration', async () => {
    const row = {
      id: 'aaa', tenant_id: TENANT_ID, kind: 'smtp',
      config: { enc: 'gcm$fake$fake${"host":"smtp.x.com","password":"pw"}' },
      enabled: true, updated_by: 'admin:1',
      created_at: new Date(), updated_at: new Date(),
    }
    const exec = mockExec([row])
    const result = await repo.upsert(TENANT_ID, 'smtp', { host: 'smtp.x.com', password: 'pw' }, true, 'admin:1', exec)
    expect(result.tenantId).toBe(TENANT_ID)
    expect(result.kind).toBe('smtp')
    expect(result.enabled).toBe(true)
    expect(result.config).toEqual({ host: 'smtp.x.com', password: 'pw' })
  })

  it('getByKind returns null when no row', async () => {
    const exec = mockExec([])
    const result = await repo.getByKind(TENANT_ID, 'smtp', exec)
    expect(result).toBeNull()
  })

  it('getByKind decrypts config', async () => {
    const row = {
      id: 'bbb', tenant_id: TENANT_ID, kind: 'smtp',
      config: { enc: 'gcm$fake$fake${"host":"smtp.y.com"}' },
      enabled: true, updated_by: 'admin:1',
      created_at: new Date(), updated_at: new Date(),
    }
    const exec = mockExec([row])
    const result = await repo.getByKind(TENANT_ID, 'smtp', exec)
    expect(result).not.toBeNull()
    expect(result!.config).toEqual({ host: 'smtp.y.com' })
  })

  it('getByKind returns enabled=false and empty config if decrypt fails', async () => {
    const row = {
      id: 'ccc', tenant_id: TENANT_ID, kind: 'smtp',
      config: { enc: 'INVALID' }, // will cause decryptConfig to return null
      enabled: true, updated_by: 'system',
      created_at: new Date(), updated_at: new Date(),
    }
    const exec = mockExec([row])
    const result = await repo.getByKind(TENANT_ID, 'smtp', exec)
    expect(result).not.toBeNull()
    expect(result!.enabled).toBe(false)
    expect(result!.config).toEqual({})
  })

  it('listByTenant returns all rows decrypted', async () => {
    const rows = [
      { id: 'd1', tenant_id: TENANT_ID, kind: 'smtp', config: { enc: 'gcm$fake$fake${"host":"a"}' }, enabled: true, updated_by: 's', created_at: new Date(), updated_at: new Date() },
      { id: 'd2', tenant_id: TENANT_ID, kind: 'aml', config: { enc: 'gcm$fake$fake${"apiKey":"k"}' }, enabled: false, updated_by: 's', created_at: new Date(), updated_at: new Date() },
    ]
    const exec = mockExec(rows)
    const result = await repo.listByTenant(TENANT_ID, exec)
    expect(result.length).toBe(2)
    expect(result[0].kind).toBe('smtp')
    expect(result[1].kind).toBe('aml')
  })

  it('remove returns true when rowCount > 0', async () => {
    const exec = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } as unknown as Executor
    expect(await repo.remove(TENANT_ID, 'smtp', exec)).toBe(true)
  })

  it('remove returns false when row not found', async () => {
    const exec = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as unknown as Executor
    expect(await repo.remove(TENANT_ID, 'smtp', exec)).toBe(false)
  })
})
