-- migrations/0021_tenant_integrations.sql
-- =============================================================================
-- Fase 2 — Proveedores por tenant.
-- tenant_integrations: una fila por (tenant_id, kind). El campo `config` guarda
-- la configuración del proveedor CIFRADA con AES-256-GCM (helpers en src/lib/secrets.ts).
-- Formato del blob cifrado: { "enc": "gcm$<iv>$<tag>$<cipher>" }.
-- Para providers sin secretos (storage), config es JSONB plano.
-- Idempotente: CREATE TABLE IF NOT EXISTS + NOT EXISTS checks.
-- SMS: la tabla lo soporta pero el provider de envío SMS es trabajo futuro.
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_integrations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('smtp', 'storage', 'aml', 'sms')),
  config      jsonb       NOT NULL DEFAULT '{}',
  enabled     boolean     NOT NULL DEFAULT true,
  updated_by  text        NOT NULL DEFAULT 'system',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_tenant_integrations_tenant
  ON tenant_integrations (tenant_id, kind)
  WHERE enabled = true;
