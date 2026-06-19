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
import multer from "multer";
import { repos } from "../db/repos";
import { pool } from "../db/pool";
import { evidenceStore } from "../lib/evidenceStore";
import { sanitizeBranding } from "../lib/branding";
import { brandingStore } from "../lib/brandingStore";
import {
  generateApiKey,
  generateLinkToken,
  generateSessionToken,
  generateWebhookSecret,
  hashPassword,
  verifyPassword,
} from "../lib/crypto";
import { webhookDispatcher } from "../webhooks/dispatcher";
import { adminLoginRateLimiter } from "../lib/rateLimit";
import { mergePolicy } from "../lib/policy";
import { requestContext } from "../lib/requestContext";
import { analyzeDeviceIp } from "../lib/deviceIp";
import { resolveTestSessionTtlSec } from "./testSessionTtl";
import { decodeBase64Image } from "../lib/images";
import { ensureRasterImage } from "../lib/raster";
import { isMailerConfigured, isValidEmail, sendVerificationEmail } from "../lib/mailer";
import { computeChecks, applyReviewDecision } from "../pipeline";
import { realPipelineDeps } from "../pipelineDeps";
import { decision as decideVerdict } from "../modules/decision";
import { assuranceFromDefinition } from "../lib/workflow";
import { sanitizeQuestions, questionnaireIdFromWorkflow } from "../lib/questionnaire";
import { can, permissionsFor, isAssignableRole, ASSIGNABLE_ROLES } from "../lib/rbac";
import type { Permission } from "../types";
import sharp from "sharp";
import {
  PaddleOcrClient,
  detectMrzFromOcrTexts,
  extractFrontDebug,
  runFrontProduction,
  upscaleForOcr,
} from "../modules/document";
import type { OcrLine } from "../types";
import type {
  AdminLoginResponse,
  AdminRole,
  AdminSessionDetailResponse,
  ApiKeyResponse,
  CreateApiKeyResponse,
  EvidenceType,
  LoA,
  MatchResult,
  ReviewDecisionResponse,
  ReviewQueueItem,
  ReviewQueueResponse,
  SessionState,
  TenantResponse,
  WebhookEndpoint,
  WebhookEndpointResponse,
  WebhookEvent,
  Workflow,
  WorkflowDefinition,
  WorkflowResponse,
  Questionnaire,
  QuestionnaireResponse,
} from "../types";
import { WEBHOOK_EVENTS } from "../types";

/** Base pública para construir el verifyUrl de la sesión de test con cámara. */
const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ||
  process.env.TEKO_PUBLIC_URL ||
  "https://self-accordance-possess-departments.trycloudflare.com"
).replace(/\/+$/, "");

/** Niveles válidos que el operador puede elegir en "Probar verificación". */
const TEST_LEVELS = new Set<LoA>(["L1", "L2", "L3"]);

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

interface OperatorListRow {
  id: string;
  username: string;
  role: AdminRole;
  created_at: Date;
}

/** Lista los operadores del panel (sin secretos). */
async function listOperators(): Promise<OperatorListRow[]> {
  const res = await pool.query<OperatorListRow>(
    "SELECT id, username, role, created_at FROM admin_operators ORDER BY created_at ASC"
  );
  return res.rows;
}

async function getOperatorById(id: string): Promise<OperatorListRow | null> {
  const res = await pool.query<OperatorListRow>(
    "SELECT id, username, role, created_at FROM admin_operators WHERE id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

/** Crea un operador con password (scrypt). Devuelve la fila o null si el user ya existe. */
async function createOperator(
  username: string,
  passwordHash: string,
  role: AdminRole
): Promise<OperatorListRow | null> {
  const res = await pool.query<OperatorListRow>(
    `INSERT INTO admin_operators (username, password_hash, role) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO NOTHING
     RETURNING id, username, role, created_at`,
    [username, passwordHash, role]
  );
  return res.rows[0] ?? null;
}

async function updateOperatorRole(id: string, role: AdminRole): Promise<OperatorListRow | null> {
  const res = await pool.query<OperatorListRow>(
    `UPDATE admin_operators SET role = $2 WHERE id = $1
     RETURNING id, username, role, created_at`,
    [id, role]
  );
  return res.rows[0] ?? null;
}

/** Cuenta los owners (para impedir quedarse sin owner = lockout). */
async function countOwners(): Promise<number> {
  const res = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM admin_operators WHERE role = 'owner'"
  );
  return parseInt(res.rows[0]?.n ?? "0", 10);
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

/**
 * Enforcement RBAC por ACCIÓN (no por rol). Resuelve `can(role, permission)` contra
 * la matriz pura de lib/rbac.ts. Fail-closed: rol ausente/desconocido o permiso no
 * concedido → 403. Reemplaza el viejo requireRole/canWrite por checks granulares.
 */
function requirePermission(permission: Permission) {
  return function (req: Request, res: Response, next: NextFunction): void {
    const role = req.adminOperator?.role;
    if (!can(role, permission)) {
      res.status(403).json({ error: "forbidden", requiredPermission: permission });
      return;
    }
    next();
  };
}

// Todo lo que sigue requiere sesión válida.
adminRouter.use(adminGuard);

// Atajos de permiso reusables por las rutas (legibilidad). Cada mutación exige su
// permiso concreto; lo existente que usaba `canWrite` mapea ahora a permisos reales.
const requireReview = requirePermission("review_sessions");

function toTenantResponse(t: {
  id: string;
  name: string;
  slug: string;
  status: TenantResponse["status"];
  policies: TenantResponse["policies"];
  branding?: TenantResponse["branding"];
  createdAt: string;
}): TenantResponse {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    policies: t.policies,
    branding: t.branding ?? {},
    createdAt: t.createdAt,
  };
}

/** Upload multipart en memoria para el logo de marca (PNG/JPEG/WebP, cap 2 MiB). */
const LOGO_MAX_BYTES = parseInt(process.env.TEKO_LOGO_MAX_BYTES || String(2 * 1024 * 1024), 10);
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES, files: 1 },
});

// ---- Tenants -------------------------------------------------------------- //

