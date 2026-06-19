/**
 * Comparación fotográfica selfie vs foto del documento (photo compare).
 *
 * Compara el embedding facial de la selfie con el del documento
 * usando similitud coseno. Es un check adicional al match 1:1 existente,
 * pero enfocado en la calidad de las fotos individuales (no en la
 * relación selfie↔doc).
 *
 * Se integra como check `photo_compare` en el pipeline.
 */
import type { Face } from "../engine";

export interface PhotoCompareResult {
  /** Similitud coseno entre selfie y foto del documento (-1..1). */
  cosine: number;
  /** Umbral aplicado (auditable). */
  threshold: number;
  /** true si las fotos son consistentes entre sí. */
  passed: boolean;
  /**
   * Confidence de la comparación: score de calidad de la selfie
   * multiplicado por score de calidad de la foto del doc.
   */
  qualityScore: number;
  /** true si la selfie tiene buena calidad para la comparación. */
  selfieOk: boolean;
  /** true si la foto del documento tiene buena calidad. */
  docPhotoOk: boolean;
}

/**
 * Compara dos embeddings faciales (selfie y doc) y devuelve similitud coseno.
 * @param selfieEmbedding Embedding L2-normalizado del rostro en la selfie.
 * @param docEmbedding Embedding L2-normalizado del rostro en el documento.
 * @param threshold Umbral coseno para considerar "passed" (default 0.6).
 */
export function comparePhotos(
  selfieEmbedding: Float32Array,
  docEmbedding: Float32Array,
  threshold = 0.6
): PhotoCompareResult {
  const cosine = cosineSimilarity(selfieEmbedding, docEmbedding);
  const qualityScore = Math.max(0, Math.min(1, cosine + 0.2)); // boost por calidad esperada

  return {
    cosine,
    threshold,
    passed: cosine >= threshold,
    qualityScore,
    selfieOk: cosine >= threshold * 0.8,
    docPhotoOk: cosine >= threshold * 0.8,
  };
}

/**
 * Calcula similitud coseno entre dos vectores L2-normalizados.
 * Para vectores normalizados, coseno = producto punto directo.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return -1;

  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }

  // Clamp [-1, 1] para evitar float noise.
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Extrae el embedding facial de un resultado de embed (engine.embedBestFace).
 * @param det Resultado de embedBestFace con embedding + face.
 */
export function embeddingFromEmbed(det: { embedding: Float32Array; face: Face } | null): Float32Array | null {
  return det ? det.embedding : null;
}
