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
