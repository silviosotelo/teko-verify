/**
 * Teko Verify — contratos canónicos (TypeScript estricto).
 *
 * Este archivo es la fuente de verdad de TODOS los contratos del servicio:
 *   1. Primitivas y uniones compartidas (LoA, estados, tipos de check).
 *   2. Contratos de módulos del pipeline (§6 del spec): quality, liveness,
 *      document, match, decision.
 *   3. Modelo de datos multi-tenant (§5): tenants, api_keys, sessions, checks,
 *      identities, evidence, audit_log, consents.
 *   4. DTOs de las APIs (§8): API del tenant (/v1/*), API admin (/admin/*) y el
 *      payload de webhook firmado.
 *
 * Reglas duras reflejadas aquí:
 *   - `tenantId` está presente en TODA entidad persistida (aislamiento multi-tenant).
 *   - Las decisiones de seguridad son FAIL-CLOSED: un error nunca produce "verified"
 *     (de ahí el estado `error` y el verdict `LoA = "L0"`).
 *   - Sin `any` en los JSONB: `TenantPolicy`, `SessionResult`, `*Detail` son tipos reales.
 *   - Runtime-free: solo `import type` del engine; este archivo no carga onnx/sharp.
 */

import type { Face } from "./engine";

// ============================================================================ //
// 1. PRIMITIVAS Y UNIONES COMPARTIDAS
// ============================================================================ //

/**
 * Niveles de aseguramiento (Level of Assurance) — §6.
 *   L0 = sin aseguramiento (rechazo / fail-closed): la decisión NO acreditó identidad.
 *   L1 = documento legible + datos consistentes (sin match ni liveness).
 *   L2 = L1 + match 1:1 doc↔selfie OK.
 *   L3 = L2 + liveness OK (persona viva). ← objetivo del flujo completo.
 *   L4 = futuro: L3 + chip eMRTD por NFC (fuera de alcance de captura web).
 */
export type LoA = "L0" | "L1" | "L2" | "L3" | "L4";

/**
 * Máquina de estados de la sesión de verificación — §6 + §9.
 * Incluye `error` (§9: error de sistema → la sesión queda en `error`, nunca verified).
 */
export type SessionState =
  | "created"
  | "capturing"
  | "processing"
  | "review"
  | "verified"
  | "rejected"
  | "needs_recapture"
  | "expired"
  | "error";

/** Veredicto que produce `decision()` — subconjunto de SessionState (§6). */
export type DecisionVerdict = "verified" | "rejected" | "needs_recapture";

/** Tipo de check granular auditable — §5 (verification_checks.tipo). */
export type CheckType = "quality" | "liveness" | "document" | "match";

/**
 * Tipo de evidencia almacenada — §5 (evidence.tipo).
 *
 * `doc_front_raw`/`doc_back_raw` son la imagen CRUDA original del documento (tal cual
 * la OCR-ea el pipeline), persistida ADEMÁS de `doc_front`/`doc_back` para poder
 * debuggear la extracción real (lo que el OCR ve), no la versión recortada/enderezada.
 */
export type EvidenceType =
  | "selfie"
  | "doc_front"
  | "doc_back"
  | "frames"
  | "doc_front_raw"
  | "doc_back_raw";

/** Estado de un tenant. */
export type TenantStatus = "active" | "suspended" | "disabled";

/** Estado de una API key. */
export type ApiKeyStatus = "active" | "revoked";

/** Tipo de documento soportado. Hoy: cédula PY. */
export type DocumentType = "ci_py";

/**
 * Tipo de ataque detectado por el PAD pasivo (anti-spoof) — §6.
 * `none` cuando no se detecta ataque.
 */
export type AttackType = "none" | "print" | "replay" | "mask" | "deepfake" | "unknown";

/** Desafío activo de liveness (refuerzo opcional configurable por policy) — §6/§13. */
export type LivenessChallenge = "blink" | "turn_left" | "turn_right" | "smile" | "nod";

/** Roles del operador del dashboard admin — §8.C. */
export type AdminRole = "owner" | "operator" | "viewer";

/**
 * admin_operators — operador del dashboard admin con auth/roles propios (§8.C).
 * El secreto NUNCA se persiste en plano: solo `passwordHash`.
 */
