// Contratos del backend Teko admin (subconjunto consumido por el dashboard).
// Espejo de src/types.ts del backend.

export type AdminRole = 'owner' | 'operator' | 'viewer'

export type SessionState =
  | 'created'
  | 'capturing'
  | 'processing'
  | 'verified'
  | 'rejected'
  | 'needs_recapture'
  | 'expired'
  | 'error'

export type LoA = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
export type TenantStatus = 'active' | 'suspended' | 'disabled'
export type ApiKeyStatus = 'active' | 'revoked'
export type CheckType = 'quality' | 'liveness' | 'document' | 'match'
export type EvidenceType = 'selfie' | 'doc_front' | 'doc_back' | 'frames'

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

// Identidad rica extraída del documento (checks[document].detail.extracted).
export interface ExtractedDocument {
  documento?: { pais?: string; tipo?: string; numeroCedula?: string; specimen?: boolean }
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
