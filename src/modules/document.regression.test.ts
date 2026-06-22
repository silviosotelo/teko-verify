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
