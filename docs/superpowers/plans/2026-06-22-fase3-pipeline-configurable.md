# Pipeline configurable — Fase 3 Implementation Plan

> **For agentic workers — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`**
> Read this entire document before starting any task. Each task ends with a mandatory
> deliverable gate; do NOT proceed to the next task until the gate passes.
> Each step shows the complete code — do NOT use placeholders or elide "similar" blocks.

## Goal

Deliver a **configurable pipeline** where a workflow definition controls which of the 8
existing checks run, in what order they appear, and with what parameter overrides —
**all without deploy**. Includes: a metadata-only checks registry; a resolver that merges
registry defaults with per-workflow `pipeline.checks` config; a refactored `pipeline.ts`
that consults the resolver; and an admin UI tab to toggle / reorder / parametrise checks.

No existing behaviour changes. All 437 passing tests (plus the 1 known
`consentShouldTransition` skip) must remain unchanged when `pipeline.checks` is absent.

---

## Architecture

```
src/
  pipeline/
    registry.ts         ← T1: CheckMeta, registerCheck, getRegistry, DEFAULT_CHECK_ORDER
    registry.test.ts    ← T1
    resolver.ts         ← T3: resolveCheckList(def) → ResolvedCheckList
    resolver.test.ts    ← T3
  types.ts              ← T2: PipelineCheckEntry, WorkflowDefinition.pipeline
  lib/
    workflow.ts         ← T3: assuranceFromDefinition updated to respect pipeline.checks
    workflow.test.ts    ← T3: add cases for disabled liveness/match

src/pipeline.ts         ← T4: each check block guarded by resolvedChecks.get(key)?.enabled

admin/src/
  teko/types.ts         ← T2: mirror PipelineCheckEntry
  views/teko/Workflows/
    Workflows.tsx       ← T6: add Pipeline tab (Switcher + arrows + param inputs)
```

No new migrations — `pipeline.checks` lives inside `WorkflowDefinition` which is already
JSONB in `workflows.definition`. The `workflowSnapshot` column already captures it
automatically. Config Plane (`config_values`) is NOT used for this; `resolveConfig`
remains available for system-level defaults in a future iteration if needed.

---

## Tech Stack

- **Backend**: TypeScript strict, Vitest, `src/types.ts` as source of truth
- **Admin UI**: React + Ecme component library (`Switcher`, `Input`, `Select`, `Button`,
  `Tabs`, `toast`, `useConfirm`) — no raw HTML, no `alert`/`confirm`
- **Testing**: pure unit / in-memory mocks; no DB, no ONNX, no sidecar OCR in any test
  added by this phase

---

## Global Constraints

1. **No regression on the pipeline**: when `pipeline.checks` is absent (or empty), every
   execution path in `processSession`, `computeChecks`, `finalizeFromChecks`, and
   `applyReviewDecision` must produce byte-identical results to the current code.
   Regression gate: `npx vitest run src/pipeline.test.ts` must pass **unmodified**.

2. **Configuration governs SELECTION, ORDER, and PARAMS — code governs failure semantics.**
   The 8 checks fail differently: quality → needs_recapture / rejected-by-excess;
   liveness/document/match → hard reject; aml/faceSearch/proofOfAddress → signal-only;
   ageEstimation → optional hard reject via `onUnderage:reject`. These failure paths
   live in `pipeline.ts` typed per-check and must NEVER be abstracted into a generic
   loop. The registry owns metadata; the pipeline owns consequence.

3. **Injection seam preserved**: the registry is **metadata-only** — it does NOT hold a
   `run` function. The typed `PipelineModules` injected via `PipelineDeps` remain the
   call site. `pipeline.test.ts` injects mock modules and must keep working unchanged.

4. **Execution spine is fixed** (data dependencies): quality → liveness → document →
   match → aml → faceSearch → proofOfAddress → ageEstimation. The `order` field in
   `PipelineCheckEntry` drives **UI display order only** (Fase 3). True arbitrary
   reordering requires a DAG executor and is explicitly deferred. This scope is stated
   clearly in the UI (`order` = "Posición en el editor").

5. **Fail-closed preserved**: a check that is **enabled** and whose `required` flag is
   true follows the same fail-closed path as today. Disabling a check via
   `pipeline.checks[k].enabled = false` is the only new freedom — the check is skipped
   entirely (no result, no verification_checks row for it). `finalizeFromChecks` and
   `applyReviewDecision` already handle absent check rows gracefully (they check
   `byType.get(type)?.detail`), so no change needed there.

6. **Single source of truth for enabled + LoA**: `pipeline.checks` is authoritative when
   present. `assuranceFromDefinition` in `workflow.ts` is updated to respect it: if
   liveness is disabled in `pipeline.checks`, the derived LoA drops to L2 (coherent
   behaviour for `decision()`). UI editor recomputes and displays the effective LoA when
   any check is toggled.

7. **Baseline**: `npx vitest run` → ~437 pass, 1 known skip (`consentShouldTransition`).
   Every task gate runs the full suite.

---

## T1 — Checks registry

**Goal**: declare metadata for the 8 existing checks; no runtime logic.

### Files

- `src/pipeline/registry.ts` (NEW)
- `src/pipeline/registry.test.ts` (NEW)

### Interfaces

```typescript
// src/pipeline/registry.ts

export type CheckKey =
  | 'quality'
  | 'liveness'
  | 'document'
  | 'match'
  | 'aml'
  | 'face_search'
  | 'proof_of_address'
  | 'age_estimation';

export interface CheckMeta {
  key: CheckKey;
  /** Display label for the admin UI. */
  label: string;
  /** Semver; bump when the check's scoring algorithm changes. */
  version: string;
  /**
   * 0-based position in the canonical execution spine.
   * Used as tie-breaker when order entries are equal or absent.
   */
  defaultOrder: number;
  /**
   * Keys this check depends on (data dependencies in the execution spine).
   * Informs the UI which checks CANNOT be reordered before their deps.
   * Actual execution order in code remains fixed (Fase 3 scope).
   */
  dependsOn: CheckKey[];
}

/** Read-only registry: key → meta. */
export type CheckRegistry = ReadonlyMap<CheckKey, CheckMeta>;
```

### Steps (TDD)

**Step 1.1** — Write the failing test first (`src/pipeline/registry.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { getRegistry, DEFAULT_CHECK_ORDER } from './registry';

