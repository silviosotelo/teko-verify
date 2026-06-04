/**
 * Tests de lib/raster.ts — detección de PDF por magic bytes y passthrough de imagen.
 *
 * NO depende de poppler: inyecta un rasterizador stub. Verifica el comportamiento de
 * DECISIÓN (detectar PDF vs imagen) y de DELEGACIÓN (qué buffer/página recibe el
 * rasterizador), que es la lógica propia de este módulo. La rasterización real con
 * pdftoppm se valida en el deploy (smoke test contra el container).
 */
import { describe, it, expect, vi } from "vitest";
import { ensureRasterImage, isPdf, rasterizePdfPage, type PdfRasterizer } from "./raster";

/** Buffer que empieza con la firma PDF "%PDF-1.7\n...". */
function pdfBuf(): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("contenido-falso-de-pdf")]);
}
/** Buffer JPEG mínimo (FF D8 FF). */
function jpegBuf(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}
/** Buffer PNG mínimo (89 50 4E 47 ...). */
function pngBuf(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

describe("isPdf", () => {
  it("reconoce el magic %PDF", () => {
    expect(isPdf(pdfBuf())).toBe(true);
  });
  it("NO marca JPEG/PNG como PDF", () => {
    expect(isPdf(jpegBuf())).toBe(false);
    expect(isPdf(pngBuf())).toBe(false);
  });
  it("NO se rompe con buffers cortos", () => {
    expect(isPdf(Buffer.from([0x25, 0x50]))).toBe(false);
    expect(isPdf(Buffer.alloc(0))).toBe(false);
  });
});

describe("ensureRasterImage", () => {
  it("PASSTHROUGH: una imagen JPEG/PNG vuelve idéntica (misma referencia, sin rasterizar)", async () => {
    const rasterizer: PdfRasterizer = { rasterize: vi.fn() };
    const jpeg = jpegBuf();
    const png = pngBuf();
    expect(await ensureRasterImage(jpeg, rasterizer)).toBe(jpeg);
    expect(await ensureRasterImage(png, rasterizer)).toBe(png);
    // El rasterizador NUNCA se invoca para imágenes normales.
    expect(rasterizer.rasterize).not.toHaveBeenCalled();
  });

  it("PDF: detecta el magic y delega la rasterización de la 1ª página", async () => {
    const out = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG simulado de salida
    const rasterizer: PdfRasterizer = { rasterize: vi.fn().mockResolvedValue(out) };
    const pdf = pdfBuf();
    const result = await ensureRasterImage(pdf, rasterizer);
    expect(result).toBe(out);
    // Página 1 (frente) por defecto, con el buffer PDF original.
    expect(rasterizer.rasterize).toHaveBeenCalledWith(pdf, 1);
    expect(rasterizer.rasterize).toHaveBeenCalledTimes(1);
  });

  it("FAIL-CLOSED: si el rasterizador lanza, propaga el error (no devuelve el PDF crudo)", async () => {
    const rasterizer: PdfRasterizer = {
      rasterize: vi.fn().mockRejectedValue(new Error("pdftoppm no disponible")),
    };
    await expect(ensureRasterImage(pdfBuf(), rasterizer)).rejects.toThrow("pdftoppm no disponible");
  });
});

describe("rasterizePdfPage", () => {
  it("permite elegir página (p.ej. dorso en página 2)", async () => {
    const out = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const rasterizer: PdfRasterizer = { rasterize: vi.fn().mockResolvedValue(out) };
    await rasterizePdfPage(pdfBuf(), 2, rasterizer);
    expect(rasterizer.rasterize).toHaveBeenCalledWith(expect.any(Buffer), 2);
  });
});
