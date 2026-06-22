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
  /** UI display order (not execution order — spine is fixed). */
  order: number;
  /** Merged param overrides from pipeline.checks[].config. */
  config: Record<string, unknown>;
}

/** Map from check key to its resolved (effective) config for this session. */
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
