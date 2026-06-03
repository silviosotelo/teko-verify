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
import { PAD_MODEL, LIVENESS_THRESHOLD } from "../config";

/**
 * Factor de escala del recorte PAD (minivision Silent-Face usa 2.7): el bbox del
 * rostro se EXPANDE por este factor alrededor del centro antes de recortar de la
 * imagen ORIGINAL. MiniFASNet necesita CONTEXTO (no el recorte ArcFace ajustado),
 * por eso ve más que la cara. Configurable por si hay que ajustarlo.
 */
const PAD_CROP_SCALE = parseFloat(process.env.TEKO_PAD_CROP_SCALE || "2.7");
/** Tamaño de entrada de MiniFASNet (80x80). */
const PAD_INPUT = 80;

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
   * Score de vivacidad 0..1. MiniFASNet NO usa el recorte ArcFace (112, ajustado y
   * sin contexto): recorta el bbox del rostro EXPANDIDO por `PAD_CROP_SCALE` (~2.7)
   * de la imagen ORIGINAL, luego resize 80x80, RGB, NCHW [1,3,80,80], /255
   * (ToTensor de minivision, sin mean/std). Null si el modelo no está.
   */
  private async padScore(
    selfie: Buffer,
    face: Face
  ): Promise<number | null> {
    if (!this.padLoaded || !this.padNet) return null;
    const meta = await sharp(selfie).metadata();
    const imgW = meta.width || 0;
    const imgH = meta.height || 0;
    if (!imgW || !imgH) return null;
    const box = this.newBox(face.bbox, imgW, imgH, PAD_CROP_SCALE);
    const size = PAD_INPUT;
    const rgb = await sharp(selfie)
      .extract(box)
      .removeAlpha()
      .resize(size, size, { fit: "fill" })
      .raw()
      .toBuffer();
    const n = size * size;
    const f = new Float32Array(3 * n);
    // NORMALIZACIÓN: este export de MiniFASNet espera la entrada en CRUDO 0..255
    // (SIN dividir por 255). Fundamento (no es un número mágico):
    //   1) El grafo ONNX NO tiene normalización embebida (su primer nodo es Conv
    //      directo sobre el input), así que el rango lo debe dar este código.
    //   2) Control de independencia de entrada: con /255 el modelo SATURA y emite
    //      el MISMO vector para negro, ruido y un rostro real (salida independiente
    //      de la entrada) → falso rechazo ~0.007. Con 0..255 crudo la salida SÍ
    //      depende de la entrada → un rostro vivo da prob "real" (índice 1) ~0.999.
    //      Un modelo bien exportado NUNCA es input-independent con su preprocesado
    //      de referencia: el rango entrenado es [0,255], NO [0,1]. NO dividir por 255.
    // LIMITACIÓN conocida (asset del modelo, NO de este código): un único MiniFASNet
    // discrimina débilmente real-vs-print (un retrato impreso da ~0.78, por encima
    // del umbral 0.70). minivision en producción ENSAMBLA 2-3 variantes sumadas; con
    // una sola hay que agregar variante(s) y/o revisar el umbral (ver §13).
    for (let i = 0; i < n; i++) {
      f[i] = rgb[i * 3];
      f[n + i] = rgb[i * 3 + 1];
      f[2 * n + i] = rgb[i * 3 + 2];
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
