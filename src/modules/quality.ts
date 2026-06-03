/**
 * Módulo `quality` — calidad + anti-anteojos + gating de pose/brillo/nitidez (§6.a/§7).
 *
 * Contrato (spec §6): quality(image) → {faceOk, brightness, sharpness, pose,
 * glassesPct, passed, reasons[]}. Recuperable: si no pasa, el pipeline va a
 * needs_recapture.
 *
 * Señales:
 *   - faceOk / pose: del engine (SCRFD detecta cara + landmarks5 → yaw/pitch/roll).
 *   - brightness: luma media normalizada 0..1 (sharp downsample).
 *   - sharpness: varianza del Laplaciano sobre el gris (mayor = más nítido).
 *   - glassesPct: modelo Qualcomm face_attrib_net (TFLite→ONNX) si está disponible.
 *
 * FAIL-CLOSED para anteojos: si el modelo de anteojos NO carga, NO podemos afirmar
 * "sin anteojos". Para no bloquear todo el onboarding por un modelo ausente, el
 * comportamiento es configurable:
 *   - TEKO_GLASSES_REQUIRED=true (default en prod): sin modelo ⇒ reason "glasses_model_unavailable"
 *     y passed=false (recaptura, nunca verified silencioso).
 *   - false: se omite el gate de anteojos (glassesPct=0) y se registra el faltante.
 * El pipeline trata quality.passed=false como needs_recapture, así que esto nunca
 * produce un "verified" indebido.
 */
import sharp from "sharp";
import * as ort from "onnxruntime-node";
import type { Engine, Face } from "../engine";
import type { HeadPose, QualityResult } from "../types";
import { GLASSES_MODEL, GLASSES_MAX } from "../config";

const GLASSES_REQUIRED =
  (process.env.TEKO_GLASSES_REQUIRED || "true").toLowerCase() !== "false";
const BRIGHTNESS_MIN = parseFloat(process.env.TEKO_QUALITY_BRIGHTNESS_MIN || "0.25");
const BRIGHTNESS_MAX = parseFloat(process.env.TEKO_QUALITY_BRIGHTNESS_MAX || "0.92");
const SHARPNESS_MIN = parseFloat(process.env.TEKO_QUALITY_SHARPNESS_MIN || "40");
const POSE_MAX_DEG = parseFloat(process.env.TEKO_QUALITY_POSE_MAX_DEG || "20");

/** Pose aproximada a partir de los 5 landmarks de SCRFD (ojos, nariz, boca). */
export function poseFromLandmarks(face: Face): HeadPose {
  const lm = face.landmarks5;
  if (!lm || lm.length !== 5) return { yaw: 0, pitch: 0, roll: 0 };
  const [le, re, nose, lm_, rm] = lm;
  const eyeDx = re[0] - le[0];
  const eyeDy = re[1] - le[1];
  // roll: inclinación de la línea de ojos.
  const roll = (Math.atan2(eyeDy, eyeDx) * 180) / Math.PI;
  // yaw: desplazamiento horizontal de la nariz respecto al centro de los ojos,
  // normalizado por la distancia interocular.
  const eyeCx = (le[0] + re[0]) / 2;
  const interOc = Math.hypot(eyeDx, eyeDy) + 1e-6;
  const yaw = ((nose[0] - eyeCx) / interOc) * 90;
  // pitch: desplazamiento vertical de la nariz respecto al punto medio ojos↔boca.
  const eyeCy = (le[1] + re[1]) / 2;
  const mouthCy = (lm_[1] + rm[1]) / 2;
  const midY = (eyeCy + mouthCy) / 2;
  const faceH = Math.abs(mouthCy - eyeCy) + 1e-6;
  const pitch = ((nose[1] - midY) / faceH) * 90;
  return { yaw, pitch, roll };
}

export class QualityModule {
  private glassesNet: ort.InferenceSession | null = null;
  private glassesLoaded = false;
  public ready = false;

  /** Carga el modelo de anteojos. No-throw: el faltante se maneja fail-closed en run(). */
  async init(): Promise<void> {
    try {
      this.glassesNet = await ort.InferenceSession.create(GLASSES_MODEL, {
        graphOptimizationLevel: "all",
        executionProviders: ["cpu"],
      });
      this.glassesLoaded = true;
    } catch (e) {
      // Modelo ausente o inválido: queda no-cargado (ver §14 fallback).
      this.glassesLoaded = false;
      // eslint-disable-next-line no-console
      console.warn(
        `[quality] modelo de anteojos no disponible (${GLASSES_MODEL}): ${(e as Error).message}`
      );
    }
    this.ready = true;
  }

