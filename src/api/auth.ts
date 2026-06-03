/**
 * Middleware de autenticación del tenant (Bearer API key) — §8.A.
 *
 * Deriva el tenant DE la key: hashea el Bearer, busca la key activa, carga el tenant
 * y lo adjunta a req. Fail-closed: sin key válida / tenant no activo → 401.
 * Todo el resto del flujo del tenant queda scopeado a `req.tenant.id`.
 */
import type { NextFunction, Request, Response } from "express";
import { repos } from "../db/repos";
import { sha256 } from "../lib/crypto";
import type { ApiKey, Tenant } from "../types";

export interface TenantContext {
  tenant: Tenant;
  apiKey: ApiKey;
}

// Extiende Request con el contexto autenticado (sin `any`).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantCtx?: TenantContext;
    }
  }
}

function extractBearer(req: Request): string | null {
  const h = req.header("authorization") || req.header("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export async function authenticateTenant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: "missing_api_key" });
      return;
    }
    const apiKey = await repos.apiKeys.findByHash(sha256(token));
    if (!apiKey) {
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    const tenant = await repos.tenants.getById(apiKey.tenantId);
    if (!tenant || tenant.status !== "active") {
      res.status(401).json({ error: "tenant_inactive" });
      return;
    }
    // last_used (no bloqueante).
    repos.apiKeys.touchLastUsed(tenant.id, apiKey.id).catch(() => {});
    req.tenantCtx = { tenant, apiKey };
    next();
  } catch (e) {
    res.status(500).json({ error: "auth_error", detail: (e as Error).message });
  }
}