export interface AdminOperator {
  id: string;
  username: string;
  /** Hash de la contraseña (p.ej. argon2/bcrypt). Nunca la contraseña en plano. */
  passwordHash: string;
  role: AdminRole;
  createdAt: string; // ISO 8601
}

// ============================================================================ //
// 2. CONTRATOS DE MÓDULOS DEL PIPELINE (§6)
// ============================================================================ //

/** Pose de la cabeza en grados (yaw/pitch/roll) derivada de landmarks SCRFD — §7. */
export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * `quality(image)` → calidad + anti-anteojos + gating de pose/brillo/nitidez.
 * Recuperable: si `passed=false` el pipeline va a needs_recapture (§9).
 */
export interface QualityResult {
  /** Hubo exactamente una cara usable detectada por SCRFD. */
  faceOk: boolean;
  /** Luma media normalizada 0..1. */
  brightness: number;
  /** Nitidez (varianza del Laplaciano), mayor = más nítido. */
  sharpness: number;
  /** Pose de cabeza (frontalidad). */
  pose: HeadPose;
  /** Probabilidad 0..1 de que la persona use anteojos (anti-anteojos). */
  glassesPct: number;
  passed: boolean;
  /** Motivos legibles cuando no pasa (p.ej. "blur", "glasses", "no_face", "low_light", "off_pose"). */
  reasons: string[];
}

/**
 * `liveness(selfie, frames?, challenge?)` → PAD pasivo (+ desafío activo opcional).
 * Rechazo duro: si `passed=false` → rejected (§9). Fail-closed.
 */
export interface LivenessResult {
  /** Score de "vivacidad" 0..1 (mayor = más probable persona viva real). */
  score: number;
  passed: boolean;
  /** Tipo de ataque si se sospecha spoof. */
  attackType: AttackType;
  /** Desafío activo solicitado (si la policy lo exige) y si se cumplió. */
  challenge?: LivenessChallenge;
  challengePassed?: boolean;
}

/** MRZ TD1 (ICAO 9303) — fuente legible-por-máquina autoritativa (dorso) — §3.13/§7. */
export interface MrzData {
  /** Las 3 líneas crudas leídas por OCR (30 chars c/u en TD1). */
  rawLines: string[];
  documentType: string;
  issuingCountry: string;
  documentNumber: string;
  surname: string;
  givenNames: string;
  nationality: string;
  /** Fecha de nacimiento en ISO 8601 (YYYY-MM-DD). */
  dateOfBirth: string;
  sex: string;
  /** Fecha de expiración en ISO 8601 (YYYY-MM-DD). */
  expirationDate: string;
  optionalData?: string;
  /** Resultado de los dígitos verificadores del parser `mrz`. */
  checkDigits: {
    documentNumber: boolean;
    dateOfBirth: boolean;
    expirationDate: boolean;
    composite: boolean;
  };
  /** true si TODOS los dígitos verificadores son válidos. */
  valid: boolean;
}

/** Barcode 1D (Code128) del dorso — serial del documento — §7. */
export interface BarcodeData {
  format: string; // "CODE_128"
  /** Texto decodificado (serial). */
  text: string;
}

/**
 * Una línea reconocida por el OCR con su caja (4 esquinas en píxeles). El
 * sidecar PaddleOCR ya las devuelve; las usamos para anclar valores por posición.
 */
export interface OcrLine {
  text: string;
  score: number;
  /** 4 esquinas [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] en píxeles. */
  box: [[number, number], [number, number], [number, number], [number, number]];
}

/** OCR visual del frente (PaddleOCR sidecar) — §7. */
export interface OcrData {
  /** Texto completo concatenado tal como lo devuelve el sidecar. */
  rawText: string;
  /** Campos estructurados parseados del frente de la cédula PY. */
  fields: {
    documentNumber?: string;
    surname?: string;
    givenNames?: string;
    dateOfBirth?: string; // ISO 8601
    expirationDate?: string; // ISO 8601
    nationality?: string;
  };
  /** Confianza media 0..1 reportada por el OCR. */
  confidence: number;
}

