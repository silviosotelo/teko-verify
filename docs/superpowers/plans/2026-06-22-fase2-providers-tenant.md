# Proveedores por tenant — Fase 2 Implementation Plan

> **For agentic workers — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`**
> Read this entire document before starting any task. Each task ends with a mandatory
> deliverable gate; do NOT proceed to the next task until the gate passes.

## Goal

Deliver per-tenant provider resolution for `mailer`, `evidenceStore`, and `amlProvider` with
**fallback to the global (env/config.ts) defaults** when a tenant has no integration configured.
Includes: a new `tenant_integrations` table with encrypted `config` JSONB; symmetric
AES-256-GCM secret helpers; a typed repo; three resolver functions; admin API endpoints
(GET/PUT/DELETE); and an admin UI tab under Integraciones. SMS provider support is
table-ready but **send logic is deferred** (documented below).

No existing behaviour changes. Global providers remain the fallback when a tenant row is
absent, disabled, or its decryption fails.

## Architecture

```
migrations/
  0021_tenant_integrations.sql       ← T1: new table + indexes

src/
  lib/
    secrets.ts                       ← T2: encryptSecret / decryptSecret (AES-256-GCM)
    providerResolver.ts              ← T4/T5: resolveSmtpConfig / resolveEvidenceDir / resolveAmlConfig
  db/repos/
    tenantIntegrations.ts            ← T3: upsert / getByKind / list
    index.ts                         ← T3: register new repo namespace
  admin/
    router.ts                        ← T6: GET/PUT/DELETE /tenants/:id/integrations[/:kind]
  types.ts                           ← T6: add 'manage_integrations' to Permission union

admin/src/
  teko/
    client.ts                        ← T7: add getIntegrations / putIntegration / deleteIntegration
    types.ts                         ← T7: add TenantIntegration type
  views/teko/
    TenantIntegrations/
      TenantIntegrations.tsx         ← T7: NEW — tab view per kind
      index.ts                       ← T7: NEW
  configs/
    routes.config/
      integrationsRoute.ts           ← T7: add /integrations/providers route
    navigation.config/
      teko.navigation.config.ts      ← T7: add "Proveedores" nav item
```

### Cifrado de secretos

**Approach**: AES-256-GCM via Node's built-in `node:crypto`. Master key loaded from env
`TEKO_SECRETS_KEY` (64 hex chars = 32 bytes). Stored format: `gcm$<ivHex>$<authTagHex>$<cipherHex>`.
The **entire config JSON** is serialized and encrypted as a single blob; the JSONB column stores
`{ "enc": "gcm$..." }` when encrypted, or plain JSONB when no secrets exist (storage kind).
Fail-closed: `encryptSecret` throws if key is missing (write path must fail loudly rather than
store plaintext). `decryptSecret` returns `null` if key is absent or decryption fails — the
resolver treats this as "no tenant integration configured" and falls back to global.

### Provider fallback cascade

```
resolveSmtpConfig(tenantId)
  1. SELECT tenant_integrations WHERE tenant_id=$1 AND kind='smtp' AND enabled=true
  2. If row: decryptSecret(row.config.enc) → JSON.parse → SmtpConfig (validate host+user+password)
  3. If null/invalid/disabled: loadSmtpConfig(process.env)   ← existing global
  4. Return SmtpConfig | null

resolveEvidenceDir(tenantId)
  1. SELECT ... kind='storage' AND enabled=true
  2. If row: config.baseDir (plain, no secrets)
  3. Fallback: process.env.TEKO_EVIDENCE_DIR || '/data/teko/evidence'

resolveAmlConfig(tenantId)
  1. SELECT ... kind='aml' AND enabled=true
  2. If row: decrypt → { baseUrl, apiKey, providerName, threshold, timeout }
  3. Fallback: resolveAmlProvider() from env
```

## Tech Stack

- **Backend**: Node.js + TypeScript (strict), Express, `node:crypto` (built-in, no new deps)
- **DB**: PostgreSQL via `src/db/pool` + `Executor` pattern (same as all repos)
- **Frontend**: React 19 + TypeScript + Ecme components (same as Fase 1)
- **Tests**: vitest (already configured after Fase 1); mock-Executor for repo tests; no real DB needed

## Global Constraints

1. **No romper lo existente.** `sendVerificationEmail`, `sendTemplatedEmail`, `evidenceStore`, and
   `resolveAmlProvider` keep their current signatures and behaviour. The resolver wrappers are
   NEW exports, not replacements. Call-sites can be migrated to resolvers task-by-task later.
2. **Secretos NUNCA en plano.** Never log config objects. API GET responses mask secret fields
   with `"***"`. `decryptSecret` output must never appear in any log or error message.
3. **Fail-closed siempre.** A missing `TEKO_SECRETS_KEY`, failed decrypt, or DB error in a resolver
   → silently use global provider and log a WARNING (not error) with no secret data. Never crash.
4. **TypeScript limpio.** `tsc --noEmit` in both `src/` and `admin/src/` must pass with no new
   errors beyond the known baseline.
5. **Tests baseline ~379+ pass + 1 known `consentShouldTransition` failure.** Every task must
   keep passing count ≥ baseline. Run `npm test -- --run` after each task.
6. **Idempotent migration.** Developer runs against prod DB. Every DDL statement uses
   `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE TYPE IF NOT EXISTS`
   (or `DO $$ ... IF NOT EXISTS $$`).
7. **SMS provider**: table row accepted and stored by API, but no `resolveSmsProvider` function
   is implemented. UI shows "Próximamente". Document this explicitly in code comments.
8. **Secretos enmascarados en GET**: in all API responses, any key named `password`, `apiKey`,
   `secret`, `token`, `key` within the decrypted config is replaced with `"***"` before sending.
   The raw config is never serialized to HTTP response.

---

## T1 — Migración `0021_tenant_integrations.sql`

**What this task does:** Add the `tenant_integrations` table. One row per `(tenant_id, kind)`.
`config` JSONB stores the encrypted blob (or plain config for kinds with no secrets). Fully
idempotent — safe to re-run on prod.

### Files

- `migrations/0021_tenant_integrations.sql` (NEW)

### Interfaces

**Produces:**
```sql
tenant_integrations(
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('smtp','storage','aml','sms')),
  config      jsonb       NOT NULL DEFAULT '{}',
  enabled     boolean     NOT NULL DEFAULT true,
  updated_by  text        NOT NULL DEFAULT 'system',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind)
)
```

### Step 1 — Write migration

```sql
-- migrations/0021_tenant_integrations.sql
-- =============================================================================
-- Fase 2 — Proveedores por tenant.
-- tenant_integrations: una fila por (tenant_id, kind). El campo `config` guarda
-- la configuración del proveedor CIFRADA con AES-256-GCM (helpers en src/lib/secrets.ts).
-- Formato del blob cifrado: { "enc": "gcm$<iv>$<tag>$<cipher>" }.
-- Para providers sin secretos (storage), config es JSONB plano.
-- Idempotente: CREATE TABLE IF NOT EXISTS + NOT EXISTS checks.
-- SMS: la tabla lo soporta pero el provider de envío SMS es trabajo futuro.
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_integrations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('smtp', 'storage', 'aml', 'sms')),
  config      jsonb       NOT NULL DEFAULT '{}',
  enabled     boolean     NOT NULL DEFAULT true,
  updated_by  text        NOT NULL DEFAULT 'system',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_tenant_integrations_tenant
  ON tenant_integrations (tenant_id, kind)
  WHERE enabled = true;
