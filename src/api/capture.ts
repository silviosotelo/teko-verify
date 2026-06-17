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
import multer from "multer";
import { repos } from "../db/repos";
import { evidenceStore } from "../lib/evidenceStore";
import { decodeBase64Image, assertFrameCount } from "../lib/images";
import { processSession, computeChecks, finalizeFromChecks } from "../pipeline";
import { realPipelineDeps } from "../pipelineDeps";
import { decision as decideVerdict } from "../modules/decision";
// Guardas PURAS de la máquina de estados (single source of truth, testeables sin
// levantar la capa de datos). Ver captureGuards.ts para el racional de cada una.
import { isCapturable, consentShouldTransition } from "./captureGuards";
// Singletons ya inicializados (engine.init() + qualityModule.init() en server.ts).
// Los reusamos para el pre-check de calidad de la selfie (§6.a).
import { engine } from "../engine";
import { qualityModule } from "../modules/quality";
import { PaddleOcrClient } from "../modules/document";
import type {
  CaptureStatusResponse,
  ConfirmResponse,
  ConsentResponse,
  DocCheckResponse,
  DocumentResult,
  EvidenceCropType,
  MatchResult,
  PreviewExtracted,
  PreviewResponse,
  QualityResult,
  SessionState,
  SubmitResponse,
  UploadResponse,
  VerificationSession,
} from "../types";

/** Base pública para construir las URLs token-auth de las fotos de revisión. */
const EVIDENCE_BASE_URL = (
  process.env.PUBLIC_BASE_URL ||
  process.env.TEKO_PUBLIC_URL ||
  "http://localhost:4400"
).replace(/\/+$/, "");

/**
 * Umbral de nitidez (varianza del Laplaciano) para el pre-check de la cédula. La
 * cédula tiene una varianza de Laplaciano muy distinta a una selfie; este umbral
 * es deliberadamente bajo (sólo descarta fotos MUY borrosas) — la autoridad real
 * sigue siendo el módulo `document` en /submit. Configurable por entorno.
 */
const DOC_SHARPNESS_MIN = parseFloat(process.env.TEKO_DOC_SHARPNESS_MIN || "12");

/** Cliente OCR reusado para el pre-check del dorso (MRZ legible). */
const docCheckOcr = new PaddleOcrClient();

/**
 * Límite del video de liveness activo (default 30 MiB). El video va por un endpoint
 * MULTIPART dedicado (NO por el JSON de 25mb): es binario y puede ser más grande que
 * una imagen base64. Configurable por env.
 */
const LIVENESS_VIDEO_MAX_BYTES = parseInt(
  process.env.TEKO_LIVENESS_VIDEO_MAX_BYTES || String(30 * 1024 * 1024),
  10
);

/** Upload multipart en memoria para el video de liveness (un solo archivo, con cap). */
const livenessVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIVENESS_VIDEO_MAX_BYTES, files: 1 },
});

/** Content-types de video aceptados → extensión normalizada. Fail-closed (whitelist). */
const VIDEO_CT_TO_EXT: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/x-matroska": "webm",
  "video/quicktime": "mp4",
};

/**
 * Detecta el tipo real del video por MAGIC BYTES (no se confía en el mimetype del
 * cliente). webm/mkv = EBML (1A 45 DF A3); mp4/mov = "ftyp" en bytes 4..8. Devuelve
 * la extensión + content-type canónico, o null si no es un contenedor reconocido.
 */
function sniffVideo(buf: Buffer): { ext: string; contentType: string } | null {
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { ext: "webm", contentType: "video/webm" };
  }
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
  ) {
    return { ext: "mp4", contentType: "video/mp4" };
  }
  return null;
}

/** Forma validada del bloque de liveness activo reportado por el cliente. */
interface ActiveLiveness {
  challenges: string[];
  passed: boolean;
}

/**
 * Parsea/sanea el bloque `activeLiveness` del body de /selfie. Fail-closed: cualquier
 * forma inválida ⇒ null (no se persiste, no se acredita liveness activo). Limita la
 * cantidad/longitud de challenges para no almacenar payloads arbitrarios.
 */
function parseActiveLiveness(raw: unknown): ActiveLiveness | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { challenges?: unknown; passed?: unknown };
  const challenges = Array.isArray(r.challenges)
    ? r.challenges
        .filter((c): c is string => typeof c === "string")
        .slice(0, 8)
        .map((c) => c.slice(0, 40))
    : [];
  return { challenges, passed: r.passed === true };
}

export const captureRouter = Router();

