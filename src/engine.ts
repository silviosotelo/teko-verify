/**
 * v9 inference engine — TypeScript port of v6's proven onnxruntime-node pipeline,
 * with the facenox ArcFace recognizer swapped in.
 *
 * Pipeline (matches facenox conceptually):
 *   detect (SCRFD, best face) -> align 112 (similarity transform + bilinear warp)
 *   -> preprocess (RGB, (x-127.5)/127.5, NCHW) -> ArcFace ONNX -> L2 norm
 *
 * The aligned face is kept as a RAW RGB buffer (no JPEG round-trip), so the
 * recognizer input is lossless — stage-3 parity vs facenox Python = cosine 1.0.
 */
import * as ort from "onnxruntime-node";
// onnxruntime-node requires explicit backend registration (CPU + optional CUDA).
import { onnxruntimeBackend } from "onnxruntime-node/dist/backend";
import sharp from "sharp";
import * as cfg from "./config";

ort.registerBackend("node", onnxruntimeBackend, 10);

export interface Face {
  bbox: [number, number, number, number];
  score: number;
  landmarks5: Array<[number, number]>;
}

export class Engine {
  private detector!: ort.InferenceSession;
  private recognizer!: ort.InferenceSession;
  public ready = false;

  async init(): Promise<void> {
    const opts: ort.InferenceSession.SessionOptions = {
      graphOptimizationLevel: "all",
      executionProviders: ["cpu"],
    };
    this.detector = await ort.InferenceSession.create(cfg.DETECTOR_MODEL, opts);
    this.recognizer = await ort.InferenceSession.create(
      cfg.RECOGNIZER_MODEL,
      opts
    );
    this.ready = true;
  }

