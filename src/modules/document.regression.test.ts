// src/modules/document.regression.test.ts
/**
 * Regresión Fase 4: la lógica de requiredPresent con validateExtracted (usando
 * las constantes MIRROR) produce IDÉNTICO resultado que el hardcodeado original
 * para todos los casos de borde. Se escribe ANTES del refactor de document.ts.
 */
import { describe, it, expect } from 'vitest'
import { validateExtracted } from '../lib/fieldValidation'
import type { FieldDefinition } from '../db/repos/extractionFields'
import type { ExtractedDocument } from '../types'

// Constantes que reflejan el hardcodeado de runCedulaPy y runPassport.
// Deben coincidir EXACTAMENTE con el seed SQL (T1) y con las constantes
// REQUIRED_PATHS_* que se exportarán desde document.ts en T4 paso 3.
const MIRROR_CI_PY: FieldDefinition[] = [
  { id:'', docTypeKey:'ci_py', key:'apellidos',       label:'', type:'string', path:'titular.apellidos',               validation:{required:true}, displayOrder:10, createdAt:'' },
  { id:'', docTypeKey:'ci_py', key:'nombres',         label:'', type:'string', path:'titular.nombres',                 validation:{required:true}, displayOrder:20, createdAt:'' },
  { id:'', docTypeKey:'ci_py', key:'numeroCedula',    label:'', type:'string', path:'documento.numeroCedula',           validation:{required:true}, displayOrder:30, createdAt:'' },
  { id:'', docTypeKey:'ci_py', key:'fechaNacimiento', label:'', type:'date',   path:'titular.fechaNacimiento',         validation:{required:true}, displayOrder:40, createdAt:'' },
  { id:'', docTypeKey:'ci_py', key:'fechaVencimiento',label:'', type:'date',   path:'documentoFisico.fechaVencimiento', validation:{required:true}, displayOrder:50, createdAt:'' },
]

const MIRROR_PASSPORT: FieldDefinition[] = [
  { id:'', docTypeKey:'passport', key:'apellidos',       label:'', type:'string', path:'titular.apellidos',               validation:{required:true}, displayOrder:10, createdAt:'' },
  { id:'', docTypeKey:'passport', key:'nombres',         label:'', type:'string', path:'titular.nombres',                 validation:{required:true}, displayOrder:20, createdAt:'' },
  { id:'', docTypeKey:'passport', key:'numeroPasaporte', label:'', type:'string', path:'documento.numeroCedula',           validation:{required:true}, displayOrder:30, createdAt:'' },
  { id:'', docTypeKey:'passport', key:'fechaNacimiento', label:'', type:'date',   path:'titular.fechaNacimiento',         validation:{required:true}, displayOrder:40, createdAt:'' },
  { id:'', docTypeKey:'passport', key:'fechaVencimiento',label:'', type:'date',   path:'documentoFisico.fechaVencimiento', validation:{required:true}, displayOrder:50, createdAt:'' },
]

