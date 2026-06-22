import { pool } from '../pool'
import type { Executor } from '../executor'
import { iso } from './mapping'

export interface DocumentTypeDef {
  key: string
  label: string
  country: string
  mrzFormat: 'td1' | 'td3' | null
  enabled: boolean
  scopeType: 'system' | 'tenant'
  scopeId: string | null
  createdAt: string
  updatedAt: string
}

interface DocTypeRow {
  key: string; label: string; country: string
  mrz_format: 'td1' | 'td3' | null; enabled: boolean
  scope_type: 'system' | 'tenant'; scope_id: string | null
  created_at: Date; updated_at: Date
}

function mapRow(row: DocTypeRow): DocumentTypeDef {
  return {
    key: row.key, label: row.label, country: row.country,
    mrzFormat: row.mrz_format, enabled: row.enabled,
    scopeType: row.scope_type, scopeId: row.scope_id,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  }
}

export async function listDocumentTypes(exec: Executor = pool): Promise<DocumentTypeDef[]> {
  const res = await exec.query<DocTypeRow>(`SELECT * FROM document_types ORDER BY key`)
  return res.rows.map(mapRow)
}

export async function getDocumentType(key: string, exec: Executor = pool): Promise<DocumentTypeDef | null> {
  const res = await exec.query<DocTypeRow>(`SELECT * FROM document_types WHERE key = $1`, [key])
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

export async function upsertDocumentType(
  data: Omit<DocumentTypeDef, 'createdAt' | 'updatedAt'>,
  exec: Executor = pool
): Promise<DocumentTypeDef> {
  const res = await exec.query<DocTypeRow>(
    `INSERT INTO document_types (key, label, country, mrz_format, enabled, scope_type, scope_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (key) DO UPDATE SET
       label=EXCLUDED.label, country=EXCLUDED.country, mrz_format=EXCLUDED.mrz_format,
       enabled=EXCLUDED.enabled, scope_type=EXCLUDED.scope_type,
       scope_id=EXCLUDED.scope_id, updated_at=now()
     RETURNING *`,
    [data.key, data.label, data.country, data.mrzFormat, data.enabled, data.scopeType, data.scopeId]
  )
  return mapRow(res.rows[0])
}

export async function deleteDocumentType(key: string, exec: Executor = pool): Promise<boolean> {
  const res = await exec.query(`DELETE FROM document_types WHERE key = $1`, [key])
  return (res.rowCount ?? 0) > 0
}