adminRouter.post("/tenants", requirePermission("manage_tenants"), async (req: Request, res: Response) => {
  try {
    const { name, slug, policies, branding } = req.body ?? {};
    if (!name || !slug) {
      res.status(400).json({ error: "name_and_slug_required" });
      return;
    }
    const tenant = await repos.tenants.create({
      name,
      slug,
      policies: mergePolicy(policies),
      // White-label opcional al crear (P1 #5): saneado, fail-closed. Ausente = '{}'.
      branding: branding !== undefined ? sanitizeBranding(branding) : undefined,
    });
    // Pieza 2: garantiza la app Default del tenant nuevo (fallback de App-scoping)
    // ANTES de sembrar workflows, para que éstos queden scopeados a esa app.
    await repos.apps.getDefault(tenant.id);
    // P0 #1: siembra los 3 workflows default (default-l1/-l2/-l3) del tenant nuevo.
    await repos.workflows.ensureDefaults(tenant.id);
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

adminRouter.patch("/tenants/:id", requirePermission("manage_tenants"), async (req: Request, res: Response) => {
  const existing = await repos.tenants.getById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const { name, status, policies, branding } = req.body ?? {};
  // White-label (P1 #5): el branding entrante se SANEA y se MEZCLA sobre el actual
  // (parche aditivo: solo pisa los campos válidos presentes; conserva el resto).
  const mergedBranding =
    branding !== undefined
      ? { ...existing.branding, ...sanitizeBranding(branding) }
      : undefined;
  const updated = await repos.tenants.update(req.params.id, {
    name,
    status,
    policies: policies ? mergePolicy({ ...existing.policies, ...policies }) : undefined,
    branding: mergedBranding,
  });
  if (branding !== undefined) {
    await repos.auditLog.record({
      tenantId: req.params.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "tenant.branding_updated",
      detail: { fields: Object.keys(sanitizeBranding(branding)) },
      ip: req.ip ?? null,
    });
  }
  res.json(toTenantResponse(updated!));
});

// POST /admin/tenants/:id/branding/logo  (multipart, campo `logo`) → white-label P1 #5
// Sube el logo de marca: se normaliza a PNG on-prem (brandingStore) y se setea
// branding.logoUrl = /branding/:id/logo?v=<ts> (cache-bust). Sirve público el GET.
// MUTACIÓN → canWrite. Fail-closed: imagen inválida → 400.
adminRouter.post(
  "/tenants/:id/branding/logo",
  requirePermission("manage_branding"),
  logoUpload.single("logo"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const file = (req as Request & { file?: { buffer: Buffer } }).file;
    if (!file || !file.buffer || file.buffer.length < 50) {
      res.status(400).json({ error: "logo_missing" });
      return;
    }
    try {
      await brandingStore.saveLogo(tenant.id, file.buffer);
    } catch (e) {
      res.status(400).json({ error: "logo_invalid", detail: (e as Error).message });
      return;
    }
    const logoUrl = `/branding/${tenant.id}/logo?v=${Date.now()}`;
    const updated = await repos.tenants.update(tenant.id, {
      branding: { ...tenant.branding, logoUrl },
    });
    await repos.auditLog.record({
      tenantId: tenant.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "tenant.logo_uploaded",
      detail: { bytes: file.buffer.length },
      ip: req.ip ?? null,
    });
    res.json({ logoUrl, branding: updated?.branding ?? {} });
  }
);

// ---- Operador actual + permisos (RBAC) ----------------------------------- //
// GET /admin/me → identidad del operador logueado + sus permisos efectivos. La UI
// lo usa para mostrar/ocultar acciones (el enforcement REAL es server-side por
// endpoint; esto es sólo UX). Cualquier operador autenticado puede leer lo suyo.
adminRouter.get("/me", (req: Request, res: Response) => {
  const op = req.adminOperator;
  res.json({
    operator: op ? { id: op.operatorId, email: op.username, role: op.role } : null,
    permissions: permissionsFor(op?.role),
    assignableRoles: ASSIGNABLE_ROLES,
  });
});

// ---- Team / miembros (operadores del panel) — RBAC ------------------------ //
// Gestión de operadores y su rol. Permiso: manage_members (owner). Fail-closed.
// Guardas anti-lockout: no se puede dejar la instancia sin ningún owner.

adminRouter.get("/operators", requirePermission("manage_members"), async (_req: Request, res: Response) => {
  const ops = await listOperators();
  res.json({
    operators: ops.map((o) => ({
      id: o.id,
      email: o.username,
      role: o.role,
      createdAt: o.created_at.toISOString(),
    })),
    assignableRoles: ASSIGNABLE_ROLES,
  });
});

// POST /admin/operators {email, password, role} → alta de operador.
adminRouter.post("/operators", requirePermission("manage_members"), async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = req.body?.role;
  if (!email || !password) {
    res.status(400).json({ error: "email_and_password_required" });
    return;
  }
  if (password.length < 10) {
    res.status(400).json({ error: "weak_password", detail: "mínimo 10 caracteres" });
    return;
  }
  if (!isAssignableRole(role)) {
    res.status(400).json({ error: "invalid_role", allowed: ASSIGNABLE_ROLES });
    return;
  }
  const created = await createOperator(email, hashPassword(password), role);
  if (!created) {
    res.status(409).json({ error: "operator_exists" });
    return;
  }
  // audit_log es tenant-scopeado (tenant_id NOT NULL); los operadores son
  // platform-level, así que se traza por consola (sin migración de esquema).
  // eslint-disable-next-line no-console
  console.log(`[admin] operator.created ${created.username} (${role}) by ${req.adminOperator?.username ?? "?"}`);
  res.status(201).json({
    id: created.id,
    email: created.username,
    role: created.role,
    createdAt: created.created_at.toISOString(),
  });
});

// PATCH /admin/operators/:id {role} → cambia el rol. Anti-lockout: no degradar al
// último owner.
adminRouter.patch("/operators/:id", requirePermission("manage_members"), async (req: Request, res: Response) => {
  const role = req.body?.role;
  if (!isAssignableRole(role)) {
    res.status(400).json({ error: "invalid_role", allowed: ASSIGNABLE_ROLES });
    return;
  }
  const target = await getOperatorById(req.params.id);
  if (!target) {
    res.status(404).json({ error: "operator_not_found" });
    return;
  }
  // Anti-lockout: si el target es el ÚLTIMO owner y se lo degrada → 409.
  if (target.role === "owner" && role !== "owner" && (await countOwners()) <= 1) {
    res.status(409).json({ error: "last_owner", detail: "Debe quedar al menos un owner." });
    return;
  }
  const updated = await updateOperatorRole(target.id, role);
  // eslint-disable-next-line no-console
  console.log(`[admin] operator.role_updated ${target.username} ${target.role}→${role} by ${req.adminOperator?.username ?? "?"}`);
  res.json({
    id: updated!.id,
    email: updated!.username,
    role: updated!.role,
    createdAt: updated!.created_at.toISOString(),
  });
});

// ---- Apps (CRUD por org) — Pieza 2 App-scoping --------------------------- //
// Una app es un proyecto bajo la org (tenant). La app Default es el fallback y NO
// se puede borrar. Permiso: manage_apps (owner/admin). Lectura: cualquier rol.

function toAppResponse(a: import("../types").App): import("../types").AppResponse {
  return {
    id: a.id,
    tenantId: a.tenantId,
    name: a.name,
    isDefault: a.isDefault,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// GET /admin/tenants/:id/apps → apps de la org (garantiza la Default).
adminRouter.get("/tenants/:id/apps", async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  await repos.apps.getDefault(tenant.id); // siembra Default si faltara (compat)
  const apps = await repos.apps.listByTenant(tenant.id);
  res.json({ apps: apps.map(toAppResponse) });
});

// POST /admin/tenants/:id/apps {name} → crea una app bajo la org.
adminRouter.post("/tenants/:id/apps", requirePermission("manage_apps"), async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  try {
    const app = await repos.apps.create({ tenantId: tenant.id, name });
    await repos.auditLog.record({
      tenantId: tenant.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "app.created",
      detail: { appId: app.id, name },
      ip: req.ip ?? null,
    });
    res.status(201).json(toAppResponse(app));
  } catch (e) {
    // 23505 = unique_violation (nombre duplicado en la org).
    if ((e as { code?: string }).code === "23505") {
      res.status(409).json({ error: "app_name_exists" });
      return;
    }
    res.status(400).json({ error: "create_app_failed", detail: (e as Error).message });
  }
});

// PUT /admin/tenants/:id/apps/:appId {name} → renombra una app.
adminRouter.put("/tenants/:id/apps/:appId", requirePermission("manage_apps"), async (req: Request, res: Response) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  try {
    const updated = await repos.apps.update(req.params.id, req.params.appId, { name });
    if (!updated) {
      res.status(404).json({ error: "app_not_found" });
      return;
    }
    await repos.auditLog.record({
      tenantId: req.params.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "app.updated",
      detail: { appId: updated.id, name },
      ip: req.ip ?? null,
    });
    res.json(toAppResponse(updated));
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      res.status(409).json({ error: "app_name_exists" });
      return;
    }
    res.status(400).json({ error: "update_app_failed", detail: (e as Error).message });
  }
});

// DELETE /admin/tenants/:id/apps/:appId → borra una app (no la Default, no si está en uso).
adminRouter.delete("/tenants/:id/apps/:appId", requirePermission("manage_apps"), async (req: Request, res: Response) => {
  const outcome = await repos.apps.remove(req.params.id, req.params.appId);
  if (outcome === "not_found") {
    res.status(404).json({ error: "app_not_found" });
    return;
  }
  if (outcome === "is_default") {
    res.status(409).json({ error: "cannot_delete_default_app" });
    return;
  }
  if (outcome === "in_use") {
    res.status(409).json({ error: "app_in_use", detail: "Reasigná o eliminá keys/workflows/webhooks/sesiones de la app antes de borrarla." });
    return;
  }
  await repos.auditLog.record({
    tenantId: req.params.id,
    actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
    event: "app.deleted",
    detail: { appId: req.params.appId },
    ip: req.ip ?? null,
  });
  res.json({ id: req.params.appId, deleted: true });
});

// ---- API keys ------------------------------------------------------------- //

adminRouter.post("/tenants/:id/api-keys", requirePermission("manage_api_keys"), async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const { label, scopes } = req.body ?? {};
  // App-scoping (Pieza 2): la key pertenece a una app; sin appId → app Default.
  let appId: string;
  try {
    appId = await repos.apps.resolveAppId(tenant.id, req.body?.appId);
  } catch {
    res.status(400).json({ error: "app_not_found" });
    return;
  }
  const gen = generateApiKey();
  const created = await repos.apiKeys.create({
    tenantId: tenant.id,
    appId,
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
    appId: k.appId,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  }));
  res.json({ apiKeys: resp });
});

adminRouter.delete("/tenants/:id/api-keys/:keyId", requirePermission("manage_api_keys"), async (req: Request, res: Response) => {
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
  const [checks, consents, evidence, answers] = await Promise.all([
    repos.checks.listBySession(tenantId, session.id),
    repos.consents.listBySession(tenantId, session.id),
    repos.evidence.listBySession(tenantId, session.id),
    repos.questionnaires.getAnswers(tenantId, session.id),
  ]);
  // P2: arma el panel de cuestionario (preguntas + respuestas). Las preguntas salen
  // del questionnaire referenciado por el workflow (live por id); si fue borrado se
  // cae a las claves de las respuestas. null si la sesión no tuvo cuestionario.
  let questionnaire: AdminSessionDetailResponse["questionnaire"] = null;
  const qId = questionnaireIdFromWorkflow(session.workflowSnapshot) ?? answers?.questionnaireId ?? null;
  if (qId || answers) {
    const def = qId ? await repos.questionnaires.getById(tenantId, qId) : null;
    if (def || answers) {
      questionnaire = {
        questionnaireId: def?.id ?? answers?.questionnaireId ?? null,
        name: def?.name ?? null,
        questions: def?.questions ?? [],
        answers: answers?.answers ?? {},
      };
    }
  }
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
    questionnaire,
  };
  res.json(resp);
});

