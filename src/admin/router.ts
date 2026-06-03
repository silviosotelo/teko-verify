/**
 * API del dashboard de administración (/admin/*) — §8.C.
 *
 * Gestión de tenants, API keys, revisión de sesiones, métricas y export de auditoría.
 * Consume las APIs admin, separadas de las del tenant.
 *
 * AUTH (real, hardened §8.C):
 *   - Operadores en tabla admin_operators (username/email, password_hash scrypt, role).
 *   - POST /admin/login verifica la contraseña en TIEMPO CONSTANTE (verifyPassword →
 *     scrypt + timingSafeEqual) y emite un token de sesión opaco (randomBytes).
 *   - Middleware adminGuard valida el token de sesión (no un token estático global).
 *   - Roles (AdminRole): requireRole() restringe mutaciones a owner/operator; los
 *     viewer solo leen.
 *   - El login va ANTES del guard y tiene su propio rate-limit (anti fuerza-bruta).
 *
 * Store de sesiones: in-memory (single-container on-prem, §4). Re-login tras reinicio
 * es aceptable. Tabla admin_sessions = trabajo futuro si se quiere durabilidad.
 */
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { repos } from "../db/repos";
import { pool } from "../db/pool";
import {
  generateApiKey,
  generateSessionToken,
  hashPassword,
  verifyPassword,
} from "../lib/crypto";
import { adminLoginRateLimiter } from "../lib/rateLimit";
import { mergePolicy } from "../lib/policy";
import type {
  AdminLoginResponse,
  AdminRole,
  AdminSessionDetailResponse,
  ApiKeyResponse,
  CreateApiKeyResponse,
  SessionState,
  TenantResponse,
} from "../types";

// ============================ admin_operators (datos) ====================== //
// Acceso self-contained al store de operadores (la tabla la crea migrations/0003).

interface OperatorRow {
  id: string;
  username: string;
  password_hash: string;
  role: AdminRole;
}

async function findOperatorByUsername(username: string): Promise<OperatorRow | null> {
  const res = await pool.query<OperatorRow>(
    "SELECT id, username, password_hash, role FROM admin_operators WHERE username = $1",
    [username]
  );
  return res.rows[0] ?? null;
}

async function countOperators(): Promise<number> {
  const res = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM admin_operators");
  return parseInt(res.rows[0]?.n ?? "0", 10);
}

async function insertOperator(
  username: string,
  passwordHash: string,
  role: AdminRole
): Promise<void> {
  await pool.query(
    "INSERT INTO admin_operators (username, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING",
    [username, passwordHash, role]
  );
}

/**
 * Bootstrap fail-closed del primer operador: si NO hay operadores y están seteadas
 * TEKO_ADMIN_BOOTSTRAP_USER/PASSWORD, crea uno owner. NUNCA credenciales por defecto.
 * Se invoca al boot (server.ts). Si no hay operadores ni bootstrap, el admin queda
 * sin acceso (fail-closed) hasta que se siembre uno explícitamente.
 */
export async function bootstrapAdminOperator(): Promise<void> {
  const user = process.env.TEKO_ADMIN_BOOTSTRAP_USER;
  const pass = process.env.TEKO_ADMIN_BOOTSTRAP_PASSWORD;
  if (!user || !pass) return;
  if ((await countOperators()) > 0) return;
  await insertOperator(user, hashPassword(pass), "owner");
  // eslint-disable-next-line no-console
  console.log(`[admin] operador bootstrap creado: ${user} (owner)`);
}

// ============================ sesiones de operador ========================= //

interface AdminSession {
  operatorId: string;
  username: string;
  role: AdminRole;
  expiresAt: number; // epoch ms
}

const SESSION_TTL_MS =
  parseInt(process.env.TEKO_ADMIN_SESSION_TTL_MIN || "480", 10) * 60_000;
const sessions = new Map<string, AdminSession>();

function issueSession(op: OperatorRow): { token: string; expiresAt: number } {
  const token = generateSessionToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, {
    operatorId: op.id,
    username: op.username,
    role: op.role,
    expiresAt,
  });
  return { token, expiresAt };
}

function resolveSession(token: string): AdminSession | null {
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

// Extiende Request con el operador autenticado (sin `any`).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminOperator?: AdminSession;
    }
  }
}

