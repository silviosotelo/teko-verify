/**
 * Tests de integración del pipeline (§10).
 *
 * Estrategia: el seam de inyección permite probar la ORQUESTACIÓN completa con
 * mocks puros — sin onnxruntime, sin sidecar OCR, sin Postgres. Se inyectan módulos
 * fake (que devuelven QualityResult/LivenessResult/... a pedido), repos espía (que
 * acumulan llamadas en memoria) y un withTransaction que ejecuta el callback con un
 * "cliente" trivial. Así se asertan:
 *   - camino verified (crea identidad, webhook session.verified, checks persistidos)
 *   - rejected (liveness/document/match) + webhook session.rejected
 *   - needs_recapture (sin webhook) y rejected por exceso de reintentos
 *   - fail-closed: un módulo que lanza → state 'error', NUNCA verified, sin webhook
 *   - aislamiento: todas las escrituras llevan el tenantId de la sesión
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { processSession, applyReviewDecision } from "./pipeline";
import type {
  CapturedImages,
  PipelineDeps,
  PipelineModules,
} from "./pipeline";
import { workflowDefForLoA } from "./lib/workflow";
import type {
  DocumentResult,
  LivenessResult,
  MatchResult,
  PipelineChecks,
  QualityResult,
  TenantPolicy,
  VerificationSession,
  WorkflowDefinition,
} from "./types";

// ----------------------------- fixtures ----------------------------------- //

const TENANT_ID = "tenant-aaa";
const SESSION_ID = "session-123";

function makeSession(over: Partial<VerificationSession> = {}): VerificationSession {
  return {
    id: SESSION_ID,
    tenantId: TENANT_ID,
    externalRef: "ext-1",
    state: "processing",
    linkToken: "tok",
    callbackUrl: "https://tenant.example/webhook",
    assuranceRequired: "L3",
    redirectUrl: null,
    locale: "es",
    recaptureCount: 0,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    completedAt: null,
    result: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function makePolicy(over: Partial<TenantPolicy> = {}): TenantPolicy {
  return {
    assuranceRequired: "L3",
    retentionDays: 90,
    livenessChallenges: [],
    consentText: "consent",
    consentVersion: "1.0",
    maxRecaptureAttempts: 3,
    linkTokenTtlSeconds: 900,
    thresholds: {},
    ...over,
  };
}

const IMAGES: CapturedImages = {
  selfie: Buffer.from("selfie"),
  docFront: Buffer.from("front"),
  docBack: Buffer.from("back"),
};

const PASS_QUALITY: QualityResult = {
  faceOk: true,
  brightness: 0.5,
  sharpness: 120,
  pose: { yaw: 2, pitch: 1, roll: 0 },
  glassesPct: 0.05,
  passed: true,
  reasons: [],
};

const FAIL_QUALITY: QualityResult = {
  ...PASS_QUALITY,
  passed: false,
  reasons: ["blur"],
  sharpness: 10,
};

const PASS_LIVENESS: LivenessResult = { score: 0.95, passed: true, attackType: "none" };
const FAIL_LIVENESS: LivenessResult = { score: 0.1, passed: false, attackType: "replay" };

function makeDocument(passed: boolean): DocumentResult {
  return {
    documentType: "ci_py",
    mrz: {
      rawLines: ["L1", "L2", "L3"],
      documentType: "I",
      issuingCountry: "PRY",
      documentNumber: "1234567",
      surname: "PEREZ",
      givenNames: "JUAN",
      nationality: "PRY",
      dateOfBirth: "1990-05-10",
      sex: "M",
      expirationDate: "2030-05-10",
      checkDigits: { documentNumber: passed, dateOfBirth: passed, expirationDate: passed, composite: passed },
      valid: passed,
    },
    barcode: { format: "CODE_128", text: "1234567" },
    ocr: { rawText: "PEREZ JUAN 1234567", fields: { documentNumber: "1234567", surname: "PEREZ" }, confidence: 0.9 },
    docFaceCrop: passed ? { base64Jpeg: Buffer.from("docface").toString("base64"), bbox: [0, 0, 10, 10] } : null,
    authenticity: {
      consistent: passed,
      checks: [{ name: "check_digits", passed }],
    },
    passed,
  };
}

// ------------------------- mocks de dependencias --------------------------- //

interface SpyState {
  checks: Array<{ tenantId: string; type: string; passed: boolean }>;
  identities: Array<{ tenantId: string; ci: string }>;
  evidence: Array<{ tenantId: string; type: string }>;
  audit: Array<{ tenantId: string; event: string }>;
  sessionUpdates: Array<{ tenantId: string; state?: string; recaptureCount?: number; reviewedBy?: string | null }>;
  webhooks: Array<{ event: string; state: string }>;
}

function makeDeps(
  modules: PipelineModules,
  spy: SpyState,
  /** Checks que devuelve checks.listBySession (reconstrucción en finalize/review). */
  listChecks: Array<{ type: "quality" | "liveness" | "document" | "match"; passed: boolean; detail: unknown }> = []
): PipelineDeps {
  const fakeClient = {} as never; // el cliente de tx no se usa en los mocks
  return {
    modules,
    engine: {} as never, // los módulos fake no tocan el engine
    repos: {
      sessions: {
        update: async (tenantId, _id, patch) => {
          spy.sessionUpdates.push({
            tenantId,
            state: patch.state,
            recaptureCount: patch.recaptureCount,
            reviewedBy: patch.reviewedBy,
          });
          return makeSession({ tenantId, state: patch.state ?? "processing" });
        },
      },
      checks: {
        create: async (input) => {
          spy.checks.push({ tenantId: input.tenantId, type: input.type, passed: input.passed });
          return {};
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        listBySession: async () => listChecks as any,
      },
      identities: {
        create: async (input) => {
          spy.identities.push({ tenantId: input.tenantId, ci: input.ci });
          return {};
        },
      },
      evidence: {
        create: async (input) => {
          spy.evidence.push({ tenantId: input.tenantId, type: input.type });
          return {};
        },
      },
      auditLog: {
        record: async (input) => {
          spy.audit.push({ tenantId: input.tenantId, event: input.event });
          return {};
        },
      },
    },
    evidenceStore: {
      save: async (_t, _s, type) => ({ storagePath: `/data/${type}.jpg`, sha256: "deadbeef" }),
    },
    webhook: {
      send: async (session, event) => {
        // Capturamos el state de la sesión tal como llega al webhook: debe ser el
        // estado TERMINAL (verified/rejected), nunca "processing".
        spy.webhooks.push({ event, state: session.state });
      },
    },
    withTransaction: async (fn) => fn(fakeClient),
  };
}

function freshSpy(): SpyState {
  return { checks: [], identities: [], evidence: [], audit: [], sessionUpdates: [], webhooks: [] };
}

/** Construye un PipelineModules con embeddings que matchean (mismo vector) o no. */
function modulesFor(opts: {
  quality: QualityResult;
  liveness?: LivenessResult;
  document: DocumentResult;
  match: "pass" | "fail";
  throwIn?: "quality" | "liveness" | "document";
}): PipelineModules {
  const same = new Float32Array([1, 0, 0]);
  const diff = new Float32Array([0, 1, 0]);
  return {
    quality: async () => {
      if (opts.throwIn === "quality") throw new Error("boom-quality");
      return opts.quality;
    },
    liveness: async () => {
      if (opts.throwIn === "liveness") throw new Error("boom-liveness");
      return opts.liveness ?? PASS_LIVENESS;
    },
    document: async () => {
      if (opts.throwIn === "document") throw new Error("boom-document");
      return opts.document;
    },
    embed: async (image: Buffer) => {
      // selfie y docface devuelven mismo vector si match=pass, distinto si fail.
      if (opts.match === "pass") return same;
      // selfie = same, docface = diff → coseno bajo.
      return image.toString("base64") === Buffer.from("selfie").toString("base64") ? same : diff;
    },
  };
}

// -------------------------------- tests ------------------------------------ //

describe("processSession — camino verified (L3)", () => {
  let spy: SpyState;
  beforeEach(() => {
    spy = freshSpy();
  });

  it("verifica, crea identidad, persiste checks/evidencia y dispara session.verified", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, liveness: PASS_LIVENESS, document: makeDocument(true), match: "pass" });
    const out = await processSession(makeSession(), makePolicy(), IMAGES, makeDeps(modules, spy));

    expect(out.state).toBe("verified");
    expect(out.result?.decision).toBe("verified");
    expect(out.result?.loa).toBe("L3");
    // 4 checks (quality, liveness, document, match).
    expect(spy.checks.map((c) => c.type).sort()).toEqual(["document", "liveness", "match", "quality"]);
    expect(spy.checks.every((c) => c.passed)).toBe(true);
    // identidad creada con el CI del MRZ.
    expect(spy.identities).toEqual([{ tenantId: TENANT_ID, ci: "1234567" }]);
    // evidencia: selfie + doc_front + doc_back + las crudas doc_front_raw/doc_back_raw.
    expect(spy.evidence.map((e) => e.type).sort()).toEqual([
      "doc_back",
      "doc_back_raw",
      "doc_front",
      "doc_front_raw",
      "selfie",
    ]);
    // webhook verified, exactamente uno.
    expect(spy.webhooks).toEqual([{ event: "session.verified", state: "verified" }]);
    // aislamiento: todas las escrituras con el tenant de la sesión.
    expect(spy.checks.every((c) => c.tenantId === TENANT_ID)).toBe(true);
    expect(spy.sessionUpdates.some((u) => u.state === "verified")).toBe(true);
  });

  it("L1 verifica con sólo quality+document (sin match ni liveness)", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, document: makeDocument(true), match: "pass" });
    const out = await processSession(makeSession({ assuranceRequired: "L1" }), makePolicy({ assuranceRequired: "L1" }), IMAGES, makeDeps(modules, spy));
    expect(out.state).toBe("verified");
    expect(out.result?.loa).toBe("L1");
    // No corre match ni liveness para L1.
    expect(spy.checks.map((c) => c.type).sort()).toEqual(["document", "quality"]);
    expect(spy.identities).toHaveLength(1);
  });
});