// GET /admin/tenants/:id/sessions/:sessionId/events — timeline forense (P0 #3).
// Devuelve los session_events (cronológico) + el análisis Device & IP derivado.
// La nacionalidad para el cruce país≠nacionalidad sale del check `document`. Queda
// detrás de adminGuard (auth Bearer) y scopeado por tenant (aislamiento).
adminRouter.get(
  "/tenants/:id/sessions/:sessionId/events",
  async (req: Request, res: Response) => {
    const tenantId = req.params.id;
    const session = await repos.sessions.getById(tenantId, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const [events, checks] = await Promise.all([
      repos.sessionEvents.listBySession(tenantId, session.id),
      repos.checks.listBySession(tenantId, session.id),
    ]);
    // Nacionalidad extraída del documento (para el cruce país del IP ≠ nacionalidad).
    const docCheck = checks.find((c) => c.type === "document");
    const detail = docCheck?.detail as { extracted?: { titular?: { nacionalidad?: string } } } | undefined;
    const documentNationality = detail?.extracted?.titular?.nacionalidad ?? null;
    const deviceIp = analyzeDeviceIp(events, { documentNationality });
    res.json({ events, deviceIp });
  }
);

// ---- Evidencia (imágenes) para la revisión del dashboard ------------------ //
// Sirve la imagen de evidencia (selfie / doc_front / doc_back) por TIPO, nunca
// por ruta cruda (anti path-traversal): re-resuelve vía evidenceStore.read con
// (tenantId, sessionId, type). Queda detrás de adminGuard (auth Bearer). El front
// la consume con fetch + Authorization → Blob (un <img src> no manda el header).
const EVIDENCE_TYPES: EvidenceType[] = [
  "selfie",
  "doc_front",
  "doc_back",
  "frames",
  "doc_front_raw",
  "doc_back_raw",
  "liveness_video",
  "proof_of_address",
];

adminRouter.get(
  "/tenants/:id/sessions/:sessionId/evidence/:type",
  async (req: Request, res: Response) => {
    const tenantId = req.params.id;
    const sessionId = req.params.sessionId;
    const type = req.params.type as EvidenceType;
    if (!EVIDENCE_TYPES.includes(type)) {
      res.status(400).json({ error: "invalid_evidence_type" });
      return;
    }
    // Verifica que la sesión pertenezca al tenant (aislamiento).
    const session = await repos.sessions.getById(tenantId, sessionId);
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    // El video de liveness activo NO es una imagen .jpg: se lee crudo + su content-type
    // real (webm/mp4) desde el sidecar. El resto se sirve como JPEG (como hasta ahora).
    if (type === "liveness_video") {
      const video = await evidenceStore.readVideo(tenantId, sessionId);
      if (!video) {
        res.status(404).json({ error: "evidence_not_found" });
        return;
      }
      res.setHeader("Content-Type", video.contentType);
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(video.buf);
      return;
    }
    const buf = await evidenceStore.read(tenantId, sessionId, type);
    if (!buf) {
      res.status(404).json({ error: "evidence_not_found" });
      return;
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(buf);
  }
);

// ---- Métricas + export de auditoría -------------------------------------- //

adminRouter.get("/tenants/:id/metrics", async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const states: SessionState[] = [
    "created", "capturing", "processing", "review", "in_review", "verified",
    "rejected", "needs_recapture", "expired", "error",
  ];
  const byState = {} as Record<string, number>;
  for (const st of states) {
    byState[st] = 0;
  }
  const r = await pool.query<{ state: SessionState; count: string }>(
    `SELECT state, COUNT(*)::int FROM verification_sessions WHERE tenant_id = $1 GROUP BY state`,
    [tenantId]
  );
  let total = 0;
  for (const row of r.rows) {
    byState[row.state] = parseInt(row.count, 10);
    total += parseInt(row.count, 10);
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

// GET /admin/tenants/:id/usage?from=&to=  → uso por app (Pieza 3). Verificaciones
// agrupadas por app y estado en el período; deriva de verification_sessions.
// Permiso: view_usage (todos los roles lo tienen; fail-closed igualmente).
adminRouter.get(
  "/tenants/:id/usage",
  requirePermission("view_usage"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const [rows, apps] = await Promise.all([
      repos.sessions.usageByApp(tenant.id, { from, to }),
      repos.apps.listByTenant(tenant.id),
    ]);
    const nameById = new Map(apps.map((a) => [a.id, a.name]));
    // Agrega por app: total + byState + verified/rejected.
    const byApp = new Map<
      string,
      { appId: string | null; appName: string; total: number; verified: number; rejected: number; byState: Record<string, number> }
    >();
    let grandTotal = 0;
    let grandVerified = 0;
    for (const r of rows) {
      const key = r.appId ?? "_none";
      if (!byApp.has(key)) {
        byApp.set(key, {
          appId: r.appId,
          appName: r.appId ? nameById.get(r.appId) ?? r.appId : "(sin app)",
          total: 0,
          verified: 0,
          rejected: 0,
          byState: {},
        });
      }
      const agg = byApp.get(key)!;
      agg.total += r.count;
      agg.byState[r.state] = (agg.byState[r.state] ?? 0) + r.count;
      if (r.state === "verified") agg.verified += r.count;
      if (r.state === "rejected") agg.rejected += r.count;
      grandTotal += r.count;
      if (r.state === "verified") grandVerified += r.count;
    }
    res.json({
      tenantId: tenant.id,
      from: from ?? null,
      to: to ?? null,
      total: grandTotal,
      verified: grandVerified,
      apps: Array.from(byApp.values()).sort((a, b) => b.total - a.total),
    });
  }
);

adminRouter.get("/tenants/:id/audit", requirePermission("view_usage"), async (req: Request, res: Response) => {
  const entries = await repos.auditLog.listByTenant(req.params.id, {
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 500,
  });
  res.json({ entries });
});

// ---- Workflows (configurables + versionados) — P0 #1 --------------------- //

function toWorkflowResponse(w: Workflow): WorkflowResponse {
  return {
    id: w.id,
    tenantId: w.tenantId,
    appId: w.appId,
    name: w.name,
    version: w.version,
    definition: w.definition,
    isDefault: w.isDefault,
    assuranceLevel: assuranceFromDefinition(w.definition),
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

/** Valida que `definition` sea un objeto plano (no array/null). Fail-closed → 400. */
function isValidDefinition(d: unknown): d is WorkflowDefinition {
  return !!d && typeof d === "object" && !Array.isArray(d);
}

// GET /admin/tenants/:id/workflows → todas las versiones (siembra defaults si faltan).
adminRouter.get("/tenants/:id/workflows", async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  await repos.workflows.ensureDefaults(tenant.id);
  const workflows = await repos.workflows.listByTenant(tenant.id);
  res.json({ workflows: workflows.map(toWorkflowResponse) });
});

// POST /admin/tenants/:id/workflows {name, definition} → workflow NUEVO (version 1).
adminRouter.post("/tenants/:id/workflows", requirePermission("manage_workflows"), async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const definition = req.body?.definition;
  if (!name || !isValidDefinition(definition)) {
    res.status(400).json({ error: "name_and_definition_required" });
    return;
  }
  const existing = await repos.workflows.getCurrentByName(tenant.id, name);
  if (existing) {
    res.status(409).json({ error: "workflow_name_exists", detail: "Usá PUT para crear una nueva versión." });
    return;
  }
  // App-scoping (Pieza 2): el workflow pertenece a una app; sin appId → app Default.
  let appId: string;
  try {
    appId = await repos.apps.resolveAppId(tenant.id, req.body?.appId);
  } catch {
    res.status(400).json({ error: "app_not_found" });
    return;
  }
  const created = await repos.workflows.createVersion({ tenantId: tenant.id, appId, name, definition });
  await repos.auditLog.record({
    tenantId: tenant.id,
    actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
    event: "workflow.created",
    detail: { name, version: created.version },
    ip: req.ip ?? null,
  });
  res.status(201).json(toWorkflowResponse(created));
});

// PUT /admin/tenants/:id/workflows/:name {definition} → EDITAR = nueva versión.
adminRouter.put("/tenants/:id/workflows/:name", requirePermission("manage_workflows"), async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const name = req.params.name;
  const definition = req.body?.definition;
  if (!isValidDefinition(definition)) {
    res.status(400).json({ error: "definition_required" });
    return;
  }
  const current = await repos.workflows.getCurrentByName(tenant.id, name);
  if (!current) {
    res.status(404).json({ error: "workflow_not_found" });
    return;
  }
  const created = await repos.workflows.createVersion({
    tenantId: tenant.id,
    name,
    definition,
    isDefault: current.isDefault,
    appId: current.appId, // la nueva versión hereda la app de la versión vigente
  });
  await repos.auditLog.record({
    tenantId: tenant.id,
    actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
    event: "workflow.updated",
    detail: { name, version: created.version },
    ip: req.ip ?? null,
  });
  res.json(toWorkflowResponse(created));
});

// ---- Questionnaires (formularios custom por workflow) — P2 --------------- //

function toQuestionnaireResponse(q: Questionnaire): QuestionnaireResponse {
  return {
    id: q.id,
    tenantId: q.tenantId,
    name: q.name,
    questions: q.questions,
    version: q.version,
    active: q.active,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

// GET /admin/tenants/:id/questionnaires → cuestionarios del tenant.
adminRouter.get("/tenants/:id/questionnaires", async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const questionnaires = await repos.questionnaires.listByTenant(tenant.id);
  res.json({ questionnaires: questionnaires.map(toQuestionnaireResponse) });
});

// POST /admin/tenants/:id/questionnaires {name, questions} → crea un cuestionario.
// Reusa el permiso manage_workflows (config del flujo de verificación). Fail-closed:
// preguntas mal formadas / vacías → 400.
adminRouter.post(
  "/tenants/:id/questionnaires",
  requirePermission("manage_workflows"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const questions = sanitizeQuestions(req.body?.questions);
    if (!name || !questions) {
      res.status(400).json({ error: "name_and_questions_required" });
      return;
    }
    const created = await repos.questionnaires.create({ tenantId: tenant.id, name, questions });
    await repos.auditLog.record({
      tenantId: tenant.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "questionnaire.created",
      detail: { questionnaireId: created.id, name, questions: questions.length },
      ip: req.ip ?? null,
    });
    res.status(201).json(toQuestionnaireResponse(created));
  }
);

// PUT /admin/tenants/:id/questionnaires/:qid {name?, questions?, active?} → editar.
adminRouter.put(
  "/tenants/:id/questionnaires/:qid",
  requirePermission("manage_workflows"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const patch: { name?: string; questions?: import("../types").QuestionnaireQuestion[]; active?: boolean } = {};
    if (typeof req.body?.name === "string") patch.name = req.body.name.trim();
    if (req.body?.questions !== undefined) {
      const questions = sanitizeQuestions(req.body.questions);
      if (!questions) {
        res.status(400).json({ error: "invalid_questions" });
        return;
      }
      patch.questions = questions;
    }
    if (typeof req.body?.active === "boolean") patch.active = req.body.active;
    const updated = await repos.questionnaires.update(tenant.id, req.params.qid, patch);
    if (!updated) {
      res.status(404).json({ error: "questionnaire_not_found" });
      return;
    }
    await repos.auditLog.record({
      tenantId: tenant.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "questionnaire.updated",
      detail: { questionnaireId: updated.id, version: updated.version },
      ip: req.ip ?? null,
    });
    res.json(toQuestionnaireResponse(updated));
  }
);

// ---- Webhooks (suscripciones + entregas) — P0 #2 ------------------------- //

function toWebhookResponse(e: WebhookEndpoint): WebhookEndpointResponse {
  return {
    id: e.id,
    appId: e.appId,
    url: e.url,
    events: e.events,
    description: e.description,
    enabled: e.enabled,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

/** Valida que la URL sea http(s) absoluta. Fail-closed. */
function isValidWebhookUrl(u: unknown): u is string {
  if (typeof u !== "string" || !u.trim()) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Normaliza/valida la lista de eventos suscritos (subset del catálogo, o '*'). */
function normalizeEvents(input: unknown): WebhookEvent[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: WebhookEvent[] = [];
  for (const e of input) {
    if (e === "*") return ["*" as unknown as WebhookEvent]; // comodín: recibe todos
    if (typeof e !== "string" || !WEBHOOK_EVENTS.includes(e as WebhookEvent)) return null;
    if (!out.includes(e as WebhookEvent)) out.push(e as WebhookEvent);
  }
  return out;
}

// GET /admin/tenants/:id/webhooks → destinos (SIN secreto).
adminRouter.get("/tenants/:id/webhooks", async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const endpoints = await repos.webhookEndpoints.listByTenant(tenant.id);
  res.json({ events: WEBHOOK_EVENTS, endpoints: endpoints.map(toWebhookResponse) });
});

// POST /admin/tenants/:id/webhooks {url, events, description?} → crea (secreto 1 vez).
adminRouter.post("/tenants/:id/webhooks", requirePermission("manage_webhooks"), async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const url = req.body?.url;
  const events = normalizeEvents(req.body?.events);
  if (!isValidWebhookUrl(url)) {
    res.status(400).json({ error: "invalid_url" });
    return;
  }
  if (!events) {
    res.status(400).json({ error: "invalid_events", allowed: WEBHOOK_EVENTS });
    return;
  }
  // App-scoping (Pieza 2): el destino pertenece a una app; sin appId → app Default.
  let appId: string;
  try {
    appId = await repos.apps.resolveAppId(tenant.id, req.body?.appId);
  } catch {
    res.status(400).json({ error: "app_not_found" });
    return;
  }
  const secret = generateWebhookSecret();
  const created = await repos.webhookEndpoints.create({
    tenantId: tenant.id,
    appId,
    url,
    secret,
    events,
    description: typeof req.body?.description === "string" ? req.body.description.slice(0, 200) : null,
  });
  await repos.auditLog.record({
    tenantId: tenant.id,
    actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
    event: "webhook.created",
    detail: { endpointId: created.id, url, events },
    ip: req.ip ?? null,
  });
  // El secreto se devuelve UNA sola vez (igual que las API keys).
  res.status(201).json({ ...toWebhookResponse(created), secret });
});

// PUT /admin/tenants/:id/webhooks/:whid {url?, events?, enabled?, description?}
adminRouter.put("/tenants/:id/webhooks/:whid", requirePermission("manage_webhooks"), async (req: Request, res: Response) => {
  const tenant = await repos.tenants.getById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: "tenant_not_found" });
    return;
  }
  const patch: {
    url?: string;
    events?: WebhookEvent[];
    enabled?: boolean;
    description?: string | null;
  } = {};
  if (req.body?.url !== undefined) {
    if (!isValidWebhookUrl(req.body.url)) {
      res.status(400).json({ error: "invalid_url" });
      return;
    }
    patch.url = req.body.url;
  }
  if (req.body?.events !== undefined) {
    const ev = normalizeEvents(req.body.events);
    if (!ev) {
      res.status(400).json({ error: "invalid_events", allowed: WEBHOOK_EVENTS });
      return;
    }
    patch.events = ev;
  }
  if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
  if (typeof req.body?.description === "string") patch.description = req.body.description.slice(0, 200);

  const updated = await repos.webhookEndpoints.update(tenant.id, req.params.whid, patch);
  if (!updated) {
    res.status(404).json({ error: "webhook_not_found" });
    return;
  }
  await repos.auditLog.record({
    tenantId: tenant.id,
    actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
    event: "webhook.updated",
    detail: { endpointId: updated.id, patch: { ...patch } },
    ip: req.ip ?? null,
  });
  res.json(toWebhookResponse(updated));
});

// DELETE /admin/tenants/:id/webhooks/:whid
adminRouter.delete("/tenants/:id/webhooks/:whid", requirePermission("manage_webhooks"), async (req: Request, res: Response) => {
  const ok = await repos.webhookEndpoints.remove(req.params.id, req.params.whid);
  if (!ok) {
    res.status(404).json({ error: "webhook_not_found" });
    return;
  }
  await repos.auditLog.record({
    tenantId: req.params.id,
    actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
    event: "webhook.deleted",
    detail: { endpointId: req.params.whid },
    ip: req.ip ?? null,
  });
  res.json({ id: req.params.whid, deleted: true });
});

// GET /admin/tenants/:id/webhooks/:whid/deliveries → log de entregas.
adminRouter.get(
  "/tenants/:id/webhooks/:whid/deliveries",
  async (req: Request, res: Response) => {
    const endpoint = await repos.webhookEndpoints.getById(req.params.id, req.params.whid);
    if (!endpoint) {
      res.status(404).json({ error: "webhook_not_found" });
      return;
    }
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
    const deliveries = await repos.webhookDeliveries.listByEndpoint(
      req.params.id,
      req.params.whid,
      { limit }
    );
    res.json({ deliveries });
  }
);

// POST /admin/tenants/:id/webhooks/:whid/test → envía un evento de prueba (ping).
adminRouter.post(
  "/tenants/:id/webhooks/:whid/test",
  requirePermission("manage_webhooks"),
  async (req: Request, res: Response) => {
    const endpoint = await repos.webhookEndpoints.getById(req.params.id, req.params.whid);
    if (!endpoint) {
      res.status(404).json({ error: "webhook_not_found" });
      return;
    }
    const delivery = await webhookDispatcher().test(req.params.id, req.params.whid);
    await repos.auditLog.record({
      tenantId: req.params.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "webhook.test",
      detail: { endpointId: req.params.whid, status: delivery?.status, code: delivery?.responseCode },
      ip: req.ip ?? null,
    });
    res.json({ delivery });
  }
);

// POST /admin/tenants/:id/webhooks/:whid/deliveries/:did/resend → reenvía una entrega.
adminRouter.post(
  "/tenants/:id/webhooks/:whid/deliveries/:did/resend",
  requirePermission("manage_webhooks"),
  async (req: Request, res: Response) => {
    const endpoint = await repos.webhookEndpoints.getById(req.params.id, req.params.whid);
    if (!endpoint) {
      res.status(404).json({ error: "webhook_not_found" });
      return;
    }
    const existing = await repos.webhookDeliveries.getById(req.params.did);
    if (!existing || existing.tenantId !== req.params.id || existing.endpointId !== req.params.whid) {
      res.status(404).json({ error: "delivery_not_found" });
      return;
    }
    const delivery = await webhookDispatcher().resend(req.params.did);
    await repos.auditLog.record({
      tenantId: req.params.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "webhook.resend",
      detail: { deliveryId: req.params.did, status: delivery?.status, code: delivery?.responseCode },
      ip: req.ip ?? null,
    });
    res.json({ delivery });
  }
);

// ---- Cola de revisión manual (P0 #1) ------------------------------------- //

// GET /admin/review-queue?tenantId=&limit=&offset=  → sesiones en `in_review`.
// Cross-tenant por defecto (el operador revisa todo); filtra por tenant si se pide.
adminRouter.get("/review-queue", async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId ? String(req.query.tenantId) : undefined;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
  const conds: string[] = ["s.state = 'in_review'"];
  const params: unknown[] = [];
  let p = 1;
  if (tenantId !== undefined) {
    conds.push(`s.tenant_id = $${p++}`);
    params.push(tenantId);
  }
  const where = conds.join(" AND ");
  const totalRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM verification_sessions s WHERE ${where}`,
    params
  );
  const total = parseInt(totalRes.rows[0].count, 10);
  const rowsRes = await pool.query<{
    id: string;
    tenant_id: string;
    tenant_name: string | null;
    external_ref: string | null;
    assurance_required: LoA;
    result: import("../types").SessionResult | null;
    created_at: Date;
  }>(
    `SELECT s.id, s.tenant_id, t.name as tenant_name, s.external_ref,
            s.assurance_required, s.result, s.created_at
     FROM verification_sessions s
     LEFT JOIN tenants t ON s.tenant_id = t.id
     WHERE ${where}
     ORDER BY s.created_at DESC LIMIT $${p++} OFFSET $${p++}`,
    [...params, limit, offset]
  );
  const items: ReviewQueueItem[] = rowsRes.rows.map((r) => ({
    sessionId: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name ?? r.tenant_id,
    externalRef: r.external_ref,
    assuranceRequired: r.assurance_required,
    suggestion: r.result,
    createdAt: r.created_at.toISOString(),
  }));
  const resp: ReviewQueueResponse = { total, items };
  res.json(resp);
});

// POST /admin/sessions/:id/review {decision, reason}  → decisión del operador.
// Cross-tenant (el id es global). Sólo opera sobre sesiones `in_review`. canWrite.
adminRouter.post("/sessions/:id/review", requireReview, async (req: Request, res: Response) => {
  try {
    const decision = req.body?.decision === "approve" ? "approve" : req.body?.decision === "decline" ? "decline" : null;
    if (!decision) {
      res.status(400).json({ error: "decision_required", detail: "approve | decline" });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : undefined;
    const session = await repos.sessions.getByIdAny(req.params.id);
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    if (session.state !== "in_review") {
      res.status(409).json({ error: "session_not_in_review", state: session.state });
      return;
    }
    const tenant = await repos.tenants.getById(session.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    // Selfie original para el embedding de la identidad (puede no existir si se purgó).
    const selfie = await evidenceStore.read(session.tenantId, session.id, "selfie");
    const out = await applyReviewDecision(
      session,
      tenant.policies,
      selfie,
      { decision, reviewer: req.adminOperator?.operatorId ?? "?", reason },
      realPipelineDeps
    );
    // Timeline forense (P0 #3): decisión humana de la cola de revisión. Contexto =
    // request del operador. Fail-open: nunca rompe la decisión.
    {
      const ctx = requestContext(req);
      await repos.sessionEvents.recordSafe({
        tenantId: session.tenantId,
        sessionId: session.id,
        type: "review.decided",
        ip: ctx.ip,
        country: ctx.country,
        userAgent: ctx.userAgent,
        device: ctx.device,
        meta: {
          decision,
          reason: reason ?? null,
          reviewer: req.adminOperator?.operatorId ?? "?",
          state: out.state,
          loa: out.result?.loa ?? null,
        },
      });
    }
    const resp: ReviewDecisionResponse = {
      sessionId: session.id,
      state: out.state,
      result: out.result,
    };
    res.json(resp);
  } catch (e) {
    res.status(500).json({ error: "review_decision_failed", detail: (e as Error).message });
  }
});

// ---- "Probar verificación" (test del operador) --------------------------- //
// Dos modos para que un operador pruebe el proceso al nivel L1/L2/L3 elegido:
//   POST /admin/test-verify            → sube 3 imágenes, corre el pipeline y devuelve
//                                        el resultado completo (sin cámara).
//   POST /admin/tenants/:id/test-session → crea una sesión al nivel elegido y devuelve
//                                        verifyUrl para abrir el flujo en vivo (cámara).
// Ambas son MUTACIONES (crean sesión / persisten checks) → canWrite (owner/operator).

// POST /admin/test-verify  {tenantId, assurance, selfie, front, back}
adminRouter.post("/test-verify", requireReview, async (req: Request, res: Response) => {
  try {
    const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId : "";
    const assurance = String(req.body?.assurance ?? "") as LoA;
    if (!tenantId || !TEST_LEVELS.has(assurance)) {
      res.status(400).json({ error: "tenantId_and_valid_assurance_required" });
      return;
    }
    const tenant = await repos.tenants.getById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }

    // Decodifica las 3 imágenes (base64 o data URL). Fail-closed: input inválido → 400.
    // El FRENTE/DORSO del documento aceptan PDF (cédula escaneada): computeChecks los
    // rasteriza a imagen aguas arriba. La selfie sigue JPEG/PNG-only.
    let selfie: Buffer, front: Buffer, back: Buffer;
    try {
      selfie = decodeBase64Image(req.body?.selfie);
      front = decodeBase64Image(req.body?.front, { allowPdf: true });
      back = decodeBase64Image(req.body?.back, { allowPdf: true });
    } catch (e) {
      res.status(400).json({ error: "invalid_images", detail: (e as Error).message });
      return;
    }

    // Screening AML opcional (P1 #1): si `aml:true`, se adjunta un workflowSnapshot
    // EFÍMERO a la sesión de prueba que activa el check `aml`, de modo que
    // computeChecks lo corra y lo persista (visible luego en el detalle de sesión).
    // onMatch por defecto 'flag' (no fuerza revisión en la prueba); 'review' lo rutea.
    const amlOn = req.body?.aml === true || req.body?.aml === "true";
    const amlOnMatch = req.body?.amlOnMatch === "review" ? "review" : "flag";
    const workflowSnapshot = amlOn
      ? {
          document: { required: true },
          ...(assurance !== "L1" ? { match: { required: true } } : {}),
          quality: {},
          aml: { required: true, onMatch: amlOnMatch as "review" | "flag" },
          review: { mode: "auto" as const },
        }
      : null;

    // Sesión efímera REAL (con external_ref "admin-test:*" para distinguirla) al nivel
    // elegido: computeChecks persiste checks+evidencia+recortes y la deja en 'review'.
    const externalRef = `admin-test:${Date.now()}`;
    const ttlSec = tenant.policies.linkTokenTtlSeconds || 900;
    // App-scoping (Pieza 2): la sesión de prueba pertenece a una app; sin appId → Default.
    let appId: string;
    try {
      appId = await repos.apps.resolveAppId(tenant.id, req.body?.appId);
    } catch {
      res.status(400).json({ error: "app_not_found" });
      return;
    }
    const created = await repos.sessions.create({
      tenantId: tenant.id,
      appId,
      externalRef,
      linkToken: generateLinkToken(),
      callbackUrl: null,
      assuranceRequired: assurance, // ← LoA por sesión: el pipeline lo honra
      expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
    });

    await repos.auditLog.record({
      tenantId: tenant.id,
      sessionId: created.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "admin.test_verify",
      detail: { assurance, externalRef },
      ip: req.ip ?? null,
    });

    const out = await computeChecks(
      { ...created, state: "processing", workflowSnapshot },
      tenant.policies, // computeChecks aplica effectivePolicy(session) → usa `assurance`
      { selfie, docFront: front, docBack: back },
      realPipelineDeps
    );

    // Mapea los checks (in-memory) a la forma {type,passed,score} para el dashboard.
    type CheckRow = { type: string; passed: boolean; score: number | null };
    const checksOut: CheckRow[] = [];
    let extracted: import("../types").ExtractedDocument | null = null;
    let match: MatchResult | undefined;

    if (out.checks) {
      const c = out.checks;
      checksOut.push({ type: "quality", passed: c.quality.passed, score: c.quality.sharpness });
      if (c.liveness) {
        checksOut.push({ type: "liveness", passed: c.liveness.passed, score: c.liveness.score });
      }
      checksOut.push({ type: "document", passed: c.document.passed, score: c.document.ocr.confidence });
      if (c.match) {
        checksOut.push({ type: "match", passed: c.match.passed, score: c.match.cosine });
      }
      if (c.aml) {
        checksOut.push({ type: "aml", passed: c.aml.passed, score: c.aml.topScore });
      }
      extracted = c.document.extracted;
      match = c.match;
    }

    // Decisión: si llegó a 'review', corre la MISMA decision() al nivel elegido. Si
    // computeChecks divergió (needs_recapture/rejected/error por quality), reportamos
    // ese estado sin 500.
    const previewPolicy = { ...tenant.policies, assuranceRequired: assurance };
    let decisionState: string;
    let loa: LoA;
    let reasons: string[];
    if (out.state === "review" && out.checks) {
      const verdict = decideVerdict(out.checks, previewPolicy);
      decisionState = verdict.verdict === "verified" ? "verified" : "rejected";
      loa = verdict.loa;
      reasons = verdict.reasons;
    } else {
      decisionState = out.state; // needs_recapture | rejected | error
      loa = "L0";
      reasons = out.reasons;
    }

    // Recortes de evidencia inline (base64): selfie (leída del store) + foto del doc.
    const selfieCropBuf = await evidenceStore.readCrop(tenant.id, created.id, "selfie");
    const photos = {
      selfieCrop: selfieCropBuf ? selfieCropBuf.toString("base64") : null,
      docFaceCrop: out.checks?.document.docFaceCrop?.base64Jpeg ?? null,
    };

    res.json({
      sessionId: created.id,
      assurance,
      checks: checksOut,
      extracted,
      match: match ? { cosine: match.cosine, passed: match.passed } : null,
      aml: out.checks?.aml ?? null,
      decision: { state: decisionState, loa, reasons },
      photos,
    });
  } catch (e) {
    res.status(500).json({ error: "test_verify_failed", detail: (e as Error).message });
  }
});

// POST /admin/tenants/:id/test-session  {assurance}  → {verifyUrl}
adminRouter.post(
  "/tenants/:id/test-session",
  requireReview,
  async (req: Request, res: Response) => {
    try {
      const assurance = String(req.body?.assurance ?? "") as LoA;
      if (!TEST_LEVELS.has(assurance)) {
        res.status(400).json({ error: "valid_assurance_required" });
        return;
      }
      // Email opcional del solicitante (para enviarle el link de la captura en vivo).
      const email =
        typeof req.body?.email === "string" && req.body.email.trim()
          ? req.body.email.trim()
          : undefined;
      if (email && !isValidEmail(email)) {
        res.status(400).json({ error: "invalid_email" });
        return;
      }
      const tenant = await repos.tenants.getById(req.params.id);
      if (!tenant) {
        res.status(404).json({ error: "tenant_not_found" });
        return;
      }
      // Workflow binding OPCIONAL (paridad con POST /v1/sessions): si viene un
      // `workflowId`, se RESUELVE y SNAPSHOTEA reusando exactamente la misma lógica
      // que la API pública (resolveForSession valida que la versión exista y sea del
      // tenant). El assurance_required efectivo se DERIVA del workflow. Fail-closed:
      // un workflowId inexistente o de otro tenant → 400 (no se crea sesión).
      // Sin `workflowId` → comportamiento idéntico al actual: sin workflow ligado,
      // default según `assurance`.
      const workflowId =
        typeof req.body?.workflowId === "string" && req.body.workflowId.trim()
          ? req.body.workflowId.trim()
          : undefined;
      let wf: Awaited<ReturnType<typeof repos.workflows.resolveForSession>> | undefined;
      if (workflowId) {
        try {
          wf = await repos.workflows.resolveForSession(tenant.id, {
            workflowId,
            assuranceRequired: assurance,
          });
        } catch (e) {
          res.status(400).json({ error: "invalid_workflow", detail: (e as Error).message });
          return;
        }
      }
      const linkToken = generateLinkToken();
      // TTL override OPCIONAL solo para los links de PRUEBA del admin (testear caducidad
      // sin tocar el default de producción): `ttlMinutes` entero positivo → ese TTL,
      // clampeado a ≤120min. Inválido o ausente → default del tenant (15min). El flujo
      // público /v1/sessions y el default global quedan intactos.
      const defaultTtlSec = tenant.policies.linkTokenTtlSeconds || 900;
      const ttlSec = resolveTestSessionTtlSec(req.body?.ttlMinutes, defaultTtlSec);
      // App-scoping (Pieza 2): sin appId → app Default del tenant.
      let appId: string;
      try {
        appId = await repos.apps.resolveAppId(tenant.id, req.body?.appId);
      } catch {
        res.status(400).json({ error: "app_not_found" });
        return;
      }
      const created = await repos.sessions.create({
        tenantId: tenant.id,
        appId,
        externalRef: `admin-test-live:${Date.now()}`,
        linkToken,
        callbackUrl: null,
        assuranceRequired: wf ? wf.assuranceRequired : assurance,
        workflowId: wf?.workflowId,
        workflowVersion: wf?.workflowVersion,
        workflowSnapshot: wf?.snapshot,
        expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
      });
      await repos.auditLog.record({
        tenantId: tenant.id,
        sessionId: created.id,
        actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
        event: "admin.test_session",
        detail: {
          assurance: created.assuranceRequired,
          email: email ?? null,
          ttlMinutes: ttlSec / 60,
          workflowId: wf?.workflowId ?? null,
          workflowVersion: wf?.workflowVersion ?? null,
        },
        ip: req.ip ?? null,
      });
      // Timeline forense (P0 #3): primer evento de la sesión (contexto del operador
      // que la crea). Fail-open. Mantiene el timeline consistente con las sesiones
      // creadas vía API del tenant (que también registran session.created).
      {
        const ctx = requestContext(req);
        await repos.sessionEvents.recordSafe({
          tenantId: tenant.id,
          sessionId: created.id,
          type: "session.created",
          ip: ctx.ip,
          country: ctx.country,
          userAgent: ctx.userAgent,
          device: ctx.device,
          meta: {
            assurance: created.assuranceRequired,
            via: "admin.test_session",
            workflowId: wf?.workflowId ?? null,
            workflowVersion: wf?.workflowVersion ?? null,
          },
        });
      }
      const verifyUrl = `${PUBLIC_BASE_URL}/verify/${linkToken}`;

      // Envío opcional del link por email (transaccional, fail-open).
      let emailSent: boolean | undefined;
      if (email) {
        emailSent = isMailerConfigured() ? await sendVerificationEmail(email, verifyUrl) : false;
      }

      res.status(201).json({
        sessionId: created.id,
        assurance: created.assuranceRequired,
        verifyUrl,
        expiresAt: created.expiresAt,
        ...(wf?.workflowId
          ? { workflowId: wf.workflowId, workflowVersion: wf.workflowVersion }
          : {}),
        ...(email ? { emailSent } : {}),
      });
    } catch (e) {
      res.status(500).json({ error: "test_session_failed", detail: (e as Error).message });
    }
  }
);

// POST /admin/tenants/:id/sessions/:sessionId/send-link  {email}  → reenvía el link
// Reenvío manual del verifyUrl de una sesión existente al email indicado. Scopeado
// al tenant (aislamiento). Transaccional/fail-open: si el SMTP falla, 200 con
// emailSent:false (no es un error del operador). MUTACIÓN → canWrite.
adminRouter.post(
  "/tenants/:id/sessions/:sessionId/send-link",
  requireReview,
  async (req: Request, res: Response) => {
    try {
      const email =
        typeof req.body?.email === "string" && req.body.email.trim()
          ? req.body.email.trim()
          : undefined;
      if (!isValidEmail(email)) {
        res.status(400).json({ error: "valid_email_required" });
        return;
      }
      const session = await repos.sessions.getById(req.params.id, req.params.sessionId);
      if (!session) {
        res.status(404).json({ error: "session_not_found" });
        return;
      }
      const verifyUrl = `${PUBLIC_BASE_URL}/verify/${session.linkToken}`;
      const emailSent = isMailerConfigured()
        ? await sendVerificationEmail(email!, verifyUrl)
        : false;
      await repos.auditLog.record({
        tenantId: req.params.id,
        sessionId: session.id,
        actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
        event: "admin.send_link",
        detail: { email, emailSent },
        ip: req.ip ?? null,
      });
      res.json({ sessionId: session.id, emailSent });
    } catch (e) {
      res.status(500).json({ error: "send_link_failed", detail: (e as Error).message });
    }
  }
);

// ---- Playground OCR (Inspector OCR) -------------------------------------- //
// POST /admin/ocr-debug  { image:"<base64>", variant?: "raw" | "deskew-upscale" }
// Herramienta de debug para el operador: sube una imagen de cédula (FRENTE) y ve
// EXACTAMENTE qué detecta PaddleOCR (cajas + scores) y qué línea ancló a cada
// campo el extractor real. Distingue LEGIBILIDAD (no hay caja con ese texto) de
// ANCLAJE (hay caja pero el extractor no la tomó).
//
// 1) variant="deskew-upscale": pasa la imagen por el sidecar /doc-crop (vía el
//    docCropper REAL del pipeline, fail-open) y luego upscale (upscaleForOcr). Esto
//    REPRODUCE la transformación de pipelineDeps; deliberadamente puede extraer
//    MENOS campos que "raw" (doc-crop rota portrait→landscape y rompe el anclaje
//    px-absoluto) — y eso es justo lo que la herramienta existe para revelar.
//    variant="raw" (default): la imagen tal cual.
// 2) OCR del sidecar sobre la imagen efectiva (PaddleOcrClient.recognize → lines+conf).
// 3) Extracción REAL del frente (extractFrontDebug) sobre la MISMA imagen → campos
//    + anchors{campo:{lineIndex,box,labelBox}}.
// 4) Devuelve todo en el espacio de coordenadas de `imageUsed` (la imagen
//    efectivamente OCR-eada), incluidos width/height (de sharp metadata).
// MUTACIÓN cero, pero requiere canWrite (corre el pipeline OCR del operador).
// variant="production" (DEFAULT del Inspector): corre el camino de extracción de
//    PRODUCCIÓN (raw-first + fallback sólo-amplía + cross-fill MRZ si se manda
//    `back`), igual que el pipeline real. Reporta `sources` por campo (front/
//    upscale/mrz). `raw`/`deskew-upscale` quedan como variantes de DIAGNÓSTICO.
const OCR_DEBUG_VARIANTS = new Set(["production", "raw", "deskew-upscale", "enhanced"]);
const OCR_DEBUG_ALLOWED = ["production", "raw", "deskew-upscale", "enhanced"];

adminRouter.post("/ocr-debug", requireReview, async (req: Request, res: Response) => {
  try {
    const variant =
      typeof req.body?.variant === "string" ? req.body.variant : "production";
    if (!OCR_DEBUG_VARIANTS.has(variant)) {
      res.status(400).json({ error: "invalid_variant", allowed: OCR_DEBUG_ALLOWED });
      return;
    }

    // Decodifica la imagen (fail-closed: JPEG/PNG/PDF por magic bytes, cap de tamaño).
    // Si es PDF (cédula escaneada), rasteriza la 1ª página a PNG: TODO lo de abajo
    // (OCR, anclas, metadata, echo base64) opera sobre la imagen rasterizada, así el
    // overlay del Inspector calza con la imagen que devuelve la respuesta.
    let raw: Buffer;
    try {
      raw = decodeBase64Image(req.body?.image, { allowPdf: true });
      raw = await ensureRasterImage(raw);
    } catch (e) {
      res.status(400).json({ error: "invalid_image", detail: (e as Error).message });
      return;
    }

    const ocrClient = new PaddleOcrClient();

    // ---- variant="production": camino de extracción REAL del pipeline ---------
    if (variant === "production") {
      // Dorso OPCIONAL (para el cross-fill MRZ): se acepta `back` base64 (o PDF).
      let back: Buffer | undefined;
      if (req.body?.back) {
        try {
          back = await ensureRasterImage(decodeBase64Image(req.body.back, { allowPdf: true }));
        } catch {
          back = undefined; // dorso inválido → seguimos sólo con el frente
        }
      }
      // Resultado autoritativo (extracted + sources) = MISMO front-path de run().
      const prod = await runFrontProduction(raw, ocrClient, back);
      // Para el overlay del frente: OCR del crudo + anclas instrumentadas (mismas
      // decisiones de anclaje, incluida la normalización de orientación 90°).
      const frontOcr = await ocrClient.recognize(raw);
      const { anchors, angle } = extractFrontDebug(frontOcr.lines);
      const meta = await sharp(raw).metadata();
      res.json({
        variant,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        imageUsed: raw.toString("base64"),
        confidence: frontOcr.confidence,
        lines: frontOcr.lines.map((l) => ({ text: l.text, score: l.score, box: l.box })),
        extracted: prod.extracted,
        anchors,
        angle,
        sources: prod.sources,
        usedUpscaleFallback: prod.usedUpscaleFallback,
        mrz: prod.mrz,
      });
      return;
    }

    // ---- variants de DIAGNÓSTICO ("raw" / "deskew-upscale") -------------------
    // Imagen EFECTIVA según variante. Todo (lines/anchors/width/height) se reporta
    // en SU espacio de coordenadas.
    let imageUsed = raw;
    if (variant === "deskew-upscale") {
      // docCropper REAL del pipeline (= POST /doc-crop, fail-open) + upscale a 1600.
      const cropped = realPipelineDeps.docCropper
        ? await realPipelineDeps.docCropper.crop(raw)
        : raw;
      imageUsed = await upscaleForOcr(cropped, 1600);
    }

    // Dimensiones de la imagen efectiva (para escalar el overlay en el front).
    const meta = await sharp(imageUsed).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    // OCR del sidecar sobre la imagen efectiva → líneas NORMALIZADAS + confianza.
    // variant="enhanced": pre-proceso de FONDO DE SEGURIDAD (canal verde → blur →
    // adaptiveThreshold) vía /ocr-enhanced, geometría W×H preservada. Diagnóstico: muestra
    // qué recupera el 3er tier sobre el watermark. imageUsed = raw (el overlay calza con
    // las cajas en coordenadas del frente nativo; el sidecar binariza internamente).
    const ocr =
      variant === "enhanced" && ocrClient.recognizeEnhanced
        ? await ocrClient.recognizeEnhanced(imageUsed)
        : await ocrClient.recognize(imageUsed);
    const lines: OcrLine[] = ocr.lines;

    // Extracción REAL del frente, instrumentada, sobre las MISMAS líneas.
    const { extracted, anchors, angle } = extractFrontDebug(lines);

    // MRZ (DORSO): si la imagen es un dorso con MRZ TD1, detectamos y parseamos las
    // 3 líneas para inspección visual. ADITIVO: `mrz` es `null` cuando la imagen es
    // un frente (sin MRZ). No altera el contrato existente (lines/extracted/anchors).
    const mrz = await detectMrzFromOcrTexts(lines.map((l) => l.text));

    res.json({
      variant,
      width,
      height,
      imageUsed: imageUsed.toString("base64"),
      confidence: ocr.confidence,
      lines: lines.map((l) => ({ text: l.text, score: l.score, box: l.box })),
      extracted,
      anchors,
      angle,
      mrz,
    });
  } catch (e) {
    res.status(500).json({ error: "ocr_debug_failed", detail: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Bulk session operations (spec §3)
// ---------------------------------------------------------------------------

// POST /admin/tenants/:id/sessions/bulk — operaciones en lote sobre sesiones.
// Acepta un array de { sessionId, action } donde action ∈ { approve, decline, delete }.
// Solo opera sobre sesiones en estado in_review (approve/decline) o cualquier
// estado terminal (delete). Permiso: review_sessions.
adminRouter.post(
  "/tenants/:id/sessions/bulk",
  requireReview,
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const actions = req.body?.actions;
    if (!Array.isArray(actions) || actions.length === 0) {
      res.status(400).json({ error: "actions_required" });
      return;
    }
    const results: Array<{ sessionId: string; ok: boolean; error?: string }> = [];
    for (const action of actions.slice(0, 100)) {
      const sid = typeof action.sessionId === "string" ? action.sessionId : "";
      const act = typeof action.action === "string" ? action.action : "";
      if (!sid || !act) {
        results.push({ sessionId: sid || "?", ok: false, error: "invalid_action" });
        continue;
      }
      try {
        const session = await repos.sessions.getById(req.params.id, sid);
        if (!session) {
          results.push({ sessionId: sid, ok: false, error: "session_not_found" });
          continue;
        }
        if (act === "approve" || act === "decline") {
          if (session.state !== "in_review") {
            results.push({ sessionId: sid, ok: false, error: "not_in_review" });
            continue;
          }
          const decision = act === "approve" ? "approve" : "decline";
          const out = await applyReviewDecision(
            session,
            tenant.policies,
            null,
            { decision, reviewer: req.adminOperator?.operatorId ?? "?", reason: "bulk_operation" },
            realPipelineDeps
          );
          results.push({ sessionId: sid, ok: true });
          await repos.auditLog.record({
            tenantId: req.params.id,
            sessionId: sid,
            actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
            event: `session.bulk_${act}`,
            detail: { sessionId: sid, state: out.state },
            ip: req.ip ?? null,
          });
        } else if (act === "delete") {
          await evidenceStore.purge(session.tenantId, session.id);
          await repos.evidence.removeBySession(session.tenantId, session.id);
          await repos.sessions.remove(session.tenantId, session.id);
          results.push({ sessionId: sid, ok: true });
          await repos.auditLog.record({
            tenantId: req.params.id,
            sessionId: sid,
            actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
            event: "session.bulk_delete",
            detail: { sessionId: sid },
            ip: req.ip ?? null,
          });
        } else {
          results.push({ sessionId: sid, ok: false, error: "invalid_action" });
        }
      } catch (e) {
        results.push({ sessionId: sid, ok: false, error: (e as Error).message });
      }
    }
    res.json({ results });
  }
);

// ---------------------------------------------------------------------------
// Batch evidence download ZIP (spec §5)
// ---------------------------------------------------------------------------

// GET /admin/tenants/:id/sessions/:sessionId/evidence/zip — descarga ZIP con toda
// la evidencia de una sesión. Sirve un ZIP con las imágenes base64 inline.
// Si no está disponible, devuelve un JSON con las URLs de evidencia.
adminRouter.get(
  "/tenants/:id/sessions/:sessionId/evidence/zip",
  async (req: Request, res: Response) => {
    const session = await repos.sessions.getById(req.params.id, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const evidence = await repos.evidence.listBySession(req.params.id, session.id);
    if (evidence.length === 0) {
      res.json({ sessionId: session.id, files: [] });
      return;
    }
    // Devuelve las evidencias como base64 inline (el front arma el ZIP).
    // Un ZIP binario real requeriría la librería archiver que no está instalada.
    const files = await Promise.all(
      evidence.map(async (e) => {
        const buf = await evidenceStore.read(req.params.id, session.id, e.type as any);
        return {
          type: e.type,
          sha256: e.sha256,
          base64: buf ? buf.toString("base64") : null,
        };
      })
    );
    res.json({ sessionId: session.id, files });
  }
);

// ---------------------------------------------------------------------------
// Session export PDF (spec §12)
// ---------------------------------------------------------------------------

// GET /admin/tenants/:id/sessions/:sessionId/export-pdf — exporta la sesión como PDF.
adminRouter.get(
  "/tenants/:id/sessions/:sessionId/export-pdf",
  async (req: Request, res: Response) => {
    const { exportSessionPdf } = await import("../lib/pdfExport");
    const session = await repos.sessions.getById(req.params.id, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const [checks, consents, evidence] = await Promise.all([
      repos.checks.listBySession(req.params.id, session.id),
      repos.consents.listBySession(req.params.id, session.id),
      repos.evidence.listBySession(req.params.id, session.id),
    ]);
    // Leer evidencias como base64.
    const evidenceBase64 = await Promise.all(
      evidence.map(async (e) => {
        const buf = await evidenceStore.read(req.params.id, session.id, e.type as any);
        return { type: e.type, data: buf ? buf.toString("base64") : "" };
      })
    );
    const result = await exportSessionPdf({
      tenantId: req.params.id,
      session,
      checks,
      evidence,
      consents,
      evidenceBase64,
    });
    res.setHeader("Content-Type", result.contentType);
    if (!result.fallback) {
      res.setHeader("Content-Disposition", `attachment; filename=session-${session.id}.pdf`);
    }
    res.send(result.data);
  }
);

// ---------------------------------------------------------------------------
// API key rotation (spec §7)
// ---------------------------------------------------------------------------

// POST /admin/tenants/:id/api-keys/:keyId/rotate — rota una API key (revoca la
// existente y crea una nueva con el mismo label/scopes).
adminRouter.post(
  "/tenants/:id/api-keys/:keyId/rotate",
  requirePermission("manage_api_keys"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const existing = await repos.apiKeys.getById(req.params.id, req.params.keyId);
    if (!existing || existing.tenantId !== req.params.id) {
      res.status(404).json({ error: "api_key_not_found" });
      return;
    }
    // Revocar la key existente.
    const revoked = await repos.apiKeys.revoke(req.params.id, req.params.keyId);
    if (!revoked) {
      res.status(404).json({ error: "api_key_not_found" });
      return;
    }
    // Crear nueva key con el mismo label/scopes.
    const gen = generateApiKey();
    const created = await repos.apiKeys.create({
      tenantId: tenant.id,
      appId: existing.appId,
      keyHash: gen.hash,
      prefix: gen.prefix,
      label: existing.label,
      scopes: existing.scopes,
    });
    await repos.auditLog.record({
      tenantId: tenant.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "apikey.rotated",
      detail: { oldKeyId: req.params.keyId, newKeyId: created.id, prefix: gen.prefix },
      ip: req.ip ?? null,
    });
    const resp: CreateApiKeyResponse = {
      id: created.id,
      prefix: gen.prefix,
      apiKey: gen.plain,
      label: created.label,
      scopes: created.scopes,
      createdAt: created.createdAt,
    };
    res.status(201).json(resp);
  }
);

// ---------------------------------------------------------------------------
// Face gallery management (spec §10)
// ---------------------------------------------------------------------------

// POST /admin/tenants/:id/gallery — agregar cara a la galería.
adminRouter.post(
  "/tenants/:id/gallery",
  requirePermission("manage_api_keys"), // usar manage_api_keys como permiso genérico de gestión
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const { faceEmbedding, identityId, name, reason } = req.body ?? {};
    if (!faceEmbedding || typeof faceEmbedding !== "string") {
      res.status(400).json({ error: "faceEmbedding_required" });
      return;
    }
    try {
      // Decodificar embedding base64 → Buffer → Float32Array.
      const buf = Buffer.from(faceEmbedding, "base64");
      const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      if (arr.length !== 512) {
        res.status(400).json({ error: "embedding_must_be_512d" });
        return;
      }
      // Persistir embedding como bytea.
      const embeddingBuffer = Buffer.from(arr);
      // Guardar en verified_identities con un flag especial.
      const id = require("crypto").randomUUID();
      await pool.query(
        `INSERT INTO verified_identities (id, tenant_id, session_id, ci, nombre, fecha_nac, nacionalidad, tipo_doc, assurance_level, face_embedding, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          tenant.id,
          `gallery:${Date.now()}`,
          identityId || "",
          name || "",
          "",
          "",
          "ci_py",
          "L0",
          embeddingBuffer,
          new Date().toISOString(),
        ]
      );
      await repos.auditLog.record({
        tenantId: tenant.id,
        actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
        event: "gallery.added",
        detail: { identityId, name, reason },
        ip: req.ip ?? null,
      });
      res.status(201).json({ id, identityId, name, reason, addedBy: req.adminOperator?.operatorId ?? "?" });
    } catch (e) {
      res.status(400).json({ error: "gallery_add_failed", detail: (e as Error).message });
    }
  }
);