/**
 * Datos estructurados ricos extraídos del documento (cédula PY) — FUENTE
 * AUTORITATIVA: el OCR de los campos impresos del frente/dorso anclados por
 * etiqueta (Opción 1). El MRZ es best-effort y NO decide el resultado.
 *
 * Todos los campos son opcionales/derivables: ante dato faltante quedan vacíos
 * (fail-closed; nunca se inventan valores).
 */
export interface ExtractedDocument {
  documento: {
    pais: string;
    tipo: string;
    numeroCedula: string;
    specimen: boolean;
  };
  titular: {
    apellidos: string;
    nombres: string;
    fechaNacimiento: string; // ISO 8601 (YYYY-MM-DD)
    sexo: string;
    lugarNacimiento: { ciudad: string; departamento: string };
    nacionalidad: string;
    estadoCivil: string;
    donante: boolean;
    firma: string;
  };
  documentoFisico: {
    fechaEmision: string; // ISO 8601
    fechaVencimiento: string; // ISO 8601
    chip: boolean;
    codigoBarras: boolean;
  };
  registroInterno: {
    ic: string;
    ubicacion: string;
  };
  autoridadEmisora: {
    nombre: string;
    cargo: string;
    dependencia: string;
  };
  mrz: {
    linea1: string;
    linea2: string;
    linea3: string;
    paisCodigo: string;
  };
  /**
   * PROCEDENCIA por campo (additivo, opcional). Marca de qué fuente se obtuvo un
   * campo cuando NO vino del frente impreso: típicamente `"mrz"` cuando el cross-fill
   * rellenó un campo vacío del frente desde el MRZ del dorso (CI coincidente). Los
   * campos leídos del frente NO se listan (la ausencia de entrada ⇒ origen frente).
   * Sólo informativo/auditoría; no altera ninguna decisión de `passed`/`consistent`.
   */
  fieldSources?: Record<string, "mrz">;
}

/** Recorte de la foto del titular extraída del documento (para el match 1:1). */
export interface DocFaceCrop {
  /** Imagen del recorte (base64 JPEG) — evidencia/match. */
  base64Jpeg: string;
  /** bbox del recorte sobre la imagen del documento [x1,y1,x2,y2]. */
  bbox: [number, number, number, number];
}

/** Un cruce de autenticidad individual (MRZ↔OCR, dígitos, vencimiento) — §6.c. */
export interface AuthenticityCheck {
  /** Identificador del cruce (p.ej. "mrz_vs_ocr_name", "check_digits", "not_expired", "doc_number_match"). */
  name: string;
  passed: boolean;
  detail?: string;
}

/** Resultado del cruce de autenticidad documental — §6.c/§13. */
export interface Authenticity {
  /** true si todos los cruces relevantes son consistentes. */
  consistent: boolean;
  checks: AuthenticityCheck[];
}

/**
 * `document(front, back)` → MRZ TD1 + barcode 1D + OCR → datos; recorta foto;
 * autenticidad por cruce. Rechazo duro si inconsistente/vencido (§9).
 */
export interface DocumentResult {
  documentType: DocumentType;
  mrz: MrzData;
  barcode: BarcodeData;
  ocr: OcrData;
  /** Recorte de la foto del titular (null si no se pudo extraer). */
  docFaceCrop: DocFaceCrop | null;
  /**
   * JSON estructurado rico extraído del documento (FUENTE AUTORITATIVA: OCR de
   * campos impresos del frente/dorso). Independiente del MRZ.
   */
  extracted: ExtractedDocument;
  authenticity: Authenticity;
  passed: boolean;
}

/**
 * `match(selfieEmb, docFaceEmb)` → coseno selfie↔foto-doc.
 * Umbral propio 1:1 (≠ 1:N), calibrable (§7/§13). Rechazo duro si no pasa.
 */
export interface MatchResult {
  /** Similitud coseno -1..1 (embeddings L2-normalizados → producto punto). */
  cosine: number;
  /** Umbral 1:1 aplicado para esta decisión (auditable). */
  threshold: number;
  passed: boolean;
}

/**
 * `decision(checks, tenantPolicy)` → veredicto + LoA + motivos (§6).
 * Combina las 4 señales. Fail-closed: ante cualquier duda, NO "verified".
 */
