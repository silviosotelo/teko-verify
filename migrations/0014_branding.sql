-- =============================================================================
-- White-label por tenant (P1 #5) + capa App liviana (NO-breaking).
--
-- A) Branding por tenant: columna JSONB `branding` en tenants. Default '{}' ⇒ la
--    resolución (lib/branding.ts) cae al branding Teko (verde #16a34a). Los tenants
--    existentes NO cambian: sin branding propio se ven exactamente como hoy.
--
-- B) App layer (aditiva, opcional): tabla `apps` como agrupador OPCIONAL debajo del
--    tenant (el tenant sigue siendo el top-level). Se siembra UNA app default por
--    tenant existente para compatibilidad. `verification_sessions.app_id` opcional
--    (FK COMPUESTA (tenant_id, app_id) → una sesión nunca apunta a una app de otro
--    tenant). NADA exige app_id: el modelo tenant actual queda intacto.
--
-- Idempotente: IF NOT EXISTS / ON CONFLICT en todo. Re-correr no rompe nada.
-- =============================================================================

-- A) Branding por tenant ------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;

-- B) App layer liviana --------------------------------------------------------
CREATE TABLE IF NOT EXISTS apps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Habilita la FK compuesta (tenant_id, id) desde verification_sessions: defensa
  -- cross-tenant a nivel DB (una sesión jamás referencia una app de otro tenant).
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_apps_tenant ON apps (tenant_id);

-- Una app default por tenant existente (compatibilidad). Idempotente: solo siembra
-- si el tenant aún no tiene NINGUNA app.
INSERT INTO apps (tenant_id, name, is_default)
SELECT t.id, 'Default', true
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM apps a WHERE a.tenant_id = t.id);

-- app_id OPCIONAL en sesiones (NULL = comportamiento actual). FK COMPUESTA.
ALTER TABLE verification_sessions
  ADD COLUMN IF NOT EXISTS app_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessions_app'
  ) THEN
    -- NO ACTION (default): borrar una app EN USO por sesiones falla (RESTRICT de
    -- hecho). No usamos SET NULL porque la FK es compuesta y pondría tenant_id NULL
    -- (NOT NULL). Al borrar el tenant, la sesión ya cae por CASCADE de tenant_id.
    ALTER TABLE verification_sessions
      ADD CONSTRAINT fk_sessions_app
      FOREIGN KEY (tenant_id, app_id) REFERENCES apps (tenant_id, id);
  END IF;
END$$;
