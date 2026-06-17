-- 0011_face_search.sql
-- =============================================================================
-- P1 #2 — Búsqueda facial 1:N (dedup / anti-fraude + KYC reusable / returning user).
--
-- La biometría YA se persiste: `verified_identities.face_embedding` (bytea, 512D
-- float32 = 2048 bytes) guarda el embedding ArcFace del best-frame de la selfie de
-- cada identidad verificada (ver migración 0001 + repos/identities.ts). La búsqueda
-- 1:N REUSA esa columna como galería — NO se duplica el vector en otra columna ni en
-- otra tabla: el escaneo coseno brute-force (modules/faceSearch.ts) decodifica el
-- bytea a Float32Array en Node. Por eso esta migración NO agrega almacenamiento de
-- embeddings; sólo habilita el nuevo check y siembra un workflow de ejemplo.
--
-- Escala (diferido): para decenas/cientos de miles de identidades por tenant, migrar
-- a pgvector (columna `vector(512)` + índice ivfflat/hnsw, operador `<=>`); el
-- escaneo lineal de v1 alcanza para miles. Ver nota en modules/faceSearch.ts.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ON CONFLICT DO NOTHING. Sin extensiones.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- verification_checks — habilita el tipo de check `face_search` (señal/score, NO
-- rechazo duro: el ruteo a revisión ante un duplicado con CI distinto lo decide el
-- workflow vía faceSearch.onDuplicate). Recrea el CHECK incluyendo todos los tipos.
-- -----------------------------------------------------------------------------
ALTER TABLE verification_checks
  DROP CONSTRAINT IF EXISTS verification_checks_type_check;
ALTER TABLE verification_checks
  ADD CONSTRAINT verification_checks_type_check
  CHECK (type IN ('quality', 'liveness', 'document', 'match', 'aml', 'face_search'));

-- -----------------------------------------------------------------------------
-- Índice de soporte para el escaneo de galería 1:N: las identidades verificadas con
-- embedding NO purgado (octet_length(face_embedding)=2048; los tombstones de
-- purgeEmbedding quedan en 0). Acelera `listGallery` (filtra por tenant + descarta
-- purgados) sin depender de pgvector.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_identities_gallery
  ON verified_identities (tenant_id)
  WHERE octet_length(face_embedding) = 2048;

-- -----------------------------------------------------------------------------
-- Siembra un workflow `face-search` (no default) por tenant: L2 + búsqueda facial
-- 1:N con ruteo a revisión humana ante un duplicado (cara conocida con CI distinto).
-- Listo para que el operador lo elija; no altera los workflows default existentes.
-- -----------------------------------------------------------------------------
INSERT INTO workflows (tenant_id, name, version, definition, is_default)
SELECT t.id, 'face-search', 1,
  '{"document":{"required":true},"match":{"required":true},"quality":{},"faceSearch":{"required":true,"threshold":0.55,"onDuplicate":"review"},"review":{"mode":"auto"}}'::jsonb,
  false
FROM tenants t
ON CONFLICT (tenant_id, name, version) DO NOTHING;
