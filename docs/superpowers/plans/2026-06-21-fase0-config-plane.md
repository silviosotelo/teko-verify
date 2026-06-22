# Config Plane — Fase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundations of a versioned, hierarchical Config Plane (`config_values` + `config_audit` + `resolveConfig` cascade workflow→app→tenant→system) and wire the engine's decision thresholds to read from it, with a seed of the platform defaults and admin GET/PUT endpoints — all non-breaking.

**Architecture:** A single `config_values` table holds versioned, scoped config rows (one row per `(scope_type, scope_id, namespace, key, version)`). A pure cascade function `resolveConfig(namespace, key, scope)` returns the most-specific live value (workflow→app→tenant→system) or `undefined`. The engine keeps `processSession`'s signature unchanged: the tenant policy is *enriched* with plane-resolved thresholds (fallback to `src/config.ts` constants) before the pipeline runs, so precedence becomes `workflow.definition ?? plane ?? config.ts`. Every `set()` writes a `config_audit` before/after row in the same call, so config changes are unskippably audited and reversible.

**Tech Stack:** TypeScript (strict), Node, PostgreSQL (`pg`), Express (admin API), Vitest (mock-`Executor` repo tests). Admin UI = Ecme (React + Vite) under `admin/`.

## Global Constraints

- **No romper lo que funciona**: cada cambio envuelve/centraliza lo existente con compatibilidad. `workflows.definition` sigue siendo la cara de "config de verificación"; el plane es el backend. Migración incremental con seed de defaults. (spec §5)
- **Una fuente de verdad**: nada de config nueva fuera del Config Plane. (spec §5)
- **Data sobre código**: lo que un tenant deba ajustar es data, no constantes. (spec §5)
- **Fail-closed se preserva**: la configurabilidad NO relaja el fail-closed del motor; los defaults del system son seguros; un error nunca produce un umbral más laxo ni un `verified` espurio. (spec §5 + `src/config.ts` header)
- **Auditable y reversible**: todo cambio de config versionado y con audit log. Rollback = apuntar a versión previa. (spec §5/§3.1)
- **TypeScript estricto; 100% on-prem; todo dato scopeado por tenant_id.** (`src/config.ts` header)
- **Estado del repo hoy**: el backend typechequea limpio (`npx tsc --noEmit` exit 0). La suite tiene **351 pass / 1 fail conocido y pre-existente** (`consentShouldTransition` en `src/api/capture.test.ts`) — NO es regresión y NO se arregla en esta fase. Los `npx vitest run <archivo>` por-archivo de este plan no tocan ese test; un chequeo de suite completa debe esperar 351 pass / 1 fail, no 352.
- **Próxima migración = `0020`** (la última es `migrations/0019_perf_indexes.sql`).
- **Patrón de repos**: interfaces `XxxRow` (snake_case), `mapXxx(row)` → tipo camelCase, funciones con `exec: Executor = pool`, queries parametrizadas, scope por `tenantId`. Registro en `src/db/repos/index.ts` (doble: `export * as` + objeto `repos`).

---

## File Structure

**Created:**
- `migrations/0020_config_plane.sql` — tablas `config_values` + `config_audit` + seed de defaults del system (espejo de `src/config.ts`).
- `src/db/repos/configValues.ts` — repo: tipos `ConfigScope`/`ConfigValue`, `getCurrent`, `set` (versionado + audit en la misma llamada), `listByScope`, y la función pura de cascada `resolveConfig`.
- `src/db/repos/configValues.test.ts` — tests del repo + cascada (herencia/override/fallback).
- `src/lib/configThresholds.ts` — `resolveThresholds` (cascada + fallback `config.ts`, fail-closed) y `withResolvedThresholds` (enriquece la policy antes del pipeline).
- `src/lib/configThresholds.test.ts` — tests de fallback, precedencia y fail-closed.
- `src/admin/configValidation.ts` — validadores puros del endpoint (scope/namespace/key/value).
- `src/admin/configValidation.test.ts` — tests de los validadores.
- `admin/src/views/teko/Configuracion/Configuracion.tsx` + `index.tsx` — vista mínima "Configuración" (lee/escribe thresholds por scope).

**Modified:**
- `src/db/repos/index.ts` — registra `configValues`.
- `src/admin/router.ts` — endpoints GET/PUT de config por scope.
- `src/api/capture.ts` — enriquece la policy con thresholds del plane en los 3 call-sites del pipeline.
- `admin/src/teko/client.ts` — métodos `getConfig` / `setConfig`.
- `admin/src/configs/routes.config/tekoRoute.ts` + `admin/src/configs/navigation.config/teko.navigation.config.ts` — registra la vista.

**Design decisions (locked):**
1. **Seed por SQL en la migración** (no seeder TS), siguiendo el precedente exacto de `0018_billing.sql` (catálogo global con `ON CONFLICT DO NOTHING`). Evita capturar valores env-resueltos y honra el spec ("se siembran por migración"). Los números se comentan como espejo de `src/config.ts`.
2. **Auditoría dentro de `set()`**: la fila `config_audit(before, after, changed_by, version)` se inserta en la misma llamada que crea la versión nueva — la auditoría es ininterrumpible (no depende de que el endpoint la recuerde). Mismo `exec` (patrón de `workflows.createVersion`: SELECT MAX → INSERT, sin transacción explícita interna).
3. **`scope_id` polimórfico sin FK** (es `tenant_id` | `app_id` | `workflow_id` según `scope_type`): no se puede FK a 3 tablas. `scope_id NULL ⇔ scope_type='system'` se fuerza con un CHECK. **Integridad cross-tenant**: en Fase 0 los endpoints sólo aceptan scope `system` (owner-only, via `manage_tenants`) y `tenant` (anclado al tenant de la ruta); `app`/`workflow` se difieren hasta tener el ownership check (`repos.apps.resolveAppId` / `repos.workflows.getById`) — así ningún operador escribe sobre el recurso de otro tenant.
4. **Unicidad con `scope_id` NULL**: un UNIQUE normal trata los NULL como distintos (permitiría duplicar filas system). Se usa un índice único sobre `COALESCE(scope_id, sentinel)` — fix cross-version de Postgres.
5. **Firma `resolveConfig(namespace, key, scope)`** con retorno `Promise<T | undefined>` (el `?? CONSTANTE` del caller es lo load-bearing). El spec escribe `resolveConfig(key, {...})`; acá `key` se desdobla en `(namespace, key)` igual que la tabla.
6. **Cache en proceso: DIFERIDA** (ver Self-Review). Para 1k–10k/día no hace falta; la cache compartida con invalidación es Fase 5.

---

### Task 1: Migration 0020 — `config_values` + `config_audit` + system seed

**Files:**
- Create: `migrations/0020_config_plane.sql`
- Test: (verificación por aplicación de migración — paso 2/4 abajo)

**Interfaces:**
- Consumes: nada (primera task).
- Produces: tablas `config_values(id, scope_type, scope_id, namespace, key, value jsonb, version, updated_by, updated_at)` y `config_audit(id, scope_type, scope_id, namespace, key, before jsonb, after jsonb, version, changed_by, created_at)`; índice único `uq_config_values_scope_ns_key_ver`; 6 filas seed en scope `system`/namespace `thresholds`: `matchCosine=0.40`, `livenessScore=0.60`, `qualityGlassesPct=0.50`, `amlMatch=0.85`, `amlNameOnlyMargin=0.07`, `faceSearch=0.55`.

- [ ] **Step 1: Write the migration (this is the failing-state setup)**

Create `migrations/0020_config_plane.sql`:

