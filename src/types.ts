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
  | "in_review" // cola de revisión HUMANA (workflow review:always|on_borderline); no terminal
  | "verified"
  | "rejected"
  | "needs_recapture"
  | "expired"
  | "error";

/** Veredicto que produce `decision()` — subconjunto de SessionState (§6). */
export type DecisionVerdict = "verified" | "rejected" | "needs_recapture";

/** Tipo de check granular auditable — §5 (verification_checks.tipo). */
export type CheckType =
  | "quality"
  | "liveness"
  | "document"
  | "match"
  | "aml"
  | "face_search"
  /**
   * Comprobante de domicilio (proof of address — P1 #4). Check CONFIGURABLE: el
   * titular sube una factura de servicio / extracto bancario; el OCR extrae titular
   * + domicilio + fecha y se valida que el nombre coincida con la identidad
   * verificada, que el documento sea reciente y que haya domicilio. Señal/score (NO
   * rechazo duro): el ruteo a revisión humana lo decide el workflow.
   */
  | "proof_of_address";

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
  | "doc_back_raw"
  /**
   * Video completo de la sesión de LIVENESS ACTIVO (webm/mp4 grabado con
   * MediaRecorder en el navegador). Es la evidencia de que la persona ejecutó los
   * desafíos guiados (girar la cabeza, parpadear, sonreír) frente a la cámara. NO
   * pasa por sharp (no es imagen): se guarda crudo vía evidenceStore.saveVideo y se
   * sirve con su content-type real. Cierra el print-attack que el PAD pasivo no cubre.
   */
  | "liveness_video"
  /**
   * Comprobante de domicilio subido por el titular (P1 #4): factura de servicio,
   * extracto bancario, etc. Imagen o PDF (el PDF se rasteriza a imagen ANTES de
   * persistir, igual que el documento). Se OCR-ea para extraer titular/domicilio/
   * fecha en el check `proof_of_address`.
   */
  | "proof_of_address";

/** Estado de un tenant. */
export type TenantStatus = "active" | "suspended" | "disabled";

/** Estado de una API key. */
export type ApiKeyStatus = "active" | "revoked";

/**
 * Tipo de documento soportado (multi-documento / multi-país — P1 #3). Unión
 * EXTENSIBLE: hoy
 *   - "ci_py"    = cédula de identidad paraguaya (frente impreso + dorso MRZ TD1).
 *                  Camino más completo y DEFAULT (no rompe nada existente).
 *   - "passport" = pasaporte ICAO (página de datos con MRZ TD3 2×44). Un solo lado,
 *                  parser MRZ estandarizado → sirve para CUALQUIER país emisor.
 * Para sumar más tipos (dni_ar, cedula_xx, ...) basta agregar el literal acá, un
 * `DocumentExtractor` en modules/document.ts y, si aplica, el ruteo de UI. El resto
 * del pipeline razona contra esta unión.
 */
export type DocumentType = "ci_py" | "passport";

/** Literales válidos de DocumentType (whitelist runtime para validar input del API). */
export const DOCUMENT_TYPES: readonly DocumentType[] = ["ci_py", "passport"] as const;