export interface Decision {
  verdict: DecisionVerdict;
  /** LoA acreditado. "L0" cuando el veredicto no es verified. */
  loa: LoA;
  /** Motivos legibles que sustentan el veredicto (auditable). */
  reasons: string[];
}

/** Bundle de señales que consume `decision()` (parcial: liveness puede no correr en L1). */
export interface PipelineChecks {
  quality: QualityResult;
  document: DocumentResult;
  match?: MatchResult;
  liveness?: LivenessResult;
}

// ============================================================================ //
// 3. MODELO DE DATOS (§5) — PostgreSQL propio, multi-tenant
// ============================================================================ //

/**
 * Política por tenant (tenants.policies JSONB). Es el input de `decision()`.
 * Tipada explícitamente — nunca `any`.
 */
export interface TenantPolicy {
  /** LoA mínimo requerido para considerar la verificación exitosa. */
  assuranceRequired: LoA;
  /** Retención de evidencia/biometría en días (0 = borrar inmediatamente tras decisión). */
  retentionDays: number;
  /** Desafíos de liveness activos exigidos (vacío = solo PAD pasivo). */
  livenessChallenges: LivenessChallenge[];
  /** Texto + versión del consentimiento mostrado al titular (Ley 7593/2025). */
  consentText: string;
  consentVersion: string;
  /** Máximo de reintentos de recaptura antes de rejected (default 3, §9). */
  maxRecaptureAttempts: number;
  /** TTL del link_token en segundos. */
  linkTokenTtlSeconds: number;
  /** Umbrales calibrables (sobreescriben defaults globales). */
  thresholds?: {
    matchCosine?: number;
    livenessScore?: number;
    qualityGlassesPct?: number;
  };
}

/** tenants — organizaciones consumidoras (§5). */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  policies: TenantPolicy;
  /** Secreto HMAC por tenant para firmar los webhooks (§8). Nunca se expone al titular. */
  webhookSecret: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

/**
 * api_keys — auth por tenant (§5). El secreto NUNCA se persiste en plano:
 * solo `keyHash`. El plano se devuelve UNA sola vez al crearla.
 */