```sql
-- 0020_config_plane.sql
-- =============================================================================
-- Config Plane — Fase 0. Capa de configuración VERSIONADA y JERÁRQUICA que
-- centraliza lo que hoy está disperso (env de config.ts, JSONB por tenant).
--
--   config_values — una fila por (scope, namespace, key, version). La versión
--                   vigente de una clave = MAX(version). La cascada de resolución
--                   (workflow→app→tenant→system) la implementa resolveConfig() en
--                   código (no en SQL).
--   config_audit  — traza append-only quién/cuándo/antes/después de cada cambio.
--
-- scope_id es POLIMÓRFICO (tenant_id | app_id | workflow_id según scope_type) y por
-- eso NO lleva FK (no se puede referenciar 3 tablas). scope_id NULL ⇔ system.
--
-- Idempotente (CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING), igual que
-- 0018_billing. NO toca tablas/comportamiento existentes: SOLO agrega.
-- =============================================================================

CREATE TABLE IF NOT EXISTS config_values (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  text        NOT NULL CHECK (scope_type IN ('system','tenant','app','workflow')),
  scope_id    uuid,                                   -- NULL para system
  namespace   text        NOT NULL,                   -- 'thresholds'|'providers'|'rules'|'ui'|'compliance'|'pipeline'|'documents'
  key         text        NOT NULL,
  value       jsonb       NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  updated_by  text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT config_values_scope_null CHECK (
    (scope_type = 'system' AND scope_id IS NULL) OR
    (scope_type <> 'system' AND scope_id IS NOT NULL)
  )
);

-- Los NULL son DISTINTOS en un UNIQUE normal → el system (scope_id NULL) podría
-- duplicar filas. Se cierra el hueco con un índice único sobre COALESCE(scope_id, sentinel).
CREATE UNIQUE INDEX IF NOT EXISTS uq_config_values_scope_ns_key_ver
  ON config_values (
    scope_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    namespace, key, version
  );

-- Lookup de la versión vigente (resolveConfig): scope+ns+key, mayor version primero.
CREATE INDEX IF NOT EXISTS idx_config_values_lookup
  ON config_values (scope_type, scope_id, namespace, key, version DESC);

CREATE TABLE IF NOT EXISTS config_audit (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  text        NOT NULL,
  scope_id    uuid,
  namespace   text        NOT NULL,
  key         text        NOT NULL,
  before      jsonb,                                  -- NULL = no existía (primer set)
  after       jsonb       NOT NULL,
  version     integer     NOT NULL,                   -- versión NUEVA creada
  changed_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_config_audit_scope
  ON config_audit (scope_type, scope_id, namespace, key, created_at DESC);

-- Seed de defaults del SYSTEM scope. ESPEJO de src/config.ts (mantener en sync):
--   MATCH_THRESHOLD=0.40 · LIVENESS_THRESHOLD=0.60 · GLASSES_MAX=0.50
--   AML_MATCH_THRESHOLD=0.85 · AML_NAME_ONLY_MARGIN=0.07 · FACE_SEARCH_THRESHOLD=0.55
-- ON CONFLICT DO NOTHING → re-correr NO pisa ediciones posteriores del operador.
INSERT INTO config_values (scope_type, scope_id, namespace, key, value, version, updated_by)
VALUES
  ('system', NULL, 'thresholds', 'matchCosine',       '0.40'::jsonb, 1, 'system:seed'),
  ('system', NULL, 'thresholds', 'livenessScore',     '0.60'::jsonb, 1, 'system:seed'),
  ('system', NULL, 'thresholds', 'qualityGlassesPct', '0.50'::jsonb, 1, 'system:seed'),
  ('system', NULL, 'thresholds', 'amlMatch',          '0.85'::jsonb, 1, 'system:seed'),
  ('system', NULL, 'thresholds', 'amlNameOnlyMargin', '0.07'::jsonb, 1, 'system:seed'),
  ('system', NULL, 'thresholds', 'faceSearch',        '0.55'::jsonb, 1, 'system:seed')
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Run the migration to verify it applies cleanly (and is idempotent)**

Build first (the runner reads from `dist/`), then migrate twice:

Run: `npx tsc --noEmit && npm run build && node dist/db/migrate.js && node dist/db/migrate.js`
Expected: primera corrida imprime `[migrate] aplicada: 0020_config_plane.sql`; la segunda imprime `[migrate] sin migraciones pendientes.` (idempotente, sin error). `tsc --noEmit` exit 0.

> If a local Postgres isn't available to the implementer, defer the live run to the end of the task and instead validate SQL by eye against the `0018`/`0015` patterns; the repo tests in later tasks do not require the DB.

- [ ] **Step 3: Verify the seed and constraints**

Run:
```bash
node -e "const{pool}=require('./dist/db/pool');pool.query(\"select namespace,key,value from config_values where scope_type='system' order by key\").then(r=>{console.log(r.rows);return pool.end()})"
```
Expected: 6 filas (amlMatch, amlNameOnlyMargin, faceSearch, livenessScore, matchCosine, qualityGlassesPct) con sus valores.

- [ ] **Step 4: Commit**

```bash
git add migrations/0020_config_plane.sql
git commit -m "feat(config-plane): add 0020 migration — config_values + config_audit + system seed"
```

---

### Task 2: `configValues` repo — get / set (versionado + audit) / listByScope

**Files:**
- Create: `src/db/repos/configValues.ts`
- Create: `src/db/repos/configValues.test.ts`
- Modify: `src/db/repos/index.ts`

**Interfaces:**
- Consumes: tabla `config_values` + `config_audit` (Task 1); `Executor` de `../executor`; `pool` de `../pool`; `iso` de `./mapping`.
- Produces:
  - `type ConfigScopeType = "system" | "tenant" | "app" | "workflow"`
  - `interface ConfigScope { tenantId?: string | null; appId?: string | null; workflowId?: string | null }`
  - `interface ConfigValue { id: string; scopeType: ConfigScopeType; scopeId: string | null; namespace: string; key: string; value: unknown; version: number; updatedBy: string; updatedAt: string }`
  - `getCurrent(scopeType: ConfigScopeType, scopeId: string | null, namespace: string, key: string, exec?: Executor): Promise<ConfigValue | null>`
  - `set(input: { scopeType: ConfigScopeType; scopeId: string | null; namespace: string; key: string; value: unknown; actor: string }, exec?: Executor): Promise<ConfigValue>`
  - `listByScope(scopeType: ConfigScopeType, scopeId: string | null, exec?: Executor): Promise<ConfigValue[]>`

- [ ] **Step 1: Write the failing test**

Create `src/db/repos/configValues.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Executor } from "../executor";
import * as configValues from "./configValues";

/**
 * Mock de Executor (mismo patrón que billing.test.ts): responde según el SQL
 * normalizado y captura las queries emitidas para verificar el versionado + audit.
 */
