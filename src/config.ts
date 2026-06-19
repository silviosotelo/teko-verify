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

/**
 * Estimación de edad facial (P2): FairFace ResNet-34 (dchen236/FairFace, LICENCIA
 * **CC BY 4.0** — uso comercial permitido con atribución; ver docs/specs/age-estimation.md).
 * Exportado a ONNX desde los pesos oficiales (res34_fair_align_multi_7_20190809.pt).
 * Multi-tarea: 18 logits = [raza(7), género(2), EDAD(9)]; sólo se usa la cabeza de EDAD.
 * Entrada 224x224 RGB, normalización ImageNet, NCHW. Self-host en el volumen del 34.
 */
export const AGE_MODEL =
  process.env.TEKO_AGE_MODEL || "/app/models/age_fairface_res34.onnx";

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

/**
 * Umbral de similitud (0..1) para que el screening AML marque `potential_match`
 * (P1 #1). Calibrable por env; el workflow puede sobreescribirlo por sesión
 * (def.aml.threshold). Default conservador (0.85): prioriza precisión razonable
 * sin inundar la cola de revisión. Es un PoC con dataset/umbral swappables.
 */
export const AML_MATCH_THRESHOLD = parseFloat(
  process.env.AML_MATCH_THRESHOLD || "0.85"
);

/**
 * MARGEN extra de similitud (0..1) exigido a un hit NO corroborado para marcar
 * `potential_match` (P1 #1 — anti-falso-positivo de nombre común).
 *
 * Un hit "corroborado" (matchea también dob o nacionalidad real, no sólo nombre)
 * basta con que supere `AML_MATCH_THRESHOLD`. Un hit que matchea SÓLO por nombre
 * debe superar `AML_MATCH_THRESHOLD + AML_NAME_ONLY_MARGIN`: así un nombre común
 * paraguayo cuyo único parecido es un token compartido ("ANDRES") cae a `clear`,
 * mientras una entidad OFAC con nombre casi-idéntico (p.ej. "Vladimir Putin",
 * score ≈ 1.0) sigue gatillando aunque no haya dob/nacionalidad. El margen escala
 * con el umbral configurado (si el operador BAJA el threshold para ser laxo, el
 * gate name-only baja en paralelo). Calibrable por env. Default 0.07.
 *
 * CALIBRACIÓN (2026-06-17, sesión field-test 986a770c): el titular real
 * "SILVIO ANDRES SOTELO MACHUCA" daba potential_match 0.8529 por (a) un boost de
 * nacionalidad ESPURIO ("PARAGUAYA" contiene el substring "UA" → matcheaba el
 * código ISO de Ucrania de "PMC Andreevsky Krest") y (b) coincidencias parciales
 * name-only ~0.85 ancladas en el token común "ANDRES". Con el boost de
 * nacionalidad arreglado (comparación por código ISO, no substring) y margen 0.07,
 * todos los hits caen <0.92 sin corroboración → `clear`.
 */
export const AML_NAME_ONLY_MARGIN = parseFloat(
  process.env.AML_NAME_ONLY_MARGIN || "0.07"
);

/**
 * Umbral coseno (0..1) para que la búsqueda 1:N (face_search, P1 #2) considere a
 * una identidad de la galería como la MISMA cara (dedup/anti-fraude + returning
 * user). Es DISTINTO y más alto que el 1:1 (MATCH_THRESHOLD=0.40): el 1:1 compara
 * selfie vs su propia foto del documento (mismo individuo garantizado, sólo se
 * verifica que no sea otra persona), mientras que 1:N busca colisiones contra
 * TODA la galería, donde un umbral bajo inundaría de falsos positivos. Default
 * 0.55 (ArcFace: misma persona suele dar >0.5; distintas <0.4). Calibrable por env;
 * el workflow puede sobreescribirlo por sesión (def.faceSearch.threshold).
 */
export const FACE_SEARCH_THRESHOLD = parseFloat(
  process.env.FACE_SEARCH_THRESHOLD || "0.55"
);

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

// ---------------------------------------------------------------------------
// Webhook circuit breaker (spec §13)
// ---------------------------------------------------------------------------

/**
 * Número de fallos consecutivos antes de abrir el circuit breaker.
 * Al abrirse, los webhooks se skippean por el período de cooldown.
 */
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = parseInt(
  process.env.TEKO_CIRCUIT_BREAKER_FAILURES || "5",
  10
);

/**
 * Duración del estado OPEN del circuit breaker (segundos).
 * Después de este tiempo, se prueba con un intento half-open.
 */
export const CIRCUIT_BREAKER_COOLDOWN_SEC = parseInt(
  process.env.TEKO_CIRCUIT_BREAKER_COOLDOWN || "300",
  10
);

// ---------------------------------------------------------------------------
// Multi-language OCR (spec §15)
// ---------------------------------------------------------------------------

/**
 * Idioma(s) para OCR multi-idioma. Default "spa" (español).
 * Valores: "spa", "eng", "spa+eng", "por", "por+eng", "spa+por".
 * Se pasa al sidecar PaddleOCR como parámetro de idioma.
 */
export const OCR_LANG = process.env.TEKO_OCR_LANG || "spa";

// ---------------------------------------------------------------------------
// Document expiry validation (spec §16)
// ---------------------------------------------------------------------------

/**
 * Edad máxima en años para la validez de la cédula de identidad paraguaya.
 * Según la ley, la CI para es válida hasta los 75 años de edad.
 */
export const CI_MAX_AGE_YEARS = parseInt(
  process.env.TEKO_CI_MAX_AGE_YEARS || "75",
  10
);