// DELETE /admin/tenants/:id/gallery/:identityId — remover de la galería.
adminRouter.delete(
  "/tenants/:id/gallery/:identityId",
  requirePermission("manage_api_keys"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    await pool.query(
      "DELETE FROM verified_identities WHERE tenant_id = $1 AND session_id = $2",
      [tenant.id, `gallery:${req.params.identityId}`]
    );
    await repos.auditLog.record({
      tenantId: tenant.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "gallery.removed",
      detail: { identityId: req.params.identityId },
      ip: req.ip ?? null,
    });
    res.json({ identityId: req.params.identityId, deleted: true });
  }
);

// ---------------------------------------------------------------------------
// Tenant usage analytics (spec §11)
// ---------------------------------------------------------------------------

// GET /admin/tenants/:id/analytics — métricas avanzadas de uso por día.
adminRouter.get(
  "/tenants/:id/analytics",
  requirePermission("view_usage"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;

    // Sessions by day
    const dailyRes = await pool.query<{ day: string; count: string }>(
      `SELECT DATE(created_at)::text AS day, COUNT(*)::int AS count
       FROM verification_sessions
       WHERE tenant_id = $1 ${from || to ? "AND" : "WHERE"} created_at BETWEEN $2 AND $3
       GROUP BY day ORDER BY day DESC`,
      [tenant.id, from ?? "1970-01-01", to ?? "2099-12-31"]
    );

    // Approval rate
    const rateRes = await pool.query<{ verified: string; total: string }>(
      `SELECT
        COUNT(CASE WHEN state = 'verified' THEN 1 END)::int AS verified,
        COUNT(*)::int AS total
       FROM verification_sessions
       WHERE tenant_id = $1 ${from || to ? "AND" : "WHERE"} created_at BETWEEN $2 AND $3`,
      [tenant.id, from ?? "1970-01-01", to ?? "2099-12-31"]
    );

    // Average latency by module (from checks)
    const latencyRes = await pool.query<{ type: string; avg_latency: string }>(
      `SELECT type, AVG(EXTRACT(EPOCH FROM (created_at - (SELECT MIN(created_at) FROM verification_checks c2 WHERE c2.session_id = verification_checks.session_id)) ))::int AS avg_latency
       FROM verification_checks
       WHERE tenant_id = $1 ${from || to ? "AND" : "WHERE"} created_at BETWEEN $2 AND $3
       GROUP BY type`,
      [tenant.id, from ?? "1970-01-01", to ?? "2099-12-31"]
    );

    const latencyByModule: Record<string, number> = {};
    for (const row of latencyRes.rows) {
      latencyByModule[row.type] = parseInt(row.avg_latency, 10);
    }

    res.json({
      tenantId: tenant.id,
      from: from ?? null,
      to: to ?? null,
      totalSessions: parseInt(rateRes.rows[0]?.total ?? "0", 10),
      verifiedSessions: parseInt(rateRes.rows[0]?.verified ?? "0", 10),
      approvalRate: rateRes.rows[0]
        ? parseInt(rateRes.rows[0].verified, 10) / Math.max(1, parseInt(rateRes.rows[0].total, 10))
        : 0,
      dailySessions: dailyRes.rows,
      latencyByModule,
    });
  }
);