function mockExec(
  handlers: Array<{ match: RegExp; rows: unknown[]; rowCount?: number }>,
  sink?: string[]
): Executor {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string): Promise<any> {
      const norm = text.replace(/\s+/g, " ").trim();
      if (sink) sink.push(norm);
      for (const h of handlers) {
        if (h.match.test(norm)) return { rows: h.rows, rowCount: h.rowCount ?? h.rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const NOW = new Date("2026-06-21T00:00:00Z");

describe("configValues.getCurrent", () => {
  it("mapea snake→camel y devuelve la fila vigente", async () => {
    const exec = mockExec([
      {
        match: /SELECT \* FROM config_values WHERE scope_type = \$1/i,
        rows: [{
          id: "c1", scope_type: "system", scope_id: null, namespace: "thresholds",
          key: "matchCosine", value: 0.4, version: 1, updated_by: "system:seed", updated_at: NOW,
        }],
      },
    ]);
    const row = await configValues.getCurrent("system", null, "thresholds", "matchCosine", exec);
    expect(row).toMatchObject({ scopeType: "system", scopeId: null, key: "matchCosine", value: 0.4, version: 1 });
    expect(row!.updatedAt).toBe(NOW.toISOString());
  });

  it("devuelve null cuando no hay fila", async () => {
    const exec = mockExec([{ match: /SELECT \* FROM config_values/i, rows: [] }]);
    expect(await configValues.getCurrent("tenant", "t1", "thresholds", "matchCosine", exec)).toBeNull();
  });
});

describe("configValues.set", () => {
  it("crea version = max+1 e inserta config_audit con before/after", async () => {
    const sink: string[] = [];
    const exec = mockExec([
      { match: /SELECT MAX\(version\) AS v FROM config_values/i, rows: [{ v: 2 }] },
      { match: /SELECT value FROM config_values WHERE/i, rows: [{ value: 0.4 }] },
      {
        match: /INSERT INTO config_values/i,
        rows: [{
          id: "c9", scope_type: "tenant", scope_id: "t1", namespace: "thresholds",
          key: "matchCosine", value: 0.5, version: 3, updated_by: "admin:op1", updated_at: NOW,
        }],
      },
    ], sink);

    const out = await configValues.set(
      { scopeType: "tenant", scopeId: "t1", namespace: "thresholds", key: "matchCosine", value: 0.5, actor: "admin:op1" },
      exec
    );

    expect(out).toMatchObject({ scopeType: "tenant", scopeId: "t1", value: 0.5, version: 3 });
    // Auditoría ininterrumpible: set() SIEMPRE inserta en config_audit.
    expect(sink.some((q) => /INSERT INTO config_audit/i.test(q))).toBe(true);
  });

  it("primera versión (max null) → version 1, before null", async () => {
    const exec = mockExec([
      { match: /SELECT MAX\(version\) AS v FROM config_values/i, rows: [{ v: null }] },
      { match: /SELECT value FROM config_values WHERE/i, rows: [] },
      {
        match: /INSERT INTO config_values/i,
        rows: [{
          id: "c1", scope_type: "app", scope_id: "a1", namespace: "thresholds",
          key: "livenessScore", value: 0.7, version: 1, updated_by: "admin:op1", updated_at: NOW,
        }],
      },
    ]);
    const out = await configValues.set(
      { scopeType: "app", scopeId: "a1", namespace: "thresholds", key: "livenessScore", value: 0.7, actor: "admin:op1" },
      exec
    );
    expect(out.version).toBe(1);
  });
});

describe("configValues.listByScope", () => {
  it("lista la versión vigente por (namespace,key) del scope", async () => {
    const exec = mockExec([
      {
        match: /FROM config_values .* DISTINCT ON|SELECT DISTINCT ON .* FROM config_values/i,
        rows: [
          { id: "c1", scope_type: "tenant", scope_id: "t1", namespace: "thresholds", key: "matchCosine", value: 0.42, version: 2, updated_by: "admin:op1", updated_at: NOW },
        ],
      },
    ]);
    const rows = await configValues.listByScope("tenant", "t1", exec);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "matchCosine", value: 0.42, version: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repos/configValues.test.ts`
Expected: FAIL — `Cannot find module './configValues'` (o "is not a function").

- [ ] **Step 3: Write minimal implementation**

Create `src/db/repos/configValues.ts`:

```ts
/**
 * Config Plane (Fase 0) — repo de config_values + cascada de resolución.
 *
 * Una fila por (scope, namespace, key, version). La versión VIGENTE de una clave =
 * MAX(version). Editar = nueva versión (insert version+1), igual que workflows.
 * `set()` escribe ADEMÁS una fila en config_audit (antes/después) en la MISMA
 * llamada: la auditoría es ininterrumpible. scope_id es polimórfico (tenant|app|
 * workflow id) y NULL ⇔ system.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";

export type ConfigScopeType = "system" | "tenant" | "app" | "workflow";

/** Coordenadas para resolver por cascada. Cada id ausente = ese nivel no aplica. */
export interface ConfigScope {
  tenantId?: string | null;
  appId?: string | null;
  workflowId?: string | null;
}

export interface ConfigValue {
  id: string;
  scopeType: ConfigScopeType;
  scopeId: string | null;
  namespace: string;
  key: string;
  value: unknown;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

interface ConfigRow {
  id: string;
  scope_type: ConfigScopeType;
  scope_id: string | null;
  namespace: string;
  key: string;
  value: unknown;
  version: number;
  updated_by: string;
  updated_at: Date;
}

function mapConfig(row: ConfigRow): ConfigValue {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    namespace: row.namespace,
    key: row.key,
    value: row.value,
    version: row.version,
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at),
  };
}

/** Filtro de scope que trata scope_id NULL (system) con IS NULL. */
function scopeWhere(scopeId: string | null): { clause: string; param: string[] } {
  return scopeId === null
    ? { clause: "scope_id IS NULL", param: [] }
    : { clause: "scope_id = $2", param: [scopeId] };
}

/** Versión VIGENTE (mayor `version`) de una clave en un scope concreto. */
export async function getCurrent(
  scopeType: ConfigScopeType,
  scopeId: string | null,
  namespace: string,
  key: string,
  exec: Executor = pool
): Promise<ConfigValue | null> {
  const sw = scopeWhere(scopeId);
  // params: $1 scope_type, [$2 scope_id], luego namespace/key.
  const nsIdx = 2 + sw.param.length;
  const keyIdx = nsIdx + 1;
  const res = await exec.query<ConfigRow>(
    `SELECT * FROM config_values
     WHERE scope_type = $1 AND ${sw.clause}
       AND namespace = $${nsIdx} AND key = $${keyIdx}
     ORDER BY version DESC LIMIT 1`,
    [scopeType, ...sw.param, namespace, key]
  );
  return res.rows[0] ? mapConfig(res.rows[0]) : null;
}

export interface SetConfigInput {
  scopeType: ConfigScopeType;
  scopeId: string | null;
  namespace: string;
  key: string;
  value: unknown;
  /** Quién hace el cambio (admin:operatorId | system:seed). Requerido para auditoría. */
  actor: string;
}

/**
 * Crea una nueva VERSIÓN de una clave (version = max+1, o 1 si es nueva) y registra
 * la auditoría (antes/después) en la MISMA llamada. Devuelve la fila creada.
 * Mismo `exec` para los 3 statements (patrón de workflows.createVersion).
 */
export async function set(
  input: SetConfigInput,
  exec: Executor = pool
): Promise<ConfigValue> {
  const sw = scopeWhere(input.scopeId);
  const nsIdx = 2 + sw.param.length;
  const keyIdx = nsIdx + 1;

  const maxRes = await exec.query<{ v: number | null }>(
    `SELECT MAX(version) AS v FROM config_values
     WHERE scope_type = $1 AND ${sw.clause} AND namespace = $${nsIdx} AND key = $${keyIdx}`,
    [input.scopeType, ...sw.param, input.namespace, input.key]
  );
  const nextVersion = (maxRes.rows[0]?.v ?? 0) + 1;

  // `before` = valor vigente actual (NULL si es el primer set de la clave).
  const beforeRes = await exec.query<{ value: unknown }>(
    `SELECT value FROM config_values
     WHERE scope_type = $1 AND ${sw.clause} AND namespace = $${nsIdx} AND key = $${keyIdx}
     ORDER BY version DESC LIMIT 1`,
    [input.scopeType, ...sw.param, input.namespace, input.key]
  );
  const before = beforeRes.rows[0] ? beforeRes.rows[0].value : null;

  const ins = await exec.query<ConfigRow>(
    `INSERT INTO config_values (scope_type, scope_id, namespace, key, value, version, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING *`,
    [
      input.scopeType,
      input.scopeId,
      input.namespace,
      input.key,
      JSON.stringify(input.value),
      nextVersion,
      input.actor,
    ]
  );

  await exec.query(
    `INSERT INTO config_audit (scope_type, scope_id, namespace, key, before, after, version, changed_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      input.scopeType,
      input.scopeId,
      input.namespace,
      input.key,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(input.value),
      nextVersion,
      input.actor,
    ]
  );

  return mapConfig(ins.rows[0]);
}

/** Versión vigente de TODAS las claves de un scope (para la UI de config por scope). */
export async function listByScope(
  scopeType: ConfigScopeType,
  scopeId: string | null,
  exec: Executor = pool
): Promise<ConfigValue[]> {
  const sw = scopeWhere(scopeId);
  const res = await exec.query<ConfigRow>(
    `SELECT DISTINCT ON (namespace, key) *
     FROM config_values
     WHERE scope_type = $1 AND ${sw.clause}
     ORDER BY namespace, key, version DESC`,
    [scopeType, ...sw.param]
  );
  return res.rows.map(mapConfig);
}

const SCOPE_PRECEDENCE: Array<{
  type: ConfigScopeType;
  id: (s: ConfigScope) => string | null | undefined;
}> = [
  { type: "workflow", id: (s) => s.workflowId },
  { type: "app", id: (s) => s.appId },
  { type: "tenant", id: (s) => s.tenantId },
  { type: "system", id: () => null },
];

/**
 * Cascada de resolución: devuelve el valor de la fila MÁS ESPECÍFICA vigente
 * (workflow→app→tenant→system) para (namespace,key), o `undefined` si no hay
 * ninguna. El caller hace `?? CONSTANTE` para el fallback a config.ts.
 * Nota: el spec escribe `resolveConfig(key, scope)`; acá `key` se desdobla en
 * (namespace, key) igual que la tabla.
 */
export async function resolveConfig<T = unknown>(
  namespace: string,
  key: string,
  scope: ConfigScope,
  exec: Executor = pool
): Promise<T | undefined> {
  for (const level of SCOPE_PRECEDENCE) {
    const scopeId = level.id(scope) ?? null;
    if (level.type !== "system" && !scopeId) continue; // ese nivel no aplica
    const row = await getCurrent(level.type, scopeId, namespace, key, exec);
    if (row) return row.value as T;
  }
  return undefined;
}
```

Then register the repo in `src/db/repos/index.ts` — add the `export * as` line after `usageAlerts` and the matching `import` + object entry:

```ts
export * as configValues from "./configValues";
```
```ts
import * as configValues from "./configValues";
```
```ts
  usageAlerts,
  configValues,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repos/configValues.test.ts && npx tsc --noEmit`
Expected: `Test Files 1 passed`, todos los tests verdes; `tsc --noEmit` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/configValues.ts src/db/repos/configValues.test.ts src/db/repos/index.ts
git commit -m "feat(config-plane): configValues repo (get/set+audit/listByScope) + register"
```

---

### Task 3: `resolveConfig` cascade — herencia / override / fallback tests

> The cascade was implemented in Task 2 (it lives in `configValues.ts` so callers import one module). This task adds the **behavioral** tests for the cascade — the contract every later task relies on. If a reviewer rejects only the cascade semantics, this is the gate.

**Files:**
- Test: `src/db/repos/configValues.test.ts` (extend the file from Task 2)

**Interfaces:**
- Consumes: `resolveConfig<T>(namespace, key, scope, exec)` from Task 2.
- Produces: nothing new (verifies existing contract).

- [ ] **Step 1: Write the failing test (append to `configValues.test.ts`)**

```ts
describe("resolveConfig — cascada workflow→app→tenant→system", () => {
  // Mock que responde getCurrent según el scope_type embebido en params.
  function cascadeExec(present: Record<string, number>): Executor {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async query(text: string, params?: unknown[]): Promise<any> {
        const norm = text.replace(/\s+/g, " ").trim();
        if (!/SELECT \* FROM config_values WHERE scope_type = \$1/i.test(norm)) {
          return { rows: [], rowCount: 0 };
        }
        const scopeType = String(params?.[0]);
        if (scopeType in present) {
          return {
            rows: [{
              id: scopeType, scope_type: scopeType, scope_id: scopeType === "system" ? null : `${scopeType}-id`,
              namespace: "thresholds", key: "matchCosine", value: present[scopeType],
              version: 1, updated_by: "x", updated_at: new Date(),
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };
  }

  const scope = { tenantId: "t1", appId: "a1", workflowId: "w1" };

  it("herencia: sólo system seeded → devuelve el valor system", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({ system: 0.4 }));
    expect(v).toBe(0.4);
  });

  it("override tenant gana sobre system", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({ system: 0.4, tenant: 0.45 }));
    expect(v).toBe(0.45);
  });

  it("override app gana sobre tenant y system", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({ system: 0.4, tenant: 0.45, app: 0.5 }));
    expect(v).toBe(0.5);
  });

  it("override workflow gana sobre todos (más específico)", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({ system: 0.4, tenant: 0.45, app: 0.5, workflow: 0.6 }));
    expect(v).toBe(0.6);
  });

  it("sin ninguna fila → undefined (el caller hace ?? config.ts)", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", scope, cascadeExec({}));
    expect(v).toBeUndefined();
  });

  it("salta niveles sin id: scope sólo-tenant no consulta app/workflow", async () => {
    const v = await configValues.resolveConfig<number>("thresholds", "matchCosine", { tenantId: "t1" }, cascadeExec({ system: 0.4, tenant: 0.45 }));
    expect(v).toBe(0.45);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (then passes — cascade already exists)**

Run: `npx vitest run src/db/repos/configValues.test.ts -t "cascada"`
Expected: si la cascada de Task 2 está bien, PASA directo. Si algún test falla, corregí `resolveConfig`/`SCOPE_PRECEDENCE` en `configValues.ts` hasta verde. (TDD: el bloque nuevo es el gate de la semántica.)

- [ ] **Step 3: (only if red) Fix `resolveConfig`**

No new code expected — the implementation from Task 2 already satisfies these. If `-t "cascada"` is red, the bug is in `SCOPE_PRECEDENCE` order or the `if (level.type !== "system" && !scopeId) continue;` guard; align them with the test above.

- [ ] **Step 4: Run full file green**

Run: `npx vitest run src/db/repos/configValues.test.ts`
Expected: todos los `describe` (getCurrent/set/listByScope/cascada) verdes.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/configValues.test.ts
git commit -m "test(config-plane): cascade inheritance/override/fallback coverage"
```

---

### Task 4: System seed — verify the migration seed feeds `resolveConfig`

> Per design decision #1 the seed is **in the migration** (Task 1), not a TS seeder. This task makes the "defaults del system desde config.ts" claim *testable*: an integration check that the seeded values match the `config.ts` constants and resolve correctly through the cascade for a tenant with no overrides.

**Files:**
- Create: `src/db/repos/configSeed.test.ts`

**Interfaces:**
- Consumes: `resolveConfig` (Task 2); constants `MATCH_THRESHOLD`, `LIVENESS_THRESHOLD`, `GLASSES_MAX` from `../../config`.
- Produces: a regression guard that the seed mirrors `config.ts` (catches drift if someone edits one but not the other).

- [ ] **Step 1: Write the failing test**

Create `src/db/repos/configSeed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Executor } from "../executor";
import { resolveConfig } from "./configValues";
import { MATCH_THRESHOLD, LIVENESS_THRESHOLD, GLASSES_MAX } from "../../config";

/**
 * Mock del estado POST-seed (migración 0020): sólo el system scope tiene filas, con
 * los valores espejo de config.ts. Verifica que un tenant SIN overrides resuelve a
 * los defaults del system, y que el seed NO derivó de config.ts (mismo número).
 */
function seededSystemExec(): Executor {
  const seed: Record<string, number> = {
    matchCosine: 0.4,
    livenessScore: 0.6,
    qualityGlassesPct: 0.5,
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      const norm = text.replace(/\s+/g, " ").trim();
      if (!/SELECT \* FROM config_values WHERE scope_type = \$1/i.test(norm)) return { rows: [], rowCount: 0 };
      const scopeType = String(params?.[0]);
      const key = String(params?.[params.length - 1]);
      if (scopeType === "system" && key in seed) {
        return { rows: [{ id: "s", scope_type: "system", scope_id: null, namespace: "thresholds", key, value: seed[key], version: 1, updated_by: "system:seed", updated_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe("system seed mirrors config.ts", () => {
  const scope = { tenantId: "t-fresh" }; // tenant sin overrides

  it("matchCosine system == MATCH_THRESHOLD default (0.40)", async () => {
    expect(MATCH_THRESHOLD).toBe(0.4); // guard de drift del default de código
    expect(await resolveConfig<number>("thresholds", "matchCosine", scope, seededSystemExec())).toBe(0.4);
  });

  it("livenessScore system == LIVENESS_THRESHOLD default (0.60)", async () => {
    expect(LIVENESS_THRESHOLD).toBe(0.6);
    expect(await resolveConfig<number>("thresholds", "livenessScore", scope, seededSystemExec())).toBe(0.6);
  });

  it("qualityGlassesPct system == GLASSES_MAX default (0.50)", async () => {
    expect(GLASSES_MAX).toBe(0.5);
    expect(await resolveConfig<number>("thresholds", "qualityGlassesPct", scope, seededSystemExec())).toBe(0.5);
  });
});
```

> Note: these `toBe` guards assume the env vars (`MATCH_THRESHOLD`, etc.) are unset in the test runner, so the constants equal their literal defaults. They are. If a future CI sets those envs, replace the literal with the constant on both sides.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repos/configSeed.test.ts`
Expected: PASS si Task 2 está bien (la migración no se ejecuta en el test; el mock representa el estado post-seed). Si algún `toBe` del default falla, es señal de drift real entre la migración (Task 1) y `config.ts` → corregí el seed de `0020` o el comentario.

- [ ] **Step 3: (only if red) Reconcile seed vs config.ts**

If the drift guard fires, edit `migrations/0020_config_plane.sql` seed values to match the `config.ts` literal defaults (or vice versa). No new code.

- [ ] **Step 4: Run green**

Run: `npx vitest run src/db/repos/configSeed.test.ts && npx tsc --noEmit`
Expected: verde, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/configSeed.test.ts
git commit -m "test(config-plane): seed mirrors config.ts defaults via cascade"
```

---

### Task 5: Wire the engine — thresholds from the plane (fallback config.ts), non-breaking

**Files:**
- Create: `src/lib/configThresholds.ts`
- Create: `src/lib/configThresholds.test.ts`
- Modify: `src/api/capture.ts` (3 call-sites: `processSession` ~L697, `computeChecks` ~L771, `finalizeFromChecks` ~L857)

**Interfaces:**
- Consumes: `resolveConfig` + `ConfigScope` (Task 2); `MATCH_THRESHOLD`, `LIVENESS_THRESHOLD`, `GLASSES_MAX` from `../config`; `TenantPolicy` from `../types`.
- Produces:
  - `interface ResolvedThresholds { matchCosine: number; livenessScore: number; qualityGlassesPct: number }`
  - `resolveThresholds(scope: ConfigScope, exec?: Executor): Promise<ResolvedThresholds>` — cascada + fallback config.ts, **fail-closed** (DB error → defaults seguros de config.ts).
  - `withResolvedThresholds(policy: TenantPolicy, scope: ConfigScope, exec?: Executor): Promise<TenantPolicy>` — devuelve una policy con `thresholds` poblados desde el plane SIN pisar overrides ya presentes en la policy.

- [ ] **Step 1: Write the failing test**

Create `src/lib/configThresholds.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Executor } from "../db/executor";
import { resolveThresholds, withResolvedThresholds } from "./configThresholds";
import { MATCH_THRESHOLD, LIVENESS_THRESHOLD, GLASSES_MAX } from "../config";
import type { TenantPolicy } from "../types";

function execWith(values: Partial<Record<string, number>>): Executor {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      const norm = text.replace(/\s+/g, " ").trim();
      if (!/SELECT \* FROM config_values WHERE scope_type = \$1/i.test(norm)) return { rows: [], rowCount: 0 };
      const scopeType = String(params?.[0]);
      const key = String(params?.[params.length - 1]);
      if (scopeType === "system" && key in values) {
        return { rows: [{ id: "s", scope_type: "system", scope_id: null, namespace: "thresholds", key, value: values[key], version: 1, updated_by: "x", updated_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const throwingExec: Executor = {
  async query() { throw new Error("db down"); },
};

const BASE: TenantPolicy = { assuranceRequired: "L2" } as TenantPolicy;

describe("resolveThresholds", () => {
  it("usa el valor del plane cuando existe", async () => {
    const t = await resolveThresholds({ tenantId: "t1" }, execWith({ matchCosine: 0.42, livenessScore: 0.61, qualityGlassesPct: 0.49 }));
    expect(t).toEqual({ matchCosine: 0.42, livenessScore: 0.61, qualityGlassesPct: 0.49 });
  });

  it("fallback a config.ts cuando el plane no tiene la clave", async () => {
    const t = await resolveThresholds({ tenantId: "t1" }, execWith({}));
    expect(t).toEqual({ matchCosine: MATCH_THRESHOLD, livenessScore: LIVENESS_THRESHOLD, qualityGlassesPct: GLASSES_MAX });
  });

  it("FAIL-CLOSED: error de DB → defaults SEGUROS de config.ts (nunca más laxo)", async () => {
    const t = await resolveThresholds({ tenantId: "t1" }, throwingExec);
    expect(t).toEqual({ matchCosine: MATCH_THRESHOLD, livenessScore: LIVENESS_THRESHOLD, qualityGlassesPct: GLASSES_MAX });
  });
});

describe("withResolvedThresholds", () => {
  it("puebla thresholds desde el plane sin tocar el resto de la policy", async () => {
    const out = await withResolvedThresholds(BASE, { tenantId: "t1" }, execWith({ matchCosine: 0.42 }));
    expect(out.assuranceRequired).toBe("L2");
    expect(out.thresholds?.matchCosine).toBe(0.42);
    expect(out.thresholds?.livenessScore).toBe(LIVENESS_THRESHOLD);
  });

  it("NO pisa un override ya presente en la policy (no-breaking)", async () => {
    const withOverride = { ...BASE, thresholds: { matchCosine: 0.99 } } as TenantPolicy;
    const out = await withResolvedThresholds(withOverride, { tenantId: "t1" }, execWith({ matchCosine: 0.42 }));
    expect(out.thresholds?.matchCosine).toBe(0.99);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/configThresholds.test.ts`
Expected: FAIL — `Cannot find module './configThresholds'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/configThresholds.ts`:

```ts
/**
 * Puente Config Plane → motor (Fase 0). Resuelve los umbrales de decisión desde el
 * plane (cascada workflow→app→tenant→system) con FALLBACK a las constantes de
 * src/config.ts, y enriquece la policy del tenant que recibe el pipeline.
 *
 * Precedencia final del motor: workflow.definition ?? plane ?? config.ts. La cara
 * (workflow.definition) la aplica applyWorkflowToPolicy DESPUÉS, sobre la `base`
 * que acá poblamos. Mantener processSession() con su firma actual: sólo cambia el
 * ORIGEN de policy.thresholds.
 *
 * FAIL-CLOSED: cualquier error de DB cae a los defaults SEGUROS de config.ts; jamás
 * propaga ni produce un umbral más laxo (un error nunca relaja la verificación).
 */
import type { Executor } from "../db/executor";
import { pool } from "../db/pool";
import { resolveConfig, type ConfigScope } from "../db/repos/configValues";
import { MATCH_THRESHOLD, LIVENESS_THRESHOLD, GLASSES_MAX } from "../config";
import type { TenantPolicy } from "../types";

export interface ResolvedThresholds {
  matchCosine: number;
  livenessScore: number;
  qualityGlassesPct: number;
}

export async function resolveThresholds(
  scope: ConfigScope,
  exec: Executor = pool
): Promise<ResolvedThresholds> {
  try {
    const [m, l, g] = await Promise.all([
      resolveConfig<number>("thresholds", "matchCosine", scope, exec),
      resolveConfig<number>("thresholds", "livenessScore", scope, exec),
      resolveConfig<number>("thresholds", "qualityGlassesPct", scope, exec),
    ]);
    return {
      matchCosine: typeof m === "number" ? m : MATCH_THRESHOLD,
      livenessScore: typeof l === "number" ? l : LIVENESS_THRESHOLD,
      qualityGlassesPct: typeof g === "number" ? g : GLASSES_MAX,
    };
  } catch {
    // Fail-closed: nunca un umbral más laxo; defaults seguros de config.ts.
    return {
      matchCosine: MATCH_THRESHOLD,
      livenessScore: LIVENESS_THRESHOLD,
      qualityGlassesPct: GLASSES_MAX,
    };
  }
}

/**
 * Enriquece la policy con los thresholds resueltos del plane. NO pisa un override ya
 * presente en `policy.thresholds` (compat con tenants.policies legacy; su migración
 * al plane es trabajo futuro — spec §6). El resto de la policy queda intacto.
 */
export async function withResolvedThresholds(
  policy: TenantPolicy,
  scope: ConfigScope,
  exec: Executor = pool
): Promise<TenantPolicy> {
  const t = await resolveThresholds(scope, exec);
  return {
    ...policy,
    thresholds: {
      matchCosine: policy.thresholds?.matchCosine ?? t.matchCosine,
      livenessScore: policy.thresholds?.livenessScore ?? t.livenessScore,
      qualityGlassesPct: policy.thresholds?.qualityGlassesPct ?? t.qualityGlassesPct,
    },
  };
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx vitest run src/lib/configThresholds.test.ts`
Expected: PASS (todos verdes).

- [ ] **Step 5: Wire the 3 pipeline call-sites in `src/api/capture.ts`**

First add the import near the other `../lib/*` imports at the top of `src/api/capture.ts`:

```ts
import { withResolvedThresholds } from "../lib/configThresholds";
```

Then at each call-site, build the scope from the session and enrich the policy. **Site A — `processSession` (~L697)**, change:

```ts
    const out = await processSession(
      session,
      tenant.policies,
```
to:
```ts
    const policy = await withResolvedThresholds(tenant.policies, {
      tenantId: session.tenantId,
      appId: session.appId ?? null,
      workflowId: session.workflowId ?? null,
    });
    const out = await processSession(
      session,
      policy,
```

**Site B — `computeChecks` (~L771)**, change:
```ts
      tenant.policies,
```
(the argument to the `computeChecks` call) to use an enriched policy resolved just above that call:
```ts
      await withResolvedThresholds(tenant.policies, {
        tenantId: session.tenantId,
        appId: session.appId ?? null,
        workflowId: session.workflowId ?? null,
      }),
```

**Site C — `finalizeFromChecks` (~L857)**, change:
```ts
    const out = await finalizeFromChecks(session, tenant.policies, selfie, realPipelineDeps);
```
to:
```ts
    const finalizePolicy = await withResolvedThresholds(tenant.policies, {
      tenantId: session.tenantId,
      appId: session.appId ?? null,
      workflowId: session.workflowId ?? null,
    });
    const out = await finalizeFromChecks(session, finalizePolicy, selfie, realPipelineDeps);
```

> Exact line numbers will have drifted; locate each by the `tenant.policies` argument passed to `processSession` / `computeChecks` / `finalizeFromChecks`. Do NOT touch the preview/non-decision paths (e.g. the `...tenant.policies` spread near L799) — only the three engine-decision call-sites. `session.appId` / `session.workflowId` exist on the session type (migrations 0007/0015); the `?? null` keeps the scope well-formed when a session is tenant-wide.

- [ ] **Step 6: Verify nothing broke — typecheck + the capture suite + per-file tests**

Run: `npx tsc --noEmit && npx vitest run src/api/capture.test.ts src/lib/configThresholds.test.ts`
Expected: `tsc` exit 0. `capture.test.ts` keeps its **1 pre-existing** `consentShouldTransition` failure and NO new failures (same pass count as before this task); `configThresholds.test.ts` all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/configThresholds.ts src/lib/configThresholds.test.ts src/api/capture.ts
git commit -m "feat(config-plane): engine thresholds resolve from plane (fallback config.ts, fail-closed)"
```

---

### Task 6: Admin endpoints — GET/PUT config por scope (+ auditoría vía set)

**Files:**
- Create: `src/admin/configValidation.ts`
- Create: `src/admin/configValidation.test.ts`
- Modify: `src/admin/router.ts`

**Interfaces:**
- Consumes: `repos.configValues` (Task 2); `requirePermission` + `req.adminOperator` pattern (existing in `router.ts`).
- Produces:
  - `type ParsedScope = { scopeType: ConfigScopeType; scopeId: string | null }`
  - `parseConfigScope(query: Record<string, unknown>, tenantId: string): ParsedScope | null` — Fase 0: `system` (scopeId null) | `tenant` (scopeId=tenantId); `app`/`workflow` → `null` (diferidos hasta ownership check, ver docstring).
  - `isValidConfigPut(body: unknown): body is { namespace: string; key: string; value: unknown }` — namespace ∈ lista permitida, key no vacía, value presente.
  - Endpoints: `GET /admin/tenants/:id/config?scopeType=&scopeId=` → `{ scopeType, scopeId, values: ConfigValue[] }`; `PUT /admin/tenants/:id/config` body `{ scopeType, scopeId?, namespace, key, value }` → `ConfigValue` (versión nueva, audit escrito por `set()`).

- [ ] **Step 1: Write the failing test**

Create `src/admin/configValidation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseConfigScope, isValidConfigPut } from "./configValidation";

describe("parseConfigScope", () => {
  it("default → tenant scope con scopeId = tenantId", () => {
    expect(parseConfigScope({}, "t1")).toEqual({ scopeType: "tenant", scopeId: "t1" });
  });
  it("system → scopeId null", () => {
    expect(parseConfigScope({ scopeType: "system" }, "t1")).toEqual({ scopeType: "system", scopeId: null });
  });
  it("app/workflow NO soportados en Fase 0 → null (evita escritura cross-tenant sin ownership check)", () => {
    expect(parseConfigScope({ scopeType: "app", scopeId: "a1" }, "t1")).toBeNull();
    expect(parseConfigScope({ scopeType: "workflow", scopeId: "w1" }, "t1")).toBeNull();
  });
  it("scopeType inválido → null", () => {
    expect(parseConfigScope({ scopeType: "galaxy" }, "t1")).toBeNull();
  });
});

describe("isValidConfigPut", () => {
  it("acepta namespace permitido + key + value", () => {
    expect(isValidConfigPut({ namespace: "thresholds", key: "matchCosine", value: 0.5 })).toBe(true);
  });
  it("rechaza namespace fuera de la lista", () => {
    expect(isValidConfigPut({ namespace: "hacks", key: "x", value: 1 })).toBe(false);
  });
  it("rechaza key vacía o value ausente", () => {
    expect(isValidConfigPut({ namespace: "thresholds", key: "", value: 1 })).toBe(false);
    expect(isValidConfigPut({ namespace: "thresholds", key: "x" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/configValidation.test.ts`
Expected: FAIL — `Cannot find module './configValidation'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/admin/configValidation.ts`:

```ts
/**
 * Validadores puros del endpoint de config (testeables sin Express). El router
 * importa estas funciones; mantenerlas puras permite cubrir el scope/namespace/key
 * con tests unitarios (mismo espíritu que isValidDefinition en router.ts).
 */
import type { ConfigScopeType } from "../db/repos/configValues";

/** Namespaces permitidos (spec §3.1). Cierra el set para que la UI no escriba basura. */
export const CONFIG_NAMESPACES = [
  "thresholds", "providers", "rules", "ui", "compliance", "pipeline", "documents",
] as const;

export interface ParsedScope {
  scopeType: ConfigScopeType;
  scopeId: string | null;
}

/**
 * Resuelve el scope desde la query del endpoint, anclado al tenant de la ruta:
 *   - sin scopeType o 'tenant' → tenant scope (scopeId = tenantId).
 *   - 'system'                 → scopeId null (gateado a owner por manage_tenants).
 *   - 'app' | 'workflow'       → NO soportados en Fase 0 → null (400).
 *
 * Por qué app/workflow se rechazan en Fase 0: el scopeId vendría del request y
 * escribir sobre una app/workflow exige verificar que pertenece al tenant de la ruta
 * (defensa cross-tenant, Global Constraint "todo dato scopeado por tenant_id"). El
 * panel admin de Fase 0 sólo expone system+tenant, así que se cierran. Para
 * habilitarlos: antes del set(), validar ownership con
 * `repos.apps.resolveAppId(tenant.id, scopeId)` (app) o
 * `repos.workflows.getById(tenant.id, scopeId)` (workflow) → 404 si no pertenece.
 */
export function parseConfigScope(
  query: Record<string, unknown>,
  tenantId: string
): ParsedScope | null {
  const raw = query.scopeType;
  const scopeType = (raw === undefined ? "tenant" : raw) as string;
  if (scopeType === "tenant") return { scopeType: "tenant", scopeId: tenantId };
  if (scopeType === "system") return { scopeType: "system", scopeId: null };
  // 'app' | 'workflow' diferidos a una fase con ownership check (ver docstring).
  return null;
}

/** ¿el body de PUT trae namespace permitido + key no vacía + value presente? */
export function isValidConfigPut(
  body: unknown
): body is { namespace: string; key: string; value: unknown } {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.namespace !== "string") return false;
  if (!(CONFIG_NAMESPACES as readonly string[]).includes(b.namespace)) return false;
  if (typeof b.key !== "string" || b.key.trim().length === 0) return false;
  if (!("value" in b) || b.value === undefined) return false;
  return true;
}
```

Then add the two endpoints to `src/admin/router.ts` (after the workflows block, ~L1336). Add the import near the other local imports at the top:

```ts
import { parseConfigScope, isValidConfigPut } from "./configValidation";
```

Endpoints:

```ts
// ---- Config Plane (Fase 0) — config por scope, versionada + auditada --------- //

// GET /admin/tenants/:id/config?scopeType=&scopeId= → valores vigentes del scope.
adminRouter.get(
  "/tenants/:id/config",
  requirePermission("manage_tenants"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const scope = parseConfigScope(req.query as Record<string, unknown>, tenant.id);
    if (!scope) {
      res.status(400).json({ error: "invalid_scope" });
      return;
    }
    const values = await repos.configValues.listByScope(scope.scopeType, scope.scopeId);
    res.json({ scopeType: scope.scopeType, scopeId: scope.scopeId, values });
  }
);

// PUT /admin/tenants/:id/config {scopeType, scopeId?, namespace, key, value}
// → crea una NUEVA versión de la clave en ese scope. set() escribe config_audit.
adminRouter.put(
  "/tenants/:id/config",
  requirePermission("manage_tenants"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const scope = parseConfigScope(
      { scopeType: req.body?.scopeType, scopeId: req.body?.scopeId },
      tenant.id
    );
    if (!scope) {
      res.status(400).json({ error: "invalid_scope" });
      return;
    }
    if (!isValidConfigPut(req.body)) {
      res.status(400).json({ error: "namespace_key_value_required" });
      return;
    }
    const created = await repos.configValues.set({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      namespace: req.body.namespace,
      key: req.body.key,
      value: req.body.value,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
    });
    res.json(created);
  }
);
```

> Auditoría: `set()` ya inserta la fila `config_audit(before, after, version, changed_by=actor)`, así que el cambio queda trazado sin un `auditLog.record` extra. El `actor` lleva el `operatorId` del operador autenticado (mismo patrón que `workflow.updated`).

- [ ] **Step 4: Run test to verify it passes (+ typecheck)**

Run: `npx vitest run src/admin/configValidation.test.ts && npx tsc --noEmit`
Expected: validadores verdes; `tsc` exit 0 (los handlers compilan con los tipos de `repos.configValues`).

- [ ] **Step 5: Commit**

```bash
git add src/admin/configValidation.ts src/admin/configValidation.test.ts src/admin/router.ts
git commit -m "feat(config-plane): admin GET/PUT config por scope (audit via set)"
```

---

### Task 7: Admin UI — vista "Configuración" mínima (lee/escribe thresholds por scope)

**Files:**
- Modify: `admin/src/teko/client.ts` (métodos `getConfig` / `setConfig` + tipo `ConfigValue`)
- Create: `admin/src/views/teko/Configuracion/Configuracion.tsx`
- Create: `admin/src/views/teko/Configuracion/index.tsx`
- Modify: `admin/src/configs/routes.config/tekoRoute.ts` (ruta `/configuracion`)
- Modify: `admin/src/configs/navigation.config/teko.navigation.config.ts` (ítem de menú)

**Interfaces:**
- Consumes: backend `GET/PUT /admin/tenants/:id/config` (Task 6); `request<T>` interno de `client.ts`; `useTenant()` de `@/teko/TenantContext`; componentes Ecme (`Card`, `Input`, `Button`, `toast`/`Notification`).
- Produces: en `tekoApi` —
  - `getConfig(tenantId: string, scopeType?: string, scopeId?: string): Promise<{ scopeType: string; scopeId: string | null; values: ConfigValue[] }>`
  - `setConfig(tenantId: string, body: { scopeType: string; scopeId?: string; namespace: string; key: string; value: unknown }): Promise<ConfigValue>`

- [ ] **Step 1: Add the client methods + type**

In `admin/src/teko/client.ts`, add the type near the other imports/inline types and the two methods next to the Workflows block (~L307):

```ts
export interface ConfigValue {
    id: string
    scopeType: string
    scopeId: string | null
    namespace: string
    key: string
    value: unknown
    version: number
    updatedBy: string
    updatedAt: string
}
```
```ts
    // ---- Config Plane (Fase 0) — config por scope, versionada ----
    getConfig(tenantId: string, scopeType = 'tenant', scopeId?: string) {
        const qs = new URLSearchParams({ scopeType })
        if (scopeId) qs.set('scopeId', scopeId)
        return request<{ scopeType: string; scopeId: string | null; values: ConfigValue[] }>(
            'GET',
            `/tenants/${tenantId}/config?${qs.toString()}`,
        )
    },
    setConfig(
        tenantId: string,
        body: { scopeType: string; scopeId?: string; namespace: string; key: string; value: unknown },
    ) {
        return request<ConfigValue>('PUT', `/tenants/${tenantId}/config`, body)
    },
```

- [ ] **Step 2: Create the view**

Create `admin/src/views/teko/Configuracion/Configuracion.tsx`:

```tsx
import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Notification from '@/components/ui/Notification'
import toast from '@/components/ui/toast'
import { tekoApi, type ConfigValue } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'

// Los 3 umbrales que el motor resuelve del plane (Fase 0).
const THRESHOLD_KEYS = ['matchCosine', 'livenessScore', 'qualityGlassesPct'] as const

const SCOPE_OPTS = [
    { value: 'system', label: 'Sistema (plataforma)' },
    { value: 'tenant', label: 'Tenant (organización)' },
]

export default function Configuracion() {
    const { tenantId } = useTenant()
    const [scopeType, setScopeType] = useState<'system' | 'tenant'>('tenant')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [draft, setDraft] = useState<Record<string, string>>({})

    async function load() {
        if (!tenantId) return
        setLoading(true)
        setError(null)
        try {
            const res = await tekoApi.getConfig(tenantId, scopeType)
            const next: Record<string, string> = {}
            for (const k of THRESHOLD_KEYS) {
                const row = res.values.find(
                    (v: ConfigValue) => v.namespace === 'thresholds' && v.key === k,
                )
                next[k] = row ? String(row.value) : ''
            }
            setDraft(next)
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId, scopeType])

    async function save(key: string) {
        if (!tenantId) return
        const num = Number(draft[key])
        if (!Number.isFinite(num)) {
            toast.push(<Notification type="danger">Valor numérico inválido</Notification>)
            return
        }
        try {
            await tekoApi.setConfig(tenantId, {
                scopeType,
                namespace: 'thresholds',
                key,
                value: num,
            })
            toast.push(<Notification type="success">{key} guardado (nueva versión)</Notification>)
            void load()
        } catch (e) {
            toast.push(<Notification type="danger">{(e as Error).message}</Notification>)
        }
    }

    return (
        <Card>
            <div className="flex items-center justify-between mb-4">
                <h4>Configuración — Umbrales</h4>
                <Select
                    options={SCOPE_OPTS}
                    value={SCOPE_OPTS.find((o) => o.value === scopeType)}
                    onChange={(o) => setScopeType((o?.value as 'system' | 'tenant') ?? 'tenant')}
                    className="w-64"
                />
            </div>
            {error && <Alert type="danger" showIcon className="mb-4">{error}</Alert>}
            {loading ? (
                <Spinner />
            ) : (
                <div className="flex flex-col gap-4 max-w-md">
                    {THRESHOLD_KEYS.map((k) => (
                        <div key={k} className="flex items-end gap-2">
                            <div className="flex-1">
                                <label className="block mb-1 text-sm">{k}</label>
                                <Input
                                    value={draft[k] ?? ''}
                                    placeholder="(usa default del sistema)"
                                    onChange={(e) =>
                                        setDraft((d) => ({ ...d, [k]: e.target.value }))
                                    }
                                />
                            </div>
                            <Button size="sm" variant="solid" onClick={() => save(k)}>
                                Guardar
                            </Button>
                        </div>
                    ))}
                    <p className="text-xs text-gray-500">
                        Scope vacío → hereda del sistema (cascada workflow→app→tenant→system).
                        Cada guardado crea una versión nueva (auditada).
                    </p>
                </div>
            )}
        </Card>
    )
}
```

Create `admin/src/views/teko/Configuracion/index.tsx`:

```tsx
export { default } from './Configuracion'
```

- [ ] **Step 3: Register the route and the nav item**

In `admin/src/configs/routes.config/tekoRoute.ts`, add an entry alongside the others (mirror the `teko.workflows` shape):

```ts
    {
        key: 'teko.configuracion',
        path: '/configuracion',
        component: lazy(() => import('@/views/teko/Configuracion')),
    },
```

In `admin/src/configs/navigation.config/teko.navigation.config.ts`, add a child item under the "Verificación" / Configuración group (mirror an existing `subMenu` entry shape — `key`, `path`, `title`, plus whatever icon/translation keys siblings use):

```ts
            {
                key: 'teko.configuracion',
                path: '/configuracion',
                title: 'Configuración',
                translateKey: '',
                icon: '',
                type: 'item',
                authority: [],
                subMenu: [],
            },
```

> Match the exact object shape of the sibling items already in that file (some use `transKey`, `meta`, etc.). Copy a neighbor and change `key`/`path`/`title`.

- [ ] **Step 4: Verify the admin app typechecks and builds**

Run (from `admin/`): `cd admin && npx tsc --noEmit && npm run build`
Expected: `tsc` exit 0; `npm run build` completes without error. (The Ecme template has no vitest suite for views; the gate for this minimal view is a clean typecheck + build. If a dev server is available, also confirm `/admin-ui/configuracion` renders the three threshold inputs and a save round-trips a new version.)

- [ ] **Step 5: Commit**

```bash
git add admin/src/teko/client.ts admin/src/views/teko/Configuracion admin/src/configs/routes.config/tekoRoute.ts admin/src/configs/navigation.config/teko.navigation.config.ts
git commit -m "feat(config-plane): admin 'Configuración' view (read/write thresholds por scope)"
```

---

## Self-Review

**1. Spec coverage (Fase 0 deliverables):**
- `config_values` + `config_audit` → **Task 1** (migration 0020). ✓
- `resolveConfig(key, {tenantId,appId,workflowId})` cascada workflow→app→tenant→system → **Task 2** (impl) + **Task 3** (behavioral tests). ✓ (firma `(namespace, key, scope)` documentada como desdoblamiento del `key` del spec.)
- Seed de defaults del system desde `config.ts` → **Task 1** (SQL seed) + **Task 4** (drift guard test). ✓ (decisión: seed en migración, no seeder TS — justificada arriba.)
- Auditoría de cambios → `config_audit` escrito dentro de `set()` (**Task 2**), expuesto por el PUT (**Task 6**). ✓
- Motor resuelve thresholds del plane, compat con `workflows.definition` + fallback `config.ts` → **Task 5**. ✓ (precedencia `def ?? plane ?? config.ts`; `processSession` sin cambios de firma; pipeline unit tests intactos.)
- Endpoints admin GET/PUT por scope → **Task 6**. ✓
- Panel admin "Configuración" mínimo → **Task 7**. ✓
- "Umbrales editables y versionados por scope, sin redeploy" → set() versiona; los 6 thresholds seedeados (incl. AML/faceSearch) son editables por scope vía el PUT, aunque el motor en Fase 0 cablea los 3 que fluyen por `policy.thresholds` (matchCosine/livenessScore/qualityGlassesPct); AML/faceSearch quedan editables/versionados y su cableado al motor es incremento menor (siguen leyéndose vía `config.ts`/workflow def hoy). ✓

**Gaps conscientes (diferidos, no son de Fase 0):**
- **Cache en proceso (spec §3.1/§4):** NO implementada. Para 1k–10k/día la resolución por query es suficiente; la cache memoizada con invalidación por evento (y compartida vía Redis) es **Fase 5**. Decisión explícita, alineada con "escala diferida" (spec §4/roadmap). Si se quisiera el mínimo, sería un `Map` con invalidación en `set()` — fuera de alcance acá.
- **Migración de `tenants.policies` / `workflows.definition` al plane (spec §6):** dual-read incremental, futura. Task 5 PRESERVA `policies.thresholds` legacy (no lo pisa) para no romper, así que la transición es segura.
- **Retención/consentimiento editables:** el spec menciona retención/consentimiento como editables; Fase 0 entrega la INFRAESTRUCTURA (config_values/resolveConfig/endpoints) que ya los soporta como `namespace='compliance'` vía el mismo PUT; el cableado de esos namespaces al motor sigue el patrón de Task 5 y se hace cuando se migren esas keys (no bloquea la fundación).

**2. Placeholder scan:** sin "TBD/TODO/handle edge cases/similar a Task N". Todo step con código muestra el código completo. Las únicas notas con "~L697" son ayudas de localización (el código exacto a cambiar está mostrado), no placeholders.

**3. Type consistency:**
- `ConfigScopeType`, `ConfigScope`, `ConfigValue`, `SetConfigInput` definidos en Task 2 y reusados idénticos en Tasks 3/5/6.
- `resolveConfig<T>(namespace, key, scope, exec) → Promise<T | undefined>` — misma firma en impl (Task 2) y consumo (Tasks 3/5).
- `resolveThresholds`/`withResolvedThresholds` (Task 5) ↔ usados en `capture.ts` con el mismo objeto `{ tenantId, appId, workflowId }`.
- `set(...).actor` requerido (sin default) — el endpoint (Task 6) y el seed (SQL) siempre proveen actor (`admin:<id>` / `system:seed`).
- `parseConfigScope`/`isValidConfigPut` (Task 6) ↔ tipos del repo.
- Admin `ConfigValue` (Task 7 client) refleja el shape camelCase que devuelve el backend (`mapConfig`).
- Registro en `repos/index.ts` (Task 2) hace `repos.configValues.*` disponible para Task 6.

**4. Non-breaking / fail-closed checks:** la migración es aditiva e idempotente; `processSession` conserva su firma; con el plane vacío salvo el seed, los thresholds resueltos == defaults de `config.ts` (comportamiento idéntico al actual); error de DB en la resolución → defaults seguros (nunca más laxo). La suite sigue en 351 pass / 1 fail conocido.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-21-fase0-config-plane.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session using superpowers:executing-plans, batch execution with checkpoints.

**Which approach?**
