-- 0006_liveness_video.sql
-- Agrega el tipo de evidencia 'liveness_video': el video completo de la sesión de
-- LIVENESS ACTIVO interactivo (webm/mp4 grabado con MediaRecorder en el navegador).
-- Es la evidencia auditable de que la persona ejecutó los desafíos guiados (girar la
-- cabeza, parpadear, sonreír) en vivo frente a la cámara. ADITIVO: no toca filas
-- existentes; sólo relaja el CHECK de evidence.type (mismo patrón que 0005).
-- Idempotente vía DROP IF EXISTS.

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_type_check;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_type_check
  CHECK (type IN (
    'selfie', 'doc_front', 'doc_back', 'frames',
    'doc_front_raw', 'doc_back_raw',
    'liveness_video'));
