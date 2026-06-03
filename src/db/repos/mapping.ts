/**
 * Helpers de mapeo fila-PG → tipo de dominio (types.ts).
 *
 * Por qué existe: types.ts es la fuente de verdad y exige conversiones que el
 * driver pg NO hace solo:
 *   - snake_case (columnas) → camelCase (campos): cada repo lo hace explícito.
 *   - timestamptz → string ISO 8601: pg devuelve `Date`; types.ts pide `string`.
 *     `iso()` centraliza ese .toISOString() (el error más fácil de cometer).
 *   - JSONB: pg ya lo parsea a objeto en lectura y lo serializa en escritura.
 *   - bytea: pg lo devuelve como Buffer (lo que pide VerifiedIdentity.faceEmbedding).
 */

/** timestamptz NOT NULL → ISO 8601 string. */
export function iso(value: Date): string {
  return value.toISOString();
}

/** timestamptz NULL-able → ISO 8601 string | null. */
export function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
