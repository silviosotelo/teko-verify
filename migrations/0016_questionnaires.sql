-- 0016_questionnaires.sql
-- =============================================================================
-- P2 — Questionnaires (formularios custom por workflow).
--
-- Un workflow puede incluir un CUESTIONARIO de preguntas custom que el solicitante
-- responde durante el flujo de captura; las respuestas quedan en la sesión y se ven
-- en el admin. Modelo Didit (Questionnaires) — implementación PROPIA.
--
-- 1) questionnaires        — set de preguntas por tenant (JSONB), versionado + activo.
-- 2) questionnaire_answers — respuestas del solicitante por SESIÓN (JSONB), 1:1 con la
--                            sesión (UNIQUE tenant_id, session_id → upsert idempotente).
--
-- El workflow referencia un questionnaire por id en su definición JSONB
-- (`definition.questionnaire.questionnaireId`); no hay columna FK desde workflows
-- (la def es un snapshot libre, igual que el resto de checks/umbrales).
--
-- Idempotente (CREATE TABLE IF NOT EXISTS + IF NOT EXISTS en índices). NO toca filas
-- ni comportamiento existente: SOLO agrega tablas nuevas. En línea con el patrón de
-- 0007 (workflows) / 0008 (webhooks) / 0009 (session_events).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- questionnaires — set de preguntas custom por tenant. `questions` JSONB =
-- [{id, label, type, options?, required}]. `version` se bumpea al editar las
-- preguntas; `active` permite deshabilitar sin borrar (las sesiones que lo
-- referenciaron conservan sus respuestas).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS questionnaires (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  questions   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  version     integer     NOT NULL DEFAULT 1,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questionnaires_tenant ON questionnaires (tenant_id);

-- -----------------------------------------------------------------------------
-- questionnaire_answers — respuestas del solicitante por SESIÓN. FK COMPUESTA
-- (tenant_id, session_id) → verification_sessions (defensa cross-tenant a nivel DB,
-- §10) con ON DELETE CASCADE (supresión §12 arrastra las respuestas). UNIQUE por
-- sesión: una sola fila de respuestas por sesión (upsert). questionnaire_id guarda
-- a qué questionnaire respondió (ON DELETE SET NULL: borrar el questionnaire no
-- borra las respuestas ya dadas).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS questionnaire_answers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  session_id       uuid        NOT NULL,
  questionnaire_id uuid        REFERENCES questionnaires(id) ON DELETE SET NULL,
  answers          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_qa_session FOREIGN KEY (tenant_id, session_id)
    REFERENCES verification_sessions (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_qa_session UNIQUE (tenant_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_session ON questionnaire_answers (tenant_id, session_id);
