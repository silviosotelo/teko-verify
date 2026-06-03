/**
 * Cableado de las dependencias REALES del pipeline (on-prem).
 *
 * Centraliza la construcción de `PipelineDeps` para que server.ts y los routers
 * compartan exactamente el mismo wiring. El pipeline.test.ts NO usa este módulo:
 * inyecta mocks directamente (ese es el punto del seam de inyección).
 */
import { engine } from "./engine";
import { repos } from "./db/repos";
import { withTransaction } from "./db/pool";
import { qualityModule } from "./modules/quality";
import { livenessModule } from "./modules/liveness";
import { documentModule, defaultDocumentDeps } from "./modules/document";
import { evidenceStore } from "./lib/evidenceStore";
import { webhookSender } from "./lib/webhook";
import type { PipelineDeps, PipelineModules } from "./pipeline";

/** Adaptador de los módulos reales a la interfaz `PipelineModules` del pipeline. */
const modules: PipelineModules = {
  quality: (image, eng, glassesMax) => qualityModule.run(image, eng, glassesMax),
  liveness: (selfie, eng, opts) => livenessModule.run(selfie, eng, opts),
  document: (front, back) => documentModule.run(front, back, defaultDocumentDeps(engine)),
  embed: async (image) => {
    const r = await engine.embedBestFace(image);
    return r ? r.embedding : null;
  },
};

/** Dependencias reales listas para inyectar en processSession(). */
export const realPipelineDeps: PipelineDeps = {
  modules,
  repos: {
    sessions: { update: repos.sessions.update },
    checks: { create: repos.checks.create },
    identities: { create: repos.identities.create },
    evidence: { create: repos.evidence.create },
    auditLog: { record: repos.auditLog.record },
  },
  engine,
  evidenceStore,
  webhook: webhookSender,
  withTransaction,
};
