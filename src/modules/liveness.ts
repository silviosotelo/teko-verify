/**
 * Módulo `liveness` — PAD pasivo (anti-spoof) + desafío activo opcional (§6.b/§7).
 *
 * Contrato (spec §6): liveness(selfie, frames?, challenge?) → {score, passed,
 * attackType?, challenge?, challengePassed?}. Rechazo duro: si no pasa → rejected.
 *
 * Modelo: Silent-Face-Anti-Spoofing (MiniFASNet) ONNX. Pasivo, RGB, detecta
 * print/replay sobre la cara recortada. El desafío activo (parpadeo/giro) es un
 * refuerzo opcional que la policy del tenant puede exigir (livenessChallenges).
 *
 * FAIL-CLOSED (regla dura del proyecto): liveness es una decisión de SEGURIDAD. Si
 * el modelo PAD NO carga o la inferencia falla, NO podemos afirmar "persona viva":
 * el resultado es passed=false (score=0, attackType "unknown"). Nunca verified por
 * un modelo ausente. El llamador (pipeline) sólo invoca liveness cuando el LoA
 * requerido es L3; para L1/L2 el pipeline puede omitirlo.
 */
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import type { Engine } from "../engine";
import type { LivenessChallenge, LivenessResult } from "../types";
import { PAD_MODEL, LIVENESS_THRESHOLD } from "../config";

export class LivenessModule {
  private padNet: ort.InferenceSession | null = null;
  private padLoaded = false;
  public ready = false;

  /** Carga MiniFASNet. No-throw: el faltante se maneja fail-closed en run(). */
  async init(): Promise<void> {
    try {
      this.padNet = await ort.InferenceSession.create(PAD_MODEL, {
        graphOptimizationLevel: "all",
        executionProviders: ["cpu"],
      });
      this.padLoaded = true;
    } catch (e) {
      this.padLoaded = false;
      // eslint-disable-next-line no-console
      console.warn(
        `[liveness] modelo PAD no disponible (${PAD_MODEL}): ${(e as Error).message}`
      );
    }
    this.ready = true;
  }

