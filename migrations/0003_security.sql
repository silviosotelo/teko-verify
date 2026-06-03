-- =============================================================================
-- Teko Verify — hardening de seguridad cross-cutting (§8 Seguridad, §9 fail-closed).
--
-- 1) webhook_secret por tenant: cada tenant firma SUS webhooks con su propio
--    secreto HMAC (no un TEKO_WEBHOOK_SECRET global). Backfill seguro para no
--    romper tenants existentes; luego NOT NULL + DEFAULT para inserts futuros.
-- 2) admin_operators: reemplaza el token estático único de admin por operadores
--    con password_hash (scrypt) + rol (AdminRole). Comparación en tiempo constante
--    en código (safeEqual). El secreto NUNCA se persiste en plano.
--
-- pgcrypto ya fue habilitado en 0001 (gen_random_uuid / gen_random_bytes).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tenants.webhook_secret — secreto HMAC por tenant (§8). Nunca expuesto al titular
-- ni en TenantResponse; solo se usa server-side para firmar el webhook del tenant
-- DUEÑO de la sesión. Migración en 3 pasos para poblar tablas existentes:
--   a) agregar nullable
--   b) backfill con 32 bytes aleatorios hex (256 bits) para filas previas
--   c) NOT NULL + DEFAULT (cubre inserts futuros sin pasar el valor desde código)
-- -----------------------------------------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_secret text;

UPDATE tenants
   SET webhook_secret = encode(gen_random_bytes(32), 'hex')
 WHERE webhook_secret IS NULL;

ALTER TABLE tenants
  ALTER COLUMN webhook_secret SET DEFAULT encode(gen_random_bytes(32), 'hex');
ALTER TABLE tenants
  ALTER COLUMN webhook_secret SET NOT NULL;

-- -----------------------------------------------------------------------------
-- admin_operators — operador del dashboard admin con auth/roles propios (§8.C).
-- El secreto NUNCA se persiste en plano: solo password_hash (formato scrypt:
-- "scrypt$<saltHex>$<hashHex>"). username guarda el identificador de login
-- (en la práctica un email; el DTO AdminLoginRequest lo llama `email`).
-- role ∈ AdminRole (owner|operator|viewer).
-- -----------------------------------------------------------------------------
CREATE TABLE admin_operators (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'operator'
                            CHECK (role IN ('owner', 'operator', 'viewer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_operators_username ON admin_operators (username);
