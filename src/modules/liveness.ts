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
import type { Engine, Face } from "../engine";
import type { LivenessChallenge, LivenessResult } from "../types";
import { PAD_MODEL, PAD_MODEL_2, LIVENESS_THRESHOLD } from "../config";

/**
 * Factores de escala del recorte PAD por modelo (estilo minivision Silent-Face):
 * el bbox del rostro se EXPANDE por este factor alrededor del centro antes de
 * recortar de la imagen ORIGINAL. MiniFASNet necesita CONTEXTO (no el recorte
 * ArcFace ajustado), por eso ve más que la cara. El repo usa una escala POR
 * modelo: 2.7 para MiniFASNetV2 (PAD_MODEL) y 4.0 para MiniFASNetV1SE (PAD_MODEL_2).
 */
const PAD_CROP_SCALE = parseFloat(process.env.TEKO_PAD_CROP_SCALE || "2.7");
const PAD_CROP_SCALE_2 = parseFloat(process.env.TEKO_PAD_CROP_SCALE_2 || "4.0");
/** Tamaño de entrada de MiniFASNet (80x80). */
const PAD_INPUT = 80;

/**
 * softmax numéricamente estable. Helper PURO (testeable sin el modelo real).
 */
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
 * Ensamble de Silent-Face: promedia las distribuciones softmax de cada modelo y
 * devuelve la prob de "real" (índice 1) del resultado combinado, replicando el
 * repo (`prediction += softmax(...)`, `value = prediction[label]/n_models`). Como
 * cada softmax suma 1, el promedio también suma 1 y la prob "real" sale directa.
 * Helper PURO (testeable sin el modelo real). `null` si no hay distribuciones.
 */
export function ensembleRealProb(dists: number[][]): number | null {
  if (dists.length === 0) return null;
  const k = dists[0].length;
  const avg = new Array<number>(k).fill(0);
  for (const d of dists) {
    for (let i = 0; i < k; i++) avg[i] += d[i] ?? 0;
  }
  for (let i = 0; i < k; i++) avg[i] /= dists.length;
  // índice 1 = "real" en la convención de Silent-Face; si el modelo emitiera un
  // único escalar (no es el caso de MiniFASNet 3-clases) usamos el máximo.
  return avg[1] ?? Math.max(...avg);
}

interface PadModel {
  net: ort.InferenceSession;
  scale: number;
  path: string;
}

export class LivenessModule {
  private padModels: PadModel[] = [];
  private padLoaded = false;
  public ready = false;

