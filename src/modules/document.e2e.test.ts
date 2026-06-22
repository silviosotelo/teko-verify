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
import sharp from 'sharp'
import {
  DocumentModule,
  REQUIRED_PATHS_CI_PY,
  REQUIRED_PATHS_PASSPORT,
} from './document'
import type { DocumentDeps, OcrClient, MrzReader, BarcodeReader } from './document'
import type { Engine } from '../engine'
import type { FieldDefinition } from '../db/repos/extractionFields'
import type { OcrLine } from '../types'

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

// ---------------------------------------------------------------------------
// Helpers and data for the discriminatory test (OCR-poblado + cara detectada)
// ---------------------------------------------------------------------------

/** Creates an OcrLine with 4-corner box centered at (cx, cy) with given dimensions. */
function makeOcrLine(
  text: string,
  score: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
): OcrLine {
  const hw = w / 2
  const hh = h / 2
  return {
    text,
    score,
    box: [
      [cx - hw, cy - hh],
      [cx + hw, cy - hh],
      [cx + hw, cy + hh],
      [cx - hw, cy + hh],
    ] as OcrLine['box'],
  }
}

/**
 * OCR lines designed to satisfy all anchoring constraints in extractFrontInto:
 *   APELLIDOS label (h=40 → effective maxDy=max(56,72)=72) + value gap=50 ≤ 72 ✓
 *   NOMBRES label (default maxDy=220) + value gap=60 ≤ 220 ✓
 *   FECHA DE NACIMIENTO (contains "NACIM") + date gap=50 ≤ 220 ✓
 *   FECHA DE VENCIMIENTO (contains "VENC") + date gap=50 ≤ 220 ✓
 *   "N4895448" → findFusedCiLine: matches /^N[º°o.]?\s?\d/i, 7 digits ✓
 *   No "REPUBLICA DEL PARAGUAY" line → documento.pais = '' (used in negative case)
 */
const FRONT_LINES_CI_PY: OcrLine[] = [
  makeOcrLine('APELLIDOS',            0.99, 200, 100, 200, 40), // label (h=40 → maxDy=72)
  makeOcrLine('RODRIGUEZ',            0.97, 200, 150, 180, 30), // value: gap=50 ≤ 72
  makeOcrLine('NOMBRES',              0.99, 200, 230, 200, 40),
  makeOcrLine('JUAN CARLOS',          0.97, 200, 290, 220, 30), // gap=60 ≤ 220
  makeOcrLine('FECHA DE NACIMIENTO',  0.99, 200, 370, 300, 30), // label contains "NACIM"
  makeOcrLine('15-06-1990',           0.97, 200, 420, 200, 30),
  makeOcrLine('FECHA DE VENCIMIENTO', 0.99, 200, 510, 300, 30), // label contains "VENC"
  makeOcrLine('30-12-2030',           0.97, 200, 560, 200, 30), // future → notExpired=true
  makeOcrLine('N4895448',             0.97, 200, 630, 160, 30), // fused CI: 7 digits
]

// ---------------------------------------------------------------------------

