/**
 * Tests de la lógica PURA del liveness activo (corren bajo el vitest de la raíz; no
 * requieren cámara ni MediaPipe). Cubren: extracción de ángulos de la matriz,
 * bbox/nitidez, detección de cada desafío, anti-trampa de la secuencia y selección
 * del mejor frame.
 */
import { describe, it, expect } from 'vitest'
import { matrixToAngles, bboxFromLandmarks, laplacianVariance } from './signals'
import {
  challengeSatisfied,
  isFrontal,
  pickChallenges,
  stepSequence,
  initialSeqState,
  TURN_YAW_DEG,
  type LivenessSignals,
  type ChallengeId,
} from './challenges'
import { pickBestFrame, scoreCandidate, frontalScore } from './bestFrame'

// Matriz de rotación column-major (4x4) para rotación pura sobre un eje.
function ryColumnMajor(deg: number): number[] {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  // col0,col1,col2,col3 (column-major)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
}
function rxColumnMajor(deg: number): number[] {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
}

describe('matrixToAngles', () => {
  it('identidad → 0 grados', () => {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const a = matrixToAngles(id)
    expect(a.yaw).toBeCloseTo(0, 5)
    expect(a.pitch).toBeCloseTo(0, 5)
  })
  it('rotación Y de +20° → yaw≈20, pitch≈0', () => {
    const a = matrixToAngles(ryColumnMajor(20))
    expect(a.yaw).toBeCloseTo(20, 3)
    expect(a.pitch).toBeCloseTo(0, 3)
  })
  it('rotación X de +15° → pitch≈15, yaw≈0', () => {
    const a = matrixToAngles(rxColumnMajor(15))
    expect(a.pitch).toBeCloseTo(15, 3)
    expect(a.yaw).toBeCloseTo(0, 3)
  })
  it('matriz inválida → ceros (fail-safe)', () => {
    expect(matrixToAngles([1, 2, 3])).toEqual({ yaw: 0, pitch: 0, roll: 0 })
  })
})

describe('bboxFromLandmarks', () => {
  it('calcula ancho/alto/centro normalizados', () => {
    const b = bboxFromLandmarks([
      { x: 0.4, y: 0.3 },
      { x: 0.6, y: 0.7 },
      { x: 0.5, y: 0.5 },
    ])!
    expect(b.width).toBeCloseTo(0.2, 6)
    expect(b.height).toBeCloseTo(0.4, 6)
    expect(b.cx).toBeCloseTo(0.5, 6)
    expect(b.cy).toBeCloseTo(0.5, 6)
  })
  it('sin puntos → null', () => {
    expect(bboxFromLandmarks([])).toBeNull()
    expect(bboxFromLandmarks(undefined)).toBeNull()
  })
})

describe('laplacianVariance', () => {
  it('imagen plana → varianza ~0', () => {
    const flat = new Uint8Array(8 * 8).fill(128)
    expect(laplacianVariance(flat, 8, 8)).toBeCloseTo(0, 6)
  })
  it('tablero de ajedrez → varianza alta', () => {
    const w = 8,
      h = 8
    const cb = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) cb[y * w + x] = (x + y) % 2 ? 255 : 0
    expect(laplacianVariance(cb, w, h)).toBeGreaterThan(1000)
  })
})

// Señales base "de frente y centrado".
function frontalSignals(over: Partial<LivenessSignals> = {}): LivenessSignals {
  return {
    hasFace: true,
    yaw: 0,
    pitch: 0,
    blinkLeft: 0,
    blinkRight: 0,
    smile: 0,
    faceWidth: 0.45,
    cx: 0.5,
    cy: 0.5,
    ...over,
  }
}