describe('checks registry', () => {
  it('contains exactly 8 entries', () => {
    expect(getRegistry().size).toBe(8);
  });

  it('contains all expected check keys', () => {
    const keys = [...getRegistry().keys()];
    expect(keys).toContain('quality');
    expect(keys).toContain('liveness');
    expect(keys).toContain('document');
    expect(keys).toContain('match');
    expect(keys).toContain('aml');
    expect(keys).toContain('face_search');
    expect(keys).toContain('proof_of_address');
    expect(keys).toContain('age_estimation');
  });

  it('DEFAULT_CHECK_ORDER has 8 entries matching registry keys', () => {
    const registry = getRegistry();
    expect(DEFAULT_CHECK_ORDER).toHaveLength(8);
    for (const key of DEFAULT_CHECK_ORDER) {
      expect(registry.has(key)).toBe(true);
    }
  });

  it('defaultOrder values are unique and 0-based sequential', () => {
    const orders = [...getRegistry().values()].map(m => m.defaultOrder).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('dependsOn only references keys that exist in the registry', () => {
    const registry = getRegistry();
    for (const meta of registry.values()) {
      for (const dep of meta.dependsOn) {
        expect(registry.has(dep)).toBe(true);
      }
    }
  });

  it('quality has no dependsOn (always runs first)', () => {
    expect(getRegistry().get('quality')!.dependsOn).toEqual([]);
  });

  it('aml and proofOfAddress depend on document', () => {
    expect(getRegistry().get('aml')!.dependsOn).toContain('document');
    expect(getRegistry().get('proof_of_address')!.dependsOn).toContain('document');
  });

  it('faceSearch depends on match (embedding reuse)', () => {
    expect(getRegistry().get('face_search')!.dependsOn).toContain('match');
  });

  it('getRegistry returns the same Map instance (singleton)', () => {
    expect(getRegistry()).toBe(getRegistry());
  });
});
```

Run: `npx vitest run src/pipeline/registry.test.ts` → **all fail** (module not found).

**Step 1.2** — Implement `src/pipeline/registry.ts`:

```typescript
/**
 * Checks registry — metadata for the 8 pipeline checks.
 * METADATA-ONLY: no `run` function, no singletons, no I/O.
 * The execution logic lives in pipeline.ts (typed, injected, mockable).
 */

export type CheckKey =
  | 'quality'
  | 'liveness'
  | 'document'
  | 'match'
  | 'aml'
  | 'face_search'
  | 'proof_of_address'
  | 'age_estimation';

export interface CheckMeta {
  key: CheckKey;
  label: string;
  version: string;
  defaultOrder: number;
  dependsOn: CheckKey[];
}

export type CheckRegistry = ReadonlyMap<CheckKey, CheckMeta>;

const REGISTRY_DATA: CheckMeta[] = [
  { key: 'quality',          label: 'Calidad de imagen',        version: '1.0.0', defaultOrder: 0, dependsOn: [] },
  { key: 'liveness',         label: 'Prueba de vida',           version: '1.0.0', defaultOrder: 1, dependsOn: [] },
  { key: 'document',         label: 'Documento de identidad',   version: '1.0.0', defaultOrder: 2, dependsOn: [] },
  { key: 'match',            label: 'Match 1:1 selfie/doc',     version: '1.0.0', defaultOrder: 3, dependsOn: ['document'] },
  { key: 'aml',              label: 'Screening AML/PEP',        version: '1.0.0', defaultOrder: 4, dependsOn: ['document'] },
  { key: 'face_search',      label: 'Búsqueda facial 1:N',      version: '1.0.0', defaultOrder: 5, dependsOn: ['match'] },
  { key: 'proof_of_address', label: 'Comprobante de domicilio', version: '1.0.0', defaultOrder: 6, dependsOn: ['document'] },
  { key: 'age_estimation',   label: 'Estimación de edad',       version: '1.0.0', defaultOrder: 7, dependsOn: [] },
];

const REGISTRY: CheckRegistry = new Map(REGISTRY_DATA.map(m => [m.key, m]));

/** Singleton registry — use this everywhere, never mutate. */
export function getRegistry(): CheckRegistry {
  return REGISTRY;
}

/** Canonical execution order (derived from defaultOrder ascending). */
export const DEFAULT_CHECK_ORDER: CheckKey[] = REGISTRY_DATA
  .slice()
  .sort((a, b) => a.defaultOrder - b.defaultOrder)
  .map(m => m.key);
```

Run: `npx vitest run src/pipeline/registry.test.ts` → **all pass**.
Run: `npx vitest run` → baseline unchanged.

**Deliverable gate**: registry tests pass; no regression.

---

## T2 — Type extensions

**Goal**: add `PipelineCheckEntry` and `WorkflowDefinition.pipeline` to `src/types.ts` and
mirror in the admin client types.

### Files

- `src/types.ts` (EDIT — add after existing WorkflowDefinition)
- `admin/src/teko/types.ts` (EDIT — mirror type)

### Interfaces

```typescript
// To add to src/types.ts

/**
 * Entry in the configurable pipeline list (Fase 3).
 * Stored in workflow.definition.pipeline.checks[].
 * Absent entry for a key = use registry default (enabled: derived from required fields).
 */
export interface PipelineCheckEntry {
  /** Registry key — must match a CheckKey from src/pipeline/registry.ts. */
  key: string;
  /**
   * Whether this check runs. False = skip entirely (no result, no DB row).
   * True + required = runs and fails-closed as today.
   * True + not required = runs only if enabled by the workflow's required flag.
   */
  enabled: boolean;
  /**
   * UI display order (0-based). Does NOT change execution order in Fase 3
   * (execution spine is fixed due to data dependencies). Used by the editor.
   */
  order: number;
  /**
   * Per-check parameter overrides. Keys and semantics are check-specific:
   * - quality:          { glassesMaxPct?: number }
   * - liveness:         { threshold?: number }
   * - match:            { threshold?: number }
   * - aml:              { threshold?: number }
   * - face_search:      { threshold?: number }
   * - proof_of_address: { maxAgeMonths?: number; requireNameMatch?: boolean; nameThreshold?: number }
   * - age_estimation:   { minAge?: number }
   * document has no configurable params (hard MRZ/OCR logic).
   */
  config?: Record<string, unknown>;
}
```

And add `pipeline` field to `WorkflowDefinition`:

```typescript
// Inside WorkflowDefinition (after the existing ageEstimation field):

  /**
   * Configurable pipeline (Fase 3). When present, this list is the source of truth
   * for which checks are enabled and their UI display order. Absent = derive from
   * existing required fields (full backward compat with Fases 0/1/2).
   *
   * Checks absent from the list inherit registry defaults (enabled = derived from
   * their required field). Only entries with enabled:false suppress a check.
   */
  pipeline?: {
    checks: PipelineCheckEntry[];
  };
```

### Steps (TDD)

**Step 2.1** — Write the failing test (new file `src/pipeline/types.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition, PipelineCheckEntry } from '../types';

describe('PipelineCheckEntry type round-trip', () => {
  it('WorkflowDefinition accepts pipeline.checks', () => {
    const entry: PipelineCheckEntry = {
      key: 'liveness',
      enabled: false,
      order: 1,
      config: { threshold: 0.7 },
    };
    const def: WorkflowDefinition = {
      document: { required: true },
      liveness: { required: true, mode: 'passive' },
      pipeline: { checks: [entry] },
    };
    expect(def.pipeline?.checks[0].key).toBe('liveness');
    expect(def.pipeline?.checks[0].enabled).toBe(false);
  });

  it('WorkflowDefinition without pipeline is valid (backward compat)', () => {
    const def: WorkflowDefinition = {
      document: { required: true },
      liveness: { required: true, mode: 'passive' },
    };
    expect(def.pipeline).toBeUndefined();
  });

  it('PipelineCheckEntry config is optional', () => {
    const entry: PipelineCheckEntry = { key: 'aml', enabled: true, order: 4 };
    expect(entry.config).toBeUndefined();
  });
});
```

Run → **fail** (type not found in types.ts).

**Step 2.2** — Edit `src/types.ts`. Locate the end of the `WorkflowDefinition` interface
(after `ageEstimation?` and `questionnaire?` fields, before the `review?` field closing
brace). Add `PipelineCheckEntry` as a standalone export just BEFORE `WorkflowDefinition`,
and add the `pipeline?` field inside `WorkflowDefinition` after `questionnaire?`.

After editing, also add `PipelineCheckEntry` to `admin/src/teko/types.ts` in the same
location (mirroring — admin types are kept manually in sync with backend types):

```typescript
// admin/src/teko/types.ts — add after existing WorkflowDefinition
export interface PipelineCheckEntry {
    key: string
    enabled: boolean
    order: number
    config?: Record<string, unknown>
}
// Inside WorkflowDefinition add:
//   pipeline?: { checks: PipelineCheckEntry[] }
```

Run: `npx vitest run src/pipeline/types.test.ts` → **pass**.
Run: `npx vitest run` → baseline unchanged (pure type additions, no runtime change).

**Deliverable gate**: type tests pass; `tsc --noEmit` clean; baseline suite unchanged.

---

## T3 — Resolver + `assuranceFromDefinition` update

**Goal**: implement `resolveCheckList(def)` which merges registry defaults with
`def.pipeline?.checks`. Update `assuranceFromDefinition` so LoA derivation respects
disabled checks (single source of truth).

### Files

- `src/pipeline/resolver.ts` (NEW)
- `src/pipeline/resolver.test.ts` (NEW)
- `src/lib/workflow.ts` (EDIT — `assuranceFromDefinition`)
- `src/lib/workflow.test.ts` (EDIT — add 4 new cases)

### Interfaces

```typescript
// src/pipeline/resolver.ts

import type { WorkflowDefinition } from '../types';
import type { CheckKey } from './registry';

export interface ResolvedCheck {
  key: CheckKey;
  enabled: boolean;
  /** UI display order (not execution order — spine is fixed). */
  order: number;
  /** Merged param overrides from pipeline.checks[].config. */
  config: Record<string, unknown>;
}

/** Map from check key to its resolved (effective) config for this session. */
export type ResolvedCheckList = ReadonlyMap<CheckKey, ResolvedCheck>;

/**
 * Resolve the effective pipeline check list for a workflow definition.
 *
 * Rules:
 *   1. Start from registry defaults (all 8 checks, defaultOrder, enabled per required fields).
 *   2. If def.pipeline?.checks is present and non-empty, apply each entry as an override:
 *      enabled / order / config are taken from the entry.
 *   3. A check absent from the pipeline.checks list keeps its registry default.
 *   4. def === null/undefined → all checks at registry defaults, enabled=false for
 *      LoA-gated checks (match/liveness) since no required flags are set.
 *
 * The caller (pipeline.ts) uses `resolvedChecks.get(key)?.enabled` to decide whether
 * to invoke a check. Undefined means enabled (absent entry = default enabled for the
 * always-run checks). For required-gated checks, the caller still consults the existing
 * required flag AND the resolved enabled.
 */
export function resolveCheckList(
  def: WorkflowDefinition | null | undefined
): ResolvedCheckList
```

### Steps (TDD)

**Step 3.1** — Write the failing tests (`src/pipeline/resolver.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { resolveCheckList } from './resolver';
import { workflowDefForLoA } from '../lib/workflow';
import type { WorkflowDefinition } from '../types';

describe('resolveCheckList', () => {
  describe('null/undefined def (no workflow)', () => {
    it('returns 8 entries', () => {
      expect(resolveCheckList(null).size).toBe(8);
    });

    it('quality is always enabled', () => {
      expect(resolveCheckList(null).get('quality')!.enabled).toBe(true);
    });

    it('document is always enabled', () => {
      expect(resolveCheckList(null).get('document')!.enabled).toBe(true);
    });

    it('match is disabled when no def (no required flag)', () => {
      expect(resolveCheckList(null).get('match')!.enabled).toBe(false);
    });

    it('liveness is disabled when no def', () => {
      expect(resolveCheckList(null).get('liveness')!.enabled).toBe(false);
    });

    it('aml is disabled when no def', () => {
      expect(resolveCheckList(null).get('aml')!.enabled).toBe(false);
    });
  });

  describe('L3 workflow (liveness + match + document required)', () => {
    const l3 = workflowDefForLoA('L3');

    it('liveness is enabled for L3', () => {
      expect(resolveCheckList(l3).get('liveness')!.enabled).toBe(true);
    });

    it('match is enabled for L3', () => {
      expect(resolveCheckList(l3).get('match')!.enabled).toBe(true);
    });

    it('quality is enabled for L3', () => {
      expect(resolveCheckList(l3).get('quality')!.enabled).toBe(true);
    });

    it('aml is disabled for default L3 (not required)', () => {
      expect(resolveCheckList(l3).get('aml')!.enabled).toBe(false);
    });
  });

  describe('pipeline.checks overrides', () => {
    const baseL3 = workflowDefForLoA('L3');

    it('disabling liveness via pipeline.checks overrides required:true', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        pipeline: { checks: [{ key: 'liveness', enabled: false, order: 1 }] },
      };
      expect(resolveCheckList(def).get('liveness')!.enabled).toBe(false);
    });

    it('enabling aml via pipeline.checks + aml.required:true enables it', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        aml: { required: true, threshold: 0.8 },
        pipeline: { checks: [{ key: 'aml', enabled: true, order: 4 }] },
      };
      expect(resolveCheckList(def).get('aml')!.enabled).toBe(true);
    });

    it('pipeline.checks config is merged into ResolvedCheck.config', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        pipeline: {
          checks: [{ key: 'match', enabled: true, order: 3, config: { threshold: 0.55 } }],
        },
      };
      expect(resolveCheckList(def).get('match')!.config).toEqual({ threshold: 0.55 });
    });

    it('checks not in pipeline.checks list keep registry defaults', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        pipeline: { checks: [{ key: 'liveness', enabled: false, order: 1 }] },
      };
      // match is not in pipeline.checks but is required by L3
      expect(resolveCheckList(def).get('match')!.enabled).toBe(true);
    });

    it('order from pipeline.checks is reflected in resolved entry', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        pipeline: { checks: [{ key: 'quality', enabled: true, order: 99 }] },
      };
      expect(resolveCheckList(def).get('quality')!.order).toBe(99);
    });
  });

  describe('non-regression: behavior identical to today with no pipeline field', () => {
    it('L1 without pipeline: only quality + document enabled', () => {
      const def = workflowDefForLoA('L1');
      const resolved = resolveCheckList(def);
      expect(resolved.get('quality')!.enabled).toBe(true);
      expect(resolved.get('document')!.enabled).toBe(true);
      expect(resolved.get('liveness')!.enabled).toBe(false);
      expect(resolved.get('match')!.enabled).toBe(false);
      expect(resolved.get('aml')!.enabled).toBe(false);
      expect(resolved.get('face_search')!.enabled).toBe(false);
      expect(resolved.get('proof_of_address')!.enabled).toBe(false);
      expect(resolved.get('age_estimation')!.enabled).toBe(false);
    });

    it('L2 without pipeline: quality + document + match enabled', () => {
      const def = workflowDefForLoA('L2');
      const resolved = resolveCheckList(def);
      expect(resolved.get('match')!.enabled).toBe(true);
      expect(resolved.get('liveness')!.enabled).toBe(false);
    });

    it('L3 without pipeline: quality + document + liveness + match enabled', () => {
      const def = workflowDefForLoA('L3');
      const resolved = resolveCheckList(def);
      expect(resolved.get('liveness')!.enabled).toBe(true);
      expect(resolved.get('match')!.enabled).toBe(true);
    });
  });
});
```

Run → **fail** (module not found).

**Step 3.2** — Implement `src/pipeline/resolver.ts`:

```typescript
/**
 * resolveCheckList — merges registry defaults with per-workflow pipeline.checks config.
 * Pure function; no I/O; no singletons other than the registry.
 */
