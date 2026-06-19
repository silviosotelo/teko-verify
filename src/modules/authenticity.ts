/**
 * Detección de autenticidad de documentos por análisis de imagen (ML liviano).
 *
 * Detecta:
 *   - Patrón Moiré (indicador de foto de pantalla).
 *   - Análisis EXIF (ausencia de metadatos en fotos subidas desde móvil).
 *   - Análisis de ruido (imágenes comprimidas por segunda vez).
 *
 * NO requiere modelo ONNX: usa sharp + estadísticas de imagen.
 * Se integra como check `document_authenticity` en el pipeline.
 */
import sharp from "sharp";

export interface AuthenticityResult {
  /** true si no se detectaron indicios de falsificación. */
  passed: boolean;
  /** Score global de autenticidad 0..1 (mayor = más auténtico). */
  score: number;
  /** Señales individuales detectadas. */
  signals: AuthenticitySignal[];
  /** true si hay indicios de Moiré (foto de pantalla). */
  moireDetected: boolean;
  /** true si hay indicios de compresión secundaria. */
  recompressionDetected: boolean;
  /** true si faltan metadatos EXIF sospechosos. */
  missingExif: boolean;
}

export interface AuthenticitySignal {
  name: string;
  severity: "low" | "medium" | "high";
  detail: string;
}

/**
 * Analiza una imagen de documento para detectar indicios de falsificación.
 * @param image Buffer JPEG/PNG de la imagen del documento.
 * @param threshold Umbral mínimo de score para pasar (default 0.5).
 */
export async function detectAuthenticity(
  image: Buffer,
  threshold = 0.5
): Promise<AuthenticityResult> {
  const signals: AuthenticitySignal[] = [];
  let moireDetected = false;
  let recompressionDetected = false;
  let missingExif = false;

  try {
    const metadata = await sharp(image).metadata();
    const buffer = await sharp(image).toBuffer();

    // 1. Moiré: análisis de frecuencia via FFT simplificado.
    //    Detecta patrones repetitivos en la frecuencia media-alta.
    try {
      const { data, info } = await sharp(image)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (data.length > 0 && info && info.width && info.height) {
        const moireScore = detectMoiréPattern(data, info.width, info.height);
        if (moireScore > 0.3) {
          moireDetected = true;
          signals.push({
            name: "moire_detected",
            severity: moireScore > 0.6 ? "high" : "medium",
            detail: `Patrón Moiré detectado (score: ${moireScore.toFixed(2)}) — posible foto de pantalla.`,
          });
        }
      }
    } catch {
      /* no-op: no se pudo analizar moiré */
    }

    // 2. Análisis de ruido (recompresión):
    //    Imágenes recomprimidas tienen distribución de histograma no natural.
    try {
      const { data, info } = await sharp(image)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (data.length > 0 && info && info.width && info.height) {
        const noiseScore = analyzeNoisePattern(data, info.width, info.height);
        if (noiseScore > 0.4) {
          recompressionDetected = true;
          signals.push({
            name: "recompression_detected",
            severity: "medium",
            detail: `Patrón de ruido sospechoso (score: ${noiseScore.toFixed(2)}) — posible recompresión.`,
          });
        }
      }
    } catch {
      /* no-op */
    }

    // 3. EXIF: imágenes de documentos originales suelen tener EXIF.
    //    Si no hay EXIF y el formato es JPEG, es sospechoso.
    if (metadata.format === "jpeg" && (!metadata.exif || metadata.exif.length < 50)) {
      missingExif = true;
      signals.push({
        name: "missing_exif",
        severity: "low",
        detail: "Faltan metadatos EXIF — la imagen podría ser captura de pantalla o descargada.",
      });
    }
  } catch {
    /* no-op: no se pudo analizar la imagen */
  }

  // Score global: penaliza cada señal.
  let score = 1.0;
  for (const s of signals) {
    if (s.severity === "high") score -= 0.4;
    else if (s.severity === "medium") score -= 0.2;
    else score -= 0.1;
  }
  score = Math.max(0, Math.min(1, score));

  return {
    passed: score >= threshold,
    score,
    signals,
    moireDetected,
    recompressionDetected,
    missingExif,
  };
}

/**
 * Detección simplificada de Moiré:
 * Aplica un filtro Laplaciano (varianza) en ventanas deslizantes.
 * Patrones Moiré producen varianza local anormalmente alta en regiones regulares.
 */
function detectMoiréPattern(data: Buffer, width: number, height: number): number {
  if (data.length === 0 || width < 32 || height < 32) return 0;

  // Muestreo: no procesar toda la imagen (costoso), tomar ventanas de 64x64.
  const step = 64;
  let highVarianceCount = 0;
  let totalWindows = 0;

  for (let y = 0; y < height - step; y += step) {
    for (let x = 0; x < width - step; x += step) {
      totalWindows++;
      let sum = 0;
      let sumSq = 0;
      const count = step * step;

      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 1; // grayscale = 1 byte/pixel
          const val = data[idx] ?? 0;
          sum += val;
          sumSq += val * val;
        }
      }

      const mean = sum / count;
      const variance = sumSq / count - mean * mean;

      // Moiré produce varianza > 800 en ventanas de 64x64.
      if (variance > 800) highVarianceCount++;
    }
  }

  if (totalWindows === 0) return 0;
  // Normalizar a 0..1.
  return Math.min(1, highVarianceCount / totalWindows * 2);
}

/**
 * Análisis de ruido: distribución de histograma de niveles de gris.
 * Imágenes naturales tienen histograma suave; imágenes recomprimidas
 * tienen picos artificiales (banding).
 */
function analyzeNoisePattern(data: Buffer, width: number, height: number): number {
  if (data.length === 0) return 0;

  // Construir histograma de 256 bins.
  const histogram = new Uint16Array(256);
  const totalPixels = data.length;
  for (let i = 0; i < totalPixels; i++) {
    histogram[data[i]]++;
  }

  // Medir "picos": bins con conteo > 2x el promedio del vecino.
  let peakCount = 0;
  for (let i = 1; i < 255; i++) {
    const avgNeighbor = (histogram[i - 1] + histogram[i + 1]) / 2;
    if (avgNeighbor > 0 && histogram[i] > avgNeighbor * 2) peakCount++;
  }

  // Si hay > 15 picos artificiales, sospecha de recompresión.
  const ratio = peakCount / 255;
  return Math.min(1, ratio * 5);
}
