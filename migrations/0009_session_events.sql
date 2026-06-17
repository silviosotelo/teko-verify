-- 0009_session_events.sql
-- =============================================================================
-- P0 #3 — Timeline forense de eventos + Device & IP analysis.
--
-- Inspirado en Didit (docs/specs/didit-platform-analysis.md): "timeline forense
-- con device/IP/geo por paso" + tab Eventos + Device & IP analysis.
--
-- Cada paso del ciclo de vida de la captura (session.created, consent.accepted,
-- document.*.captured, selfie.captured, liveness.completed, checks.computed,
-- decision.made, review.decided, …) deja una fila append-only con su CONTEXTO:
--   * ip          → IP real del titular (CF-Connecting-IP tras el túnel Cloudflare).
--   * country     → país del IP (CF-IPCountry, gratis del túnel).
--   * user_agent  → User-Agent crudo del navegador.
--   * device      → parseo liviano del UA (os/browser/type) en JSONB.
--   * meta        → datos del paso (scores, motivos, decisión, etc.) en JSONB.
--
-- Multi-tenant: tenant_id (FK CASCADE) para aislamiento. session_id NOT NULL
-- (todo evento pertenece a una sesión). Append-only: sin update/delete.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS. Fail-open en la app: registrar
-- un evento NUNCA debe romper el flujo de captura/pipeline.
-- =============================================================================

CREATE TABLE IF NOT EXISTS session_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES verification_sessions(id) ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        text        NOT NULL,
  ip          text,
  country     text,
  user_agent  text,
  device      jsonb       NOT NULL DEFAULT '{}',
  meta        jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Timeline de una sesión: orden cronológico ascendente por sesión.
CREATE INDEX IF NOT EXISTS idx_session_events_session
  ON session_events (session_id, created_at ASC);
-- Consultas por tenant (auditoría/analítica cross-sesión).
CREATE INDEX IF NOT EXISTS idx_session_events_tenant
  ON session_events (tenant_id, created_at DESC);