```

### Step 2 — Verify (TDD gate)

Run against DB: `psql $DATABASE_URL -f migrations/0021_tenant_integrations.sql`

Confirm idempotency: run again → no error.

Check: `\d tenant_integrations` shows all columns and the unique constraint.

**Deliverable gate:** Migration runs twice without error. Table exists with correct schema.

---

## T2 — Lib de cifrado simétrico (`src/lib/secrets.ts`)

**What this task does:** Add `encryptSecret` / `decryptSecret` using AES-256-GCM. Pure
functions, no DB. Has unit tests with a fixed test key. Fail-closed on both read and write paths.

### Files

- `src/lib/secrets.ts` (NEW)
- `src/lib/secrets.test.ts` (NEW)

### Interfaces

**Produces:**
```typescript
// src/lib/secrets.ts

/** Carga la master key desde TEKO_SECRETS_KEY (64 hex chars → 32 bytes). */
export function loadSecretsKey(): Buffer | null

/**
 * Cifra `plain` con AES-256-GCM usando la master key.
 * Formato: "gcm$<ivHex>$<authTagHex>$<cipherHex>".
 * Lanza si TEKO_SECRETS_KEY no está configurada.
 */
export function encryptSecret(plain: string): string

/**
 * Descifra un blob "gcm$<iv>$<tag>$<cipher>".
 * Fail-closed: devuelve null si la key falta, el formato es inválido, o el GCM falla.
 * NUNCA lanza; NUNCA loguea el texto descifrado.
 */
export function decryptSecret(blob: string): string | null

/**
 * Envuelve un objeto de config: serializa a JSON y cifra.
 * Devuelve { "enc": "<blob>" } para almacenar como JSONB.
 * Lanza si TEKO_SECRETS_KEY no está configurada.
 */
export function encryptConfig(config: Record<string, unknown>): { enc: string }

/**
 * Desenvuelve { enc: blob } → parsea JSON → typed config.
 * Fail-closed: devuelve null si decrypt falla.
 */
export function decryptConfig<T>(wrapped: { enc: string } | Record<string, unknown>): T | null
```

### Step 1 — Write tests FIRST (red)

```typescript
// src/lib/secrets.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encryptSecret, decryptSecret, encryptConfig, decryptConfig, loadSecretsKey } from './secrets'

// 32-byte key encoded as 64 hex chars
const TEST_KEY = 'a'.repeat(64)

describe('secrets', () => {
  const orig = process.env.TEKO_SECRETS_KEY

  beforeEach(() => {
    process.env.TEKO_SECRETS_KEY = TEST_KEY
  })

  afterEach(() => {
    if (orig === undefined) delete process.env.TEKO_SECRETS_KEY
    else process.env.TEKO_SECRETS_KEY = orig
  })

  it('loadSecretsKey returns 32-byte Buffer when key is set', () => {
    const key = loadSecretsKey()
    expect(key).not.toBeNull()
    expect(key!.length).toBe(32)
  })

  it('loadSecretsKey returns null when key is missing', () => {
    delete process.env.TEKO_SECRETS_KEY
    expect(loadSecretsKey()).toBeNull()
  })

  it('encryptSecret produces gcm$ blob', () => {
    const blob = encryptSecret('hello')
    expect(blob.startsWith('gcm$')).toBe(true)
    const parts = blob.split('$')
    expect(parts.length).toBe(4)
  })

  it('decrypt(encrypt(x)) === x', () => {
    const plain = 'supersecret-password-123'
    const blob = encryptSecret(plain)
    expect(decryptSecret(blob)).toBe(plain)
  })

  it('each encrypt produces different iv (non-deterministic)', () => {
    const a = encryptSecret('same')
    const b = encryptSecret('same')
    expect(a).not.toBe(b)
  })

  it('decryptSecret returns null for garbage input', () => {
    expect(decryptSecret('not-a-blob')).toBeNull()
    expect(decryptSecret('gcm$bad$bad$bad')).toBeNull()
  })

  it('decryptSecret returns null if key is wrong', () => {
    const blob = encryptSecret('secret')
    process.env.TEKO_SECRETS_KEY = 'b'.repeat(64)
    expect(decryptSecret(blob)).toBeNull()
  })

  it('decryptSecret returns null if key is missing', () => {
    const blob = encryptSecret('secret')
    delete process.env.TEKO_SECRETS_KEY
    expect(decryptSecret(blob)).toBeNull()
  })

  it('encryptSecret throws if key is missing', () => {
    delete process.env.TEKO_SECRETS_KEY
    expect(() => encryptSecret('x')).toThrow()
  })

  it('encryptConfig / decryptConfig round-trip', () => {
    const cfg = { host: 'smtp.example.com', password: 'pass123', port: 587 }
    const wrapped = encryptConfig(cfg)
    expect(typeof wrapped.enc).toBe('string')
    const out = decryptConfig<typeof cfg>(wrapped)
    expect(out).toEqual(cfg)
  })

  it('decryptConfig returns null on invalid wrapped', () => {
    expect(decryptConfig({ enc: 'garbage' })).toBeNull()
    expect(decryptConfig({ other: 'key' })).toBeNull()
  })
})
```

Run: `npm test -- --run src/lib/secrets.test.ts` → expect all to **fail** (module not found).

### Step 2 — Implement

```typescript
// src/lib/secrets.ts
/**
 * Cifrado simétrico de secretos de providers por tenant (Fase 2).
 * AES-256-GCM usando el módulo nativo node:crypto.
 *
 * Master key: TEKO_SECRETS_KEY (64 hex chars = 32 bytes).
 * Blob format: "gcm$<ivHex>$<authTagHex>$<cipherHex>"
 *
 * Reglas de seguridad:
 *   - encryptSecret lanza si la key falta → escritura falla cerrada (mejor que guardar en plano).
 *   - decryptSecret devuelve null en cualquier fallo → lectura falla cerrada (usa proveedor global).
 *   - NUNCA se loguea el texto descifrado ni la key.
 *   - encryptConfig cifra el objeto entero; decryptConfig lo reconstruye.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12  // 96-bit IV recomendado para GCM
const TAG_LEN = 16

/** Carga la master key desde env. Devuelve null si falta o si tiene formato inválido. */
export function loadSecretsKey(): Buffer | null {
  const hex = process.env.TEKO_SECRETS_KEY
  if (!hex || hex.length !== 64) return null
  try {
    const buf = Buffer.from(hex, 'hex')
    if (buf.length !== 32) return null
    return buf
  } catch {
    return null
  }
}

/**
 * Cifra `plain` con AES-256-GCM.
 * Lanza (no devuelve) si TEKO_SECRETS_KEY no está configurada — el llamador
 * no debe persistir config de provider si no hay key.
 */
export function encryptSecret(plain: string): string {
  const key = loadSecretsKey()
  if (!key) throw new Error('[secrets] TEKO_SECRETS_KEY no configurada: no se puede cifrar')
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `gcm$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`
}

/**
 * Descifra un blob "gcm$<iv>$<tag>$<cipher>".
 * Fail-closed: devuelve null en cualquier error (key ausente, formato inválido, GCM fail).
 * NUNCA lanza. NUNCA loguea el resultado descifrado.
 */
export function decryptSecret(blob: string): string | null {
  try {
    const key = loadSecretsKey()
    if (!key) return null
    const parts = blob.split('$')
    if (parts.length !== 4 || parts[0] !== 'gcm') return null
    const [, ivHex, tagHex, cipherHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const cipherBuf = Buffer.from(cipherHex, 'hex')
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return null
    const decipher = createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(cipherBuf), decipher.final()])
    return plain.toString('utf8')
  } catch {
    return null
  }
}

/**
 * Serializa `config` a JSON y lo cifra.
 * Devuelve `{ enc: "<blob>" }` listo para persistir como JSONB.
 * Lanza si TEKO_SECRETS_KEY no está configurada.
 */
