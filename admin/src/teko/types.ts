// Contratos del backend Teko admin (subconjunto consumido por el dashboard).
// Espejo de src/types.ts del backend Teko Verify.

export type AdminRole = 'owner' | 'operator' | 'viewer'

export type SessionState =
    | 'created'
    | 'capturing'
    | 'processing'
    | 'review'
    | 'in_review'
    | 'verified'
    | 'rejected'
    | 'needs_recapture'
    | 'expired'
    | 'error'

export type LoA = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
export type TenantStatus = 'active' | 'suspended' | 'disabled'
export type ApiKeyStatus = 'active' | 'revoked'
export type CheckType = 'quality' | 'liveness' | 'document' | 'match'
export type EvidenceType =
    | 'selfie'
    | 'doc_front'
    | 'doc_back'
    | 'frames'
    | 'doc_front_raw'
    | 'doc_back_raw'
    | 'liveness_video'

export interface Operator {
    id: string
    email: string
    role: AdminRole
}

export interface LoginResponse {
    token: string
    operator: Operator
    expiresAt: string
}

export interface TenantPolicy {
    assuranceRequired: LoA
    retentionDays: number
    livenessChallenges: string[]
    consentText: string
    consentVersion: string
    maxRecaptureAttempts: number
    linkTokenTtlSeconds: number
    thresholds?: {
        matchCosine?: number
        livenessScore?: number
        qualityGlassesPct?: number
    }
}

export interface Tenant {
    id: string
    name: string
    slug: string
    status: TenantStatus
    policies: TenantPolicy
    createdAt: string
}

export interface ApiKey {
    id: string
    prefix: string
    label: string
    scopes: string[]
    status: ApiKeyStatus
    lastUsedAt: string | null
    createdAt: string
}

export interface CreateApiKeyResponse {
    id: string
    prefix: string
    apiKey: string
    label: string
    scopes: string[]
    createdAt: string
}

export interface SessionResult {
    decision: 'verified' | 'rejected' | 'needs_recapture'
    loa: LoA
    reasons: string[]
    extracted?: {
        ci: string
        nombre: string
        fechaNac: string
        nacionalidad: string
        tipoDoc: string
    }
    scores?: { quality?: number; liveness?: number; match?: number }
}

// El listado (/sessions) devuelve la fila cruda de VerificationSession: el id
// viene como `id` (NO `sessionId`, que solo aparece en el detalle).
export interface SessionRow {
    id: string
    externalRef: string | null
    state: SessionState
    assuranceRequired: LoA
    result: SessionResult | null
    createdAt: string
    completedAt: string | null
}

export interface ListSessionsResponse {
    total: number
    sessions: SessionRow[]
}

// El detail.detail de cada check es laxo: depende del tipo de módulo.
export interface SessionCheck {
    type: CheckType
    score: number | null
    passed: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    detail: Record<string, any>
}

// El detalle (/sessions/:id) sí usa `sessionId` y agrega evidence/checks/consents.
export interface SessionDetail {
    sessionId: string
    tenantId: string
    externalRef: string | null
    state: SessionState
    assuranceRequired: LoA
    result: SessionResult | null
    evidence: Array<{ type: EvidenceType; storagePath: string; sha256: string }>
    createdAt: string
    completedAt: string | null
    checks: SessionCheck[]
    consents: Array<{ version: string; acceptedAt: string; ip: string | null }>
}

export interface MetricsResponse {
    tenantId?: string
    sessionsTotal: number
    approvalRate: number
    byState: Record<SessionState, number>
    latencyByModule: Record<string, number>
}

export interface AuditEntry {
    id: string
    tenantId: string
    sessionId: string | null
    actor: string
    event: string
    detail: Record<string, unknown>
    ip: string | null
    createdAt: string
}

// ---- Workflows (configurables + versionados) — P0 #1 ----
export type ReviewMode = 'auto' | 'always' | 'on_borderline'

export interface WorkflowDefinition {
    document?: { required: boolean }
    liveness?: { required: boolean; mode?: 'active' | 'passive'; threshold?: number }
    match?: { required: boolean; threshold?: number }
    quality?: { glassesMaxPct?: number }
    review?: {
        mode: ReviewMode
        borderlineBand?: {
            matchMin?: number
            matchMax?: number
            livenessMin?: number
            livenessMax?: number
        }
    }
}

export interface Workflow {
    id: string
    tenantId: string
    name: string
    version: number
    definition: WorkflowDefinition
    isDefault: boolean
    assuranceLevel: LoA
    createdAt: string
    updatedAt: string
}

// ---- Cola de revisión manual — P0 #1 ----
export interface ReviewQueueItem {
    sessionId: string
    tenantId: string
    tenantName: string
    externalRef: string | null
    assuranceRequired: LoA
    suggestion: SessionResult | null
    createdAt: string
}

export interface ReviewQueueResponse {
    total: number
    items: ReviewQueueItem[]
}

