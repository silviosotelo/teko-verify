// Cliente HTTP same-origin contra /admin (API del backend Teko Verify).
// Inyecta Authorization: Bearer <token> tomando el token del MISMO storage que
// usa ecme (TOKEN_NAME_IN_STORAGE = 'token'), seteado por el AuthProvider al
// loguear. 401 → limpia sesión y vuelve al login (/admin-ui/sign-in).
import { TOKEN_NAME_IN_STORAGE } from '@/constants/api.constant'
import type {
    ApiKey,
    AuditEntry,
    CreateApiKeyResponse,
    ListSessionsResponse,
    MetricsResponse,
    SessionDetail,
    SessionState,
    Tenant,
    TenantPolicy,
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
        },
    ) {
        return request<Tenant>('PATCH', `/tenants/${id}`, body)
    },

    // ---- API keys ----
    listApiKeys(tenantId: string) {
        return request<{ apiKeys: ApiKey[] }>(
            'GET',
            `/tenants/${tenantId}/api-keys`,
        )
    },
    createApiKey(tenantId: string, body: { label: string; scopes?: string[] }) {
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
}

export { ApiError }