export function encryptConfig(config: Record<string, unknown>): { enc: string } {
  return { enc: encryptSecret(JSON.stringify(config)) }
}

/**
 * Desenvuelve `{ enc: blob }` → JSON.parse → T.
 * Fail-closed: devuelve null si el wrapper no tiene `enc`, decrypt falla, o JSON.parse falla.
 */
export function decryptConfig<T>(wrapped: { enc?: string } | Record<string, unknown>): T | null {
  try {
    const blob = (wrapped as { enc?: string }).enc
    if (typeof blob !== 'string') return null
    const plain = decryptSecret(blob)
    if (plain === null) return null
    return JSON.parse(plain) as T
  } catch {
    return null
  }
}
```

### Step 3 — Run tests (green)

`npm test -- --run src/lib/secrets.test.ts` → all pass.

**Deliverable gate:** All 11 tests green. `tsc --noEmit` has no new errors.

---

## T3 — Repo `tenantIntegrations` (upsert / getByKind / list)

**What this task does:** CRUD layer for `tenant_integrations`. Encrypts on write, decrypts on read.
Fail-closed: if decrypt fails, returns row with `enabled: false` so resolver falls back to global.

### Files

- `src/db/repos/tenantIntegrations.ts` (NEW)
- `src/db/repos/index.ts` (EDIT — add export)

### Interfaces

**Consumes:** `src/lib/secrets.ts` (`encryptConfig`, `decryptConfig`)
**Consumes:** `src/db/pool` + `src/db/executor.ts`

**Produces:**
```typescript
// src/db/repos/tenantIntegrations.ts

export type IntegrationKind = 'smtp' | 'storage' | 'aml' | 'sms'

export interface TenantIntegration {
  id: string
  tenantId: string
  kind: IntegrationKind
  /** Config descifrada (o {} si decrypt falló — tratarlo como no configurado). */
  config: Record<string, unknown>
  /** false si el row existe pero decrypt falló (fail-closed). */
  enabled: boolean
  updatedBy: string
  createdAt: string
  updatedAt: string
}

export async function upsert(
  tenantId: string,
  kind: IntegrationKind,
  config: Record<string, unknown>,
  enabled: boolean,
  actor: string,
  exec?: Executor
): Promise<TenantIntegration>

export async function getByKind(
  tenantId: string,
  kind: IntegrationKind,
  exec?: Executor
): Promise<TenantIntegration | null>

export async function listByTenant(
  tenantId: string,
  exec?: Executor
): Promise<TenantIntegration[]>

export async function remove(
  tenantId: string,
  kind: IntegrationKind,
  exec?: Executor
): Promise<boolean>
```

### Step 1 — Tests FIRST (red)

```typescript
// src/db/repos/tenantIntegrations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mockear secrets para tests sin TEKO_SECRETS_KEY real
vi.mock('../../lib/secrets', () => ({
  encryptConfig: (cfg: Record<string, unknown>) => ({ enc: 'gcm$fake$fake$' + JSON.stringify(cfg) }),
  decryptConfig: <T>(wrapped: { enc?: string }): T | null => {
    if (!wrapped.enc) return null
    const suffix = wrapped.enc.slice('gcm$fake$fake$'.length)
    try { return JSON.parse(suffix) as T } catch { return null }
  },
}))

import * as repo from './tenantIntegrations'
import type { Executor } from '../executor'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

function mockExec(rows: Record<string, unknown>[]): Executor {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  } as unknown as Executor
}

describe('tenantIntegrations repo', () => {
  it('upsert encrypts config and returns TenantIntegration', async () => {
    const row = {
      id: 'aaa', tenant_id: TENANT_ID, kind: 'smtp',
      config: { enc: 'gcm$fake$fake${"host":"smtp.x.com","password":"pw"}' },
      enabled: true, updated_by: 'admin:1',
      created_at: new Date(), updated_at: new Date(),
    }
    const exec = mockExec([row])
    const result = await repo.upsert(TENANT_ID, 'smtp', { host: 'smtp.x.com', password: 'pw' }, true, 'admin:1', exec)
    expect(result.tenantId).toBe(TENANT_ID)
    expect(result.kind).toBe('smtp')
    expect(result.enabled).toBe(true)
    expect(result.config).toEqual({ host: 'smtp.x.com', password: 'pw' })
  })

  it('getByKind returns null when no row', async () => {
    const exec = mockExec([])
    const result = await repo.getByKind(TENANT_ID, 'smtp', exec)
    expect(result).toBeNull()
  })

  it('getByKind decrypts config', async () => {
    const row = {
      id: 'bbb', tenant_id: TENANT_ID, kind: 'smtp',
      config: { enc: 'gcm$fake$fake${"host":"smtp.y.com"}' },
      enabled: true, updated_by: 'admin:1',
      created_at: new Date(), updated_at: new Date(),
    }
    const exec = mockExec([row])
    const result = await repo.getByKind(TENANT_ID, 'smtp', exec)
    expect(result).not.toBeNull()
    expect(result!.config).toEqual({ host: 'smtp.y.com' })
  })

  it('getByKind returns enabled=false and empty config if decrypt fails', async () => {
    const row = {
      id: 'ccc', tenant_id: TENANT_ID, kind: 'smtp',
      config: { enc: 'INVALID' }, // will cause decryptConfig to return null
      enabled: true, updated_by: 'system',
      created_at: new Date(), updated_at: new Date(),
    }
    const exec = mockExec([row])
    const result = await repo.getByKind(TENANT_ID, 'smtp', exec)
    expect(result).not.toBeNull()
    expect(result!.enabled).toBe(false)
    expect(result!.config).toEqual({})
  })

  it('listByTenant returns all rows decrypted', async () => {
    const rows = [
      { id: 'd1', tenant_id: TENANT_ID, kind: 'smtp', config: { enc: 'gcm$fake$fake${"host":"a"}' }, enabled: true, updated_by: 's', created_at: new Date(), updated_at: new Date() },
      { id: 'd2', tenant_id: TENANT_ID, kind: 'aml', config: { enc: 'gcm$fake$fake${"apiKey":"k"}' }, enabled: false, updated_by: 's', created_at: new Date(), updated_at: new Date() },
    ]
    const exec = mockExec(rows)
    const result = await repo.listByTenant(TENANT_ID, exec)
    expect(result.length).toBe(2)
    expect(result[0].kind).toBe('smtp')
    expect(result[1].kind).toBe('aml')
  })

  it('remove returns true when rowCount > 0', async () => {
    const exec = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } as unknown as Executor
    expect(await repo.remove(TENANT_ID, 'smtp', exec)).toBe(true)
  })

  it('remove returns false when row not found', async () => {
    const exec = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as unknown as Executor
    expect(await repo.remove(TENANT_ID, 'smtp', exec)).toBe(false)
  })
})
```

Run → all **fail** (module not found).

### Step 2 — Implement

```typescript
// src/db/repos/tenantIntegrations.ts
/**
 * Repo de tenant_integrations (Fase 2 — Proveedores por tenant).
 *
 * El campo `config` se persiste CIFRADO con AES-256-GCM (ver src/lib/secrets.ts).
 * En lectura: si el descifrado falla (key ausente, datos corruptos), se devuelve
 * la fila con `enabled=false` y `config={}` → el resolver usa el proveedor global.
 * Nunca se loguea la config descifrada.
 */
import { pool } from '../pool'
import type { Executor } from '../executor'
import { iso } from './mapping'
import { encryptConfig, decryptConfig } from '../../lib/secrets'

export type IntegrationKind = 'smtp' | 'storage' | 'aml' | 'sms'

