-- 0013_proof_of_address.sql
-- =============================================================================
-- P1 #4 — Comprobante de domicilio (proof of address).
--
-- Nuevo check CONFIGURABLE `proof_of_address`: el titular sube una factura de
-- servicio / extracto bancario; el OCR extrae titular/domicilio/fecha y se valida
-- que el nombre coincida con la identidad verificada, que sea reciente y que haya
-- domicilio. Señal/score (NO rechazo duro): el ruteo a revisión humana lo decide el
-- workflow (`proofOfAddress.onFail`).
--
-- 1) verification_checks.type → habilita el literal 'proof_of_address'.
-- 2) evidence.type            → habilita el literal 'proof_of_address' (el comprobante
--                               subido; imagen o PDF rasterizado antes de persistir).
--
-- Idempotente (DROP CONSTRAINT IF EXISTS + recreación). NO toca filas existentes ni
-- el comportamiento de los checks/evidencias actuales (sólo AMPLÍA el set permitido).
-- En línea con el patrón de 0010 (aml) / 0011 (face_search) / 0005 / 0006 (evidence).
-- =============================================================================

ALTER TABLE verification_checks
  DROP CONSTRAINT IF EXISTS verification_checks_type_check;
ALTER TABLE verification_checks
  ADD CONSTRAINT verification_checks_type_check
  CHECK (type IN (
    'quality', 'liveness', 'document', 'match', 'aml', 'face_search',
    'proof_of_address'));

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_type_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_type_check
  CHECK (type IN (
    'selfie', 'doc_front', 'doc_back', 'frames',
    'doc_front_raw', 'doc_back_raw',
    'liveness_video',
    'proof_of_address'));
