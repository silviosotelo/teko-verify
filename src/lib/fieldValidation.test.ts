// src/lib/fieldValidation.test.ts
import { describe, it, expect } from 'vitest'
import type { ExtractedDocument } from '../types'
import { getFieldValue, validateField, validateExtracted } from './fieldValidation'
import type { FieldDefinition } from '../db/repos/extractionFields'

function makeExtracted(o: {
  apellidos?: string; nombres?: string; numeroCedula?: string
  fechaNacimiento?: string; fechaVencimiento?: string
}): ExtractedDocument {
  return {
    documento:        { pais:'PY', tipo:'ci_py', numeroCedula: o.numeroCedula??'', specimen:false },
    titular:          { apellidos:o.apellidos??'', nombres:o.nombres??'',
                        fechaNacimiento:o.fechaNacimiento??'', sexo:'',
                        lugarNacimiento:{ciudad:'',departamento:''}, nacionalidad:'',
                        estadoCivil:'', donante:false, firma:'' },
    documentoFisico:  { fechaEmision:'', fechaVencimiento:o.fechaVencimiento??'', chip:false, codigoBarras:'' },
    registroInterno:  { ic:'', ubicacion:'' },
    autoridadEmisora: { nombre:'', cargo:'', dependencia:'' },
    mrz:              { linea1:'', linea2:'', linea3:'', paisCodigo:'' },
  }
}

const MIRROR_DEFS: FieldDefinition[] = [
  { id:'1', docTypeKey:'ci_py', key:'apellidos',       label:'Apellidos',       type:'string', path:'titular.apellidos',               validation:{required:true}, displayOrder:10, createdAt:'' },
  { id:'2', docTypeKey:'ci_py', key:'nombres',         label:'Nombres',         type:'string', path:'titular.nombres',                 validation:{required:true}, displayOrder:20, createdAt:'' },
  { id:'3', docTypeKey:'ci_py', key:'numeroCedula',    label:'Nº Cédula',       type:'string', path:'documento.numeroCedula',           validation:{required:true}, displayOrder:30, createdAt:'' },
  { id:'4', docTypeKey:'ci_py', key:'fechaNacimiento', label:'Fecha nacimiento',type:'date',   path:'titular.fechaNacimiento',         validation:{required:true}, displayOrder:40, createdAt:'' },
  { id:'5', docTypeKey:'ci_py', key:'fechaVencimiento',label:'Fecha vencimiento',type:'date',  path:'documentoFisico.fechaVencimiento', validation:{required:true}, displayOrder:50, createdAt:'' },
]

describe('getFieldValue', () => {
  it('path 2 niveles titular.apellidos', () => {
    expect(getFieldValue(makeExtracted({ apellidos:'FRANCO' }), 'titular.apellidos')).toBe('FRANCO')
  })
  it('path 3 niveles titular.lugarNacimiento.ciudad', () => {
    const ex = makeExtracted({})
    ;(ex.titular.lugarNacimiento as Record<string,unknown>).ciudad = 'ASUNCION'
    expect(getFieldValue(ex, 'titular.lugarNacimiento.ciudad')).toBe('ASUNCION')
  })
  it('path inexistente → undefined', () => {
    expect(getFieldValue(makeExtracted({}), 'no.existe.path')).toBeUndefined()
  })
})