  /**
   * Carga el ENSEMBLE de MiniFASNet (modelo 2.7 + modelo 4.0). No-throw: cada
   * faltante se loguea y se omite; con AL MENOS uno el PAD opera (degradado a 1
   * modelo). Con NINGUNO, padScore() devuelve null → fail-closed en run().
   */
  async init(): Promise<void> {
    const specs: Array<{ path: string; scale: number }> = [
      { path: PAD_MODEL, scale: PAD_CROP_SCALE },
      { path: PAD_MODEL_2, scale: PAD_CROP_SCALE_2 },
    ];
    this.padModels = [];
    for (const spec of specs) {
      try {
        const net = await ort.InferenceSession.create(spec.path, {
          graphOptimizationLevel: "all",
          executionProviders: ["cpu"],
        });
        this.padModels.push({ net, scale: spec.scale, path: spec.path });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          `[liveness] modelo PAD no disponible (${spec.path}): ${(e as Error).message}`
        );
      }
    }
    this.padLoaded = this.padModels.length > 0;
    if (this.padModels.length === 1) {
      // eslint-disable-next-line no-console
      console.warn(
        "[liveness] ensemble DEGRADADO a 1 modelo PAD; señal anti-spoof menos robusta (ver §13)."
      );
    }
    this.ready = true;
  }

  /**
   * Calcula el recorte EXPANDIDO (estilo minivision `CropImage._get_new_box`):
   * a partir del bbox `[x1,y1,x2,y2]` y la escala, expande alrededor del centro,
   * clampea la escala para no salirse de la imagen y traslada+clampea la caja a los
   * bordes. Devuelve `{left, top, width, height}` listo para `sharp.extract`
   * (entero, dentro de [0,W]×[0,H], ancho/alto ≥ 1). Esto evita el "bad extract
   * area" de sharp y mantiene la caja completa dentro de la imagen.
   */
  private newBox(
    bbox: [number, number, number, number],
    imgW: number,
    imgH: number,
    scale: number
  ): { left: number; top: number; width: number; height: number } {
    const [x1, y1, x2, y2] = bbox;
    const boxW = Math.max(1, x2 - x1);
    const boxH = Math.max(1, y2 - y1);
    // Clampeo de escala: no puede expandir más allá de los bordes de la imagen.
    const s = Math.min(scale, (imgH - 1) / boxH, (imgW - 1) / boxW);
    const newW = boxW * s;
    const newH = boxH * s;
    const cx = x1 + boxW / 2;
    const cy = y1 + boxH / 2;
    // Esquina superior-izquierda candidata, luego trasladar dentro de los bordes.
    let left = cx - newW / 2;
    let top = cy - newH / 2;
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left + newW > imgW) left = imgW - newW;
    if (top + newH > imgH) top = imgH - newH;
    return {
      left: Math.max(0, Math.round(left)),
      top: Math.max(0, Math.round(top)),
      width: Math.max(1, Math.round(newW)),
      height: Math.max(1, Math.round(newH)),
    };
  }

  /**
   * Distribución softmax (3 clases [fake_2d, real, fake_3d]) de UN modelo PAD para
   * el recorte expandido por `scale`. MiniFASNet NO usa el recorte ArcFace (112,
   * ajustado y sin contexto): recorta el bbox EXPANDIDO de la imagen ORIGINAL,
   * resize 80x80, RGB, NCHW [1,3,80,80], entrada CRUDA 0..255.
   *
   * NORMALIZACIÓN: la entrada va en CRUDO 0..255 (SIN dividir por 255). No es un
   * número mágico: la `to_tensor` de minivision NO divide por 255 (verificado: un
   * patch constante 200 sale 200.0; su docstring "[0,255]→[0,1]" es copia engañosa
   * de torchvision), así que estos modelos están ENTRENADOS en [0,255]. Control de
   * independencia de entrada: con /255 ambos modelos SATURAN a un vector
   * independiente de la entrada (rostro vivo, ruido y negro → mismo ~fake_3d 0.99);
   * con 0..255 crudo la salida depende de la entrada (rostro vivo → "real" ~0.999).
   * Export ONNX verificado bit-a-bit contra el .pth (dif. de logits ~1e-6).
   */
  private async modelDist(
    model: PadModel,
    selfie: Buffer,
    face: Face,
    imgW: number,
    imgH: number
  ): Promise<number[] | null> {
    const box = this.newBox(face.bbox, imgW, imgH, model.scale);
    const size = PAD_INPUT;
    const rgb = await sharp(selfie)
      .extract(box)
      .removeAlpha()
      .resize(size, size, { fit: "fill" })
      .raw()
      .toBuffer();
    const n = size * size;
    const f = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      f[i] = rgb[i * 3];
      f[n + i] = rgb[i * 3 + 1];
      f[2 * n + i] = rgb[i * 3 + 2];
    }
    const t = new ort.Tensor("float32", f, [1, 3, size, size]);
    const out = await model.net.run({ [model.net.inputNames[0]]: t });
    const arr = out[model.net.outputNames[0]].data as Float32Array;
    // MiniFASNet emite 3 logits → softmax. Si emitiera un único escalar (no es el
    // caso), lo mapeamos a [fake, real] para que el ensemble lo promedie igual.
    if (arr.length === 1) {
      const v = arr[0];
      const real = v >= 0 && v <= 1 ? v : 1 / (1 + Math.exp(-v));
      return [1 - real, real];
    }
    return softmax(arr);
  }

  /**
   * Score de vivacidad 0..1 = prob "real" del ENSEMBLE. Corre TODOS los modelos
   * PAD cargados (cada uno con su crop scale), promedia los softmax y toma el
   * índice "real". Null si no hay modelos (→ fail-closed en run()).
   *
   * LIMITACIÓN (asset del modelo, NO del código): un único MiniFASNet discrimina
   * débilmente real-vs-print. El ensemble (diseño de minivision) suma una 2ª vista
   * para una señal más robusta. La calibración FINA del umbral queda PENDIENTE de
   * un set etiquetado de spoofs reales (no lo tenemos; un escaneo limpio de cédula
   * lo clasifican "real" hasta el ensemble de referencia, porque MiniFASNet detecta
   * TEXTURA de pantalla/impresión, ausente en una foto de documento nítida). Ver §13.
   *
   * CALIBRACIÓN INTERINA (2026-06-17): se midió el ensemble real sobre la evidencia
   * disponible y se bajó LIVENESS_THRESHOLD 0.70 → 0.60 para no falso-rechazar
   * genuinos (piso genuino 0.6867 vs cúmulo de spoofs ≤0.3166). Detalle y datos en
   * docs/liveness-calibration.md.
   */
  private async padScore(selfie: Buffer, face: Face): Promise<number | null> {
    if (!this.padLoaded || this.padModels.length === 0) return null;
    const meta = await sharp(selfie).metadata();
    const imgW = meta.width || 0;
    const imgH = meta.height || 0;
    if (!imgW || !imgH) return null;
    const dists: number[][] = [];
    for (const model of this.padModels) {
      const d = await this.modelDist(model, selfie, face, imgW, imgH);
      if (d) dists.push(d);
    }
    return ensembleRealProb(dists);
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
      /**
       * Liveness ACTIVO interactivo reportado por el cliente (desafíos guiados
       * detectados por blendshapes + matriz de transformación de MediaPipe). Señal
       * anti-spoof FUERTE: un print/replay estático no completa la secuencia. Se
       * COMBINA con el PAD (AND); fail-closed si está presente y no se completó.
       */
      activeLiveness?: { challenges: string[]; passed: boolean };
    } = {}
  ): Promise<LivenessResult> {
    const threshold = opts.threshold ?? LIVENESS_THRESHOLD;
    const det = await engine.embedBestFace(selfie); // detecta + alinea
    if (!det) {
      return { score: 0, passed: false, attackType: "unknown" };
    }
    // PAD sobre la imagen ORIGINAL + bbox del rostro (recorte expandido con
    // contexto, estilo minivision), NO sobre el recorte ArcFace 112.
    const score = await this.padScore(selfie, det.face);
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

    // LIVENESS ACTIVO interactivo (desafíos guiados ejecutados en el navegador). Es
    // la señal anti-spoof FUERTE que cierra el print-attack que el PAD pasivo no
    // cubre (un MiniFASNet clasifica "real" un escaneo nítido de cédula). Se COMBINA
    // con el PAD por AND y es FAIL-CLOSED: presente-pero-no-completado fuerza el
    // rechazo, aunque el PAD haya pasado. Ausente ⇒ no debilita (cae al PAD + el
    // challenge por frames de arriba). El cliente reporta el resultado; el video
    // `liveness_video` es la evidencia auditable que lo respalda.
    if (opts.activeLiveness) {
      result.activeLiveness = {
        challenges: Array.isArray(opts.activeLiveness.challenges)
          ? opts.activeLiveness.challenges
          : [],
        passed: opts.activeLiveness.passed === true,
      };
      if (!result.activeLiveness.passed) {
        result.passed = false;
        if (result.attackType === "none") result.attackType = "unknown";
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