const VALID_KINDS = new Set<string>(['smtp', 'storage', 'aml', 'sms'])

export interface TenantIntegration {
  id: string
  tenantId: string
  kind: IntegrationKind
  config: Record<string, unknown>
  enabled: boolean
  updatedBy: string
  createdAt: string
  updatedAt: string
}

interface IntegrationRow {
  id: string
  tenant_id: string
  kind: string
  config: Record<string, unknown>
  enabled: boolean
  updated_by: string
  created_at: Date
  updated_at: Date
}

function mapRow(row: IntegrationRow): TenantIntegration {
  // Descifrar config; si falla → fail-closed: enabled=false, config={}
  const decrypted = decryptConfig<Record<string, unknown>>(row.config)
  if (decrypted === null) {
    console.warn(`[tenantIntegrations] decrypt failed for tenant=${row.tenant_id} kind=${row.kind} — falling back to global provider`)
    return {
      id: row.id, tenantId: row.tenant_id, kind: row.kind as IntegrationKind,
      config: {}, enabled: false, updatedBy: row.updated_by,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    }
  }
  return {
    id: row.id, tenantId: row.tenant_id, kind: row.kind as IntegrationKind,
    config: decrypted, enabled: row.enabled, updatedBy: row.updated_by,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  }
}

export function isValidKind(kind: unknown): kind is IntegrationKind {
  return typeof kind === 'string' && VALID_KINDS.has(kind)
}

/**
 * INSERT or UPDATE (ON CONFLICT DO UPDATE) de una integración por tenant+kind.
 * La config se cifra antes de persistir. Lanza si TEKO_SECRETS_KEY falta.
 */
export async function upsert(
  tenantId: string,
  kind: IntegrationKind,
  config: Record<string, unknown>,
  enabled: boolean,
  actor: string,
  exec: Executor = pool
): Promise<TenantIntegration> {
  const encryptedConfig = encryptConfig(config) // lanza si key falta
  const res = await exec.query<IntegrationRow>(
    `INSERT INTO tenant_integrations (tenant_id, kind, config, enabled, updated_by)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (tenant_id, kind) DO UPDATE SET
       config     = EXCLUDED.config,
       enabled    = EXCLUDED.enabled,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`,
    [tenantId, kind, JSON.stringify(encryptedConfig), enabled, actor]
  )
  return mapRow(res.rows[0])
}

export async function getByKind(
  tenantId: string,
  kind: IntegrationKind,
  exec: Executor = pool
): Promise<TenantIntegration | null> {
  const res = await exec.query<IntegrationRow>(
    `SELECT * FROM tenant_integrations WHERE tenant_id = $1 AND kind = $2`,
    [tenantId, kind]
  )
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

export async function listByTenant(
  tenantId: string,
  exec: Executor = pool
): Promise<TenantIntegration[]> {
  const res = await exec.query<IntegrationRow>(
    `SELECT * FROM tenant_integrations WHERE tenant_id = $1 ORDER BY kind`,
    [tenantId]
  )
  return res.rows.map(mapRow)
}

export async function remove(
  tenantId: string,
  kind: IntegrationKind,
  exec: Executor = pool
): Promise<boolean> {
  const res = await exec.query(
    `DELETE FROM tenant_integrations WHERE tenant_id = $1 AND kind = $2`,
    [tenantId, kind]
  )
  return (res.rowCount ?? 0) > 0
}
```

### Step 3 — Register in barrel

Edit `src/db/repos/index.ts`: add `export * as tenantIntegrations from './tenantIntegrations'` to
the named exports section, and add `import * as tenantIntegrations from './tenantIntegrations'`
plus `tenantIntegrations` to the `repos` object.

### Step 4 — Run tests (green)

`npm test -- --run src/db/repos/tenantIntegrations.test.ts` → all pass.

`npm test -- --run` → total passing count ≥ baseline.

**Deliverable gate:** All repo tests green. `tsc --noEmit` clean. `repos.tenantIntegrations` accessible.

---

## T4 — Resolvers de providers por tenant (SMTP / storage / AML)

**What this task does:** Add `src/lib/providerResolver.ts` with all three resolver functions:
`resolveSmtpConfig`, `resolveEvidenceDir`, and `resolveAmlConfig`. Each wraps the corresponding
global fallback. No existing code is modified. SMS resolver is deliberately absent (deferred).

### Files

- `src/lib/providerResolver.ts` (NEW)
- `src/lib/providerResolver.test.ts` (NEW)

### Interfaces

**Consumes:** `src/db/repos/tenantIntegrations.ts` (`getByKind`)
**Consumes:** `src/lib/mailer.ts` (`loadSmtpConfig`, `SmtpConfig`)
**Consumes:** `src/modules/amlProvider.ts` (`resolveAmlProvider`, `ExternalAmlConfig`)

**Produces:**
```typescript
/**
 * Resuelve la config SMTP para un tenant.
 * Cascada: fila tenant_integrations (kind='smtp', enabled=true) → global env.
 * Fail-closed: si decrypt falla o config incompleta → usa global.
 * @returns SmtpConfig | null (null = sin SMTP configurado en ningún nivel)
 */
export async function resolveSmtpConfig(tenantId: string, exec?: Executor): Promise<SmtpConfig | null>

/**
 * Resuelve el directorio base de evidencia para un tenant.
 * Cascada: kind='storage' config.baseDir → TEKO_EVIDENCE_DIR env → '/data/teko/evidence'.
 * Sin secretos. Siempre devuelve un string (nunca null).
 */
export async function resolveEvidenceDir(tenantId: string, exec?: Executor): Promise<string>

/**
 * Resuelve la config AML externa para un tenant.
 * Cascada: kind='aml' config → resolveAmlProvider() global.
 * Devuelve null si tampoco hay AML global → el pipeline usa local (OpenSanctions).
 */
export async function resolveAmlConfig(tenantId: string, exec?: Executor): Promise<{
  provider: import('../modules/amlProvider').ExternalAmlProvider
  config: ExternalAmlConfig
  mode: import('../modules/amlProvider').AmlProviderMode
} | null>
```

### Step 1 — Tests FIRST (red)

```typescript
// src/lib/providerResolver.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Executor } from '../db/executor'

// Mock del repo
vi.mock('../db/repos/tenantIntegrations', () => ({
  getByKind: vi.fn(),
}))
import * as tiRepo from '../db/repos/tenantIntegrations'
const mockGetByKind = vi.mocked(tiRepo.getByKind)

// Mock del mailer
vi.mock('./mailer', () => ({
  loadSmtpConfig: vi.fn(),
}))
import { loadSmtpConfig } from './mailer'
const mockLoadSmtp = vi.mocked(loadSmtpConfig)

// Mock del amlProvider
vi.mock('../modules/amlProvider', () => ({
  resolveAmlProvider: vi.fn(),
  HttpAmlProvider: class { screen = vi.fn() },
}))
import { resolveAmlProvider } from '../modules/amlProvider'
const mockResolveAml = vi.mocked(resolveAmlProvider)

import { resolveSmtpConfig, resolveEvidenceDir, resolveAmlConfig } from './providerResolver'

const TENANT_ID = '22222222-2222-2222-2222-222222222222'
const GLOBAL_SMTP = { host: 'global.smtp', port: 587, secure: false, user: 'u', password: 'p', fromEmail: 'from@g.com', fromName: 'Global' }

const mockExec = {} as Executor

describe('resolveSmtpConfig', () => {
  it('returns tenant config when row exists and enabled', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '1', tenantId: TENANT_ID, kind: 'smtp', enabled: true,
      config: { host: 'tenant.smtp', port: 465, secure: true, user: 'tu', password: 'tp', fromEmail: 'from@t.com', fromName: 'Tenant' },
      updatedBy: 'admin', createdAt: '', updatedAt: '',
    })
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg?.host).toBe('tenant.smtp')
  })

  it('falls back to global when no tenant row', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    mockLoadSmtp.mockReturnValueOnce(GLOBAL_SMTP)
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg?.host).toBe('global.smtp')
  })

  it('falls back to global when tenant row disabled', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '2', tenantId: TENANT_ID, kind: 'smtp', enabled: false,
      config: {}, updatedBy: 'admin', createdAt: '', updatedAt: '',
    })
    mockLoadSmtp.mockReturnValueOnce(GLOBAL_SMTP)
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg?.host).toBe('global.smtp')
  })

  it('falls back to global when tenant config missing required fields', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '3', tenantId: TENANT_ID, kind: 'smtp', enabled: true,
      config: { host: 'x' }, // falta user y password
      updatedBy: 'admin', createdAt: '', updatedAt: '',
    })
    mockLoadSmtp.mockReturnValueOnce(GLOBAL_SMTP)
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg?.host).toBe('global.smtp')
  })

  it('returns null when both tenant and global unconfigured', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    mockLoadSmtp.mockReturnValueOnce(null)
    const cfg = await resolveSmtpConfig(TENANT_ID, mockExec)
    expect(cfg).toBeNull()
  })
})