import type { WorkflowDefinition } from '../types';
import { getRegistry, DEFAULT_CHECK_ORDER } from './registry';
import type { CheckKey } from './registry';

export interface ResolvedCheck {
  key: CheckKey;
  enabled: boolean;
  order: number;
  config: Record<string, unknown>;
}

export type ResolvedCheckList = ReadonlyMap<CheckKey, ResolvedCheck>;

/** Derive whether a check is enabled from the WorkflowDefinition required fields alone. */
function defaultEnabled(key: CheckKey, def: WorkflowDefinition | null | undefined): boolean {
  if (!def) {
    // No def: only quality and document always run
    return key === 'quality' || key === 'document';
  }
  switch (key) {
    case 'quality':          return true; // always
    case 'document':         return def.document?.required ?? true; // should always be true
    case 'liveness':         return def.liveness?.required ?? false;
    case 'match':            return def.match?.required ?? false;
    case 'aml':              return def.aml?.required ?? false;
    case 'face_search':      return def.faceSearch?.required ?? false;
    case 'proof_of_address': return def.proofOfAddress?.required ?? false;
    case 'age_estimation':   return def.ageEstimation?.required ?? false;
  }
}

export function resolveCheckList(
  def: WorkflowDefinition | null | undefined
): ResolvedCheckList {
  const registry = getRegistry();
  const overrides = def?.pipeline?.checks ?? [];
  // Build override lookup: key → entry
  const overrideMap = new Map(overrides.map(e => [e.key as CheckKey, e]));

  const result = new Map<CheckKey, ResolvedCheck>();

  for (const key of DEFAULT_CHECK_ORDER) {
    const meta = registry.get(key)!;
    const override = overrideMap.get(key);

    result.set(key, {
      key,
      enabled: override !== undefined ? override.enabled : defaultEnabled(key, def),
      order:   override?.order ?? meta.defaultOrder,
      config:  override?.config ?? {},
    });
  }

  return result;
}
```

Run: `npx vitest run src/pipeline/resolver.test.ts` → **all pass**.

**Step 3.3** — Update `assuranceFromDefinition` in `src/lib/workflow.ts` to respect
pipeline.checks disabled overrides (single source of truth for LoA):

```typescript
// In src/lib/workflow.ts, replace assuranceFromDefinition:

