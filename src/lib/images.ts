/**
 * Utilidades de imagen para los endpoints de captura.
 * Decodifica base64/data-URL a Buffer con validación de seguridad (fail-closed: una
 * imagen ilegible, demasiado grande o de tipo no permitido NO avanza).
 *
 * Hardening de uploads (§8/§9):
 *   - Tipo real por MAGIC BYTES del buffer DECODIFICADO (no se confía en el prefijo
 *     `data:<mime>` porque es trivialmente falsificable). Solo JPEG y PNG.
 *   - Cap de tamaño por imagen (MAX_IMAGE_BYTES). El límite total del request lo
 *     impone server.ts vía express.json({ limit }).
 *   - Cap de cantidad de frames (MAX_FRAMES) — expuesto como helper assertFrameCount()
 *     para el dueño de la ruta de captura (api/capture.ts), que es el único punto de
 *     entrada que recibe el arreglo `frames` completo.
 */

/** Tamaño máximo por imagen decodificada (default 8 MiB). Configurable por env. */
export const MAX_IMAGE_BYTES = parseInt(
  process.env.TEKO_MAX_IMAGE_BYTES || String(8 * 1024 * 1024),
  10
);

/** Cantidad máxima de frames de liveness aceptados por upload (default 12). */
export const MAX_FRAMES = parseInt(process.env.TEKO_MAX_FRAMES || "12", 10);

/** Tamaño mínimo plausible de una imagen real (descarta payloads vacíos/triviales). */
const MIN_IMAGE_BYTES = 100;

/** ¿El buffer empieza con la firma JPEG (FF D8 FF)? */
function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** ¿El buffer empieza con la firma PNG (89 50 4E 47 0D 0A 1A 0A)? */
function isPng(buf: Buffer): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Decodifica base64/data-URL a Buffer validando tipo real (JPEG/PNG por magic bytes)
 * y cap de tamaño. Firma estable (un solo argumento): la consume api/capture.ts.
 */
export function decodeBase64Image(b64: string | undefined): Buffer {
  if (!b64) throw new Error("imagen ausente");
  let s = b64.trim();
  if (s.includes(",") && s.toLowerCase().startsWith("data:")) {
    s = s.split(",", 2)[1];
  }
  const buf = Buffer.from(s, "base64");
  if (buf.length < MIN_IMAGE_BYTES) {
    throw new Error("no se pudo decodificar la imagen");
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `imagen demasiado grande (${buf.length} > ${MAX_IMAGE_BYTES} bytes)`
    );
  }
  // Tipo real por contenido, no por el prefijo data: (anti-spoof de content-type).
  if (!isJpeg(buf) && !isPng(buf)) {
    throw new Error("tipo de imagen no permitido (solo JPEG/PNG)");
  }
  return buf;
}

/**
 * Cap de cantidad de frames. Fail-closed: lanza si excede MAX_FRAMES.
 * El dueño de api/capture.ts debe invocarlo antes de procesar `frames`.
 */
export function assertFrameCount(frames: unknown[]): void {
  if (frames.length > MAX_FRAMES) {
    throw new Error(`demasiados frames (${frames.length} > ${MAX_FRAMES})`);
  }
}
