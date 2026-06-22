/**
 * Resolvers de proveedores por tenant (Fase 2).
 *
 * Cada función implementa la cascada: configuración del tenant → global (env/config.ts).
 * Fail-closed: un error de DB o de decrypt → WARNING + fallback, nunca crash.
 * Estos son wrappers NUEVOS; las funciones globales (loadSmtpConfig, resolveAmlProvider)
 * no se modifican y siguen funcionando como están.
 */
import { getByKind } from '../db/repos/tenantIntegrations'
import type { Executor } from '../db/executor'
import { loadSmtpConfig, type SmtpConfig } from './mailer'
import { resolveAmlProvider, HttpAmlProvider, type ExternalAmlConfig, type AmlProviderMode, type ExternalAmlProvider } from '../modules/amlProvider'

const EVIDENCE_DEFAULT = '/data/teko/evidence'

// ---------------------------------------------------------------------------
// SMTP / Mailer
// ---------------------------------------------------------------------------

function isValidSmtpConfig(cfg: Record<string, unknown>): cfg is Record<string, unknown> & { host: string; user: string; password: string } {
  return typeof cfg.host === 'string' && cfg.host.length > 0
    && typeof cfg.user === 'string' && cfg.user.length > 0
    && typeof cfg.password === 'string' && cfg.password.length > 0
}

function toSmtpConfig(cfg: Record<string, unknown>): SmtpConfig {
  const portRaw = typeof cfg.port === 'number' ? cfg.port : parseInt(String(cfg.port ?? '587'), 10)
  return {
    host: String(cfg.host),
    port: Number.isFinite(portRaw) ? portRaw : 587,
    secure: Boolean(cfg.secure),
    user: String(cfg.user),
    password: String(cfg.password),
    fromEmail: typeof cfg.fromEmail === 'string' ? cfg.fromEmail : String(cfg.user),
    fromName: typeof cfg.fromName === 'string' ? cfg.fromName : 'Teko Verify',
  }
}

/**
 * Resuelve la config SMTP para el tenant.
 * Cascada: tenant_integrations(smtp, enabled=true) → global env.
 * Fail-closed: decrypt fallido o config incompleta → usa global.
 * @returns SmtpConfig | null (null = sin SMTP configurado en ningún nivel)
 */
export async function resolveSmtpConfig(
  tenantId: string,
  exec?: Executor
): Promise<SmtpConfig | null> {
  try {
    const row = await getByKind(tenantId, 'smtp', exec)
    if (row && row.enabled && isValidSmtpConfig(row.config)) {
      return toSmtpConfig(row.config)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[providerResolver] SMTP lookup failed for tenant=${tenantId}: ${(e as Error).message} — using global`)
  }
  return loadSmtpConfig()
}

// ---------------------------------------------------------------------------
// Storage / EvidenceStore
// ---------------------------------------------------------------------------

/**
 * Resuelve el directorio base de evidencia para el tenant.
 * Sin secretos: config.baseDir es texto plano.
 * Cascada: tenant baseDir → TEKO_EVIDENCE_DIR env → hardcoded default.
 * Siempre devuelve un string (nunca null).
 */
export async function resolveEvidenceDir(
  tenantId: string,
  exec?: Executor
): Promise<string> {
  try {
    const row = await getByKind(tenantId, 'storage', exec)
    if (row && row.enabled && typeof row.config.baseDir === 'string' && row.config.baseDir.length > 0) {
      return row.config.baseDir
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[providerResolver] storage lookup failed for tenant=${tenantId}: ${(e as Error).message} — using global`)
  }
  return process.env.TEKO_EVIDENCE_DIR || EVIDENCE_DEFAULT
}

// ---------------------------------------------------------------------------
// AML
// ---------------------------------------------------------------------------

function toAmlConfig(cfg: Record<string, unknown>): ExternalAmlConfig | null {
  if (typeof cfg.baseUrl !== 'string' || typeof cfg.apiKey !== 'string' || typeof cfg.providerName !== 'string') return null
  return {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    providerName: cfg.providerName,
    threshold: typeof cfg.threshold === 'number' ? cfg.threshold : 0.8,
    timeout: typeof cfg.timeout === 'number' ? cfg.timeout : 15000,
  }
}

/**
 * Resuelve el provider AML para el tenant.
 * Cascada: tenant_integrations(aml, enabled=true) → resolveAmlProvider() global.
 * null → pipeline usa proveedor local (OpenSanctions).
 */
export async function resolveAmlConfig(
  tenantId: string,
  exec?: Executor
): Promise<{ provider: ExternalAmlProvider; config: ExternalAmlConfig; mode: AmlProviderMode } | null> {
  try {
    const row = await getByKind(tenantId, 'aml', exec)
    if (row && row.enabled) {
      const cfg = toAmlConfig(row.config)
      if (cfg) {
        return { provider: new HttpAmlProvider(), config: cfg, mode: 'external' }
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[providerResolver] AML lookup failed for tenant=${tenantId}: ${(e as Error).message} — using global`)
  }
  return resolveAmlProvider()
}
