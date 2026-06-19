// Cliente HTTP same-origin contra /admin (API del backend Teko Verify).
// Inyecta Authorization: Bearer <token> tomando el token del MISMO storage que
// usa ecme (TOKEN_NAME_IN_STORAGE = 'token'), seteado por el AuthProvider al
// loguear. 401 → limpia sesión y vuelve al login (/admin-ui/sign-in).
import { TOKEN_NAME_IN_STORAGE } from '@/constants/api.constant'
import type {
    ApiKey,
    App,
    AuditEntry,
    CreateApiKeyResponse,
    MeResponse,
    OperatorRow,
    AdminRole,
    UsageResponse,
    ListSessionsResponse,
    LoA,
    MetricsResponse,
    OcrDebugResponse,
    OcrDebugVariant,
    ReviewDecisionResponse,
    ReviewQueueResponse,
    SessionDetail,
    SessionEventsResponse,
    SessionState,
    Tenant,
    TenantBranding,
    TenantPolicy,
    TestSessionResponse,
    TestVerifyResponse,
    Workflow,
    WorkflowDefinition,
    Questionnaire,
    QuestionnaireQuestion,
    WebhookEvent,
    WebhookEndpoint,
    WebhookDelivery,
    WebhookListResponse,
    CreateWebhookEndpointResponse,
} from './types'

// baseURL origin-root: NO relativo a /admin-ui/.
const BASE = '/admin'

class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}

function getToken(): string | null {
    return localStorage.getItem(TOKEN_NAME_IN_STORAGE)
}

function redirectToLogin(): void {
    localStorage.removeItem(TOKEN_NAME_IN_STORAGE)
    if (!window.location.pathname.endsWith('/sign-in')) {
        window.location.href = '/admin-ui/sign-in'
    }
}

async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { auth?: boolean },
): Promise<T> {
    const auth = opts?.auth !== false
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    }
    if (auth) {
        const token = getToken()
        if (token) headers['Authorization'] = `Bearer ${token}`
    }
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (res.status === 401 && auth) {
        redirectToLogin()
        throw new ApiError(401, 'No autorizado')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null
    const text = await res.text()
    if (text) {
        try {
            data = JSON.parse(text)
        } catch {
            data = text
        }
    }

    if (!res.ok) {
        const msg =
            (data && (data.error || data.detail)) || `Error ${res.status}`
        throw new ApiError(
            res.status,
            typeof msg === 'string' ? msg : JSON.stringify(msg),
        )
    }
    return data as T
}

