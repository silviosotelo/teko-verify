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
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import type { CorsOptions } from "cors";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import * as cfg from "./config";
import { engine } from "./engine";
import { pool } from "./db/pool";
import { qualityModule } from "./modules/quality";
import { livenessModule } from "./modules/liveness";
import { ageEstimationModule } from "./modules/ageEstimation";
import { tenantRouter } from "./api/tenant";
import { captureRouter } from "./api/capture";
import { adminRouter, bootstrapAdminOperator } from "./admin/router";
import { webhookDispatcher } from "./webhooks/dispatcher";
import { brandingStore } from "./lib/brandingStore";
import {
  tenantRateLimiter,
  captureRateLimiter,
  adminRateLimiter,
} from "./lib/rateLimit";

const app = express();
app.set("trust proxy", true); // detrás del túnel Cloudflare (X-Forwarded-For) §11
app.disable("x-powered-by"); // no revelar el stack (Express) — fingerprinting

// =============================== security headers ========================= //
// Helmet aplica cabeceras seguras (HSTS, X-Content-Type-Options:nosniff,
// Referrer-Policy, X-DNS-Prefetch-Control, etc.). DECISIONES CONSERVADORAS para
// NO romper el flujo en vivo (captura SPA + Didit + dashboard):
//   - CSP DESACTIVADA globalmente: las SPAs (captura/admin) usan inline/eval de
//     bundlers; una CSP estricta las rompería. (Recomendación: definir CSP a medida
//     más adelante, fuera de este hardening de bajo riesgo.)
//   - frameguard (X-Frame-Options) NO global: la página de captura /verify/:token
//     puede embeberse en un iframe del tenant; un DENY global rompería ese embed.
//     Se aplica SOLO a /admin y /admin-ui (anti-clickjacking donde importa).
//   - HSTS: el túnel sirve siempre HTTPS, seguro habilitarlo.
app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false, // no bloquear el fetch de evidencia cross-origin del dashboard
    hsts: { maxAge: 31536000, includeSubDomains: true },
  })
);
// Anti-clickjacking SOLO en superficies admin (no afecta la captura embebible).
app.use(["/admin", "/admin-ui"], helmet.frameguard({ action: "deny" }));

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
    ageEstimation: ageEstimationModule.ready,
    db,
  });
});

// ===================== branding logo (white-label P1 #5) ================== //
// Sirve el logo de marca del tenant (PNG normalizado on-prem). Público: el logo NO
// es secreto y el flujo de captura (sin auth) lo referencia como <img src>. 404 si
// el tenant no subió logo (el front cae al wordmark Teko). Antes de los estáticos.
app.get("/branding/:tenantId/logo", async (req: Request, res: Response) => {
  const buf = await brandingStore.readLogo(req.params.tenantId);
  if (!buf) {
    res.status(404).json({ error: "logo_not_found" });
    return;
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(buf);
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

// ===================== error handling (sin fugas) ========================= //
// 404 JSON genérico (no filtra rutas internas ni HTML por defecto de Express).
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

// Handler de errores terminal: reemplaza el default de Express, que en NODE_ENV !=
// production responde HTML con el STACK TRACE completo (rutas /app/node_modules…).
// Devuelve JSON genérico sin stack ni PII. Distingue el JSON malformado del body-
// parser (400) del resto (500). El detalle real se registra server-side, no se
// envía al cliente. Firma de 4 args = Express lo reconoce como error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  const e = err as { type?: string; status?: number; statusCode?: number };
  const status = e?.status || e?.statusCode || 500;
  // body-parser/raw-body: JSON malformado o payload demasiado grande.
  if (e?.type === "entity.parse.failed" || status === 400) {
    res.status(400).json({ error: "invalid_request_body" });
    return;
  }
  if (e?.type === "entity.too.large" || status === 413) {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }
  // eslint-disable-next-line no-console
  console.error("[teko-verify] unhandled error:", (err as Error)?.message);
  res.status(500).json({ error: "internal_error" });
});

// =============================== bootstrap ================================ //
async function main(): Promise<void> {
  // 2) Engine (obligatorio): si no carga, el servicio no arranca (fail-closed).
  await engine.init();
  // 3) Modelos ML nuevos (no-throw; fail-closed adentro de cada módulo).
  await Promise.all([
    qualityModule.init(),
    livenessModule.init(),
    ageEstimationModule.init(),
  ]);
  // 3.5) Bootstrap fail-closed del primer operador admin (si está configurado por env).
  //      Sin esto y con admin_operators vacía, el dashboard queda sin acceso.
  await bootstrapAdminOperator().catch((e) => {
    // No-throw: un fallo de bootstrap no debe tumbar el servicio; se registra.
    // eslint-disable-next-line no-console
    console.error("[admin] bootstrap operador falló:", (e as Error).message);
  });

  // 3.6) Recupera entregas de webhook vencidas (el worker in-proc pierde sus timers
  //      al reiniciar). Fail-open: nunca tumba el arranque.
  webhookDispatcher()
    .recoverDue()
    .then((n) => {
      if (n > 0) console.log(`[webhook] recuperadas ${n} entregas pendientes`);
    })
    .catch(() => undefined);

  app.listen(cfg.PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[teko-verify] listening on :${cfg.PORT} | engine=${engine.ready} ` +
        `quality=${qualityModule.ready} liveness=${livenessModule.ready} ` +
        `ageEstimation=${ageEstimationModule.ready}`
    );
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[teko-verify] fatal:", e);
  process.exit(1);
});

export { app };
