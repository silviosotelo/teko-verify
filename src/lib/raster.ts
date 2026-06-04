/**
 * Rasterización de PDF → imagen para el pipeline de documento.
 *
 * PROBLEMA: `sharp` (libvips) NO decodifica PDF. Muchas cédulas escaneadas llegan
 * como PDF (frente/dorso de un trámite). Si entra un PDF al pipeline de documento,
 * el OCR y el recorte de cara fallan. Este helper detecta PDF por MAGIC BYTES y lo
 * rasteriza a PNG ANTES de que la imagen alcance `documentModule.run`/`computeChecks`
 * y los endpoints admin.
 *
 * RASTERIZADOR: `pdftoppm` (poppler-utils) shelleado por stdin→stdout. Elegido sobre
 * un lib JS puro (pdfjs-dist + canvas) porque:
 *   - es la herramienta de rasterizado más robusta y madura (poppler);
 *   - liviano: un solo binario `apt-get install poppler-utils`, sin árbol npm pesado
 *     (pdfjs-dist + @napi-rs/canvas suman binarios nativos y superficie de fallo);
 *   - stdin→stdout: cero archivos temporales (sin /tmp ni limpieza, sin TOCTOU);
 *   - on-prem y determinista.
 * Requiere `poppler-utils` en la imagen runtime (ver Dockerfile).
 *
 * FAIL-CLOSED: si la rasterización falla (poppler ausente, PDF corrupto, exit≠0,
 * stdout vacío) este helper LANZA con un error claro; nunca devuelve el PDF crudo
 * (que reventaría sharp aguas abajo de forma opaca) ni una imagen vacía.
 *
 * MULTIPÁGINA: por alcance rasterizamos la PÁGINA pedida (default 1ª = frente). Las
 * cédulas escaneadas suelen traer frente y dorso en páginas separadas o ambas en una
 * sola página. Para extender a dorso: llamar `rasterizePdfPage(buf, 2)` y alimentar
 * esa imagen como `docBack`. El pipeline actual usa la 1ª página (frente; si el dorso
 * está en la misma página, el OCR del frente igual lee lo que haya arriba).
 */
import { spawn } from "node:child_process";

/** Magic bytes de un PDF: "%PDF" (0x25 0x50 0x44 0x46). */
export function isPdf(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46
  );
}

/** DPI de rasterización (200-300 es el rango legible para PaddleOCR). Configurable. */
const RASTER_DPI = parseInt(process.env.TEKO_PDF_RASTER_DPI || "200", 10);

/**
 * Puerto inyectable: rasteriza la página `page` (1-based) de un PDF a un buffer PNG.
 * La implementación real shellea `pdftoppm`; los tests inyectan un stub para no
 * depender de poppler en CI.
 */
export interface PdfRasterizer {
  rasterize(pdf: Buffer, page: number): Promise<Buffer>;
}

/**
 * Rasterizador real con `pdftoppm` (poppler) por stdin→stdout.
 * Comando: `pdftoppm -png -r <dpi> -f <page> -l <page> -singlefile -`.
 *   -png        salida PNG (sin pérdida; sharp lo decodifica nativo)
 *   -r <dpi>    resolución
 *   -f/-l <p>   sólo la página `p` (first=last)
 *   -singlefile escribe a stdout sin sufijo de página
 *   -           lee el PDF de stdin
 * FAIL-CLOSED: exit≠0 o stdout vacío → rechaza.
 */
export const popplerRasterizer: PdfRasterizer = {
  rasterize(pdf: Buffer, page: number): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const args = [
        "-png",
        "-r",
        String(RASTER_DPI),
        "-f",
        String(page),
        "-l",
        String(page),
        "-singlefile",
        "-",
      ];
      const child = spawn("pdftoppm", args, { stdio: ["pipe", "pipe", "pipe"] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", (d: Buffer) => err.push(d));
      child.on("error", (e) =>
        reject(new Error(`pdftoppm no disponible: ${(e as Error).message}`))
      );
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `pdftoppm exit ${code}: ${Buffer.concat(err).toString().trim() || "(sin stderr)"}`
            )
          );
          return;
        }
        const png = Buffer.concat(out);
        if (png.length === 0) {
          reject(new Error("pdftoppm devolvió stdout vacío (PDF ilegible)"));
          return;
        }
        resolve(png);
      });
      child.stdin.on("error", () => {
        /* EPIPE si el hijo muere antes de leer todo el stdin: lo maneja 'close'/'error' */
      });
      child.stdin.end(pdf);
    });
  },
};

/**
 * Rasteriza la página `page` (1-based, default 1) de un PDF a PNG. Helper directo
 * para el caller que YA sabe que el buffer es PDF (p.ej. extraer el dorso de la
 * página 2). Inyecta `rasterizer` en tests.
 */
export async function rasterizePdfPage(
  pdf: Buffer,
  page = 1,
  rasterizer: PdfRasterizer = popplerRasterizer
): Promise<Buffer> {
  return rasterizer.rasterize(pdf, page);
}

/**
 * Garantiza que el buffer sea una IMAGEN raster que sharp pueda decodificar:
 *   - PDF (magic `%PDF`) → rasteriza la 1ª página a PNG (~200 DPI) y la devuelve.
 *   - cualquier otra cosa (JPEG/PNG/…) → PASSTHROUGH, devuelve el buffer tal cual
 *     (identidad de referencia: las imágenes normales no se tocan).
 *
 * FAIL-CLOSED: si la rasterización del PDF falla, propaga el error (no devuelve el
 * PDF crudo). El caller debe traducirlo a un 4xx/rechazo claro.
 *
 * Llamar en CADA punto donde una imagen de documento entra al pipeline:
 *   - `computeChecks`/`processSession` (normaliza docFront/docBack una sola vez,
 *     así document + match + crop + evidencia reciben todos la imagen).
 *   - endpoints admin `ocr-debug` y `test-verify`.
 */
export async function ensureRasterImage(
  buf: Buffer,
  rasterizer: PdfRasterizer = popplerRasterizer
): Promise<Buffer> {
  if (!isPdf(buf)) return buf;
  return rasterizePdfPage(buf, 1, rasterizer);
}
