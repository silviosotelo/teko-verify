import { pool } from '../pool'
import type { Executor } from '../executor'
import { iso } from './mapping'

export interface FieldValidationRules {
  required?: boolean
  regex?: string
  normalize?: 'uppercase' | 'trim'
  dateRange?: { minIso?: string; maxIso?: string }
}

export interface FieldDefinition {
  id: string; docTypeKey: string; key: string; label: string
  type: 'string' | 'date' | 'boolean' | 'number'
  path: string; validation: FieldValidationRules
  displayOrder: number; createdAt: string
}

interface FieldRow {
  id: string; doc_type_key: string; key: string; label: string
  type: 'string' | 'date' | 'boolean' | 'number'
  path: string; validation: FieldValidationRules
  display_order: number; created_at: Date
}

function mapRow(row: FieldRow): FieldDefinition {
  return {
    id: row.id, docTypeKey: row.doc_type_key, key: row.key, label: row.label,
    type: row.type, path: row.path, validation: row.validation ?? {},
    displayOrder: row.display_order, createdAt: iso(row.created_at),
  }
}

export async function listFieldsForDocType(docTypeKey: string, exec: Executor = pool): Promise<FieldDefinition[]> {
  const res = await exec.query<FieldRow>(
    `SELECT * FROM extraction_fields WHERE doc_type_key = $1 ORDER BY display_order, key`,
    [docTypeKey]
  )
  return res.rows.map(mapRow)
}

export async function getField(id: string, exec: Executor = pool): Promise<FieldDefinition | null> {
  const res = await exec.query<FieldRow>(`SELECT * FROM extraction_fields WHERE id = $1`, [id])
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

export async function createField(
  data: Omit<FieldDefinition, 'id' | 'createdAt'>,
  exec: Executor = pool
): Promise<FieldDefinition> {
  const res = await exec.query<FieldRow>(
    `INSERT INTO extraction_fields (doc_type_key,key,label,type,path,validation,display_order)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
    [data.docTypeKey, data.key, data.label, data.type, data.path,
     JSON.stringify(data.validation), data.displayOrder]
  )
  return mapRow(res.rows[0])
}

export async function updateField(
  id: string,
  patch: Partial<Pick<FieldDefinition, 'label' | 'type' | 'path' | 'validation' | 'displayOrder'>>,
  exec: Executor = pool
): Promise<FieldDefinition | null> {
  const sets: string[] = []
  const params: unknown[] = [id]
  let i = 2
  if (patch.label !== undefined)        { sets.push(`label=$${i++}`);                params.push(patch.label) }
  if (patch.type !== undefined)         { sets.push(`type=$${i++}`);                 params.push(patch.type) }
  if (patch.path !== undefined)         { sets.push(`path=$${i++}`);                 params.push(patch.path) }
  if (patch.validation !== undefined)   { sets.push(`validation=$${i++}::jsonb`);    params.push(JSON.stringify(patch.validation)) }
  if (patch.displayOrder !== undefined) { sets.push(`display_order=$${i++}`);        params.push(patch.displayOrder) }
  if (sets.length === 0) return getField(id, exec)
  const res = await exec.query<FieldRow>(
    `UPDATE extraction_fields SET ${sets.join(',')} WHERE id=$1 RETURNING *`, params
  )
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

export async function deleteField(id: string, exec: Executor = pool): Promise<boolean> {
  const res = await exec.query(`DELETE FROM extraction_fields WHERE id=$1`, [id])
  return (res.rowCount ?? 0) > 0
}
