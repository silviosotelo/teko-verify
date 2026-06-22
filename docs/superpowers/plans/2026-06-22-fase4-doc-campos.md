> **Sub-skill notice** — generado por el skill `plan-implementacion`; sigue el formato canónico de `docs/superpowers/plans/2026-06-22-fase3-pipeline-configurable.md`. NO implementa código: es un plan TDD task-por-task.

# Extensibilidad doc/campos — Fase 4 Implementation Plan

## Goal

Hacer que los **tipos de documento** y sus **campos con reglas de validación** sean datos (BD) en vez de código hardcodeado, y exponer una **UI admin** para gestionar tipos/campos/reglas sin redeploy.

Entregables concretos:
1. `migrations/0022_document_types_fields.sql` — tablas `document_types` + `extraction_fields`, seed que espeja exactamente el comportamiento actual.
2. Repos TypeScript (`documentTypes.ts`, `extractionFields.ts`) siguiendo el patrón `tenantIntegrations.ts`.
3. Librería de validación declarativa pura (`src/lib/fieldValidation.ts`).
4. Refactor de `src/modules/document.ts` — reemplaza `requiredPresent` hardcodeado por `validateExtracted()`, retiene intactos todos los code gates de `passed`.
5. Endpoints CRUD de admin (`/admin/document-types`, `/admin/document-types/:key/fields`).
6. UI admin — sección "Documentos & Campos" con componentes Ecme.
7. Regresiones E2E: ci_py y passport producen `passed` byte-idéntico antes y después del refactor.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Admin UI (React/Ecme)                                                  │
│  DocumentTypes.tsx ──────────────── tabla tipos, toggle enabled         │
│  ExtractionFieldsDrawer.tsx ──────── drawer por tipo, CRUD campos       │
└───────────────────────────────────────────┬─────────────────────────────┘
                                            │ REST
┌───────────────────────────────────────────▼─────────────────────────────┐
│  Admin routes                                                            │
│  src/routes/admin/documentTypes.ts                                       │
│  src/routes/admin/extractionFields.ts                                    │
└───────────────────────────────────────────┬─────────────────────────────┘
                                            │
┌───────────────────────────────────────────▼─────────────────────────────┐
│  Repos                                                                   │
│  src/db/repos/documentTypes.ts    list / get / upsert / delete           │
│  src/db/repos/extractionFields.ts listForDocType / get / create / upd / del │
└───────────────────────────────────────────┬─────────────────────────────┘
                                            │
┌───────────────────────────────────────────▼─────────────────────────────┐
│  Validation lib — PURA (sin dependencias externas)                      │
│  src/lib/fieldValidation.ts                                              │
│    getFieldValue(extracted, dotted.path) → unknown                       │
│    validateField(value, rules)           → { ok, reason? }              │
│    validateExtracted(extracted, defs[])  → { requiredPresent, failures } │
└───────────────────────────────────────────┬─────────────────────────────┘
                                   inject fieldDefs? (optional)
┌───────────────────────────────────────────▼─────────────────────────────┐
│  src/modules/document.ts (refactored)                                   │
│                                                                          │
│  DocumentDeps.fieldDefs?: FieldDefinition[]   ← NEW (optional)          │
│                                                                          │
│  runCedulaPy:                                                            │
│    requiredPresent = fieldDefs                                           │
│      ? validateExtracted(extracted, fieldDefs).requiredPresent           │
│      : !!apellidos && !!nombres && !!ci && !!fechaNac && !!fechaVenc     │
│    passed = requiredPresent                                              │
│          && notExpired(fechaVencimiento, maxDocumentAgeYears)  ← INTACTO │
│          && docFaceCrop !== null                               ← INTACTO │
│                                                                          │
│  runPassport:                                                            │
│    requiredPresent = fieldDefs ? validateExtracted(...) : hardcoded      │
│    passed = requiredPresent                                              │
│          && checkDigitsOk   ← INTACTO                                    │
│          && live            ← INTACTO                                    │
│          && docFaceCrop !== null  ← INTACTO                              │
└─────────────────────────────────────────────────────────────────────────┘
                                            │
┌───────────────────────────────────────────▼─────────────────────────────┐
│  DB                                                                      │
│  document_types   (key PK, label, country, mrz_format, enabled, scope)  │
│  extraction_fields (doc_type_key FK, key, path, type, validation JSONB) │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

- **Node.js / TypeScript** — runtime
- **pg (node-postgres)** — pool + Executor pattern (igual que repos existentes)
- **vitest** — test runner
- **zod** — validación de body en routes admin (ya en uso en el proyecto)
- **React + Ecme** — UI admin: `DataTable`, `Drawer`, `Input`, `Select`, `Switcher`, `Button`, `toast`, `useConfirm`

---

## Global Constraints

1. **Espejo exacto**: el seed SQL y las constantes TS exportadas definen `required: true` en exactamente los **mismos 5 paths** que el código hardcodeado actual: `titular.apellidos`, `titular.nombres`, `documento.numeroCedula`, `titular.fechaNacimiento`, `documentoFisico.fechaVencimiento` — para ambos tipos (ci_py y passport). Un test dedicado (T4 paso 8) aserta que los paths `required` en DB coinciden con las constantes TS.
2. **Solo `requiredPresent` se vuelve data-driven**. Los demás conjuntos de `passed` se retienen VERBATIM:
   - ci_py: `notExpired(fechaVencimiento, maxDocumentAgeYears)` + `docFaceCrop !== null`
   - passport: `checkDigitsOk` (4 check digits ICAO) + `notExpired(fechaVencimiento)` + `docFaceCrop !== null`
3. **`DocumentDeps.fieldDefs?: FieldDefinition[]` es opcional**. Cuando ausente → fallback al chequeo hardcodeado original. Todos los tests existentes pasan sin cambios.
4. **Fail-closed en todos los niveles**: tipo desconocido a `DocumentModule.run()` → `passed=false` explícito (no cae silenciosamente en `runCedulaPy`). Error en `validateExtracted()` → `requiredPresent=false`. Regex inválido en `validateField()` → `{ ok: false }`.
5. **`SessionResult.extracted { ci, nombre, fechaNac, nacionalidad, tipoDoc }`** no cambia — es el contrato público de API de tenant. No tocar `pipeline.ts` ni `types.ts` (la interfaz pública).
6. **Migrations idempotentes**: `CREATE TABLE IF NOT EXISTS`, seed con `ON CONFLICT DO NOTHING`. Re-correr el SQL no pisa ediciones posteriores del operador.
7. **Baseline**: ~485 passing + 1 skip conocido (`consentShouldTransition`) + pre-existing admin suite fails. Fase 4 no introduce nuevos fallos.
8. **Reglas `regex` / `dateRange` / `normalize`**: se implementan en `fieldValidation.ts` (T3) y se prueban en unit tests, pero el seed **no las aplica** a los campos del espejo. Son capacidad nueva para campos tenant-custom. Esto evita divergencias con la lógica de normalización y expiración ya existente en `document.ts`.

