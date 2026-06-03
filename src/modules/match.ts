/**
 * Módulo `match` — verificación 1:1 selfie ↔ foto del documento (§6.d/§7).
 *
 * Es DELIBERADAMENTE puro y model-free: recibe los dos embeddings ya calculados
 * por el engine (contrato del spec §6: `match(selfieEmb, docFaceEmb)`), de modo que
 * la lógica de decisión 1:1 sea testeable sin onnxruntime. El pipeline es quien
 * obtiene los embeddings (engine.embedBestFace sobre selfie y recorte del doc) y
 * los pasa acá.
 *
 * Umbral 1:1 (≠ 1:N): `MATCH_THRESHOLD`, calibrable por env o por policy de tenant
 * (spec §7/§13). Fail-closed lo maneja el pipeline: si no hay embedding (no se pudo
 * detectar cara en la selfie o en el recorte del documento), el match no corre y la
 * sesión NO puede llegar a verified.
 */
import type { MatchResult } from "../types";
import { MATCH_THRESHOLD } from "../config";

/**
 * Coseno de dos vectores. Como el engine ya entrega embeddings L2-normalizados,
 * el coseno es el producto punto; igual normalizamos defensivamente por si el
 * llamador pasa vectores crudos.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!(denom >= 1e-10)) return -1; // captura denom<1e-10 Y NaN (fail-closed)
  const cos = dot / denom;
  // Defensa: embeddings con NaN/Inf no acreditan parecido → sentinela -1, nunca
  // un NaN que se serialice a null en el JSONB de auditoría ni un pass espurio.
  if (!Number.isFinite(cos)) return -1;
  return cos;
}

/**
 * Verificación 1:1. `threshold` permite override desde la policy del tenant
 * (thresholds.matchCosine); por defecto usa el global calibrable `MATCH_THRESHOLD`.
 */
export function match(
  selfieEmb: Float32Array,
  docFaceEmb: Float32Array,
  threshold: number = MATCH_THRESHOLD
): MatchResult {
  const cosine = cosineSimilarity(selfieEmb, docFaceEmb);
  return {
    cosine,
    threshold,
    passed: cosine >= threshold,
  };
}