describe('resolveEvidenceDir', () => {
  it('returns tenant baseDir when configured', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '4', tenantId: TENANT_ID, kind: 'storage', enabled: true,
      config: { baseDir: '/mnt/nas/tenant1' }, updatedBy: 's', createdAt: '', updatedAt: '',
    })
    const dir = await resolveEvidenceDir(TENANT_ID, mockExec)
    expect(dir).toBe('/mnt/nas/tenant1')
  })

  it('falls back to TEKO_EVIDENCE_DIR env', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    const orig = process.env.TEKO_EVIDENCE_DIR
    process.env.TEKO_EVIDENCE_DIR = '/data/override'
    const dir = await resolveEvidenceDir(TENANT_ID, mockExec)
    expect(dir).toBe('/data/override')
    if (orig === undefined) delete process.env.TEKO_EVIDENCE_DIR
    else process.env.TEKO_EVIDENCE_DIR = orig
  })

  it('falls back to hardcoded default', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    delete process.env.TEKO_EVIDENCE_DIR
    const dir = await resolveEvidenceDir(TENANT_ID, mockExec)
    expect(dir).toBe('/data/teko/evidence')
  })
})

describe('resolveAmlConfig', () => {
  it('returns tenant AML config when row exists', async () => {
    mockGetByKind.mockResolvedValueOnce({
      id: '5', tenantId: TENANT_ID, kind: 'aml', enabled: true,
      config: { baseUrl: 'https://aml.api', apiKey: 'key123', providerName: 'sumsub' },
      updatedBy: 'admin', createdAt: '', updatedAt: '',
    })
    const result = await resolveAmlConfig(TENANT_ID, mockExec)
    expect(result?.config.baseUrl).toBe('https://aml.api')
    expect(result?.config.providerName).toBe('sumsub')
  })

  it('falls back to global resolveAmlProvider()', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    const globalResult = {
      provider: { screen: vi.fn() },
      mode: 'external' as const,
      config: { baseUrl: 'https://global.aml', apiKey: 'gk', providerName: 'global', threshold: 0.8, timeout: 15000 },
    }
    mockResolveAml.mockReturnValueOnce(globalResult)
    const result = await resolveAmlConfig(TENANT_ID, mockExec)
    expect(result?.config.baseUrl).toBe('https://global.aml')
  })

  it('returns null when no AML configured anywhere', async () => {
    mockGetByKind.mockResolvedValueOnce(null)
    mockResolveAml.mockReturnValueOnce(null)
    expect(await resolveAmlConfig(TENANT_ID, mockExec)).toBeNull()
  })
})
```

### Step 2 — Implement

```typescript
// src/lib/providerResolver.ts
/**
 * Resolvers de proveedores por tenant (Fase 2).
 *
 * Cada función implementa la cascada: configuración del tenant → global (env/config.ts).
 * Fail-closed: un error de DB o de decrypt → WARNING + fallback, nunca crash.
 * Estos son wrappers NUEVOS; las funciones globales (loadSmtpConfig, resolveAmlProvider)
 * no se modifican y siguen funcionando como están.
 */
import { getByKind } from '../db/repos/tenantIntegrations'
import type { Executor } from '../db/executor'
import { loadSmtpConfig, type SmtpConfig } from './mailer'
import { resolveAmlProvider, HttpAmlProvider, type ExternalAmlConfig, type AmlProviderMode, type ExternalAmlProvider } from '../modules/amlProvider'

const EVIDENCE_DEFAULT = '/data/teko/evidence'

// ---------------------------------------------------------------------------
// SMTP / Mailer
// ---------------------------------------------------------------------------

function isValidSmtpConfig(cfg: Record<string, unknown>): cfg is Record<string, unknown> & { host: string; user: string; password: string } {
  return typeof cfg.host === 'string' && cfg.host.length > 0
    && typeof cfg.user === 'string' && cfg.user.length > 0
    && typeof cfg.password === 'string' && cfg.password.length > 0
}

function toSmtpConfig(cfg: Record<string, unknown>): SmtpConfig {
  const portRaw = typeof cfg.port === 'number' ? cfg.port : parseInt(String(cfg.port ?? '587'), 10)
  return {
    host: String(cfg.host),
    port: Number.isFinite(portRaw) ? portRaw : 587,
    secure: Boolean(cfg.secure),
    user: String(cfg.user),
    password: String(cfg.password),
    fromEmail: typeof cfg.fromEmail === 'string' ? cfg.fromEmail : String(cfg.user),
    fromName: typeof cfg.fromName === 'string' ? cfg.fromName : 'Teko Verify',
  }
}

/**
 * Resuelve la config SMTP para el tenant.
 * Cascada: tenant_integrations(smtp, enabled=true) → global env.
 * Fail-closed: decrypt fallido o config incompleta → usa global.
 */
export async function resolveSmtpConfig(
  tenantId: string,
  exec?: Executor
): Promise<SmtpConfig | null> {
  try {
    const row = await getByKind(tenantId, 'smtp', exec)
    if (row && row.enabled && isValidSmtpConfig(row.config)) {
      return toSmtpConfig(row.config)
    }
  } catch (e) {
    console.warn(`[providerResolver] SMTP lookup failed for tenant=${tenantId}: ${(e as Error).message} — using global`)
  }
  return loadSmtpConfig()
}

// ---------------------------------------------------------------------------
// Storage / EvidenceStore
// ---------------------------------------------------------------------------

/**
 * Resuelve el directorio base de evidencia para el tenant.
 * Sin secretos: config.baseDir es texto plano.
 * Cascada: tenant baseDir → TEKO_EVIDENCE_DIR env → hardcoded default.
 */
export async function resolveEvidenceDir(
  tenantId: string,
  exec?: Executor
): Promise<string> {
  try {
    const row = await getByKind(tenantId, 'storage', exec)
    if (row && row.enabled && typeof row.config.baseDir === 'string' && row.config.baseDir.length > 0) {
      return row.config.baseDir
    }
  } catch (e) {
    console.warn(`[providerResolver] storage lookup failed for tenant=${tenantId}: ${(e as Error).message} — using global`)
  }
  return process.env.TEKO_EVIDENCE_DIR || EVIDENCE_DEFAULT
}

// ---------------------------------------------------------------------------
// AML
// ---------------------------------------------------------------------------