---

## T1 — Migration 0022: tablas + seed espejo

### Files
- `migrations/0022_document_types_fields.sql`
- `migrations/0022_document_types_fields.test.ts`

### Interfaces SQL

```sql
-- document_types
CREATE TABLE IF NOT EXISTS document_types (
  key         text        PRIMARY KEY,
  label       text        NOT NULL,
  country     text        NOT NULL DEFAULT 'PY',
  mrz_format  text        CHECK (mrz_format IN ('td1', 'td3')),
  enabled     boolean     NOT NULL DEFAULT true,
  scope_type  text        NOT NULL DEFAULT 'system'
                          CHECK (scope_type IN ('system', 'tenant')),
  scope_id    uuid,       -- NULL = system
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- extraction_fields
CREATE TABLE IF NOT EXISTS extraction_fields (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type_key    text        NOT NULL REFERENCES document_types(key) ON DELETE CASCADE,
  key             text        NOT NULL,
  label           text        NOT NULL,
  type            text        NOT NULL DEFAULT 'string'
                              CHECK (type IN ('string','date','boolean','number')),
  path            text        NOT NULL,  -- dotted path into ExtractedDocument
  validation      jsonb       NOT NULL DEFAULT '{}',
  display_order   integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_type_key, key)
);
```

### Steps TDD

**1. Crear `migrations/0022_document_types_fields.sql` con tablas + seed.**

```sql
-- migrations/0022_document_types_fields.sql
-- =============================================================================
-- Fase 4 — Extensibilidad doc/campos.
-- document_types: catálogo de tipos de documento soportados.
-- extraction_fields: campos por tipo + reglas de validación DECLARATIVAS.
--
-- validation JSONB schema:
--   { required?: boolean, regex?: string,
--     normalize?: 'uppercase'|'trim',
--     dateRange?: { minIso?: string, maxIso?: string } }
--
-- Seed = ESPEJO EXACTO de src/modules/document.ts:
--   required=true en los 5 campos que forman requiredPresent hardcodeado.
--   Los campos opcionales se incluyen con validation='{}' para que la UI
--   los muestre, pero no afectan passed.
-- ON CONFLICT DO NOTHING → re-correr NO pisa ediciones del operador.
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_types (
  key         text        PRIMARY KEY,
  label       text        NOT NULL,
  country     text        NOT NULL DEFAULT 'PY',
  mrz_format  text        CHECK (mrz_format IN ('td1', 'td3')),
  enabled     boolean     NOT NULL DEFAULT true,
  scope_type  text        NOT NULL DEFAULT 'system'
                          CHECK (scope_type IN ('system', 'tenant')),
  scope_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_types_enabled
  ON document_types (key) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS extraction_fields (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type_key    text        NOT NULL REFERENCES document_types(key) ON DELETE CASCADE,
  key             text        NOT NULL,
  label           text        NOT NULL,
  type            text        NOT NULL DEFAULT 'string'
                              CHECK (type IN ('string','date','boolean','number')),
  path            text        NOT NULL,
  validation      jsonb       NOT NULL DEFAULT '{}',
  display_order   integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_type_key, key)
);

CREATE INDEX IF NOT EXISTS idx_extraction_fields_doc_type
  ON extraction_fields (doc_type_key, display_order);

-- ─── Seed document_types ─────────────────────────────────────────────────────
INSERT INTO document_types (key, label, country, mrz_format, enabled, scope_type)
VALUES
  ('ci_py',    'Cédula de Identidad Civil (PY)', 'PY', 'td1', true, 'system'),
  ('passport', 'Pasaporte ICAO',                 'XX', 'td3', true, 'system')
ON CONFLICT DO NOTHING;

-- ─── Seed extraction_fields — ci_py (espejo exacto del hardcodeado) ──────────
-- required=true exactamente en los 5 paths de requiredPresent en runCedulaPy.
INSERT INTO extraction_fields
  (doc_type_key, key, label, type, path, validation, display_order)
VALUES
  ('ci_py','apellidos',        'Apellidos',         'string','titular.apellidos',               '{"required":true}', 10),
  ('ci_py','nombres',          'Nombres',           'string','titular.nombres',                 '{"required":true}', 20),
  ('ci_py','numeroCedula',     'Nº Cédula',         'string','documento.numeroCedula',           '{"required":true}', 30),
  ('ci_py','fechaNacimiento',  'Fecha nacimiento',  'date',  'titular.fechaNacimiento',         '{"required":true}', 40),
  ('ci_py','fechaVencimiento', 'Fecha vencimiento', 'date',  'documentoFisico.fechaVencimiento','{"required":true}', 50),
  ('ci_py','sexo',             'Sexo',              'string','titular.sexo',                    '{}',                60),
  ('ci_py','lugarNacimiento',  'Lugar nacimiento',  'string','titular.lugarNacimiento.ciudad',  '{}',                70),
  ('ci_py','nacionalidad',     'Nacionalidad',      'string','titular.nacionalidad',             '{}',                80),
  ('ci_py','estadoCivil',      'Estado civil',      'string','titular.estadoCivil',              '{}',                90),
  ('ci_py','donante',          'Donante',           'boolean','titular.donante',                '{}',               100),
  ('ci_py','fechaEmision',     'Fecha emisión',     'date',  'documentoFisico.fechaEmision',    '{}',               110),
  ('ci_py','ic',               'IC registro',       'string','registroInterno.ic',              '{}',               120)
ON CONFLICT DO NOTHING;

-- ─── Seed extraction_fields — passport (espejo exacto del hardcodeado) ────────
-- required=true exactamente en los 5 paths de requiredPresent en runPassport.
INSERT INTO extraction_fields
  (doc_type_key, key, label, type, path, validation, display_order)
VALUES
  ('passport','apellidos',        'Apellidos',         'string','titular.apellidos',               '{"required":true}', 10),
  ('passport','nombres',          'Nombres',           'string','titular.nombres',                 '{"required":true}', 20),
  ('passport','numeroPasaporte',  'Nº pasaporte',      'string','documento.numeroCedula',           '{"required":true}', 30),
  ('passport','fechaNacimiento',  'Fecha nacimiento',  'date',  'titular.fechaNacimiento',         '{"required":true}', 40),
  ('passport','fechaVencimiento', 'Fecha vencimiento', 'date',  'documentoFisico.fechaVencimiento','{"required":true}', 50),
  ('passport','sexo',             'Sexo',              'string','titular.sexo',                    '{}',                60),
  ('passport','nacionalidad',     'Nacionalidad',      'string','titular.nacionalidad',             '{}',                70),
  ('passport','paisCodigo',       'País código MRZ',   'string','mrz.paisCodigo',                  '{}',                80)
ON CONFLICT DO NOTHING;
```

**2. Escribir test de idempotencia e integridad del seed.**

```typescript
// migrations/0022_document_types_fields.test.ts
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
```

**3. Ejecutar `vitest run migrations/0022_document_types_fields.test.ts` → rojo → aplicar migración → verde.**