/** Type-guard runtime: ¿`x` es un DocumentType soportado? (fail-closed en el API). */
export function isDocumentType(x: unknown): x is DocumentType {
  return typeof x === "string" && (DOCUMENT_TYPES as readonly string[]).includes(x);
}

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
  /**
   * LIVENESS ACTIVO interactivo ejecutado en el navegador (desafíos guiados:
   * girar cabeza / parpadear / sonreír, detectados por blendshapes + matriz de
   * transformación de MediaPipe FaceLandmarker). Es la señal anti-spoof FUERTE:
   * un print/replay estático NO puede completar la secuencia. El video grabado
   * (`liveness_video`) es la evidencia auditable. Se COMBINA con el PAD pasivo:
   * la liveness sólo pasa si el PAD pasa Y, cuando este bloque está presente, los
   * desafíos se completaron (`passed=true`). Fail-closed: presente-pero-no-completado
   * fuerza liveness.passed=false. Ausente ⇒ se cae al gating PAD (+ challenge por
   * frames) actual sin debilitarlo.
   */
  activeLiveness?: {
    /** Desafíos efectivamente solicitados al titular (orden de presentación). */
    challenges: string[];
    /** ¿El cliente reportó la secuencia COMPLETA como superada? */
    passed: boolean;
  };
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
  /**
   * Screening AML/PEP/sanciones (P1 #1). NO lo consume `decision()` (no es rechazo
   * duro): es señal/score. El ruteo a revisión humana lo decide el workflow vía
   * `aml.onMatch`. Sólo corre cuando el workflow tiene `aml.required`.
   */
  aml?: AmlResult;
  /**
   * Búsqueda facial 1:N contra la galería de identidades verificadas (P1 #2). NO
   * la consume `decision()` (no es rechazo duro): es señal/score. El ruteo a
   * revisión humana ante un duplicado (cara conocida con CI distinto) lo decide el
   * workflow vía `faceSearch.onDuplicate`. Sólo corre con `faceSearch.required`.
   */
  faceSearch?: FaceSearchResult;
  /**
   * Comprobante de domicilio (P1 #4). NO lo consume `decision()` (no es rechazo
   * duro): es señal/score. El ruteo a revisión humana ante un comprobante dudoso
   * (nombre que no coincide / no reciente / sin domicilio) lo decide el workflow vía
   * `proofOfAddress.onFail`. Sólo corre con `proofOfAddress.required`.
   */
  proofOfAddress?: ProofOfAddressResult;
}

// ============================================================================ //
// 2.ter MÓDULO FACE SEARCH — dedup/anti-fraude 1:N + KYC reusable (P1 #2)
// ============================================================================ //

/** Un match 1:N: una identidad de la galería que se parece a la cara consultada. */
export interface FaceSearchMatch {
  /** id de la verified_identity encontrada. */
  identityId: string;
  /** Sesión que generó esa identidad (para link + miniatura en el admin). */
  sessionId: string;
  ci: string;
  name: string;
  /** Similitud coseno 0..1 (embeddings L2-normalizados → producto punto). */
  cosine: number;
  /**
   * true si el CI de esta identidad es DISTINTO al de la sesión consultada → señal
   * fuerte de duplicado/fraude (misma cara con otra identidad). false = mismo CI
   * (usuario recurrente / KYC reusable).
   */
  ciMismatch: boolean;
}

/**
 * Resultado de la búsqueda facial 1:N (P1 #2) — se persiste como check `face_search`.
 * Señal/score, NUNCA rechazo duro (fail-closed lo maneja el pipeline). Dos señales:
 *   - `duplicateSuspected`: hay match(es) sobre umbral con CI DISTINTO → posible
 *     misma persona con otra identidad → según workflow rutea a in_review.
 *   - `returningUser`: hay match con el MISMO CI → usuario recurrente; expone la
 *     verificación previa (no fuerza re-KYC).
 */
export interface FaceSearchResult {
  /** Matches sobre el umbral, ordenados por cosine desc (top primero). */
  matches: FaceSearchMatch[];
  /** Coseno del mejor match (0 si no hay matches). */
  topCosine: number;
  /** Umbral 1:N aplicado (auditable). */
  threshold: number;
  /** Tamaño de la galería comparada (identidades del tenant, excluida la sesión). */
  gallerySize: number;
  /** Hay ≥1 match con CI distinto → posible duplicado/fraude (señal a revisar). */
  duplicateSuspected: boolean;
  /** Hay ≥1 match con el mismo CI → usuario recurrente (KYC reusable). */
  returningUser: boolean;
  /** CI consultado (de la sesión actual), para auditoría del cruce. */
  queryCi: string;
  /**
   * true (clear) si NO hay sospecha de duplicado — informativo para la columna
   * `passed` del check. NO afecta decision() (no es rechazo duro). returningUser
   * con mismo CI sigue siendo `passed=true` (no es un problema).
   */
  passed: boolean;
  /** Si la búsqueda no pudo correr (fail-closed → duplicateSuspected=true). */
  error?: string;
}

// ============================================================================ //
// 2.bis MÓDULO AML — screening de sanciones/PEP por matching LOCAL (P1 #1)
// ============================================================================ //

/** Identidad mínima que se cruza contra las listas (extraída del documento). */
export interface AmlInput {
  nombres: string;
  apellidos: string;
  /** ISO 8601 (YYYY-MM-DD) o vacío si no se pudo extraer. */
  fechaNac?: string;
  nacionalidad?: string;
}

