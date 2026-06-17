-- 0005_evidence_raw.sql
-- Agrega los tipos de evidencia 'doc_front_raw' / 'doc_back_raw': la imagen CRUDA
-- original del documento (lo que el pipeline realmente OCR-ea), persistida ADEMÁS de
-- 'doc_front'/'doc_back' para poder debuggear la extracción real (no la versión
-- recortada/enderezada). ADITIVO: no toca filas existentes.
--
-- Reemplaza el CHECK de evidence.type para incluir los dos tipos nuevos.
-- Idempotente vía DROP IF EXISTS. La constraint inline original quedó auto-nombrada
-- por Postgres como evidence_type_check.

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_type_check;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_type_check
  CHECK (type IN (
    'selfie', 'doc_front', 'doc_back', 'frames',
    'doc_front_raw', 'doc_back_raw'));