describe('challengeSatisfied / isFrontal', () => {
  it('sin rostro nunca se cumple (fail-closed)', () => {
    const s = frontalSignals({ hasFace: false })
    expect(isFrontal(s)).toBe(false)
    for (const id of ['center', 'turn_left', 'turn_right', 'blink', 'smile', 'closer'] as ChallengeId[])
      expect(challengeSatisfied(id, s)).toBe(false)
  })
  it('center = frontal y centrado', () => {
    expect(challengeSatisfied('center', frontalSignals())).toBe(true)
    expect(challengeSatisfied('center', frontalSignals({ yaw: 30 }))).toBe(false)
    expect(challengeSatisfied('center', frontalSignals({ cx: 0.9 }))).toBe(false)
  })
  it('turn_right/turn_left por signo del yaw', () => {
    expect(challengeSatisfied('turn_right', frontalSignals({ yaw: TURN_YAW_DEG + 5 }))).toBe(true)
    expect(challengeSatisfied('turn_right', frontalSignals({ yaw: -(TURN_YAW_DEG + 5) }))).toBe(false)
    expect(challengeSatisfied('turn_left', frontalSignals({ yaw: -(TURN_YAW_DEG + 5) }))).toBe(true)
  })
  it('blink por promedio de eyeBlink; smile por mouthSmile', () => {
    expect(challengeSatisfied('blink', frontalSignals({ blinkLeft: 0.7, blinkRight: 0.6 }))).toBe(true)
    expect(challengeSatisfied('blink', frontalSignals({ blinkLeft: 0.7, blinkRight: 0.0 }))).toBe(false)
    expect(challengeSatisfied('smile', frontalSignals({ smile: 0.8 }))).toBe(true)
  })
})

describe('pickChallenges', () => {
  it('siempre arranca con center y agrega 2-3 desafíos distintos', () => {
    const seq = pickChallenges(() => 0.5, 3)
    expect(seq[0]).toBe('center')
    expect(seq.length).toBe(4)
    expect(new Set(seq).size).toBe(seq.length) // sin repetidos
  })
  it('clampa count a [2,3]', () => {
    expect(pickChallenges(() => 0.1, 10).length).toBe(4) // center + 3
    expect(pickChallenges(() => 0.1, 0).length).toBe(3) // center + 2
  })
})

describe('stepSequence (anti-trampa: volver a frente entre desafíos)', () => {
  const seq: ChallengeId[] = ['center', 'turn_right', 'blink']

  it('completa center sin exigir reset (ya es frontal)', () => {
    const r = stepSequence(initialSeqState(), seq, true, true)
    expect(r.justCompleted).toBe(true)
    expect(r.state.i).toBe(1)
    expect(r.state.awaitingReset).toBe(false)
  })

  it('tras un giro exige volver a frente antes del próximo desafío', () => {
    let st = { i: 1, completed: 1, awaitingReset: false } // en turn_right
    // Se cumple el giro (no frontal): completa y arma awaitingReset.
    let r = stepSequence(st, seq, true, false)
    expect(r.justCompleted).toBe(true)
    expect(r.state.i).toBe(2)
    expect(r.state.awaitingReset).toBe(true)
    st = r.state
    // Aún girado: el siguiente desafío (blink) NO se evalúa aunque "satisfied".
    r = stepSequence(st, seq, true, false)
    expect(r.justCompleted).toBe(false)
    expect(r.state.awaitingReset).toBe(true)
    // Vuelve a frente: baja la bandera (todavía no completa blink).
    r = stepSequence(r.state, seq, false, true)
    expect(r.state.awaitingReset).toBe(false)
    // Ahora sí, blink se cumple → secuencia completa.
    r = stepSequence(r.state, seq, true, true)
    expect(r.justCompleted).toBe(true)
    expect(r.allDone).toBe(true)
  })
})

describe('pickBestFrame', () => {
  it('elige el más frontal/nítido/bien dimensionado', () => {
    const best = pickBestFrame([
      { yaw: 25, faceWidth: 0.3, sharpness: 50, image: 'a' }, // torcido
      { yaw: 2, faceWidth: 0.5, sharpness: 100, image: 'b' }, // ideal
      { yaw: 1, faceWidth: 0.5, sharpness: 10, image: 'c' }, // frontal pero borroso
    ])
    expect(best).toBe(1)
  })
  it('lista vacía → -1', () => {
    expect(pickBestFrame([])).toBe(-1)
  })
  it('frontalScore cae con el yaw y scoreCandidate sube con nitidez', () => {
    expect(frontalScore(0)).toBeCloseTo(1, 6)
    expect(frontalScore(30)).toBeCloseTo(0, 6)
    const c = { yaw: 0, faceWidth: 0.5, sharpness: 80, image: 'x' }
    expect(scoreCandidate(c, 80)).toBeGreaterThan(scoreCandidate(c, 800))
  })
})