### Deliverable gate
`vitest run migrations/0022_document_types_fields.test.ts` → verde. Tablas creadas, 2 tipos + 20 fields en seed, 5 `required=true` por tipo.

---

## T2 — Repos documentTypes + extractionFields

### Files
- `src/db/repos/documentTypes.ts`
- `src/db/repos/extractionFields.ts`
- `src/db/repos/documentTypes.test.ts`
- `src/db/repos/extractionFields.test.ts`

### Interfaces

```typescript
// src/db/repos/documentTypes.ts
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

// src/db/repos/extractionFields.ts
export interface FieldValidationRules {
  required?: boolean
  regex?: string
  normalize?: 'uppercase' | 'trim'
  dateRange?: { minIso?: string; maxIso?: string }
}

export interface FieldDefinition {
  id: string
  docTypeKey: string
  key: string
  label: string
  type: 'string' | 'date' | 'boolean' | 'number'
  path: string          // dotted path into ExtractedDocument
  validation: FieldValidationRules
  displayOrder: number
  createdAt: string
}
```

### Steps TDD

**1. Tests que fallan para `documentTypes`.**

```typescript
// src/db/repos/documentTypes.test.ts
import { describe, it, expect } from 'vitest'
import { listDocumentTypes, getDocumentType, upsertDocumentType, deleteDocumentType } from './documentTypes'

describe('documentTypes repo', () => {
  it('listDocumentTypes incluye ci_py y passport (seed T1)', async () => {
    const all = await listDocumentTypes()
    expect(all.map(d => d.key)).toContain('ci_py')
    expect(all.map(d => d.key)).toContain('passport')
  })

  it('getDocumentType ci_py → mrzFormat td1, enabled true', async () => {
    const dt = await getDocumentType('ci_py')
    expect(dt?.mrzFormat).toBe('td1')
    expect(dt?.enabled).toBe(true)
    expect(dt?.scopeType).toBe('system')
  })

  it('getDocumentType inexistente → null', async () => {
    expect(await getDocumentType('__no_existe__')).toBeNull()
  })

  it('upsert crea tipo nuevo y lo borra (CRUD)', async () => {
    const created = await upsertDocumentType({
      key: 'test_t2_fase4', label: 'Test T2', country: 'AR',
      mrzFormat: 'td3', enabled: true, scopeType: 'system', scopeId: null,
    })
    expect(created.key).toBe('test_t2_fase4')

    const updated = await upsertDocumentType({ ...created, label: 'Test T2 Updated' })
    expect(updated.label).toBe('Test T2 Updated')

    const deleted = await deleteDocumentType('test_t2_fase4')
    expect(deleted).toBe(true)
    expect(await getDocumentType('test_t2_fase4')).toBeNull()
  })
})
```

**2. Implementar `documentTypes.ts`.**

```typescript
// src/db/repos/documentTypes.ts
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
```

**3. Tests que fallan para `extractionFields`.**

```typescript
// src/db/repos/extractionFields.test.ts
import { describe, it, expect } from 'vitest'
import { listFieldsForDocType, getField, createField, updateField, deleteField } from './extractionFields'

describe('extractionFields repo', () => {
  it('listFieldsForDocType ci_py → 12 campos (seed T1)', async () => {
    const fields = await listFieldsForDocType('ci_py')
    expect(fields).toHaveLength(12)
  })

  it('campo apellidos: path correcto + required=true', async () => {
    const fields = await listFieldsForDocType('ci_py')
    const f = fields.find(f => f.key === 'apellidos')
    expect(f?.path).toBe('titular.apellidos')
    expect(f?.validation.required).toBe(true)
    expect(f?.type).toBe('string')
  })

  it('passport: 8 campos, 5 required', async () => {
    const fields = await listFieldsForDocType('passport')
    expect(fields).toHaveLength(8)
    expect(fields.filter(f => f.validation.required)).toHaveLength(5)
  })

  it('CRUD: crear → leer → editar → borrar campo custom', async () => {
    const created = await createField({
      docTypeKey: 'ci_py', key: 'test_crud_t2_fase4', label: 'Test',
      type: 'string', path: 'registroInterno.ubicacion',
      validation: { required: false, regex: '^[A-Z]' }, displayOrder: 999,
    })
    expect(created.id).toBeDefined()

    const updated = await updateField(created.id, { label: 'Test Updated' })
    expect(updated?.label).toBe('Test Updated')

    const deleted = await deleteField(created.id)
    expect(deleted).toBe(true)
    expect(await getField(created.id)).toBeNull()
  })
})
```

**4. Implementar `extractionFields.ts`.**

```typescript
// src/db/repos/extractionFields.ts
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
```

### Deliverable gate
`vitest run src/db/repos/documentTypes.test.ts src/db/repos/extractionFields.test.ts` → verde.

---

## T3 — Librería de validación declarativa

### Files
- `src/lib/fieldValidation.ts`
- `src/lib/fieldValidation.test.ts`

### Interfaces exportadas

```typescript
export interface ValidationResult { ok: boolean; reason?: string }

export function getFieldValue(extracted: ExtractedDocument, path: string): unknown
export function validateField(value: unknown, rules: FieldValidationRules): ValidationResult
export function validateExtracted(
  extracted: ExtractedDocument,
  defs: FieldDefinition[]
): { requiredPresent: boolean; failures: string[] }
```

### Steps TDD

**1. Tests que fallan primero.**

```typescript
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
```

**2. Implementar `fieldValidation.ts`.**

```typescript
// src/lib/fieldValidation.ts
import type { ExtractedDocument } from '../types'
import type { FieldDefinition, FieldValidationRules } from '../db/repos/extractionFields'

export interface ValidationResult { ok: boolean; reason?: string }

/**
 * Lee un valor de `extracted` siguiendo un dotted path (p.ej. "titular.apellidos",
 * "titular.lugarNacimiento.ciudad"). Devuelve `undefined` si el path no existe.
 */
export function getFieldValue(extracted: ExtractedDocument, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = extracted
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Valida un valor único contra las reglas declarativas.
 * PURA — no lanza nunca. Fail-closed: error interno → { ok:false, reason:'internal_error' }.
 *
 * `required` usa la misma semántica que `!!value` del hardcodeado original:
 *   empty string, null, undefined → falla.
 *
 * `regex` se salta si el valor es vacío y no es required (el campo ausente es válido).
 */
export function validateField(value: unknown, rules: FieldValidationRules): ValidationResult {
  try {
    if (rules.required && !value) {
      return { ok: false, reason: 'required' }
    }
    if (rules.regex !== undefined && typeof value === 'string' && value !== '') {
      const re = new RegExp(rules.regex)
      if (!re.test(value)) return { ok: false, reason: `regex:${rules.regex}` }
    }
    if (rules.dateRange !== undefined && typeof value === 'string' && value !== '') {
      if (rules.dateRange.minIso && value < rules.dateRange.minIso) {
        return { ok: false, reason: `dateRange:min=${rules.dateRange.minIso}` }
      }
      if (rules.dateRange.maxIso && value > rules.dateRange.maxIso) {
        return { ok: false, reason: `dateRange:max=${rules.dateRange.maxIso}` }
      }
    }
    // normalize: sólo usado para transformación (futuro); no produce error.
    return { ok: true }
  } catch {
    return { ok: false, reason: 'internal_error' }
  }
}

/**
 * Aplica las FieldDefinition[] sobre un ExtractedDocument completo.
 * Fail-closed: cualquier excepción → { requiredPresent:false, failures:['__error__'] }.
 */
export function validateExtracted(
  extracted: ExtractedDocument,
  defs: FieldDefinition[]
): { requiredPresent: boolean; failures: string[] } {
  try {
    const failures: string[] = []
    for (const def of defs) {
      const value = getFieldValue(extracted, def.path)
      const result = validateField(value, def.validation)
      if (!result.ok) failures.push(def.key)
    }
    return { requiredPresent: failures.length === 0, failures }
  } catch {
    return { requiredPresent: false, failures: ['__error__'] }
  }
}
```

