/**
 * Teko Verify — servidor HTTP (Express), puerto 4400.
 *
 * Arranque (orden importa, fail-closed):
 *   1. Inicializa el pool PG (lazy: el pool se conecta on-demand; verificamos con un ping).
 *   2. Carga los modelos del engine (SCRFD detect + ArcFace facenox) — obligatorio.
 *   3. Carga PAD (liveness) + glasses (quality) — no-throw: el faltante se maneja
 *      fail-closed dentro de cada módulo (un modelo ausente nunca produce verified).
 *   4. Monta routers: /v1 (tenant), /verify (captura), /admin (dashboard).
 *   5. Sirve estáticos web/ (captura) y admin/ (dashboard) si sus dist existen.
 *
 * Decisión: NO se corren migraciones al boot (se dejan a `npm run migrate`, §11).
 * Healthcheck en /health reporta el estado de cada subsistema.
 */
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import type { CorsOptions } from "cors";
import fs from "fs";
import path from "path";
import * as cfg from "./config";
import { engine } from "./engine";
import { pool } from "./db/pool";
import { qualityModule } from "./modules/quality";
import { livenessModule } from "./modules/liveness";
import { tenantRouter } from "./api/tenant";
import { captureRouter } from "./api/capture";
import { adminRouter, bootstrapAdminOperator } from "./admin/router";
import {
  tenantRateLimiter,
  captureRateLimiter,
  adminRateLimiter,
} from "./lib/rateLimit";

const app = express();
app.set("trust proxy", true); // detrás del túnel Cloudflare (X-Forwarded-For) §11

// =============================== CORS (allowlist) ========================= //
// Reemplaza el cors() abierto por una allowlist explícita desde env (orígenes de
// captura/admin). Sin allowlist configurada → no se habilita CORS (same-origin),
// fail-closed: NO se refleja un Origin arbitrario.
const CORS_ALLOWLIST = (process.env.TEKO_CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    // Requests sin Origin (curl, server-to-server, webhooks entrantes) se permiten:
    // CORS solo protege al navegador; no es una capa de autorización.
    if (!origin) return cb(null, true);
    if (CORS_ALLOWLIST.includes(origin)) return cb(null, true);
    return cb(null, false); // no refleja el Origin → el navegador bloquea
  },
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json({ limit: process.env.TEKO_JSON_LIMIT || "25mb" }));

// =============================== rate-limit =============================== //
// In-memory por IP/tenant/token (§8). El limiter estricto del login admin va
// montado dentro del adminRouter (antes de su guard).
app.use("/v1", tenantRateLimiter());
app.use("/verify", captureRateLimiter());
app.use("/admin", adminRateLimiter());

// =============================== routers ================================== //
app.use("/v1", tenantRouter);
app.use("/verify", captureRouter);
app.use("/admin", adminRouter);

// =============================== health =================================== //
app.get("/health", async (_req: Request, res: Response) => {
  let db = false;
  try {
    await pool.query("SELECT 1");
    db = true;
  } catch {
    db = false;
  }
  // No se exponen thresholds (match/liveness/glassesMax) sin auth: son parámetros
  // de seguridad calibrables; revelarlos facilita evadir el gating (§8/§13).
  res.json({
    status: "ok",
    service: "teko-verify",
    port: cfg.PORT,
    engine: engine.ready,
    quality: qualityModule.ready,
    liveness: livenessModule.ready,
    db,
  });
});

// ===================== static frontends (captura/admin) =================== //
// La SPA de captura se sirve en /verify/:token (HTML) → estáticos en /assets, etc.
const WEB_DIST = process.env.TEKO_WEB_DIST || path.resolve(__dirname, "..", "web", "dist");
if (fs.existsSync(WEB_DIST)) {
  // Estáticos de la SPA (la ruta /verify/:token la captura el router para datos;
  // el HTML de la app se sirve acá como fallback de captura).
  app.use("/app", express.static(WEB_DIST));
}

// La SPA de captura (HTML autocontenido) se sirve en GET /verify/:token. Se monta
// DESPUÉS del captureRouter: como el router no define GET /:token, cae acá. Las
// llamadas de datos (/verify/:token/consent, /selfie, etc.) las maneja el router.
app.get("/verify/:token", (_req: Request, res: Response) => {
  const idx = path.join(WEB_DIST, "index.html");
  if (fs.existsSync(idx)) res.sendFile(idx);
  else res.status(404).type("text/plain").send("Teko Verify: capture UI no disponible");
});

const ADMIN_DIST = process.env.TEKO_ADMIN_DIST || path.resolve(__dirname, "..", "admin", "dist");
if (fs.existsSync(ADMIN_DIST)) {
  // 1) Estáticos del dashboard (assets compilados ganan sobre el fallback).
  app.use("/admin-ui", express.static(ADMIN_DIST));
  // 2) SPA fallback: cualquier ruta /admin-ui/* que NO sea un asset existente
  //    devuelve index.html (routing client-side con basename /admin-ui). Este
  //    handler solo matchea el prefijo /admin-ui → NO afecta /admin (API), /v1,
  //    /verify ni /health (prefijos distintos). Express 4: wildcard "/*" válido.
  app.get("/admin-ui", (_req: Request, res: Response) => {
    res.sendFile(path.join(ADMIN_DIST, "index.html"));
  });
  app.get("/admin-ui/*", (_req: Request, res: Response) => {
    res.sendFile(path.join(ADMIN_DIST, "index.html"));
  });
}

app.get("/", (_req: Request, res: Response) => {
  res.json({ service: "teko-verify", health: "/health" });
});

// =============================== bootstrap ================================ //
async function main(): Promise<void> {
  // 2) Engine (obligatorio): si no carga, el servicio no arranca (fail-closed).
  await engine.init();
  // 3) Modelos ML nuevos (no-throw; fail-closed adentro de cada módulo).
  await Promise.all([qualityModule.init(), livenessModule.init()]);
  // 3.5) Bootstrap fail-closed del primer operador admin (si está configurado por env).
  //      Sin esto y con admin_operators vacía, el dashboard queda sin acceso.
  await bootstrapAdminOperator().catch((e) => {
    // No-throw: un fallo de bootstrap no debe tumbar el servicio; se registra.
    // eslint-disable-next-line no-console
    console.error("[admin] bootstrap operador falló:", (e as Error).message);
  });

  app.listen(cfg.PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[teko-verify] listening on :${cfg.PORT} | engine=${engine.ready} ` +
        `quality=${qualityModule.ready} liveness=${livenessModule.ready}`
    );
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[teko-verify] fatal:", e);
  process.exit(1);
});

export { app };