// ================================= router ================================== //

export const adminRouter = Router();

// ---- Login (ANTES del guard) + rate-limit estricto ------------------------ //
adminRouter.post(
  "/login",
  adminLoginRateLimiter(),
  async (req: Request, res: Response) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!email || !password) {
        res.status(400).json({ error: "email_and_password_required" });
        return;
      }
      const op = await findOperatorByUsername(email);
      // Verificación en tiempo constante. Si no existe el operador, igualmente
      // ejecutamos verifyPassword contra un hash dummy para no filtrar por timing.
      const stored = op?.password_hash ?? ("scrypt$00$" + "0".repeat(128)); // dummy de 64 bytes: scrypt SIEMPRE corre (anti timing-oracle de enumeracion)
      const ok = verifyPassword(password, stored);
      if (!op || !ok) {
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      const { token, expiresAt } = issueSession(op);
      const resp: AdminLoginResponse = {
        token,
        operator: { id: op.id, email: op.username, role: op.role },
        expiresAt: new Date(expiresAt).toISOString(),
      };
      res.json(resp);
    } catch (e) {
      res.status(500).json({ error: "login_error", detail: (e as Error).message });
    }
  }
);

/** Guard: token de sesión opaco (no un token estático global). Fail-closed → 401. */
function adminGuard(req: Request, res: Response, next: NextFunction): void {
  const h = req.header("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) {
    res.status(401).json({ error: "admin_unauthorized" });
    return;
  }
  const session = resolveSession(m[1].trim());
  if (!session) {
    res.status(401).json({ error: "admin_unauthorized" });
    return;
  }
  req.adminOperator = session;
  next();
}

/** Restringe una ruta a los roles indicados (AdminRole). Fail-closed → 403. */
function requireRole(...roles: AdminRole[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    const role = req.adminOperator?.role;
    if (!role || !roles.includes(role)) {
      res.status(403).json({ error: "forbidden", requiredRoles: roles });
      return;
    }
    next();
  };
}

// Todo lo que sigue requiere sesión válida.
adminRouter.use(adminGuard);

// Roles de mutación: owner/operator pueden escribir; viewer solo lee.
const canWrite = requireRole("owner", "operator");

function toTenantResponse(t: {
  id: string;
  name: string;
  slug: string;
  status: TenantResponse["status"];
  policies: TenantResponse["policies"];
  createdAt: string;
}): TenantResponse {
  return { id: t.id, name: t.name, slug: t.slug, status: t.status, policies: t.policies, createdAt: t.createdAt };
}

// ---- Tenants -------------------------------------------------------------- //

adminRouter.post("/tenants", canWrite, async (req: Request, res: Response) => {
  try {
    const { name, slug, policies } = req.body ?? {};
    if (!name || !slug) {
      res.status(400).json({ error: "name_and_slug_required" });
      return;
    }
    const tenant = await repos.tenants.create({ name, slug, policies: mergePolicy(policies) });
    await repos.auditLog.record({
      tenantId: tenant.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "tenant.created",
      detail: { slug },
      ip: req.ip ?? null,
    });
    res.status(201).json(toTenantResponse(tenant));
  } catch (e) {
    res.status(400).json({ error: "create_tenant_failed", detail: (e as Error).message });
  }
});

adminRouter.get("/tenants", async (_req: Request, res: Response) => {
  const tenants = await repos.tenants.list({ limit: 200 });
  res.json({ tenants: tenants.map(toTenantResponse) });
});

adminRouter.get("/tenants/:id", async (req: Request, res: Response) => {
  const t = await repos.tenants.getById(req.params.id);
  if (!t) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  res.json(toTenantResponse(t));
});

adminRouter.patch("/tenants/:id", canWrite, async (req: Request, res: Response) => {
  const existing = await repos.tenants.getById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const { name, status, policies } = req.body ?? {};
  const updated = await repos.tenants.update(req.params.id, {
    name,
    status,
    policies: policies ? mergePolicy({ ...existing.policies, ...policies }) : undefined,
  });
  res.json(toTenantResponse(updated!));
});

// ---- API keys ------------------------------------------------------------- //

