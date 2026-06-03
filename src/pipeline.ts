/**
 * Pipeline de verificación de Teko Verify (§6/§9).
 *
 * Orquesta los módulos sobre UNA sesión en orden:
 *   quality → liveness → document → match → decision
 * con CORTOCIRCUITO y FAIL-CLOSED:
 *   - quality falla            → needs_recapture (incrementa recaptureCount;
 *                                 supera el máximo → rejected). SIN webhook.
 *   - liveness/document/match  → rejected (rechazo duro). CON webhook.
 *   - cualquier excepción      → state "error" (NUNCA verified). SIN webhook.
 *   - decision verified        → crea verified_identity, dispara webhook session.verified.
 *
 * Qué módulos corren depende del LoA requerido por la policy del tenant:
 *   - L1: quality + document.
 *   - L2: + match.
 *   - L3: + liveness.
 * (decision re-evalúa la escalera; el orden de corrida sólo evita trabajo de más.)
 *
 * Persistencia (§6.5): verification_checks por módulo SIEMPRE; verified_identity sólo
 * si verified; evidence + audit_log siempre. Todo dentro de una transacción; el
 * WEBHOOK se dispara DESPUÉS del commit (nunca dentro de la tx).
 *
 * SEAM DE INYECCIÓN (clave para testeo): el pipeline NO importa singletons ni el
 * pool directamente para su lógica; recibe `PipelineDeps`. server.ts inyecta las
 * implementaciones reales; pipeline.test.ts inyecta mocks. Así el test no necesita
 * onnx, sidecar OCR ni Postgres.
 */
import type { PoolClient } from "pg";
import type { Engine } from "./engine";
import type { Executor } from "./db/executor";
import type {
  DocumentResult,
  EvidenceType,
  LivenessChallenge,
  LivenessResult,
  MatchResult,
  PipelineChecks,
  QualityResult,
  SessionResult,
  SessionState,
  TenantPolicy,
  VerificationSession,
  WebhookEventType,
} from "./types";
import { decision as decideVerdict } from "./modules/decision";
import { match as matchEmbeddings } from "./modules/match";

// ---------------------------------------------------------------------------
// Contratos inyectables.
// ---------------------------------------------------------------------------

/** Las imágenes capturadas de la sesión (ya decodificadas a Buffer). */
export interface CapturedImages {
  selfie: Buffer;
  docFront: Buffer;
  docBack: Buffer;
  frames?: Buffer[];
}

/** Módulos del pipeline, inyectables (las firmas calzan con los módulos reales). */
export interface PipelineModules {
  quality(image: Buffer, engine: Engine, glassesMax?: number): Promise<QualityResult>;
  liveness(
    selfie: Buffer,
    engine: Engine,
    opts?: { frames?: Buffer[]; challenge?: LivenessChallenge; threshold?: number }
  ): Promise<LivenessResult>;
  document(front: Buffer, back: Buffer): Promise<DocumentResult>;
  /** Embedding 512D de una imagen, o null si no hay cara. (engine.embedBestFace) */
  embed(image: Buffer): Promise<Float32Array | null>;
}

/**
 * Repos que el pipeline necesita, acotados a lo que usa. Cada método acepta el
 * Executor (PoolClient) de la transacción.
 */
export interface PipelineRepos {
  sessions: {
    update(
      tenantId: string,
      id: string,
      patch: {
        state?: SessionState;
        recaptureCount?: number;
        result?: SessionResult | null;
        completedAt?: string | null;
        /** Consumo del token de un solo uso: setear al transicionar a terminal (§8/§9). */
        usedAt?: Date | null;
      },
      exec: Executor
    ): Promise<VerificationSession | null>;
  };
  checks: {
    create(
      input: {
        tenantId: string;
        sessionId: string;
        type: "quality" | "liveness" | "document" | "match";
        score?: number | null;
        passed: boolean;
        detail: QualityResult | LivenessResult | DocumentResult | MatchResult;
      },
      exec: Executor
    ): Promise<unknown>;
  };
  identities: {
    create(
      input: {
        tenantId: string;
        sessionId: string;
        ci: string;
        nombre: string;
        fechaNac: string;
        nacionalidad: string;
        tipoDoc: "ci_py";
        assuranceLevel: SessionResult["loa"];
        faceEmbedding: Float32Array;
      },
      exec: Executor
    ): Promise<unknown>;
  };
  evidence: {
    create(
      input: {
        tenantId: string;
        sessionId: string;
        type: EvidenceType;
        storagePath: string;
        sha256: string;
      },
      exec: Executor
    ): Promise<unknown>;
  };
  auditLog: {
    record(
      input: {
        tenantId: string;
        sessionId?: string | null;
        actor: string;
        event: string;
        detail?: Record<string, unknown>;
        ip?: string | null;
      },
      exec: Executor
    ): Promise<unknown>;
  };
}

