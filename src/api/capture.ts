/**
 * API de captura del titular (auth por link_token) — §8.B.
 *
 *   GET  /verify/:token            sirve la SPA de captura (la estática la monta server.ts)
 *   POST /verify/:token/consent    registra consentimiento (Ley 7593/2025 §12)
 *   POST /verify/:token/selfie     sube selfie (+ frames)
 *   POST /verify/:token/document   sube cédula frente + dorso
 *   POST /verify/:token/submit     dispara el pipeline
 *   GET  /verify/:token/status     estado (SSE + fallback polling, §11)
 *
 * Auth: el link_token ES la credencial del titular (no porta tenant). Fail-closed:
 * token inexistente → 404; sesión expirada → 410 + estado 'expired'.
 *
 * El submit invoca processSession() con las dependencias REALES inyectadas
 * (realPipelineDeps). Las imágenes se releen del EvidenceStore (subidas previas).
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { repos } from "../db/repos";
import { evidenceStore } from "../lib/evidenceStore";
import { decodeBase64Image, assertFrameCount } from "../lib/images";
import { processSession } from "../pipeline";
import { realPipelineDeps } from "../pipelineDeps";
// Singletons ya inicializados (engine.init() + qualityModule.init() en server.ts).
// Los reusamos para el pre-check de calidad de la selfie (§6.a).
import { engine } from "../engine";
import { qualityModule } from "../modules/quality";
import { PaddleOcrClient } from "../modules/document";
import type {
  CaptureStatusResponse,
  ConsentResponse,
  DocCheckResponse,
  SessionState,
  SubmitResponse,
  UploadResponse,
  VerificationSession,
} from "../types";

/**
 * Umbral de nitidez (varianza del Laplaciano) para el pre-check de la cédula. La
 * cédula tiene una varianza de Laplaciano muy distinta a una selfie; este umbral
 * es deliberadamente bajo (sólo descarta fotos MUY borrosas) — la autoridad real
 * sigue siendo el módulo `document` en /submit. Configurable por entorno.
 */
const DOC_SHARPNESS_MIN = parseFloat(process.env.TEKO_DOC_SHARPNESS_MIN || "12");

/** Cliente OCR reusado para el pre-check del dorso (MRZ legible). */
const docCheckOcr = new PaddleOcrClient();

export const captureRouter = Router();

/**
 * Estados TERMINALES: la sesión ya tiene un resultado definitivo y NO debe
 * re-ejecutar el pipeline ni aceptar más capturas (§6/§9). `error` se trata como
 * terminal para la captura (anti-replay): reintentar exige una sesión nueva.
 */
const TERMINAL_STATES = new Set<SessionState>([
  "verified",
  "rejected",
  "error",
  "expired",
]);

/** Estados en los que la captura (selfie/document/submit) es legítima. */
const CAPTURABLE_STATES = new Set<SessionState>([
  "created",
  "capturing",
  "needs_recapture",
]);

/**
 * Carga la sesión por token y aplica las guardas de seguridad del flujo de captura.
 * Fail-closed: token inexistente → 404; token consumido (un solo uso) → 410;
 * TTL vencido → 410 + flip a 'expired' (excluyendo TODO estado terminal, para no
 * pisar un resultado ya emitido); estado terminal → 409. Responde y devuelve null
 * si alguna guarda falla.
 *
 * `opts.allowTerminalRead=true` se usa SOLO para endpoints de lectura de estado,
 * que sí deben poder ver el resultado terminal sin re-disparar nada.
 */