/**
 * Estados TERMINALES: la sesión ya tiene un resultado definitivo y NO debe
 * re-ejecutar el pipeline ni aceptar más capturas (§6/§9). `error` se trata como
 * terminal para la captura (anti-replay): reintentar exige una sesión nueva.
 *
 * NOTA: 'review' NO es terminal — es intermedio (processing→review→verified|rejected):
 * loadSession lo deja pasar para que /confirm y /evidence puedan operar sobre él.
 */
const TERMINAL_STATES = new Set<SessionState>([
  "verified",
  "rejected",
  "error",
  "expired",
  // `in_review` no es terminal del lado SISTEMA (un operador lo resuelve), pero SÍ
  // lo es del lado TITULAR: ya no captura más y su token quedó consumido. Tratarlo
  // como terminal para la captura permite que /status lo lea (subject ve "en revisión")
  // y bloquea nuevas mutaciones de captura.
  "in_review",
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
  if (!isCapturable(session.state)) {
    res.status(409).json({ error: "invalid_state_for_capture", state: session.state });
    return false;
  }
  return true;
}

/**
 * Re-captura desde 'review' (#1): si el titular tocó "Volver a intentar", la
 * sesión está en 'review'. Antes de aceptar la nueva selfie, la devolvemos a
 * 'capturing' para reflejar que volvió a capturar. Los datos del preview previo
 * (checks + crops) los pisa el próximo /preview, así que acá sólo flippeamos el
 * estado. No-op si ya está en {created,capturing,needs_recapture}.
 */
async function resetForRecapture(session: VerificationSession): Promise<void> {
  if (session.state === "review") {
    await repos.sessions.update(session.tenantId, session.id, { state: "capturing" });
    session.state = "capturing";
  }
}

// POST /verify/:token/consent
captureRouter.post("/:token/consent", async (req: Request, res: Response) => {
  const session = await loadSession(req, res);
  if (!session) return;
  // Guard de re-consentimiento (#4): re-aceptar desde 'review' (u otro estado ya
  // avanzado) NO debe re-crear el consent ni resetear review→capturing. No-op
  // idempotente que devuelve el estado actual sin tocar nada.
  if (!consentShouldTransition(session.state)) {
    const resp: ConsentResponse = { ok: true, state: session.state };
    res.json(resp);
    return;
  }
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
  // Loop "Volver a intentar" (#1): si veníamos de 'review', volvemos a 'capturing'.
  await resetForRecapture(session);
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

    // Liveness ACTIVO interactivo reportado por el navegador (desafíos guiados): se
    // persiste como sidecar JSON para que el pipeline (en /submit y /preview) lo
    // combine con el PAD pasivo. Fail-closed: forma inválida ⇒ no se persiste (la
    // liveness queda sólo con el PAD pasivo + el video como evidencia). El video
    // completo se sube aparte vía POST /liveness-video.
    const activeLiveness = parseActiveLiveness(req.body?.activeLiveness);
    if (activeLiveness) {
      await evidenceStore.saveJson(session.tenantId, session.id, "liveness_active", activeLiveness);
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

// POST /verify/:token/liveness-video  → sube el VIDEO de la sesión de liveness activo
// Endpoint MULTIPART dedicado (campo `video`): el video es binario y puede superar el
// JSON de 25mb, por eso usa multer con su propio cap (LIVENESS_VIDEO_MAX_BYTES). Se
// valida el tipo real por magic bytes (webm/mp4), se persiste crudo vía
// evidenceStore.saveVideo y se crea la fila `evidence` (tipo 'liveness_video') para
// que el admin lo vea/reproduzca. NO consume el token ni cambia el estado: es
// evidencia aditiva. Fail-closed: tipo/forma inválida → 400.
captureRouter.post(
  "/:token/liveness-video",
  livenessVideoUpload.single("video"),
  async (req: Request, res: Response) => {
    const session = await loadSession(req, res);
    if (!session) return;
    if (!requireCapturable(session, res)) return;
    try {
      const file = (req as Request & { file?: { buffer: Buffer } }).file;
      if (!file || !file.buffer || file.buffer.length < 100) {
        res.status(400).json({ error: "liveness_video_missing" });
        return;
      }
      const kind = sniffVideo(file.buffer);
      if (!kind) {
        res.status(400).json({ error: "liveness_video_invalid_type" });
        return;
      }
      const saved = await evidenceStore.saveVideo(
        session.tenantId,
        session.id,
        file.buffer,
        kind.ext,
        kind.contentType
      );
      // Fila de evidencia (idempotente a nivel de UX: re-subir crea otra fila, pero el
      // disco sobreescribe; el admin lista por tipo y sirve el último archivo). Si ya
      // existe una fila 'liveness_video' para la sesión, NO duplicamos.
      const existing = await repos.evidence.listBySession(session.tenantId, session.id);
      if (!existing.some((e) => e.type === "liveness_video")) {
        await repos.evidence.create({
          tenantId: session.tenantId,
          sessionId: session.id,
          type: "liveness_video",
          storagePath: saved.storagePath,
          sha256: saved.sha256,
        });
      }
      await repos.auditLog.record({
        tenantId: session.tenantId,
        sessionId: session.id,
        actor: "subject",
        event: "liveness.video_uploaded",
        detail: { bytes: file.buffer.length, contentType: kind.contentType },
        ip: req.ip ?? null,
      });
      const resp: UploadResponse = { ok: true, state: session.state };
      res.json(resp);
    } catch (e) {
      res.status(400).json({ error: "liveness_video_failed", detail: (e as Error).message });
    }
  }
);

// POST /verify/:token/document
captureRouter.post("/:token/document", async (req: Request, res: Response) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (!requireCapturable(session, res)) return;
  try {
    // Frente/dorso aceptan PDF (cédula escaneada): se guardan crudos y el pipeline
    // (computeChecks/processSession en /submit /preview) los rasteriza a imagen antes
    // del OCR. La selfie/frames siguen JPEG/PNG-only (sin allowPdf).
    const front = decodeBase64Image(req.body?.front, { allowPdf: true });
    const back = decodeBase64Image(req.body?.back, { allowPdf: true });
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
    const activeLiveness =
      (await evidenceStore.readJson<ActiveLiveness>(session.tenantId, session.id, "liveness_active")) ??
      undefined;

    await repos.sessions.update(session.tenantId, session.id, { state: "processing" });

    // El pipeline persiste todo y dispara el webhook; fail-closed garantizado adentro.
    const out = await processSession(
      { ...session, state: "processing" },
      tenant.policies,
      { selfie, docFront, docBack, frames, activeLiveness },
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

// POST /verify/:token/preview  → corre el pipeline, persiste checks, estado 'review'
// NO finaliza: no crea verified_identity, no webhook. Devuelve extracted + match +
// decisionPreview + photos (URLs token-auth de los recortes). Fail-closed.
captureRouter.post("/:token/preview", async (req: Request, res: Response) => {
  const session = await loadSession(req, res);
  if (!session) return;
  // /preview transiciona desde {capturing, needs_recapture} (o re-preview desde review).
  if (
    session.state !== "capturing" &&
    session.state !== "needs_recapture" &&
    session.state !== "review"
  ) {
    res.status(409).json({ error: "invalid_state_for_preview", state: session.state });
    return;
  }
  try {
    const tenant = await repos.tenants.getById(session.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const selfie = await evidenceStore.read(session.tenantId, session.id, "selfie");
    const docFront = await evidenceStore.read(session.tenantId, session.id, "doc_front");
    const docBack = await evidenceStore.read(session.tenantId, session.id, "doc_back");
    if (!selfie || !docFront || !docBack) {
      res.status(409).json({ error: "incomplete_uploads", state: session.state });
      return;
    }
    const frame = await evidenceStore.read(session.tenantId, session.id, "frames");
    const frames: Buffer[] | undefined = frame ? [selfie, frame] : undefined;
    const activeLiveness =
      (await evidenceStore.readJson<ActiveLiveness>(session.tenantId, session.id, "liveness_active")) ??
      undefined;

    await repos.sessions.update(session.tenantId, session.id, { state: "processing" });

    const out = await computeChecks(
      { ...session, state: "processing" },
      tenant.policies,
      { selfie, docFront, docBack, frames, activeLiveness },
      realPipelineDeps
    );

    // computeChecks puede divergir a needs_recapture / rejected / error (no review).
    if (out.state !== "review" || !out.checks) {
      res.status(409).json({ error: "preview_not_review", state: out.state, reasons: out.reasons });
      return;
    }

    const document: DocumentResult = out.checks.document;
    const quality: QualityResult = out.checks.quality;
    const match: MatchResult | undefined = out.checks.match;
    const ex = document.extracted;
    const extracted: PreviewExtracted = {
      titular: ex.titular,
      documento: ex.documento,
      documentoFisico: ex.documentoFisico,
      registroInterno: ex.registroInterno,
      autoridadEmisora: ex.autoridadEmisora,
      mrz: ex.mrz,
    };

    // decisionPreview: corre la MISMA decision() que usará /confirm sobre los checks
    // ya computados (sin persistir nada). Garantiza paridad con el veredicto final.
    // Honra el LoA POR SESIÓN (igual que el pipeline): el nivel de la sesión manda.
    const previewPolicy = {
      ...tenant.policies,
      assuranceRequired: session.assuranceRequired ?? tenant.policies.assuranceRequired,
    };
    const verdict = decideVerdict(out.checks, previewPolicy);
    const decisionPreview = { loa: verdict.loa, wouldPass: verdict.verdict === "verified" };
    void quality; // quality ya está en checks; lo dejamos explícito para legibilidad.

    const base = `${EVIDENCE_BASE_URL}/verify/${session.linkToken}/evidence`;
    const resp: PreviewResponse = {
      state: "review",
      extracted,
      match: { cosine: match?.cosine ?? 0, passed: match?.passed ?? false },
      decisionPreview,
      photos: {
        selfieCrop: `${base}/selfie`,
        docFaceCrop: `${base}/doc_face`,
        docFrontCrop: `${base}/doc_front`,
      },
    };
    res.json(resp);
  } catch (e) {
    await repos.sessions
      .update(session.tenantId, session.id, { state: "error", usedAt: new Date() })
      .catch(() => {});
    res.status(500).json({ error: "preview_failed", state: "error", detail: (e as Error).message });
  }
});

// POST /verify/:token/confirm  → finaliza DESDE 'review' con los checks computados.
captureRouter.post("/:token/confirm", async (req: Request, res: Response) => {
  const session = await loadSession(req, res);
  if (!session) return;
  // /confirm SOLO desde 'review'.
  if (session.state !== "review") {
    res.status(409).json({ error: "invalid_state_for_confirm", state: session.state });
    return;
  }
  try {
    const tenant = await repos.tenants.getById(session.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    // La selfie original se necesita para re-inferir el embedding de la identidad.
    const selfie = await evidenceStore.read(session.tenantId, session.id, "selfie");
    if (!selfie) {
      res.status(409).json({ error: "incomplete_uploads", state: session.state });
      return;
    }
    const out = await finalizeFromChecks(session, tenant.policies, selfie, realPipelineDeps);
    const resp: ConfirmResponse = {
      state: out.state,
      result: out.result,
      reasons: out.reasons,
      // Para que el front pueda redirigir directo (#8) sin esperar /status.
      redirectUrl: session.redirectUrl,
    };
    res.json(resp);
  } catch (e) {
    await repos.sessions
      .update(session.tenantId, session.id, { state: "error", usedAt: new Date() })
      .catch(() => {});
    res.status(500).json({ error: "confirm_failed", state: "error", detail: (e as Error).message });
  }
});

// GET /verify/:token/evidence/:type  → sirve un recorte de evidencia (token-auth).
// type ∈ selfie|doc_face|doc_front. El link_token ES la credencial (la sesión se
// resuelve por él); allowTerminalRead para servir durante review Y tras confirm.
const EVIDENCE_CROP_TYPES: EvidenceCropType[] = ["selfie", "doc_face", "doc_front"];
captureRouter.get("/:token/evidence/:type", async (req: Request, res: Response) => {
  const session = await loadSession(req, res, { allowTerminalRead: true });
  if (!session) return;
  const type = req.params.type as EvidenceCropType;
  if (!EVIDENCE_CROP_TYPES.includes(type)) {
    res.status(400).json({ error: "invalid_evidence_type" });
    return;
  }
  const buf = await evidenceStore.readCrop(session.tenantId, session.id, type);
  if (!buf) {
    res.status(404).json({ error: "evidence_not_found" });
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=60");
  res.send(buf);
});

// GET /verify/:token/status  (polling; SSE más abajo)
// Lectura de estado. Aplica las MISMAS guardas fail-closed que loadSession para
// que la rehidratación del front (#3/#6) sea correcta: token inexistente → 404;
// token consumido → 410+token_consumed; TTL vencido (no terminal) → 410+expired
// (flippeando a 'expired'). Sin esto, un token expirado-pero-no-flippeado
// devolvía 200 con un estado no-terminal y el front lo metía al flujo en vez de
// a la pantalla de error.
captureRouter.get("/:token/status", async (req: Request, res: Response) => {
  const session = await repos.sessions.findByLinkToken(req.params.token);
  if (!session) {
    res.status(404).json({ error: "invalid_token" });
    return;
  }
  if (session.usedAt && !TERMINAL_STATES.has(session.state)) {
    // Token de un solo uso ya consumido pero aún sin resultado terminal visible.
    res.status(410).json({ error: "token_consumed", state: session.state });
    return;
  }
  if (new Date(session.expiresAt) < new Date() && !TERMINAL_STATES.has(session.state)) {
    await repos.sessions.update(session.tenantId, session.id, { state: "expired" });
    res.status(410).json({ error: "expired", state: "expired" });
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
  const terminal = new Set(["verified", "rejected", "expired", "error", "in_review"]);
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
