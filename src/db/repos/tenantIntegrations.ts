/**
 * Repo de tenant_integrations (Fase 2 — Proveedores por tenant).
 *
 * El campo `config` se persiste CIFRADO con AES-256-GCM (ver src/lib/secrets.ts).
 * En lectura: si el descifrado falla (key ausente, datos corruptos), se devuelve
 * la fila con `enabled=false` y `config={}` → el resolver usa el proveedor global.
 * Nunca se loguea la config descifrada.
 */
import { pool } from '../pool'
import type { Executor } from '../executor'
import { iso } from './mapping'
import { encryptConfig, decryptConfig } from '../../lib/secrets'

export type IntegrationKind = 'smtp' | 'storage' | 'aml' | 'sms'

const VALID_KINDS = new Set<string>(['smtp', 'storage', 'aml', 'sms'])

/**
 * SMS PROVIDER — DEFERRED (Fase 2).
 * La tabla soporta kind='sms' y la API acepta GET/PUT para 'sms'.
 * La implementación del resolver `resolveSmsProvider()` y del envío real
 * de SMS es trabajo futuro. No existe `resolveSmsProvider` en esta fase.
 * La UI muestra la pestaña SMS como "Próximamente".
 */

export interface TenantIntegration {
  id: string
  tenantId: string
  kind: IntegrationKind
  /** Config descifrada (o {} si decrypt falló — tratarlo como no configurado). */
  config: Record<string, unknown>
  /** false si el row existe pero decrypt falló (fail-closed). */
  enabled: boolean
  updatedBy: string
  createdAt: string
  updatedAt: string
}

interface IntegrationRow {
  id: string
  tenant_id: string
  kind: string
  config: Record<string, unknown>
  enabled: boolean
  updated_by: string
  created_at: Date
  updated_at: Date
}

function mapRow(row: IntegrationRow): TenantIntegration {
  // Descifrar config; si falla → fail-closed: enabled=false, config={}
  const decrypted = decryptConfig<Record<string, unknown>>(row.config)
  if (decrypted === null) {
    console.warn(
      `[tenantIntegrations] decrypt failed for tenant=${row.tenant_id} kind=${row.kind} — falling back to global provider`
    )
    return {
      id: row.id,
      tenantId: row.tenant_id,
      kind: row.kind as IntegrationKind,
      config: {},
      enabled: false,
      updatedBy: row.updated_by,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind as IntegrationKind,
    config: decrypted,
    enabled: row.enabled,
    updatedBy: row.updated_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export function isValidKind(kind: unknown): kind is IntegrationKind {
  return typeof kind === 'string' && VALID_KINDS.has(kind)
}

/**
 * INSERT or UPDATE (ON CONFLICT DO UPDATE) de una integración por tenant+kind.
 * La config se cifra antes de persistir. Lanza si TEKO_SECRETS_KEY falta.
 */
export async function upsert(
  tenantId: string,
  kind: IntegrationKind,
  config: Record<string, unknown>,
  enabled: boolean,
  actor: string,
  exec: Executor = pool
): Promise<TenantIntegration> {
  const encryptedConfig = encryptConfig(config) // lanza si key falta
  const res = await exec.query<IntegrationRow>(
    `INSERT INTO tenant_integrations (tenant_id, kind, config, enabled, updated_by)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (tenant_id, kind) DO UPDATE SET
       config     = EXCLUDED.config,
       enabled    = EXCLUDED.enabled,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`,
    [tenantId, kind, JSON.stringify(encryptedConfig), enabled, actor]
  )
  return mapRow(res.rows[0])
}

export async function getByKind(
  tenantId: string,
  kind: IntegrationKind,
  exec: Executor = pool
): Promise<TenantIntegration | null> {
  const res = await exec.query<IntegrationRow>(
    `SELECT * FROM tenant_integrations WHERE tenant_id = $1 AND kind = $2`,
    [tenantId, kind]
  )
  return res.rows[0] ? mapRow(res.rows[0]) : null
}

export async function listByTenant(
  tenantId: string,
  exec: Executor = pool
): Promise<TenantIntegration[]> {
  const res = await exec.query<IntegrationRow>(
    `SELECT * FROM tenant_integrations WHERE tenant_id = $1 ORDER BY kind`,
    [tenantId]
  )
  return res.rows.map(mapRow)
}

export async function remove(
  tenantId: string,
  kind: IntegrationKind,
  exec: Executor = pool
): Promise<boolean> {
  const res = await exec.query(
    `DELETE FROM tenant_integrations WHERE tenant_id = $1 AND kind = $2`,
    [tenantId, kind]
  )
  return (res.rowCount ?? 0) > 0
}