### Deliverable gate
`vitest run src/lib/fieldValidation.test.ts` → verde, todos los casos cubiertos incluyendo fail-closed de regex inválido.

---

## T4 — Refactor document.ts (riskiest)

### Files
- `src/modules/document.regression.test.ts` — ESCRIBIR ANTES del refactor
- `src/modules/document.ts` — modificar (agregar import + `fieldDefs?` + constantes + reemplazar `requiredPresent`)
- `src/modules/document.mirror.test.ts` — verificar DB ↔ constante TS

### Steps TDD

**PASO 0 — Escribir tests de regresión ANTES de tocar `document.ts`.**

Estos deben pasar en verde con el código actual (T3 ya existe). Si fallan, corregir el test, no el código.

```typescript
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
```

**PASO 1 — Confirmar verde con el código actual (sin tocar `document.ts`).**

```bash
vitest run src/modules/document.regression.test.ts
```

Todos los 14 tests deben pasar. Si alguno falla, el error está en el test o en T3, no en el plan.

**PASO 2 — Agregar import y `fieldDefs?` a `DocumentDeps` en `document.ts`.**

Localizar la sección de imports al inicio del archivo y agregar:

```typescript
import { validateExtracted } from '../lib/fieldValidation'
import type { FieldDefinition } from '../db/repos/extractionFields'
```

Localizar la interface `DocumentDeps` (buscar `interface DocumentDeps`) y agregar al final:

```typescript
/**
 * Fase 4: definiciones de campos cargadas desde DB por el callsite.
 * Cuando `undefined`, los extractores usan el chequeo hardcodeado original.
 * Esto garantiza cero regresión en todos los tests que no inyectan DB.
 */
fieldDefs?: FieldDefinition[]
```

**PASO 3 — Exportar constantes espejo (fuente de verdad para el seed y los tests).**

Agregar después de los imports en `document.ts`:

```typescript
/**
 * Fase 4 — paths requeridos por tipo. Son la fuente de verdad:
 *   - El seed SQL (T1) debe tener required=true en exactamente estos paths.
 *   - Los tests de mirror (T4 paso 8) aseguran que DB y constante coinciden.
 * Si se cambia el hardcodeado, actualizar también estas constantes y el seed.
 */
export const REQUIRED_PATHS_CI_PY = [
  'titular.apellidos',
  'titular.nombres',
  'documento.numeroCedula',
  'titular.fechaNacimiento',
  'documentoFisico.fechaVencimiento',
] as const

export const REQUIRED_PATHS_PASSPORT = [
  'titular.apellidos',
  'titular.nombres',
  'documento.numeroCedula',
  'titular.fechaNacimiento',
  'documentoFisico.fechaVencimiento',
] as const
```

**PASO 4 — Reemplazar `requiredPresent` en `runCedulaPy` (~línea 2605).**

Localizar este bloque en `runCedulaPy`:
```typescript
const requiredPresent =
  !!extracted.titular.apellidos &&
  !!extracted.titular.nombres &&
  !!extracted.documento.numeroCedula &&
  !!extracted.titular.fechaNacimiento &&
  !!extracted.documentoFisico.fechaVencimiento;
```

Reemplazarlo con:
```typescript
// Fase 4: data-driven cuando fieldDefs inyectado; fallback hardcodeado cuando no.
const requiredPresent = deps.fieldDefs
  ? validateExtracted(extracted, deps.fieldDefs).requiredPresent
  : (
      !!extracted.titular.apellidos &&
      !!extracted.titular.nombres &&
      !!extracted.documento.numeroCedula &&
      !!extracted.titular.fechaNacimiento &&
      !!extracted.documentoFisico.fechaVencimiento
    )
```

Las dos líneas siguientes del `passed` se retienen VERBATIM (no tocar):
```typescript
const passed =
  requiredPresent &&
  notExpired(extracted.documentoFisico.fechaVencimiento, deps.maxDocumentAgeYears ?? 0) &&
  docFaceCrop !== null;
```

**PASO 5 — Reemplazar `requiredPresent` en `runPassport` (~línea 2399).**

Localizar el bloque equivalente en `runPassport` y reemplazarlo:
```typescript
const requiredPresent = deps.fieldDefs
  ? validateExtracted(extracted, deps.fieldDefs).requiredPresent
  : (
      !!extracted.titular.apellidos &&
      !!extracted.titular.nombres &&
      !!extracted.documento.numeroCedula &&
      !!extracted.titular.fechaNacimiento &&
      !!extracted.documentoFisico.fechaVencimiento
    )
```

Los tres conjuntos del `passed` de `runPassport` se retienen VERBATIM (no tocar):
```typescript
const passed = requiredPresent && checkDigitsOk && live && docFaceCrop !== null;
```

**PASO 6 — Agregar fail-closed para tipo desconocido en `DocumentModule.run()`.**

Localizar el if/switch de ruteo en `DocumentModule.run()`. Agregar guard antes del ruteo a extractores:

```typescript
// Fail-closed: tipo no implementado en código → passed=false explícito,
// no cae silenciosamente en runCedulaPy.
if (documentType !== 'ci_py' && documentType !== 'passport') {
  return {
    documentType,
    passed: false,
    extracted: emptyExtracted(),
    authenticity: {
      consistent: false,
      checks: [{ name: 'unknown_doc_type', passed: false, detail: `tipo sin parser: ${documentType}` }],
    },
    ocr: { rawText: '', fields: [], confidence: 0 },
    barcode: { format: '', text: '' },
    docFaceCrop: null,
    mrz: { ...EMPTY_MRZ },
  }
}
```

**PASO 7 — Confirmar que los tests de regresión siguen verdes post-refactor.**

```bash
vitest run src/modules/document.regression.test.ts
vitest run src/modules/document.test.ts
```

**PASO 8 — Escribir test de mirror DB ↔ constante.**