function toAmlConfig(cfg: Record<string, unknown>): ExternalAmlConfig | null {
  if (typeof cfg.baseUrl !== 'string' || typeof cfg.apiKey !== 'string' || typeof cfg.providerName !== 'string') return null
  return {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    providerName: cfg.providerName,
    threshold: typeof cfg.threshold === 'number' ? cfg.threshold : 0.8,
    timeout: typeof cfg.timeout === 'number' ? cfg.timeout : 15000,
  }
}

/**
 * Resuelve el provider AML para el tenant.
 * Cascada: tenant_integrations(aml, enabled=true) → resolveAmlProvider() global.
 * null → pipeline usa proveedor local (OpenSanctions).
 */
export async function resolveAmlConfig(
  tenantId: string,
  exec?: Executor
): Promise<{ provider: ExternalAmlProvider; config: ExternalAmlConfig; mode: AmlProviderMode } | null> {
  try {
    const row = await getByKind(tenantId, 'aml', exec)
    if (row && row.enabled) {
      const cfg = toAmlConfig(row.config)
      if (cfg) {
        return { provider: new HttpAmlProvider(), config: cfg, mode: 'external' }
      }
    }
  } catch (e) {
    console.warn(`[providerResolver] AML lookup failed for tenant=${tenantId}: ${(e as Error).message} — using global`)
  }
  return resolveAmlProvider()
}
```

### Step 3 — Run tests (green)

`npm test -- --run src/lib/providerResolver.test.ts` → all pass.

**Deliverable gate:** All resolver tests green. `tsc --noEmit` clean.

---

## T5 — SMS deferral documentation + storage kind without secrets

**What this task does:** Ensure `storage` kind (no secrets, plain JSONB) works correctly with
the encryption wrapper; document SMS deferral formally in code. Add a short test confirming
`storage` config round-trips correctly (no `enc` wrapper needed when there are no secrets;
but for uniformity the code uses `encryptConfig` which also wraps plain config — confirm this
is fine or add a `plainConfig` path).

**Decision:** For simplicity, ALL kinds use `encryptConfig` (even storage). The `baseDir` is
not a secret, but consistency in the storage format avoids conditional code. The cost is minimal
(one AES-256-GCM encrypt of a small JSON on write; decrypt on read). This means `TEKO_SECRETS_KEY`
is required even to configure storage.

If `TEKO_SECRETS_KEY` is not desired for storage-only deployments: add a `isSecretKind(kind)`
helper that skips encryption for `storage` (plain JSONB) and encrypts for `smtp`/`aml`/`sms`.
Document this as a future optimization. **Default for Fase 2: all kinds encrypted.**

### Files

- `src/db/repos/tenantIntegrations.ts` (EDIT — add `isSecretKind` guard, or confirm uniform encryption)

### SMS Deferral Comment (add to `tenantIntegrations.ts`)

```typescript
/**
 * SMS PROVIDER — DEFERRED (Fase 2).
 * La tabla soporta kind='sms' y la API acepta GET/PUT para 'sms'.
 * La implementación del resolver `resolveSmsProvider()` y del envío real
 * de SMS es trabajo futuro. No existe `resolveSmsProvider` en esta fase.
 * La UI muestra la pestaña SMS como "Próximamente".
 */
```

### Deliverable gate

`npm test -- --run` → count ≥ baseline. `tsc --noEmit` clean.
Storage config stored via `upsert` and retrieved via `getByKind` with decrypted `baseDir`.

---

## T6 — Endpoints admin (`GET` / `PUT` / `DELETE` integraciones)

**What this task does:** Add three routes to `src/admin/router.ts`. Requires adding
`'manage_integrations'` to the `Permission` type in `src/types.ts` and granting it to
`owner` and `operator` roles in `src/lib/rbac.ts`.

### Files

- `src/types.ts` (EDIT — add `'manage_integrations'` to `Permission`)
- `src/lib/rbac.ts` (EDIT — grant to owner + operator)
- `src/admin/router.ts` (EDIT — add 3 routes)

### Interfaces

```
GET  /admin/tenants/:id/integrations
  → 200 { integrations: MaskedIntegration[] }
  → 404 if tenant not found

PUT  /admin/tenants/:id/integrations/:kind
  body: { config: Record<string, unknown>; enabled: boolean }
  → 200 { integration: MaskedIntegration }
  → 400 if kind invalid or body malformed
  → 500 if TEKO_SECRETS_KEY missing (cannot encrypt)

DELETE /admin/tenants/:id/integrations/:kind
  → 200 { ok: true }
  → 404 if row not found
```

```typescript
// MaskedIntegration — secrets replaced with "***"
interface MaskedIntegration {
  id: string
  tenantId: string
  kind: string
  config: Record<string, unknown>  // secret fields replaced with "***"
  enabled: boolean
  updatedBy: string
  createdAt: string
  updatedAt: string
}
```

### Step 1 — Edit `src/types.ts`

Find the `Permission` type union and add `| 'manage_integrations'` with the comment
`// CRUD de integraciones de providers (SMTP/storage/AML) por tenant`.

### Step 2 — Edit `src/lib/rbac.ts`

Add `'manage_integrations'` to the permissions granted to `owner` and `operator` roles (same as
`manage_tenants` — integrations are tenant-scoped config).

### Step 3 — Add routes to `src/admin/router.ts`

Add after the existing tenant routes (around the `manage_tenants` blocks). Insert these imports
at the top of the file:

```typescript
import { repos } from '../db/repos'
import { isValidKind } from '../db/repos/tenantIntegrations'
```

(`repos` is already imported; only `isValidKind` is new.)

```typescript
// ─── MASK helper: replace secret field values with "***" ────────────────── //
const SECRET_FIELD_RE = /password|apikey|secret|token|key/i

function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    out[k] = SECRET_FIELD_RE.test(k) ? '***' : v
  }
  return out
}

// ─── GET /admin/tenants/:id/integrations ─────────────────────────────────── //
adminRouter.get(
  '/tenants/:id/integrations',
  requirePermission('manage_integrations'),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id)
    if (!tenant) return res.status(404).json({ error: 'tenant not found' })
    const list = await repos.tenantIntegrations.listByTenant(req.params.id)
    return res.json({
      integrations: list.map((ti) => ({ ...ti, config: maskConfig(ti.config) })),
    })
  }
)

// ─── PUT /admin/tenants/:id/integrations/:kind ───────────────────────────── //
adminRouter.put(
  '/tenants/:id/integrations/:kind',
  requirePermission('manage_integrations'),
  async (req: Request, res: Response) => {
    const { id, kind } = req.params
    if (!isValidKind(kind)) {
      return res.status(400).json({ error: `invalid kind: ${kind}. Valid: smtp, storage, aml, sms` })
    }
    const tenant = await repos.tenants.getById(id)
    if (!tenant) return res.status(404).json({ error: 'tenant not found' })

    const { config, enabled } = req.body as { config?: Record<string, unknown>; enabled?: boolean }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({ error: 'body.config must be a plain object' })
    }
    // Server-side secret merge: read existing decrypted config and overlay incoming
    // fields. Skip any incoming value of "***" (masked — user didn't change it).
    // This prevents toggling `enabled` from silently wiping encrypted credentials.
    let mergedConfig: Record<string, unknown> = {}
    try {
      const existing = await repos.tenantIntegrations.getByKind(id, kind)
      if (existing && existing.enabled) {
        mergedConfig = { ...existing.config }  // base = existing decrypted config
      }
    } catch {
      // If existing-row read fails, proceed with incoming fields only
    }
    for (const [k, v] of Object.entries(config)) {
      if (v !== '***') mergedConfig[k] = v  // overlay non-masked incoming fields
    }

    // actor pattern: identical to all other admin routes in this file
    const actor = `admin:${req.adminOperator?.operatorId ?? '?'}`
    try {
      const ti = await repos.tenantIntegrations.upsert(id, kind, mergedConfig, enabled !== false, actor)
      return res.json({ integration: { ...ti, config: maskConfig(ti.config) } })
    } catch (e) {
      // encryptSecret throws if TEKO_SECRETS_KEY missing
      console.error(`[admin] PUT integrations failed: ${(e as Error).message}`)
      return res.status(500).json({ error: 'failed to save integration — TEKO_SECRETS_KEY may not be configured' })
    }
  }
)

// ─── DELETE /admin/tenants/:id/integrations/:kind ────────────────────────── //
adminRouter.delete(
  '/tenants/:id/integrations/:kind',
  requirePermission('manage_integrations'),
  async (req: Request, res: Response) => {
    const { id, kind } = req.params
    if (!isValidKind(kind)) {
      return res.status(400).json({ error: `invalid kind: ${kind}` })
    }
    const deleted = await repos.tenantIntegrations.remove(id, kind)
    if (!deleted) return res.status(404).json({ error: 'integration not found' })
    return res.json({ ok: true })
  }
)
```