  /** Brillo (luma media 0..1) + nitidez (varianza del Laplaciano) sobre escala de grises. */
  private async lumaAndSharpness(buf: Buffer): Promise<{ brightness: number; sharpness: number }> {
    const W = 256;
    const H = 256;
    const { data } = await sharp(buf)
      .resize(W, H, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const brightness = sum / data.length / 255;

    // Laplaciano 3x3 (kernel [0,1,0;1,-4,1;0,1,0]) → varianza.
    let mean = 0;
    const lap = new Float64Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const v =
          data[i - W] + data[i + W] + data[i - 1] + data[i + 1] - 4 * data[i];
        lap[i] = v;
        mean += v;
      }
    }
    const cnt = (W - 2) * (H - 2);
    mean /= cnt;
    let varSum = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const d = lap[y * W + x] - mean;
        varSum += d * d;
      }
    }
    const sharpness = varSum / cnt;
    return { brightness, sharpness };
  }

  /** Probabilidad de anteojos 0..1 vía face_attrib_net. Null si el modelo no está. */
  private async glassesProbability(rgb112: Buffer): Promise<number | null> {
    if (!this.glassesLoaded || !this.glassesNet) return null;
    const size = 112;
    const n = size * size;
    const f = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      f[i] = rgb112[i * 3] / 255;
      f[n + i] = rgb112[i * 3 + 1] / 255;
      f[2 * n + i] = rgb112[i * 3 + 2] / 255;
    }
    const t = new ort.Tensor("float32", f, [1, 3, size, size]);
    const out = await this.glassesNet.run({ [this.glassesNet.inputNames[0]]: t });
    // face_attrib_net expone varios atributos; tomamos la salida "glasses".
    // El nombre exacto depende de la conversión (ver §14): probamos por nombre y,
    // si no, usamos la primera salida escalar como prob de anteojos.
    const byName =
      out["glasses"] ?? out[this.glassesNet.outputNames[0]];
    const arr = byName.data as Float32Array;
    const raw = arr.length === 1 ? arr[0] : Math.max(...Array.from(arr));
    // Si el modelo emite logits, lo pasamos por sigmoide; si ya es prob, queda igual.
    return raw >= 0 && raw <= 1 ? raw : 1 / (1 + Math.exp(-raw));
  }

  /**
   * Evalúa calidad sobre la selfie. `face`/`alignedRgb112` ya vienen del engine
   * (el pipeline detecta una sola vez y reusa). Si no hay cara, faceOk=false.
   */
  async run(
    image: Buffer,
    engine: Engine,
    glassesMax: number = GLASSES_MAX
  ): Promise<QualityResult> {
    const reasons: string[] = [];
    const faces = await engine.detect(image);
    const face = engine.bestFace(faces);

    if (!face) {
      return {
        faceOk: false,
        brightness: 0,
        sharpness: 0,
        pose: { yaw: 0, pitch: 0, roll: 0 },
        glassesPct: 0,
        passed: false,
        reasons: ["no_face"],
      };
    }
    const faceOk = true;
    const pose = poseFromLandmarks(face);
    const { brightness, sharpness } = await this.lumaAndSharpness(image);

    if (brightness < BRIGHTNESS_MIN) reasons.push("low_light");
    if (brightness > BRIGHTNESS_MAX) reasons.push("over_exposed");
    if (sharpness < SHARPNESS_MIN) reasons.push("blur");
    if (
      Math.abs(pose.yaw) > POSE_MAX_DEG ||
      Math.abs(pose.pitch) > POSE_MAX_DEG ||
      Math.abs(pose.roll) > POSE_MAX_DEG
    ) {
      reasons.push("off_pose");
    }

    // --- anti-anteojos ---
    let glassesPct = 0;
    const aligned = await engine.alignToRaw(image, face.landmarks5);
    if (aligned) {
      const prob = await this.glassesProbability(aligned);
      if (prob === null) {
        // Modelo ausente: fail-closed configurable.
        if (GLASSES_REQUIRED) {
          reasons.push("glasses_model_unavailable");
        }
      } else {
        glassesPct = prob;
        if (glassesPct > glassesMax) reasons.push("glasses");
      }
    } else {
      reasons.push("align_failed");
    }

    return {
      faceOk,
      brightness,
      sharpness,
      pose,
      glassesPct,
      passed: reasons.length === 0,
      reasons,
    };
  }
}

export const qualityModule = new QualityModule();
