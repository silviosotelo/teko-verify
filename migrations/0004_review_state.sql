-- 0004_review_state.sql
-- Agrega el estado NUEVO 'review' a la máquina de estados de verification_sessions.
--
-- 'review' es un estado intermedio capturable-terminable pero NO terminal:
--   processing → review → (verified | rejected)
-- /preview computa el pipeline, persiste los checks y deja la sesión en 'review'
-- (sin crear verified_identity ni disparar webhook). /confirm finaliza desde 'review'.
--
-- Reemplaza el CHECK del estado para incluir 'review'. Idempotente vía DROP IF EXISTS.

ALTER TABLE verification_sessions
  DROP CONSTRAINT IF EXISTS verification_sessions_state_check;

ALTER TABLE verification_sessions
  ADD CONSTRAINT verification_sessions_state_check
  CHECK (state IN (
    'created', 'capturing', 'processing', 'review',
    'verified', 'rejected', 'needs_recapture',
    'expired', 'error'));