```typescript
// src/modules/document.mirror.test.ts
import { describe, it, expect } from 'vitest'
import { listFieldsForDocType } from '../db/repos/extractionFields'
import { REQUIRED_PATHS_CI_PY, REQUIRED_PATHS_PASSPORT } from './document'

describe('mirror integrity — constantes TS vs filas DB (T4)', () => {
  it('ci_py: required paths en DB = REQUIRED_PATHS_CI_PY', async () => {
    const rows = await listFieldsForDocType('ci_py')
    const dbReq = rows.filter(f => f.validation.required).map(f => f.path).sort()
    expect(dbReq).toEqual([...REQUIRED_PATHS_CI_PY].sort())
  })

  it('passport: required paths en DB = REQUIRED_PATHS_PASSPORT', async () => {
    const rows = await listFieldsForDocType('passport')
    const dbReq = rows.filter(f => f.validation.required).map(f => f.path).sort()
    expect(dbReq).toEqual([...REQUIRED_PATHS_PASSPORT].sort())
  })
})
```

### Deliverable gate
```bash
vitest run src/modules/document.regression.test.ts  # 14 tests → verde
vitest run src/modules/document.test.ts              # todos pre-existentes → verde
vitest run src/modules/document.mirror.test.ts       # 2 tests → verde
```
Cero nuevos fallos respecto al baseline.

---

## T5 — Admin CRUD endpoints

### Files
- `src/admin/docTypeValidation.ts` (NEW — helpers puros, mismo patrón que `configValidation.ts`)
- `src/admin/docTypeValidation.test.ts` (NEW — unit tests directos, sin supertest/HTTP)
- `src/admin/router.ts` (EDIT — append handlers al final, igual que rutas de integrations Fase 2)

> **Patrón del proyecto:** los tests de admin testean helpers puros directamente
> (`configValidation.test.ts`, `integrationHelpers.test.ts`). Los handlers se registran
> en `src/admin/router.ts` directamente sobre `adminRouter`, no en sub-routers separados.
> No existe `src/routes/admin/` en este codebase. No se usa `zod`; la validación inline
> sigue el patrón de `configValidation.ts` y `isValidKind`.

### Interfaces REST

```
GET    /admin/document-types                    → DocumentTypeDef[]
POST   /admin/document-types                    → 201 DocumentTypeDef
PUT    /admin/document-types/:key               → DocumentTypeDef
DELETE /admin/document-types/:key               → { deleted: boolean }  (409 si es sistema con parser)

GET    /admin/document-types/:key/fields        → FieldDefinition[]
POST   /admin/document-types/:key/fields        → 201 FieldDefinition
PUT    /admin/document-types/:key/fields/:id    → FieldDefinition
DELETE /admin/document-types/:key/fields/:id    → { deleted: boolean }
```

### Steps TDD

**1. Tests que fallan — helpers puros (sin supertest, sin HTTP).**

```typescript
// src/admin/docTypeValidation.test.ts
import { describe, it, expect } from 'vitest'
import { isValidDocTypePost, isValidDocTypePatch } from './docTypeValidation'

describe('isValidDocTypePost', () => {
  it('acepta body válido mínimo', () => {
    expect(isValidDocTypePost({ key: 'ci_py', label: 'Cédula PY' })).toBe(true)
  })
  it('rechaza key con espacios/mayúsculas', () => {
    expect(isValidDocTypePost({ key: 'CI PY', label: 'x' })).toBe(false)
  })
  it('rechaza label vacío', () => {
    expect(isValidDocTypePost({ key: 'ci_py', label: '' })).toBe(false)
  })
  it('rechaza mrzFormat inválido', () => {
    expect(isValidDocTypePost({ key: 'x', label: 'X', mrzFormat: 'td99' })).toBe(false)
  })
  it('acepta mrzFormat null', () => {
    expect(isValidDocTypePost({ key: 'x', label: 'X', mrzFormat: null })).toBe(true)
  })
  it('rechaza scopeType no admitido (app/workflow)', () => {
    expect(isValidDocTypePost({ key: 'x', label: 'X', scopeType: 'app' })).toBe(false)
  })
})

describe('isValidDocTypePatch', () => {
  it('acepta label sola', () => {
    expect(isValidDocTypePatch({ label: 'nuevo' })).toBe(true)
  })
  it('acepta objeto vacío (patch sin cambios)', () => {
    expect(isValidDocTypePatch({})).toBe(true)
  })
  it('rechaza label vacío en patch', () => {
    expect(isValidDocTypePatch({ label: '' })).toBe(false)
  })
  it('rechaza enabled no-boolean', () => {
    expect(isValidDocTypePatch({ enabled: 'yes' as unknown as boolean })).toBe(false)
  })
})
```

Run: `npm test -- --run src/admin/docTypeValidation.test.ts` → todo **falla** (módulo no existe).

**2. Implementar `src/admin/docTypeValidation.ts`.**

```typescript
// src/admin/docTypeValidation.ts
const VALID_MRZ   = new Set(['td1', 'td3'])
const VALID_SCOPE = new Set(['system', 'tenant'])
const KEY_RE      = /^[a-z0-9_]{1,64}$/

export function isValidDocTypePost(body: unknown): body is {
  key: string; label: string; country?: string; mrzFormat?: string | null;
  enabled?: boolean; scopeType?: string; scopeId?: string | null
} {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (typeof b.key !== 'string' || !KEY_RE.test(b.key)) return false
  if (typeof b.label !== 'string' || !b.label.trim()) return false
  if (b.mrzFormat !== undefined && b.mrzFormat !== null &&
      !VALID_MRZ.has(b.mrzFormat as string)) return false
  if (b.scopeType !== undefined && !VALID_SCOPE.has(b.scopeType as string)) return false
  return true
}

export function isValidDocTypePatch(body: unknown): body is Partial<{
  label: string; country: string; mrzFormat: string | null; enabled: boolean
}> {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (b.label !== undefined && (typeof b.label !== 'string' || !b.label.trim())) return false
  if (b.mrzFormat !== undefined && b.mrzFormat !== null &&
      !VALID_MRZ.has(b.mrzFormat as string)) return false
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return false
  return true
}
```

Run: `npm test -- --run src/admin/docTypeValidation.test.ts` → todo **verde**.

**3. Agregar handlers en `src/admin/router.ts`.**

Append al final del archivo (después de los handlers de Fase 3/config). Mismo patrón de
`adminRouter.get/post/put/delete(...)` directo, con `requirePermission('manage_tenants')` en
mutaciones (igual que los endpoints de integrations). `SYSTEM_PARSERS_F4` usa nombre único
para no colisionar con cualquier `const` existente.

