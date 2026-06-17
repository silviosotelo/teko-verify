-- 0012_document_type.sql
-- =============================================================================
-- P1 #3 — Multi-documento / multi-país (framework + PASAPORTE).
--
-- La sesión ahora lleva el TIPO DE DOCUMENTO elegido (cédula PY por default,
-- pasaporte como segundo tipo soportado). El módulo `document` rutea la extracción
-- según esta columna. Snapshot persistido: lo fija el tenant al crear la sesión
-- (CreateSessionRequest.documentType) o el titular en la pantalla "Elegir documento"
-- al subir el documento (POST /verify/:token/document).
--
-- NOT NULL DEFAULT 'ci_py': las sesiones existentes y cualquier creación que NO
-- especifique el tipo quedan en cédula PY → comportamiento idéntico al actual (no
-- rompe captura/pipeline/workflows/webhooks ni la cédula PY).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + recreación del CHECK. Extensible: para
-- sumar más tipos (dni_ar, cedula_xx, ...) agregá el literal al CHECK en una
-- migración futura, en línea con el patrón de verification_checks.type.
-- =============================================================================

ALTER TABLE verification_sessions
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'ci_py';

ALTER TABLE verification_sessions
  DROP CONSTRAINT IF EXISTS verification_sessions_document_type_check;
ALTER TABLE verification_sessions
  ADD CONSTRAINT verification_sessions_document_type_check
  CHECK (document_type IN ('ci_py', 'passport'));
