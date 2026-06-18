-- 0017_age_estimation.sql
-- =============================================================================
-- P2 — Estimación de edad facial (age estimation).
--
-- Nuevo check CONFIGURABLE `age_estimation`: corre un modelo de edad facial (FairFace
-- ResNet-34, CC BY 4.0) sobre el rostro del selfie y persiste la edad estimada + rango.
-- Señal/score: el ruteo a revisión (`ageEstimation.onUnderage:review`) o el rechazo duro
-- (`onUnderage:reject` cuando la edad estimada < `minAge`) lo decide el workflow. NO lo
-- consume `decision()`.
--
-- verification_checks.type → habilita el literal 'age_estimation'.
--
-- Idempotente (DROP CONSTRAINT IF EXISTS + recreación). NO toca filas existentes ni el
-- comportamiento de los checks actuales (sólo AMPLÍA el set permitido). En línea con el
-- patrón de 0010 (aml) / 0011 (face_search) / 0013 (proof_of_address).
-- =============================================================================

ALTER TABLE verification_checks
  DROP CONSTRAINT IF EXISTS verification_checks_type_check;
ALTER TABLE verification_checks
  ADD CONSTRAINT verification_checks_type_check
  CHECK (type IN (
    'quality', 'liveness', 'document', 'match', 'aml', 'face_search',
    'proof_of_address', 'age_estimation'));
