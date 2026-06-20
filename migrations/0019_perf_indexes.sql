-- 0019_perf_indexes.sql — índices de performance para el listado/analytics de
-- sesiones del panel admin. Las queries de sessions/usage/billing/review-queue
-- filtran por tenant_id (+ state) y SIEMPRE ordenan/recortan por created_at DESC.
-- El esquema base (0001) ya tiene (tenant_id) y (tenant_id, state), pero NINGUNO
-- incluye created_at, así que el ORDER BY created_at DESC LIMIT ... hace sort en
-- memoria sobre todas las filas del tenant. Estos índices cubren el sort.
--
-- NOTA: CREATE INDEX CONCURRENTLY no se puede usar acá (las migraciones corren en
-- transacción). CREATE INDEX normal toma un lock breve; sin tráfico pesado, OK.

-- Listado principal de sesiones por tenant + usage/billing (countInPeriod por
-- rango created_at) + analytics diario. Cubre WHERE tenant_id = $1 ORDER BY
-- created_at DESC y los conteos por ventana de fecha.
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_created
  ON verification_sessions (tenant_id, created_at DESC);

-- Listado filtrado por estado dentro de un tenant (ej. cola de revisión scopeada,
-- filtro de estado en /sessions) ordenado por created_at DESC. Supersetea a
-- idx_sessions_tenant_state (tenant_id, state) para estas queries; el viejo se
-- deja para no romper otros planes, es inofensivo.
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_state_created
  ON verification_sessions (tenant_id, state, created_at DESC);

-- Cola de revisión cross-tenant (GET /admin/review-queue sin tenantId): filtra
-- solo por state = 'in_review' y ordena por created_at DESC.
CREATE INDEX IF NOT EXISTS idx_sessions_state_created
  ON verification_sessions (state, created_at DESC);