/** Guarda una imagen como evidencia en disco/CIFS y devuelve ruta + sha256. */
export interface EvidenceStore {
  save(
    tenantId: string,
    sessionId: string,
    type: EvidenceType,
    image: Buffer
  ): Promise<{ storagePath: string; sha256: string }>;
}

/** Dispara el webhook firmado al tenant (reintentos/dead-letter los maneja la impl). */
export interface WebhookSender {
  send(
    session: VerificationSession,
    event: WebhookEventType,
    result: SessionResult
  ): Promise<void>;
}

/** Ejecuta `fn` dentro de una transacción (BEGIN/COMMIT/ROLLBACK). */
export type RunInTransaction = <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;

export interface PipelineDeps {
  modules: PipelineModules;
  repos: PipelineRepos;
  engine: Engine;
  evidenceStore: EvidenceStore;
  webhook: WebhookSender;
  withTransaction: RunInTransaction;
}

export interface PipelineOutput {
  state: SessionState;
  result: SessionResult | null;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const LOA_RANK = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 } as const;

function needsMatch(policy: TenantPolicy): boolean {
  return LOA_RANK[policy.assuranceRequired] >= LOA_RANK.L2;
}
function needsLiveness(policy: TenantPolicy): boolean {
  return LOA_RANK[policy.assuranceRequired] >= LOA_RANK.L3;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Pipeline.
// ---------------------------------------------------------------------------

/**
 * Procesa una sesión completa. Es la función que invoca POST /verify/:token/submit.
 * Devuelve el estado final; persiste todo y dispara webhook según corresponda.
 *
 * Garantía fail-closed: TODO el cuerpo está envuelto en try/catch; cualquier
 * excepción no controlada lleva la sesión a `error` (nunca verified) y se intenta
 * registrar la traza. El webhook sólo se dispara para verified/rejected, tras commit.
 */
export async function processSession(
  session: VerificationSession,
  policy: TenantPolicy,
  images: CapturedImages,
  deps: PipelineDeps
): Promise<PipelineOutput> {
  const { tenantId, id: sessionId } = session;

  try {
    // === 1) QUALITY (recuperable → needs_recapture) ======================= //
    const quality = await deps.modules.quality(
      images.selfie,
      deps.engine,
      policy.thresholds?.qualityGlassesPct
    );

    if (!quality.passed) {
      // Cortocircuito: persiste el check, decide recaptura vs rechazo por reintentos.
      const out = await deps.withTransaction(async (tx) => {
        await deps.repos.checks.create(
          { tenantId, sessionId, type: "quality", score: quality.sharpness, passed: false, detail: quality },
          tx
        );
        await persistEvidence(deps, tenantId, sessionId, images, tx);

        const nextCount = session.recaptureCount + 1;
        const exceeded = nextCount > policy.maxRecaptureAttempts;
        const finalState: SessionState = exceeded ? "rejected" : "needs_recapture";

        if (exceeded) {
          const result: SessionResult = {
            decision: "rejected",
            loa: "L0",
            reasons: ["quality_failed", "max_recapture_attempts_exceeded", ...quality.reasons],
          };
          await deps.repos.sessions.update(
            tenantId,
            sessionId,
            // Terminal: consume el token de un solo uso (anti-replay, §8/§9).
            { state: "rejected", recaptureCount: nextCount, result, completedAt: nowIso(), usedAt: new Date() },
            tx
          );
          await deps.repos.auditLog.record(
            { tenantId, sessionId, actor: "system", event: "pipeline.rejected", detail: { stage: "quality", reasons: quality.reasons } },
            tx
          );
          return { state: finalState, result, reasons: result.reasons };
        }

        await deps.repos.sessions.update(
          tenantId,
          sessionId,
          { state: "needs_recapture", recaptureCount: nextCount },
          tx
        );
        await deps.repos.auditLog.record(
          { tenantId, sessionId, actor: "system", event: "pipeline.needs_recapture", detail: { reasons: quality.reasons, attempt: nextCount } },
          tx
        );
        return { state: finalState, result: null, reasons: quality.reasons };
      });

      // needs_recapture NO dispara webhook; rejected por exceso de intentos SÍ.
      if (out.state === "rejected" && out.result) {
        // El payload del webhook debe reflejar el estado TERMINAL, no "processing"
        // (la `session` en memoria sigue en processing; la fila DB ya es rejected).
        await safeWebhook(deps, { ...session, state: "rejected" }, "session.rejected", out.result);
      }
      return out;
    }

    // === 2) LIVENESS (rechazo duro) — sólo si el LoA lo exige ============== //
    let liveness: LivenessResult | undefined;
    if (needsLiveness(policy)) {
      const challenge = policy.livenessChallenges[0];
      liveness = await deps.modules.liveness(images.selfie, deps.engine, {
        frames: images.frames,
        challenge,
        threshold: policy.thresholds?.livenessScore,
      });
      if (!liveness.passed) {
        return await rejectAt(deps, session, images, "liveness", ["liveness_failed", `attack=${liveness.attackType}`], { quality, liveness });
      }
    }

    // === 3) DOCUMENT (rechazo duro) ======================================= //
    const document = await deps.modules.document(images.docFront, images.docBack);
    if (!document.passed) {
      return await rejectAt(deps, session, images, "document", documentReasons(document), { quality, liveness, document });
    }

    // === 4) MATCH (rechazo duro) — sólo si el LoA lo exige ================= //
    // selfieEmb se reusa para persistir el biométrico de la identidad: se calcula
    // acá (fuera de toda transacción) y NUNCA dentro del tx (no sostener el tx
    // abierto durante una inferencia ONNX).
    let matchRes: MatchResult | undefined;
    let selfieEmb: Float32Array | null = null;
    if (needsMatch(policy)) {
      selfieEmb = await deps.modules.embed(images.selfie);
      const docFaceEmb = document.docFaceCrop
        ? await deps.modules.embed(Buffer.from(document.docFaceCrop.base64Jpeg, "base64"))
        : null;
      if (!selfieEmb || !docFaceEmb) {
        // Fail-closed: sin embeddings no hay match → rechazo.
        return await rejectAt(deps, session, images, "match", ["match_embeddings_unavailable"], { quality, liveness, document });
      }
      matchRes = matchEmbeddings(selfieEmb, docFaceEmb, policy.thresholds?.matchCosine);
      if (!matchRes.passed) {
        return await rejectAt(deps, session, images, "match", ["face_match_failed", `cosine=${matchRes.cosine.toFixed(3)}`], { quality, liveness, document, match: matchRes });
      }
    }

    // === 5) DECISION (fusión + LoA) ======================================= //
    const checks: PipelineChecks = { quality, document, match: matchRes, liveness };
    const verdict = decideVerdict(checks, policy);

    // Persistencia atómica de checks + (si verified) identity + evidence + audit.
    const result: SessionResult = {
      decision: verdict.verdict,
      loa: verdict.loa,
      reasons: verdict.reasons,
      extracted: extractedFrom(document),
      scores: {
        quality: quality.sharpness,
        liveness: liveness?.score,
        match: matchRes?.cosine,
      },
    };

    const finalState: SessionState = verdict.verdict === "verified" ? "verified" : "rejected";

    // El embedding de la selfie es el biométrico que se persiste en la identidad.
    // Se calcula FUERA del tx (sin sostener una transacción abierta durante ONNX).
    // Si match ya lo computó, se reusa; si no (p.ej. L1 sin match), se calcula ahora.
    const identityEmbedding =
      verdict.verdict === "verified"
        ? selfieEmb ?? (await deps.modules.embed(images.selfie))
        : null;

    await deps.withTransaction(async (tx) => {
      await persistAllChecks(deps, tenantId, sessionId, checks, tx);
      await persistEvidence(deps, tenantId, sessionId, images, tx);

      if (verdict.verdict === "verified") {
        const emb = identityEmbedding;
        if (emb && result.extracted) {
          await deps.repos.identities.create(
            {
              tenantId,
              sessionId,
              ci: result.extracted.ci,
              nombre: result.extracted.nombre,
              fechaNac: result.extracted.fechaNac,
              nacionalidad: result.extracted.nacionalidad,
              tipoDoc: "ci_py",
              assuranceLevel: verdict.loa,
              faceEmbedding: emb,
            },
            tx
          );
        }
      }

      await deps.repos.sessions.update(
        tenantId,
        sessionId,
        // Terminal (verified|rejected): consume el token de un solo uso (anti-replay, §8/§9).
        { state: finalState, result, completedAt: nowIso(), usedAt: new Date() },
        tx
      );
      await deps.repos.auditLog.record(
        { tenantId, sessionId, actor: "system", event: `pipeline.${finalState}`, detail: { loa: verdict.loa, reasons: verdict.reasons } },
        tx
      );
    });

    // El payload del webhook debe reflejar el estado TERMINAL alcanzado, no el
    // "processing" con que entró la `session` en memoria (la fila DB ya se actualizó
    // a finalState; el objeto en memoria no). Contrato WebhookPayload.state (§8).
    await safeWebhook(
      deps,
      { ...session, state: finalState },
      verdict.verdict === "verified" ? "session.verified" : "session.rejected",
      result
    );
    return { state: finalState, result, reasons: verdict.reasons };
  } catch (err) {
    // === FAIL-CLOSED: cualquier excepción → state "error", NUNCA verified. == //
    const message = err instanceof Error ? err.message : String(err);
    try {
      await deps.withTransaction(async (tx) => {
        // Terminal 'error' (§9): NUNCA verified. Consume el token de un solo uso
        // para impedir replay del mismo link; un reintento exige nueva sesión.
        await deps.repos.sessions.update(tenantId, sessionId, { state: "error", usedAt: new Date() }, tx);
        await deps.repos.auditLog.record(
          { tenantId, sessionId, actor: "system", event: "pipeline.error", detail: { message } },
          tx
        );
      });
    } catch {
      /* si ni el registro del error funciona, igual no devolvemos verified */
    }
    return { state: "error", result: null, reasons: ["system_error", message] };
  }
}

// ---------------------------------------------------------------------------
// Sub-rutinas.
// ---------------------------------------------------------------------------

function documentReasons(document: DocumentResult): string[] {
  const r = ["document_rejected"];
  for (const c of document.authenticity.checks) if (!c.passed) r.push(`doc:${c.name}`);
  if (!document.mrz.valid) r.push("doc:mrz_invalid");
  if (!document.docFaceCrop) r.push("doc:no_face_on_document");
  return r;
}

function extractedFrom(document: DocumentResult): SessionResult["extracted"] | undefined {
  const m = document.mrz;
  if (!m.documentNumber) return undefined;
  const nombre = [m.givenNames, m.surname].filter(Boolean).join(" ").trim();
  return {
    ci: m.documentNumber,
    nombre: nombre || (document.ocr.fields.surname ?? ""),
    fechaNac: m.dateOfBirth,
    nacionalidad: m.nationality,
    tipoDoc: "ci_py",
  };
}

async function persistAllChecks(
  deps: PipelineDeps,
  tenantId: string,
  sessionId: string,
  checks: PipelineChecks,
  tx: PoolClient
): Promise<void> {
  await deps.repos.checks.create(
    { tenantId, sessionId, type: "quality", score: checks.quality.sharpness, passed: checks.quality.passed, detail: checks.quality },
    tx
  );
  if (checks.liveness) {
    await deps.repos.checks.create(
      { tenantId, sessionId, type: "liveness", score: checks.liveness.score, passed: checks.liveness.passed, detail: checks.liveness },
      tx
    );
  }
  await deps.repos.checks.create(
    { tenantId, sessionId, type: "document", score: checks.document.ocr.confidence, passed: checks.document.passed, detail: checks.document },
    tx
  );
  if (checks.match) {
    await deps.repos.checks.create(
      { tenantId, sessionId, type: "match", score: checks.match.cosine, passed: checks.match.passed, detail: checks.match },
      tx
    );
  }
}

async function persistEvidence(
  deps: PipelineDeps,
  tenantId: string,
  sessionId: string,
  images: CapturedImages,
  tx: PoolClient
): Promise<void> {
  const items: Array<[EvidenceType, Buffer]> = [
    ["selfie", images.selfie],
    ["doc_front", images.docFront],
    ["doc_back", images.docBack],
  ];
  for (const [type, buf] of items) {
    const saved = await deps.evidenceStore.save(tenantId, sessionId, type, buf);
    await deps.repos.evidence.create(
      { tenantId, sessionId, type, storagePath: saved.storagePath, sha256: saved.sha256 },
      tx
    );
  }
}

/** Rechazo duro en un módulo: persiste checks parciales + evidencia, marca rejected, webhook. */
async function rejectAt(
  deps: PipelineDeps,
  session: VerificationSession,
  images: CapturedImages,
  stage: "liveness" | "document" | "match",
  reasons: string[],
  partial: Partial<PipelineChecks>
): Promise<PipelineOutput> {
  const { tenantId, id: sessionId } = session;
  const result: SessionResult = { decision: "rejected", loa: "L0", reasons };

  await deps.withTransaction(async (tx) => {
    if (partial.quality) {
      await deps.repos.checks.create(
        { tenantId, sessionId, type: "quality", score: partial.quality.sharpness, passed: partial.quality.passed, detail: partial.quality },
        tx
      );
    }
    if (partial.liveness) {
      await deps.repos.checks.create(
        { tenantId, sessionId, type: "liveness", score: partial.liveness.score, passed: partial.liveness.passed, detail: partial.liveness },
        tx
      );
    }
    if (partial.document) {
      await deps.repos.checks.create(
        { tenantId, sessionId, type: "document", score: partial.document.ocr.confidence, passed: partial.document.passed, detail: partial.document },
        tx
      );
    }
    if (partial.match) {
      await deps.repos.checks.create(
        { tenantId, sessionId, type: "match", score: partial.match.cosine, passed: partial.match.passed, detail: partial.match },
        tx
      );
    }
    await persistEvidence(deps, tenantId, sessionId, images, tx);
    await deps.repos.sessions.update(
      tenantId,
      sessionId,
      // Rechazo DURO (liveness/document/match) = terminal: consume el token de un
      // solo uso. Así un atacante NO puede reintentar spoofs con el mismo token
      // (los rechazos duros cuentan, igual que el límite de recaptura, §8/§9).
      { state: "rejected", result, completedAt: nowIso(), usedAt: new Date() },
      tx
    );
    await deps.repos.auditLog.record(
      { tenantId, sessionId, actor: "system", event: "pipeline.rejected", detail: { stage, reasons } },
      tx
    );
  });

  // El webhook debe reportar el estado TERMINAL "rejected" (la `session` en memoria
  // sigue en "processing"; la fila DB ya es rejected). Contrato WebhookPayload.state.
  await safeWebhook(deps, { ...session, state: "rejected" }, "session.rejected", result);
  return { state: "rejected", result, reasons };
}

/** Webhook tras commit; no-throw: una falla de webhook NO cambia el veredicto. */
async function safeWebhook(
  deps: PipelineDeps,
  session: VerificationSession,
  event: WebhookEventType,
  result: SessionResult
): Promise<void> {
  if (!session.callbackUrl) return;
  try {
    await deps.webhook.send(session, event, result);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[pipeline] webhook ${event} falló: ${(e as Error).message}`);
  }
}