describe("processSession — needs_recapture / rejected por calidad", () => {
  let spy: SpyState;
  beforeEach(() => {
    spy = freshSpy();
  });

  it("quality falla con reintentos disponibles → needs_recapture, SIN webhook", async () => {
    const modules = modulesFor({ quality: FAIL_QUALITY, document: makeDocument(true), match: "pass" });
    const out = await processSession(makeSession({ recaptureCount: 0 }), makePolicy({ maxRecaptureAttempts: 3 }), IMAGES, makeDeps(modules, spy));

    expect(out.state).toBe("needs_recapture");
    expect(out.result).toBeNull();
    expect(spy.webhooks).toEqual([]); // sin webhook en recaptura
    expect(spy.sessionUpdates.some((u) => u.state === "needs_recapture" && u.recaptureCount === 1)).toBe(true);
    // sólo el check de quality, y no se evaluaron módulos posteriores.
    expect(spy.checks.map((c) => c.type)).toEqual(["quality"]);
    expect(spy.identities).toHaveLength(0);
  });

  it("quality falla y se supera maxRecaptureAttempts → rejected + webhook session.rejected", async () => {
    const modules = modulesFor({ quality: FAIL_QUALITY, document: makeDocument(true), match: "pass" });
    // recaptureCount=3, max=3 → nextCount=4 > 3 → rejected.
    const out = await processSession(makeSession({ recaptureCount: 3 }), makePolicy({ maxRecaptureAttempts: 3 }), IMAGES, makeDeps(modules, spy));

    expect(out.state).toBe("rejected");
    expect(out.result?.decision).toBe("rejected");
    expect(out.result?.loa).toBe("L0");
    expect(spy.webhooks).toEqual([{ event: "session.rejected", state: "rejected" }]);
  });
});

