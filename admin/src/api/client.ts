// Cliente HTTP same-origin contra /admin. Inyecta Authorization: Bearer <token>.
// 401 → limpia sesión y redirige a /admin-ui/login (token TTL 8h + store in-memory:
// un reinicio del backend invalida los tokens, hay que re-loguear).
import { clearAuth, getToken } from './auth'
import type {
  ApiKey,
  AuditEntry,
  CreateApiKeyResponse,
  ListSessionsResponse,
  LoginResponse,
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

function redirectToLogin(): void {
  clearAuth()
  if (!window.location.pathname.endsWith('/login')) {
    window.location.href = '/admin-ui/login'
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { auth?: boolean }
): Promise<T> {
  const auth = opts?.auth !== false
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
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
    throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data as T
}

// Fetch binario (evidencia) con Bearer → Blob.
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

export const api = {
  // ---- Auth ----
  login(email: string, password: string) {
    return request<LoginResponse>('POST', '/login', { email, password }, { auth: false })
  },

  // ---- Tenants ----
  listTenants() {
    return request<{ tenants: Tenant[] }>('GET', '/tenants')
  },
  getTenant(id: string) {
    return request<Tenant>('GET', `/tenants/${id}`)
  },
  createTenant(body: { name: string; slug: string; policies?: Partial<TenantPolicy> }) {
    return request<Tenant>('POST', '/tenants', body)
  },
  updateTenant(
    id: string,
    body: { name?: string; status?: string; policies?: Partial<TenantPolicy> }
  ) {
    return request<Tenant>('PATCH', `/tenants/${id}`, body)
  },

  // ---- API keys ----
  listApiKeys(tenantId: string) {
    return request<{ apiKeys: ApiKey[] }>('GET', `/tenants/${tenantId}/api-keys`)
  },
  createApiKey(tenantId: string, body: { label: string; scopes?: string[] }) {
    return request<CreateApiKeyResponse>('POST', `/tenants/${tenantId}/api-keys`, body)
  },
  revokeApiKey(tenantId: string, keyId: string) {
    return request<{ id: string; status: string }>(
      'DELETE',
      `/tenants/${tenantId}/api-keys/${keyId}`
    )
  },

  // ---- Sessions ----
  listSessions(
    tenantId: string,
    params?: { state?: SessionState; limit?: number; offset?: number }
  ) {
    const q = new URLSearchParams()
    if (params?.state) q.set('state', params.state)
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    const qs = q.toString()
    return request<ListSessionsResponse>(
      'GET',
      `/tenants/${tenantId}/sessions${qs ? `?${qs}` : ''}`
    )
  },
  getSession(tenantId: string, sessionId: string) {
    return request<SessionDetail>('GET', `/tenants/${tenantId}/sessions/${sessionId}`)
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
      `/tenants/${tenantId}/audit${qs ? `?${qs}` : ''}`
    )
  },

  // ---- Evidencia (binario, ruta nueva guarded en el backend) ----
  evidenceBlob(tenantId: string, sessionId: string, type: string) {
    return requestBlob(`/tenants/${tenantId}/sessions/${sessionId}/evidence/${type}`)
  },
}

export { ApiError }
