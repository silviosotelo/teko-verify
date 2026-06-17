/**
 * Lógica PURA del LIVENESS ACTIVO (sin React/MediaPipe/DOM): definición de los
 * desafíos guiados, su DETECCIÓN a partir de señales por-frame, la elección
 * aleatoria de la secuencia y el avance de la secuencia con anti-trampa (volver a
 * frente entre desafíos). Todo testeable sin cámara.
 *
 * Detección (cómo se cumple cada desafío):
 *   - turn_left / turn_right: yaw (giro horizontal) de la matriz de transformación
 *     supera ±TURN_YAW_DEG en la dirección pedida.
 *   - blink: blendshape eyeBlink (izq/der promedio) supera BLINK_THRESHOLD.
 *   - smile: blendshape mouthSmile (máx izq/der) supera SMILE_THRESHOLD.
 *   - closer: el rostro crece — faceWidth normalizado supera CLOSER_FACE_W.
 *   - center: rostro frontal (|yaw|/|pitch| chicos) y centrado en el círculo.
 *
 * Anti-trampa: tras cumplir un desafío de pose/gesto exigimos VOLVER A FRENTE antes
 * de evaluar el siguiente (impide encadenar gestos de una foto/secuencia falsa).
 */

export type ChallengeId =
  | 'center'
  | 'turn_left'
  | 'turn_right'
  | 'blink'
  | 'smile'
  | 'closer'

/** Señales por-frame que consumen los detectores (las arma el hook desde MediaPipe). */
export interface LivenessSignals {
  hasFace: boolean
  yaw: number // grados (>0 hacia un lado; la convención de signo la fija la cámara)
  pitch: number // grados
  blinkLeft: number // 0..1 (eyeBlinkLeft)
  blinkRight: number // 0..1 (eyeBlinkRight)
  smile: number // 0..1 (máx mouthSmileLeft/Right)
  faceWidth: number // 0..1 (ancho bbox / ancho frame)
  cx: number // centro X normalizado del rostro
  cy: number // centro Y normalizado
}

// --- Umbrales (calibrables en dispositivo) --------------------------------- //
export const TURN_YAW_DEG = 18 // giro perceptible (izq/der)
export const FRONTAL_YAW_DEG = 10 // |yaw| por debajo = de frente
export const FRONTAL_PITCH_DEG = 14 // |pitch| por debajo = de frente
export const BLINK_THRESHOLD = 0.5 // eyeBlink blendshape
export const SMILE_THRESHOLD = 0.5 // mouthSmile blendshape
export const CLOSER_FACE_W = 0.62 // rostro "cerca"
export const CENTER_TOL = 0.16 // tolerancia de centrado (|cx-0.5|,|cy-0.5|)
export const CENTER_FACE_W_MIN = 0.3 // tamaño mínimo para considerarse encuadrado

/** Copy grande mostrado por cada desafío (es la instrucción al titular). */
export const CHALLENGE_LABEL: Record<ChallengeId, string> = {
  center: 'Mirá de frente y centrate',
  turn_left: 'Girá la cabeza a la izquierda',
  turn_right: 'Girá la cabeza a la derecha',
  blink: 'Parpadeá',
  smile: 'Sonreí',
  closer: 'Acercate un poco',
}

/** ¿El rostro está de frente y centrado? (encuadre base y anti-trampa de retorno). */
export function isFrontal(s: LivenessSignals): boolean {
  if (!s.hasFace) return false
  if (Math.abs(s.yaw) > FRONTAL_YAW_DEG) return false
  if (Math.abs(s.pitch) > FRONTAL_PITCH_DEG) return false
  if (Math.abs(s.cx - 0.5) > CENTER_TOL || Math.abs(s.cy - 0.5) > CENTER_TOL)
    return false
  if (s.faceWidth < CENTER_FACE_W_MIN) return false
  return true
}