describe('validateField', () => {
  it('required + valor presente → ok', () => {
    expect(validateField('FRANCO', { required:true })).toEqual({ ok:true })
  })
  it('required + valor vacío → !ok', () => {
    expect(validateField('', { required:true }).ok).toBe(false)
  })
  it('required + null → !ok', () => {
    expect(validateField(null, { required:true }).ok).toBe(false)
  })
  it('required + undefined → !ok', () => {
    expect(validateField(undefined, { required:true }).ok).toBe(false)
  })
  it('regex válido → ok', () => {
    expect(validateField('ABC123', { regex:'^[A-Z0-9]+$' })).toEqual({ ok:true })
  })
  it('regex no cumple → !ok', () => {
    expect(validateField('abc123', { regex:'^[A-Z0-9]+$' }).ok).toBe(false)
  })
  it('regex en campo vacío (no required) → ok (skip regex si vacío)', () => {
    expect(validateField('', { regex:'^[A-Z]+$' })).toEqual({ ok:true })
  })
  it('dateRange minIso cumplido → ok', () => {
    expect(validateField('2025-01-01', { dateRange:{ minIso:'2020-01-01' } })).toEqual({ ok:true })
  })
  it('dateRange minIso no cumplido → !ok', () => {
    expect(validateField('2019-12-31', { dateRange:{ minIso:'2020-01-01' } }).ok).toBe(false)
  })
  it('dateRange maxIso no cumplido → !ok', () => {
    expect(validateField('2030-01-01', { dateRange:{ maxIso:'2025-12-31' } }).ok).toBe(false)
  })
  it('normalize no produce error (solo transforma)', () => {
    expect(validateField('garcia', { normalize:'uppercase' })).toEqual({ ok:true })
  })
  it('reglas {} → siempre ok', () => {
    expect(validateField('', {})).toEqual({ ok:true })
    expect(validateField(null, {})).toEqual({ ok:true })
  })
  it('regex inválido (sintaxis) → fail-closed { ok:false }', () => {
    expect(validateField('texto', { regex:'[invalid(' }).ok).toBe(false)
  })

  // --- Fix: unknown rules → fail-closed ---
  it('regla desconocida minLength → ok:false, reason unknown_rule', () => {
    const result = validateField('hola', { minLength: 5 } as unknown as import('../db/repos/extractionFields').FieldValidationRules)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unknown_rule')
  })
  it('regla desconocida foo → ok:false, reason unknown_rule', () => {
    const result = validateField('hola', { foo: 'bar' } as unknown as import('../db/repos/extractionFields').FieldValidationRules)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unknown_rule')
  })
  it('regex con tipo inválido (número) → ok:false, no crashea', () => {
    const result = validateField('texto', { regex: 42 } as unknown as import('../db/repos/extractionFields').FieldValidationRules)
    expect(result.ok).toBe(false)
  })

  // --- Fix: dateRange requiere formato ISO ---
  it('dateRange con valor N/A → ok:false, reason invalid_date', () => {
    const result = validateField('N/A', { dateRange: { minIso: '2020-01-01' } })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_date')
  })
  it('dateRange con valor vacío → ok (skip dateRange si vacío)', () => {
    expect(validateField('', { dateRange: { minIso: '2020-01-01' } })).toEqual({ ok: true })
  })
  it('dateRange con formato slash (2020/01/01) → ok:false, reason invalid_date', () => {
    const result = validateField('2020/01/01', { dateRange: { minIso: '2020-01-01' } })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_date')
  })
  it('dateRange maxIso cumplido → ok (no regresión)', () => {
    expect(validateField('2024-06-15', { dateRange: { maxIso: '2025-12-31' } })).toEqual({ ok: true })
  })
  it('dateRange valor válido dentro de ambos límites → ok (no regresión)', () => {
    expect(validateField('2023-07-01', { dateRange: { minIso: '2020-01-01', maxIso: '2025-12-31' } })).toEqual({ ok: true })
  })
})

describe('validateExtracted — espejo ci_py', () => {
  it('todos los required presentes → requiredPresent=true, failures=[]', () => {
    const ex = makeExtracted({ apellidos:'FRANCO', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' })
    const { requiredPresent, failures } = validateExtracted(ex, MIRROR_DEFS)
    expect(requiredPresent).toBe(true)
    expect(failures).toEqual([])
  })
  it('apellidos vacío → requiredPresent=false, failures incluye apellidos', () => {
    const ex = makeExtracted({ apellidos:'', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' })
    const { requiredPresent, failures } = validateExtracted(ex, MIRROR_DEFS)
    expect(requiredPresent).toBe(false)
    expect(failures).toContain('apellidos')
  })
  it('campo opcional vacío no afecta requiredPresent', () => {
    const ex = makeExtracted({ apellidos:'FRANCO', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' })
    const defsConOpcional: FieldDefinition[] = [
      ...MIRROR_DEFS,
      { id:'6', docTypeKey:'ci_py', key:'sexo', label:'Sexo', type:'string', path:'titular.sexo', validation:{}, displayOrder:60, createdAt:'' },
    ]
    const { requiredPresent, failures } = validateExtracted(ex, defsConOpcional)
    expect(requiredPresent).toBe(true)
    expect(failures).toEqual([])
  })
  it('excepción interna → fail-closed: requiredPresent=false', () => {
    const badDefs: FieldDefinition[] = [
      { id:'1', docTypeKey:'ci_py', key:'apellidos', label:'Apellidos', type:'string',
        path:'titular.apellidos', validation:{ required:true, regex:'[invalid(' },
        displayOrder:10, createdAt:'' },
    ]
    const ex = makeExtracted({ apellidos:'FRANCO' })
    expect(validateExtracted(ex, badDefs).requiredPresent).toBe(false)
  })
})
