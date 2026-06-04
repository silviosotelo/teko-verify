/**
 * EvidenceStore on-prem: guarda imágenes en disco/CIFS (patrón v9) bajo
 * <EVIDENCE_DIR>/<tenantId>/<sessionId>/<type>.jpg y devuelve ruta + sha256
 * (cadena de custodia §12). También sirve como buffer de uploads: la captura sube
 * selfie/doc por separado y el submit los relee desde acá.
 *
 * Implementa el contrato `EvidenceStore` del pipeline. El job de retención (§11)
 * borra por tenant/sesión según policy.
 */
import { createHash } from "crypto";
import { promises as fsp } from "fs";
import path from "path";
import sharp from "sharp";
import type { EvidenceType, EvidenceCropType } from "../types";

const EVIDENCE_DIR = process.env.TEKO_EVIDENCE_DIR || "/data/teko/evidence";

function dirFor(tenantId: string, sessionId: string): string {
  // Sanea componentes (uuid esperado, pero defensivo).
  const safe = (s: string) => s.replace(/[^\w-]/g, "");
  return path.join(EVIDENCE_DIR, safe(tenantId), safe(sessionId));
}

export class DiskEvidenceStore {
  /** Guarda una imagen como JPEG normalizado; devuelve ruta relativa + sha256. */
  async save(
    tenantId: string,
    sessionId: string,
    type: EvidenceType,
    image: Buffer
  ): Promise<{ storagePath: string; sha256: string }> {
    const dir = dirFor(tenantId, sessionId);
    await fsp.mkdir(dir, { recursive: true });
    const jpg = await sharp(image)
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    const sha256 = createHash("sha256").update(jpg).digest("hex");
    const file = path.join(dir, `${type}.jpg`);
    await fsp.writeFile(file, jpg);
    return { storagePath: file, sha256 };
  }

  /** Relee una imagen previamente subida (para el submit). Null si no existe. */
  async read(tenantId: string, sessionId: string, type: EvidenceType): Promise<Buffer | null> {
    try {
      return await fsp.readFile(path.join(dirFor(tenantId, sessionId), `${type}.jpg`));
    } catch {
      return null;
    }
  }

  /**
   * Guarda una EVIDENCIA RECORTADA (rostro de la selfie, foto del documento, frente
   * enderezado) bajo `crop_<type>.jpg`. Key SEPARADA de los originales: el pipeline
   * re-lee los originales (selfie/doc_front) para quality/liveness/OCR; los crops son
   * sólo para mostrar en la pantalla de revisión. Idempotente (sobreescribe).
   * El JPEG llega ya recortado; sólo se normaliza la calidad.
   */
  async saveCrop(
    tenantId: string,
    sessionId: string,
    type: EvidenceCropType,
    image: Buffer
  ): Promise<{ storagePath: string; sha256: string }> {
    const dir = dirFor(tenantId, sessionId);
    await fsp.mkdir(dir, { recursive: true });
    const jpg = await sharp(image)
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    const sha256 = createHash("sha256").update(jpg).digest("hex");
    const file = path.join(dir, `crop_${type}.jpg`);
    await fsp.writeFile(file, jpg);
    return { storagePath: file, sha256 };
  }

  /** Relee una evidencia recortada. Null si no existe. */
  async readCrop(
    tenantId: string,
    sessionId: string,
    type: EvidenceCropType
  ): Promise<Buffer | null> {
    try {
      return await fsp.readFile(path.join(dirFor(tenantId, sessionId), `crop_${type}.jpg`));
    } catch {
      return null;
    }
  }

  /** Borra toda la evidencia de una sesión (retención/supresión §12). */
  async purge(tenantId: string, sessionId: string): Promise<void> {
    await fsp.rm(dirFor(tenantId, sessionId), { recursive: true, force: true });
  }
}

export const evidenceStore = new DiskEvidenceStore();