async function loadSession(
  req: Request,
  res: Response,
  opts: { allowTerminalRead?: boolean } = {}
): Promise<VerificationSession | null> {
  const session = await repos.sessions.findByLinkToken(req.params.token);
  if (!session) {
    res.status(404).json({ error: "invalid_token" });
    return null;
  }

  // 1) Token de un solo uso ya consumido → no reutilizable (anti-replay, §8/§9).
  //    Aun si el estado se viera no-terminal por una carrera, used_at manda.
  if (session.usedAt) {
    if (opts.allowTerminalRead) return session;
    res.status(410).json({ error: "token_consumed", state: session.state });
    return null;
  }

  // 2) Expiración por TTL. El flip a 'expired' EXCLUYE todos los terminales:
  //    una sesión ya verified/rejected/error NO debe perder su resultado por TTL.
  if (new Date(session.expiresAt) < new Date() && !TERMINAL_STATES.has(session.state)) {
    await repos.sessions.update(session.tenantId, session.id, { state: "expired" });
    res.status(410).json({ error: "expired", state: "expired" });
    return null;
  }

  // 3) Estado terminal → no se aceptan más capturas. Lectura sí (allowTerminalRead).
  if (TERMINAL_STATES.has(session.state)) {
    if (opts.allowTerminalRead) return session;
    res.status(409).json({ error: "session_terminal", state: session.state });
    return null;
  }

  return session;
}

/**
 * Guarda de máquina de estados para mutaciones de captura (selfie/document/submit):
 * solo se aceptan en {created, capturing, needs_recapture}. Cualquier otro estado
 * (incluido processing) → 409 sin re-ejecutar nada. Responde y devuelve false si bloquea.
 */
function requireCapturable(session: VerificationSession, res: Response): boolean {
  if (!CAPTURABLE_STATES.has(session.state)) {
    res.status(409).json({ error: "invalid_state_for_capture", state: session.state });
    return false;
  }
  return true;
}

// POST /verify/:token/consent
captureRouter.post("/:token/consent", async (req: Request, res: Response) => {
  const session = await loadSession(req, res);
  if (!session) return;
  try {
    const tenant = await repos.tenants.getById(session.tenantId);
    const policy = tenant!.policies;
    await repos.consents.create({
      tenantId: session.tenantId,
      sessionId: session.id,
      text: policy.consentText,
      version: req.body?.consentVersion ?? policy.consentVersion,
      ip: req.ip ?? null,
    });
    await repos.sessions.update(session.tenantId, session.id, { state: "capturing" });
    await repos.auditLog.record({
      tenantId: session.tenantId,
      sessionId: session.id,
      actor: "subject",
      event: "consent.accepted",
      detail: { version: req.body?.consentVersion ?? policy.consentVersion },
      ip: req.ip ?? null,
    });
    const resp: ConsentResponse = { ok: true, state: "capturing" };
    res.json(resp);
  } catch (e) {
    res.status(400).json({ error: "consent_failed", detail: (e as Error).message });
  }
});

// POST /verify/:token/selfie
captureRouter.post("/:token/selfie", async (req: Request, res: Response) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (!requireCapturable(session, res)) return;
  try {
    const selfie = decodeBase64Image(req.body?.image);
    await evidenceStore.save(session.tenantId, session.id, "selfie", selfie);
    const frames: string[] = Array.isArray(req.body?.frames) ? req.body.frames : [];
    // Hardening (§8/§9): cap de cantidad de frames ANTES de decodificar ninguno,
    // para no permitir un upload de miles de frames (DoS de CPU/memoria).
    assertFrameCount(frames);
    if (frames.length) {
      // Guarda un frame distinto de la selfie como evidencia para el desafío activo
      // de liveness. El EvidenceStore key-ea por tipo (un solo archivo 'frames'),
      // así que persistimos UN frame representativo distinto de la selfie principal;
      // submit() reúne {selfie, frame} para que liveness compare dos instantes reales.
      const repFrame = frames.length > 1 ? frames[frames.length - 1] : frames[0];
      await evidenceStore.save(session.tenantId, session.id, "frames", decodeBase64Image(repFrame));
    }

    // Pre-check INFORMATIVO de calidad sobre la selfie (§6.a): corre el mismo módulo
    // `quality` que usará el pipeline para avisar AL MOMENTO de la captura (anteojos,
    // luz, nitidez, pose). NO cambia el estado ni bloquea del lado servidor: la
    // autoridad sigue siendo el pipeline en /submit. Se proyecta a {passed, reasons}.
    // try/catch propio (NO el outer): un fallo de quality NO debe romper el upload ya
    // exitoso → fail-closed devolviendo passed=false con reason "quality_error".
    let quality: { passed: boolean; reasons: string[] };
    try {
      const q = await qualityModule.run(selfie, engine);
      quality = { passed: q.passed, reasons: q.reasons };
    } catch {
      quality = { passed: false, reasons: ["quality_error"] };
    }

    const resp: UploadResponse = { ok: true, state: "capturing", quality };
    res.json(resp);
  } catch (e) {
    res.status(400).json({ error: "selfie_upload_failed", detail: (e as Error).message });
  }
});

