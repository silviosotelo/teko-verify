// src/lib/fieldValidation.ts
import type { ExtractedDocument } from '../types'
import type { FieldDefinition, FieldValidationRules } from '../db/repos/extractionFields'

export interface ValidationResult { ok: boolean; reason?: string }

/**
 * Reads a value from `extracted` following a dotted path (e.g. "titular.apellidos",
 * "titular.lugarNacimiento.ciudad"). Returns `undefined` if the path does not exist.
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
 * Validates a single value against declarative rules.
 * PURE — never throws. Fail-closed: internal error → { ok:false, reason:'internal_error' }.
 *
 * `required` uses the same semantics as `!!value` from the original hardcoded validators:
 *   empty string, null, undefined → fails.
 *
 * `regex` is skipped if the value is empty and not required (absent field is valid).
 *
 * An invalid regex pattern (bad syntax) → fail-closed { ok:false } — never passes by default.
 */
/** All rule keys the engine actually evaluates. Any other key → fail-closed. */
const RECOGNIZED_RULE_KEYS = new Set<string>(['required', 'regex', 'normalize', 'dateRange'])

/** ISO date pattern YYYY-MM-DD — required for safe lexicographic dateRange comparison. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateField(value: unknown, rules: FieldValidationRules): ValidationResult {
  try {
    // FAIL-CLOSED: any unrecognized rule key means the engine cannot honour the constraint.
    const unknownKeys = Object.keys(rules).filter(k => !RECOGNIZED_RULE_KEYS.has(k))
    if (unknownKeys.length > 0) return { ok: false, reason: 'unknown_rule' }

    if (rules.required && !value) {
      return { ok: false, reason: 'required' }
    }
    if (rules.regex !== undefined) {
      // FAIL-CLOSED: regex value must be a string at runtime (JSONB may send anything).
      if (typeof rules.regex !== 'string') return { ok: false, reason: 'invalid_regex' }
      if (typeof value === 'string' && value !== '') {
        let re: RegExp
        try {
          re = new RegExp(rules.regex)
        } catch {
          // Invalid regex → fail-closed: do NOT pass the value through
          return { ok: false, reason: 'invalid_regex' }
        }
        if (!re.test(value)) return { ok: false, reason: `regex:${rules.regex}` }
      }
    }
    if (rules.dateRange !== undefined && typeof value === 'string' && value !== '') {
      // FAIL-CLOSED: require ISO YYYY-MM-DD before lexicographic comparison.
      if (!ISO_DATE_RE.test(value)) return { ok: false, reason: 'invalid_date' }
      if (rules.dateRange.minIso && value < rules.dateRange.minIso) {
        return { ok: false, reason: `dateRange:min=${rules.dateRange.minIso}` }
      }
      if (rules.dateRange.maxIso && value > rules.dateRange.maxIso) {
        return { ok: false, reason: `dateRange:max=${rules.dateRange.maxIso}` }
      }
    }
    // normalize: transformation only (future use); never produces a validation error.
    return { ok: true }
  } catch {
    return { ok: false, reason: 'internal_error' }
  }
}

/**
 * Applies FieldDefinition[] rules over a full ExtractedDocument.
 * Fail-closed: any unhandled exception → { requiredPresent:false, failures:['__error__'] }.
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