function makeExtracted(o: {
  apellidos?:string; nombres?:string; numeroCedula?:string
  fechaNacimiento?:string; fechaVencimiento?:string
}): ExtractedDocument {
  return {
    documento:        { pais:'PY', tipo:'ci_py', numeroCedula:o.numeroCedula??'', specimen:false },
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

// Copia literal del hardcodeado en document.ts (runCedulaPy y runPassport son idénticos)
function hardcoded(ex: ExtractedDocument): boolean {
  return (
    !!ex.titular.apellidos &&
    !!ex.titular.nombres &&
    !!ex.documento.numeroCedula &&
    !!ex.titular.fechaNacimiento &&
    !!ex.documentoFisico.fechaVencimiento
  )
}

const CASES: Array<[string, Parameters<typeof makeExtracted>[0]]> = [
  ['todos presentes',         { apellidos:'FRANCO', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' }],
  ['apellidos ausente',       { apellidos:'',       nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' }],
  ['nombres ausente',         { apellidos:'FRANCO', nombres:'',      numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' }],
  ['numeroCedula ausente',    { apellidos:'FRANCO', nombres:'JULIO', numeroCedula:'',        fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' }],
  ['fechaNacimiento ausente', { apellidos:'FRANCO', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'',           fechaVencimiento:'2028-03-26' }],
  ['fechaVencimiento ausente',{ apellidos:'FRANCO', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:''           }],
  ['todos ausentes',          { apellidos:'',       nombres:'',      numeroCedula:'',        fechaNacimiento:'',           fechaVencimiento:''           }],
]

describe('Fase4 regresión — requiredPresent: hardcoded === validateExtracted(mirror)', () => {
  for (const [label, input] of CASES) {
    it(`ci_py — ${label}`, () => {
      const ex = makeExtracted(input)
      expect(validateExtracted(ex, MIRROR_CI_PY).requiredPresent).toBe(hardcoded(ex))
    })
    it(`passport — ${label}`, () => {
      const ex = makeExtracted(input)
      expect(validateExtracted(ex, MIRROR_PASSPORT).requiredPresent).toBe(hardcoded(ex))
    })
  }
})

/**
 * Null literal fields: un campo requerido = null (no '') debe reportarse ausente en
 * AMBAS ramas (hardcoded y validateExtracted). Ancla que `!!null === false` y que
 * validateExtracted lee el path correctamente con null en el campo.
 */
describe('Fase4 regresión — null literal en campo requerido', () => {
  function makeExtractedWithNull(field: 'apellidos'|'nombres'|'numeroCedula'|'fechaNacimiento'|'fechaVencimiento'): ExtractedDocument {
    const base = makeExtracted({ apellidos:'FRANCO', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' })
    if (field === 'apellidos')       (base.titular as unknown as Record<string,unknown>).apellidos = null
    if (field === 'nombres')         (base.titular as unknown as Record<string,unknown>).nombres = null
    if (field === 'numeroCedula')    (base.documento as unknown as Record<string,unknown>).numeroCedula = null
    if (field === 'fechaNacimiento') (base.titular as unknown as Record<string,unknown>).fechaNacimiento = null
    if (field === 'fechaVencimiento')(base.documentoFisico as unknown as Record<string,unknown>).fechaVencimiento = null
    return base
  }

  const FIELDS = ['apellidos','nombres','numeroCedula','fechaNacimiento','fechaVencimiento'] as const
  for (const field of FIELDS) {
    it(`ci_py — ${field}=null → hardcoded===validateExtracted===false`, () => {
      const ex = makeExtractedWithNull(field)
      expect(hardcoded(ex)).toBe(false)
      expect(validateExtracted(ex, MIRROR_CI_PY).requiredPresent).toBe(false)
    })
    it(`passport — ${field}=null → hardcoded===validateExtracted===false`, () => {
      const ex = makeExtractedWithNull(field)
      expect(hardcoded(ex)).toBe(false)
      expect(validateExtracted(ex, MIRROR_PASSPORT).requiredPresent).toBe(false)
    })
  }
})

/**
 * Fix #1 — fail-closed con fieldDefs vacío: deps.fieldDefs=[] debe producir el mismo
 * resultado que la rama hardcodeada cuando faltan campos requeridos. Ancla que un array
 * vacío NO produce requiredPresent=true espurio (fail-OPEN). Esta suite prueba la
 * CONDICIÓN del ternario (deps.fieldDefs?.length), no validateExtracted directamente.
 */
describe('Fase4 regresión — fieldDefs=[] es fail-closed (no fail-open)', () => {
  // Simula la condición del ternario: deps.fieldDefs?.length ? data-driven : hardcode
  function simulateRequiredPresent(ex: ExtractedDocument, fieldDefs: FieldDefinition[]): boolean {
    return fieldDefs?.length
      ? validateExtracted(ex, fieldDefs).requiredPresent
      : (
          !!ex.titular.apellidos &&
          !!ex.titular.nombres &&
          !!ex.documento.numeroCedula &&
          !!ex.titular.fechaNacimiento &&
          !!ex.documentoFisico.fechaVencimiento
        )
  }

  it('fieldDefs=[] con campos ausentes → mismo que hardcoded (false)', () => {
    const ex = makeExtracted({ apellidos:'', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' })
    expect(simulateRequiredPresent(ex, [])).toBe(hardcoded(ex))
    expect(simulateRequiredPresent(ex, [])).toBe(false)
  })

  it('fieldDefs=[] con todos presentes → mismo que hardcoded (true)', () => {
    const ex = makeExtracted({ apellidos:'FRANCO', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' })
    expect(simulateRequiredPresent(ex, [])).toBe(hardcoded(ex))
    expect(simulateRequiredPresent(ex, [])).toBe(true)
  })

  it('fieldDefs=[] con todos ausentes → mismo que hardcoded (false), NO true espurio', () => {
    const ex = makeExtracted({ apellidos:'', nombres:'', numeroCedula:'', fechaNacimiento:'', fechaVencimiento:'' })
    expect(simulateRequiredPresent(ex, [])).toBe(hardcoded(ex))
    expect(simulateRequiredPresent(ex, [])).toBe(false)
  })
})

/**
 * Full-seed equivalence: the 7 optional fields in the ci_py seed (validation={})
 * must be inert — never flip requiredPresent — because validateField({}, {}) returns
 * {ok:true}. This closes the gap between the 5-field proxy above and the real
 * 12-field array that listFieldsForDocType('ci_py') returns in production.
 */
describe('Fase4 regresión — full-seed equivalence (optional fields are inert)', () => {
  // Full 12-field ci_py seed shape (5 required + 7 optional with {})
  const FULL_CI_PY: FieldDefinition[] = [
    ...MIRROR_CI_PY,
    { id:'', docTypeKey:'ci_py', key:'sexo',            label:'', type:'string',  path:'titular.sexo',                    validation:{}, displayOrder:60, createdAt:'' },
    { id:'', docTypeKey:'ci_py', key:'lugarNacimiento', label:'', type:'string',  path:'titular.lugarNacimiento.ciudad',  validation:{}, displayOrder:70, createdAt:'' },
    { id:'', docTypeKey:'ci_py', key:'nacionalidad',    label:'', type:'string',  path:'titular.nacionalidad',             validation:{}, displayOrder:80, createdAt:'' },
    { id:'', docTypeKey:'ci_py', key:'estadoCivil',     label:'', type:'string',  path:'titular.estadoCivil',              validation:{}, displayOrder:90, createdAt:'' },
    { id:'', docTypeKey:'ci_py', key:'donante',         label:'', type:'boolean', path:'titular.donante',                  validation:{}, displayOrder:100, createdAt:'' },
    { id:'', docTypeKey:'ci_py', key:'fechaEmision',    label:'', type:'date',    path:'documentoFisico.fechaEmision',    validation:{}, displayOrder:110, createdAt:'' },
    { id:'', docTypeKey:'ci_py', key:'ic',              label:'', type:'string',  path:'registroInterno.ic',              validation:{}, displayOrder:120, createdAt:'' },
  ]

  it('todos presentes: full-seed === hardcoded', () => {
    const ex = makeExtracted({ apellidos:'FRANCO', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' })
    expect(validateExtracted(ex, FULL_CI_PY).requiredPresent).toBe(hardcoded(ex))
  })

  it('campo requerido ausente: full-seed === hardcoded', () => {
    const ex = makeExtracted({ apellidos:'', nombres:'JULIO', numeroCedula:'8354119', fechaNacimiento:'1975-04-19', fechaVencimiento:'2028-03-26' })
    expect(validateExtracted(ex, FULL_CI_PY).requiredPresent).toBe(hardcoded(ex))
  })
})