/**
 * Derives the EQUIVALENT LoA from a workflow definition (which checks does it require).
 * Respects pipeline.checks disabled overrides: if liveness.required=true but
 * pipeline.checks disables liveness, the effective LoA drops to L2 (coherent — the
 * pipeline won't run liveness, so decision() can't award L3).
 *
 * Absent pipeline.checks → identical to previous behaviour (reads required fields only).
 */
export function assuranceFromDefinition(def: WorkflowDefinition): LoA {
  // Respect pipeline.checks enabled overrides if present
  const pChecks = def.pipeline?.checks;
  const isEnabledInPipeline = (key: string): boolean => {
    if (!pChecks || pChecks.length === 0) return true; // no override list: use required
    const entry = pChecks.find(c => c.key === key);
    return entry !== undefined ? entry.enabled : true; // absent entry = enabled by default
  };
  if (def.liveness?.required && isEnabledInPipeline('liveness')) return 'L3';
  if (def.match?.required && isEnabledInPipeline('match')) return 'L2';
  return 'L1';
}
```

**Step 3.4** — Add cases to `src/lib/workflow.test.ts`:

```typescript
// Add inside the existing describe block for assuranceFromDefinition:

it('pipeline.checks disabling liveness drops L3 → L2', () => {
  const def: WorkflowDefinition = {
    document: { required: true },
    match: { required: true },
    liveness: { required: true, mode: 'passive' },
    pipeline: { checks: [{ key: 'liveness', enabled: false, order: 1 }] },
  };
  expect(assuranceFromDefinition(def)).toBe('L2');
});

