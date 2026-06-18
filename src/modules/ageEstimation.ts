/**
 * Módulo `ageEstimation` — estimación de edad facial del selfie (P2), server-side.
 *
 * Contrato (spec P2): ageEstimation(selfie) → {estimatedAge, range, confidence, ...}.
 * Señal/score CONFIGURABLE por workflow (`ageEstimation.required` + `minAge` +
 * `onUnderage` flag|review|reject). NO la consume `decision()`: el ruteo (flag/review)
 * lo decide el workflow; el rechazo duro (`reject`) lo aplica el pipeline.
 *
 * MODELO: FairFace ResNet-34 (dchen236/FairFace, LICENCIA **CC BY 4.0** — uso comercial
 * permitido con atribución; ver docs/specs/age-estimation.md). Multi-tarea: emite 18
 * logits = [raza(7), género(2), EDAD(9)]. Sólo usamos la cabeza de EDAD (índices 9..17),
 * 9 buckets [0-2,3-9,10-19,20-29,30-39,40-49,50-59,60-69,70+]. Entrada 224x224 RGB,
 * normalización ImageNet ((x/255 - mean)/std), NCHW. Verificado export ONNX + inferencia
 * sobre selfie real (SOTELO): bucket 30-39, edad esperada ~31 años (adulto plausible).
 *
 * FAIL-CLOSED: si el modelo NO carga o no hay rostro, devolvemos passed=false + error.
 * Como es señal (no seguridad dura por defecto), esto NO produce "verified" indebido y,
 * con `onUnderage:reject`, fail-closed ⇒ rechazo (un modelo ausente nunca deja pasar a
 * un menor en silencio). El `estimatedAge` es un ESTIMADO estadístico (no una edad legal):
 * el gate `minAge` es un control de riesgo, no una prueba de mayoría de edad.
 */
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import type { Engine } from "../engine";
import type { AgeEstimationResult } from "../types";
import { AGE_MODEL } from "../config";

/** Etiquetas de los 9 buckets de edad de FairFace (orden del vector). */
export const AGE_BUCKETS = [
  "0-2",
  "3-9",
  "10-19",
  "20-29",
  "30-39",
  "40-49",
  "50-59",
  "60-69",
  "70+",
] as const;

/**
 * Punto medio (años) de cada bucket para el estimado puntual (valor esperado).
 * El bucket abierto "70+" se ancla en 75 (estimado conservador, no una cota real).
 */
export const AGE_MIDPOINTS = [1, 6, 15, 25, 35, 45, 55, 65, 75] as const;

/** Tamaño de entrada de FairFace (224x224). */
const AGE_INPUT = 224;
/** Normalización ImageNet (RGB) — la `transforms.Normalize` de FairFace/predict.py. */
const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;
/**
 * Margen de recorte alrededor del bbox del rostro (fracción del lado). FairFace se
 * entrena sobre face-chips con CONTEXTO (padding 0.25 de dlib): un recorte ArcFace 112
 * ajustado pierde frente/mentón y sesga la edad. 0.4 reproduce el `crop_selfie` validado.
 */
const AGE_CROP_MARGIN = parseFloat(process.env.TEKO_AGE_CROP_MARGIN || "0.4");

/** softmax numéricamente estable. Helper PURO (testeable sin el modelo real). */
export function softmax(arr: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  const exps = new Array<number>(arr.length);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const e = Math.exp(arr[i] - max);
    exps[i] = e;
    sum += e;
  }
  sum += 1e-10;
  for (let i = 0; i < exps.length; i++) exps[i] /= sum;
  return exps;
}

/**
 * Deriva {edad esperada, rango argmax, confianza, distribución} a partir de los 18
 * logits de FairFace (raza 0..6, género 7..8, EDAD 9..17). Helper PURO: testeable sin
 * onnx. `null` si el vector no tiene los 18 valores esperados (fail-closed defensivo).
 */
export function ageFromLogits(
  logits18: ArrayLike<number>
): {
  estimatedAge: number;
  range: string;
  confidence: number;
  buckets: Array<{ label: string; prob: number }>;
} | null {
  if (logits18.length < 18) return null;
  const ageLogits = new Array<number>(9);
  for (let i = 0; i < 9; i++) ageLogits[i] = logits18[9 + i];
  const probs = softmax(ageLogits);
  let estimatedAge = 0;
  let argmax = 0;
  for (let i = 0; i < 9; i++) {
    estimatedAge += probs[i] * AGE_MIDPOINTS[i];
    if (probs[i] > probs[argmax]) argmax = i;
  }
  return {
    estimatedAge: Math.round(estimatedAge * 10) / 10,
    range: AGE_BUCKETS[argmax],
    confidence: probs[argmax],
    buckets: AGE_BUCKETS.map((label, i) => ({
      label,
      prob: Math.round(probs[i] * 1000) / 1000,
    })),
  };
}

