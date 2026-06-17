-- 0007_workflows_review.sql
-- =============================================================================
-- P0 #1 — Workflows configurables/versionados + estado in_review + revisión manual.
--
-- Reemplaza el L1/L2/L3 FIJO por la arquitectura de Didit (Workflow → Session):
--   * Tabla `workflows` por tenant, VERSIONADA (editar = nueva versión).
--   * La sesión referencia la versión usada y guarda un SNAPSHOT JSONB de la
--     definición (qué checks corren, umbrales, política de revisión).
--   * Nuevo estado `in_review` (cola de revisión humana) + columnas de revisor.
--
-- COMPATIBILIDAD (nada se rompe):
--   * Las sesiones existentes NO tienen snapshot → el pipeline cae al comportamiento
--     previo (assurance_required L1/L2/L3 fijo). Idéntico bit-a-bit.
--   * Se siembran 3 workflows "default" por tenant (default-l1/-l2/-l3) que mapean
--     EXACTAMENTE a L1/L2/L3 (mismos checks, sin revisión). Las sesiones nuevas sin
--     workflowId snapshotean uno de ellos → comportamiento idéntico al actual.
--
-- MÁQUINA DE ESTADOS (diagrama, mapeo conceptual Didit ↔ Teko):
--   created → capturing(in_progress) → processing → review → in_review?
--           → verified(approved) | rejected(declined) | needs_recapture
--           → expired | error
--   `in_review` es el estado de COLA DE REVISIÓN HUMANA (no terminal): un operador
--   lo resuelve a verified|rejected. Conceptualmente: verified≡approved,
--   rejected≡declined, capturing≡in_progress. Se conservan los nombres actuales
--   (alias) para no romper front/admin/webhooks; el CHECK acepta también los
--   nombres Didit por si se adoptan más adelante (permisivo, sin productor hoy).
-- Idempotente: DROP IF EXISTS + ADD COLUMN IF NOT EXISTS + ON CONFLICT DO NOTHING.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- workflows — definición versionada de checks/umbrales/revisión, por tenant.
-- Editar un workflow (mismo `name`) crea una NUEVA fila con version+1; la versión
-- "vigente" de un nombre = max(version). Las sesiones snapshotean la def usada.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflows (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  definition  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflows_tenant ON workflows (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_tenant_name_version
  ON workflows (tenant_id, name, version);

-- -----------------------------------------------------------------------------
-- verification_sessions — referencia al workflow usado + snapshot + revisor.
-- workflow_id NULLABLE (sesiones viejas y default-virtual no lo setean); FK simple
-- a workflows con ON DELETE SET NULL (borrar una versión no borra la sesión).
-- -----------------------------------------------------------------------------
ALTER TABLE verification_sessions
  ADD COLUMN IF NOT EXISTS workflow_id       uuid
    REFERENCES workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_version  integer,
  ADD COLUMN IF NOT EXISTS workflow_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_by       text,
  ADD COLUMN IF NOT EXISTS reviewed_at       timestamptz;

-- Relaja el CHECK de estado para incluir `in_review` (cola de revisión humana) y,
-- de forma permisiva, los nombres Didit (in_progress/approved/declined/abandoned)
-- por si se adoptan luego. Hoy el código canónico usa: created/capturing/processing/
-- review/in_review/verified/rejected/needs_recapture/expired/error.
ALTER TABLE verification_sessions
  DROP CONSTRAINT IF EXISTS verification_sessions_state_check;
ALTER TABLE verification_sessions
  ADD CONSTRAINT verification_sessions_state_check
  CHECK (state IN (
    'created', 'capturing', 'processing', 'review', 'in_review',
    'verified', 'rejected', 'needs_recapture', 'expired', 'error',
    -- alias Didit (permitidos; sin productor hoy):
    'in_progress', 'approved', 'declined', 'abandoned'));

CREATE INDEX IF NOT EXISTS idx_sessions_in_review
  ON verification_sessions (state) WHERE state = 'in_review';

-- -----------------------------------------------------------------------------
-- Siembra de los 3 workflows default (L1/L2/L3) para CADA tenant existente.
-- Mapean exactamente a la escalera actual: L1=document; L2=+match; L3=+liveness.
-- review.mode='auto' = sin revisión humana (auto-decisión, comportamiento actual).
-- -----------------------------------------------------------------------------
INSERT INTO workflows (tenant_id, name, version, definition, is_default)
SELECT t.id, d.name, 1, d.definition::jsonb, true
FROM tenants t
CROSS JOIN (VALUES
  ('default-l1',
   '{"document":{"required":true},"quality":{},"review":{"mode":"auto"}}'),
  ('default-l2',
   '{"document":{"required":true},"match":{"required":true},"quality":{},"review":{"mode":"auto"}}'),
  ('default-l3',
   '{"document":{"required":true},"match":{"required":true},"liveness":{"required":true,"mode":"active"},"quality":{},"review":{"mode":"auto"}}')
) AS d(name, definition)
ON CONFLICT (tenant_id, name, version) DO NOTHING;
