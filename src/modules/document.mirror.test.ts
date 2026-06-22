// src/modules/document.mirror.test.ts
/**
 * Mirror integrity test: verifica que las constantes TS (REQUIRED_PATHS_*)
 * y el seed SQL de migrations/0022_document_types_fields.sql describen los
 * mismos campos requeridos (sin drift).
 *
 * DECISIÓN DE DISEÑO: el brief original usaba listFieldsForDocType() (DB live).
 * En este entorno no hay conexión a la DB de producción durante los tests CI.
 * En su lugar parseamos el archivo SQL de migración, que es la fuente canónica
 * del seed y está versionado en el repo. Si el SQL drift respecto a las
 * constantes TS, este test falla igual que si se conectara a la DB.
 *
 * Si en el futuro se quiere la variante live-DB, usar el bloque comentado al
 * final con listFieldsForDocType (requiere DATABASE_URL en el entorno de test).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { REQUIRED_PATHS_CI_PY, REQUIRED_PATHS_PASSPORT } from './document'

/**
 * Extrae los paths con required=true para un doc_type_key dado del SQL de seed.
 * Parsea líneas con el patrón (con espacios de alineación opcionales):
 *   ('ci_py','key',  'label',  'type',  'path',  '{"required":true}', order)
 */
function parseRequiredPathsFromSql(sql: string, docTypeKey: string): string[] {
  const paths: string[] = []
  // Matches INSERT lines for the given docTypeKey with required:true.
  // \s* handles the alignment whitespace between comma-separated values.
  const lineRe = new RegExp(
    `\\('${docTypeKey}',\\s*'[^']+',\\s*'[^']+',\\s*'[^']+',\\s*'([^']+)',\\s*'\\{"required":true\\}'`,
    'g'
  )
  let m: RegExpExecArray | null
  while ((m = lineRe.exec(sql)) !== null) {
    paths.push(m[1])
  }
  return paths.sort()
}

const sqlPath = join(process.cwd(), 'migrations', '0022_document_types_fields.sql')
const sql = readFileSync(sqlPath, 'utf-8')

describe('mirror integrity — constantes TS vs seed SQL migration 0022 (T4)', () => {
  it('ci_py: required paths en SQL = REQUIRED_PATHS_CI_PY', () => {
    const sqlReq = parseRequiredPathsFromSql(sql, 'ci_py')
    expect(sqlReq).toEqual([...REQUIRED_PATHS_CI_PY].sort())
  })

  it('passport: required paths en SQL = REQUIRED_PATHS_PASSPORT', () => {
    const sqlReq = parseRequiredPathsFromSql(sql, 'passport')
    expect(sqlReq).toEqual([...REQUIRED_PATHS_PASSPORT].sort())
  })
})

/*
 * Variante live-DB (requiere DATABASE_URL configurado en el entorno de test):
 *
 * import { listFieldsForDocType } from '../db/repos/extractionFields'
 *
 * describe('mirror integrity — constantes TS vs filas DB (T4)', () => {
 *   it('ci_py: required paths en DB = REQUIRED_PATHS_CI_PY', async () => {
 *     const rows = await listFieldsForDocType('ci_py')
 *     const dbReq = rows.filter(f => f.validation.required).map(f => f.path).sort()
 *     expect(dbReq).toEqual([...REQUIRED_PATHS_CI_PY].sort())
 *   })
 *
 *   it('passport: required paths en DB = REQUIRED_PATHS_PASSPORT', async () => {
 *     const rows = await listFieldsForDocType('passport')
 *     const dbReq = rows.filter(f => f.validation.required).map(f => f.path).sort()
 *     expect(dbReq).toEqual([...REQUIRED_PATHS_PASSPORT].sort())
 *   })
 * })
 */
