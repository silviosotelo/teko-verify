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
import { OCR_SIDECAR_URL } from "./config";
import type { DocCropper, PipelineDeps, PipelineModules } from "./pipeline";

/**
 * DocCropper real: recorta/endereza el frente del documento a su borde vía el sidecar
 * OpenCV (POST {OCR_SIDECAR_URL}/doc-crop). FAIL-OPEN: ante cualquier error (sidecar
 * caído, HTTP no-2xx, respuesta inválida) devuelve la imagen original sin lanzar.
 */
const realDocCropper: DocCropper = {
  async crop(image: Buffer): Promise<Buffer> {
    try {
      const res = await fetch(`${OCR_SIDECAR_URL}/doc-crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: image.toString("base64") }),
      });
      if (!res.ok) return image;
      const data = (await res.json()) as { image?: unknown };
      if (typeof data.image !== "string" || !data.image) return image;
      const buf = Buffer.from(data.image, "base64");
      return buf.length > 0 ? buf : image;
    } catch {
      return image;
    }
  },
};

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
    checks: {
      create: repos.checks.create,
      listBySession: repos.checks.listBySession,
      deleteBySession: repos.checks.deleteBySession,
    },
    identities: { create: repos.identities.create },
    evidence: { create: repos.evidence.create },
    auditLog: { record: repos.auditLog.record },
  },
  engine,
  evidenceStore,
  webhook: webhookSender,
  withTransaction,
  docCropper: realDocCropper,
};
