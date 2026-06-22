import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Executor } from '../db/executor'

// Mock del repo
vi.mock('../db/repos/tenantIntegrations', () => ({
  getByKind: vi.fn(),
}))
import * as tiRepo from '../db/repos/tenantIntegrations'
const mockGetByKind = vi.mocked(tiRepo.getByKind)

// Mock del mailer
vi.mock('./mailer', () => ({
  loadSmtpConfig: vi.fn(),
}))
import { loadSmtpConfig } from './mailer'
const mockLoadSmtp = vi.mocked(loadSmtpConfig)

// Mock del amlProvider
vi.mock('../modules/amlProvider', () => ({
  resolveAmlProvider: vi.fn(),
  HttpAmlProvider: class { screen = vi.fn() },
}))
import { resolveAmlProvider } from '../modules/amlProvider'
const mockResolveAml = vi.mocked(resolveAmlProvider)

import { resolveSmtpConfig, resolveEvidenceDir, resolveAmlConfig } from './providerResolver'

const TENANT_ID = '22222222-2222-2222-2222-222222222222'
const GLOBAL_SMTP = { host: 'global.smtp', port: 587, secure: false, user: 'u', password: 'p', fromEmail: 'from@g.com', fromName: 'Global' }

const mockExec = {} as Executor

describe('resolveSmtpConfig', () => {
  it('returns tenant config when row exists and enabled', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '1', tenantId: TENANT_ID, kind: 'smtp', enabled: true,
      config: { host: 'tenant.smtp', port: 465, secure: true, user: 'tu', password: 'tp', fromEmail: 'from@t.com', fromName: 'Tenant' },
      updatedBy: 'admin', createdAt: '', updatedAt: '',
    })
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg?.host).toBe('tenant.smtp')
  })

  it('falls back to global when no tenant row', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    mockLoadSmtp.mockReturnValueOnce(GLOBAL_SMTP)
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg?.host).toBe('global.smtp')
  })

  it('falls back to global when tenant row disabled', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '2', tenantId: TENANT_ID, kind: 'smtp', enabled: false,
      config: {}, updatedBy: 'admin', createdAt: '', updatedAt: '',
    })
    mockLoadSmtp.mockReturnValueOnce(GLOBAL_SMTP)
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg?.host).toBe('global.smtp')
  })

  it('falls back to global when tenant config missing required fields', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '3', tenantId: TENANT_ID, kind: 'smtp', enabled: true,
      config: { host: 'x' }, // falta user y password
      updatedBy: 'admin', createdAt: '', updatedAt: '',
    })
    mockLoadSmtp.mockReturnValueOnce(GLOBAL_SMTP)
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg?.host).toBe('global.smtp')
  })

  it('returns null when both tenant and global unconfigured', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    mockLoadSmtp.mockReturnValueOnce(null)
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg).toBeNull()
  })
})

describe('resolveEvidenceDir', () => {
  it('returns tenant baseDir when configured', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '4', tenantId: TENANT_ID, kind: 'storage', enabled: true,
      config: { baseDir: '/mnt/nas/tenant1' }, updatedBy: 's', createdAt: '', updatedAt: '',
    })
    const dir = await resolveEvidenceDir(TENANT_ID, mockExec)
    expect(dir).toBe('/mnt/nas/tenant1')
  })

  it('falls back to TEKO_EVIDENCE_DIR env', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    const orig = process.env.TEKO_EVIDENCE_DIR
    process.env.TEKO_EVIDENCE_DIR = '/data/override'
    const dir = await resolveEvidenceDir(TENANT_ID, mockExec)
    expect(dir).toBe('/data/override')
    if (orig === undefined) delete process.env.TEKO_EVIDENCE_DIR
    else process.env.TEKO_EVIDENCE_DIR = orig
  })

  it('falls back to hardcoded default', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    delete process.env.TEKO_EVIDENCE_DIR
    const dir = await resolveEvidenceDir(TENANT_ID, mockExec)
    expect(dir).toBe('/data/teko/evidence')
  })
})

describe('resolveAmlConfig', () => {
  it('returns tenant AML config when row exists', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '5', tenantId: TENANT_ID, kind: 'aml', enabled: true,
      config: { baseUrl: 'https://aml.api', apiKey: 'key123', providerName: 'sumsub' },
      updatedBy: 'admin', createdAt: '', updatedAt: '',
    })
    const result = await resolveAmlConfig(TENANT_ID, mockExec)
    expect(result?.config.baseUrl).toBe('https://aml.api')
    expect(result?.config.providerName).toBe('sumsub')
  })

  it('falls back to global resolveAmlProvider()', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    const globalResult = {
      provider: { screen: vi.fn() },
      mode: 'external' as const,
      config: { baseUrl: 'https://global.aml', apiKey: 'gk', providerName: 'global', threshold: 0.8, timeout: 15000 },
    }
    mockResolveAml.mockReturnValueOnce(globalResult)
    const result = await resolveAmlConfig(TENANT_ID, mockExec)
    expect(result?.config.baseUrl).toBe('https://global.aml')
  })

  it('returns null when no AML configured anywhere', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    mockResolveAml.mockReturnValueOnce(null)
    expect(await resolveAmlConfig(TENANT_ID, mockExec)).toBeNull()
  })
})
