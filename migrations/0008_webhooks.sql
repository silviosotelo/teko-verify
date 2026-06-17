-- 0008_webhooks.sql
-- =============================================================================
-- P0 #2 — Subsistema de webhooks (suscripciones + entrega + reintentos).
--
-- Inspirado en el modelo de Didit (docs/specs/didit-platform-analysis.md §4):
--   * DESTINOS por tenant (webhook_endpoints): URL + secreto + eventos suscritos.
--     El secreto se genera al crear y se muestra UNA sola vez al operador.
--   * ENTREGAS (webhook_deliveries): una fila por (endpoint, evento). Idempotencia
--     vía `event_id` único (va en el header X-Event-Id; el cliente deduplica).
--     Reintentos con backoff: attempts/next_attempt_at; estado pending→delivered|
--     failed|dead. Firma HMAC sobre cuerpo canónico (X-Signature + X-Timestamp).
--
-- Multi-tenant: ambas tablas llevan tenant_id (FK CASCADE) para aislamiento.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS.
-- COMPAT: nada existente cambia. El disparo legacy a session.callbackUrl sigue
--   funcionando (el dispatcher lo trata como destino ad-hoc, endpoint_id NULL).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- webhook_endpoints — suscripción (destino) por tenant.
-- `events` = lista de tipos suscritos; el valor '*' = todos los eventos.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url         text        NOT NULL,
  secret      text        NOT NULL,
  events      text[]      NOT NULL DEFAULT '{}',
  description text,
  enabled     boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_tenant
  ON webhook_endpoints (tenant_id);

-- -----------------------------------------------------------------------------
-- webhook_deliveries — un intento de entrega por (endpoint, evento).
-- endpoint_id NULLABLE: una entrega ad-hoc al callbackUrl de la sesión (compat
--   legacy) no tiene endpoint; `url` y la resolución del secreto la cubren.
-- `url` se SNAPSHOTEA al crear (la entrega no cambia si luego se edita el destino).
-- `event_id` único = clave de idempotencia (header X-Event-Id), estable entre
--   reintentos del MISMO delivery (el cliente deduplica por él).
-- status: pending | delivered | failed | dead.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     uuid        REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id      uuid        REFERENCES verification_sessions(id) ON DELETE SET NULL,
  event_id        text        NOT NULL,
  event_type      text        NOT NULL,
  url             text        NOT NULL,
  payload         jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'pending',
  attempts        integer     NOT NULL DEFAULT 0,
  max_attempts    integer     NOT NULL DEFAULT 4,
  response_code   integer,
  response_body   text,
  error           text,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_deliveries_event_id
  ON webhook_deliveries (event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
  ON webhook_deliveries (endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant
  ON webhook_deliveries (tenant_id, created_at DESC);