// POST /verify/:token/document
captureRouter.post("/:token/document", async (req: Request, res: Response) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (!requireCapturable(session, res)) return;
  try {
    const front = decodeBase64Image(req.body?.front);
    const back = decodeBase64Image(req.body?.back);
    await evidenceStore.save(session.tenantId, session.id, "doc_front", front);
    await evidenceStore.save(session.tenantId, session.id, "doc_back", back);
    const resp: UploadResponse = { ok: true, state: "capturing" };
    res.json(resp);
  } catch (e) {
    res.status(400).json({ error: "document_upload_failed", detail: (e as Error).message });
  }
});

// POST /verify/:token/doc-check  → pre-check INFORMATIVO de la cédula (UX)
// Espejo del pre-check de la selfie: NO persiste, NO cambia estado, NO consume el
// token. Verifica nitidez (Laplaciano), rostro en el frente y MRZ legible en el
// dorso. Fail-closed/no-throw: ante cualquier error devuelve passed=false con una
// reason genérica (nunca 500). El pipeline en /submit sigue siendo la autoridad.
captureRouter.post("/:token/doc-check", async (req: Request, res: Response) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (!requireCapturable(session, res)) return;

  const sideRaw = req.body?.side;
  const side: "front" | "back" = sideRaw === "back" ? "back" : "front";
  const reasons: string[] = [];

  try {
    const image = decodeBase64Image(req.body?.image);

    // 1) Nitidez (varianza del Laplaciano) — descarta sólo fotos MUY borrosas.
    let sharp = Infinity;
    try {
      sharp = await qualityModule.sharpness(image);
    } catch {
      // Si no podemos medir nitidez, no bloqueamos por eso (la dejamos en Infinity).
    }
    if (sharp < DOC_SHARPNESS_MIN) reasons.push("blurry");

    if (side === "front") {
      // 2a) FRENTE: debe verse el rostro del titular (engine SCRFD). Sin rostro →
      // probablemente no es el frente o está mal encuadrada.
      let hasFace = false;
      try {
        const faces = await engine.detect(image);
        hasFace = engine.bestFace(faces) !== null;
      } catch {
        hasFace = false;
      }
      if (!hasFace) reasons.push("no_doc_face");
    } else {
      // 2b) DORSO: el OCR debe devolver algo con pinta de MRZ (líneas largas del
      // alfabeto MRZ A-Z0-9<) o, al menos, texto suficiente. El OCR confunde
      // `<`↔`C`/`K`, así que NO exigimos `<` literal: aceptamos líneas largas del
      // alfabeto MRZ O texto total suficiente.
      let mrzOk = false;
      try {
        const ocr = await docCheckOcr.recognize(image);
        const text = ocr.rawText || "";
        const mrzLike = text
          .split(/\r?\n/)
          .map((l) => l.replace(/\s+/g, "").toUpperCase())
          .filter((l) => /^[A-Z0-9<]{20,}$/.test(l))
          .filter((l) => !(/^[A-Z]+$/.test(l) && l.length < 28));
        const enoughText = text.replace(/\s+/g, "").length >= 40;
        mrzOk = mrzLike.length >= 1 || enoughText;
      } catch {
        mrzOk = false;
      }
      if (!mrzOk) reasons.push("mrz_unreadable");
    }

    const resp: DocCheckResponse = { ok: true, passed: reasons.length === 0, reasons };
    res.json(resp);
  } catch (e) {
    // Fail-closed: cualquier fallo (decodificación, etc.) → passed=false, NUNCA 500.
    const resp: DocCheckResponse = {
      ok: true,
      passed: false,
      reasons: reasons.length ? reasons : ["doc_check_error"],
    };
    void e;
    res.json(resp);
  }
});

