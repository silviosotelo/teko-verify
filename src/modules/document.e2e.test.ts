/**
 * E2E Fase 4 — T7: DocumentModule.run() con fieldDefs mirror produce el MISMO
 * passed que sin fieldDefs (no-regresión). OCR vacío → campos vacíos → passed=false
 * en ambos caminos (fail-closed). No requiere GPU ni sidecar real.
 *
 * Adaptaciones respecto a la plantilla del planner:
 *   - Engine NO se exporta desde ./document; se importa desde ../engine.
 *   - STUB_ENGINE incluye bestFace() (cropDocFace lo llama tras detect).
 *   - STUB_BARCODE devuelve { format:'', text:'' } (BarcodeData es non-nullable;
 *     null rompe el acceso a barcode.text fuera del try/catch en runCedulaPy).
 *   - unknown_doc_type guard SÍ existe en document.ts (T4 paso 6) → test válido.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  DocumentModule,
  REQUIRED_PATHS_CI_PY,
  REQUIRED_PATHS_PASSPORT,
} from './document'
import type { DocumentDeps, OcrClient, MrzReader, BarcodeReader } from './document'
import type { Engine } from '../engine'
import type { FieldDefinition } from '../db/repos/extractionFields'

// ---------------------------------------------------------------------------
// Helper: construye fieldDefs espejo a partir de las constantes de paths.
// Validation required:true en todos → mismo gate que el hardcodeado.
// ---------------------------------------------------------------------------
function mirrorDefs(paths: readonly string[], docTypeKey: string): FieldDefinition[] {
  return paths.map((path, i) => ({
    id: String(i),
    docTypeKey,
    key: path.split('.').pop()!,
    label: path,
    type: 'string' as const,
    path,
    validation: { required: true },
    displayOrder: (i + 1) * 10,
    createdAt: '',
  }))
}

// ---------------------------------------------------------------------------
// Stubs. Todos los clientes resuelven sin tocar red/GPU/sidecar.
// ---------------------------------------------------------------------------

/** OCR vacío: ningún campo puede ser anclado → extracted queda en blanco. */
const STUB_OCR: OcrClient = {
  recognize: vi.fn().mockResolvedValue({ rawText: '', confidence: 0, lines: [] }),
}

/** MrzReader vacío: sin líneas TD1 → parseMrz recibe [] → EMPTY_MRZ. */
const STUB_MRZ: MrzReader = {
  readLines: vi.fn().mockResolvedValue([]),
}

/**
 * BarcodeReader: devuelve BarcodeData vacío (no null).
 * BarcodeData.text se accede FUERA del try/catch en runCedulaPy, por lo que
 * un null aquí causaría TypeError uncaught. { format:'', text:'' } es seguro.
 */
const STUB_BARCODE: BarcodeReader = {
  read: vi.fn().mockResolvedValue({ format: '', text: '' }),
}

/**
 * Engine (clase, src/engine.ts, no exportada desde document.ts).
 * cropDocFace llama detect() luego bestFace(). Con detect→[] bestFace→null
 * la función retorna null antes de llegar a sharp → docFaceCrop=null → passed=false.
 */
const STUB_ENGINE = {
  ready: true,
  detect: vi.fn().mockResolvedValue([]),
  bestFace: vi.fn().mockReturnValue(null),
} as unknown as Engine

function makeDeps(fieldDefs?: FieldDefinition[]): DocumentDeps {
  return {
    ocr: STUB_OCR,
    mrzReader: STUB_MRZ,
    barcodeReader: STUB_BARCODE,
    engine: STUB_ENGINE,
    ...(fieldDefs !== undefined ? { fieldDefs } : {}),
  }
}

const EMPTY = Buffer.alloc(0)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E Fase4 — ci_py: fieldDefs mirror vs hardcoded (OCR vacío)', () => {
  it('passed=false en ambos caminos (OCR vacío → campos vacíos)', async () => {
    const mod = new DocumentModule()
    const sin = await mod.run(EMPTY, EMPTY, makeDeps(), 'ci_py')
    const con = await mod.run(
      EMPTY,
      EMPTY,
      makeDeps(mirrorDefs(REQUIRED_PATHS_CI_PY, 'ci_py')),
      'ci_py',
    )

    expect(sin.passed).toBe(false)
    expect(con.passed).toBe(false)

    // extracted idéntico en ambos caminos (fail-closed: campos vacíos)
    expect(sin.extracted.titular.apellidos).toBe(con.extracted.titular.apellidos)
    expect(sin.extracted.documento.numeroCedula).toBe(con.extracted.documento.numeroCedula)
  })
})

describe('E2E Fase4 — passport: fieldDefs mirror vs hardcoded (OCR vacío)', () => {
  it('passed=false en ambos caminos', async () => {
    const mod = new DocumentModule()
    const sin = await mod.run(EMPTY, EMPTY, makeDeps(), 'passport')
    const con = await mod.run(
      EMPTY,
      EMPTY,
      makeDeps(mirrorDefs(REQUIRED_PATHS_PASSPORT, 'passport')),
      'passport',
    )

    expect(sin.passed).toBe(false)
    expect(con.passed).toBe(false)
  })
})

describe('E2E Fase4 — tipo desconocido → fail-closed', () => {
  it('passed=false, check unknown_doc_type presente', async () => {
    const mod = new DocumentModule()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await mod.run(EMPTY, EMPTY, makeDeps(), 'unknown_type' as any)

    expect(res.passed).toBe(false)
    expect(res.authenticity.checks.some(c => c.name === 'unknown_doc_type')).toBe(true)
  })
})