### Step 4 — Run tests (green)

`npm test -- --run` → ≥ baseline. `tsc --noEmit` clean.

**Deliverable gate:** Three routes registered. TypeScript compiles. `manage_integrations` in
Permission type. Owner/operator role grants it in rbac.ts.

---

## T7 — UI admin de integraciones por tenant (`TenantIntegrations`)

**What this task does:** Add a new view at `/integrations/providers` showing a tab per kind
(SMTP, Storage, AML, SMS-próximamente) scoped to the selected tenant. Add API client methods.
Add route and nav entry under Integraciones.

### Files

- `admin/src/teko/client.ts` (EDIT — add `getIntegrations`, `putIntegration`, `deleteIntegration`)
- `admin/src/teko/types.ts` (EDIT — add `TenantIntegration`, `IntegrationKind`)
- `admin/src/views/teko/TenantIntegrations/TenantIntegrations.tsx` (NEW)
- `admin/src/views/teko/TenantIntegrations/index.ts` (NEW)
- `admin/src/configs/routes.config/integrationsRoute.ts` (EDIT — add providers route)
- `admin/src/configs/navigation.config/teko.navigation.config.ts` (EDIT — add nav item)

### Step 1 — Edit `admin/src/teko/types.ts`

Add:
```typescript
export type IntegrationKind = 'smtp' | 'storage' | 'aml' | 'sms'

export interface TenantIntegration {
  id: string
  tenantId: string
  kind: IntegrationKind
  config: Record<string, unknown>  // secret fields masked as "***" from API
  enabled: boolean
  updatedBy: string
  createdAt: string
  updatedAt: string
}
```

### Step 2 — Edit `admin/src/teko/client.ts`

`tekoApi` is a **plain object literal** (`export const tekoApi = { ... }`). Every method calls
the module-level `request<T>()` function directly — there is no `this.request`. Add these three
methods inside the `tekoApi` object (e.g. after the webhook section), following the existing
pattern exactly:

```typescript
    // ---- Integraciones por tenant (Fase 2) ----
    getIntegrations(tenantId: string) {
        return request<{ integrations: TenantIntegration[] }>(
            'GET',
            `/tenants/${tenantId}/integrations`,
        )
    },
    putIntegration(
        tenantId: string,
        kind: IntegrationKind,
        config: Record<string, unknown>,
        enabled: boolean,
    ) {
        return request<{ integration: TenantIntegration }>(
            'PUT',
            `/tenants/${tenantId}/integrations/${kind}`,
            { config, enabled },
        )
    },
    deleteIntegration(tenantId: string, kind: IntegrationKind) {
        return request<{ ok: boolean }>(
            'DELETE',
            `/tenants/${tenantId}/integrations/${kind}`,
        )
    },
```

Import `TenantIntegration` and `IntegrationKind` from `./types` at the top of the file.

### Step 3 — Create view component

```typescript
// admin/src/views/teko/TenantIntegrations/TenantIntegrations.tsx
import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Alert from '@/components/ui/Alert'
import Skeleton from '@/components/ui/Skeleton'
import Tabs from '@/components/ui/Tabs'
import Switcher from '@/components/ui/Switcher'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import type { TenantIntegration, IntegrationKind } from '@/teko/types'

// Ecme Tabs: TabNav = individual tab button, TabList = tab row container, TabContent = panel
// Verified from admin/src/views/ui-components/navigation/Tabs/Pill.tsx
const { TabNav, TabList, TabContent } = Tabs

// Configuración de campos por kind
const SMTP_FIELDS: Array<{ key: string; label: string; type: string; placeholder: string }> = [
  { key: 'host', label: 'Host SMTP', type: 'text', placeholder: 'smtp.office365.com' },
  { key: 'port', label: 'Puerto', type: 'number', placeholder: '587' },
  { key: 'user', label: 'Usuario', type: 'text', placeholder: 'user@empresa.com' },
  { key: 'password', label: 'Contraseña', type: 'password', placeholder: '(ocultado si configurado)' },
  { key: 'fromEmail', label: 'From Email', type: 'text', placeholder: 'noreply@empresa.com' },
  { key: 'fromName', label: 'From Name', type: 'text', placeholder: 'Teko Verify' },
]

const AML_FIELDS: Array<{ key: string; label: string; type: string; placeholder: string }> = [
  { key: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://api.sumsub.com' },
  { key: 'providerName', label: 'Nombre del proveedor', type: 'text', placeholder: 'sumsub' },
  { key: 'apiKey', label: 'API Key', type: 'password', placeholder: '(ocultado si configurado)' },
  { key: 'threshold', label: 'Umbral (0–1)', type: 'number', placeholder: '0.8' },
]

const STORAGE_FIELDS: Array<{ key: string; label: string; type: string; placeholder: string }> = [
  { key: 'baseDir', label: 'Directorio base', type: 'text', placeholder: '/mnt/nas/teko' },
]

function kindFields(kind: IntegrationKind) {
  if (kind === 'smtp') return SMTP_FIELDS
  if (kind === 'aml') return AML_FIELDS
  if (kind === 'storage') return STORAGE_FIELDS
  return []
}

interface IntegrationFormProps {
  tenantId: string
  kind: IntegrationKind
  existing: TenantIntegration | null
  onSaved: (ti: TenantIntegration) => void
}

function IntegrationForm({ tenantId, kind, existing, onSaved }: IntegrationFormProps) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fields = kindFields(kind)

  useEffect(() => {
    if (!existing) { setForm({}); return }
    const initial: Record<string, string> = {}
    for (const f of fields) {
      const val = existing.config[f.key]
      initial[f.key] = typeof val === 'string' ? val : (typeof val === 'number' ? String(val) : '')
    }
    setEnabled(existing.enabled)
    setForm(initial)
  }, [existing])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const config: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(form)) {
        if (v !== '' && v !== '***') config[k] = v
      }
      const { integration } = await tekoApi.putIntegration(tenantId, kind, config, enabled)
      onSaved(integration)
      setSaved(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
            {f.label}
          </label>
          <Input
            type={f.type}
            value={form[f.key] ?? ''}
            placeholder={f.placeholder}
            onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
          />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Switcher checked={enabled} onChange={setEnabled} />
        <span className="text-sm text-gray-600 dark:text-gray-300">
          {enabled ? 'Habilitado' : 'Deshabilitado'}
        </span>
      </div>
      {error && <Alert type="danger" showIcon>{error}</Alert>}
      {saved && <Alert type="success" showIcon>Integración guardada correctamente.</Alert>}
      <div className="flex gap-2">
        <Button variant="solid" type="submit" loading={busy}>Guardar</Button>
      </div>
    </form>
  )
}

const TenantIntegrations = () => {
  const { currentId, loading: tLoading } = useTenant()
  const [integrations, setIntegrations] = useState<TenantIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>('smtp')

  useEffect(() => {
    if (!currentId) return
    setLoading(true)
    setError(null)
    tekoApi
      .getIntegrations(currentId)
      .then(({ integrations: list }) => setIntegrations(list))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [currentId])

  function getIntegration(kind: IntegrationKind): TenantIntegration | null {
    return integrations.find((i) => i.kind === kind) ?? null
  }

  function handleSaved(ti: TenantIntegration) {
    setIntegrations((prev) => {
      const without = prev.filter((i) => i.kind !== ti.kind)
      return [...without, ti]
    })
  }

  if (tLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!currentId) {
    return <Alert type="warning" showIcon>Seleccioná un tenant para ver sus integraciones.</Alert>
  }

  return (
    <div>
      <div className="mb-6">
        <h3 className="mb-1">Proveedores de integración</h3>
        <p className="text-gray-500">
          Configurá SMTP, almacenamiento y AML por tenant. Si no se configura, se usa el proveedor global del servidor.
        </p>
      </div>
      {error && <Alert type="danger" showIcon className="mb-4">{error}</Alert>}
      <Card>
        <Tabs defaultValue="smtp" onChange={setActiveTab}>
          <TabList>
            <TabNav value="smtp">Email (SMTP)</TabNav>
            <TabNav value="storage">Almacenamiento</TabNav>
            <TabNav value="aml">AML / PEP</TabNav>
            <TabNav value="sms">SMS</TabNav>
          </TabList>
          <div className="pt-6">
            <TabContent value="smtp">
              <IntegrationForm
                tenantId={currentId}
                kind="smtp"
                existing={getIntegration('smtp')}
                onSaved={handleSaved}
              />
            </TabContent>
            <TabContent value="storage">
              <IntegrationForm
                tenantId={currentId}
                kind="storage"
                existing={getIntegration('storage')}
                onSaved={handleSaved}
              />
            </TabContent>
            <TabContent value="aml">
              <IntegrationForm
                tenantId={currentId}
                kind="aml"
                existing={getIntegration('aml')}
                onSaved={handleSaved}
              />
            </TabContent>
            <TabContent value="sms">
              <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-8 text-center">
                <p className="text-gray-400 font-medium">SMS — Próximamente</p>
                <p className="text-sm text-gray-400 mt-1">
                  La tabla soporta la configuración del proveedor SMS, pero el envío real de mensajes se implementa en una fase futura.
                </p>
              </div>
            </TabContent>
          </div>
        </Tabs>
      </Card>
    </div>
  )
}

export default TenantIntegrations
```

