/**
 * Helpers PUROS de señales de liveness (sin React, sin MediaPipe, sin DOM): se
 * extraen del resultado de MediaPipe FaceLandmarker y se testean sin cámara.
 *
 *   - matrixToAngles: matriz de transformación facial 4x4 (column-major, como la
 *     emite FaceLandmarker en `facialTransformationMatrixes[i].data`) → yaw/pitch/roll
 *     en GRADOS. yaw = giro horizontal de la cabeza (izq/der), pitch = arriba/abajo.
 *   - bboxFromLandmarks: bounding box normalizado [0..1] desde los 478 landmarks.
 *   - laplacianVariance: nitidez (varianza del Laplaciano) sobre un buffer gris.
 *
 * Estos tres son la base de: detección de desafíos (giro por yaw), encuadre
 * (tamaño/centrado del bbox) y selección del mejor frame (frontalidad + nitidez).
 */

const RAD2DEG = 180 / Math.PI;

export interface HeadAngles {
  yaw: number; // grados; >0 = cabeza girada hacia un lado (signo según convención de cámara)
  pitch: number; // grados; >0 = mirando hacia arriba/abajo
  roll: number; // grados; inclinación lateral
}

/**
 * Extrae yaw/pitch/roll (grados) de la matriz de transformación facial 4x4 de
 * FaceLandmarker. `m` es el arreglo plano de 16 floats COLUMN-MAJOR: el elemento
 * (fila r, col c) = m[c*4 + r]. La extracción es Tait-Bryan y es EXACTA para
 * rotaciones puras (validada en tests con matrices Ry/Rx construidas a mano) y una
 * buena aproximación cerca de la frontalidad (el régimen donde decidimos los
 * desafíos). Devuelve ceros si la matriz no tiene 16 elementos (fail-safe).
 */
export function matrixToAngles(m: number[] | Float32Array): HeadAngles {
  if (!m || m.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  const r = (row: number, col: number) => m[col * 4 + row];
  const yaw = Math.atan2(r(0, 2), r(2, 2)) * RAD2DEG;
  const pitch =
    Math.atan2(-r(1, 2), Math.hypot(r(1, 0), r(1, 1))) * RAD2DEG;
  const roll = Math.atan2(r(1, 0), r(1, 1)) * RAD2DEG;
  return { yaw, pitch, roll };
}

export interface NormBox {
  width: number; // 0..1 (ancho del rostro / ancho del frame)
  height: number; // 0..1
  cx: number; // centro X normalizado
  cy: number; // centro Y normalizado
}

/** Punto normalizado de landmark (x,y en 0..1; z relativo, no se usa acá). */
export interface NormPoint {
  x: number;
  y: number;
}

/**
 * Bounding box normalizado del rostro a partir de los landmarks (min/max x,y).
 * Devuelve null si no hay puntos. Las coordenadas de FaceLandmarker ya vienen
 * normalizadas [0..1] respecto del frame.
 */
export function bboxFromLandmarks(points: NormPoint[] | undefined): NormBox | null {
  if (!points || points.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/**
 * Varianza del Laplaciano (proxy de NITIDEZ) sobre una imagen en escala de grises
 * (`gray` = un valor 0..255 por pixel, longitud w*h). Mayor varianza = más nítido.
 * Kernel Laplaciano 4-vecinos. Bordes excluidos. Buffer demasiado chico → 0.
 */
export function laplacianVariance(
  gray: ArrayLike<number>,
  w: number,
  h: number
): number {
  if (w < 3 || h < 3 || gray.length < w * h) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}