export interface ReviewDecisionResponse {
    sessionId: string
    state: SessionState
    result: SessionResult | null
}

// ---- "Probar verificación" (test del operador) ----
export interface TestVerifyCheck {
    type: CheckType
    passed: boolean
    score: number | null
}

export interface TestVerifyResponse {
    sessionId: string
    assurance: LoA
    checks: TestVerifyCheck[]
    extracted: ExtractedDocument | null
    match: { cosine: number; passed: boolean } | null
    decision: { state: string; loa: LoA; reasons: string[] }
    photos: {
        // base64 JPEG (sin prefijo data:) o null si no se pudo recortar.
        selfieCrop: string | null
        docFaceCrop: string | null
    }
}

export interface TestSessionResponse {
    sessionId: string
    assurance: LoA
    verifyUrl: string
    // Sólo presente si se pasó `email`: ¿el backend aceptó el envío del link?
    emailSent?: boolean
}

// ---- Webhooks (suscripciones + entregas) — P0 #2 ----
export type WebhookEvent =
    | 'session.created'
    | 'session.status_updated'
    | 'session.approved'
    | 'session.declined'
    | 'session.in_review'
    | 'session.data_updated'

export interface WebhookEndpoint {
    id: string
    url: string
    events: WebhookEvent[]
    description: string | null
    enabled: boolean
    createdAt: string
    updatedAt: string
}

// La creación devuelve además el secreto (UNA sola vez).
export interface CreateWebhookEndpointResponse extends WebhookEndpoint {
    secret: string
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead'

export interface WebhookDelivery {
    id: string
    endpointId: string | null
    tenantId: string
    sessionId: string | null
    eventId: string
    eventType: WebhookEvent
    url: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any
    status: WebhookDeliveryStatus
    attempts: number
    maxAttempts: number
    responseCode: number | null
    responseBody: string | null
    error: string | null
    lastAttemptAt: string | null
    nextAttemptAt: string | null
    createdAt: string
    updatedAt: string
}

export interface WebhookListResponse {
    events: WebhookEvent[]
    endpoints: WebhookEndpoint[]
}

// ---- Playground OCR (Inspector OCR) ----
export type OcrDebugVariant =
    | 'production'
    | 'raw'
    | 'deskew-upscale'
    | 'enhanced'

// Origen por campo en el camino de PRODUCCIÓN: OCR del frente crudo, fallback
// ampliado, 3er tier de fondo de seguridad (enhanced), o cross-fill desde el MRZ.
export type OcrFieldSource = 'front' | 'upscale' | 'enhanced' | 'mrz'

// Caja de 4 esquinas [[x,y],...] en píxeles de `imageUsed`.
export type OcrBox = [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
]

export interface OcrDebugLine {
    text: string
    score: number
    box: OcrBox
}

// Ancla de un campo: línea-valor (índice + caja) + caja de su etiqueta.
export interface OcrFieldAnchor {
    lineIndex: number
    // bbox [x1,y1,x2,y2] de la línea-valor.
    box: [number, number, number, number]
    // bbox [x1,y1,x2,y2] de la etiqueta (o null si no hubo).
    labelBox: [number, number, number, number] | null
    text: string
}

export interface OcrDebugResponse {
    variant: OcrDebugVariant
    width: number
    height: number
    // base64 JPEG/PNG (sin prefijo data:) de la imagen efectivamente OCR-eada.
    imageUsed: string
    confidence: number
    lines: OcrDebugLine[]
    extracted: ExtractedDocument | null
    anchors: Record<string, OcrFieldAnchor>
    // Ángulo (0/90/270) aplicado para enderezar el frente antes de anclar.
    // INFORMATIVO: las cajas de anchors se reportan en el espacio de la imagen
    // original, así que el overlay calza sin rotar `imageUsed`.
    angle?: number
    // Sólo en variant="production": origen por campo (front/upscale/mrz).
    sources?: Record<string, OcrFieldSource>
    // Sólo en variant="production": ¿corrió el fallback ampliado?
    usedUpscaleFallback?: boolean
    // Sólo en variant="production" con dorso: MRZ TD1 detectado (o null).
    mrz?: unknown
}

// Identidad rica extraída del documento (checks[document].detail.extracted).
export interface ExtractedDocument {
    documento?: {
        pais?: string
        tipo?: string
        numeroCedula?: string
        specimen?: boolean
    }
    titular?: {
        apellidos?: string
        nombres?: string
        fechaNacimiento?: string
        sexo?: string
        lugarNacimiento?: { ciudad?: string; departamento?: string }
        nacionalidad?: string
        estadoCivil?: string
        donante?: boolean
    }
    documentoFisico?: {
        fechaEmision?: string
        fechaVencimiento?: string
        chip?: boolean
        codigoBarras?: boolean
    }
    registroInterno?: { ic?: string; ubicacion?: string }
    autoridadEmisora?: { nombre?: string; cargo?: string; dependencia?: string }
}