describe('E2E Fase4 — ci_py: caso discriminatorio (OCR poblado + cara detectada)', () => {
  const faceStub = {
    bbox: [10, 10, 50, 50] as [number, number, number, number],
    score: 0.99,
    landmarks5: [] as Array<[number, number]>,
  }
  const STUB_ENGINE_FACE = {
    ready: true,
    detect: vi.fn().mockResolvedValue([faceStub]),
    bestFace: vi.fn().mockReturnValue(faceStub),
  } as unknown as Engine

  it('passed=true en ambos caminos; negative-case diverge (no-regresión real)', async () => {
    // Build a real 100×100 JPEG so sharp(front).extract() succeeds inside cropDocFace.
    // face bbox [10,10,50,50] → margin≈8px → extract {left:2,top:2,w:56,h:56} ≤ 100×100 ✓
    const realFront = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer()

    const ocrPopulated: OcrClient = {
      recognize: vi.fn().mockImplementation(async (buf: Buffer) =>
        buf === realFront
          ? { rawText: 'front', confidence: 0.97, lines: FRONT_LINES_CI_PY }
          : { rawText: '', confidence: 0, lines: [] },
      ),
    }

    const BACK = Buffer.alloc(0)

    function makeDepsDiscriminatorio(fieldDefs?: FieldDefinition[]): DocumentDeps {
      return {
        ocr: ocrPopulated,
        mrzReader: STUB_MRZ,
        barcodeReader: STUB_BARCODE,
        engine: STUB_ENGINE_FACE,
        ...(fieldDefs !== undefined ? { fieldDefs } : {}),
      }
    }

    const mod = new DocumentModule()

    // Camino sin fieldDefs (hardcoded gate)
    const sin = await mod.run(realFront, BACK, makeDepsDiscriminatorio(), 'ci_py')
    // Camino con fieldDefs mirror (data-driven gate, mismos paths)
    const con = await mod.run(
      realFront,
      BACK,
      makeDepsDiscriminatorio(mirrorDefs(REQUIRED_PATHS_CI_PY, 'ci_py')),
      'ci_py',
    )

    // 1. Gate de cara NO corta: docFaceCrop presente en ambos
    expect(sin.docFaceCrop).not.toBeNull()
    expect(con.docFaceCrop).not.toBeNull()

    // 2. extracted NO trivial: los campos fueron realmente anclados por OCR
    expect(sin.extracted.titular.apellidos).toBe('RODRIGUEZ')
    expect(sin.extracted.titular.nombres).toBe('JUAN CARLOS')
    expect(sin.extracted.documento.numeroCedula).toBe('4895448')
    expect(sin.extracted.titular.fechaNacimiento).toBe('1990-06-15')
    expect(sin.extracted.documentoFisico.fechaVencimiento).toBe('2030-12-30')

    // 3. passed=true en AMBOS caminos (eje discriminatorio positivo):
    //    si validateExtracted rompiera (siempre false), con.passed = false,
    //    pero sin.passed = true → divergencia detectada aquí.
    expect(sin.passed).toBe(true)
    expect(con.passed).toBe(true)

    // 4. extracted IDÉNTICO entre sin/con:
    //    validateExtracted es PURA y no muta extracted.
    expect(con.extracted.titular.apellidos).toBe(sin.extracted.titular.apellidos)
    expect(con.extracted.titular.nombres).toBe(sin.extracted.titular.nombres)
    expect(con.extracted.documento.numeroCedula).toBe(sin.extracted.documento.numeroCedula)
    expect(con.extracted.titular.fechaNacimiento).toBe(sin.extracted.titular.fechaNacimiento)
    expect(con.extracted.documentoFisico.fechaVencimiento).toBe(
      sin.extracted.documentoFisico.fechaVencimiento,
    )

    // 5. Negative case — fieldDefs que requieren un campo vacío (documento.pais).
    //    extractFrontInto solo setea pais si hay línea "REPUBLICA DEL PARAGUAY";
    //    FRONT_LINES_CI_PY no la incluye → pais = '' → required falla.
    //    sin fieldDefs: passed=true; con fieldDefs rotos: passed=false.
    //    ESTA es la prueba de que la rama data-driven es consultada y determinante.
    const failDefs: FieldDefinition[] = [
      ...mirrorDefs(REQUIRED_PATHS_CI_PY, 'ci_py'),
      {
        id: 'extra',
        docTypeKey: 'ci_py',
        key: 'pais',
        label: 'documento.pais',
        type: 'string' as const,
        path: 'documento.pais',
        validation: { required: true },
        displayOrder: 999,
        createdAt: '',
      },
    ]
    const conFail = await mod.run(realFront, BACK, makeDepsDiscriminatorio(failDefs), 'ci_py')
    const sinRepeat = await mod.run(realFront, BACK, makeDepsDiscriminatorio(), 'ci_py')
    // hardcoded gate no verifica pais → sigue true
    expect(sinRepeat.passed).toBe(true)
    // data-driven detecta el campo faltante → false
    expect(conFail.passed).toBe(false)
  })
})