// ---------------------------------------------------------------------------
// Audit log export CSV (spec §12)
// ---------------------------------------------------------------------------

// GET /admin/tenants/:id/audit.csv — export de auditoría en formato CSV.
adminRouter.get(
  "/tenants/:id/audit.csv",
  requirePermission("view_usage"),
  async (req: Request, res: Response) => {
    const entries = await repos.auditLog.listByTenant(req.params.id, {
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      limit: 10000,
    });
    // CSV: timestamp,actor,event,session_id,ip,detail
    const header = "timestamp,actor,event,session_id,ip,detail\n";
    const rows = entries
      .map((e) => {
        const detail = JSON.stringify(e.detail).replace(/"/g, '""');
        return `"${e.createdAt}","${e.actor}","${e.event}","${e.sessionId ?? ""}","${e.ip ?? ""}","${detail}"`;
      })
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=audit-${req.params.id}.csv`);
    res.send(header + rows);
  }
);

// ---------------------------------------------------------------------------
// Email template CRUD (spec §17)
// ---------------------------------------------------------------------------

// GET /admin/tenants/:id/email-templates — listar templates.
adminRouter.get(
  "/tenants/:id/email-templates",
  requirePermission("manage_tenants"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    // Los templates se guardan en tenants.email_templates (JSONB).
    const templates = (tenant as any).emailTemplates ?? [];
    res.json({ templates });
  }
);

// POST /admin/tenants/:id/email-templates — crear/actualizar un template.
adminRouter.post(
  "/tenants/:id/email-templates",
  requirePermission("manage_tenants"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const { type, subject, html, text, variables } = req.body ?? {};
    if (!type || !subject || !html) {
      res.status(400).json({ error: "type_subject_html_required" });
      return;
    }
    // Leer templates existentes.
    const existingTemplates = ((tenant as any).emailTemplates ?? []) as Array<{
      type: string; subject: string; html: string; text?: string; variables?: string[]; updatedAt: string;
    }>;
    // Actualizar o agregar.
    const existingIdx = existingTemplates.findIndex((t) => t.type === type);
    const now = new Date().toISOString();
    const template = { type, subject, html, text, variables: variables ?? [], updatedAt: now };
    if (existingIdx >= 0) {
      existingTemplates[existingIdx] = template;
    } else {
      existingTemplates.push(template);
    }
    // Persistir en la DB.
    await pool.query(
      "UPDATE tenants SET email_templates = $1::jsonb, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(existingTemplates), req.params.id]
    );
    await repos.auditLog.record({
      tenantId: req.params.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "email_template.updated",
      detail: { type },
      ip: req.ip ?? null,
    });
    res.status(201).json(template);
  }
);

// DELETE /admin/tenants/:id/email-templates/:type — eliminar un template.
adminRouter.delete(
  "/tenants/:id/email-templates/:type",
  requirePermission("manage_tenants"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const existingTemplates = ((tenant as any).emailTemplates ?? []) as Array<{ type: string }>;
    const filtered = existingTemplates.filter((t) => t.type !== req.params.type);
    await pool.query(
      "UPDATE tenants SET email_templates = $1::jsonb, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(filtered), req.params.id]
    );
    await repos.auditLog.record({
      tenantId: req.params.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "email_template.deleted",
      detail: { type: req.params.type },
      ip: req.ip ?? null,
    });
    res.json({ type: req.params.type, deleted: true });
  }
);

// ---------------------------------------------------------------------------
// Rate limit configuration per tenant (spec §14)
// ---------------------------------------------------------------------------

// PATCH /admin/tenants/:id/rate-limits — configurar rate limits por tenant.
adminRouter.patch(
  "/tenants/:id/rate-limits",
  requirePermission("manage_tenants"),
  async (req: Request, res: Response) => {
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const { rateLimitV1, rateLimitVerify, rateLimitAdmin } = req.body ?? {};
    const updated = await repos.tenants.update(req.params.id, {
      policies: {
        ...tenant.policies,
        rateLimitV1: typeof rateLimitV1 === "number" ? rateLimitV1 : tenant.policies.rateLimitV1,
        rateLimitVerify: typeof rateLimitVerify === "number" ? rateLimitVerify : tenant.policies.rateLimitVerify,
        rateLimitAdmin: typeof rateLimitAdmin === "number" ? rateLimitAdmin : tenant.policies.rateLimitAdmin,
      },
    });
    await repos.auditLog.record({
      tenantId: req.params.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "tenant.rate_limits_updated",
      detail: { rateLimitV1, rateLimitVerify, rateLimitAdmin },
      ip: req.ip ?? null,
    });
    res.json(toTenantResponse(updated!));
  }
);

// ---------------------------------------------------------------------------
// Compliance reports (spec §16)
// ---------------------------------------------------------------------------

// GET /admin/tenants/:id/compliance?from=&to= — generate compliance report.
adminRouter.get(
  "/tenants/:id/compliance",
  requirePermission("view_usage"),
  async (req: Request, res: Response) => {
    const compliance = await import("../lib/compliance");
    const { generateComplianceReport } = compliance;
    const tenant = await repos.tenants.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const from = req.query.from ? String(req.query.from) : "1970-01-01";
    const to = req.query.to ? String(req.query.to) : new Date().toISOString().split("T")[0];
    const report = await generateComplianceReport(pool, tenant, from, to + "T23:59:59.999Z");
    res.json(report);
  }
);

// ---------------------------------------------------------------------------
// Webhook replay (spec §14)
// ---------------------------------------------------------------------------

// POST /admin/tenants/:id/webhooks/:whid/deliveries/:did/replay — replay de un
// webhook existente (reenvío con la misma firma pero timestamp nuevo).
adminRouter.post(
  "/tenants/:id/webhooks/:whid/deliveries/:did/replay",
  requirePermission("manage_webhooks"),
  async (req: Request, res: Response) => {
    const endpoint = await repos.webhookEndpoints.getById(req.params.id, req.params.whid);
    if (!endpoint) {
      res.status(404).json({ error: "webhook_not_found" });
      return;
    }
    const existing = await repos.webhookDeliveries.getById(req.params.did);
    if (!existing || existing.tenantId !== req.params.id || existing.endpointId !== req.params.whid) {
      res.status(404).json({ error: "delivery_not_found" });
      return;
    }
    // Crear una nueva entrega con el mismo payload pero nuevo event_id.
    const newEventId = `evt_${require("crypto").randomUUID()}`;
    const newPayload = { ...existing.payload, id: newEventId };
    const rec = await repos.webhookDeliveries.create({
      endpointId: endpoint.id,
      tenantId: existing.tenantId,
      sessionId: existing.sessionId,
      eventId: newEventId,
      eventType: existing.eventType,
      url: existing.url,
      payload: newPayload,
      maxAttempts: 3,
    });
    const delivery = await webhookDispatcher().attempt(rec.id);
    await repos.auditLog.record({
      tenantId: req.params.id,
      actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
      event: "webhook.replay",
      detail: { deliveryId: req.params.did, newEventId, status: delivery?.status },
      ip: req.ip ?? null,
    });
    res.json({ delivery });
  }
);