  /** Score de vivacidad 0..1 sobre el recorte alineado. Null si el modelo no está. */
  private async padScore(rgb112: Buffer): Promise<number | null> {
    if (!this.padLoaded || !this.padNet) return null;
    // MiniFASNet espera 80x80 (NCHW [1,3,80,80]); la cara viene alineada a 112
    // (ArcFace) → la reescalamos a 80 antes de inferir.
    const size = 80;
    const rgb = await sharp(rgb112, { raw: { width: 112, height: 112, channels: 3 } })
      .resize(size, size, { fit: "fill" })
      .raw()
      .toBuffer();
    const n = size * size;
    const f = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      f[i] = rgb[i * 3] / 255;
      f[n + i] = rgb[i * 3 + 1] / 255;
      f[2 * n + i] = rgb[i * 3 + 2] / 255;
    }
    const t = new ort.Tensor("float32", f, [1, 3, size, size]);
    const out = await this.padNet.run({ [this.padNet.inputNames[0]]: t });
    const arr = out[this.padNet.outputNames[0]].data as Float32Array;
    // MiniFASNet emite 3 clases [fake_2d, real, fake_3d] (o similar): softmax y
    // tomamos la prob de "real" (índice 1). Si emite un único escalar, lo usamos.
    if (arr.length === 1) {
      const v = arr[0];
      return v >= 0 && v <= 1 ? v : 1 / (1 + Math.exp(-v));
    }
    const exps = Array.from(arr).map((v) => Math.exp(v));
    const sum = exps.reduce((a, b) => a + b, 0) + 1e-10;
    const probs = exps.map((v) => v / sum);
    // índice 1 = "real" en la convención de Silent-Face.
    return probs[1] ?? Math.max(...probs);
  }

  /**
   * Evalúa liveness. `selfie` es la imagen principal; `frames` opcionales para el
   * desafío activo; `challenge` el desafío exigido por la policy (si lo hay).
   */
  async run(
    selfie: Buffer,
    engine: Engine,
    opts: {
      frames?: Buffer[];
      challenge?: LivenessChallenge;
      threshold?: number;
    } = {}
  ): Promise<LivenessResult> {
    const threshold = opts.threshold ?? LIVENESS_THRESHOLD;
    const det = await engine.embedBestFace(selfie); // detecta + alinea
    if (!det) {
      return { score: 0, passed: false, attackType: "unknown" };
    }
    const aligned = await engine.alignToRaw(selfie, det.face.landmarks5);
    if (!aligned) {
      return { score: 0, passed: false, attackType: "unknown" };
    }

    const score = await this.padScore(aligned);
    if (score === null) {
      // FAIL-CLOSED: sin modelo PAD no se acredita vivacidad.
      return { score: 0, passed: false, attackType: "unknown" };
    }

    const passed = score >= threshold;
    const attackType = passed ? "none" : "replay";

    const result: LivenessResult = { score, passed, attackType };

    // Desafío activo opcional: si la policy lo exige, lo evaluamos de verdad.
    if (opts.challenge) {
      result.challenge = opts.challenge;
      // FAIL-CLOSED: arrancamos en NO superado; solo una detección positiva lo sube.
      result.challengePassed = false;

      const turnChallenge =
        opts.challenge === "turn_left" || opts.challenge === "turn_right";

      // Solo el giro (turn_left/turn_right) es detectable de forma honesta con los
      // 5 landmarks de SCRFD: estimamos el yaw por la posición horizontal de la
      // nariz respecto al punto medio de los ojos, normalizada por el ancho
      // inter-ocular, y exigimos un DELTA de yaw en la dirección pedida entre dos
      // capturas reales (selfie + frame). blink/smile/nod NO son medibles con 5
      // puntos → quedan honestamente sin acreditar (challengePassed=false) hasta
      // contar con landmarks densos o un modelo de gesto dedicado (ver §13).
      if (turnChallenge) {
        const yaws = await this.frameYaws(opts.frames, engine);
        if (yaws.length >= 2) {
          // yaw>0 cuando la nariz se corre a la derecha de la imagen.
          const delta = yaws[yaws.length - 1] - yaws[0];
          const MIN_YAW_DELTA = 0.12; // proporción del ancho inter-ocular (~giro perceptible)
          const turnedRight = delta >= MIN_YAW_DELTA;
          const turnedLeft = delta <= -MIN_YAW_DELTA;
          result.challengePassed =
            opts.challenge === "turn_right" ? turnedRight : turnedLeft;
        }
      }

      // Si el desafío exigido no se acreditó, la liveness NO pasa (rechazo duro).
      if (!result.challengePassed) {
        result.passed = false;
      }
    }

    return result;
  }

  /**
   * Estima el yaw (proxy) de la mejor cara en cada frame a partir de los 5
   * landmarks de SCRFD: (nariz_x − ojo_medio_x) / ancho_inter_ocular. Positivo si
   * la nariz cae a la derecha del centro de los ojos. Devuelve un valor por frame
   * con cara detectada; omite frames sin cara. No-throw (fail-closed: ante error
   * devuelve lo acumulado, lo que deja el desafío sin acreditar).
   */
  private async frameYaws(
    frames: Buffer[] | undefined,
    engine: Engine
  ): Promise<number[]> {
    if (!frames || frames.length < 2) return [];
    const yaws: number[] = [];
    for (const f of frames) {
      try {
        const det = await engine.embedBestFace(f);
        const lm = det?.face.landmarks5;
        if (!lm || lm.length !== 5) continue;
        const [leftEye, rightEye, nose] = lm;
        const eyeMidX = (leftEye[0] + rightEye[0]) / 2;
        const interOcular = Math.hypot(rightEye[0] - leftEye[0], rightEye[1] - leftEye[1]);
        if (interOcular < 1e-3) continue;
        yaws.push((nose[0] - eyeMidX) / interOcular);
      } catch {
        // fail-closed: un frame ilegible no acredita gesto; seguimos con el resto.
      }
    }
    return yaws;
  }
}

export const livenessModule = new LivenessModule();