### Step 4 — Create `index.ts`

```typescript
// admin/src/views/teko/TenantIntegrations/index.ts
export { default } from './TenantIntegrations'
```

### Step 5 — Add route to `integrationsRoute.ts`

```typescript
{
  key: 'integrations.providers',
  path: '/integrations/providers',
  component: lazy(() => import('@/views/teko/TenantIntegrations')),
  authority: [],
  meta: { pageContainerType: 'contained' },
},
```

### Step 6 — Add nav entry to `teko.navigation.config.ts`

Under the `Integraciones` TITLE section, add a new `NAV_ITEM_TYPE_ITEM`:

```typescript
{
  key: 'integrations.providers',
  path: '/integrations/providers',
  title: 'Proveedores',
  translateKey: 'nav.integrations.providers',
  icon: 'plugZap',
  type: NAV_ITEM_TYPE_ITEM,
  authority: [],
  subMenu: [],
},
```

### Step 7 — Build gate

`cd admin && npm run build` → must succeed with no new errors.

`cd admin && npx tsc --noEmit 2>&1 | wc -l` → ≤ baseline line count.

**Deliverable gate:** Admin builds. Route `/integrations/providers` renders. Tenant selector
drives the integrations displayed. SMTP/Storage/AML forms save via API. SMS tab shows "Próximamente".

---

## Self-Review

### Coverage vs. spec §3.2 Fase 2

| Spec requirement | Covered in |
|---|---|
| `tenant_integrations(tenant_id, kind ENUM, config JSONB CIFRADO, enabled)` | T1 |
| Cifrado de secretos — decisión concreta (AES-256-GCM, master key, fail-closed) | T2 |
| Repo con get/set/list, cifrado en escritura, descifrado en lectura | T3 |
| `resolveMailer(tenantId)` con fallback al global SMTP de env | T4 |
| `resolveEvidenceDir(tenantId)` con fallback a `TEKO_EVIDENCE_DIR` | T4/T5 |
| `resolveAmlConfig(tenantId)` con fallback a `resolveAmlProvider()` | T4/T5 |
| UI admin de integraciones por tenant (sección Integraciones Fase 1) | T7 |
| SMS: tabla lista, no se implementa el envío | T5, T7 |
| Secretos enmascarados en respuestas de API | T6 |

### Decisiones de diseño

**Cifrado:**
- AES-256-GCM, `node:crypto` nativo (sin dependencias nuevas).
- Master key `TEKO_SECRETS_KEY` (64 hex chars = 32 bytes) desde env.
- Blob: `"gcm$<ivHex>$<authTagHex>$<cipherHex>"`, IV aleatorio por cifrado.
- Toda la config JSON se cifra como unidad (`encryptConfig` → `{ enc: blob }` como JSONB).
- `encryptSecret` **lanza** si key falta (write path falla cerrado).
- `decryptSecret` **devuelve null** si key falta o decryption falla (read path fail-closed → usa global).

**Fallback cascade:**
Cada resolver hace un SELECT por `(tenant_id, kind, enabled=true)`. Si la fila no existe,
está disabled, decrypt falla, o el config no tiene los campos requeridos, cae al global
(`loadSmtpConfig()` / `process.env.TEKO_EVIDENCE_DIR` / `resolveAmlProvider()`). Nunca crashea.

**SMS:**
Tabla y repo soportan `'sms'` como kind. API acepta GET/PUT/DELETE para `sms`. No existe
`resolveSmsProvider()`. UI muestra pestaña "Próximamente" con texto explicativo.

**Permission:**
`'manage_integrations'` añadida al tipo `Permission` (no se reutiliza `manage_tenants`) para
mantener granularidad. Asignada a roles `owner` y `operator`.

**Compatibilidad:**
Las funciones globales `sendVerificationEmail`, `sendTemplatedEmail`, `evidenceStore`,
`resolveAmlProvider` no se modifican. Los resolvers son funciones nuevas adicionales.
No hay call-sites migrados en Fase 2 — la migración de call-sites (pasar la SmtpConfig
resuelta a `sendTemplatedEmail`) es un task de seguimiento explícito en Fase 2.1.

### No placeholders

Toda la implementación es TypeScript completo y compilable. Ningún `// TODO` queda sin implementar
en esta fase. Los únicos "diferidos" son explícitamente la lógica de envío SMS y la migración
de call-sites, ambos documentados.

### Baseline de tests

- Migración: idempotente, sin tests adicionales de DB (se verifica manualmente).
- T2: 11 tests de cifrado.
- T3: 6 tests de repo con mock-Executor.
- T4: 9 tests de resolvers con mocks.
- T6/T7: el tipo `Permission` compila sin errores; el build del admin pasa.
- Total: ~26 tests nuevos. Baseline ~379 + los nuevos ≥ 405 passing.