```typescript
// ---- Tipos de documento + campos (Fase 4) -------------------------------- //
import { isValidDocTypePost, isValidDocTypePatch } from './docTypeValidation'
import * as docTypesRepo from '../db/repos/documentTypes'
import * as fieldsRepo from '../db/repos/extractionFields'

const SYSTEM_PARSERS_F4   = new Set(['ci_py', 'passport'])
const VALID_FIELD_TYPES_F4 = new Set(['string', 'date', 'boolean', 'number'])

adminRouter.get('/document-types', async (_req: Request, res: Response) => {
  res.json(await docTypesRepo.listDocumentTypes())
})

adminRouter.post('/document-types', requirePermission('manage_tenants'),
  async (req: Request, res: Response) => {
    if (!isValidDocTypePost(req.body)) {
      res.status(400).json({ error: 'invalid_doc_type_input' }); return
    }
    if (await docTypesRepo.getDocumentType(req.body.key)) {
      res.status(409).json({ error: 'doc_type_key_exists' }); return
    }
    const created = await docTypesRepo.upsertDocumentType({
      key: req.body.key, label: req.body.label,
      country: typeof req.body.country === 'string' ? req.body.country : 'PY',
      mrzFormat: req.body.mrzFormat ?? null,
      enabled: typeof req.body.enabled === 'boolean' ? req.body.enabled : true,
      scopeType: req.body.scopeType ?? 'system',
      scopeId: req.body.scopeId ?? null,
    })
    res.status(201).json(created)
  }
)

adminRouter.put('/document-types/:key', requirePermission('manage_tenants'),
  async (req: Request, res: Response) => {
    const existing = await docTypesRepo.getDocumentType(req.params.key)
    if (!existing) { res.status(404).json({ error: 'doc_type_not_found' }); return }
    if (!isValidDocTypePatch(req.body)) {
      res.status(400).json({ error: 'invalid_doc_type_patch' }); return
    }
    res.json(await docTypesRepo.upsertDocumentType({ ...existing, ...req.body }))
  }
)

adminRouter.delete('/document-types/:key', requirePermission('manage_tenants'),
  async (req: Request, res: Response) => {
    const existing = await docTypesRepo.getDocumentType(req.params.key)
    if (!existing) { res.status(404).json({ error: 'doc_type_not_found' }); return }
    if (SYSTEM_PARSERS_F4.has(req.params.key)) {
      res.status(409).json({ error: 'cannot_delete_system_doc_type' }); return
    }
    res.json({ deleted: await docTypesRepo.deleteDocumentType(req.params.key) })
  }
)

adminRouter.get('/document-types/:key/fields', async (req: Request, res: Response) => {
  res.json(await fieldsRepo.listFieldsForDocType(req.params.key))
})

adminRouter.post('/document-types/:key/fields', requirePermission('manage_tenants'),
  async (req: Request, res: Response) => {
    const b = req.body ?? {}
    const key   = typeof b.key   === 'string' && b.key.trim()   ? b.key.trim()   : null
    const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : null
    const path  = typeof b.path  === 'string' && b.path.trim()  ? b.path.trim()  : null
    const type  = VALID_FIELD_TYPES_F4.has(b.type)
      ? b.type as 'string' | 'date' | 'boolean' | 'number' : null
    if (!key || !label || !path || !type) {
      res.status(400).json({ error: 'key_label_path_type_required' }); return
    }
    res.status(201).json(await fieldsRepo.createField({
      docTypeKey: req.params.key, key, label, type, path,
      validation: (b.validation && typeof b.validation === 'object') ? b.validation : {},
      displayOrder: typeof b.displayOrder === 'number' ? b.displayOrder : 0,
    }))
  }
)

adminRouter.put('/document-types/:key/fields/:fieldId', requirePermission('manage_tenants'),
  async (req: Request, res: Response) => {
    const updated = await fieldsRepo.updateField(req.params.fieldId, req.body ?? {})
    if (!updated) { res.status(404).json({ error: 'field_not_found' }); return }
    res.json(updated)
  }
)

adminRouter.delete('/document-types/:key/fields/:fieldId', requirePermission('manage_tenants'),
  async (req: Request, res: Response) => {
    const deleted = await fieldsRepo.deleteField(req.params.fieldId)
    if (!deleted) { res.status(404).json({ error: 'field_not_found' }); return }
    res.json({ deleted })
  }
)
```

### Deliverable gate
`vitest run src/admin/docTypeValidation.test.ts` → verde.
`tsc --noEmit` sin errores nuevos.

---

## T6 — Admin UI: sección "Documentos & Campos"

### Files
- `admin/src/views/teko/DocumentTypes/DocumentTypes.tsx` (NEW)
- `admin/src/views/teko/DocumentTypes/index.tsx` (NEW — re-export default)
- `admin/src/teko/client.ts` (EDIT — append document-types methods)
- `admin/src/teko/types.ts` (EDIT — append DocumentTypeDef + DocFieldDef)
- `admin/src/configs/routes.config/tekoRoute.ts` (EDIT — append route entry)
- `admin/src/configs/navigation.config/teko.navigation.config.ts` (EDIT — append nav item)

> **Patrón de referencia:** `admin/src/views/teko/TenantIntegrations/TenantIntegrations.tsx`
> (Fase 2). Importaciones **individuales** (`import Card from '@/components/ui/Card'`), no
> barrel. Sin `Drawer` (no existe en este proyecto): usar `Dialog` para paneles. Sin
> `useConfirm` (no existe): usar `Dialog` con estado local para confirmaciones. API calls
> vía `tekoApi.*` — nunca raw `fetch` — el cliente inyecta `Authorization: Bearer <token>`
> automáticamente. `toast` de `@/components/ui/toast`.

### Interfaces React

```typescript
// Agregar en admin/src/teko/types.ts (append):
export interface DocumentTypeDef {
  key: string; label: string; country: string
  mrzFormat: 'td1' | 'td3' | null; enabled: boolean
  scopeType: 'system' | 'tenant'; scopeId: string | null
  createdAt: string; updatedAt: string
}

export interface DocFieldDef {
  id: string; docTypeKey: string; key: string; label: string
  type: 'string' | 'date' | 'boolean' | 'number'; path: string
  validation: { required?: boolean; regex?: string;
    dateRange?: { minIso?: string; maxIso?: string }; normalize?: string }
  displayOrder: number; createdAt: string
}
```

### Steps TDD

**1. Agregar tipos en `admin/src/teko/types.ts`** (append al final).

**2. Agregar métodos en `admin/src/teko/client.ts`.**

Buscar la función privada `request` en las primeras ~130 líneas del archivo para confirmar
su signatura exacta (`request<T>(method, path, body?)`) antes de editar. Append los métodos
al objeto `tekoApi` (mismo objeto que exporta `getIntegrations`, `putIntegration`, etc.):