  // ---- detection (SCRFD) -------------------------------------------------- //
  async detect(buf: Buffer): Promise<Face[]> {
    const size = cfg.DET.inputSize;
    const meta = await sharp(buf).metadata();
    const W = meta.width || 0;
    const H = meta.height || 0;
    if (!W || !H) return [];

    const scale = Math.min(size / W, size / H);
    const rw = Math.round(W * scale);
    const rh = Math.round(H * scale);
    const padX = Math.floor((size - rw) / 2);
    const padY = Math.floor((size - rh) / 2);

    const { data } = await sharp(buf)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0 } })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const n = size * size;
    const f = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      f[i] = (data[i * 3] - 127.5) / 128.0; // R
      f[n + i] = (data[i * 3 + 1] - 127.5) / 128.0; // G
      f[2 * n + i] = (data[i * 3 + 2] - 127.5) / 128.0; // B
    }
    const t = new ort.Tensor("float32", f, [1, 3, size, size]);
    const out = await this.detector.run({ [this.detector.inputNames[0]]: t });
    return this.decodeSCRFD(out, W, H, scale, padX, padY);
  }

  private decodeSCRFD(
    out: ort.InferenceSession.OnnxValueMapType,
    W: number,
    H: number,
    scale: number,
    padX: number,
    padY: number
  ): Face[] {
    const names = this.detector.outputNames;
    const size = cfg.DET.inputSize;
    const numStrides = cfg.DET.strides.length;
    const toOrigX = (x: number) => (x - padX) / scale;
    const toOrigY = (y: number) => (y - padY) / scale;
    const faces: Face[] = [];

    for (let si = 0; si < numStrides; si++) {
      const stride = cfg.DET.strides[si];
      const fmW = Math.ceil(size / stride);
      const fmH = Math.ceil(size / stride);
      const scores = out[names[si]].data as Float32Array;
      const bboxes = out[names[numStrides + si]].data as Float32Array;
      const kps = out[names[2 * numStrides + si]].data as Float32Array;
      if (!scores || !bboxes) continue;
      const na = cfg.DET.numAnchors;

      for (let h = 0; h < fmH; h++) {
        for (let w = 0; w < fmW; w++) {
          for (let a = 0; a < na; a++) {
            const idx = (h * fmW + w) * na + a;
            const score = scores[idx];
            if (score < cfg.DET.scoreThreshold) continue;

            const cx = (w + cfg.DET.cellOffset) * stride;
            const cy = (h + cfg.DET.cellOffset) * stride;
            const bi = idx * 4;
            const x1 = toOrigX(cx - bboxes[bi] * stride);
            const y1 = toOrigY(cy - bboxes[bi + 1] * stride);
            const x2 = toOrigX(cx + bboxes[bi + 2] * stride);
            const y2 = toOrigY(cy + bboxes[bi + 3] * stride);

            const landmarks5: Array<[number, number]> = [];
            if (kps) {
              const ki = idx * 10;
              for (let k = 0; k < 5; k++) {
                landmarks5.push([
                  toOrigX(cx + kps[ki + k * 2] * stride),
                  toOrigY(cy + kps[ki + k * 2 + 1] * stride),
                ]);
              }
            }
            faces.push({
              bbox: [
                Math.max(0, x1),
                Math.max(0, y1),
                Math.min(W, x2),
                Math.min(H, y2),
              ],
              score,
              landmarks5,
            });
          }
        }
      }
    }
    return this.nms(faces, cfg.DET.nmsThreshold);
  }

  private nms(faces: Face[], thr: number): Face[] {
    if (faces.length === 0) return [];
    faces.sort((a, b) => b.score - a.score);
    const kept: Face[] = [];
    const sup = new Set<number>();
    for (let i = 0; i < faces.length; i++) {
      if (sup.has(i)) continue;
      kept.push(faces[i]);
      for (let j = i + 1; j < faces.length; j++) {
        if (sup.has(j)) continue;
        if (this.iou(faces[i].bbox, faces[j].bbox) > thr) sup.add(j);
      }
    }
    return kept;
  }

  private iou(
    a: [number, number, number, number],
    b: [number, number, number, number]
  ): number {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]);
    const y2 = Math.min(a[3], b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = (a[2] - a[0]) * (a[3] - a[1]);
    const areaB = (b[2] - b[0]) * (b[3] - b[1]);
    return inter / (areaA + areaB - inter + 1e-6);
  }

  bestFace(faces: Face[]): Face | null {
    if (faces.length === 0) return null;
    return faces.reduce((p, c) => (c.score > p.score ? c : p));
  }

  // ---- alignment (similarity transform + bilinear warp -> raw RGB 112) ---- //
  private estimateSimilarityTransform(
    src: Array<[number, number]>,
    dst: Array<[number, number]>
  ): number[][] {
    const n = Math.min(src.length, dst.length);
    const sm = [0, 0];
    const dm = [0, 0];
    for (let i = 0; i < n; i++) {
      sm[0] += src[i][0];
      sm[1] += src[i][1];
      dm[0] += dst[i][0];
      dm[1] += dst[i][1];
    }
    sm[0] /= n;
    sm[1] /= n;
    dm[0] /= n;
    dm[1] /= n;
    let denom = 0;
    let aNum = 0;
    let bNum = 0;
    for (let i = 0; i < n; i++) {
      const sx = src[i][0] - sm[0];
      const sy = src[i][1] - sm[1];
      const dx = dst[i][0] - dm[0];
      const dy = dst[i][1] - dm[1];
      denom += sx * sx + sy * sy;
      aNum += dx * sx + dy * sy;
      bNum += dy * sx - dx * sy;
    }
    const a = aNum / (denom + 1e-8);
    const b = bNum / (denom + 1e-8);
    const tx = dm[0] - a * sm[0] + b * sm[1];
    const ty = dm[1] - b * sm[0] - a * sm[1];
    return [
      [a, -b, tx],
      [b, a, ty],
    ];
  }

  private sampleBilinear(
    data: Buffer,
    width: number,
    height: number,
    channels: number,
    x: number,
    y: number
  ): [number, number, number] {
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
      return [127, 127, 127];
    }
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const wx = x - x0;
    const wy = y - y0;
    const i00 = (y0 * width + x0) * channels;
    const i10 = (y0 * width + x1) * channels;
    const i01 = (y1 * width + x0) * channels;
    const i11 = (y1 * width + x1) * channels;
    const px: [number, number, number] = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) {
      const top = data[i00 + ch] * (1 - wx) + data[i10 + ch] * wx;
      const bot = data[i01 + ch] * (1 - wx) + data[i11 + ch] * wx;
      px[ch] = Math.max(0, Math.min(255, Math.round(top * (1 - wy) + bot * wy)));
    }
    return px;
  }

  /** Warp the source image into the 112x112 ArcFace template; returns RAW RGB. */
  async alignToRaw(
    buf: Buffer,
    landmarks5: Array<[number, number]>
  ): Promise<Buffer | null> {
    if (!landmarks5 || landmarks5.length !== 5) return null;
    const M = this.estimateSimilarityTransform(landmarks5, cfg.REFERENCE_POINTS);
    const { data, info } = await sharp(buf)
      .removeAlpha()
      .toColorspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    if (channels < 3) return null;

    const a = M[0][0];
    const b = M[0][1];
    const tx = M[0][2];
    const c = M[1][0];
    const d = M[1][1];
    const ty = M[1][2];
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-8) return null;
    const invA = d / det;
    const invB = -b / det;
    const invC = -c / det;
    const invD = a / det;

    const out = cfg.REC.inputSize;
    const raw = Buffer.alloc(out * out * 3);
    for (let y = 0; y < out; y++) {
      for (let x = 0; x < out; x++) {
        const dx = x - tx;
        const dy = y - ty;
        const sx = invA * dx + invB * dy;
        const sy = invC * dx + invD * dy;
        const p = this.sampleBilinear(data, width, height, channels, sx, sy);
        const o = (y * out + x) * 3;
        raw[o] = p[0];
        raw[o + 1] = p[1];
        raw[o + 2] = p[2];
      }
    }
    return raw;
  }

  // ---- recognition (ArcFace, facenox model) ------------------------------ //
  async embedFromRaw(rgb112: Buffer): Promise<Float32Array> {
    const size = cfg.REC.inputSize;
    const n = size * size;
    const f = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      f[i] = (rgb112[i * 3] - cfg.REC.inputMean) / cfg.REC.inputStd; // R
      f[n + i] = (rgb112[i * 3 + 1] - cfg.REC.inputMean) / cfg.REC.inputStd; // G
      f[2 * n + i] = (rgb112[i * 3 + 2] - cfg.REC.inputMean) / cfg.REC.inputStd; // B
    }
    const t = new ort.Tensor("float32", f, [1, 3, size, size]);
    const r = await this.recognizer.run({
      [this.recognizer.inputNames[0]]: t,
    });
    const emb = r[this.recognizer.outputNames[0]].data as Float32Array;
    return this.l2(new Float32Array(emb));
  }

  private l2(v: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) + 1e-10;
    const r = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) r[i] = v[i] / norm;
    return r;
  }

  /** Full path: detect best -> align -> embed. Returns null if no face. */
  async embedBestFace(
    buf: Buffer
  ): Promise<{ embedding: Float32Array; face: Face } | null> {
    const faces = await this.detect(buf);
    const face = this.bestFace(faces);
    if (!face) return null;
    const raw = await this.alignToRaw(buf, face.landmarks5);
    if (!raw) return null;
    const embedding = await this.embedFromRaw(raw);
    return { embedding, face };
  }
}

export const engine = new Engine();
