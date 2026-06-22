import { describe, it, expect } from 'vitest'
import type { Executor } from '../executor'
import * as documentTypes from './documentTypes'

const NOW = new Date('2026-06-22T00:00:00Z')

function mockDocTypeRow(key: string, overrides: Partial<{
  label: string; country: string; mrz_format: 'td1' | 'td3' | null
  enabled: boolean; scope_type: 'system' | 'tenant'; scope_id: string | null
}> = {}) {
  return {
    key,
    label: overrides.label ?? key.toUpperCase(),
    country: overrides.country ?? 'PY',
    mrz_format: overrides.mrz_format !== undefined ? overrides.mrz_format : null,
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    scope_type: overrides.scope_type ?? 'system',
    scope_id: overrides.scope_id !== undefined ? overrides.scope_id : null,
    created_at: NOW,
    updated_at: NOW,
  }
}

function mockExec(
  handlers: Array<{ match: RegExp; rows: unknown[]; rowCount?: number }>
): Executor {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string): Promise<any> {
      const norm = text.replace(/\s+/g, ' ').trim()
      for (const h of handlers) {
        if (h.match.test(norm)) return { rows: h.rows, rowCount: h.rowCount ?? h.rows.length }
      }
      return { rows: [], rowCount: 0 }
    },
  }
}

describe('documentTypes.listDocumentTypes', () => {
  it('mapea snake→camel y devuelve todas las filas', async () => {
    const exec = mockExec([{
      match: /SELECT \* FROM document_types ORDER BY key/i,
      rows: [
        mockDocTypeRow('ci_py',    { mrz_format: 'td1', enabled: true,  scope_type: 'system' }),
        mockDocTypeRow('passport', { mrz_format: 'td3', enabled: true,  scope_type: 'system' }),
      ],
    }])
    const all = await documentTypes.listDocumentTypes(exec)
    expect(all).toHaveLength(2)
    expect(all.map(d => d.key)).toContain('ci_py')
    expect(all.map(d => d.key)).toContain('passport')
  })

  it('devuelve lista vacía cuando no hay filas', async () => {
    const exec = mockExec([{ match: /SELECT \* FROM document_types/i, rows: [] }])
    expect(await documentTypes.listDocumentTypes(exec)).toHaveLength(0)
  })
})

describe('documentTypes.getDocumentType', () => {
  it('ci_py → mrzFormat td1, enabled true, scopeType system', async () => {
    const exec = mockExec([{
      match: /SELECT \* FROM document_types WHERE key = \$1/i,
      rows: [mockDocTypeRow('ci_py', { mrz_format: 'td1', enabled: true, scope_type: 'system' })],
    }])
    const dt = await documentTypes.getDocumentType('ci_py', exec)
    expect(dt?.mrzFormat).toBe('td1')
    expect(dt?.enabled).toBe(true)
    expect(dt?.scopeType).toBe('system')
    expect(dt?.createdAt).toBe(NOW.toISOString())
  })

  it('inexistente → null', async () => {
    const exec = mockExec([{ match: /SELECT \* FROM document_types WHERE key = \$1/i, rows: [] }])
    expect(await documentTypes.getDocumentType('__no_existe__', exec)).toBeNull()
  })

  it('scopeId null se mapea correctamente', async () => {
    const exec = mockExec([{
      match: /SELECT \* FROM document_types WHERE key = \$1/i,
      rows: [mockDocTypeRow('passport', { scope_type: 'system', scope_id: null })],
    }])
    const dt = await documentTypes.getDocumentType('passport', exec)
    expect(dt?.scopeId).toBeNull()
  })
})

describe('documentTypes.upsertDocumentType', () => {
  it('devuelve el registro mapeado del RETURNING *', async () => {
    const returned = mockDocTypeRow('test_t2_fase4', {
      label: 'Test T2', country: 'AR', mrz_format: 'td3',
      enabled: true, scope_type: 'system', scope_id: null,
    })
    const exec = mockExec([{
      match: /INSERT INTO document_types/i,
      rows: [returned],
    }])
    const created = await documentTypes.upsertDocumentType(
      { key: 'test_t2_fase4', label: 'Test T2', country: 'AR',
        mrzFormat: 'td3', enabled: true, scopeType: 'system', scopeId: null },
      exec
    )
    expect(created.key).toBe('test_t2_fase4')
    expect(created.mrzFormat).toBe('td3')
    expect(created.country).toBe('AR')
  })

  it('update: label actualizado reflejado en respuesta', async () => {
    const returned = mockDocTypeRow('test_t2_fase4', { label: 'Test T2 Updated' })
    const exec = mockExec([{
      match: /INSERT INTO document_types/i,
      rows: [returned],
    }])
    const updated = await documentTypes.upsertDocumentType(
      { key: 'test_t2_fase4', label: 'Test T2 Updated', country: 'AR',
        mrzFormat: 'td3', enabled: true, scopeType: 'system', scopeId: null },
      exec
    )
    expect(updated.label).toBe('Test T2 Updated')
  })
})

describe('documentTypes.deleteDocumentType', () => {
  it('rowCount > 0 → true', async () => {
    const exec = mockExec([{
      match: /DELETE FROM document_types WHERE key = \$1/i,
      rows: [], rowCount: 1,
    }])
    expect(await documentTypes.deleteDocumentType('test_t2_fase4', exec)).toBe(true)
  })

  it('rowCount 0 → false', async () => {
    const exec = mockExec([{
      match: /DELETE FROM document_types WHERE key = \$1/i,
      rows: [], rowCount: 0,
    }])
    expect(await documentTypes.deleteDocumentType('__no_existe__', exec)).toBe(false)
  })
})