```typescript
  // ---- document-types (Fase 4) -------------------------------------------
  async getDocumentTypes(): Promise<DocumentTypeDef[]> {
    return request<DocumentTypeDef[]>('GET', '/document-types')
  }

  async createDocumentType(data: {
    key: string; label: string; country?: string;
    mrzFormat?: string | null; enabled?: boolean; scopeType?: string
  }): Promise<DocumentTypeDef> {
    return request<DocumentTypeDef>('POST', '/document-types', data)
  }

  async putDocumentType(key: string, patch: Partial<DocumentTypeDef>): Promise<DocumentTypeDef> {
    return request<DocumentTypeDef>('PUT', `/document-types/${key}`, patch)
  }

  async deleteDocumentType(key: string): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>('DELETE', `/document-types/${key}`)
  }

  async getDocumentTypeFields(key: string): Promise<DocFieldDef[]> {
    return request<DocFieldDef[]>('GET', `/document-types/${key}/fields`)
  }

  async deleteDocumentTypeField(docKey: string, fieldId: string): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>('DELETE', `/document-types/${docKey}/fields/${fieldId}`)
  }
```

**3. Implementar `DocumentTypes.tsx`.**

```tsx
// admin/src/views/teko/DocumentTypes/DocumentTypes.tsx
import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Alert from '@/components/ui/Alert'
import Skeleton from '@/components/ui/Skeleton'
import Switcher from '@/components/ui/Switcher'
import Dialog from '@/components/ui/Dialog'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import type { DocumentTypeDef, DocFieldDef } from '@/teko/types'

const DocumentTypes = () => {
  const [types, setTypes]                 = useState<DocumentTypeDef[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [fieldsDoc, setFieldsDoc]         = useState<DocumentTypeDef | null>(null)
  const [fields, setFields]               = useState<DocFieldDef[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<DocumentTypeDef | null>(null)

  useEffect(() => {
    tekoApi.getDocumentTypes()
      .then(setTypes)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  async function handleToggle(dt: DocumentTypeDef) {
    try {
      const updated = await tekoApi.putDocumentType(dt.key, { enabled: !dt.enabled })
      setTypes((prev) => prev.map((t) => t.key === updated.key ? updated : t))
      toast.push(
        <Notification title={updated.label} type="success">
          {updated.enabled ? 'Habilitado' : 'Deshabilitado'}
        </Notification>,
        { placement: 'top-center' }
      )
    } catch (e) {
      toast.push(<Notification title="Error" type="danger">{(e as Error).message}</Notification>, { placement: 'top-center' })
    }
  }

  async function handleDelete(dt: DocumentTypeDef) {
    try {
      await tekoApi.deleteDocumentType(dt.key)
      setTypes((prev) => prev.filter((t) => t.key !== dt.key))
      toast.push(<Notification title="Tipo eliminado" type="success">Eliminado correctamente</Notification>, { placement: 'top-center' })
    } catch (e) {
      // 409 → ApiError con mensaje "cannot_delete_system_doc_type"
      toast.push(<Notification title="Error" type="danger">{(e as Error).message}</Notification>, { placement: 'top-center' })
    } finally {
      setConfirmDelete(null)
    }
  }

  async function openFields(dt: DocumentTypeDef) {
    setFieldsDoc(dt)
    setFieldsLoading(true)
    try {
      setFields(await tekoApi.getDocumentTypeFields(dt.key))
    } catch (e) {
      toast.push(<Notification title="Error" type="danger">{(e as Error).message}</Notification>, { placement: 'top-center' })
    } finally {
      setFieldsLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h3 className="mb-1">Tipos de documento</h3>
        <p className="text-gray-500">
          Definición DB-driven de tipos de documento y sus campos de extracción OCR.
        </p>
      </div>
      {error && <Alert type="danger" showIcon className="mb-4">{error}</Alert>}
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500 dark:text-gray-400">
              <th className="py-2 pr-4">Clave</th>
              <th className="py-2 pr-4">Etiqueta</th>
              <th className="py-2 pr-4">País</th>
              <th className="py-2 pr-4">MRZ</th>
              <th className="py-2 pr-4">Habilitado</th>
              <th className="py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {types.map((dt) => (
              <tr key={dt.key} className="border-b">
                <td className="py-2 pr-4 font-mono text-xs">{dt.key}</td>
                <td className="py-2 pr-4">{dt.label}</td>
                <td className="py-2 pr-4">{dt.country}</td>
                <td className="py-2 pr-4">{dt.mrzFormat ?? '—'}</td>
                <td className="py-2 pr-4">
                  <Switcher checked={dt.enabled} onChange={() => handleToggle(dt)} />
                </td>
                <td className="py-2 flex gap-2">
                  <Button size="xs" variant="default" onClick={() => openFields(dt)}>
                    Campos
                  </Button>
                  {dt.scopeType !== 'system' && (
                    <Button size="xs" variant="plain" onClick={() => setConfirmDelete(dt)}>
                      Eliminar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Dialog de confirmación de borrado */}
      <Dialog isOpen={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <div className="p-6">
          <h5 className="mb-2 font-semibold">Eliminar tipo de documento</h5>
          <p className="text-sm mb-4">
            ¿Eliminar <span className="font-mono">{confirmDelete?.key}</span>? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="default" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button variant="solid" onClick={() => confirmDelete && handleDelete(confirmDelete)}>
              Eliminar
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Panel de campos */}
      <Dialog isOpen={fieldsDoc !== null} onClose={() => setFieldsDoc(null)}>
        <div className="p-6 min-w-[480px]">
          <h5 className="mb-4 font-semibold">Campos — {fieldsDoc?.label}</h5>
          {fieldsLoading ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="space-y-2">
              {fields.map((f) => (
                <div key={f.id} className="flex items-center justify-between border rounded p-3">
                  <div>
                    <p className="font-mono text-xs text-gray-500">{f.path}</p>
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-gray-400">
                      {f.type}
                      {f.validation.required ? ' · requerido' : ' · opcional'}
                      {f.validation.regex ? ` · regex: ${f.validation.regex}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="default" onClick={() => setFieldsDoc(null)}>Cerrar</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

