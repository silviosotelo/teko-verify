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
    // Config debe estar DESCIFRADO al original, no el wrapper enc
    expect(result[0].config).toEqual({ host: 'a' })
    expect(result[1].config).toEqual({ apiKey: 'k' })
  })

  it('listByTenant fail-closed: fila con enc inválido devuelve enabled=false y config={}', async () => {
    const rows = [
      { id: 'e1', tenant_id: TENANT_ID, kind: 'smtp', config: { enc: 'INVALID' }, enabled: true, updated_by: 's', created_at: new Date(), updated_at: new Date() },
      { id: 'e2', tenant_id: TENANT_ID, kind: 'aml', config: { enc: 'gcm$fake$fake${"apiKey":"k"}' }, enabled: true, updated_by: 's', created_at: new Date(), updated_at: new Date() },
    ]
    const exec = mockExec(rows)
    const result = await repo.listByTenant(TENANT_ID, exec)
    expect(result.length).toBe(2)
    // Fila con decrypt fallido → fail-closed
    expect(result[0].enabled).toBe(false)
    expect(result[0].config).toEqual({})
    // Fila válida no afectada
    expect(result[1].enabled).toBe(true)
    expect(result[1].config).toEqual({ apiKey: 'k' })
  })

  it('upsert — ciphertext invariant: SQL recibe el wrapper cifrado, NO el config plano', async () => {
    const plainConfig = { pass: 'super-secret' }
    const row = {
      id: 'sec1', tenant_id: TENANT_ID, kind: 'smtp',
      config: { enc: 'gcm$fake$fake${"pass":"super-secret"}' },
      enabled: true, updated_by: 'admin:1',
      created_at: new Date(), updated_at: new Date(),
    }
    const exec = mockExec([row])
    await repo.upsert(TENANT_ID, 'smtp', plainConfig, true, 'admin:1', exec)

    const queryFn = exec.query as ReturnType<typeof vi.fn>
    // exec.query(sql, params) — params es el segundo argumento
    const sqlParams = queryFn.mock.calls[0][1] as unknown[]
    const configArg = sqlParams[2] as string // $3 en el SQL = encryptedConfig stringificado

    // POSITIVO: el arg contiene el prefijo gcm$ → prueba que pasó por encryptConfig
    expect(configArg).toContain('gcm$')
    // POSITIVO: al parsear tiene la propiedad 'enc' (formato del wrapper cifrado)
    expect(JSON.parse(configArg)).toHaveProperty('enc')
    // NEGATIVO: NO es el config plano serializado directamente
    expect(configArg).not.toBe(JSON.stringify(plainConfig))
  })

  it('remove returns true when rowCount > 0', async () => {
    const exec = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } as unknown as Executor
    expect(await repo.remove(TENANT_ID, 'smtp', exec)).toBe(true)
  })

  it('remove returns false when row not found', async () => {
    const exec = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as unknown as Executor
    expect(await repo.remove(TENANT_ID, 'smtp', exec)).toBe(false)
  })

  it('storage kind round-trip: upsert and getByKind decrypt correctly (no secrets, but consistent encryption)', async () => {
    // storage kind stores a baseDir path (not a secret, but encrypted for uniformity in Fase 2)
    const storageConfig = { baseDir: '/var/data/tenant-123' }
    const row = {
      id: 'storage1', tenant_id: TENANT_ID, kind: 'storage',
      config: { enc: 'gcm$fake$fake${"baseDir":"/var/data/tenant-123"}' },
      enabled: true, updated_by: 'admin:1',
      created_at: new Date(), updated_at: new Date(),
    }

    // Step 1: upsert encrypts the config
    const execUpsert = mockExec([row])
    const upsertResult = await repo.upsert(TENANT_ID, 'storage', storageConfig, true, 'admin:1', execUpsert)
    expect(upsertResult.kind).toBe('storage')
    expect(upsertResult.enabled).toBe(true)
    expect(upsertResult.config).toEqual(storageConfig)

    // Step 2: getByKind decrypts and returns the same config
    const execGet = mockExec([row])
    const getResult = await repo.getByKind(TENANT_ID, 'storage', execGet)
    expect(getResult).not.toBeNull()
    expect(getResult!.kind).toBe('storage')
    expect(getResult!.config).toEqual(storageConfig)
    expect(getResult!.config).toEqual({ baseDir: '/var/data/tenant-123' })
  })
})