describe("processSession — rechazos duros", () => {
  let spy: SpyState;
  beforeEach(() => {
    spy = freshSpy();
  });

  it("liveness falla → rejected + webhook, sin correr document/match", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, liveness: FAIL_LIVENESS, document: makeDocument(true), match: "pass" });
    const out = await processSession(makeSession(), makePolicy(), IMAGES, makeDeps(modules, spy));

    expect(out.state).toBe("rejected");
    expect(out.result?.loa).toBe("L0");
    expect(spy.webhooks).toEqual([{ event: "session.rejected", state: "rejected" }]);
    // se persistió el check de liveness (fallido); no hay identidad.
    expect(spy.checks.some((c) => c.type === "liveness" && !c.passed)).toBe(true);
    expect(spy.checks.some((c) => c.type === "document")).toBe(false);
    expect(spy.identities).toHaveLength(0);
  });

  it("document falla (inconsistente) → rejected + webhook", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, liveness: PASS_LIVENESS, document: makeDocument(false), match: "pass" });
    const out = await processSession(makeSession(), makePolicy(), IMAGES, makeDeps(modules, spy));

    expect(out.state).toBe("rejected");
    expect(spy.webhooks).toEqual([{ event: "session.rejected", state: "rejected" }]);
    expect(spy.identities).toHaveLength(0);
  });

  it("match falla (rostros distintos) → rejected + webhook", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, liveness: PASS_LIVENESS, document: makeDocument(true), match: "fail" });
    const out = await processSession(makeSession(), makePolicy(), IMAGES, makeDeps(modules, spy));

    expect(out.state).toBe("rejected");
    expect(out.result?.reasons.some((r) => r.startsWith("face_match_failed"))).toBe(true);
    expect(spy.webhooks).toEqual([{ event: "session.rejected", state: "rejected" }]);
    expect(spy.identities).toHaveLength(0);
  });
});

