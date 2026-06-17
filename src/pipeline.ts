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
import sharp from "sharp";
import type {
  DocumentResult,
  EvidenceCropType,
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
import { ensureRasterImage } from "./lib/raster";
import { applyWorkflowToPolicy, shouldRouteToReview } from "./lib/workflow";

/**
 * Normaliza las imágenes de DOCUMENTO a raster decodificable por sharp: si docFront/
 * docBack vinieron como PDF (cédula escaneada), rasteriza su 1ª página a PNG. Un solo
 * chokepoint al entrar al pipeline: así TODO lo que consume esas imágenes (módulo
 * document, fallback de match `embed(docFront)`, recorte `docCropper.crop(docFront)` y
 * la evidencia que se persiste) recibe una imagen, nunca el PDF crudo. La selfie/frames
 * NO se tocan (siempre JPEG/PNG). FAIL-CLOSED: si la rasterización falla, propaga el
 * error y el caller (processSession/computeChecks) lo convierte en estado 'error'.
 */
async function rasterizeDocImages(images: CapturedImages): Promise<CapturedImages> {
  // NOTA (PDF pág2 = dorso, NO implementado): si un PDF combinado trae frente+dorso
  // en 2 páginas, el dorso podría sacarse con `rasterizePdfPage(images.docBack, 2)`.
  // Se deja ANOTADO y no se cambia el comportamiento: no hay forma byte-segura de
  // distinguir "PDF combinado de 2 páginas" de "dorso propio en 1 página" sin contar
  // páginas (pdfinfo), y forzar la pág 2 ROMPERÍA el caso 1-página (pdftoppm exit≠0 →
  // fail-closed error) cuando front y back son el mismo escaneo de una sola página.
  const [docFront, docBack] = await Promise.all([
    ensureRasterImage(images.docFront),
    ensureRasterImage(images.docBack),
  ]);
  return { ...images, docFront, docBack };
}

// ---------------------------------------------------------------------------
// Contratos inyectables.
// ---------------------------------------------------------------------------

/** Las imágenes capturadas de la sesión (ya decodificadas a Buffer). */
export interface CapturedImages {
  selfie: Buffer;
  docFront: Buffer;
  docBack: Buffer;
  frames?: Buffer[];
  /**
   * Resultado del LIVENESS ACTIVO interactivo reportado por el navegador (desafíos
   * guiados). Se reenvía al módulo liveness, que lo combina con el PAD pasivo
   * (fail-closed). El video completo se persiste aparte como evidencia `liveness_video`.
   */
  activeLiveness?: { challenges: string[]; passed: boolean };
}

/** Módulos del pipeline, inyectables (las firmas calzan con los módulos reales). */
export interface PipelineModules {
  quality(image: Buffer, engine: Engine, glassesMax?: number): Promise<QualityResult>;
  liveness(
    selfie: Buffer,
    engine: Engine,
    opts?: {
      frames?: Buffer[];
      challenge?: LivenessChallenge;
      threshold?: number;
      activeLiveness?: { challenges: string[]; passed: boolean };
    }
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
        /** Revisión humana (cola in_review): sella revisor + momento de decisión. */
        reviewedBy?: string | null;
        reviewedAt?: Date | null;
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
    /** Lista los checks de una sesión (reconstrucción de la decisión en /confirm). */
    listBySession(
      tenantId: string,
      sessionId: string,
      exec?: Executor
    ): Promise<
      Array<{
        type: "quality" | "liveness" | "document" | "match";
        passed: boolean;
        detail: QualityResult | LivenessResult | DocumentResult | MatchResult;
      }>
    >;
    /** Borra los checks de una sesión (idempotencia de /preview). */
    deleteBySession(tenantId: string, sessionId: string, exec?: Executor): Promise<number>;
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
  /** Guarda una evidencia RECORTADA (rostro selfie / foto doc / frente enderezado). */
  saveCrop(
    tenantId: string,
    sessionId: string,
    type: EvidenceCropType,
    image: Buffer
  ): Promise<{ storagePath: string; sha256: string }>;
}

/**
 * Recorta/endereza el documento a su BORDE (sidecar OpenCV `/doc-crop`).
 * FAIL-OPEN: ante cualquier fallo devuelve la imagen original (nunca lanza).
 */
export interface DocCropper {
  crop(image: Buffer): Promise<Buffer>;
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
  /** Recorte/enderezado del documento al borde (sidecar). Opcional para tests. */
  docCropper?: DocCropper;
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

/**
 * Resuelve la policy EFECTIVA de una sesión: honra el LoA elegido POR SESIÓN
 * (`session.assuranceRequired`, snapshot tomado al crearla — p.ej. el nivel que
 * eligió el operador en "Probar verificación" o el `assurance_required` del request
 * del tenant) por encima del `assuranceRequired` de la policy del tenant.
 *
 * Antes el LoA lo fijaba SIEMPRE la policy del tenant, ignorando el nivel pedido por
 * la sesión (bug): el nivel elegido en el request no se aplicaba de verdad. Ahora
 * `needsMatch`/`needsLiveness` (qué módulos corren) y `decision()` (qué LoA se exige)
 * leen todos este `assuranceRequired` efectivo. El `?? policy` es defensivo: la
 * columna es NOT NULL y siempre se snapshotea, así que en la práctica el de la sesión
 * manda. El flujo por defecto no cambia: ahí sesión == policy.
 */
function effectivePolicy(
  session: VerificationSession,
  policy: TenantPolicy
): TenantPolicy {
  // P0 #1: si la sesión snapshoteó un workflow, ÉL define qué checks corren y con
  // qué umbrales (derivando el LoA equivalente). Sin snapshot (sesiones viejas o
  // default-virtual) se cae al comportamiento previo (LoA por sesión). Para los
  // workflows default-l1/-l2/-l3 ambos caminos dan idéntico resultado.
  if (session.workflowSnapshot) {
    return applyWorkflowToPolicy(policy, session.workflowSnapshot);
  }
  return { ...policy, assuranceRequired: session.assuranceRequired ?? policy.assuranceRequired };
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
  tenantPolicy: TenantPolicy,
  images: CapturedImages,
  deps: PipelineDeps
): Promise<PipelineOutput> {
  const { tenantId, id: sessionId } = session;
  // LoA por sesión: el nivel pedido por la sesión manda sobre el de la policy.
  const policy = effectivePolicy(session, tenantPolicy);

  try {
    // === 0) NORMALIZA DOCUMENTO PDF→imagen (cédula escaneada) ============== //
    // Si docFront/docBack llegaron como PDF, rasteriza a PNG ANTES de cualquier
    // módulo. Un solo punto: document + match + crop + evidencia ven la imagen.
    images = await rasterizeDocImages(images);

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
        activeLiveness: images.activeLiveness,
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
      // Embedding de la cara de la cédula. Primero el recorte ajustado; si SCRFD no
      // lo re-detecta (recorte sin contexto), caemos a la foto del FRENTE completa
      // (su única cara es el retrato) → SCRFD la encuentra con contexto suficiente.
      let docFaceEmb = document.docFaceCrop
        ? await deps.modules.embed(Buffer.from(document.docFaceCrop.base64Jpeg, "base64"))
        : null;
      if (!docFaceEmb) docFaceEmb = await deps.modules.embed(images.docFront);
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

    // === 5.bis) RUTEO A REVISIÓN HUMANA (cola in_review) — P0 #1 ========== //
    // Si el workflow lo pide (review:always | on_borderline), NO auto-decidimos:
    // persistimos checks+evidencia y dejamos la sesión en `in_review` con el
    // pre-veredicto como SUGERENCIA. Sin identidad, sin webhook. Un operador la
    // resuelve luego. Sólo aplica con snapshot de workflow (sesiones nuevas);
    // sin snapshot → comportamiento idéntico al actual (auto-decisión).
    if (
      shouldRouteToReview(session.workflowSnapshot, {
        match: matchRes?.cosine,
        liveness: liveness?.score,
      })
    ) {
      return await goToReview(deps, session, result, { checks, images });
    }

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

// ===========================================================================
// SPLIT compute / finalize — para el flujo /preview → review → /confirm.
//
// `computeChecks` corre quality→liveness→document→match, PERSISTE los checks +
// evidencia + recortes y deja la sesión en 'review'. NO decide, NO crea identidad,
// NO dispara webhook. Los rechazos duros (liveness/document/match) NO cortocircuitan
// a 'rejected': se acumulan y se muestran en revisión (wouldPass=false). Sólo el gate
// recuperable de quality (→ needs_recapture) sigue siendo divergente.
//
// `finalizeFromChecks` toma los checks YA computados, aplica decision(), crea la
// identidad si verified, dispara webhook y marca terminal (verified|rejected).
// ===========================================================================

/** Resultado de computeChecks: estado alcanzado + los checks para la pantalla de revisión. */
export interface ComputeOutput {
  state: SessionState; // "review" | "needs_recapture" | "rejected" (recaptura agotada) | "error"
  checks: PipelineChecks | null;
  reasons: string[];
}

/**
 * Recorta el ROSTRO de una imagen (engine SCRFD bbox + margen). Devuelve null si no
 * hay rostro. `margin` es la fracción del lado del bbox a expandir (0.4 = 40%).
 */
async function cropFace(
  engine: Engine,
  image: Buffer,
  margin: number
): Promise<Buffer | null> {
  const faces = await engine.detect(image);
  const face = engine.bestFace(faces);
  if (!face) return null;
  const [bx1, by1, bx2, by2] = face.bbox.map((v) => Math.round(v));
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return null;
  const mw = Math.round((bx2 - bx1) * margin);
  const mh = Math.round((by2 - by1) * margin);
  const left = Math.max(0, bx1 - mw);
  const top = Math.max(0, by1 - mh);
  const width = Math.min(W - left, bx2 - bx1 + 2 * mw);
  const height = Math.min(H - top, by2 - by1 + 2 * mh);
  if (width <= 0 || height <= 0) return null;
  return sharp(image).extract({ left, top, width, height }).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Guarda los 3 recortes de evidencia para la pantalla de revisión (no-throw):
 *   - selfie  → rostro de la selfie (SCRFD bbox + 40% margen).
 *   - doc_face→ foto del titular recortada del frente (la trae el módulo document).
 *   - doc_front→ frente del documento recortado/enderezado a su borde (sidecar).
 * Cada recorte es best-effort: un fallo individual NO rompe el preview (la foto
 * simplemente no se muestra). Los crops viven en keys SEPARADAS de los originales.
 */
async function persistCrops(
  deps: PipelineDeps,
  tenantId: string,
  sessionId: string,
  images: CapturedImages,
  document: DocumentResult
): Promise<void> {
  // 1) Selfie → rostro (40% margen).
  try {
    const faceCrop = await cropFace(deps.engine, images.selfie, 0.4);
    if (faceCrop) await deps.evidenceStore.saveCrop(tenantId, sessionId, "selfie", faceCrop);
  } catch (e) {
    console.warn(`[pipeline] crop selfie falló: ${(e as Error).message}`);
  }
  // 2) Doc-face (foto del titular del documento) — ya recortada por el módulo document.
  try {
    if (document.docFaceCrop) {
      await deps.evidenceStore.saveCrop(
        tenantId,
        sessionId,
        "doc_face",
        Buffer.from(document.docFaceCrop.base64Jpeg, "base64")
      );
    }
  } catch (e) {
    console.warn(`[pipeline] crop doc_face falló: ${(e as Error).message}`);
  }
  // 3) Frente del documento → recortado/enderezado al borde (sidecar; fail-open).
  try {
    const front = deps.docCropper ? await deps.docCropper.crop(images.docFront) : images.docFront;
    await deps.evidenceStore.saveCrop(tenantId, sessionId, "doc_front", front);
  } catch (e) {
    console.warn(`[pipeline] crop doc_front falló: ${(e as Error).message}`);
  }
}

/**
 * COMPUTA el pipeline sin decidir. Corre quality→liveness→document→match, persiste
 * todos los checks que corrieron + evidencia + recortes, y deja la sesión en 'review'.
 * Fail-closed: cualquier excepción → 'error'. El gate de quality recuperable sigue
 * yendo a needs_recapture (o rejected si se agotaron los reintentos), igual que en
 * processSession (ese flujo NO produce 'review').
 */
export async function computeChecks(
  session: VerificationSession,
  tenantPolicy: TenantPolicy,
  images: CapturedImages,
  deps: PipelineDeps
): Promise<ComputeOutput> {
  const { tenantId, id: sessionId } = session;
  // LoA por sesión: el nivel pedido por la sesión manda sobre el de la policy.
  const policy = effectivePolicy(session, tenantPolicy);
  try {
    // === 0) NORMALIZA DOCUMENTO PDF→imagen (cédula escaneada) ============== //
    // Si docFront/docBack llegaron como PDF, rasteriza a PNG ANTES de cualquier
    // módulo. Un solo punto: document + match + crop + evidencia ven la imagen.
    images = await rasterizeDocImages(images);

    // === 1) QUALITY (recuperable → needs_recapture) ======================= //
    const quality = await deps.modules.quality(
      images.selfie,
      deps.engine,
      policy.thresholds?.qualityGlassesPct
    );
    if (!quality.passed) {
      const out = await deps.withTransaction(async (tx) => {
        await deps.repos.checks.deleteBySession(tenantId, sessionId, tx);
        await deps.repos.checks.create(
          { tenantId, sessionId, type: "quality", score: quality.sharpness, passed: false, detail: quality },
          tx
        );
        await persistEvidence(deps, tenantId, sessionId, images, tx);
        const nextCount = session.recaptureCount + 1;
        const exceeded = nextCount > policy.maxRecaptureAttempts;
        if (exceeded) {
          const result: SessionResult = {
            decision: "rejected",
            loa: "L0",
            reasons: ["quality_failed", "max_recapture_attempts_exceeded", ...quality.reasons],
          };
          await deps.repos.sessions.update(
            tenantId,
            sessionId,
            { state: "rejected", recaptureCount: nextCount, result, completedAt: nowIso(), usedAt: new Date() },
            tx
          );
          await deps.repos.auditLog.record(
            { tenantId, sessionId, actor: "system", event: "pipeline.rejected", detail: { stage: "quality", reasons: quality.reasons } },
            tx
          );
          return { state: "rejected" as SessionState, reasons: result.reasons };
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
        return { state: "needs_recapture" as SessionState, reasons: quality.reasons };
      });
      // rejected por exceso de reintentos SÍ dispara webhook (terminal, igual que processSession).
      if (out.state === "rejected") {
        await safeWebhook(
          deps,
          { ...session, state: "rejected" },
          "session.rejected",
          { decision: "rejected", loa: "L0", reasons: out.reasons }
        );
      }
      return { state: out.state, checks: null, reasons: out.reasons };
    }

    // === 2) LIVENESS (NO cortocircuita — se acumula para la revisión) ====== //
    let liveness: LivenessResult | undefined;
    if (needsLiveness(policy)) {
      const challenge = policy.livenessChallenges[0];
      liveness = await deps.modules.liveness(images.selfie, deps.engine, {
        frames: images.frames,
        challenge,
        threshold: policy.thresholds?.livenessScore,
        activeLiveness: images.activeLiveness,
      });
    }

    // === 3) DOCUMENT (NO cortocircuita) =================================== //
    const document = await deps.modules.document(images.docFront, images.docBack);

    // === 4) MATCH (NO cortocircuita) — sólo si el LoA lo exige ============= //
    let matchRes: MatchResult | undefined;
    if (needsMatch(policy)) {
      const selfieEmb = await deps.modules.embed(images.selfie);
      let docFaceEmb = document.docFaceCrop
        ? await deps.modules.embed(Buffer.from(document.docFaceCrop.base64Jpeg, "base64"))
        : null;
      if (!docFaceEmb) docFaceEmb = await deps.modules.embed(images.docFront);
      if (selfieEmb && docFaceEmb) {
        matchRes = matchEmbeddings(selfieEmb, docFaceEmb, policy.thresholds?.matchCosine);
      } else {
        // Fail-closed: sin embeddings, match no superado (cosine 0). La decisión en
        // /confirm lo tratará como rechazo duro, pero el operador igual lo ve en revisión.
        matchRes = { cosine: 0, threshold: policy.thresholds?.matchCosine ?? 0, passed: false };
      }
    }

    const checks: PipelineChecks = { quality, document, match: matchRes, liveness };

    // Persistencia: checks (reemplazando previos) + evidencia + recortes → estado 'review'.
    await deps.withTransaction(async (tx) => {
      await deps.repos.checks.deleteBySession(tenantId, sessionId, tx);
      await persistAllChecks(deps, tenantId, sessionId, checks, tx);
      await persistEvidence(deps, tenantId, sessionId, images, tx);
      await deps.repos.sessions.update(tenantId, sessionId, { state: "review" }, tx);
      await deps.repos.auditLog.record(
        { tenantId, sessionId, actor: "system", event: "pipeline.review", detail: { docPassed: document.passed, matchPassed: matchRes?.passed, livenessPassed: liveness?.passed } },
        tx
      );
    });

    // Recortes de evidencia FUERA del tx (I/O de disco/sidecar; no sostener tx abierto).
    await persistCrops(deps, tenantId, sessionId, images, document);

    return { state: "review", checks, reasons: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await deps.withTransaction(async (tx) => {
        await deps.repos.sessions.update(tenantId, sessionId, { state: "error" }, tx);
        await deps.repos.auditLog.record(
          { tenantId, sessionId, actor: "system", event: "pipeline.error", detail: { message, stage: "compute" } },
          tx
        );
      });
    } catch {
      /* fail-closed: aunque no registremos, jamás verified */
    }
    return { state: "error", checks: null, reasons: ["system_error", message] };
  }
}

/**
 * FINALIZA desde 'review' con los checks YA computados. Reconstruye PipelineChecks
 * desde verification_checks, aplica decision(), crea verified_identity si verified
 * (re-infiriendo el embedding de la selfie original — el check de match sólo guardó
 * el coseno), marca terminal (verified|rejected), dispara webhook. Fail-closed.
 *
 * `selfie` es el buffer de la selfie original (para el embedding de la identidad).
 */
export async function finalizeFromChecks(
  session: VerificationSession,
  tenantPolicy: TenantPolicy,
  selfie: Buffer,
  deps: PipelineDeps
): Promise<PipelineOutput> {
  const { tenantId, id: sessionId } = session;
  // LoA por sesión: el nivel pedido por la sesión manda sobre el de la policy.
  const policy = effectivePolicy(session, tenantPolicy);
  try {
    // Reconstruye PipelineChecks desde la persistencia (computados por /preview).
    const rows = await deps.repos.checks.listBySession(tenantId, sessionId);
    const byType = new Map(rows.map((r) => [r.type, r]));
    const quality = byType.get("quality")?.detail as QualityResult | undefined;
    const document = byType.get("document")?.detail as DocumentResult | undefined;
    const match = byType.get("match")?.detail as MatchResult | undefined;
    const liveness = byType.get("liveness")?.detail as LivenessResult | undefined;
    if (!quality || !document) {
      // Sin checks base no se puede decidir → fail-closed (rechazo).
      const result: SessionResult = { decision: "rejected", loa: "L0", reasons: ["missing_checks"] };
      await deps.withTransaction(async (tx) => {
        await deps.repos.sessions.update(
          tenantId,
          sessionId,
          { state: "rejected", result, completedAt: nowIso(), usedAt: new Date() },
          tx
        );
        await deps.repos.auditLog.record(
          { tenantId, sessionId, actor: "system", event: "pipeline.rejected", detail: { stage: "confirm", reasons: result.reasons } },
          tx
        );
      });
      await safeWebhook(deps, { ...session, state: "rejected" }, "session.rejected", result);
      return { state: "rejected", result, reasons: result.reasons };
    }

    const checks: PipelineChecks = { quality, document, match, liveness };
    const verdict = decideVerdict(checks, policy);
    const result: SessionResult = {
      decision: verdict.verdict,
      loa: verdict.loa,
      reasons: verdict.reasons,
      extracted: extractedFrom(document),
      scores: { quality: quality.sharpness, liveness: liveness?.score, match: match?.cosine },
    };

    // Ruteo a revisión humana (P0 #1): igual que en processSession, pero los checks
    // ya fueron persistidos por computeChecks → goToReview no los re-persiste.
    if (
      shouldRouteToReview(session.workflowSnapshot, {
        match: match?.cosine,
        liveness: liveness?.score,
      })
    ) {
      return await goToReview(deps, session, result, {});
    }

    const finalState: SessionState = verdict.verdict === "verified" ? "verified" : "rejected";

    // Embedding de la identidad: el check de match no lo persiste (sólo el coseno),
    // así que se re-infiere de la selfie original cuando el veredicto es verified.
    const identityEmbedding =
      verdict.verdict === "verified" ? await deps.modules.embed(selfie) : null;

    await deps.withTransaction(async (tx) => {
      if (verdict.verdict === "verified" && identityEmbedding && result.extracted) {
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
            faceEmbedding: identityEmbedding,
          },
          tx
        );
      }
      await deps.repos.sessions.update(
        tenantId,
        sessionId,
        { state: finalState, result, completedAt: nowIso(), usedAt: new Date() },
        tx
      );
      await deps.repos.auditLog.record(
        { tenantId, sessionId, actor: "system", event: `pipeline.${finalState}`, detail: { loa: verdict.loa, reasons: verdict.reasons, stage: "confirm" } },
        tx
      );
    });

    await safeWebhook(
      deps,
      { ...session, state: finalState },
      verdict.verdict === "verified" ? "session.verified" : "session.rejected",
      result
    );
    return { state: finalState, result, reasons: verdict.reasons };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await deps.withTransaction(async (tx) => {
        await deps.repos.sessions.update(tenantId, sessionId, { state: "error", usedAt: new Date() }, tx);
        await deps.repos.auditLog.record(
          { tenantId, sessionId, actor: "system", event: "pipeline.error", detail: { message, stage: "finalize" } },
          tx
        );
      });
    } catch {
      /* fail-closed */
    }
    return { state: "error", result: null, reasons: ["system_error", message] };
  }
}

// ---------------------------------------------------------------------------
// Sub-rutinas.
// ---------------------------------------------------------------------------

/**
 * Motivos de rechazo del módulo `document`. El MRZ es INFORMATIVO (best-effort):
 * sus checks NUNCA producen motivos de rechazo. Excluimos:
 *   - el check `mrz_check_digits` de `authenticity.checks` (depende de mrz.valid);
 *   - el motivo legacy `doc:mrz_invalid` (eliminado por completo).
 * Sólo los cruces DUROS (campos impresos presentes, no vencido, foto) rechazan.
 */
const MRZ_SOFT_CHECKS = new Set(["mrz_check_digits", "mrz_vs_front_number", "mrz_vs_front_name"]);

function documentReasons(document: DocumentResult): string[] {
  const r = ["document_rejected"];
  for (const c of document.authenticity.checks) {
    if (!c.passed && !MRZ_SOFT_CHECKS.has(c.name)) r.push(`doc:${c.name}`);
  }
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
    // Imagen CRUDA del documento (exactamente lo que el módulo `document` OCR-ea, ya
    // rasterizada si vino PDF). ADITIVO: se persiste ADEMÁS de doc_front/doc_back para
    // poder debuggear el OCR real a partir de la imagen que lo produjo, no del recorte.
    ["doc_front_raw", images.docFront],
    ["doc_back_raw", images.docBack],
  ];
  for (const [type, buf] of items) {
    const saved = await deps.evidenceStore.save(tenantId, sessionId, type, buf);
    await deps.repos.evidence.create(
      { tenantId, sessionId, type, storagePath: saved.storagePath, sha256: saved.sha256 },
      tx
    );
  }
}

/**
 * Rutea a la COLA DE REVISIÓN HUMANA (P0 #1): deja la sesión en `in_review` con el
 * pre-veredicto como SUGERENCIA (result), SIN crear identidad ni disparar webhook.
 * Consume el token (el titular ya terminó; un operador resuelve luego, con su propia
 * auth). Si se pasan `checks`+`images` (camino processSession) los persiste; en
 * finalizeFromChecks ya fueron persistidos por computeChecks, así que se omiten.
 */
async function goToReview(
  deps: PipelineDeps,
  session: VerificationSession,
  suggestion: SessionResult,
  opts: { checks?: PipelineChecks; images?: CapturedImages }
): Promise<PipelineOutput> {
  const { tenantId, id: sessionId } = session;
  await deps.withTransaction(async (tx) => {
    if (opts.checks && opts.images) {
      await persistAllChecks(deps, tenantId, sessionId, opts.checks, tx);
      await persistEvidence(deps, tenantId, sessionId, opts.images, tx);
    }
    await deps.repos.sessions.update(
      tenantId,
      sessionId,
      // No terminal: NO se setea completedAt (lo hará el operador al decidir). El token
      // SÍ se consume (anti-replay): un reintento del titular exige nueva sesión.
      { state: "in_review", result: suggestion, usedAt: new Date() },
      tx
    );
    await deps.repos.auditLog.record(
      {
        tenantId,
        sessionId,
        actor: "system",
        event: "pipeline.in_review",
        detail: { suggestion: suggestion.decision, loa: suggestion.loa, reasons: suggestion.reasons },
      },
      tx
    );
  });
  return { state: "in_review", result: suggestion, reasons: suggestion.reasons };
}

/**
 * DECISIÓN DE REVISIÓN MANUAL (P0 #1): un operador resuelve una sesión `in_review`.
 * Reconstruye los checks persistidos, aplica la decisión humana (approve|decline),
 * crea verified_identity si aprueba (re-infiriendo el embedding de la selfie), marca
 * terminal (verified|rejected), sella revisor + reviewed_at y dispara webhook.
 * Fail-closed: cualquier excepción → 'error' (NUNCA verified).
 *
 * `selfie` es la selfie original (para el embedding de la identidad); puede ser null
 * si ya se purgó la evidencia: en ese caso se aprueba sin persistir biométrico.
 */
export async function applyReviewDecision(
  session: VerificationSession,
  tenantPolicy: TenantPolicy,
  selfie: Buffer | null,
  input: { decision: "approve" | "decline"; reviewer: string; reason?: string },
  deps: PipelineDeps
): Promise<PipelineOutput> {
  const { tenantId, id: sessionId } = session;
  const policy = effectivePolicy(session, tenantPolicy);
  try {
    const rows = await deps.repos.checks.listBySession(tenantId, sessionId);
    const byType = new Map(rows.map((r) => [r.type, r]));
    const quality = byType.get("quality")?.detail as QualityResult | undefined;
    const document = byType.get("document")?.detail as DocumentResult | undefined;
    const match = byType.get("match")?.detail as MatchResult | undefined;
    const liveness = byType.get("liveness")?.detail as LivenessResult | undefined;

    const approve = input.decision === "approve";
    const checks: PipelineChecks | null =
      quality && document ? { quality, document, match, liveness } : null;
    // LoA otorgado al APROBAR manualmente: el alcanzado por la escalera si llega, o el
    // requerido por la sesión (el operador acredita ese nivel). Decline → L0.
    const autoVerdict = checks ? decideVerdict(checks, policy) : null;
    const grantedLoa: SessionResult["loa"] = approve
      ? autoVerdict && autoVerdict.loa !== "L0"
        ? autoVerdict.loa
        : policy.assuranceRequired
      : "L0";
    const reasonTag = input.reason ? [`reason:${input.reason}`] : [];
    const result: SessionResult = {
      decision: approve ? "verified" : "rejected",
      loa: grantedLoa,
      reasons: approve
        ? ["manual_review_approved", ...reasonTag]
        : ["manual_review_declined", ...reasonTag],
      extracted: document ? extractedFrom(document) : undefined,
      scores: { quality: quality?.sharpness, liveness: liveness?.score, match: match?.cosine },
    };
    const finalState: SessionState = approve ? "verified" : "rejected";
    const identityEmbedding = approve && selfie ? await deps.modules.embed(selfie) : null;

    await deps.withTransaction(async (tx) => {
      if (approve && identityEmbedding && result.extracted) {
        await deps.repos.identities.create(
          {
            tenantId,
            sessionId,
            ci: result.extracted.ci,
            nombre: result.extracted.nombre,
            fechaNac: result.extracted.fechaNac,
            nacionalidad: result.extracted.nacionalidad,
            tipoDoc: "ci_py",
            assuranceLevel: grantedLoa,
            faceEmbedding: identityEmbedding,
          },
          tx
        );
      }
      await deps.repos.sessions.update(
        tenantId,
        sessionId,
        {
          state: finalState,
          result,
          completedAt: nowIso(),
          usedAt: new Date(),
          reviewedBy: input.reviewer,
          reviewedAt: new Date(),
        },
        tx
      );
      await deps.repos.auditLog.record(
        {
          tenantId,
          sessionId,
          actor: `admin:${input.reviewer}`,
          event: "session.reviewed",
          detail: { decision: input.decision, reason: input.reason ?? null, loa: grantedLoa },
        },
        tx
      );
    });

    await safeWebhook(
      deps,
      { ...session, state: finalState },
      approve ? "session.verified" : "session.rejected",
      result
    );
    return { state: finalState, result, reasons: result.reasons };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await deps.withTransaction(async (tx) => {
        await deps.repos.sessions.update(tenantId, sessionId, { state: "error" }, tx);
        await deps.repos.auditLog.record(
          { tenantId, sessionId, actor: "system", event: "pipeline.error", detail: { message, stage: "review" } },
          tx
        );
      });
    } catch {
      /* fail-closed */
    }
    return { state: "error", result: null, reasons: ["system_error", message] };
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
