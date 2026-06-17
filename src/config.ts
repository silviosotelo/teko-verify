/**
 * Teko Verify — configuración central (on-prem, multi-tenant).
 *
 * El motor de caras se hereda de v9 sin cambios: detector = SCRFD-10G
 * (onnxruntime-node), recognizer = facenox ArcFace (recognizer.onnx),
 * alineación Umeyama 112x112. Los parámetros de decode (DET) y de
 * normalización (REC/REFERENCE_POINTS) son LOAD-BEARING para la corrección
 * del embedding: NO se tocan sus valores (engine.ts depende de ellos
 * bit-a-bit). Solo se renombró el prefijo de env V9_ -> TEKO_ y se ajustó
 * el puerto / la base de datos a los propios de Teko.
 *
 * Reglas duras del proyecto: TypeScript estricto; 100% on-prem; fail-closed
 * (un error nunca produce "verified"); todo dato scopeado por tenant_id.
 */

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

/** Puerto HTTP del servicio Teko Verify (Docker expone 4400). */
export const PORT = parseInt(process.env.PORT || process.env.TEKO_PORT || "4400", 10);

/**
 * Base de datos PostgreSQL propia y dedicada de Teko (NO se reusa el PG de v6).
 * Se lee limpio de DATABASE_URL; sin lectura de .env de v6 (eliminada).
 */
export const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://teko:teko@localhost:5432/teko";

// ---------------------------------------------------------------------------
// Modelos del motor de caras (heredado de v9)
// ---------------------------------------------------------------------------

export const RECOGNIZER_MODEL =
  process.env.TEKO_RECOGNIZER_MODEL || "/app/models/recognizer.onnx";
export const DETECTOR_MODEL =
  process.env.TEKO_DETECTOR_MODEL || "/app/models/scrfd_10g_bnkps.onnx";

// ---------------------------------------------------------------------------
// Modelos ML nuevos de Teko Verify (anti-spoof + anti-anteojos)
// ---------------------------------------------------------------------------

/**
 * PAD / liveness pasivo — ENSEMBLE Silent-Face-Anti-Spoofing (MiniVision,
 * Apache-2.0). El repo de referencia ENSAMBLA 2 MiniFASNet sumando sus softmax:
 *   - PAD_MODEL    = 2.7_80x80   MiniFASNetV2   (crop scale 2.7)
 *   - PAD_MODEL_2  = 4_0_0_80x80 MiniFASNetV1SE (crop scale 4.0)
 * Ambos: input 80x80 RGB CRUDO 0..255 (la `to_tensor` de minivision NO divide por
 * 255 — verificado: un patch constante 200 sale 200.0; la docstring "[0,255]→[0,1]"
 * es copia engañosa de torchvision). Cada uno emite 3 clases [fake_2d, real,
 * fake_3d]; se promedian los softmax y se toma "real" (índice 1) del resultado
 * combinado, como hace el repo (test.py: `prediction += softmax; value/=n`).
 */
export const PAD_MODEL =
  process.env.TEKO_PAD_MODEL || "/app/models/pad_minifasnet.onnx";
/** 2º modelo del ensemble (MiniFASNetV1SE 4_0_0_80x80). Opcional: si falta, se degrada a 1 modelo. */
export const PAD_MODEL_2 =
  process.env.TEKO_PAD_MODEL_2 || "/app/models/pad_minifasnet_v1se_4_0.onnx";

/**
 * Atributos de cara (anti-anteojos): Qualcomm face_attrib_net (TFLite->ONNX).
 * Paridad con lo validado en Flutter; fallback a sidecar Python si la
 * conversión no resulta fiel (ver spec §14).
 */
export const GLASSES_MODEL =
  process.env.TEKO_GLASSES_MODEL || "/app/models/face_attrib_net.onnx";

// ---------------------------------------------------------------------------
// Sidecar OCR (PaddleOCR, Python) — POST /ocr
// ---------------------------------------------------------------------------

export const OCR_SIDECAR_URL =
  process.env.OCR_SIDECAR_URL || "http://localhost:8001";

// ---------------------------------------------------------------------------
// Sesiones de verificación
// ---------------------------------------------------------------------------

/** TTL del link_token de captura, en minutos (spec §6/§9: link expirable). */
export const TOKEN_TTL_MIN = parseInt(process.env.TOKEN_TTL_MIN || "15", 10);

// ---------------------------------------------------------------------------
// Umbrales de decisión (calibrables — ver spec §10/§13)
// ---------------------------------------------------------------------------