adminRouter.post("/tenants/:id/api-keys", canWrite, async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const { label, scopes } = req.body ?? {};
  const gen = generateApiKey();
  const created = await repos.apiKeys.create({
    tenantId: tenant.id,
    keyHash: gen.hash,
    prefix: gen.prefix,
    label: label ?? "default",
    scopes: Array.isArray(scopes) ? scopes : ["sessions:read", "sessions:write"],
  });
  await repos.auditLog.record({
    tenantId: tenant.id,
    actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
    event: "apikey.created",
    detail: { keyId: created.id, prefix: gen.prefix },
    ip: req.ip ?? null,
  });
  // El secreto plano se devuelve UNA sola vez.
  const resp: CreateApiKeyResponse = {
    id: created.id,
    prefix: gen.prefix,
    apiKey: gen.plain,
    label: created.label,
    scopes: created.scopes,
    createdAt: created.createdAt,
  };
  res.status(201).json(resp);
});

adminRouter.get("/tenants/:id/api-keys", async (req: Request, res: Response) => {
  const keys = await repos.apiKeys.listByTenant(req.params.id);
  const resp: ApiKeyResponse[] = keys.map((k) => ({
    id: k.id,
    prefix: k.prefix,
    label: k.label,
    scopes: k.scopes,
    status: k.status,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  }));
  res.json({ apiKeys: resp });
});

adminRouter.delete("/tenants/:id/api-keys/:keyId", canWrite, async (req: Request, res: Response) => {
  const revoked = await repos.apiKeys.revoke(req.params.id, req.params.keyId);
  if (!revoked) {
    res.status(404).json({ error: "api_key_not_found" });
    return;
  }
  res.json({ id: revoked.id, status: revoked.status });
});

// ---- Revisión de sesiones ------------------------------------------------- //

adminRouter.get("/tenants/:id/sessions", async (req: Request, res: Response) => {
  const q = req.query;
  const { total, sessions } = await repos.sessions.listByTenant(req.params.id, {
    state: q.state ? (String(q.state) as SessionState) : undefined,
    limit: q.limit ? parseInt(String(q.limit), 10) : 50,
    offset: q.offset ? parseInt(String(q.offset), 10) : 0,
  });
  res.json({ total, sessions });
});

adminRouter.get("/tenants/:id/sessions/:sessionId", async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const session = await repos.sessions.getById(tenantId, req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  const [checks, consents, evidence] = await Promise.all([
    repos.checks.listBySession(tenantId, session.id),
    repos.consents.listBySession(tenantId, session.id),
    repos.evidence.listBySession(tenantId, session.id),
  ]);
  const resp: AdminSessionDetailResponse = {
    sessionId: session.id,
    tenantId,
    externalRef: session.externalRef,
    state: session.state,
    assuranceRequired: session.assuranceRequired,
    result: session.result,
    evidence: evidence.map((e) => ({ type: e.type, storagePath: e.storagePath, sha256: e.sha256 })),
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    checks: checks.map((c) => ({ type: c.type, score: c.score, passed: c.passed, detail: c.detail })),
    consents: consents.map((c) => ({ version: c.version, acceptedAt: c.acceptedAt, ip: c.ip })),
  };
  res.json(resp);
});

// ---- Métricas + export de auditoría -------------------------------------- //

adminRouter.get("/tenants/:id/metrics", async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const states: SessionState[] = [
    "created", "capturing", "processing", "verified",
    "rejected", "needs_recapture", "expired", "error",
  ];
  const byState = {} as Record<SessionState, number>;
  let total = 0;
  for (const st of states) {
    const r = await repos.sessions.listByTenant(tenantId, { state: st, limit: 1 });
    byState[st] = r.total;
    total += r.total;
  }
  const verified = byState.verified ?? 0;
  const decided = verified + (byState.rejected ?? 0);
  res.json({
    tenantId,
    sessionsTotal: total,
    approvalRate: decided > 0 ? verified / decided : 0,
    byState,
    latencyByModule: {}, // instrumentación de latencia por módulo: trabajo futuro
  });
});

adminRouter.get("/tenants/:id/audit", async (req: Request, res: Response) => {
  const entries = await repos.auditLog.listByTenant(req.params.id, {
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 500,
  });
  res.json({ entries });
});
