-- =============================================================================
-- App-scoping (Pieza 2): api_keys / workflows / webhook_endpoints pertenecen a una
-- App bajo la org (tenant), con FALLBACK a la app Default. Aditivo y NO-breaking:
--   - app_id es NULLABLE en todas. NULL = "tenant-wide" (compat con lo existente).
--   - FK COMPUESTA (tenant_id, app_id) → apps(tenant_id, id): una fila jamás
--     referencia una app de otro tenant (defensa cross-tenant a nivel DB).
--   - Backfill: las filas existentes (y las sesiones) se ASIGNAN a la app Default
--     de su tenant, para que la nueva vista por-app las muestre coherentemente.
--
-- apps gana `updated_at` (para el PUT del CRUD) y UNIQUE(tenant_id, name) (no dos
-- apps homónimas en la misma org). La app default por tenant ya la siembra 0014.
--
-- Idempotente: IF NOT EXISTS / guards en pg_constraint. Re-correr no rompe nada.
-- =============================================================================

-- apps: updated_at + nombre único por tenant -------------------------------------
ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_apps_tenant_name') THEN
    ALTER TABLE apps ADD CONSTRAINT uq_apps_tenant_name UNIQUE (tenant_id, name);
  END IF;
END$$;

-- Helper: app Default de un tenant (la marcada is_default, o la más antigua).
-- Se usa en los backfills de abajo vía subconsulta correlacionada.

-- api_keys.app_id ----------------------------------------------------------------
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS app_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_api_keys_app') THEN
    ALTER TABLE api_keys
      ADD CONSTRAINT fk_api_keys_app
      FOREIGN KEY (tenant_id, app_id) REFERENCES apps (tenant_id, id);
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_api_keys_app ON api_keys (tenant_id, app_id);

-- workflows.app_id ---------------------------------------------------------------
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS app_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflows_app') THEN
    ALTER TABLE workflows
      ADD CONSTRAINT fk_workflows_app
      FOREIGN KEY (tenant_id, app_id) REFERENCES apps (tenant_id, id);
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_workflows_app ON workflows (tenant_id, app_id);

-- webhook_endpoints.app_id -------------------------------------------------------
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS app_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_webhook_endpoints_app') THEN
    ALTER TABLE webhook_endpoints
      ADD CONSTRAINT fk_webhook_endpoints_app
      FOREIGN KEY (tenant_id, app_id) REFERENCES apps (tenant_id, id);
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_app ON webhook_endpoints (tenant_id, app_id);

-- índice por app en sesiones (la columna app_id ya la creó 0014) -----------------
CREATE INDEX IF NOT EXISTS idx_sessions_app ON verification_sessions (tenant_id, app_id);

-- =============================================================================
-- Backfill: asigna las filas sin app a la app Default de su tenant. Idempotente
-- (sólo toca app_id IS NULL). La app Default ya existe por 0014.
-- =============================================================================
UPDATE api_keys k SET app_id = d.id
FROM (SELECT DISTINCT ON (tenant_id) tenant_id, id FROM apps
      ORDER BY tenant_id, is_default DESC, created_at ASC) d
WHERE k.tenant_id = d.tenant_id AND k.app_id IS NULL;

UPDATE workflows w SET app_id = d.id
FROM (SELECT DISTINCT ON (tenant_id) tenant_id, id FROM apps
      ORDER BY tenant_id, is_default DESC, created_at ASC) d
WHERE w.tenant_id = d.tenant_id AND w.app_id IS NULL;

UPDATE webhook_endpoints e SET app_id = d.id
FROM (SELECT DISTINCT ON (tenant_id) tenant_id, id FROM apps
      ORDER BY tenant_id, is_default DESC, created_at ASC) d
WHERE e.tenant_id = d.tenant_id AND e.app_id IS NULL;

UPDATE verification_sessions s SET app_id = d.id
FROM (SELECT DISTINCT ON (tenant_id) tenant_id, id FROM apps
      ORDER BY tenant_id, is_default DESC, created_at ASC) d
WHERE s.tenant_id = d.tenant_id AND s.app_id IS NULL;
