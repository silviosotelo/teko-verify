/**
 * Tipos del SDK de Teko Verify. Reflejan EXACTAMENTE los contratos de la API
 * (src/api/tenant.ts, src/webhooks/*, src/types.ts del server). No inventamos
 * campos: si el server no lo devuelve, no está acá.
 */

/** Nivel de aseguramiento (Level of Assurance). */
export type LoA = "L0" | "L1" | "L2" | "L3" | "L4";

/**
 * Estados de la sesión de verificación.
 *  - created           recién creada; el titular todavía no abrió el verifyUrl.
 *  - capturing         el titular está capturando documento/selfie en el flujo hosted.
 *  - processing        corriendo los checks (calidad, liveness, OCR, match, AML...).
 *  - review            evaluación interna previa a decisión.
 *  - in_review         en cola de REVISIÓN HUMANA (no terminal).
 *  - verified          aprobada (terminal, OK).
 *  - rejected          rechazada (terminal).
 *  - needs_recapture   hubo que recapturar (calidad/liveness insuficiente).
 *  - expired           el link expiró antes de completar.
 *  - error             error de sistema; nunca queda verified.
 */
export type SessionState =
  | "created"
  | "capturing"
  | "processing"
  | "review"
  | "in_review"
  | "verified"
  | "rejected"
  | "needs_recapture"
  | "expired"
  | "error";

/** Veredicto de la decisión. */
export type DecisionVerdict = "verified" | "rejected" | "needs_recapture";

/** Tipos de documento soportados (PY). */
export type DocumentType = "ci_py" | "passport" | "license_py" | string;

/** Resultado/decisión de una sesión (campo `result` de la sesión). */
export interface SessionResult {
  decision: DecisionVerdict;
  loa: LoA;
  reasons: string[];
  /** Datos extraídos del documento (subconjunto seguro). */
  extracted?: {
    ci: string;
    nombre: string;
    fechaNac: string;
    nacionalidad: string;
    tipoDoc: DocumentType;
  };
  /** Scores resumidos por módulo (auditables). */
  scores?: Record<string, number>;
}

/** Metadato de evidencia (las imágenes se sirven aparte, vía panel admin). */
export interface EvidenceMeta {
  type: string;
  storagePath: string;
  sha256: string;
}

/** Opciones para crear una verificación (POST /v1/sessions). */
export interface CreateSessionOptions {
  /** Referencia del lado del integrador. Da IDEMPOTENCIA: misma ref → misma sesión. */
  externalRef?: string;
  /** Si se envía, el server manda el verifyUrl por email al titular (fail-open). */
  email?: string;
  /** Workflow concreto a snapshotear. Si se omite, usa el default del LoA pedido. */
  workflowId?: string;
  /** App (proyecto) bajo la org. Si se omite: app de la API key → app Default. */
  appId?: string;
  /** Nivel de aseguramiento pedido (el efectivo lo deriva el workflow). */
  assuranceRequired?: LoA;
  /** Tipo de documento esperado. Si se omite, default 'ci_py'. */
  documentType?: DocumentType;
  /** URL a la que se notifican los eventos de ESTA sesión (firmada con secreto del tenant). */
  callbackUrl?: string;
  /** A dónde redirigir al titular al terminar el flujo hosted. */
  redirectUrl?: string;
  /** Locale de la UI hosted (p.ej. "es", "en"). */
  locale?: string;
}

/** Respuesta de POST /v1/sessions (201 nueva, 200 si idempotente existente). */
export interface CreateSessionResponse {
  sessionId: string;
  /** URL del flujo HOSTED: redirigí al titular acá. */
  verificationUrl: string;
  expiresAt: string;
}

/** Respuesta de GET /v1/sessions/:id (estado + resultado). */
export interface SessionStatusResponse {
  sessionId: string;
  externalRef: string | null;
  state: SessionState;
  assuranceRequired: LoA;
  result: SessionResult | null;
  evidence: EvidenceMeta[];
  createdAt: string;
  completedAt: string | null;
}

/** Respuesta de GET /v1/sessions (listado). */
export interface ListSessionsResponse {
  total: number;
  limit: number;
  offset: number;
  sessions: SessionStatusResponse[];
}

/** Filtros del listado de sesiones. */
export interface ListSessionsOptions {
  state?: SessionState;
  externalRef?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Respuesta de DELETE /v1/sessions/:id. */
export interface DeleteSessionResponse {
  sessionId: string;
  deleted: boolean;
  purged: string[];
}

/** Eventos de webhook que emite Teko Verify. */
export type WebhookEvent =
  | "session.created"
  | "session.status_updated"
  | "session.approved"
  | "session.declined"
  | "session.in_review"
  | "session.data_updated";

/** Payload (cuerpo JSON) de cada entrega de webhook. */
export interface WebhookEventPayload {
  /** Id del evento; igual al header X-Event-Id. Deduplicá por este valor. */
  id: string;
  event: WebhookEvent;
  createdAt: string;
  data: {
    sessionId: string;
    tenantId: string;
    externalRef: string | null;
    state: SessionState;
    assuranceRequired: LoA;
    result: SessionResult | null;
  };
}
