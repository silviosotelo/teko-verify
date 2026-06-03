-- =============================================================================
-- Teko Verify — esquema inicial (multi-tenant, PostgreSQL propio).
-- Spec §5 (modelo de datos), §6 (estados/LoA), §9 (fail-closed + idempotencia),
-- §10 (aislamiento cross-tenant), §12 (cumplimiento Ley 7593/2025).
--
-- Reglas duras aplicadas en el esquema:
--   - tenant_id en TODAS las tablas hijas; PKs uuid; FKs con ON DELETE CASCADE.
--   - Aislamiento cross-tenant reforzado a nivel DB: las tablas hijas referencian
--     verification_sessions por FK COMPUESTA (tenant_id, session_id) → así una
--     fila NUNCA puede apuntar a una sesión de otro tenant (no solo en código).
--   - CHECK sobre cada unión de strings de types.ts (estados, tipos) = integridad.
--   - JSONB donde el spec lo indica (policies, result, detail, audit detail).
-- =============================================================================

-- gen_random_uuid() es core desde PG13; pgcrypto lo garantiza en versiones viejas.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- tenants — organizaciones consumidoras (§5). No lleva tenant_id: se scopea por id.
-- -----------------------------------------------------------------------------
CREATE TABLE tenants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        NOT NULL UNIQUE,
  status      text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended', 'disabled')),
  policies    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- api_keys — auth por tenant (§5). Solo key_hash (nunca el secreto plano).
-- Lookup de auth por key_hash NO es tenant-scopeado: el tenant se deriva DE la key.
-- -----------------------------------------------------------------------------
CREATE TABLE api_keys (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash     text        NOT NULL UNIQUE,
  prefix       text        NOT NULL,
  label        text        NOT NULL,
  scopes       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status       text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'revoked')),
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);

-- -----------------------------------------------------------------------------
-- verification_sessions — una verificación = una sesión (§5/§6).
-- Estados (§6 + §9 'error'): created, capturing, processing, verified, rejected,
-- needs_recapture, expired, error. UNIQUE(tenant_id, id) habilita la FK compuesta
-- de las tablas hijas (defensa cross-tenant a nivel DB, §10).
-- -----------------------------------------------------------------------------
CREATE TABLE verification_sessions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_ref       text,
  state              text        NOT NULL DEFAULT 'created'
                                 CHECK (state IN (
                                   'created', 'capturing', 'processing',
                                   'verified', 'rejected', 'needs_recapture',
                                   'expired', 'error')),
  link_token         text        NOT NULL UNIQUE,
  callback_url       text,
  assurance_required text        NOT NULL DEFAULT 'L3'
                                 CHECK (assurance_required IN ('L0','L1','L2','L3','L4')),
  redirect_url       text,
  locale             text        NOT NULL DEFAULT 'es',
  recapture_count    integer     NOT NULL DEFAULT 0,
  expires_at         timestamptz NOT NULL,
  completed_at       timestamptz,
  result             jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Habilita la FK compuesta desde las tablas hijas (anti cross-tenant, §10).
  CONSTRAINT uq_sessions_tenant_id UNIQUE (tenant_id, id)
);
CREATE INDEX idx_sessions_tenant ON verification_sessions (tenant_id);
CREATE INDEX idx_sessions_tenant_state ON verification_sessions (tenant_id, state);
-- Idempotencia de creación (§9): un external_ref único por tenant cuando está presente.
CREATE UNIQUE INDEX uq_sessions_tenant_external_ref
  ON verification_sessions (tenant_id, external_ref)
  WHERE external_ref IS NOT NULL;

-- -----------------------------------------------------------------------------
-- verification_checks — resultado granular por módulo, auditable (§5).
-- FK compuesta (tenant_id, session_id): imposible referenciar sesión de otro tenant.
-- -----------------------------------------------------------------------------
CREATE TABLE verification_checks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid        NOT NULL,
  tenant_id  uuid        NOT NULL,
  type       text        NOT NULL
                         CHECK (type IN ('quality', 'liveness', 'document', 'match')),
  score      double precision,
  passed     boolean     NOT NULL,
  detail     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_checks_session
    FOREIGN KEY (tenant_id, session_id)
    REFERENCES verification_sessions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_checks_tenant ON verification_checks (tenant_id);
CREATE INDEX idx_checks_session ON verification_checks (tenant_id, session_id);

-- -----------------------------------------------------------------------------
-- verified_identities — identidad verificada resultante (§5).
-- face_embedding: bytea (512D float32 = 2048 bytes), separable de las imágenes (§12).
-- -----------------------------------------------------------------------------
CREATE TABLE verified_identities (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  session_id      uuid        NOT NULL,
  ci              text        NOT NULL,
  nombre          text        NOT NULL,
  fecha_nac       text        NOT NULL,
  nacionalidad    text        NOT NULL,
  tipo_doc        text        NOT NULL DEFAULT 'ci_py'
                              CHECK (tipo_doc IN ('ci_py')),
  assurance_level text        NOT NULL
                              CHECK (assurance_level IN ('L0','L1','L2','L3','L4')),
  face_embedding  bytea       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_identities_session
    FOREIGN KEY (tenant_id, session_id)
    REFERENCES verification_sessions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_identities_tenant ON verified_identities (tenant_id);
CREATE INDEX idx_identities_session ON verified_identities (tenant_id, session_id);
CREATE INDEX idx_identities_tenant_ci ON verified_identities (tenant_id, ci);

-- -----------------------------------------------------------------------------
-- evidence — imágenes en disco/CIFS + hash de integridad (§5, cadena de custodia §12).
-- -----------------------------------------------------------------------------
CREATE TABLE evidence (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL,
  tenant_id    uuid        NOT NULL,
  type         text        NOT NULL
                           CHECK (type IN ('selfie', 'doc_front', 'doc_back', 'frames')),
  storage_path text        NOT NULL,
  sha256       text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_evidence_session
    FOREIGN KEY (tenant_id, session_id)
    REFERENCES verification_sessions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_evidence_tenant ON evidence (tenant_id);
CREATE INDEX idx_evidence_session ON evidence (tenant_id, session_id);

-- -----------------------------------------------------------------------------
-- audit_log — traza para cumplimiento (§5/§12). session_id nullable (eventos de
-- tenant, p.ej. "apikey.created"). Decisión deliberada: FK SIMPLE solo a tenants
-- (NO compuesta a verification_sessions). Razón: la auditoría debe SOBREVIVIR al
-- borrado de la sesión (derecho a supresión §12 borra la sesión, no su traza);
-- una FK compuesta con CASCADE borraría la traza y con SET NULL violaría el NOT
-- NULL de tenant_id. El aislamiento cross-tenant aquí se garantiza en código
-- (el repo siempre scopea por tenant_id al escribir y leer).
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid,
  actor      text        NOT NULL,
  event      text        NOT NULL,
  detail     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON audit_log (tenant_id);
CREATE INDEX idx_audit_session ON audit_log (tenant_id, session_id);

-- -----------------------------------------------------------------------------
-- consents — consentimiento explícito del titular (dato biométrico, §12).
-- -----------------------------------------------------------------------------
CREATE TABLE consents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL,
  tenant_id   uuid        NOT NULL,
  text        text        NOT NULL,
  version     text        NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip          text,
  CONSTRAINT fk_consents_session
    FOREIGN KEY (tenant_id, session_id)
    REFERENCES verification_sessions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_consents_tenant ON consents (tenant_id);
CREATE INDEX idx_consents_session ON consents (tenant_id, session_id);
