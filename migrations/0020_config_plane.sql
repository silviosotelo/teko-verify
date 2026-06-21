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