/**
 * Entidad del dataset LOCAL de sanciones/PEP (fila de `aml_entities`). Fuente
 * swappable (OpenSanctions u otra) — ver `AmlProvider`.
 */
export interface AmlEntity {
  entityId: string;
  /** Nombre canónico de la entidad. */
  name: string;
  /** Nombres alternativos/alias (crudos). */
  aliases: string[];
  /** Etiquetas de lista legibles: OFAC, UN, EU, UK, PEP, ... */
  lists: string[];
  /** Topics de la fuente: sanction, role.pep, crime, ... */
  topics: string[];
  /** Países asociados (ISO alpha-2 o nombre). */
  countries: string[];
  /** Fecha/año de nacimiento (puede ser parcial: "1965" o "1965-04-12"). */
  birthDate: string | null;
  schema?: string | null;
}

/** Un cruce individual contra una entidad de la lista. */
export interface AmlHit {
  entityId: string;
  name: string;
  /** Listas a las que pertenece (OFAC/UN/EU/PEP...). */
  lists: string[];
  /** Similitud 0..1 (fuzzy de nombre + boosts por dob/nacionalidad). */
  score: number;
  /** Qué campos contribuyeron al match: 'name' | 'alias' | 'dob' | 'nationality'. */
  matchedFields: string[];
  topics?: string[];
  countries?: string[];
}

/** Decisión del screening (NO auto-rechaza; es señal). */
export type AmlDecision = "clear" | "potential_match";

/** Resultado del módulo AML — se persiste como check `aml` (detail JSONB). */
export interface AmlResult {
  /** Consulta normalizada (auditable; es PII → se queda on-prem en la propia DB). */
  query: {
    nombres: string;
    apellidos: string;
    fechaNac?: string;
    nacionalidad?: string;
    /** Nombre completo normalizado usado para el match. */
    normalized: string;
  };
  /** Hits ordenados por score desc (top primero). */
  hits: AmlHit[];
  /** Score del mejor hit (0 si no hay hits). */
  topScore: number;
  decision: AmlDecision;
  /** Umbral aplicado (auditable). */
  threshold: number;
  /** Proveedor que resolvió el screening (p.ej. "local-opensanctions"). */
  provider: string;
  /** Versión del dataset cargado (informativo). */
  datasetVersion?: string | null;
  /** true = clear (informativo para la columna `passed` del check; NO afecta decision()). */
  passed: boolean;
  /** Si el screening no pudo correr (fail-closed → decision potential_match). */
  error?: string;
}

// ============================================================================ //
// 2.quater MÓDULO PROOF OF ADDRESS — comprobante de domicilio (P1 #4)
// ============================================================================ //

/**
 * Resultado del módulo `proofOfAddress` — se persiste como check `proof_of_address`
 * (detail JSONB). El titular sube una factura de servicio / extracto bancario (imagen
 * o PDF); el OCR extrae el TITULAR, las LÍNEAS DE DOMICILIO, la FECHA del documento y
 * el EMISOR (best-effort). Validaciones heurísticas (los comprobantes son de formato
 * libre): `nameMatch` (fuzzy contra el nombre de la identidad/documento — reusa la
 * similitud de aml.ts), `recent` (fecha dentro de `maxAgeMonths`) y `hasAddress`.
 *
 * NO es rechazo duro: es señal/score (igual que aml/face_search). `decision()` no lo
 * consume; el ruteo a revisión humana lo decide el workflow vía `proofOfAddress.onFail`.
 * FAIL-CLOSED: si el OCR no corre o lanza, `passed=false` + `error` (un comprobante
 * ilegible NUNCA pasa en silencio).
 */