it('pipeline.checks disabling match drops L2 → L1', () => {
  const def: WorkflowDefinition = {
    document: { required: true },
    match: { required: true },
    pipeline: { checks: [{ key: 'match', enabled: false, order: 3 }] },
  };
  expect(assuranceFromDefinition(def)).toBe('L1');
});

it('pipeline.checks with no liveness entry does not affect L3', () => {
  const def: WorkflowDefinition = {
    document: { required: true },
    match: { required: true },
    liveness: { required: true, mode: 'passive' },
    pipeline: { checks: [{ key: 'aml', enabled: true, order: 4 }] },
  };
  expect(assuranceFromDefinition(def)).toBe('L3');
});

it('empty pipeline.checks list does not affect LoA derivation', () => {
  const def: WorkflowDefinition = {
    document: { required: true },
    liveness: { required: true, mode: 'passive' },
    match: { required: true },
    pipeline: { checks: [] },
  };
  expect(assuranceFromDefinition(def)).toBe('L3');
});
```

Run: `npx vitest run src/lib/workflow.test.ts` → **all pass** (new 4 + existing).
Run: `npx vitest run` → full baseline pass.

**Deliverable gate**: resolver tests pass; workflow tests pass (including 4 new cases);
full suite unchanged.

---

## T4 — Refactor `pipeline.ts` (riskiest task)

**Goal**: guard each of the 8 check invocations with `resolvedChecks.get(key)?.enabled`.
Execution spine and failure handling stay EXACTLY as today. The only change: a check with
`enabled: false` in the resolved list is skipped (no module call, no DB row for it).

### Files

- `src/pipeline.ts` (EDIT — each check block)
- `src/pipeline.test.ts` (ADD new describe block at the bottom — existing tests unmodified)

### Critical invariant

**Do NOT touch the failure-handling code** for each check (`rejectAt`, `runAml`,
`runFaceSearch`, `runProofOfAddress`, `runAgeEstimation` inner logic, the quality
short-circuit, `goToReview`, `persistAllChecks`, `finalizeFromChecks`, `applyReviewDecision`).
Only add the `enabled` guard at the CALLSITE of each check.

### Steps (TDD — write new regression tests FIRST, then refactor)

**Step 4.1** — Add new regression/behavior tests to `src/pipeline.test.ts` at the bottom
(AFTER all existing tests, in a new `describe` block). Do NOT edit existing tests.

```typescript
// At the bottom of src/pipeline.test.ts, inside the existing describe('processSession') or as a new top-level describe:

describe('pipeline.checks configuration (Fase 3)', () => {
  // Re-use makeSession, makePolicy, IMAGES, PASS_QUALITY, etc. from the existing test file.

  it('liveness disabled in pipeline.checks → liveness module never called even at L3', async () => {
    const def = workflowDefForLoA('L3');
    const defWithDisabledLiveness = {
      ...def,
      pipeline: { checks: [{ key: 'liveness', enabled: false, order: 1 }] },
    };
    const session = makeSession({ workflowSnapshot: defWithDisabledLiveness, assuranceRequired: 'L3' });
    const livenessSpy = vi.fn().mockResolvedValue({
      passed: true, score: 0.99, attackType: 'none', model: 'test', threshold: 0.5,
    });
    const deps = makeDeps({ liveness: livenessSpy });
    await processSession(session, makePolicy(), IMAGES, deps);
    expect(livenessSpy).not.toHaveBeenCalled();
  });

  it('aml disabled in pipeline.checks → aml module never called even when aml.required=true', async () => {
    const def: WorkflowDefinition = {
      document: { required: true },
      match: { required: true },
      aml: { required: true, threshold: 0.8 },
      review: { mode: 'auto' },
      pipeline: { checks: [{ key: 'aml', enabled: false, order: 4 }] },
    };
    const session = makeSession({ workflowSnapshot: def, assuranceRequired: 'L2' });
    const amlSpy = vi.fn().mockResolvedValue({ passed: true, decision: 'clear', hits: [], topScore: 0, threshold: 0.8, query: { nombres: '', apellidos: '', normalized: '' }, provider: 'test', datasetVersion: null });
    const deps = makeDeps({ aml: amlSpy });
    await processSession(session, makePolicy(), IMAGES, deps);
    expect(amlSpy).not.toHaveBeenCalled();
  });

  it('no pipeline.checks → behavior identical to default (regression)', async () => {
    const session = makeSession({ workflowSnapshot: workflowDefForLoA('L3'), assuranceRequired: 'L3' });
    const deps = makeDeps({});
    const result = await processSession(session, makePolicy(), IMAGES, deps);
    // L3 default: verified (all modules pass in makeDeps defaults)
    expect(result.state).toBe('verified');
  });

  it('disabling match in pipeline.checks → match module not called, LoA is L1', async () => {
    const def: WorkflowDefinition = {
      document: { required: true },
      match: { required: true },
      review: { mode: 'auto' },
      pipeline: { checks: [{ key: 'match', enabled: false, order: 3 }] },
    };
    const session = makeSession({ workflowSnapshot: def, assuranceRequired: 'L1' });
    const embedSpy = vi.fn();
    const deps = makeDeps({ embed: embedSpy });
    const result = await processSession(session, makePolicy({ assuranceRequired: 'L1' }), IMAGES, deps);
    expect(embedSpy).not.toHaveBeenCalled();
    expect(result.state).toBe('verified');
    expect(result.result?.loa).toBe('L1');
  });
});
```

Note: `makeDeps` is a helper that must already exist in `pipeline.test.ts` (it makes mock
deps). If the existing file calls it differently, mirror whatever pattern is there.

Run → **fail** (tests call disabled-check modules that get invoked anyway — correct, since
pipeline.ts hasn't been refactored yet).

**Step 4.2** — Refactor `pipeline.ts`. Add import at top:

```typescript
import { resolveCheckList } from './pipeline/resolver';
```

In `processSession`, add the resolver call right after `effectivePolicy`:

```typescript
const policy = effectivePolicy(session, tenantPolicy);
const resolvedChecks = resolveCheckList(session.workflowSnapshot);
```

Then guard each check callsite. The pattern is **additive** — wrap each block in a
condition. Existing logic inside the block is UNCHANGED.

**Liveness block** (step 2 in processSession), replace:

```typescript
// BEFORE:
if (needsLiveness(policy)) {
  // ... liveness invocation
}

