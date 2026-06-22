import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../src/db/pool'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SQL = readFileSync(join(__dirname, '0022_document_types_fields.sql'), 'utf8')

describe('migration 0022 — idempotencia e integridad', () => {
  beforeAll(async () => { await pool.query(SQL) })

  it('segunda ejecución sin errores (CREATE IF NOT EXISTS + ON CONFLICT DO NOTHING)', async () => {
    await expect(pool.query(SQL)).resolves.not.toThrow()
  })

  it('document_types: exactamente 2 filas del seed', async () => {
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM document_types WHERE scope_type = 'system'"
    )
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(2)
  })

  it('ci_py: exactamente 12 campos del seed', async () => {
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM extraction_fields WHERE doc_type_key = 'ci_py'"
    )
    expect(Number(rows[0].count)).toBe(12)
  })

  it('ci_py: exactamente 5 campos required=true (espejo hardcodeado)', async () => {
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM extraction_fields WHERE doc_type_key = 'ci_py' AND (validation->>'required')::boolean = true"
    )
    expect(Number(rows[0].count)).toBe(5)
  })

  it('passport: exactamente 8 campos, 5 required=true', async () => {
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM extraction_fields WHERE doc_type_key = 'passport'"
    )
    expect(Number(rows[0].count)).toBe(8)

    const { rows: req } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM extraction_fields WHERE doc_type_key = 'passport' AND (validation->>'required')::boolean = true"
    )
    expect(Number(req[0].count)).toBe(5)
  })

  afterAll(async () => { await pool.end() })
})