// POST /verify/:token/submit  → dispara el pipeline
captureRouter.post("/:token/submit", async (req: Request, res: Response) => {
  const session = await loadSession(req, res);
  if (!session) return;
  // Máquina de estados (§6): submit SOLO transiciona desde {capturing,
  // needs_recapture} → processing. 'created' no tiene capturas; los terminales y
  // 'processing' (ya en curso) ya fueron filtrados por loadSession o lo son aquí.
  if (session.state !== "capturing" && session.state !== "needs_recapture") {
    res.status(409).json({ error: "invalid_state_for_submit", state: session.state });
    return;
  }
  try {
    const tenant = await repos.tenants.getById(session.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    // Relee las imágenes subidas.
    const selfie = await evidenceStore.read(session.tenantId, session.id, "selfie");
    const docFront = await evidenceStore.read(session.tenantId, session.id, "doc_front");
    const docBack = await evidenceStore.read(session.tenantId, session.id, "doc_back");
    if (!selfie || !docFront || !docBack) {
      res.status(409).json({ error: "incomplete_uploads", state: session.state });
      return;
    }

    // Relee los frames guardados para el desafío activo de liveness. El frame se
    // persistió en /selfie como un instante DISTINTO de la selfie; pasamos ambos
    // (selfie + frame) para que liveness pueda comparar dos capturas reales y así
    // detectar un gesto mínimo (apertura de ojos / cambio de pose). Si no hay frame
    // guardado, frames=undefined y liveness queda fail-closed cuando hay desafío.
    const frame = await evidenceStore.read(session.tenantId, session.id, "frames");
    const frames: Buffer[] | undefined = frame ? [selfie, frame] : undefined;

    await repos.sessions.update(session.tenantId, session.id, { state: "processing" });

    // El pipeline persiste todo y dispara el webhook; fail-closed garantizado adentro.
    const out = await processSession(
      { ...session, state: "processing" },
      tenant.policies,
      { selfie, docFront, docBack, frames },
      realPipelineDeps
    );

    const resp: SubmitResponse = { ok: out.state !== "error", state: out.state };
    res.json(resp);
  } catch (e) {
    // Defensa extra (processSession ya es fail-closed): nunca verified ante throw.
    // Marca terminal 'error' y CONSUME el token (anti-replay), de forma best-effort.
    await repos.sessions
      .update(session.tenantId, session.id, { state: "error", usedAt: new Date() })
      .catch(() => {});
    res.status(500).json({ error: "submit_failed", state: "error", detail: (e as Error).message });
  }
});

// GET /verify/:token/status  (polling; SSE más abajo)
captureRouter.get("/:token/status", async (req: Request, res: Response) => {
  const session = await repos.sessions.findByLinkToken(req.params.token);
  if (!session) {
    res.status(404).json({ error: "invalid_token" });
    return;
  }
  const tenant = await repos.tenants.getById(session.tenantId);
  const resp: CaptureStatusResponse = {
    state: session.state,
    reasons: session.result?.reasons,
    recaptureCount: session.recaptureCount,
    maxRecaptureAttempts: tenant?.policies.maxRecaptureAttempts,
    redirectUrl: session.redirectUrl,
  };
  res.json(resp);
});

// GET /verify/:token/events  (SSE; con fallback al polling de arriba por buffering del túnel §11)
captureRouter.get("/:token/events", async (req: Request, res: Response) => {
  const session = await repos.sessions.findByLinkToken(req.params.token);
  if (!session) {
    res.status(404).end();
    return;
  }
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
  res.write(": connected\n\n");

  // Poll ligero del estado y empuje SSE; termina al llegar a estado terminal.
  const terminal = new Set(["verified", "rejected", "expired", "error"]);
  const tick = async () => {
    const s = await repos.sessions.findByLinkToken(req.params.token);
    if (!s) return;
    res.write(`data: ${JSON.stringify({ type: "state", state: s.state, reasons: s.result?.reasons })}\n\n`);
    if (terminal.has(s.state)) {
      clearInterval(timer);
      res.end();
    }
  };
  const timer = setInterval(() => void tick(), 2000);
  void tick();
  req.on("close", () => clearInterval(timer));
});