/**
 * ¿Se cumple el desafío `id` en este frame? FAIL-CLOSED: sin rostro nunca se cumple.
 * Para turn_left/turn_right se usa la MAGNITUD del yaw; la asignación de signo a
 * "izquierda/derecha" la fija la cámara (preview espejado), así que aceptamos giro
 * en cualquiera de los dos sentidos por encima del umbral y diferenciamos por signo.
 */
export function challengeSatisfied(id: ChallengeId, s: LivenessSignals): boolean {
  if (!s.hasFace) return false
  switch (id) {
    case 'center':
      return isFrontal(s)
    case 'turn_right':
      return s.yaw >= TURN_YAW_DEG
    case 'turn_left':
      return s.yaw <= -TURN_YAW_DEG
    case 'blink':
      return (s.blinkLeft + s.blinkRight) / 2 >= BLINK_THRESHOLD
    case 'smile':
      return s.smile >= SMILE_THRESHOLD
    case 'closer':
      return s.faceWidth >= CLOSER_FACE_W
    default:
      return false
  }
}

/**
 * Arma la secuencia de desafíos: SIEMPRE arranca con 'center' (encuadre) y luego
 * `count` desafíos aleatorios distintos del pool. `rng` inyectable (0..1) para
 * tests deterministas; default Math.random. `count` se clampa a [2,3].
 */
export function pickChallenges(
  rng: () => number = Math.random,
  count = 2 + Math.floor((rng?.() ?? Math.random()) * 2)
): ChallengeId[] {
  const pool: ChallengeId[] = ['turn_left', 'turn_right', 'blink', 'smile', 'closer']
  const n = Math.max(2, Math.min(3, count))
  // Fisher-Yates parcial con rng inyectable.
  const arr = [...pool]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return ['center', ...arr.slice(0, n)]
}

// --- Máquina de secuencia (anti-trampa: volver a frente entre desafíos) ----- //

export interface SeqState {
  /** Índice del desafío actual en la secuencia. */
  i: number
  /** Cantidad de desafíos completados. */
  completed: number
  /**
   * true ⇒ hay que VOLVER A FRENTE antes de evaluar el próximo desafío. Se activa
   * tras completar uno (anti-trampa). 'center' no lo activa (ya es frontal).
   */
  awaitingReset: boolean
}

export function initialSeqState(): SeqState {
  return { i: 0, completed: 0, awaitingReset: false }
}

export interface SeqStep {
  state: SeqState
  justCompleted: boolean
  allDone: boolean
}

/**
 * Avanza la máquina de secuencia un "tick". `satisfied` = el desafío actual se cumple
 * AHORA (el llamador ya aplicó el HOLD/estabilidad que quiera). `frontal` = el rostro
 * está de frente y centrado AHORA.
 *
 * Reglas:
 *   - Si `awaitingReset`: no se evalúa nada hasta volver a frente (anti-trampa);
 *     al volver a frente se baja la bandera y queda listo para el próximo desafío.
 *   - Si NO `awaitingReset` y `satisfied`: cuenta el desafío como completado, avanza
 *     el índice y arma el anti-trampa para desafíos de gesto/pose (no para 'center').
 */
export function stepSequence(
  state: SeqState,
  sequence: ChallengeId[],
  satisfied: boolean,
  frontal: boolean
): SeqStep {
  const total = sequence.length
  if (state.i >= total) {
    return { state, justCompleted: false, allDone: true }
  }
  if (state.awaitingReset) {
    if (frontal) {
      return {
        state: { ...state, awaitingReset: false },
        justCompleted: false,
        allDone: false,
      }
    }
    return { state, justCompleted: false, allDone: false }
  }
  if (satisfied) {
    const current = sequence[state.i]
    const nextI = state.i + 1
    const allDone = nextI >= total
    // 'center' no arma el anti-trampa (ya es frontal); los demás sí.
    const awaitingReset = !allDone && current !== 'center'
    return {
      state: { i: nextI, completed: state.completed + 1, awaitingReset },
      justCompleted: true,
      allDone,
    }
  }
  return { state, justCompleted: false, allDone: false }
}
