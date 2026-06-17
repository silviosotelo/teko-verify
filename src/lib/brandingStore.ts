/**
 * Almacén on-prem del logo de marca por tenant (white-label P1 #5).
 *
 * Guarda el logo bajo <BRANDING_DIR>/<tenantId>.png normalizado con sharp (PNG,
 * ≤512×512, preserva transparencia). El logo NO es secreto: se sirve público vía
 * GET /branding/:tenantId/logo (server.ts). Sobreescribe (idempotente por tenant).
 */
import { promises as fsp } from "fs";
import path from "path";
import sharp from "sharp";

const BRANDING_DIR = process.env.TEKO_BRANDING_DIR || "/data/teko/branding";

/** uuid esperado; defensivo contra path-traversal. */
function fileFor(tenantId: string): string {
  const safe = tenantId.replace(/[^\w-]/g, "");
  return path.join(BRANDING_DIR, `${safe}.png`);
}

export class DiskBrandingStore {
  /** Normaliza el logo a PNG ≤512×512 y lo persiste. Lanza si la imagen es inválida. */
  async saveLogo(tenantId: string, image: Buffer): Promise<{ storagePath: string }> {
    await fsp.mkdir(BRANDING_DIR, { recursive: true });
    const png = await sharp(image)
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const file = fileFor(tenantId);
    await fsp.writeFile(file, png);
    return { storagePath: file };
  }

  /** Lee el logo del tenant (PNG) o null si no existe. */
  async readLogo(tenantId: string): Promise<Buffer | null> {
    try {
      return await fsp.readFile(fileFor(tenantId));
    } catch {
      return null;
    }
  }
}

export const brandingStore = new DiskBrandingStore();
