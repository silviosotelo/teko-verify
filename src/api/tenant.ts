/**
 * API del tenant (Bearer API key) — §8.A.
 *
 *   POST   /v1/sessions        crea verificación → {sessionId, verificationUrl, expiresAt}
 *   GET    /v1/sessions/:id     estado + resultado
 *   GET    /v1/sessions         listado con filtros
 *   DELETE /v1/sessions/:id     borrado de evidencia/identidad (derecho a supresión §12)
 *
 * Todo scopeado al tenant derivado de la API key (authenticateTenant). Idempotencia
 * de creación por external_ref (§9).
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { repos } from "../db/repos";
import { authenticateTenant } from "./auth";
import { generateLinkToken } from "../lib/crypto";
import { evidenceStore } from "../lib/evidenceStore";
import { isMailerConfigured, isValidEmail, sendVerificationEmail } from "../lib/mailer";
import type {
  CreateSessionResponse,
  DeleteSessionResponse,
  ListSessionsResponse,
  SessionStatusResponse,
  VerificationSession,
} from "../types";

// Base pública del verifyUrl. Se prioriza PUBLIC_BASE_URL (el que setea el compose
// del 34 con el dominio estable) y se cae a TEKO_PUBLIC_URL por compatibilidad. Sin
// esta precedencia, el link emitido/enviado por email apuntaba a localhost.
const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ||
  process.env.TEKO_PUBLIC_URL ||
  "http://localhost:4400"
).replace(/\/+$/, "");

function verificationUrl(token: string): string {
  return `${PUBLIC_BASE_URL}/verify/${token}`;
}

async function toStatus(s: VerificationSession): Promise<SessionStatusResponse> {
  const evidence = await repos.evidence.listBySession(s.tenantId, s.id);
  return {
    sessionId: s.id,
    externalRef: s.externalRef,
    state: s.state,
    assuranceRequired: s.assuranceRequired,
    result: s.result,
    evidence: evidence.map((e) => ({ type: e.type, storagePath: e.storagePath, sha256: e.sha256 })),
    createdAt: s.createdAt,
    completedAt: s.completedAt,
  };
}

export const tenantRouter = Router();
tenantRouter.use(authenticateTenant);

// POST /v1/sessions
tenantRouter.post("/sessions", async (req: Request, res: Response) => {
  const { tenant } = req.tenantCtx!;
  try {
    const body = req.body ?? {};
    const externalRef: string | undefined = body.externalRef;

    // Email opcional del solicitante: si viene, se valida formato (fail-closed en
    // input) y, tras crear la sesión, se le envía el verifyUrl (fail-open en envío).
    const email: string | undefined =
      typeof body.email === "string" && body.email.trim() ? body.email.trim() : undefined;
    if (email && !isValidEmail(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }

    // Idempotencia (§9): si ya existe (tenant, external_ref) devolvemos la misma sesión.
    if (externalRef) {
      const existing = await repos.sessions.findByExternalRef(tenant.id, externalRef);
      if (existing) {
        const url = verificationUrl(existing.linkToken);
        // Reenvío fail-open del link a quien lo pida de nuevo con email.
        if (email && isMailerConfigured()) await sendVerificationEmail(email, url);
        const resp: CreateSessionResponse = {
          sessionId: existing.id,
          verificationUrl: url,
          expiresAt: existing.expiresAt,
        };
        res.status(200).json(resp);
        return;
      }
    }

    const assuranceRequired = body.assuranceRequired ?? tenant.policies.assuranceRequired;
    const ttlSec = tenant.policies.linkTokenTtlSeconds || 900;
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
    const linkToken = generateLinkToken();

    const session = await repos.sessions.create({
      tenantId: tenant.id,
      externalRef: externalRef ?? null,
      linkToken,
      callbackUrl: body.callbackUrl ?? null,
      assuranceRequired,
      redirectUrl: body.redirectUrl ?? null,
      locale: body.locale,
      expiresAt,
    });

    await repos.auditLog.record({
      tenantId: tenant.id,
      sessionId: session.id,
      actor: `tenant:${req.tenantCtx!.apiKey.id}`,
      event: "session.created",
      detail: { externalRef: externalRef ?? null, assuranceRequired },
      ip: req.ip ?? null,
    });

    const url = verificationUrl(linkToken);

    // Envío del link por email (transaccional, fail-open): NUNCA rompe la creación.
    if (email && isMailerConfigured()) await sendVerificationEmail(email, url);

    const resp: CreateSessionResponse = {
      sessionId: session.id,
      verificationUrl: url,
      expiresAt: session.expiresAt,
    };
    res.status(201).json(resp);
  } catch (e) {
    res.status(400).json({ error: "create_session_failed", detail: (e as Error).message });
  }
});

// GET /v1/sessions/:id
tenantRouter.get("/sessions/:id", async (req: Request, res: Response) => {
  const { tenant } = req.tenantCtx!;
  const session = await repos.sessions.getById(tenant.id, req.params.id);
  if (!session) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  res.json(await toStatus(session));
});

// GET /v1/sessions
tenantRouter.get("/sessions", async (req: Request, res: Response) => {
  const { tenant } = req.tenantCtx!;
  const q = req.query;
  const { total, sessions } = await repos.sessions.listByTenant(tenant.id, {
    state: q.state ? (String(q.state) as VerificationSession["state"]) : undefined,
    externalRef: q.externalRef ? String(q.externalRef) : undefined,
    from: q.from ? String(q.from) : undefined,
    to: q.to ? String(q.to) : undefined,
    limit: q.limit ? parseInt(String(q.limit), 10) : 50,
    offset: q.offset ? parseInt(String(q.offset), 10) : 0,
  });
  const resp: ListSessionsResponse = {
    total,
    limit: q.limit ? parseInt(String(q.limit), 10) : 50,
    offset: q.offset ? parseInt(String(q.offset), 10) : 0,
    sessions: await Promise.all(sessions.map(toStatus)),
  };
  res.json(resp);
});

// DELETE /v1/sessions/:id  (derecho a supresión §12)
tenantRouter.delete("/sessions/:id", async (req: Request, res: Response) => {
  const { tenant } = req.tenantCtx!;
  const session = await repos.sessions.getById(tenant.id, req.params.id);
  if (!session) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  // Borra ficheros de evidencia y la fila de sesión (CASCADE arrastra checks/identity/evidence/consents).
  await evidenceStore.purge(tenant.id, session.id);
  const deleted = await repos.sessions.remove(tenant.id, session.id);
  await repos.auditLog.record({
    tenantId: tenant.id,
    sessionId: null,
    actor: `tenant:${req.tenantCtx!.apiKey.id}`,
    event: "session.deleted",
    detail: { sessionId: session.id },
    ip: req.ip ?? null,
  });
  const resp: DeleteSessionResponse = {
    sessionId: session.id,
    deleted,
    purged: ["selfie", "doc_front", "doc_back", "frames"],
  };
  res.json(resp);
});
