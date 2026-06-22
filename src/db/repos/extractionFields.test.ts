import { describe, it, expect } from 'vitest'
import type { Executor } from '../executor'
import type { FieldValidationRules } from './extractionFields'
import * as extractionFields from './extractionFields'

const NOW = new Date('2026-06-22T00:00:00Z')

function mockFieldRow(overrides: {
  id: string; doc_type_key: string; key: string; label: string
  type?: 'string' | 'date' | 'boolean' | 'number'
  path: string; validation?: FieldValidationRules; display_order?: number
}) {
  return {
    id: overrides.id,
    doc_type_key: overrides.doc_type_key,
    key: overrides.key,
    label: overrides.label,
    type: overrides.type ?? 'string',
    path: overrides.path,
    validation: overrides.validation ?? {},
    display_order: overrides.display_order ?? 0,
    created_at: NOW,
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

/** Build 12 ci_py field rows for seed tests */
function ciPyFields() {
  const defs = [
    { key: 'apellidos',       path: 'titular.apellidos',       validation: { required: true } },
    { key: 'nombres',         path: 'titular.nombres',         validation: { required: true } },
    { key: 'nro_documento',   path: 'titular.nroDocumento',    validation: { required: true } },
    { key: 'fecha_nacimiento',path: 'titular.fechaNacimiento', validation: { required: true }, type: 'date' as const },
    { key: 'sexo',            path: 'titular.sexo',            validation: { required: true } },
    { key: 'nacionalidad',    path: 'titular.nacionalidad',    validation: { required: false } },
    { key: 'fecha_vencimiento',path:'titular.fechaVencimiento',validation: { required: false }, type: 'date' as const },
    { key: 'fecha_emision',   path: 'titular.fechaEmision',    validation: { required: false }, type: 'date' as const },
    { key: 'estado_civil',    path: 'titular.estadoCivil',     validation: { required: false } },
    { key: 'lugar_nacimiento',path: 'titular.lugarNacimiento', validation: { required: false } },
    { key: 'codigo_seguridad',path: 'registroInterno.codigoSeguridad', validation: { required: false } },
    { key: 'mrz_linea1',      path: 'mrz.linea1',              validation: { required: false } },
  ]
  return defs.map((d, i) => mockFieldRow({
    id: `field-ci-${i + 1}`,
    doc_type_key: 'ci_py',
    key: d.key, label: d.key, path: d.path,
    type: (d as { type?: 'string'|'date' }).type ?? 'string',
    validation: d.validation,
    display_order: i + 1,
  }))
}

/** Build 8 passport field rows, 5 required */
function passportFields() {
  const defs = [
    { key: 'apellidos',        path: 'titular.apellidos',        validation: { required: true } },
    { key: 'nombres',          path: 'titular.nombres',          validation: { required: true } },
    { key: 'nro_pasaporte',    path: 'titular.nroPasaporte',     validation: { required: true } },
    { key: 'fecha_nacimiento', path: 'titular.fechaNacimiento',  validation: { required: true }, type: 'date' as const },
    { key: 'pais_emisor',      path: 'titular.paisEmisor',       validation: { required: true } },
    { key: 'fecha_vencimiento',path: 'titular.fechaVencimiento', validation: { required: false }, type: 'date' as const },
    { key: 'sexo',             path: 'titular.sexo',             validation: { required: false } },
    { key: 'mrz_td3',          path: 'mrz.td3',                  validation: { required: false } },
  ]
  return defs.map((d, i) => mockFieldRow({
    id: `field-pp-${i + 1}`,
    doc_type_key: 'passport',
    key: d.key, label: d.key, path: d.path,
    type: (d as { type?: 'string'|'date' }).type ?? 'string',
    validation: d.validation,
    display_order: i + 1,
  }))
}

describe('extractionFields.listFieldsForDocType', () => {
  it('ci_py → 12 campos, todos mapeados snake→camel', async () => {
    const exec = mockExec([{
      match: /SELECT \* FROM extraction_fields WHERE doc_type_key = \$1/i,
      rows: ciPyFields(),
    }])
    const fields = await extractionFields.listFieldsForDocType('ci_py', exec)
    expect(fields).toHaveLength(12)
  })

  it('campo apellidos: path correcto + required=true, type string', async () => {
    const exec = mockExec([{
      match: /SELECT \* FROM extraction_fields WHERE doc_type_key = \$1/i,
      rows: ciPyFields(),
    }])
    const fields = await extractionFields.listFieldsForDocType('ci_py', exec)
    const f = fields.find(f => f.key === 'apellidos')
    expect(f?.path).toBe('titular.apellidos')
    expect(f?.validation.required).toBe(true)
    expect(f?.type).toBe('string')
    expect(f?.docTypeKey).toBe('ci_py')
    expect(f?.createdAt).toBe(NOW.toISOString())
  })

  it('passport: 8 campos, 5 required', async () => {
    const exec = mockExec([{
      match: /SELECT \* FROM extraction_fields WHERE doc_type_key = \$1/i,
      rows: passportFields(),
    }])
    const fields = await extractionFields.listFieldsForDocType('passport', exec)
    expect(fields).toHaveLength(8)
    expect(fields.filter(f => f.validation.required)).toHaveLength(5)
  })

  it('doc_type desconocido → lista vacía', async () => {
    const exec = mockExec([{
      match: /SELECT \* FROM extraction_fields WHERE doc_type_key = \$1/i,
      rows: [],
    }])
    expect(await extractionFields.listFieldsForDocType('__no_existe__', exec)).toHaveLength(0)
  })

  it('validation nula → {} vacío (no explota)', async () => {
    const exec = mockExec([{
      match: /SELECT \* FROM extraction_fields WHERE doc_type_key = \$1/i,
      rows: [{ ...mockFieldRow({ id: 'x', doc_type_key: 'ci_py', key: 'x', label: 'X', path: 'a.b' }), validation: null }],
    }])
    const fields = await extractionFields.listFieldsForDocType('ci_py', exec)
    expect(fields[0].validation).toEqual({})
  })
})

describe('extractionFields.getField', () => {
  it('devuelve el campo mapeado cuando existe', async () => {
    const row = mockFieldRow({ id: 'f1', doc_type_key: 'ci_py', key: 'apellidos', label: 'Apellidos', path: 'titular.apellidos', validation: { required: true } })
    const exec = mockExec([{
      match: /SELECT \* FROM extraction_fields WHERE id = \$1/i,
      rows: [row],
    }])
    const f = await extractionFields.getField('f1', exec)
    expect(f?.id).toBe('f1')
    expect(f?.validation.required).toBe(true)
  })

  it('inexistente → null', async () => {
    const exec = mockExec([{ match: /SELECT \* FROM extraction_fields WHERE id = \$1/i, rows: [] }])
    expect(await extractionFields.getField('__nope__', exec)).toBeNull()
  })
})

describe('extractionFields.createField', () => {
  it('devuelve el campo con id del RETURNING *', async () => {
    const returned = mockFieldRow({
      id: 'new-uuid', doc_type_key: 'ci_py', key: 'test_crud_t2_fase4',
      label: 'Test', path: 'registroInterno.ubicacion',
      validation: { required: false, regex: '^[A-Z]' }, display_order: 999,
    })
    const exec = mockExec([{ match: /INSERT INTO extraction_fields/i, rows: [returned] }])
    const created = await extractionFields.createField(
      { docTypeKey: 'ci_py', key: 'test_crud_t2_fase4', label: 'Test',
        type: 'string', path: 'registroInterno.ubicacion',
        validation: { required: false, regex: '^[A-Z]' }, displayOrder: 999 },
      exec
    )
    expect(created.id).toBe('new-uuid')
    expect(created.validation.regex).toBe('^[A-Z]')
    expect(created.displayOrder).toBe(999)
  })
})

describe('extractionFields.updateField', () => {
  it('patch label → fila actualizada devuelta', async () => {
    const returned = mockFieldRow({
      id: 'f1', doc_type_key: 'ci_py', key: 'test', label: 'Test Updated',
      path: 'x.y', display_order: 1,
    })
    const exec = mockExec([{ match: /UPDATE extraction_fields SET/i, rows: [returned] }])
    const updated = await extractionFields.updateField('f1', { label: 'Test Updated' }, exec)
    expect(updated?.label).toBe('Test Updated')
  })

  it('patch vacío → llama getField (no UPDATE)', async () => {
    const returned = mockFieldRow({ id: 'f1', doc_type_key: 'ci_py', key: 'x', label: 'X', path: 'a.b' })
    const exec = mockExec([{ match: /SELECT \* FROM extraction_fields WHERE id = \$1/i, rows: [returned] }])
    const result = await extractionFields.updateField('f1', {}, exec)
    expect(result?.id).toBe('f1')
  })

  it('id no existe → null', async () => {
    const exec = mockExec([{ match: /UPDATE extraction_fields SET/i, rows: [] }])
    const result = await extractionFields.updateField('__nope__', { label: 'X' }, exec)
    expect(result).toBeNull()
  })
})

describe('extractionFields.deleteField', () => {
  it('rowCount > 0 → true', async () => {
    const exec = mockExec([{ match: /DELETE FROM extraction_fields WHERE id=\$1/i, rows: [], rowCount: 1 }])
    expect(await extractionFields.deleteField('f1', exec)).toBe(true)
  })

  it('rowCount 0 → false', async () => {
    const exec = mockExec([{ match: /DELETE FROM extraction_fields WHERE id=\$1/i, rows: [], rowCount: 0 }])
    expect(await extractionFields.deleteField('__nope__', exec)).toBe(false)
  })
})
