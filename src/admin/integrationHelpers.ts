/**
 * Helpers for the tenant integrations admin endpoints (GET + PUT).
 *
 * Extracted as pure functions so they can be unit-tested without mounting
 * the full adminRouter / Express + auth stack.
 */

/** Fields whose names match this pattern are treated as secrets and masked. */
export const SECRET_FIELD_RE = /password|apikey|secret|token|key/i

/**
 * Returns a shallow copy of `config` with every secret field replaced by "***".
 * Used in GET responses so credentials never leave the server in clear text.
 */
export function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    out[k] = SECRET_FIELD_RE.test(k) ? '***' : v
  }
  return out
}

/**
 * Server-side secret-preserving merge for PUT /admin/tenants/:id/integrations/:kind.
 *
 * The UI shows secret fields as "***" (via maskConfig). When the operator submits the
 * form, unchanged secrets come back as "***". We MUST NOT overwrite the real secret
 * with that sentinel value — instead we keep the existing decrypted value as base and
 * only apply incoming fields whose value is NOT "***".
 *
 * NOTE: We base the merge on `existing` unconditionally (regardless of
 * `existing.enabled`). If we gated on `.enabled`, toggling from disabled→enabled
 * while the form still shows "***" would wipe the stored password. The existing
 * fail-closed decrypt already returns `config={}` when decryption fails, so those
 * rows correctly contribute nothing to the base.
 */
export function mergeConfig(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const base: Record<string, unknown> = existing ? { ...existing } : {}
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== '***') base[k] = v
  }
  return base
}