export interface ApiKey {
  id: string;
  tenantId: string;
  /** Hash del secreto (p.ej. sha256). Nunca el secreto plano. */
  keyHash: string;
  /** Prefijo público mostrable para identificar la key sin revelarla. */
  prefix: string;
  label: string;
  scopes: string[];
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Resultado consolidado de la sesión (verification_sessions.result JSONB) — §5/§6. */
export interface SessionResult {
  decision: DecisionVerdict;
  loa: LoA;
  reasons: string[];
  /** Datos extraídos del documento (subconjunto seguro para el tenant). */
  extracted?: {
    ci: string;
    nombre: string;
    fechaNac: string; // ISO 8601
    nacionalidad: string;
    tipoDoc: DocumentType;
  };
  /** Scores resumidos por módulo (auditables, sin biometría cruda). */
  scores?: {
    quality?: number;
    liveness?: number;
    match?: number;
  };
}

/** verification_sessions — una verificación = una sesión (§5/§6). */
export interface VerificationSession {
  id: string;
  tenantId: string;
  /** Referencia externa del tenant (idempotencia de creación, §9). */
  externalRef: string | null;
  state: SessionState;
  /** Token de un solo uso, expirable e inadivinable para la captura (§8). */
  linkToken: string;
  /** Momento de consumo del token de un solo uso (null = aún no usado). §8 seguridad. */
  usedAt?: Date | null;
  callbackUrl: string | null;
  /** LoA requerido para esta sesión (snapshot de la policy al crearla). */
  assuranceRequired: LoA;
  redirectUrl: string | null;
  locale: string;
  /** Contador de recapturas (adición de arquitecto: §5 no lo lista; §9 lo exige). */
  recaptureCount: number;
  expiresAt: string; // ISO 8601
  completedAt: string | null;
  result: SessionResult | null;
  createdAt: string;
  updatedAt: string;
}

/** Detalle granular por tipo de check (verification_checks.detail JSONB). */
export type CheckDetail =
  | QualityResult
  | LivenessResult
  | DocumentResult
  | MatchResult;

/** verification_checks — resultado granular por módulo, auditable (§5). */
export interface VerificationCheck {
  id: string;
  sessionId: string;
  tenantId: string;
  type: CheckType;
  score: number | null;
  passed: boolean;
  detail: CheckDetail;
  createdAt: string;
}

/**
 * verified_identities — identidad verificada resultante (§5).
 * El embedding facial tiene DOS representaciones según el límite de serialización:
 *   - en memoria/engine: Float32Array (512D, L2-normalizado).
 *   - persistido en PG: bytea (Buffer).
 */
export interface VerifiedIdentity {
  id: string;
  tenantId: string;
  sessionId: string;
  ci: string;
  nombre: string;
  fechaNac: string; // ISO 8601
  nacionalidad: string;
  tipoDoc: DocumentType;
  assuranceLevel: LoA;
  /** Embedding facial 512D persistido como bytea (Buffer en Node). */
  faceEmbedding: Buffer;
  createdAt: string;
}

/** Variante en memoria de la identidad (antes de serializar a bytea). */
export interface VerifiedIdentityInput
  extends Omit<VerifiedIdentity, "id" | "faceEmbedding" | "createdAt"> {
  /** Embedding tal como lo emite el engine. */
  faceEmbedding: Float32Array;
}

/** evidence — imágenes en disco/CIFS + hash de integridad (§5). */
export interface Evidence {
  id: string;
  sessionId: string;
  tenantId: string;
  type: EvidenceType;
  storagePath: string;
  /** sha256 hex del archivo, para integridad/cadena de custodia. */
  sha256: string;
  createdAt: string;
}

/** audit_log — traza para cumplimiento (§5/§12). */
export interface AuditEntry {
  id: string;
  tenantId: string;
  sessionId: string | null;
  /** Quién: "tenant:<apiKeyId>", "subject", "admin:<operatorId>", "system". */
  actor: string;
  /** Qué: "session.created", "consent.accepted", "pipeline.completed", etc. */
  event: string;
  detail: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

/** consents — consentimiento explícito del titular (dato biométrico, §12). */
export interface Consent {
  id: string;
  sessionId: string;
  tenantId: string;
  text: string;
  version: string;
  acceptedAt: string; // ISO 8601
  ip: string | null;
}

// ============================================================================ //
// 4. DTOs DE LAS APIs (§8)
// ============================================================================ //

// ---- 4.A) API del tenant (Bearer API key) -------------------------------- //
// El tenant se deriva de la API key → los REQUEST del tenant NO llevan tenantId.

/** POST /v1/sessions — crear verificación. */
export interface CreateSessionRequest {
  externalRef?: string;
  callbackUrl?: string;
  /** LoA requerido; si se omite usa el de la policy del tenant. */
  assuranceRequired?: LoA;
  redirectUrl?: string;
  locale?: string;
  /**
   * Email opcional del solicitante. Si viene (y hay SMTP configurado), tras crear
   * la sesión se le envía el verifyUrl por email nativo (transaccional, fail-open).
   */
  email?: string;
}

export interface CreateSessionResponse {
  sessionId: string;
  verificationUrl: string;
  expiresAt: string; // ISO 8601
}

/** GET /v1/sessions/:id — estado + resultado. */
export interface SessionStatusResponse {
  sessionId: string;
  externalRef: string | null;
  state: SessionState;
  assuranceRequired: LoA;
  result: SessionResult | null;
  /** Evidencia disponible (metadatos; las imágenes se sirven aparte). */
  evidence: Array<Pick<Evidence, "type" | "storagePath" | "sha256">>;
  createdAt: string;
  completedAt: string | null;
}

/** GET /v1/sessions — listado con filtros. */
export interface ListSessionsQuery {
  state?: SessionState;
  externalRef?: string;
  from?: string; // ISO 8601
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ListSessionsResponse {
  total: number;
  limit: number;
  offset: number;
  sessions: SessionStatusResponse[];
}

/** DELETE /v1/sessions/:id — derecho a supresión (§8/§12). */
export interface DeleteSessionResponse {
  sessionId: string;
  deleted: boolean;
  /** Qué se borró (evidencia, identidad, embedding). */
  purged: EvidenceType[] | string[];
}

// ---- 4.B) Captura del usuario (auth por link_token) ----------------------- //

/** POST /verify/:token/consent. */
export interface ConsentRequest {
  accepted: true;
  /** Versión del texto de consentimiento que el titular aceptó. */
  consentVersion: string;
}

export interface ConsentResponse {
  ok: boolean;
  state: SessionState;
}

/** POST /verify/:token/selfie — selfie + frames cortos para liveness. */
export interface SelfieUploadRequest {
  /** Selfie principal (base64 JPEG/PNG o data URL). */
  image: string;
  /** Frames cortos opcionales para PAD/desafío activo. */
  frames?: string[];
}

/** POST /verify/:token/document — cédula frente + dorso. */
export interface DocumentUploadRequest {
  /** Frente (base64). */
  front: string;
  /** Dorso (base64) — MRZ TD1 + barcode 1D. */
  back: string;
}

/** Respuesta común de uploads. */
export interface UploadResponse {
  ok: boolean;
  state: SessionState;
  /**
   * Pre-check informativo de calidad de la selfie (§6.a). SOLO lo devuelve
   * /selfie; es opcional porque /document comparte este tipo y no corre quality.
   * La autoridad sigue siendo el pipeline en /submit: esto NO cambia el estado.
   */
  quality?: { passed: boolean; reasons: string[] };
}

/**
 * POST /verify/:token/doc-check — pre-check INFORMATIVO de la cédula al capturar
 * cada lado (frente/dorso). NO persiste, NO cambia estado, NO consume el token: el
 * pipeline en /submit sigue siendo la autoridad. Espejo del pre-check de la selfie.
 */
export interface DocCheckResponse {
  ok: boolean;
  /** false si la cédula no es usable (borrosa / sin rostro en frente / MRZ ilegible). */
  passed: boolean;
  /** Motivos legibles: "blurry", "no_doc_face", "mrz_unreadable", "doc_check_error". */
  reasons: string[];
}

/** POST /verify/:token/submit — dispara el pipeline. */
export interface SubmitResponse {
  ok: boolean;
  state: SessionState;
}

/**
 * Datos extraídos del documento que se muestran en la pantalla de REVISIÓN del
 * titular (POST /preview). Subconjunto seguro del `ExtractedDocument`.
 */
export interface PreviewExtracted {
  titular: ExtractedDocument["titular"];
  documento: ExtractedDocument["documento"];
  documentoFisico: ExtractedDocument["documentoFisico"];
  registroInterno: ExtractedDocument["registroInterno"];
  autoridadEmisora: ExtractedDocument["autoridadEmisora"];
  mrz: ExtractedDocument["mrz"];
}

/** Resumen del match 1:1 para la pantalla de revisión. */
export interface PreviewMatch {
  cosine: number;
  passed: boolean;
}

/** Pre-veredicto INFORMATIVO mostrado en revisión (la decisión real la fija /confirm). */
export interface PreviewDecision {
  loa: LoA;
  wouldPass: boolean;
}

/**
 * URLs (token-auth) o dataURLs de las fotos recortadas que se muestran en revisión.
 * Se sirven vía GET /verify/:token/evidence/:type (type ∈ selfie|doc_face|doc_front).
 */
export interface PreviewPhotos {
  selfieCrop: string;
  docFaceCrop: string;
  docFrontCrop: string;
}

/**
 * POST /verify/:token/preview — corre el pipeline (quality+liveness+document+match),
 * persiste los verification_checks y deja la sesión en 'review' (NO finaliza).
 */
export interface PreviewResponse {
  state: "review";
  extracted: PreviewExtracted;
  match: PreviewMatch;
  decisionPreview: PreviewDecision;
  photos: PreviewPhotos;
}

/**
 * POST /verify/:token/confirm — finaliza DESDE 'review' con los checks ya computados:
 * decide (verified|rejected según LoA), crea verified_identity si verified, dispara
 * webhook, estado terminal. Fail-closed.
 */
export interface ConfirmResponse {
  state: SessionState;
  result: SessionResult | null;
  reasons: string[];
  /** URL de retorno al app del tenant (si la sesión la define) — el front la usa
   *  para auto-redirigir tras un resultado terminal sin esperar polling (#8). */
  redirectUrl?: string | null;
}

/** Tipo de evidencia RECORTADA servible en revisión (GET /verify/:token/evidence/:type). */
export type EvidenceCropType = "selfie" | "doc_face" | "doc_front";

/** GET /verify/:token/status — estado para la SPA (SSE + fallback polling, §8/§11). */
export interface CaptureStatusResponse {
  state: SessionState;
  /** Motivos de recaptura (guía al usuario) cuando state=needs_recapture. */
  reasons?: string[];
  recaptureCount?: number;
  maxRecaptureAttempts?: number;
  /** URL de redirect final cuando se completa (verified/rejected). */
  redirectUrl?: string | null;
}

/** Evento SSE empujado al cliente de captura (patrón events.ts). */
export interface CaptureStatusEvent {
  type: "state";
  state: SessionState;
  reasons?: string[];
}

// ---- 4.C) API admin (/admin/*) — operador con auth/roles propios ---------- //

/** POST /v1/tenants  ·  POST /admin/tenants — alta de tenant. */
export interface CreateTenantRequest {
  name: string;
  slug: string;
  policies?: Partial<TenantPolicy>;
}

export interface TenantResponse {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  policies: TenantPolicy;
  createdAt: string;
}

/** PATCH /admin/tenants/:id — actualizar políticas/estado. */
export interface UpdateTenantRequest {
  name?: string;
  status?: TenantStatus;
  policies?: Partial<TenantPolicy>;
}

/** POST /v1/tenants/:id/api-keys · POST /admin/tenants/:id/api-keys. */
export interface CreateApiKeyRequest {
  label: string;
  scopes?: string[];
}

/** Respuesta de creación de API key: el secreto plano se devuelve UNA sola vez. */
export interface CreateApiKeyResponse {
  id: string;
  prefix: string;
  /** Secreto en plano — visible SOLO en esta respuesta; luego solo el hash persiste. */
  apiKey: string;
  label: string;
  scopes: string[];
  createdAt: string;
}

/** Metadatos de una API key (listados; nunca el secreto). */
export interface ApiKeyResponse {
  id: string;
  prefix: string;
  label: string;
  scopes: string[];
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Login de operador del dashboard admin. */
export interface AdminLoginRequest {
  email: string;
  password: string;
}

export interface AdminLoginResponse {
  token: string;
  operator: {
    id: string;
    email: string;
    role: AdminRole;
  };
  expiresAt: string;
}

/** Revisión de una sesión desde el admin (incluye checks granulares). */
export interface AdminSessionDetailResponse extends SessionStatusResponse {
  tenantId: string;
  checks: Array<Pick<VerificationCheck, "type" | "score" | "passed" | "detail">>;
  consents: Array<Pick<Consent, "version" | "acceptedAt" | "ip">>;
}

/** Métricas del dashboard admin (§8.C/§11). */
export interface AdminMetricsResponse {
  tenantId?: string;
  sessionsTotal: number;
  approvalRate: number;
  byState: Record<SessionState, number>;
  /** Latencia media por módulo en ms. */
  latencyByModule: Partial<Record<CheckType, number>>;
}

// ---- 4.D) Webhook firmado (HMAC) al tenant (§8) --------------------------- //

export type WebhookEventType = "session.verified" | "session.rejected";

/** Cuerpo del webhook POST callback_url (firmado HMAC en header). */
export interface WebhookPayload {
  event: WebhookEventType;
  sessionId: string;
  externalRef: string | null;
  state: SessionState;
  result: SessionResult;
  /** Marca de tiempo de emisión (parte del payload firmado, anti-replay). */
  timestamp: string; // ISO 8601
}

/** Resultado de un intento de entrega de webhook (reintentos + dead-letter, §9). */
export interface WebhookDelivery {
  id: string;
  tenantId: string;
  sessionId: string;
  event: WebhookEventType;
  url: string;
  attempts: number;
  lastStatus: number | null;
  delivered: boolean;
  deadLettered: boolean;
  nextAttemptAt: string | null;
  createdAt: string;
}

// ============================================================================ //
// 5. RE-EXPORTS DE CONVENIENCIA
// ============================================================================ //

/** Re-export del tipo Face del engine para que los módulos lo usen sin acoplar runtime. */
export type { Face };