export class AgeEstimationModule {
  private net: ort.InferenceSession | null = null;
  private loaded = false;
  public ready = false;

  /** Carga el modelo de edad. No-throw: el faltante se maneja fail-closed en run(). */
  async init(): Promise<void> {
    try {
      this.net = await ort.InferenceSession.create(AGE_MODEL, {
        graphOptimizationLevel: "all",
        executionProviders: ["cpu"],
      });
      this.loaded = true;
    } catch (e) {
      this.loaded = false;
      // eslint-disable-next-line no-console
      console.warn(
        `[ageEstimation] modelo de edad no disponible (${AGE_MODEL}): ${(e as Error).message}`
      );
    }
    this.ready = true;
  }

  /**
   * Recorta el rostro de la selfie con CONTEXTO (bbox + margen) y lo devuelve a 224x224
   * RGB crudo, listo para la normalización ImageNet. `null` si no hay rostro o el recorte
   * resulta inválido. El recorte holgado (no el ArcFace 112) es deliberado: FairFace ve
   * la cabeza completa, no sólo los rasgos internos.
   */
  private async faceChip(selfie: Buffer, engine: Engine): Promise<Buffer | null> {
    const faces = await engine.detect(selfie);
    const face = engine.bestFace(faces);
    if (!face) return null;
    const meta = await sharp(selfie).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) return null;
    const [bx1, by1, bx2, by2] = face.bbox.map((v) => Math.round(v));
    const bw = Math.max(1, bx2 - bx1);
    const bh = Math.max(1, by2 - by1);
    const mw = Math.round(bw * AGE_CROP_MARGIN);
    const mh = Math.round(bh * AGE_CROP_MARGIN);
    const left = Math.max(0, bx1 - mw);
    const top = Math.max(0, by1 - mh);
    const width = Math.min(W - left, bw + 2 * mw);
    const height = Math.min(H - top, bh + 2 * mh);
    if (width <= 0 || height <= 0) return null;
    return sharp(selfie)
      .extract({ left, top, width, height })
      .removeAlpha()
      .resize(AGE_INPUT, AGE_INPUT, { fit: "fill" })
      .raw()
      .toBuffer();
  }

  /**
   * Estima la edad del rostro de la selfie. `opts.minAge`: si se fija, calcula
   * `underage` (estimatedAge < minAge) y `passed` (= !underage). FAIL-CLOSED: sin
   * modelo o sin rostro ⇒ passed=false + error (nunca acredita una edad).
   */
  async run(
    selfie: Buffer,
    engine: Engine,
    opts: { minAge?: number } = {}
  ): Promise<AgeEstimationResult> {
    const minAge = opts.minAge;
    const failClosed = (error: string): AgeEstimationResult => ({
      estimatedAge: 0,
      range: "",
      confidence: 0,
      minAge,
      underage: false,
      passed: false,
      error,
    });

    if (!this.loaded || !this.net) return failClosed("age_model_unavailable");
    const chip = await this.faceChip(selfie, engine);
    if (!chip) return failClosed("no_face");

    const n = AGE_INPUT * AGE_INPUT;
    const f = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      f[i] = (chip[i * 3] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0]; // R
      f[n + i] = (chip[i * 3 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1]; // G
      f[2 * n + i] = (chip[i * 3 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2]; // B
    }
    const t = new ort.Tensor("float32", f, [1, 3, AGE_INPUT, AGE_INPUT]);
    const out = await this.net.run({ [this.net.inputNames[0]]: t });
    const logits = out[this.net.outputNames[0]].data as Float32Array;
    const derived = ageFromLogits(logits);
    if (!derived) return failClosed("age_output_invalid");

    const underage = minAge !== undefined ? derived.estimatedAge < minAge : false;
    return {
      estimatedAge: derived.estimatedAge,
      range: derived.range,
      confidence: derived.confidence,
      buckets: derived.buckets,
      minAge,
      underage,
      // Señal: pasa si NO es menor (o si no hay minAge configurado → sólo reporta).
      passed: !underage,
    };
  }
}

export const ageEstimationModule = new AgeEstimationModule();