describe("processSession — fail-closed ante excepción", () => {
  let spy: SpyState;
  beforeEach(() => {
    spy = freshSpy();
  });

  it("un módulo que lanza → state 'error', NUNCA verified, sin webhook", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, liveness: PASS_LIVENESS, document: makeDocument(true), match: "pass", throwIn: "document" });
    const out = await processSession(makeSession(), makePolicy(), IMAGES, makeDeps(modules, spy));

    expect(out.state).toBe("error");
    expect(out.result).toBeNull();
    expect(spy.webhooks).toEqual([]); // jamás webhook en error
    expect(spy.identities).toHaveLength(0);
    // se registró el error en auditoría y se marcó la sesión en error.
    expect(spy.audit.some((a) => a.event === "pipeline.error")).toBe(true);
    expect(spy.sessionUpdates.some((u) => u.state === "error")).toBe(true);
  });

  it("quality que lanza → error (no needs_recapture)", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, document: makeDocument(true), match: "pass", throwIn: "quality" });
    const out = await processSession(makeSession(), makePolicy(), IMAGES, makeDeps(modules, spy));
    expect(out.state).toBe("error");
    expect(spy.webhooks).toEqual([]);
  });
});

describe("processSession — workflows + ruteo a in_review (P0 #1)", () => {
  let spy: SpyState;
  beforeEach(() => {
    spy = freshSpy();
  });

  it("workflow review:always → in_review (sin identidad ni webhook), checks persistidos + sugerencia", async () => {
    const snapshot: WorkflowDefinition = {
      document: { required: true },
      match: { required: true },
      liveness: { required: true, mode: "active" },
      review: { mode: "always" },
    };
    const modules = modulesFor({ quality: PASS_QUALITY, liveness: PASS_LIVENESS, document: makeDocument(true), match: "pass" });
    const out = await processSession(makeSession({ workflowSnapshot: snapshot }), makePolicy(), IMAGES, makeDeps(modules, spy));

    expect(out.state).toBe("in_review");
    // El pre-veredicto (verified) viaja como SUGERENCIA en result.
    expect(out.result?.decision).toBe("verified");
    expect(spy.identities).toHaveLength(0);
    expect(spy.webhooks).toEqual([]);
    expect(spy.checks.map((c) => c.type).sort()).toEqual(["document", "liveness", "match", "quality"]);
    expect(spy.sessionUpdates.some((u) => u.state === "in_review")).toBe(true);
    expect(spy.audit.some((a) => a.event === "pipeline.in_review")).toBe(true);
  });

  it("snapshot default L3 (review auto) → idéntico: verified + identidad + webhook (no-regresión)", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, liveness: PASS_LIVENESS, document: makeDocument(true), match: "pass" });
    const out = await processSession(
      makeSession({ workflowSnapshot: workflowDefForLoA("L3") }),
      makePolicy(),
      IMAGES,
      makeDeps(modules, spy)
    );
    expect(out.state).toBe("verified");
    expect(out.result?.loa).toBe("L3");
    expect(spy.identities).toHaveLength(1);
    expect(spy.webhooks).toEqual([{ event: "session.verified", state: "verified" }]);
  });
});

describe("applyReviewDecision — decisión humana (P0 #1)", () => {
  let spy: SpyState;
  beforeEach(() => {
    spy = freshSpy();
  });

  const listChecks = [
    { type: "quality" as const, passed: true, detail: PASS_QUALITY },
    { type: "document" as const, passed: true, detail: makeDocument(true) },
    { type: "match" as const, passed: true, detail: { cosine: 0.5, threshold: 0.4, passed: true } as MatchResult },
    { type: "liveness" as const, passed: true, detail: PASS_LIVENESS },
  ];

  it("approve → verified, crea identidad, sella revisor, webhook session.verified", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, document: makeDocument(true), match: "pass" });
    const deps = makeDeps(modules, spy, listChecks);
    const out = await applyReviewDecision(
      makeSession({ state: "in_review" }),
      makePolicy(),
      Buffer.from("selfie"),
      { decision: "approve", reviewer: "op-1", reason: "ok manual" },
      deps
    );
    expect(out.state).toBe("verified");
    expect(out.result?.decision).toBe("verified");
    expect(spy.identities).toHaveLength(1);
    expect(spy.webhooks).toEqual([{ event: "session.verified", state: "verified" }]);
    expect(spy.sessionUpdates.some((u) => u.reviewedBy === "op-1")).toBe(true);
    expect(spy.audit.some((a) => a.event === "session.reviewed")).toBe(true);
  });

  it("decline → rejected, sin identidad, webhook session.rejected", async () => {
    const modules = modulesFor({ quality: PASS_QUALITY, document: makeDocument(true), match: "pass" });
    const deps = makeDeps(modules, spy, listChecks);
    const out = await applyReviewDecision(
      makeSession({ state: "in_review" }),
      makePolicy(),
      Buffer.from("selfie"),
      { decision: "decline", reviewer: "op-1" },
      deps
    );
    expect(out.state).toBe("rejected");
    expect(spy.identities).toHaveLength(0);
    expect(spy.webhooks).toEqual([{ event: "session.rejected", state: "rejected" }]);
  });
});