// AFTER:
if (needsLiveness(policy) && (resolvedChecks.get('liveness')?.enabled !== false)) {
  // ... same liveness invocation, untouched
}
```

**Match block** (step 4 in processSession), replace outer condition:

```typescript
// BEFORE:
if (needsMatch(policy)) {

// AFTER:
if (needsMatch(policy) && (resolvedChecks.get('match')?.enabled !== false)) {
```

**AML block** — `runAml` already reads `cfg?.required`; add a guard at the CALLSITE:

```typescript
// BEFORE:
const aml = await runAml(deps, session, document);

// AFTER:
const aml = resolvedChecks.get('aml')?.enabled !== false
  ? await runAml(deps, session, document)
  : undefined;
```

**faceSearch block** — guard the whole conditional:

```typescript
// BEFORE:
if (session.workflowSnapshot?.faceSearch?.required) {

// AFTER:
if (session.workflowSnapshot?.faceSearch?.required && resolvedChecks.get('face_search')?.enabled !== false) {
```

**proofOfAddress block**:

```typescript
// BEFORE:
const proofOfAddress = await runProofOfAddress(deps, session, document, images.proofOfAddress);

// AFTER:
const proofOfAddress = resolvedChecks.get('proof_of_address')?.enabled !== false
  ? await runProofOfAddress(deps, session, document, images.proofOfAddress)
  : undefined;
```

**ageEstimation block**:

```typescript
// BEFORE:
const ageEstimation = await runAgeEstimation(deps, session, images.selfie);

// AFTER:
const ageEstimation = resolvedChecks.get('age_estimation')?.enabled !== false
  ? await runAgeEstimation(deps, session, images.selfie)
  : undefined;
```

Apply the SAME guards in **`computeChecks`** (same 6 check callsites, identical pattern):

```typescript
// At top of computeChecks, after effectivePolicy:
const resolvedChecks = resolveCheckList(session.workflowSnapshot);
// Then same guards as above for each check.
```

`finalizeFromChecks` and `applyReviewDecision` do NOT call modules directly (they
reconstruct from persisted rows); no changes needed there. The disabled-check absence from
`byType` is handled by existing `?.detail` optional chaining throughout.

**Step 4.3** — Run:

```bash
npx vitest run src/pipeline.test.ts
```

All existing tests **must pass unmodified**. New describe block also passes.

**Step 4.4** — Run full suite:

```bash
npx vitest run
```

~437 pass, 1 known skip. Zero regressions.

**Deliverable gate**: `pipeline.test.ts` passes (all old + all new); full suite at baseline.

---

## T5 — Per-check param overrides from resolver config

**Goal**: have the pipeline pass `resolvedChecks.get(key)?.config` param overrides to each
check invocation, allowing per-workflow threshold overrides BEYOND what WorkflowDefinition
already provides (future-proof; today thresholds come from `def.match?.threshold` etc.).

This task extends T4 — add config merging at each check callsite. The merge strategy:
`resolvedChecks.get(key)?.config` values take PRECEDENCE over `def.{check}.threshold`.

### Files

- `src/pipeline.ts` (EDIT — same blocks as T4, add config extraction)

### Steps (TDD)

**Step 5.1** — Add tests to the new `describe` block in `pipeline.test.ts`:

```typescript
it('match threshold from pipeline.checks config overrides workflow threshold', async () => {
  const def: WorkflowDefinition = {
    document: { required: true },
    match: { required: true, threshold: 0.4 },
    review: { mode: 'auto' },
    pipeline: {
      checks: [{ key: 'match', enabled: true, order: 3, config: { threshold: 0.7 } }],
    },
  };
  const session = makeSession({ workflowSnapshot: def, assuranceRequired: 'L2' });
  // Mock embed + matchEmbeddings to capture the threshold
  // The spy captures cosine threshold passed to match module via policy.thresholds.matchCosine
  // Since the resolver config feeds into effectivePolicy overrides (see Step 5.2),
  // we verify the result uses the overridden threshold.
  const deps = makeDeps({});
  const result = await processSession(session, makePolicy({ assuranceRequired: 'L2' }), IMAGES, deps);
  // With default mocks (cosine=1.0 which exceeds any threshold), session is verified.
  expect(result.state).toBe('verified');
  // The key assertion: pipeline ran (no skip), and config was consumed (no throw).
  expect(result.result?.loa).toBe('L2');
});
```

Run → currently passes (config is ignored in T4 — test just checks no crash).

**Step 5.2** — In `src/pipeline.ts`, extract config overrides inside `effectivePolicy` or
just at each callsite. The cleanest approach: pass resolved config into the per-check
invocations. For match threshold specifically, merge into the policy thresholds:

```typescript
// In processSession, after computing resolvedChecks, compute merged thresholds:
const matchConfig = resolvedChecks.get('match')?.config ?? {};
const livenessConfig = resolvedChecks.get('liveness')?.config ?? {};
const qualityConfig = resolvedChecks.get('quality')?.config ?? {};

// Then when calling modules, use config overrides with fallback to policy:
// liveness callsite:
liveness = await deps.modules.liveness(images.selfie, deps.engine, {
  frames: images.frames,
  challenge,
  threshold: (livenessConfig.threshold as number | undefined) ?? policy.thresholds?.livenessScore,
  activeLiveness: images.activeLiveness,
});

// match callsite (matchEmbeddings call):
matchRes = matchEmbeddings(
  selfieEmb, docFaceEmb,
  (matchConfig.threshold as number | undefined) ?? policy.thresholds?.matchCosine
);

// quality callsite:
const quality = await deps.modules.quality(
  images.selfie,
  deps.engine,
  (qualityConfig.glassesMaxPct as number | undefined) ?? policy.thresholds?.qualityGlassesPct
);
```

For optional checks, pass config into `runAml`, `runFaceSearch`, `runProofOfAddress`,
`runAgeEstimation` via a `configOverride` parameter added to each helper:

```typescript
// runAml signature update (internal helper, not exported):
async function runAml(
  deps: PipelineDeps,
  session: VerificationSession,
  document: DocumentResult,
  configOverride?: Record<string, unknown>
): Promise<AmlResult | undefined>
// Inside: threshold: (configOverride?.threshold as number | undefined) ?? cfg.threshold

// Same pattern for runFaceSearch (threshold), runProofOfAddress (maxAgeMonths, requireNameMatch, nameThreshold), runAgeEstimation (minAge).
```

Apply the same config extraction in `computeChecks` for symmetry.

Run: `npx vitest run src/pipeline.test.ts` → **all pass**.
Run: `npx vitest run` → baseline unchanged.

**Deliverable gate**: param override tests pass; no regression.

---

## T6 — Admin UI: Pipeline tab in workflow editor

**Goal**: add a "Pipeline" tab to `Workflows.tsx` that shows the 8 checks as a list with
Switcher (on/off), up/down arrows for order, and collapsible param inputs per check.

### Files

- `admin/src/views/teko/Workflows/Workflows.tsx` (EDIT — add Pipeline tab)
- `admin/src/teko/types.ts` (already edited in T2)

### Interfaces (UI state)

```typescript
type CheckUIEntry = {
  key: string;
  label: string;
  enabled: boolean;
  order: number;
  config: Record<string, unknown>;
};
```

### Steps

**Step 6.1** — Add UI state for the pipeline checks in the `WorkflowsView` component,
initialised when `editing` changes (same pattern as `editingAml`, `editingLiveness`, etc.):

```typescript
// Add to WorkflowsView state:
const [pipelineChecks, setPipelineChecks] = useState<CheckUIEntry[]>([]);

// In the useEffect that sets editing state (when editing changes), add:
const CHECK_META: Array<{ key: string; label: string }> = [
  { key: 'quality',          label: 'Calidad de imagen' },
  { key: 'liveness',         label: 'Prueba de vida' },
  { key: 'document',         label: 'Documento de identidad' },
  { key: 'match',            label: 'Match 1:1 selfie/doc' },
  { key: 'aml',              label: 'Screening AML/PEP' },
  { key: 'face_search',      label: 'Búsqueda facial 1:N' },
  { key: 'proof_of_address', label: 'Comprobante de domicilio' },
  { key: 'age_estimation',   label: 'Estimación de edad' },
];

const existingPipeline = wf.definition.pipeline?.checks ?? [];
const initialChecks = CHECK_META.map((m, i) => {
  const existing = existingPipeline.find(e => e.key === m.key);
  const enabled = existing
    ? existing.enabled
    : ['quality', 'document'].includes(m.key) || false; // defaults
  return {
    key: m.key,
    label: m.label,
    enabled: existing?.enabled ?? enabled,
    order: existing?.order ?? i,
    config: existing?.config ?? {},
  };
}).sort((a, b) => a.order - b.order);
setPipelineChecks(initialChecks);
```

**Step 6.2** — When building the `definition` object to save, include `pipeline.checks`:

```typescript
// In the save/submit handler, extend the buildDef function:
const pipelineField = pipelineChecks.length > 0
  ? { checks: pipelineChecks.map((c, i) => ({ key: c.key, enabled: c.enabled, order: i, config: c.config })) }
  : undefined;

const def: WorkflowDefinition = {
  document: { required: editingDocument },
  // ... existing fields ...
  pipeline: pipelineField,
};
```

**Step 6.3** — Add the Pipeline tab UI. The existing editor uses `Tabs` from Ecme. Add a
new tab item `{ value: 'pipeline', label: 'Pipeline' }`. In the `TabContent`:

```tsx
<TabContent value="pipeline">
  <div className="space-y-2">
    <p className="text-sm text-gray-500 mb-3">
      Activá, desactivá o reordenás los checks del pipeline para este workflow.
      El orden de ejecución real está fijo por dependencias de datos; el número
      de posición se usa en el editor.
    </p>
    {pipelineChecks.map((check, idx) => (
      <Card key={check.key} className="p-3">
        <div className="flex items-center gap-3">
          {/* Reorder arrows */}
          <div className="flex flex-col gap-1">
            <Button
              size="xs"
              variant="plain"
              disabled={idx === 0}
              onClick={() => {
                const next = [...pipelineChecks];
                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                setPipelineChecks(next);
              }}
            >▲</Button>
            <Button
              size="xs"
              variant="plain"
              disabled={idx === pipelineChecks.length - 1}
              onClick={() => {
                const next = [...pipelineChecks];
                [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                setPipelineChecks(next);
              }}
            >▼</Button>
          </div>

          {/* Switcher */}
          <Switcher
            checked={check.enabled}
            onChange={(val: boolean) => {
              const next = [...pipelineChecks];
              next[idx] = { ...next[idx], enabled: val };
              setPipelineChecks(next);
            }}
          />

          {/* Label + key */}
          <div className="flex-1">
            <span className="font-medium text-sm">{check.label}</span>
            <span className="ml-2 text-xs text-gray-400">{check.key}</span>
          </div>

          {/* Config params — shown when check has configurable options */}
          {['liveness', 'match', 'aml', 'face_search'].includes(check.key) && (
            <Input
              size="sm"
              placeholder="threshold"
              className="w-28"
              value={String(check.config?.threshold ?? '')}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const val = e.target.value;
                const next = [...pipelineChecks];
                next[idx] = {
                  ...next[idx],
                  config: { ...next[idx].config, threshold: val ? Number(val) : undefined },
                };
                setPipelineChecks(next);
              }}
            />
          )}
          {check.key === 'age_estimation' && (
            <Input
              size="sm"
              placeholder="minAge"
              className="w-24"
              value={String(check.config?.minAge ?? '')}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const val = e.target.value;
                const next = [...pipelineChecks];
                next[idx] = {
                  ...next[idx],
                  config: { ...next[idx].config, minAge: val ? Number(val) : undefined },
                };
                setPipelineChecks(next);
              }}
            />
          )}
        </div>
      </Card>
    ))}
  </div>

  {/* Live LoA preview — recomputed from enabled checks */}
  <div className="mt-3 text-sm text-gray-500">
    LoA efectivo:{' '}
    <strong>
      {pipelineChecks.find(c => c.key === 'liveness' && c.enabled) ? 'L3'
        : pipelineChecks.find(c => c.key === 'match' && c.enabled) ? 'L2'
        : 'L1'}
    </strong>
    {' '}(derivado de checks activos)
  </div>
</TabContent>
```

Run: `npx vitest run` → full suite still at baseline (UI changes don't affect backend tests).

**Deliverable gate**: workflow editor shows Pipeline tab; save/load round-trips
`definition.pipeline.checks` through PUT /workflows/:name; LoA preview updates on toggle.

---

## T7 — End-to-end verification + regression

**Goal**: confirm the full feature works end-to-end and no regressions exist.

### Steps

**Step 7.1** — Full test suite:

```bash
npx vitest run
```

Expected: ~437 pass, 1 skip (`consentShouldTransition`). Any new failure = blocker.

**Step 7.2** — TypeScript strict check:

```bash
npx tsc --noEmit
```

Expected: 0 errors. Any `any` cast added in T4/T5 must be documented with a comment.

**Step 7.3** — Manual admin UI smoke test (using the `/run` skill or manual browser):
1. Open a workflow in the admin → verify "Pipeline" tab appears.
2. Toggle "Prueba de vida" OFF → verify LoA preview drops from L3 to L2.
3. Save → reload page → verify the toggle state persists (round-trip via PUT /workflows).
4. Set a threshold override (e.g. match = 0.55) → save → verify `config.threshold` appears
   in `definition.pipeline.checks` via GET /workflows response.

**Step 7.4** — Add one integration-style test confirming the Admin API round-trip
(no DB — mock the workflow repo):

```typescript
// src/pipeline/integration.test.ts (NEW)
import { describe, it, expect } from 'vitest';
import { resolveCheckList } from './resolver';
import { assuranceFromDefinition } from '../lib/workflow';
import type { WorkflowDefinition } from '../types';

describe('Fase 3 integration: pipeline.checks round-trip', () => {
  it('round-trip: save definition → resolve → disable liveness → LoA=L2', () => {
    const saved: WorkflowDefinition = {
      document: { required: true },
      match: { required: true },
      liveness: { required: true, mode: 'passive' },
      pipeline: {
        checks: [
          { key: 'liveness', enabled: false, order: 1 },
          { key: 'match',    enabled: true,  order: 3, config: { threshold: 0.55 } },
        ],
      },
    };
    const resolved = resolveCheckList(saved);
    const loa = assuranceFromDefinition(saved);

    expect(resolved.get('liveness')!.enabled).toBe(false);
    expect(resolved.get('match')!.enabled).toBe(true);
    expect(resolved.get('match')!.config).toEqual({ threshold: 0.55 });
    expect(resolved.get('quality')!.enabled).toBe(true);
    expect(loa).toBe('L2');
  });

  it('round-trip: no pipeline.checks → defaults identical to L3 required fields', () => {
    const saved: WorkflowDefinition = {
      document: { required: true },
      match: { required: true },
      liveness: { required: true, mode: 'passive' },
    };
    const resolved = resolveCheckList(saved);
    expect(resolved.get('liveness')!.enabled).toBe(true);
    expect(resolved.get('match')!.enabled).toBe(true);
    expect(resolved.get('aml')!.enabled).toBe(false);
    expect(assuranceFromDefinition(saved)).toBe('L3');
  });
});
```

Run: `npx vitest run src/pipeline/integration.test.ts` → **all pass**.
Run: `npx vitest run` → full baseline pass.

**Deliverable gate**: full suite passes; tsc clean; admin UI round-trip confirmed.

---

## Self-Review

### Spec §3.2 coverage

| Requirement | Covered |
|---|---|
| `registerCheck({key,label,version,run})` | T1 — registry (metadata; `run` intentionally absent to preserve injection seam; documented design decision) |
| `workflow.definition.pipeline.checks: [{key,enabled,order,config}]` | T2 type + T4 persistence in WorkflowDefinition |
| Pipeline iterates registry per list | T4 refactor (spine fixed, guarded by enabled) |
| Activate/deactivate checks per workflow without deploy | T4 + T6 UI |
| Reorder checks | T6 UI (order field); execution spine fixed — stated scope explicitly |
| Parametrize checks (thresholds) | T5 config overrides |
| Defaults = 8 checks, current order, all enabled | T3 resolver (defaultEnabled derives from required fields; absent pipeline.checks = today's behavior) |
| Fail-closed preserved | T4 (guards additive; failure paths untouched) |
| Editor admin with checks on/off/reorder/params | T6 |

### No placeholders

All code blocks in this document are complete and directly implementable.

### Types consistent

`PipelineCheckEntry` in `src/types.ts` is the canonical definition; `admin/src/teko/types.ts`
mirrors it manually (same pattern as all other admin types).

### Non-regression emphasis

- T4 writes regression tests BEFORE refactoring pipeline.ts.
- Existing `pipeline.test.ts` must pass UNMODIFIED — if any existing test breaks, stop and
  diagnose before proceeding.
- The `resolvedChecks.get(key)?.enabled !== false` pattern (falsy check, not `=== true`)
  means absent entry = enabled, preserving today's full-run behaviour when no pipeline.checks
  are configured.

### Known scope exclusions (stated, not silent)

- **Arbitrary execution reorder** (true DAG executor): deferred. `order` field = UI display
  only in Fase 3. Stated in Global Constraint 4 and T6 UI copy.
- **Registry `run` function**: intentionally not implemented to preserve injection seam.
  Stated in Global Constraint 3.
- **System-level pipeline defaults via Config Plane**: `resolveConfig` is available but not
  wired for `pipeline.checks` in Fase 3 (workflow-level config is sufficient). The
  namespace='pipeline', key='checks' slot in `config_values` is reserved for a future
  iteration.
- **Admin API new endpoints**: none needed — existing `PUT /admin/tenants/:id/workflows/:name`
  saves the full `WorkflowDefinition` (including `pipeline` field) unchanged.