export default DocumentTypes
```

**4. Crear `admin/src/views/teko/DocumentTypes/index.tsx`.**

```tsx
export { default } from './DocumentTypes'
```

**5. Agregar ruta en `admin/src/configs/routes.config/tekoRoute.ts`.**

Append dentro del array `tekoRoute` (mismo patrón que las rutas existentes de Workflows, Questionnaires):

```typescript
    {
        key: 'teko.documentTypes',
        path: '/document-types',
        component: lazy(() => import('@/views/teko/DocumentTypes')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
```

**6. Agregar nav item en `admin/src/configs/navigation.config/teko.navigation.config.ts`.**

Append junto a Workflows/Questionnaires en la sección de CONFIGURACIÓN (verificar nombre exacto
de la sección buscando `'teko.workflows'` en el archivo):

```typescript
            {
                key: 'teko.documentTypes',
                path: '/document-types',
                title: 'Documentos & Campos',
                translateKey: '',
                icon: 'tekoWorkflows',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
```

### Deliverable gate
Navegar a `/document-types`: tabla muestra `ci_py` + `passport`. Toggle `Switcher` habilita/deshabilita sin `alert()`/`confirm()` nativo. Botón "Campos" abre `Dialog` con los campos y sus paths. Sin HTML crudo, sin raw `fetch`, todas las llamadas via `tekoApi`.

---

## T7 — E2E + regresión full suite

### Files
- `src/modules/document.e2e.test.ts`

### Steps TDD

**1. Test E2E con mocks (sin sidecar real).**

```typescript
// src/modules/document.e2e.test.ts
/**
 * E2E Fase 4: DocumentModule.run() con fieldDefs mirror = mismo passed
 * que sin fieldDefs. OCR vacío → campos vacíos → passed=false en ambos casos.
 * No requiere GPU ni sidecar.
 */
import { describe, it, expect, vi } from 'vitest'
import { DocumentModule, REQUIRED_PATHS_CI_PY, REQUIRED_PATHS_PASSPORT } from './document'
import type { DocumentDeps, OcrClient, MrzReader, BarcodeReader, Engine } from './document'
import type { FieldDefinition } from '../db/repos/extractionFields'

function mirrorDefs(paths: readonly string[], docTypeKey: string): FieldDefinition[] {
  return paths.map((path, i) => ({
    id: String(i), docTypeKey, key: path.split('.').pop()!, label: path,
    type: 'string' as const, path, validation: { required: true },
    displayOrder: (i + 1) * 10, createdAt: '',
  }))
}

// Real interface method names verified from src/modules/document.ts:
//   OcrClient  → recognize(image: Buffer): Promise<OcrResult>
//   MrzReader  → readLines(back: Buffer, ocr: OcrClient): Promise<string[]>
//   BarcodeReader → read(back: Buffer): Promise<BarcodeData>
//   Engine     → concrete class in src/engine.ts (not an interface). detect(buf) called
//               by cropDocFace internally — stub returns [] so docFaceCrop=null, no throw.
const STUB_OCR: OcrClient = {
  recognize: vi.fn().mockResolvedValue({ rawText: '', confidence: 0, lines: [] }),
}
const STUB_MRZ: MrzReader = {
  readLines: vi.fn().mockResolvedValue([]),
}
const STUB_BARCODE: BarcodeReader = {
  read: vi.fn().mockResolvedValue(null),
}
// Engine is a class (src/engine.ts), not an interface. Stub the one public method that
// document.ts calls: detect() → [] (no face found → docFaceCrop=null, passed=false as expected).
const STUB_ENGINE = {
  ready: true,
  detect: vi.fn().mockResolvedValue([]),
} as unknown as Engine

function makeDeps(fieldDefs?: FieldDefinition[]): DocumentDeps {
  return {
    ocr: STUB_OCR, mrzReader: STUB_MRZ,
    barcodeReader: STUB_BARCODE, engine: STUB_ENGINE,
    ...(fieldDefs ? { fieldDefs } : {}),
  }
}

const EMPTY = Buffer.alloc(0)

describe('E2E Fase4 — ci_py: fieldDefs mirror vs hardcoded (OCR vacío)', () => {
  it('passed=false en ambos caminos (OCR vacío → campos vacíos)', async () => {
    const mod = new DocumentModule()
    const sin  = await mod.run(EMPTY, EMPTY, makeDeps(), 'ci_py')
    const con  = await mod.run(EMPTY, EMPTY, makeDeps(mirrorDefs(REQUIRED_PATHS_CI_PY, 'ci_py')), 'ci_py')
    expect(sin.passed).toBe(false)
    expect(con.passed).toBe(false)
    // extracted idéntico (fail-closed: campos vacíos)
    expect(sin.extracted.titular.apellidos).toBe(con.extracted.titular.apellidos)
    expect(sin.extracted.documento.numeroCedula).toBe(con.extracted.documento.numeroCedula)
  })
})

describe('E2E Fase4 — passport: fieldDefs mirror vs hardcoded (OCR vacío)', () => {
  it('passed=false en ambos caminos', async () => {
    const mod = new DocumentModule()
    const sin  = await mod.run(EMPTY, EMPTY, makeDeps(), 'passport')
    const con  = await mod.run(EMPTY, EMPTY, makeDeps(mirrorDefs(REQUIRED_PATHS_PASSPORT, 'passport')), 'passport')
    expect(sin.passed).toBe(false)
    expect(con.passed).toBe(false)
  })
})

describe('E2E Fase4 — tipo desconocido → fail-closed', () => {
  it('passed=false, check unknown_doc_type presente', async () => {
    const mod = new DocumentModule()
    const res = await mod.run(EMPTY, EMPTY, makeDeps(), 'unknown_type' as any)
    expect(res.passed).toBe(false)
    expect(res.authenticity.checks.some(c => c.name === 'unknown_doc_type')).toBe(true)
  })
})
```

**2. Suite completa — confirmar baseline.**

```bash
vitest run
```

Resultado esperado:
- ~485 + nuevos tests de Fase 4 → verde
- 1 skip conocido (`consentShouldTransition`) → sigue skip
- 0 nuevos fallos respecto al baseline

**3. Type-check.**

```bash
tsc --noEmit
```

Sin errores. `fieldDefs?: FieldDefinition[]` es opcional → todos los usos existentes de `DocumentDeps` sin ese campo compilan sin cambios.

### Deliverable gate
Suite completa verde. `tsc --noEmit` sin errores. 0 nuevos fallos respecto al baseline pre-Fase4.

---

## Self-Review

| Criterio | Estado esperado post-Fase4 |
|---|---|
| Baseline ~485 passing + 1 skip: sin regresión | `fieldDefs?` opcional → fallback hardcodeado cuando ausente |
| Seed espejo: `required=true` en exactamente 5 paths por tipo | Test `document.mirror.test.ts` aserta DB vs constante TS |
| `passed` ci_py — code gates `notExpired` + `docFaceCrop` | Retenidos verbatim, no tocados en T4 |
| `passed` passport — code gates `checkDigitsOk` + `notExpired` + `docFaceCrop` | Retenidos verbatim, no tocados en T4 |
| `SessionResult.extracted { ci, nombre, fechaNac, nacionalidad, tipoDoc }` | No se toca `pipeline.ts` ni `types.ts` (interfaz pública) |
| Tipo desconocido a `DocumentModule.run()` → `passed=false` explícito | Guard en T4 paso 6, cubierto por test E2E T7 |
| `validateField` regex inválido → fail-closed `{ ok:false }` | Test T3 caso "regex inválido (sintaxis)" |
| `validateExtracted` excepción → `requiredPresent=false` | Test T3 caso "excepción interna → fail-closed" |
| Migrations idempotentes | Test T1: doble ejecución del SQL sin errores |
| Borrar ci_py o passport (system) → 409 | Handler T5 con `SYSTEM_PARSERS` Set |
| Admin UI: sin `alert()`/`confirm()`/HTML crudo | Solo `Dialog`, `toast`, Ecme components en T6; sin `useConfirm` ni `Drawer` (no existen en este proyecto) |
| Reglas `regex`/`dateRange`/`normalize`: en lib, no en seed | Seed usa solo `{"required":true}` o `{}` |
| `tsc --noEmit` sin errores | T7 paso 3 |