/**
 * Umbral de coseno para el match 1:1 selfie<->foto del documento.
 * OJO: 1:1 != 1:N; se calibra contra el set de evaluación (foto de cédula
 * vieja/baja-res). Parámetro tuneable, no adivinado.
 */
export const MATCH_THRESHOLD = parseFloat(process.env.MATCH_THRESHOLD || "0.40");

/**
 * Umbral de score de liveness/PAD para considerar "persona viva".
 *
 * CALIBRACIÓN INTERINA (2026-06-17): el default baja de 0.70 → 0.60 para frenar
 * el FALSO RECHAZO de usuarios genuinos en vivo. Se midió el ENSEMBLE PAD real de
 * producción sobre la evidencia disponible (ver docs/liveness-calibration.md):
 *   - Selfies GENUINAS (rostro vivo, confirmadas visualmente): piso 0.6867, resto ≥0.89.
 *   - Proxies de SPOOF realistas (cédula impresa/foto de documento como selfie):
 *     ≤0.3166, la mayoría <0.05.
 * Un umbral de 0.60 separa con margen el piso genuino (0.6867) del cúmulo de
 * spoofs (≤0.3166). A 0.70 una verificación REAL (sesión 5c9b4817, score 0.686)
 * salía rechazada. El valor operativo se fija por env LIVENESS_THRESHOLD en el
 * compose del 34 (no hardcode); este default sólo evita revertir al 0.70 que
 * falso-rechaza si la env faltara.
 *
 * PENDIENTE: la calibración FINA definitiva requiere un eval set ETIQUETADO de
 * spoofs reales (print/replay/máscara). Existe un outlier conocido —una foto de
 * cédula limpia y completa puntúa ~0.696— que NINGÚN umbral en (0.60, 0.69)
 * separa del piso genuino (0.686): es la debilidad documentada de MiniFASNet con
 * documentos nítidos, mitigada por las defensas en capas (gating facial MediaPipe
 * de la selfie, match 1:1 selfie↔documento, y el desafío activo opcional). Ver §13.
 */
export const LIVENESS_THRESHOLD = parseFloat(
  process.env.LIVENESS_THRESHOLD || "0.60"
);

/** Máximo porcentaje de anteojos tolerado en la selfie (gating de calidad). */
export const GLASSES_MAX = parseFloat(process.env.GLASSES_MAX || "0.50");

// ---------------------------------------------------------------------------
// Contrato heredado del engine de v9 — NO MODIFICAR VALORES
// ---------------------------------------------------------------------------

/**
 * Umbral de similitud usado por el matcher 1:N heredado (gallery.ts/server.ts
 * de v9, hoy en desuso en Teko porque el match es 1:1 — ver MATCH_THRESHOLD).
 * Se conserva como export para no romper el código heredado que aún compila.
 */
export const SIM_THRESHOLD = parseFloat(
  process.env.TEKO_SIM_THRESHOLD || "0.45"
);

/** Tabla del store 1:N heredado (gallery.ts de v9, en desuso en Teko). */
export const TABLE = process.env.TEKO_TABLE || "v9_faces";

// SCRFD detection config (decode probado de v6/v9). Valores load-bearing.
export const DET = {
  // SCRFD acepta input dinámico; 640 es el default entrenado.
  inputSize: parseInt(process.env.TEKO_DET_SIZE || "640", 10),
  scoreThreshold: parseFloat(process.env.TEKO_DET_SCORE || "0.5"),
  nmsThreshold: 0.4,
  strides: [8, 16, 32],
  numAnchors: 2,
  // InsightFace SCRFD canónico usa 0.0 (anchor_centers = grid*stride).
  cellOffset: parseFloat(process.env.TEKO_DET_CELL_OFFSET || "0.0"),
};

// ArcFace recognizer config (facenox: BGR->RGB, (x-127.5)/127.5, NCHW, L2).
export const REC = {
  inputSize: 112,
  embeddingDim: 512,
  inputMean: 127.5,
  inputStd: 127.5,
};

// Plantilla de alineación ArcFace 112x112 (idéntica en facenox y v6).
export const REFERENCE_POINTS: Array<[number, number]> = [
  [38.2946, 51.6963], // ojo izquierdo
  [73.5318, 51.5014], // ojo derecho
  [56.0252, 71.7366], // nariz
  [41.5493, 92.3655], // boca izquierda
  [70.7299, 92.2041], // boca derecha
];
