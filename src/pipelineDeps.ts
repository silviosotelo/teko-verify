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
import { documentModule, defaultDocumentDeps, upscaleForOcr } from "./modules/document";
import { evidenceStore } from "./lib/evidenceStore";
import { webhookSender } from "./lib/webhook";
import { OCR_SIDECAR_URL } from "./config";
import type { DocCropper, PipelineDeps, PipelineModules } from "./pipeline";

/**
 * DocCropper real: recorta/endereza el frente del documento a su borde vía el sidecar
 * OpenCV (POST {OCR_SIDECAR_URL}/doc-crop). FAIL-OPEN: ante cualquier error (sidecar
 * caído, HTTP no-2xx, respuesta inválida) devuelve la imagen original sin lanzar.
 */
async function docCrop(image: Buffer): Promise<Buffer> {
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
}

const realDocCropper: DocCropper = {
  crop: docCrop,
};

/**
 * Preprocesa el FRENTE para la lectura OCR de campos: lo AMPLÍA a ≥1600px de
 * ancho (resize-up Lanczos3) si es más chico. El texto ampliado es más legible
 * para PaddleOCR en capturas de celular comprimidas/chicas (caso real: apellido
 * no leído). FAIL-OPEN: ante cualquier error devuelve el frente original.
 *
 * DELIBERADAMENTE NO usa el doc-crop (deskew/perspectiva) acá: el anclaje
 * etiqueta→valor del frente usa umbrales en PÍXELES ABSOLUTOS tuneados al frame
 * vertical nativo del celular (~900×1600). El warpPerspective del doc-crop puede
 * rotar el portrait a landscape (~1600×992), cambiando aspecto/orientación y
 * ROMPIENDO el anclaje (validado contra la imagen real: doc-crop vaciaba
 * apellidos + fechaNacimiento; sólo-upscale preserva TODOS los campos idénticos
 * al baseline). El upscale conserva el aspecto, así que el anclaje sobrevive.
 */
async function preprocessFrontForOcr(front: Buffer): Promise<Buffer> {
  return upscaleForOcr(front, 1600);
}

/** Adaptador de los módulos reales a la interfaz `PipelineModules` del pipeline. */
const modules: PipelineModules = {
  quality: (image, eng, glassesMax) => qualityModule.run(image, eng, glassesMax),
  liveness: (selfie, eng, opts) => livenessModule.run(selfie, eng, opts),
  document: (front, back) =>
    documentModule.run(front, back, {
      ...defaultDocumentDeps(engine),
      preprocessFront: preprocessFrontForOcr,
    }),
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