export interface ProofOfAddressResult {
  /** Nombre del titular extraído del comprobante ("" si no se pudo). */
  holderName: string;
  /** Líneas de texto OCR clasificadas como domicilio (calle/número/ciudad/CP). */
  addressLines: string[];
  /** Domicilio consolidado (addressLines unidas) — vacío si no se detectó. */
  address: string;
  /** Fecha del documento en ISO YYYY-MM-DD (la más reciente plausible) o "". */
  documentDate: string;
  /** Emisor detectado (ANDE/ESSAP/banco/…) o "". Best-effort. */
  issuer: string;
  /** Nombre verificado contra el que se cruzó (identidad/documento), normalizado. */
  identityName: string;
  /** Similitud 0..1 del nombre del comprobante vs la identidad (Jaro-Winkler). */
  nameSimilarity: number;
  /** ¿El nombre coincide con la identidad verificada (≥ umbral)? */
  nameMatch: boolean;
  /** ¿La fecha del documento cae dentro de `maxAgeMonths`? */
  recent: boolean;
  /** Antigüedad máxima admitida (meses) aplicada para `recent` (auditable). */
  maxAgeMonths: number;
  /** ¿Se detectó un domicilio? */
  hasAddress: boolean;
  /** Veredicto del check: nameMatch (si se exige) + recent + hasAddress. */
  passed: boolean;
  /** Confianza media del OCR (0..1) — informativo. */
  ocrConfidence?: number;
  /** Si el OCR no pudo correr / lanzó (fail-closed → passed=false). */
  error?: string;
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

// ---- White-label / branding por tenant (P1 #5) --------------------------- //

/**
 * Branding por tenant (tenants.branding JSONB). TODOS los campos OPCIONALES: lo que
 * el tenant no define cae al branding Teko por defecto (verde #16a34a). Un tenant sin
 * branding propio se ve idéntico a hoy. Ver lib/branding.ts (resolve/sanitize).
 */
export interface TenantBranding {
  /** Nombre mostrado en el header del flujo de captura (reemplaza "TEKO"). */
  displayName?: string;
  /** Logo: URL http(s) o ruta on-prem (/branding/:tenantId/logo). null/ausente = wordmark Teko. */
  logoUrl?: string;
  /** Color primario theme-able en hex #RRGGBB (reemplaza el verde Teko). */
  primaryColor?: string;
  /** Texto de bienvenida opcional en la intro. */
  welcomeText?: string;
  /** Email de soporte opcional (footer). */
  supportEmail?: string;
}

/** Branding YA resuelto (default Teko aplicado) — lo que consume el front. */
export interface ResolvedBranding {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  welcomeText: string | null;
  supportEmail: string | null;
}

/** apps — agrupador OPCIONAL debajo del tenant (P1 #5 App layer liviana). */
export interface App {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  createdAt: string; // ISO 8601
}

// ---- Workflows (configurables + versionados) — P0 #1 --------------------- //

/**
 * Modo de revisión HUMANA tras computar los checks (cola de revisión, Didit-like):
 *   - "auto"          → el sistema auto-decide (verified|rejected). Comportamiento actual.
 *   - "always"        → SIEMPRE pasa por `in_review` (un operador resuelve).
 *   - "on_borderline" → pasa por `in_review` sólo si algún score cae en la banda dudosa.
 */
export type ReviewMode = "auto" | "always" | "on_borderline";

/**
 * Definición de un workflow (JSONB versionado): QUÉ checks corren, con qué umbrales,
 * y la política de revisión. Reemplaza el L1/L2/L3 hardcode. Compatibilidad: los
 * workflows "default" (default-l1/-l2/-l3) mapean exacto a la escalera actual.
 *
 * El LoA EQUIVALENTE se DERIVA de la def (liveness.required→L3, match.required→L2,
 * document.required→L1) para que `decision()`/`needsMatch`/`needsLiveness` sigan
 * funcionando sin cambios sobre el `assuranceRequired` resultante.
 */
export interface WorkflowDefinition {
  document?: { required: boolean };
  liveness?: { required: boolean; mode?: "active" | "passive"; threshold?: number };
  match?: { required: boolean; threshold?: number };
  quality?: { glassesMaxPct?: number };
  /**
   * Screening AML/PEP/sanciones (P1 #1). `required` = el check corre. `threshold`
   * = umbral de similitud para potential_match. `onMatch` = qué hacer ante un
   * potential_match: 'review' rutea a la cola de revisión humana; 'flag' sólo
   * persiste el hallazgo (sin frenar la auto-decisión). NO es rechazo duro.
   */
  aml?: { required: boolean; threshold?: number; onMatch?: "review" | "flag" };
  /**
   * Búsqueda facial 1:N contra la galería de identidades verificadas (P1 #2).
   * `required` = el check corre tras el match 1:1. `threshold` = coseno mínimo para
   * considerar a una identidad como la misma cara. `onDuplicate` = qué hacer ante un
   * duplicado (cara conocida con CI DISTINTO): 'review' rutea a la cola de revisión
   * humana; 'flag' sólo persiste el hallazgo. NO es rechazo duro.
   */
  faceSearch?: {
    required: boolean;
    threshold?: number;
    onDuplicate?: "review" | "flag";
  };
  /**
   * Comprobante de domicilio (proof of address — P1 #4). `required` = el titular debe
   * subir un comprobante y el check corre. `maxAgeMonths` = antigüedad máxima admitida
   * de la fecha del documento (default 3). `requireNameMatch` = exigir que el nombre del
   * comprobante coincida con la identidad verificada para que el check pase (default
   * true). `onFail` = qué hacer si el check NO pasa: 'review' rutea a la cola de revisión
   * humana; 'flag' (default) sólo persiste el hallazgo. NO es rechazo duro.
   */
  proofOfAddress?: {
    required: boolean;
    maxAgeMonths?: number;
    requireNameMatch?: boolean;
    nameThreshold?: number;
    onFail?: "review" | "flag";
  };
  review?: {
    mode: ReviewMode;
    /** Para on_borderline: bandas de score [min,max] que disparan revisión humana. */
    borderlineBand?: {
      matchMin?: number;
      matchMax?: number;
      livenessMin?: number;
      livenessMax?: number;
    };
  };
}

/** workflows — definición versionada por tenant (§ Workflow→Session). */
export interface Workflow {
  id: string;
  tenantId: string;
  name: string;
  version: number;
  definition: WorkflowDefinition;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** tenants — organizaciones consumidoras (§5). */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  policies: TenantPolicy;
  /** White-label por tenant (P1 #5). '{}' = branding Teko por defecto (verde). */
  branding: TenantBranding;
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
  /**
   * Tipo de documento elegido para esta sesión (multi-documento — P1 #3). Snapshot
   * persistido: lo fija el tenant al crear la sesión o el titular en la pantalla
   * "Elegir documento" (POST /document). El módulo `document` rutea la extracción
   * según este valor. Default "ci_py" (la columna es NOT NULL DEFAULT 'ci_py').
   */
  documentType: DocumentType;
  state: SessionState;
  /** Token de un solo uso, expirable e inadivinable para la captura (§8). */
  linkToken: string;
  /** Momento de consumo del token de un solo uso (null = aún no usado). §8 seguridad. */
  usedAt?: Date | null;
  callbackUrl: string | null;
  /** LoA requerido para esta sesión (snapshot de la policy al crearla). */
  assuranceRequired: LoA;
  /** Workflow usado (versión concreta). null en sesiones viejas o default-virtual. */
  workflowId?: string | null;
  workflowVersion?: number | null;
  /** Snapshot de la definición del workflow al crear la sesión (qué checks/umbrales/revisión). */
  workflowSnapshot?: WorkflowDefinition | null;
  /** Revisión humana (cola in_review): quién y cuándo decidió. */
  reviewedBy?: string | null;
  reviewedAt?: string | null;
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
  | MatchResult
  | AmlResult
  | FaceSearchResult
  | ProofOfAddressResult;

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

// ---- session_events — timeline forense + Device & IP analysis (P0 #3) ------ //

/** Tipo de dispositivo inferido del User-Agent. */
export type DeviceType = "mobile" | "tablet" | "desktop" | "bot" | "unknown";

/** Parseo liviano del User-Agent (os/browser/tipo + flag de sospecha). */
export interface ParsedDevice {
  os: string | null;
  browser: string | null;
  type: DeviceType;
  /** UA reconocido como headless/automatizado (señal de riesgo). */
  suspicious: boolean;
  raw: string | null;
}

/**
 * Taxonomía de eventos del ciclo de vida de una sesión que se persisten en el
 * timeline forense. Es un string abierto en DB (type text) para no forzar una
 * migración por cada evento nuevo; este union documenta los que emite hoy el flujo.
 */
export type SessionEventType =
  | "session.created"
  | "consent.accepted"
  | "document.front.captured"
  | "document.back.captured"
  | "selfie.captured"
  | "liveness.video_uploaded"
  | "liveness.completed"
  | "checks.computed"
  | "decision.made"
  | "review.decided";

/** Una fila del timeline forense: paso del flujo + contexto de red/dispositivo. */
export interface SessionEvent {
  id: string;
  sessionId: string;
  tenantId: string;
  type: string;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  device: ParsedDevice | Record<string, never>;
  meta: Record<string, unknown>;
  createdAt: string;
}

/** Severidad de una señal de riesgo de Device & IP. */
export type RiskSeverity = "info" | "low" | "medium" | "high";

/** Señal de riesgo detectada en el análisis Device & IP (informativa por defecto). */
export interface RiskSignal {
  code: string;
  severity: RiskSeverity;
  detail: string;
}

/**
 * Resultado del análisis Device & IP de una sesión: el IP/país/device más reciente
 * del flujo + las señales de riesgo derivadas de comparar los pasos entre sí (cambio
 * de IP/país, país≠nacionalidad del documento, UA headless). Informativo: NO bloquea
 * por sí solo (el workflow decide si pondera), pero queda registrado para el operador.
 */
export interface DeviceIpAnalysis {
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  device: ParsedDevice | null;
  /** IPs/países distintos vistos a lo largo del flujo (para el panel del admin). */
  ips: string[];
  countries: string[];
  signals: RiskSignal[];
  /** Score agregado 0..100 (suma ponderada de severidades). Mayor = más riesgo. */
  riskScore: number;
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
  /**
   * Tipo de documento esperado (multi-documento — P1 #3). Si se omite, default
   * "ci_py"; el titular igual puede fijarlo/cambiarlo en la pantalla "Elegir
   * documento" al subir el documento (POST /document).
   */
  documentType?: DocumentType;
  /**
   * Workflow a usar (id de una versión concreta). Si se omite, se snapshotea el
   * workflow default que corresponde al `assuranceRequired` (compatibilidad).
   */
  workflowId?: string;
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
  /** Selfie principal (base64 JPEG/PNG o data URL). En el flujo de liveness activo
   *  es el MEJOR frame seleccionado durante los momentos "de frente y centrado". */
  image: string;
  /** Frames cortos opcionales para PAD/desafío activo. */
  frames?: string[];
  /**
   * Resultado del LIVENESS ACTIVO interactivo ejecutado en el navegador (desafíos
   * guiados). El servidor lo persiste y lo combina con el PAD pasivo en el pipeline
   * (ver LivenessResult.activeLiveness). El video completo se sube aparte vía
   * POST /verify/:token/liveness-video (evidencia auditable).
   */
  activeLiveness?: {
    challenges: string[];
    passed: boolean;
  };
}

/** POST /verify/:token/document — documento frente + dorso. */
export interface DocumentUploadRequest {
  /** Frente / página de datos (base64). */
  front: string;
  /**
   * Dorso (base64) — MRZ TD1 + barcode 1D para la cédula PY. En PASAPORTE no hay
   * dorso (documento de un solo lado): el cliente reenvía la misma página de datos
   * aquí para no romper el flujo de subida/submit, y el extractor de pasaporte lo
   * ignora.
   */
  back: string;
  /**
   * Tipo de documento elegido por el titular en "Elegir documento" (multi-documento
   * — P1 #3). Si viene, se persiste en la sesión y el módulo `document` rutea por él.
   * Si se omite, se conserva el documentType ya snapshoteado en la sesión.
   */
  documentType?: DocumentType;
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
  /**
   * ¿El workflow de la sesión exige comprobante de domicilio (P1 #4)? Lo deriva del
   * `workflowSnapshot.proofOfAddress.required`. La SPA de captura usa este flag para
   * insertar (o no) el paso "Comprobante de domicilio" — adaptativo por workflow.
   */
  requiresProofOfAddress?: boolean;
  /**
   * Branding YA resuelto del tenant de la sesión (white-label P1 #5). SIEMPRE
   * presente (default Teko aplicado): el front theme-a el flujo con `primaryColor`,
   * muestra `logoUrl`/`displayName` en el header y `welcomeText` en la intro. Sin
   * branding propio ⇒ verde Teko + wordmark "TEKO" (idéntico a hoy).
   */
  branding?: ResolvedBranding;
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
  /** White-label opcional al crear (P1 #5). Se sanea; ausente = branding Teko. */
  branding?: TenantBranding;
}

export interface TenantResponse {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  policies: TenantPolicy;
  /** White-label por tenant (P1 #5) — crudo, para editar en "Customization". */
  branding: TenantBranding;
  createdAt: string;
}

/** PATCH /admin/tenants/:id — actualizar políticas/estado/branding. */
export interface UpdateTenantRequest {
  name?: string;
  status?: TenantStatus;
  policies?: Partial<TenantPolicy>;
  /** White-label (P1 #5): se mezcla sobre el branding actual y se sanea. */
  branding?: TenantBranding;
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

// ---- 4.C.bis) Workflows + cola de revisión manual (P0 #1) ----------------- //

/** Respuesta de un workflow (admin). */
export interface WorkflowResponse {
  id: string;
  tenantId: string;
  name: string;
  version: number;
  definition: WorkflowDefinition;
  isDefault: boolean;
  /** LoA equivalente derivado de la definición (informativo). */
  assuranceLevel: LoA;
  createdAt: string;
  updatedAt: string;
}

/** POST /admin/tenants/:id/workflows — crear workflow nuevo (version 1). */
export interface CreateWorkflowRequest {
  name: string;
  definition: WorkflowDefinition;
}

/** PUT /admin/tenants/:id/workflows/:name — editar = crear nueva versión. */
export interface UpdateWorkflowRequest {
  definition: WorkflowDefinition;
}

/** Ítem de la cola de revisión (GET /admin/review-queue). */
export interface ReviewQueueItem {
  sessionId: string;
  tenantId: string;
  tenantName: string;
  externalRef: string | null;
  assuranceRequired: LoA;
  /** Pre-veredicto sugerido por el motor (la suggestion guardada en result). */
  suggestion: SessionResult | null;
  createdAt: string;
}

export interface ReviewQueueResponse {
  total: number;
  items: ReviewQueueItem[];
}

/** POST /admin/sessions/:id/review — decisión del operador. */
export interface ReviewDecisionRequest {
  decision: "approve" | "decline";
  reason?: string;
}

export interface ReviewDecisionResponse {
  sessionId: string;
  state: SessionState;
  result: SessionResult | null;
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

// ---- 4.E) Subsistema de webhooks (suscripciones + entrega) — P0 #2 -------- //

/**
 * Eventos públicos del ciclo de vida de una sesión a los que un tenant puede
 * suscribir un destino. (Internamente el pipeline sigue usando WebhookEventType
 * verified/rejected; el dispatcher los traduce a esta taxonomía pública.)
 */
export type WebhookEvent =
  | "session.created"
  | "session.status_updated"
  | "session.approved"
  | "session.declined"
  | "session.in_review"
  | "session.data_updated";

/** Catálogo de eventos suscribibles (orden de presentación en el admin). */
export const WEBHOOK_EVENTS: WebhookEvent[] = [
  "session.created",
  "session.status_updated",
  "session.approved",
  "session.declined",
  "session.in_review",
  "session.data_updated",
];

/** Destino de webhook (suscripción) de un tenant. */
export interface WebhookEndpoint {
  id: string;
  tenantId: string;
  url: string;
  /** Secreto HMAC del destino. NUNCA se devuelve en listados (solo al crear). */
  secret: string;
  events: WebhookEvent[];
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Vista del destino para el admin (SIN el secreto). */
export interface WebhookEndpointResponse {
  id: string;
  url: string;
  events: WebhookEvent[];
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Respuesta de creación: incluye el secreto UNA sola vez. */
export interface CreateWebhookEndpointResponse extends WebhookEndpointResponse {
  secret: string;
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "dead";

/** Registro persistido de un intento de entrega (cola/reintentos). */
export interface WebhookDeliveryRecord {
  id: string;
  endpointId: string | null;
  tenantId: string;
  sessionId: string | null;
  eventId: string;
  eventType: WebhookEvent;
  url: string;
  payload: WebhookEventPayload;
  status: WebhookDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  responseCode: number | null;
  responseBody: string | null;
  error: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Cuerpo (canónico) del POST de webhook del subsistema P0 #2. `id` = event_id
 * (idempotencia, también en X-Event-Id). `data` espeja el estado de la sesión.
 */
export interface WebhookEventPayload {
  id: string;
  event: WebhookEvent;
  createdAt: string; // ISO 8601 de creación del evento
  data: {
    sessionId: string;
    tenantId: string;
    externalRef: string | null;
    state: SessionState;
    assuranceRequired: LoA;
    result: SessionResult | null;
  };
}

// ============================================================================ //
// 5. RE-EXPORTS DE CONVENIENCIA
// ============================================================================ //

/** Re-export del tipo Face del engine para que los módulos lo usen sin acoplar runtime. */
export type { Face };
