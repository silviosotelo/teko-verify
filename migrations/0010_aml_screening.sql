-- 0010_aml_screening.sql
-- =============================================================================
-- P1 #1 — Screening AML / PEP / sanciones (matching LOCAL, on-prem).
--
-- Agrega el dataset local de sanciones+PEP (`aml_entities`) y la metadata de
-- refresh (`aml_dataset_meta`), y habilita el nuevo check `aml` en
-- verification_checks. El cruce de nombres corre 100% contra esta tabla local:
-- el nombre/PII del titular NUNCA sale del server (Ley 7593/2025). El dataset se
-- importa con `scripts/aml-import.mjs` (OpenSanctions, ver docs/specs/aml-screening.md).
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS + DROP CONSTRAINT IF EXISTS +
-- ON CONFLICT DO NOTHING. NO depende de extensiones (pg_trgm): el prefiltro coarse
-- usa un índice GIN sobre el arreglo `tokens` (operador && de overlap, nativo).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- aml_entities — copia LOCAL del dataset de sanciones/PEP (OpenSanctions u otra
-- fuente swappable). Una fila por entidad de la lista. `tokens` (arreglo de tokens
-- normalizados de nombre+alias) permite un prefiltro coarse rápido por overlap;
-- el fuzzy matching fino (Jaro-Winkler/token) corre en la app sobre los candidatos.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aml_entities (
  entity_id   text        PRIMARY KEY,          -- id estable de la fuente (OpenSanctions)
  schema      text,                             -- Person / Organization / ...
  name        text        NOT NULL,             -- nombre canónico
  name_norm   text        NOT NULL,             -- nombre normalizado (sin acentos, mayúsc.)
  aliases     jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- nombres alternativos (crudos)
  lists       jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- etiquetas: OFAC/UN/EU/UK/PEP...
  topics      jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- sanction / role.pep / crime...
  countries   jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- países (ISO o nombre)
  birth_date  text,                             -- fecha/año de nacimiento (puede ser parcial)
  source      text        NOT NULL DEFAULT 'opensanctions',
  tokens      text[]      NOT NULL DEFAULT '{}', -- tokens normalizados (nombre + alias)
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Prefiltro coarse por overlap de tokens (GIN nativo de arreglos; sin extensiones).
CREATE INDEX IF NOT EXISTS idx_aml_entities_tokens ON aml_entities USING gin (tokens);

-- -----------------------------------------------------------------------------
-- aml_dataset_meta — versión/conteo del dataset cargado, para mostrar en la UI y
-- saber cuándo se refrescó. Una fila por `source` (p.ej. 'opensanctions').
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aml_dataset_meta (
  source       text        PRIMARY KEY,
  version      text,
  entity_count integer     NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- verification_checks — habilita el tipo de check `aml` (señal/score, NO rechazo
-- duro: el ruteo a revisión lo decide el workflow vía aml.onMatch).
-- -----------------------------------------------------------------------------
ALTER TABLE verification_checks
  DROP CONSTRAINT IF EXISTS verification_checks_type_check;
ALTER TABLE verification_checks
  ADD CONSTRAINT verification_checks_type_check
  CHECK (type IN ('quality', 'liveness', 'document', 'match', 'aml'));

-- -----------------------------------------------------------------------------
-- Siembra un workflow `aml-screening` (no default) por tenant: L2 + screening AML
-- con ruteo a revisión humana ante potential_match. Listo para que el operador lo
-- elija al crear una sesión; no altera los workflows default existentes.
-- -----------------------------------------------------------------------------
INSERT INTO workflows (tenant_id, name, version, definition, is_default)
SELECT t.id, 'aml-screening', 1,
  '{"document":{"required":true},"match":{"required":true},"quality":{},"aml":{"required":true,"threshold":0.85,"onMatch":"review"},"review":{"mode":"auto"}}'::jsonb,
  false
FROM tenants t
ON CONFLICT (tenant_id, name, version) DO NOTHING;