// Fetch binario (evidencia) con Bearer → Blob. Un <img src> no manda el header.
async function requestBlob(path: string): Promise<Blob> {
    const token = getToken()
    const res = await fetch(`${BASE}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (res.status === 401) {
        redirectToLogin()
        throw new ApiError(401, 'No autorizado')
    }
    if (!res.ok) throw new ApiError(res.status, `Error ${res.status}`)
    return res.blob()
}

export const tekoApi = {
    // ---- Operador actual + RBAC ----
    me() {
        return request<MeResponse>('GET', '/me')
    },

    // ---- Team / miembros (operadores) ----
    listOperators() {
        return request<{ operators: OperatorRow[]; assignableRoles: AdminRole[] }>(
            'GET',
            '/operators',
        )
    },
    createOperator(body: { email: string; password: string; role: AdminRole }) {
        return request<OperatorRow>('POST', '/operators', body)
    },
    updateOperatorRole(id: string, role: AdminRole) {
        return request<OperatorRow>('PATCH', `/operators/${id}`, { role })
    },

    // ---- Apps (App-scoping — Pieza 2) ----
    listApps(tenantId: string) {
        return request<{ apps: App[] }>('GET', `/tenants/${tenantId}/apps`)
    },
    createApp(tenantId: string, name: string) {
        return request<App>('POST', `/tenants/${tenantId}/apps`, { name })
    },
    updateApp(tenantId: string, appId: string, name: string) {
        return request<App>('PUT', `/tenants/${tenantId}/apps/${appId}`, { name })
    },
    deleteApp(tenantId: string, appId: string) {
        return request<{ id: string; deleted: boolean }>(
            'DELETE',
            `/tenants/${tenantId}/apps/${appId}`,
        )
    },

    // ---- Uso por org (Pieza 3) ----
    usage(tenantId: string, params?: { from?: string; to?: string }) {
        const q = new URLSearchParams()
        if (params?.from) q.set('from', params.from)
        if (params?.to) q.set('to', params.to)
        const qs = q.toString()
        return request<UsageResponse>(
            'GET',
            `/tenants/${tenantId}/usage${qs ? `?${qs}` : ''}`,
        )
    },

    // ---- Tenants ----
    listTenants() {
        return request<{ tenants: Tenant[] }>('GET', '/tenants')
    },
    getTenant(id: string) {
        return request<Tenant>('GET', `/tenants/${id}`)
    },
    createTenant(body: {
        name: string
        slug: string
        policies?: Partial<TenantPolicy>
    }) {
        return request<Tenant>('POST', '/tenants', body)
    },
    updateTenant(
        id: string,
        body: {
            name?: string
            status?: string
            policies?: Partial<TenantPolicy>
            branding?: TenantBranding
        },
    ) {
        return request<Tenant>('PATCH', `/tenants/${id}`, body)
    },

    // ---- White-label: logo de marca (P1 #5) ----
    // Sube el logo (multipart, campo `logo`) → el backend lo normaliza on-prem y
    // devuelve { logoUrl }. Bearer manual (request() es JSON-only).
    async uploadBrandingLogo(tenantId: string, file: File) {
        const token = getToken()
        const form = new FormData()
        form.append('logo', file)
        const res = await fetch(`${BASE}/tenants/${tenantId}/branding/logo`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form,
        })
        if (res.status === 401) {
            redirectToLogin()
            throw new ApiError(401, 'No autorizado')
        }
        if (!res.ok) throw new ApiError(res.status, `Error ${res.status}`)
        return (await res.json()) as { logoUrl: string; branding: TenantBranding }
    },

    // ---- API keys ----
    listApiKeys(tenantId: string) {
        return request<{ apiKeys: ApiKey[] }>(
            'GET',
            `/tenants/${tenantId}/api-keys`,
        )
    },
    createApiKey(
        tenantId: string,
        body: { label: string; scopes?: string[]; appId?: string },
    ) {
        return request<CreateApiKeyResponse>(
            'POST',
            `/tenants/${tenantId}/api-keys`,
            body,
        )
    },
    revokeApiKey(tenantId: string, keyId: string) {
        return request<{ id: string; status: string }>(
            'DELETE',
            `/tenants/${tenantId}/api-keys/${keyId}`,
        )
    },

    // ---- Sessions ----
    listSessions(
        tenantId: string,
        params?: { state?: SessionState; limit?: number; offset?: number },
    ) {
        const q = new URLSearchParams()
        if (params?.state) q.set('state', params.state)
        if (params?.limit != null) q.set('limit', String(params.limit))
        if (params?.offset != null) q.set('offset', String(params.offset))
        const qs = q.toString()
        return request<ListSessionsResponse>(
            'GET',
            `/tenants/${tenantId}/sessions${qs ? `?${qs}` : ''}`,
        )
    },
    getSession(tenantId: string, sessionId: string) {
        return request<SessionDetail>(
            'GET',
            `/tenants/${tenantId}/sessions/${sessionId}`,
        )
    },
    // Timeline forense (P0 #3): eventos cronológicos + análisis Device & IP.
    getSessionEvents(tenantId: string, sessionId: string) {
        return request<SessionEventsResponse>(
            'GET',
            `/tenants/${tenantId}/sessions/${sessionId}/events`,
        )
    },

    // ---- Workflows (configurables + versionados) — P0 #1 ----
    listWorkflows(tenantId: string) {
        return request<{ workflows: Workflow[] }>(
            'GET',
            `/tenants/${tenantId}/workflows`,
        )
    },
    createWorkflow(
        tenantId: string,
        body: { name: string; definition: WorkflowDefinition; appId?: string },
    ) {
        return request<Workflow>('POST', `/tenants/${tenantId}/workflows`, body)
    },
    // Editar = crear una nueva VERSIÓN del workflow `name`.
    updateWorkflow(
        tenantId: string,
        name: string,
        definition: WorkflowDefinition,
    ) {
        return request<Workflow>(
            'PUT',
            `/tenants/${tenantId}/workflows/${encodeURIComponent(name)}`,
            { definition },
        )
    },

    // ---- Questionnaires (formularios custom por workflow) — P2 ----
    listQuestionnaires(tenantId: string) {
        return request<{ questionnaires: Questionnaire[] }>(
            'GET',
            `/tenants/${tenantId}/questionnaires`,
        )
    },
    createQuestionnaire(
        tenantId: string,
        body: { name: string; questions: QuestionnaireQuestion[] },
    ) {
        return request<Questionnaire>(
            'POST',
            `/tenants/${tenantId}/questionnaires`,
            body,
        )
    },
    updateQuestionnaire(
        tenantId: string,
        questionnaireId: string,
        body: {
            name?: string
            questions?: QuestionnaireQuestion[]
            active?: boolean
        },
    ) {
        return request<Questionnaire>(
            'PUT',
            `/tenants/${tenantId}/questionnaires/${questionnaireId}`,
            body,
        )
    },

    // ---- Cola de revisión manual — P0 #1 ----
    reviewQueue(params?: { tenantId?: string; limit?: number; offset?: number }) {
        const q = new URLSearchParams()
        if (params?.tenantId) q.set('tenantId', params.tenantId)
        if (params?.limit != null) q.set('limit', String(params.limit))
        if (params?.offset != null) q.set('offset', String(params.offset))
        const qs = q.toString()
        return request<ReviewQueueResponse>(
            'GET',
            `/review-queue${qs ? `?${qs}` : ''}`,
        )
    },
    decideReview(
        sessionId: string,
        decision: 'approve' | 'decline',
        reason?: string,
    ) {
        return request<ReviewDecisionResponse>(
            'POST',
            `/sessions/${sessionId}/review`,
            reason ? { decision, reason } : { decision },
        )
    },

    // ---- Webhooks (suscripciones + entregas) — P0 #2 ----
    listWebhooks(tenantId: string) {
        return request<WebhookListResponse>(
            'GET',
            `/tenants/${tenantId}/webhooks`,
        )
    },
    createWebhook(
        tenantId: string,
        body: {
            url: string
            events: WebhookEvent[]
            description?: string
            appId?: string
        },
    ) {
        return request<CreateWebhookEndpointResponse>(
            'POST',
            `/tenants/${tenantId}/webhooks`,
            body,
        )
    },
    updateWebhook(
        tenantId: string,
        endpointId: string,
        body: {
            url?: string
            events?: WebhookEvent[]
            enabled?: boolean
            description?: string
        },
    ) {
        return request<WebhookEndpoint>(
            'PUT',
            `/tenants/${tenantId}/webhooks/${endpointId}`,
            body,
        )
    },
    deleteWebhook(tenantId: string, endpointId: string) {
        return request<{ id: string; deleted: boolean }>(
            'DELETE',
            `/tenants/${tenantId}/webhooks/${endpointId}`,
        )
    },
    listWebhookDeliveries(
        tenantId: string,
        endpointId: string,
        params?: { limit?: number },
    ) {
        const q = new URLSearchParams()
        if (params?.limit != null) q.set('limit', String(params.limit))
        const qs = q.toString()
        return request<{ deliveries: WebhookDelivery[] }>(
            'GET',
            `/tenants/${tenantId}/webhooks/${endpointId}/deliveries${qs ? `?${qs}` : ''}`,
        )
    },
    testWebhook(tenantId: string, endpointId: string) {
        return request<{ delivery: WebhookDelivery | null }>(
            'POST',
            `/tenants/${tenantId}/webhooks/${endpointId}/test`,
        )
    },
    resendWebhookDelivery(
        tenantId: string,
        endpointId: string,
        deliveryId: string,
    ) {
        return request<{ delivery: WebhookDelivery | null }>(
            'POST',
            `/tenants/${tenantId}/webhooks/${endpointId}/deliveries/${deliveryId}/resend`,
        )
    },

    // ---- Métricas + auditoría ----
    metrics(tenantId: string) {
        return request<MetricsResponse>('GET', `/tenants/${tenantId}/metrics`)
    },
    audit(tenantId: string, params?: { limit?: number }) {
        const q = new URLSearchParams()
        if (params?.limit != null) q.set('limit', String(params.limit))
        const qs = q.toString()
        return request<{ entries: AuditEntry[] }>(
            'GET',
            `/tenants/${tenantId}/audit${qs ? `?${qs}` : ''}`,
        )
    },

    // ---- Evidencia (binario, guarded en el backend) ----
    evidenceBlob(tenantId: string, sessionId: string, type: string) {
        return requestBlob(
            `/tenants/${tenantId}/sessions/${sessionId}/evidence/${type}`,
        )
    },

    // ---- "Probar verificación" (test del operador) ----
    // Sube 3 imágenes (base64), corre el pipeline al nivel elegido y devuelve el
    // resultado completo (checks + extracted + match + decision + fotos inline).
    testVerify(body: {
        tenantId: string
        assurance: LoA
        selfie: string
        front: string
        back: string
    }) {
        return request<TestVerifyResponse>('POST', '/test-verify', body)
    },
    // Crea una sesión de test al nivel elegido y devuelve verifyUrl para la captura
    // en vivo (cámara) — reusa el flujo del usuario. Si se pasa `email`, el backend
    // le envía el verifyUrl por email nativo (transaccional, fail-open).
    testSession(
        tenantId: string,
        assurance: LoA,
        email?: string,
        appId?: string,
    ) {
        const body: Record<string, unknown> = { assurance }
        if (email) body.email = email
        if (appId) body.appId = appId
        return request<TestSessionResponse>(
            'POST',
            `/tenants/${tenantId}/test-session`,
            body,
        )
    },
    // Reenvía el link de verificación de una sesión existente a un email.
    sendSessionLink(tenantId: string, sessionId: string, email: string) {
        return request<{ sessionId: string; emailSent: boolean }>(
            'POST',
            `/tenants/${tenantId}/sessions/${sessionId}/send-link`,
            { email },
        )
    },

    // ---- Playground OCR (Inspector OCR) ----
    // Sube una imagen de cédula (frente, base64), corre PaddleOCR + el extractor
    // real y devuelve cajas/scores + campos + anclas (qué línea ancló cada campo).
    ocrDebug(body: {
        image: string
        variant?: OcrDebugVariant
        back?: string
    }) {
        return request<OcrDebugResponse>('POST', '/ocr-debug', body)
    },

    // ---- Analytics (métricas diarias) ----
    analytics(
        tenantId: string,
        params?: { from?: string; to?: string },
    ) {
        const q = new URLSearchParams()
        if (params?.from) q.set('from', params.from)
        if (params?.to) q.set('to', params.to)
        const qs = q.toString()
        return request<{
            daily: Array<{
                date: string
                created: number
                completed: number
                approved: number
                declined: number
                avgDuration: number
            }>
            latencyByModule: Record<string, { avg: number; p50: number; p95: number }>
            approvalRate: number
            totalSessions: number
        }>('GET', `/tenants/${tenantId}/analytics${qs ? `?${qs}` : ''}`)
    },

    // ---- Compliance reports ----
    compliance(tenantId: string) {
        return request<{
            summary: Record<string, unknown>
            generatedAt: string
        }>('GET', `/tenants/${tenantId}/compliance`)
    },

    // ---- Email templates ----
    listEmailTemplates(tenantId: string) {
        return request<{ templates: Array<{ type: string; subject: string; body: string; active: boolean }> }>(
            'GET', `/tenants/${tenantId}/email-templates`,
        )
    },
    upsertEmailTemplate(
        tenantId: string,
        body: { type: string; subject: string; body: string; active?: boolean },
    ) {
        return request<{ type: string; subject: string; body: string; active: boolean }>(
            'POST', `/tenants/${tenantId}/email-templates`, body,
        )
    },
    deleteEmailTemplate(tenantId: string, type: string) {
        return request<{ deleted: boolean }>(
            'DELETE', `/tenants/${tenantId}/email-templates/${encodeURIComponent(type)}`,
        )
    },

    // ---- Rate limits por tenant ----
    updateTenantRateLimits(
        tenantId: string,
        body: { v1?: number; verify?: number; admin?: number },
    ) {
        return request<{ rateLimits: Record<string, number> }>(
            'PATCH', `/tenants/${tenantId}/rate-limits`, body,
        )
    },

    // ---- Face gallery ----
    addFaceToGallery(tenantId: string, body: { identityId: string; faceUrl?: string }) {
        return request<{ identityId: string; added: boolean }>(
            'POST', `/tenants/${tenantId}/gallery`, body,
        )
    },
    removeFaceFromGallery(tenantId: string, identityId: string) {
        return request<{ identityId: string; removed: boolean }>(
            'DELETE', `/tenants/${tenantId}/gallery/${identityId}`,
        )
    },

    // ---- Bulk session operations ----
    bulkSessionAction(
        tenantId: string,
        body: {
            action: 'approve' | 'decline' | 'delete'
            sessionIds: string[]
            reason?: string
        },
    ) {
        return request<{ affected: number }>(
            'POST', `/tenants/${tenantId}/sessions/bulk`, body,
        )
    },

    // ---- Audit CSV export ----
    auditCsvUrl(tenantId: string) {
        return `/admin/tenants/${tenantId}/audit.csv`
    },

    // ---- Session export PDF ----
    sessionExportPdfUrl(tenantId: string, sessionId: string) {
        return `/admin/tenants/${tenantId}/sessions/${sessionId}/export-pdf`
    },
}

export { ApiError }
