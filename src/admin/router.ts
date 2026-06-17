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
import { evidenceStore } from "../lib/evidenceStore";
import {
  generateApiKey,
  generateLinkToken,
  generateSessionToken,
  hashPassword,
  verifyPassword,
} from "../lib/crypto";
import { adminLoginRateLimiter } from "../lib/rateLimit";
import { mergePolicy } from "../lib/policy";
import { decodeBase64Image } from "../lib/images";
import { ensureRasterImage } from "../lib/raster";
import { computeChecks } from "../pipeline";
import { realPipelineDeps } from "../pipelineDeps";
import { decision as decideVerdict } from "../modules/decision";
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
  SessionState,
  TenantResponse,
} from "../types";

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

// ---- "Probar verificación" (test del operador) --------------------------- //
// Dos modos para que un operador pruebe el proceso al nivel L1/L2/L3 elegido:
//   POST /admin/test-verify            → sube 3 imágenes, corre el pipeline y devuelve
//                                        el resultado completo (sin cámara).
//   POST /admin/tenants/:id/test-session → crea una sesión al nivel elegido y devuelve
//                                        verifyUrl para abrir el flujo en vivo (cámara).
// Ambas son MUTACIONES (crean sesión / persisten checks) → canWrite (owner/operator).

// POST /admin/test-verify  {tenantId, assurance, selfie, front, back}
adminRouter.post("/test-verify", canWrite, async (req: Request, res: Response) => {
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

    // Sesión efímera REAL (con external_ref "admin-test:*" para distinguirla) al nivel
    // elegido: computeChecks persiste checks+evidencia+recortes y la deja en 'review'.
    const externalRef = `admin-test:${Date.now()}`;
    const ttlSec = tenant.policies.linkTokenTtlSeconds || 900;
    const created = await repos.sessions.create({
      tenantId: tenant.id,
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
      { ...created, state: "processing" },
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
  canWrite,
  async (req: Request, res: Response) => {
    try {
      const assurance = String(req.body?.assurance ?? "") as LoA;
      if (!TEST_LEVELS.has(assurance)) {
        res.status(400).json({ error: "valid_assurance_required" });
        return;
      }
      const tenant = await repos.tenants.getById(req.params.id);
      if (!tenant) {
        res.status(404).json({ error: "tenant_not_found" });
        return;
      }
      const linkToken = generateLinkToken();
      const ttlSec = tenant.policies.linkTokenTtlSeconds || 900;
      const created = await repos.sessions.create({
        tenantId: tenant.id,
        externalRef: `admin-test-live:${Date.now()}`,
        linkToken,
        callbackUrl: null,
        assuranceRequired: assurance,
        expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
      });
      await repos.auditLog.record({
        tenantId: tenant.id,
        sessionId: created.id,
        actor: `admin:${req.adminOperator?.operatorId ?? "?"}`,
        event: "admin.test_session",
        detail: { assurance },
        ip: req.ip ?? null,
      });
      res.status(201).json({
        sessionId: created.id,
        assurance,
        verifyUrl: `${PUBLIC_BASE_URL}/verify/${linkToken}`,
      });
    } catch (e) {
      res.status(500).json({ error: "test_session_failed", detail: (e as Error).message });
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

adminRouter.post("/ocr-debug", canWrite, async (req: Request, res: Response) => {
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
