-- =============================================================================
-- Teko Verify — link_token de un solo uso (§8 Seguridad, §9 fail-closed).
--
-- Problema que cierra (revisión adversarial): el link_token podía reusarse para
-- re-disparar el pipeline incluso tras un estado terminal (verified/rejected/
-- error/expired). Eso habilita replay y, en los rechazos DUROS de liveness/
-- document/match, reintentos ilimitados de spoof.
--
-- Solución: el token es de UN SOLO USO. Al alcanzar un estado terminal por
-- primer submit, se marca `used_at`. Todo acceso posterior por token con
-- `used_at` no nulo se rechaza (fail-closed): la captura no vuelve a ejecutar el
-- pipeline.
--
-- `used_at` NULL  = token aún no consumido (creado/capturando/recapturando).
-- `used_at` !NULL = token consumido (sesión llegó a terminal) → no reutilizable.
-- =============================================================================

ALTER TABLE verification_sessions
  ADD COLUMN IF NOT EXISTS used_at timestamptz;

COMMENT ON COLUMN verification_sessions.used_at IS
  'Momento de consumo del link_token de un solo uso (NULL = aún no usado). '
  'Se setea al primer submit que lleva la sesión a un estado terminal. '
  'Un token con used_at no nulo no vuelve a aceptar capturas (anti-replay, §8/§9).';
