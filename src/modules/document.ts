/**
 * Módulo `document` — cédula PY (§6.c/§7). REESCRITO: extracción por OCR del
 * FRENTE/DORSO como DATO AUTORITATIVO (Opción 1).
 *
 * Contrato (spec §6): document(front, back) → {mrz, barcode, ocr, extracted,
 * docFaceCrop, authenticity{consistent, checks[]}, passed}.
 *
 * Cambio clave de estrategia:
 *   - FUENTE AUTORITATIVA = campos impresos del documento, leídos por OCR y
 *     ANCLADOS POR POSICIÓN a sus etiquetas (el valor está DEBAJO de la etiqueta,
 *     salvo "Nº" que está a la derecha). Frente + dorso.
 *   - MRZ TD1 (dorso) = BEST-EFFORT: guardamos las 3 líneas crudas; si el parser
 *     `mrz` valida, sumamos paisCodigo y consistencia SOFT. El MRZ ya NO decide
 *     el resultado (los dígitos verificadores no son hard-fail).
 *   - docFaceCrop: la foto del titular recortada del frente (engine SCRFD) para el match.
 *
 * Autenticidad (§6.c): `passed`/`consistent` exigen los campos impresos requeridos
 * presentes + documento no vencido + foto recortable. Los cruces MRZ↔frente son
 * SOFT (informativos), nunca bloquean.
 *
 * FAIL-CLOSED: ante excepción/dato faltante el campo queda vacío y passed=false;
 * nunca se inventan datos. Un sidecar OCR caído nunca produce un documento "válido".
 *
 * Inyección: el cliente OCR, el lector MRZ y el de barcode se reciben para poder
 * testear el módulo sin sidecar ni binarios nativos.
 */
import sharp from "sharp";
import type { Engine, Face } from "../engine";
import type {
  Authenticity,
  AuthenticityCheck,
  BarcodeData,
  DocFaceCrop,
  DocumentResult,
  DocumentType,
  ExtractedDocument,
  MrzData,
  OcrData,
  OcrLine,
} from "../types";
import { OCR_SIDECAR_URL } from "../config";
import { CI_MAX_AGE_YEARS } from "../config";

// ---------------------------------------------------------------------------
// Puertos inyectables (contratos mínimos) — implementaciones reales más abajo.
// ---------------------------------------------------------------------------

/** Resultado crudo del OCR: texto completo, confianza y líneas con caja. */
export interface OcrResult {
  rawText: string;
  confidence: number;
  /** Líneas con caja (4 esquinas en píxeles). Vacío si el sidecar no las trae. */
  lines: OcrLine[];
}

/** Cliente OCR: dado un JPEG/PNG, devuelve texto + confianza + líneas (PaddleOCR sidecar). */
export interface OcrClient {
  recognize(image: Buffer): Promise<OcrResult>;
  /**
   * OCR con PRE-PROCESO de fondo de seguridad (canal verde → blur → adaptiveThreshold)
   * vía POST {OCR_SIDECAR_URL}/ocr-enhanced. Mismo shape que `recognize`, geometría W×H
   * preservada. OPCIONAL: si el cliente no lo implementa, el tier enhanced se omite
   * (fail-open). Usado SÓLO como 3er tier fill-blanks-only del frente.
   */
  recognizeEnhanced?(image: Buffer): Promise<OcrResult>;
}

/** Lector de MRZ: extrae las 3 líneas TD1 crudas del dorso (OCR-B). */
export interface MrzReader {
  readLines(back: Buffer, ocr: OcrClient): Promise<string[]>;
}

/** Lector de barcode 1D (Code128) del dorso. */
export interface BarcodeReader {
  read(back: Buffer): Promise<BarcodeData>;
}

// ---------------------------------------------------------------------------
// Implementaciones por defecto (on-prem).
// ---------------------------------------------------------------------------

/** Cliente PaddleOCR vía sidecar HTTP (POST {OCR_SIDECAR_URL}/ocr). */
export class PaddleOcrClient implements OcrClient {
  constructor(
    private baseUrl: string = OCR_SIDECAR_URL,
    /** Idioma(s) para PaddleOCR (spec §15). Default "spa". */
    private lang: string = "spa"
  ) {}

  async recognize(image: Buffer): Promise<OcrResult> {
    const res = await fetch(`${this.baseUrl}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: image.toString("base64"), lang: this.lang }),
    });
    if (!res.ok) {
      throw new Error(`OCR sidecar HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      text?: string;
      confidence?: number;
      lines?: Array<{ text?: unknown; score?: unknown; box?: unknown }>;
    };
    return {
      rawText: data.text ?? "",
      confidence: typeof data.confidence === "number" ? data.confidence : 0,
      lines: normalizeLines(data.lines),
    };
  }

  async recognizeEnhanced(image: Buffer): Promise<OcrResult> {
    const res = await fetch(`${this.baseUrl}/ocr-enhanced`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: image.toString("base64"), lang: this.lang }),
    });
    if (!res.ok) {
      throw new Error(`OCR sidecar HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      text?: string;
      confidence?: number;
      lines?: Array<{ text?: unknown; score?: unknown; box?: unknown }>;
    };
    return {
      rawText: data.text ?? "",
      confidence: typeof data.confidence === "number" ? data.confidence : 0,
      lines: normalizeLines(data.lines),
    };
  }
}

/**
 * Normaliza las líneas crudas del sidecar a `OcrLine[]`. Descarta cajas
 * malformadas (sin 4 esquinas numéricas) — el anclaje por posición necesita
 * cajas válidas; una caja basura es peor que ninguna.
 */
function normalizeLines(
  raw: Array<{ text?: unknown; score?: unknown; box?: unknown }> | undefined
): OcrLine[] {
  if (!Array.isArray(raw)) return [];
  const out: OcrLine[] = [];
  for (const l of raw) {
    const text = typeof l.text === "string" ? l.text : "";
    const score = typeof l.score === "number" ? l.score : 0;
    const box = l.box;
    if (!Array.isArray(box) || box.length < 4) continue;
    const corners = box.slice(0, 4).map((p) => {
      if (!Array.isArray(p) || p.length < 2) return null;
      const x = Number(p[0]);
      const y = Number(p[1]);
      return Number.isFinite(x) && Number.isFinite(y) ? ([x, y] as [number, number]) : null;
    });
    if (corners.some((c) => c === null)) continue;
    out.push({
      text,
      score,
      box: corners as OcrLine["box"],
    });
  }
  return out;
}

/** Ordena 3 líneas MRZ TD1 por estructura (NO alfabéticamente). */
function orderTd1(lines: string[]): string[] {
  if (lines.length < 3) return lines;
  const letterRatio = (s: string) => s.replace(/[^A-Z]/g, "").length / Math.max(1, s.length);
  // Línea 3 = nombres (apellidos<<nombres): mayor proporción de letras.
  const nameLine = [...lines].sort((a, b) => letterRatio(b) - letterRatio(a))[0];
  const rest = lines.filter((l) => l !== nameLine);
  // Línea 1 (tipo doc + país) arranca con letra; línea 2 (nac/sexo/exp) con dígito.
  rest.sort((a, b) => (/^\d/.test(a) ? 1 : 0) - (/^\d/.test(b) ? 1 : 0));
  return rest.length >= 2 ? [rest[0], rest[1], nameLine] : lines;
}

/**
 * MRZ por OCR del dorso. Filtro de candidatas MEJORADO:
 *   - una línea TD1 tiene ~30 chars (alfabeto MRZ A-Z0-9<);
 *   - se EXCLUYEN rótulos: puras letras (sin dígitos ni `<`) y < 28 chars
 *     (p.ej. "JEFEDPTOIDENTIFICACIONES").
 * El OCR confunde `<`↔`C`/`K`: NO intentamos arreglarlo; guardamos crudo.
 *
 * Acepta un `OcrResult` ya calculado (para no OCR-ear el dorso dos veces): si se
 * provee, lo usa; si no, llama al sidecar.
 */
/**
 * Detecta las 3 líneas MRZ TD1 candidatas a partir del texto OCR crudo del dorso
 * y las ordena por estructura TD1. Núcleo COMPARTIDO entre `OcrMrzReader` (lectura
 * a partir de líneas separadas por `\n`) y el Inspector OCR (lectura a partir de
 * los textos de las cajas). EXPORTADO para el Inspector y los tests.
 *
 * Acepta texto multilínea o un arreglo de textos (uno por caja OCR).
 */
export function detectTd1Lines(input: string | string[]): string[] {
  const rawLines = Array.isArray(input) ? input : input.split(/\r?\n/);
  const candidates = rawLines
    .map((l) => l.replace(/\s+/g, "").toUpperCase())
    .filter((l) => /^[A-Z0-9<]{20,}$/.test(l))
    // Excluí rótulos: puras letras (ni dígitos ni `<`) y cortos (<28).
    .filter((l) => !(/^[A-Z]+$/.test(l) && l.length < 28));
  // TD1 = 3 líneas; tomamos las 3 más largas del alfabeto MRZ y las ordenamos
  // por estructura TD1 (NO alfabéticamente).
  const top3 = candidates.sort((a, b) => b.length - a.length).slice(0, 3);
  return orderTd1(top3);
}

/** Ordena 2 líneas MRZ TD3 (pasaporte) por estructura: línea de NOMBRES primero. */
function orderTd3(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  // TD3 línea 1 = `P<ISS APELLIDO<<NOMBRES` (letra-pesada: tipo+país+nombres);
  // línea 2 = nº + nacionalidad + fechas + check digits (dígito-pesada). El parser
  // `mrz` espera [línea1, línea2]; ordenar por proporción de letras desc lo garantiza
  // (mismo criterio que orderTd1 usa para la línea de nombres).
  const letterRatio = (s: string) => s.replace(/[^A-Z]/g, "").length / Math.max(1, s.length);
  return [...lines].sort((a, b) => letterRatio(b) - letterRatio(a)).slice(0, 2);
}

/**
 * Detecta las 2 líneas MRZ TD3 (pasaporte ICAO 9303) de la página de datos a partir
 * del texto OCR crudo y las ordena por estructura. TD3 = 2 líneas de 44 chars del
 * alfabeto MRZ (A-Z0-9<); aceptamos ≥30 para tolerar recortes/ruido del OCR. EXPORTADO
 * para el extractor de pasaporte y los tests.
 *
 * Acepta texto multilínea o un arreglo de textos (uno por caja OCR).
 */
export function detectTd3Lines(input: string | string[]): string[] {
  const rawLines = Array.isArray(input) ? input : input.split(/\r?\n/);
  const candidates = rawLines
    .map((l) => l.replace(/\s+/g, "").toUpperCase())
    .filter((l) => /^[A-Z0-9<]{30,}$/.test(l))
    // Excluí rótulos puras-letras cortos (igual que TD1).
    .filter((l) => !(/^[A-Z]+$/.test(l) && l.length < 28));
  const top2 = candidates.sort((a, b) => b.length - a.length).slice(0, 2);
  return orderTd3(top2);
}

export class OcrMrzReader implements MrzReader {
  async readLines(back: Buffer, ocr: OcrClient, pre?: OcrResult): Promise<string[]> {
    const { rawText } = pre ?? (await ocr.recognize(back));
    return detectTd1Lines(rawText);
  }
}

/** Barcode Code128 con @zxing/library sobre el RGBA crudo del dorso. */
export class ZxingBarcodeReader implements BarcodeReader {
  async read(back: Buffer): Promise<BarcodeData> {
    // Carga perezosa y tipado del borde: zxing es pesado y su API se consume sólo
    // acá; lo casteamos a una forma mínima y normalizamos a BarcodeData. Cualquier
    // fallo lo captura el llamador (barcode best-effort, no bloqueante).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const zxing = (await import("@zxing/library")) as any;
    // El dorso de la cédula PY trae el barcode como una franja: convertimos a luma.
    const { data, info } = await sharp(back)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const lum = new Uint8ClampedArray(width * height);
    for (let i = 0; i < lum.length; i++) lum[i] = data[i];
    const source = new zxing.RGBLuminanceSource(lum, width, height);
    const binmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(source));
    const reader = new zxing.MultiFormatReader();
    const result = reader.decode(binmap);
    return { format: String(result.getBarcodeFormat()), text: String(result.getText()) };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
}

// ---------------------------------------------------------------------------
// Parsing MRZ (parser `mrz`, ICAO 9303 TD1). BEST-EFFORT — no decide passed.
// ---------------------------------------------------------------------------

const EMPTY_MRZ: MrzData = {
  rawLines: [],
  documentType: "",
  issuingCountry: "",
  documentNumber: "",
  surname: "",
  givenNames: "",
  nationality: "",
  dateOfBirth: "",
  sex: "",
  expirationDate: "",
  checkDigits: {
    documentNumber: false,
    dateOfBirth: false,
    expirationDate: false,
    composite: false,
  },
  valid: false,
};

/**
 * YYMMDD (MRZ) → ISO 8601 YYYY-MM-DD. Ventana de siglo simple.
 *
 * SUPOSICIÓN DE SIGLO (MRZ trae sólo 2 dígitos de año):
 *   - Expiración (`isExpiry=true`): SIEMPRE 20xx (no hay vencimientos 19xx vigentes).
 *   - Nacimiento (`isExpiry=false`): pivote en el año-actual de 2 dígitos `now`.
 */
function mrzDateToIso(yymmdd: string | null | undefined, isExpiry: boolean): string {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return "";
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const now = new Date().getFullYear() % 100;
  const century = isExpiry ? 2000 : yy > now ? 1900 : 2000;
  return `${century + yy}-${mm}-${dd}`;
}

/**
 * Forma mínima del resultado de `mrz`.parse() que consumimos (ICAO 9303). Tipamos
 * el borde del import dinámico contra esta interfaz propia.
 */
interface MrzParseResult {
  valid: boolean;
  fields: Record<string, string | null | undefined>;
  details: Array<{ field: string; valid: boolean }>;
}

/**
 * Normaliza el sexo del MRZ al convenio del FRENTE ("MASCULINO"/"FEMENINO").
 *
 * BUG HISTÓRICO: la librería `mrz` devuelve `sex` como `"male"`/`"female"`
 * (no `"M"`/`"F"` ni el convenio español del frente). El parser copiaba ese valor
 * crudo a `mrz.sex`, así que el cruce MRZ↔frente comparaba "male" vs "MASCULINO"
 * (siempre distinto) y el backfill podía dejar `sex` en inglés. Mapeamos a la
 * misma convención del OCR impreso. Tolerante a "M"/"F"/"male"/"female"/"hombre".
 */
function normalizeMrzSex(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim().toUpperCase();
  if (s === "M" || s.startsWith("MALE") || s.startsWith("MASC") || s.startsWith("HOMBRE")) {
    return "MASCULINO";
  }
  if (s === "F" || s.startsWith("FEMALE") || s.startsWith("FEM") || s.startsWith("MUJER")) {
    return "FEMENINO";
  }
  return "";
}

/**
 * Lee la validez de un dígito verificador de `r.details`. La librería `mrz` nombra
 * las entradas de CHECK-DIGIT con el sufijo `CheckDigit`
 * (`documentNumberCheckDigit`, `birthDateCheckDigit`, `expirationDateCheckDigit`,
 * `compositeCheckDigit`). Las entradas SIN sufijo (`documentNumber`, `birthDate`,
 * `expirationDate`) son la validez de FORMATO del campo, NO del dígito.
 *
 * BUG HISTÓRICO: el parser leía las entradas sin sufijo, así que `checkDigits`
 * reflejaba el formato del campo y no la verificación ICAO 7-3-1. Verificado contra
 * el vector canónico TD1 (ANNA ERIKSSON) y un dorso PY real.
 */
function detailValid(details: MrzParseResult["details"], field: string): boolean {
  return !!details.find((d) => d.field === field)?.valid;
}

export async function parseMrz(lines: string[]): Promise<MrzData> {
  // ≥2 líneas: TD3 (pasaporte ICAO) son 2×44; TD1 (cédula PY) son 3×30. La librería
  // `mrz` autodetecta el formato por cantidad/longitud de líneas; sólo necesitamos no
  // cortar antes con el guard. <2 → vacío (fail-closed: no se inventa).
  if (lines.length < 2) return { ...EMPTY_MRZ, rawLines: lines };
  try {
    const mod = (await import("mrz")) as unknown as {
      parse: (input: string[] | string) => MrzParseResult;
    };
    const r = mod.parse(lines);
    const f = r.fields;
    const dn = detailValid(r.details, "documentNumberCheckDigit");
    const dob = detailValid(r.details, "birthDateCheckDigit");
    const exp = detailValid(r.details, "expirationDateCheckDigit");
    // Dígito verificador COMPUESTO: en TD1 la librería lo nombra `compositeCheckDigit`;
    // en TD3 (pasaporte) es `finalCheckDigit`. Aceptamos cualquiera de los dos para que
    // el composite quede honesto en ambos formatos (TD1 nunca trae finalCheckDigit, así
    // que la cédula PY no regresiona).
    const comp =
      detailValid(r.details, "compositeCheckDigit") ||
      detailValid(r.details, "finalCheckDigit");
    return {
      rawLines: lines,
      documentType: f.documentCode ?? "",
      issuingCountry: f.issuingState ?? "",
      documentNumber: f.documentNumber ?? "",
      surname: f.lastName ?? "",
      givenNames: f.firstName ?? "",
      nationality: f.nationality ?? "",
      dateOfBirth: mrzDateToIso(f.birthDate, false),
      sex: normalizeMrzSex(f.sex),
      expirationDate: mrzDateToIso(f.expirationDate, true),
      optionalData: f.optional1 ?? undefined,
      checkDigits: {
        documentNumber: dn,
        dateOfBirth: dob,
        expirationDate: exp,
        composite: comp,
      },
      valid: r.valid,
    };
  } catch {
    return { ...EMPTY_MRZ, rawLines: lines };
  }
}

/**
 * Helper del Inspector OCR: dado el texto de las cajas OCR de una imagen, detecta
 * si parece un DORSO con MRZ TD1 y, si hay ≥3 líneas candidatas, las parsea.
 * Devuelve `null` cuando NO hay MRZ (p.ej. la imagen es un frente) — así el
 * Inspector sólo agrega el bloque `mrz` cuando realmente lo hay. ADITIVO.
 */
export async function detectMrzFromOcrTexts(texts: string[]): Promise<MrzData | null> {
  const lines = detectTd1Lines(texts);
  if (lines.length < 3) return null;
  return parseMrz(lines);
}

// ---------------------------------------------------------------------------
// Anclaje por posición de los campos impresos (FUENTE AUTORITATIVA).
// ---------------------------------------------------------------------------

/** Una línea OCR con su centro precomputado (cx, cy) en píxeles. */
interface AnchorLine {
  text: string;
  score: number;
  cx: number;
  cy: number;
  /** Ancho/alto aproximados de la caja (para tolerancias). */
  w: number;
  h: number;
  /**
   * Índice de la línea en el arreglo `OcrLine[]` NORMALIZADO de origen (el mismo
   * que devuelve el sidecar tras `normalizeLines`). Permite recuperar la caja
   * original (`box`) y reportar `lineIndex` en el debug del playground OCR, sin
   * que el anclaje de producción dependa de él (es metadata additiva).
   */
  idx: number;
}

/** Centro y dimensiones de una caja de 4 esquinas. */
function toAnchorLines(lines: OcrLine[]): AnchorLine[] {
  return lines.map((l, idx) => {
    const xs = l.box.map((p) => p[0]);
    const ys = l.box.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      text: l.text,
      score: l.score,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      w: maxX - minX,
      h: maxY - minY,
      idx,
    };
  });
}

/** Normaliza para comparar etiquetas/textos: sin acentos, mayúsculas, sin símbolos. */
function canon(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿`text` es (o contiene) la etiqueta `label`? Comparación canónica. */
function isLabel(text: string, label: string): boolean {
  const t = canon(text);
  const l = canon(label);
  return t === l || t.includes(l);
}

/** Encuentra la línea-etiqueta que matchea `label` (la de mayor score). */
function findLabel(lines: AnchorLine[], label: string): AnchorLine | undefined {
  return lines
    .filter((l) => isLabel(l.text, label))
    .sort((a, b) => b.score - a.score)[0];
}

/**
 * Valor anclado DEBAJO de una etiqueta: la línea cuyo centro está más abajo
 * (cy mayor) y razonablemente alineada en X con la etiqueta, la más cercana
 * hacia abajo. Excluye otras etiquetas conocidas (no devolvemos un rótulo).
 */
interface ValueBelowOpts {
  maxDx?: number;
  maxDy?: number;
  minScore?: number;
  exclude?: AnchorLine[];
  /**
   * Tolerancia vertical RELATIVA a la altura de la etiqueta (px): el gap real
   * etiqueta→valor escala con el tamaño del texto (cámara más cerca/lejos,
   * rotación). Un `maxDy` ABSOLUTO tuneado a un frame (48px @ label-height≈39)
   * VACÍA el apellido cuando la cédula se fotografía más grande (visto real:
   * label-height≈55 → gap≈66 > 48). Si se provee, el umbral efectivo es
   * `max(maxDy, label.h * dyHeightFactor)`. NO usar en campos donde una banda
   * ancha invitaría a otra fila (apellidos sí: la fila siguiente —NOMBRES— está
   * a ~4-5× la altura de la etiqueta, muy lejos del factor 1.6).
   */
  dyHeightFactor?: number;
  /**
   * Predicado de FORMA esperada del valor. El frente de la cédula PY tiene un
   * fondo de guilloche/watermark que el OCR fragmenta en ruido ("CAL", "WAL",
   * "AYREPUBLIC"...) salpicado entre la etiqueta y su valor real. Sin filtro,
   * `valueBelow` devuelve el fragmento de ruido más cercano en Y. Con `accept`,
   * se devuelve el candidato MÁS CERCANO que pasa el predicado, saltando el ruido.
   * Si no se provee, se acepta cualquier texto (comportamiento histórico).
   */
  accept?: (text: string) => boolean;
}

/** Devuelve la LÍNEA anclada debajo de la etiqueta (o undefined). Núcleo compartido. */
function lineBelow(
  lines: AnchorLine[],
  label: AnchorLine,
  opts: ValueBelowOpts = {}
): AnchorLine | undefined {
  const maxDx = opts.maxDx ?? 280;
  const baseMaxDy = opts.maxDy ?? 220;
  // Umbral Y efectivo: el mayor entre el absoluto y el relativo a la altura de la
  // etiqueta. Así el anclaje sobrevive a fotos más grandes/rotadas (el gap escala
  // con el texto) sin abrir la banda en los campos que no lo piden.
  const maxDy = opts.dyHeightFactor
    ? Math.max(baseMaxDy, label.h * opts.dyHeightFactor)
    : baseMaxDy;
  const minScore = opts.minScore ?? 0.3;
  const exclude = new Set(opts.exclude ?? []);
  const accept = opts.accept;
  const candidates = lines
    .filter((l) => l !== label && !exclude.has(l))
    .filter((l) => l.score >= minScore)
    .filter((l) => l.cy > label.cy) // debajo
    .filter((l) => l.cy - label.cy <= maxDy)
    .filter((l) => Math.abs(l.cx - label.cx) <= maxDx)
    .filter((l) => (accept ? accept(l.text) : true))
    .sort((a, b) => a.cy - b.cy); // la más cercana hacia abajo primero
  return candidates[0];
}

function valueBelow(lines: AnchorLine[], label: AnchorLine, opts: ValueBelowOpts = {}): string {
  return lineBelow(lines, label, opts)?.text.trim() ?? "";
}

/** Atajo: localiza la etiqueta y devuelve su valor-debajo (o "" si no hay). */
function fieldBelow(
  lines: AnchorLine[],
  label: string,
  labels: AnchorLine[],
  opts?: ValueBelowOpts
): string {
  const lbl = findLabel(lines, label);
  if (!lbl) return "";
  return valueBelow(lines, lbl, { ...opts, exclude: labels });
}

/**
 * Como `fieldBelow` pero devuelve la LÍNEA elegida (no sólo su texto), para poder
 * EXCLUIRLA por identidad al anclar otro campo. Necesario para garantizar que
 * APELLIDOS no agarre exactamente la misma línea que NOMBRES.
 */
function findValueLineBelow(
  lines: AnchorLine[],
  label: string,
  labels: AnchorLine[],
  opts?: ValueBelowOpts
): AnchorLine | undefined {
  const lbl = findLabel(lines, label);
  if (!lbl) return undefined;
  return lineBelow(lines, lbl, { ...opts, exclude: labels });
}

/** Valor a la DERECHA en la misma fila (para "Nº": dígitos a la derecha del rótulo). */
function valueRight(
  lines: AnchorLine[],
  anchor: AnchorLine,
  test: (t: string) => boolean,
  opts: { maxDy?: number; minScore?: number } = {}
): string {
  const maxDy = opts.maxDy ?? 60;
  const minScore = opts.minScore ?? 0.3;
  const candidates = lines
    .filter((l) => l !== anchor && l.score >= minScore)
    .filter((l) => Math.abs(l.cy - anchor.cy) <= maxDy)
    .filter((l) => l.cx > anchor.cx)
    .filter((l) => test(l.text))
    .sort((a, b) => a.cx - b.cx);
  return candidates[0]?.text.trim() ?? "";
}

/**
 * Clase de SEPARADORES de una fecha impresa DD?MM?YYYY. Incluye `=` porque el OCR
 * confunde el guion del separador con `=` en algunos frames (real CAYO: el
 * vencimiento "16-12-2035" se leyó "16=12-2035"). Una sola fuente de verdad: la
 * usan `looksLikeDate`, `printedDateToIso` y la EXCLUSIÓN de fechas del fallback de
 * CI (`oldFormatCiFallback`), para que "16=12-2035" no cuele como 8 dígitos de CI.
 */
const DATE_SEP = "[\\/.\\-=]";
const DATE_RE = new RegExp(`\\d{2}${DATE_SEP}\\d{2}${DATE_SEP}\\d{4}`);
const DATE_CAP_RE = new RegExp(`(\\d{2})${DATE_SEP}(\\d{2})${DATE_SEP}(\\d{4})`);

/** ¿El texto contiene una fecha impresa DD-MM-YYYY (o con / . =)? */
function looksLikeDate(s: string): boolean {
  return DATE_RE.test(s);
}

/** "DD-MM-YYYY" (o con / . =) → ISO "YYYY-MM-DD". "" si no matchea. */
function printedDateToIso(s: string): string {
  const m = s.match(DATE_CAP_RE);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Palabras de FONDO/ruido del frente de la cédula PY: el watermark
 * "REPÚBLICA DEL PARAGUAY" y la guilloche se fragmentan en estas tokens
 * (vistos en el OCR real: "DEL", "PARA", "ICA", "PAR", "AYREPUBLIC", ...).
 * NUNCA pueden ser un apellido/nombre. Comparación canónica (sin acentos).
 */
const NAME_STOPWORDS = new Set([
  "DEL",
  "DE",
  "LA",
  "LAS",
  "LOS",
  "EL",
  "Y",
  "PARA",
  "PAR",
  "ICA",
  "REPUBLICA",
  "REPUBLIC",
  "PARAGUAY",
  "REPUBLICADELPARAGUAY",
  "AYREPUBLIC",
  "AYREPUBLICA",
  "CEDULA",
  "IDENTIDAD",
  "CIVIL",
  "APELLIDOS",
  "NOMBRES",
  "DONANTE",
  "SEXO",
  "FECHA",
  "NACIMIENTO",
  "VENCIMIENTO",
  "LUGAR",
]);

/**
 * PARTÍCULAS de fondo: tokens que aparecen en nombres compuestos PY ("DE LA",
 * "DEL") pero que NUNCA pueden ser el ÚLTIMO token de un apellido/nombre real. Un
 * valor que termina en una de estas es BLEED del watermark "REPÚBLICA DEL PARAGUAY"
 * mezclado en la misma caja OCR (caso real /ocr-enhanced: "ORUE SOSAA DEL"). Las usa
 * `looksLikeName` para RECHAZAR (campo vacío → revisión manual), nunca para recortar.
 */
const NAME_PARTICLE_STOPWORDS = new Set(["DEL", "DE", "LA", "LAS", "LOS", "EL", "Y"]);

/**
 * Predicado de PLAUSIBILIDAD de un valor de nombre (apellidos/nombres). El fondo
 * guilloche/watermark del frente salpica ruido entre la etiqueta y su valor real;
 * sin este filtro `valueBelow` devuelve el fragmento más cercano en Y (p.ej. "DEL"
 * del watermark "REPÚBLICA DEL PARAGUAY"). Un nombre real:
 *   - tras canon, queda sólo en letras+espacios;
 *   - cada token tiene ≥4 chars (descarta "DEL","PAR","ICA","Y"...);
 *   - no es una stopword de fondo;
 *   - longitud total razonable (≥4, ≤40).
 */
export function looksLikeName(s: string): boolean {
  const c = canon(s);
  if (!c) return false;
  if (!/^[A-Z ]+$/.test(c)) return false; // sólo letras y espacios
  if (c.length < 4 || c.length > 40) return false;
  // Rechazá fragmentos OCR-corruptos del WATERMARK "REPÚBLICA DEL PARAGUAY". Con
  // rotación/perspectiva el OCR los junta en una sola tira larga sin espacios
  // (visto real: "CPUBLICADELPARAGUAYRIEPUB", "AYREPUBLICADELPARAGUAY"). Esa tira
  // pasaba `looksLikeName` (un token largo, no-stopword) y, con maxDy ampliado,
  // se colaba como apellido. Una SUBCADENA del watermark NUNCA es un apellido.
  if (/REPUBLIC|PUBLICA|PARAGUAY/.test(c.replace(/ /g, ""))) return false;
  const tokens = c.split(" ").filter(Boolean);
  if (tokens.length === 0) return false;
  // RECHAZO por BLEED del watermark (caso real ORUE, /ocr-enhanced): el pre-proceso
  // del canal verde recupera el apellido verdadero pero MEZCLA en la MISMA caja el
  // texto del watermark "REPÚBLICA DEL PARAGUAY" que se solapa en Y. Visto real:
  // apellido "ORUE SOSA" + bleed "A DEL" => UNA sola caja "ORUE SOSAA DEL". El
  // anclaje no puede separar tokens dentro de una caja, y `cleanName` no recorta
  // (todo son letras). Un apellido/nombre REAL NUNCA termina en una partícula suelta
  // (DEL/DE/LA/...): si el último token es una de esas, es bleed => RECHAZAR (campo
  // VACÍO → revisión manual). NO recortamos-y-conservamos: "ORUE SOSAA DEL" sin "DEL"
  // sigue siendo "ORUE SOSAA" (A duplicada), basura PLAUSIBLE — peor que vacío. La
  // regla es global (raw/upscale/enhanced): un nombre que termina en partícula nunca
  // es válido; las cédulas conocidas no terminan en partícula, así que no regresiona.
  const lastTok = tokens[tokens.length - 1];
  if (NAME_PARTICLE_STOPWORDS.has(lastTok)) return false;
  // Al menos un token "fuerte" (≥4 chars y no-stopword); ninguna stopword sola.
  const strong = tokens.filter((t) => t.length >= 4 && !NAME_STOPWORDS.has(t));
  if (strong.length === 0) return false;
  // Rechazá si el texto ENTERO colapsa a una stopword conocida.
  if (NAME_STOPWORDS.has(c.replace(/ /g, ""))) return false;
  return true;
}

/**
 * Predicado de PLAUSIBILIDAD de una CIUDAD (lugar de nacimiento). Debe ser
 * ALFABÉTICA. EXCLUYE explícitamente:
 *   - cualquier texto que contenga un dígito (descarta el número de cédula
 *     "4895448" y el rótulo "N° 4895448" que en la captura real cae en la misma
 *     fila que la etiqueta "LUGAR DE NACIMIENTO");
 *   - prefijos de número "Nº"/"N°"/"No"/"N".
 * Tras canon (sin acentos), la ciudad queda sólo en letras+espacios, ≥3 chars.
 * El valor de lugar de nacimiento NUNCA puede ser numérico.
 */
function looksLikeCity(s: string): boolean {
  if (/\d/.test(s)) return false; // ningún dígito: descarta el Nº de cédula
  if (/^N[º°o]?\b/i.test(s.trim())) return false; // rótulo "Nº ..." / "No ..."
  const c = canon(s);
  if (!c) return false;
  if (!/^[A-Z ]+$/.test(c)) return false; // sólo letras y espacios
  return c.length >= 3 && c.length <= 40;
}

/**
 * DETECCIÓN DE FORMATO (frente PY). Dos layouts conviven en circulación:
 *
 *   - NUEVO: etiquetas "APELLIDOS" y "NOMBRES" en LÍNEAS SEPARADAS (cy lejanos),
 *     cada una con su valor debajo; CI con rótulo "Nº". Lógica histórica intacta.
 *   - VIEJO: una sola etiqueta COMBINADA "APELLIDOS, NOMBRES" (PaddleOCR la lee
 *     como "APELLIDOS. NOMBRES" — coma OCR-eada como punto) con DOS líneas de
 *     valor debajo en la MISMA columna: 1ª=apellidos, 2ª=nombres. CI suelto.
 *
 * Discriminador (data-driven, NO el regex del spec que falla con el punto):
 * existe UNA línea cuyo canon contiene a la vez "APELLIDOS" y "NOMBRES". En el
 * formato nuevo esos dos tokens caen en líneas distintas, así que ninguna sola
 * línea los tiene → modo nuevo. Robusto al ruido OCR (coma/punto/espacios).
 */
function findCombinedNameLabel(lines: AnchorLine[]): AnchorLine | undefined {
  return lines
    .filter((l) => {
      const c = canon(l.text);
      return c.includes("APELLIDOS") && c.includes("NOMBRES");
    })
    .sort((a, b) => b.score - a.score)[0];
}

/**
 * Resolución de apellidos/nombres del FORMATO VIEJO. Bajo la etiqueta combinada
 * hay DOS líneas de valor en la misma columna; la 1ª (cy menor) = apellidos, la
 * 2ª = nombres. Helper COMPARTIDO entre `extractFront` (producción) y
 * `extractFrontDebug` (inspector) para que ambos anclen idéntico.
 *
 * Guardas (validadas contra el OCR real de la cédula vieja):
 *   - `maxDx` ESTRECHO (140px): la columna de nombres está en cx≈134-145 (label
 *     cx≈151, dx≤17). Sin esto, "Masculino" (cx≈348, dx≈197) y otros valores de
 *     columnas vecinas pasan `looksLikeName` y se colarían. La banda angosta los
 *     descarta por X.
 *   - banda Y ESTRECHA (`maxDy` 80px): las dos filas de valor caen a ~17px y ~35px
 *     del rótulo combinado. Una banda más ancha dejaría entrar la fila "LUGAR DE
 *     NACIMIENTO" de valor (real: "SANTA ROSA MISIONES" a dy≈114, misma columna,
 *     que pasa `looksLikeName`). FAIL-CLOSED: si el OCR PERDIÓ la línea de apellido,
 *     NO queremos que el valor del lugar se cuele como 2º candidato y produzca una
 *     identidad CONFIANZADA-pero-errónea; preferimos campos vacíos → revisión manual.
 *   - ADYACENCIA: las dos filas de nombre son contiguas (~18px entre sí); el valor
 *     del lugar está ~79px bajo nombres. Exigir que las dos candidatas estén juntas
 *     (≤ `maxRowGap` 50px) descarta un par {nombre, lugar} aunque ambos entren en
 *     la banda con una foto más grande.
 *   - `looksLikeName` (mismo saneo que el modo nuevo: rechaza watermark, no
 *     numérico, score mínimo).
 *   - se exigen DOS líneas distintas Y ADYACENTES; si no, fail-closed (no se inventa).
 */
function resolveOldNames(
  lines: AnchorLine[],
  combinedLabel: AnchorLine
): { apellidos?: AnchorLine; nombres?: AnchorLine } {
  // BANDA Y ESCALADA POR ALTURA (no absoluta). REGRESIÓN real cazada: el Inspector
  // (variant "deskew-upscale") y el fallback ampliado de producción re-OCR-ean el
  // frente a 1600px, donde el gap etiqueta→valor crece con el texto. Con un `maxDy`
  // FIJO de 80px, en la cédula vieja real upscaleada la 2ª fila (nombres "JULIO
  // CESAR", dy≈92 desde el rótulo combinado de h≈56) caía FUERA de banda → sólo
  // sobrevivía 1 candidato → `< 2` → identidad VACÍA. Mismo patrón que ya forzó el
  // `max(56, h*1.8)` del camino de formato nuevo. Escalamos igual:
  //   `max(80, label.h*1.8)`. Con h≈56 da ≈101 → admite nombres (dy≈92) y SIGUE
  //   excluyendo el lugar de nacimiento (dy≈300 ≫ 101): la guarda fail-closed se
  //   sostiene sólo con maxDy. El piso 80 conserva el comportamiento en `raw`
  //   (h≈18 → piso 80, dy≈35 ≤ 80).
  // FLOOR 95 (no 80): en un frente ROTADO 90° enderezado, la caja-etiqueta queda
  // con `h` ≈ el ANCHO de glifo original (~40px), así que `h*1.8≈72` recortaba la
  // 2ª fila de valor (nombres, a Δy≈82) → identidad VACÍA. Subir SÓLO el piso (no el
  // multiplicador) admite la 2ª fila sin tocar el camino UPSCALE viejo, que está
  // dominado por el multiplicador (h≈56 → 56*1.8≈101 ≥ 95, intacto por construcción).
  // La seguridad fail-closed vive en `maxRowGap` (adyacencia), no acá: el lugar de
  // nacimiento queda a Δy≈261 (≫ cualquier maxDy), así que ensanchar el piso no puede
  // colar el par {nombre, lugar}.
  const maxDy = Math.max(95, combinedLabel.h * 1.8);
  // ADYACENCIA también escalada: en raw las dos filas distan ~18px; upscaleadas
  // ~48px y el 50 fijo las clareaba por sólo 2px (frágil). `max(50, label.h)` da
  // ≈56 a escala upscale. Seguro: maxDy ya excluye el lugar, así que aflojar el
  // rowGap no puede colar el par {nombre, lugar}.
  const maxRowGap = Math.max(50, combinedLabel.h);
  const candidates = lines
    .filter((l) => l !== combinedLabel)
    .filter((l) => l.score >= 0.5)
    .filter((l) => l.cy > combinedLabel.cy)
    .filter((l) => l.cy - combinedLabel.cy <= maxDy)
    .filter((l) => Math.abs(l.cx - combinedLabel.cx) <= 140)
    .filter((l) => looksLikeName(l.text))
    .sort((a, b) => a.cy - b.cy);
  if (candidates.length < 2) return {};
  // Las dos primeras filas DEBEN ser contiguas (mismo bloque apellidos/nombres).
  // Si están separadas, es señal de que falta una línea y la 2ª es de otra fila
  // (p.ej. lugar de nacimiento) → fail-closed, no inventamos identidad.
  if (candidates[1].cy - candidates[0].cy > maxRowGap) return {};
  return { apellidos: candidates[0], nombres: candidates[1] };
}

/**
 * Localiza una etiqueta de FECHA tolerante al ruido OCR.
 *
 * EVOLUCIÓN (caso real CAYO, frente formato NUEVO): el OCR degrada la palabra
 * "FECHA" en sí (visto: "FEGHA DE NACIMIENTO" — C→G). Exigir `includes("FECHA")`
 * VACIABA la fecha de nacimiento aunque el valor "22-04-1969" se leía perfecto
 * justo debajo. Por eso ya NO exigimos "FECHA": anclamos por el token DISTINTIVO
 * del campo, que es robusto al ruido:
 *   - VENC  → la línea-etiqueta contiene "VENC" (de VENCIMIENTO/VENCIMENTO).
 *   - NAC   → la línea-etiqueta contiene "NACIM" (de NACIMIENTO).
 *
 * GUARDA CRÍTICA 1 para NAC: "LUGAR DE NACIMIENTO" también contiene "NACIM" y
 * suele leerse con score 1.00 (> el de "FEGHA...NACIMIENTO" degradado), así que sin
 * filtro GANARÍA el sort-por-score y su valor-debajo (la CIUDAD, p.ej. "LUQUE") no
 * es una fecha → nac quedaría vacío. EXCLUIMOS toda etiqueta que contenga "LUGAR".
 * Verificado: con esto, line "FEGHA-DENACIMIENTOUCAC" gana y "22-04-1969" ancla.
 *
 * GUARDA CRÍTICA 2 para NAC (caso real ORUE SOSA): el needle NO puede ser sólo
 * "NAC". La CIUDAD de nacimiento "ENCAR·NAC·ION" (canon "ENCARNACION", score 0.99)
 * CONTIENE "NAC" como substring y, al estar ABAJO de la etiqueta real, GANABA el
 * sort-por-score → findDateLabel devolvía "ENCARNACION" (cy≈919) como rótulo NAC.
 * El valor "05-02-1999" (cy≈830) queda ARRIBA de ese falso rótulo → `lineBelow`
 * (que exige cy_valor > cy_rótulo) NO lo encontraba → fechaNac VACÍA pese a leerse
 * con score 1.00. Endurecemos el needle a "NACIM": "ENCARNACION" NO lo contiene
 * (no hay "M" tras "NACI"), mientras que TODAS las variantes reales del rótulo sí
 * ("NACIMIENTO", "DENACIMIENTO", "FEGHA-DENACIMIENTOUCAC"). VENC no se ve afectado
 * (ninguna ciudad/valor contiene "VENC").
 */
function findDateLabel(lines: AnchorLine[], token: "VENC" | "NAC"): AnchorLine | undefined {
  const needle = token === "VENC" ? "VENC" : "NACIM";
  return lines
    .filter((l) => {
      const c = canon(l.text);
      if (!c.includes(needle)) return false;
      // NAC: "LUGAR DE NACIMIENTO" también matchea "NAC" — excluir el lugar.
      if (token === "NAC" && c.includes("LUGAR")) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score)[0];
}

/** Etiquetas conocidas del frente y dorso (para excluirlas como valores). */
const KNOWN_LABELS = [
  "APELLIDOS",
  "NOMBRES",
  "FECHA DE VENCIMIENTO",
  "FECHA DE NACIMIENTO",
  "SEXO",
  "DONANTE",
  "LUGAR DE NACIMIENTO",
  "NACIONALIDAD",
  "ESTADO CIVIL",
  "FECHA DE EMISION",
  "REPUBLICA DEL PARAGUAY",
  "CEDULA DE IDENTIDAD CIVIL",
  "IDENTIDAD CIVIL",
];

function collectKnownLabels(lines: AnchorLine[]): AnchorLine[] {
  const out: AnchorLine[] = [];
  for (const lbl of KNOWN_LABELS) {
    const found = findLabel(lines, lbl);
    if (found) out.push(found);
  }
  return out;
}

/** Estructura vacía de extracción (fail-closed): todos los campos en blanco. */
function emptyExtracted(): ExtractedDocument {
  return {
    documento: { pais: "", tipo: "", numeroCedula: "", specimen: false },
    titular: {
      apellidos: "",
      nombres: "",
      fechaNacimiento: "",
      sexo: "",
      lugarNacimiento: { ciudad: "", departamento: "" },
      nacionalidad: "PARAGUAYA",
      estadoCivil: "",
      donante: false,
      firma: "Sin firma",
    },
    documentoFisico: { fechaEmision: "", fechaVencimiento: "", chip: true, codigoBarras: false },
    registroInterno: { ic: "", ubicacion: "" },
    autoridadEmisora: { nombre: "", cargo: "", dependencia: "" },
    mrz: { linea1: "", linea2: "", linea3: "", paisCodigo: "" },
  };
}

/**
 * ¿Falta algún campo REQUERIDO del FRENTE tras el OCR crudo? Decide si vale la
 * pena la pasada de fallback ampliada. Mismos campos que gatean `passed`.
 */
function frontRequiredMissing(e: ExtractedDocument): boolean {
  return (
    !e.titular.apellidos ||
    !e.titular.nombres ||
    !e.documento.numeroCedula ||
    !e.titular.fechaNacimiento ||
    !e.documentoFisico.fechaVencimiento
  );
}

/**
 * Rellena en `dst` SÓLO los campos del frente que están vacíos, tomándolos de
 * `src` (la pasada ampliada). MONOTÓNICO: nunca pisa un valor ya presente en
 * `dst`. Cubre exactamente los campos del frente que `extractFront` puede leer.
 */
function fillMissingFront(dst: ExtractedDocument, src: ExtractedDocument): void {
  if (!dst.titular.apellidos && src.titular.apellidos)
    dst.titular.apellidos = src.titular.apellidos;
  if (!dst.titular.nombres && src.titular.nombres) dst.titular.nombres = src.titular.nombres;
  if (!dst.documento.numeroCedula && src.documento.numeroCedula)
    dst.documento.numeroCedula = src.documento.numeroCedula;
  if (!dst.titular.fechaNacimiento && src.titular.fechaNacimiento)
    dst.titular.fechaNacimiento = src.titular.fechaNacimiento;
  if (!dst.documentoFisico.fechaVencimiento && src.documentoFisico.fechaVencimiento)
    dst.documentoFisico.fechaVencimiento = src.documentoFisico.fechaVencimiento;
  if (!dst.titular.sexo && src.titular.sexo) dst.titular.sexo = src.titular.sexo;
  if (!dst.titular.lugarNacimiento.ciudad && src.titular.lugarNacimiento.ciudad) {
    dst.titular.lugarNacimiento.ciudad = src.titular.lugarNacimiento.ciudad;
    dst.titular.lugarNacimiento.departamento = src.titular.lugarNacimiento.departamento;
  }
  if (!dst.documento.pais && src.documento.pais) dst.documento.pais = src.documento.pais;
  if (!dst.documento.tipo && src.documento.tipo) dst.documento.tipo = src.documento.tipo;
}

// ---------------------------------------------------------------------------
// Normalización de ORIENTACIÓN del frente (cédulas escaneadas/fotografiadas a 90°).
//
// HALLAZGO (lote real de 57 cédulas, 2026-06): varios frentes llegan ROTADOS 90°
// (la imagen es portrait en píxeles, pero el TEXTO corre en vertical). En esos
// frames, el valor impreso no cae DEBAJO de su etiqueta en coordenadas de imagen
// sino AL COSTADO (la relación etiqueta→valor del documento está rotada). Todo el
// anclaje (`lineBelow`, `resolveOldNames`, `findDateLabel`, `valueRight`, y cada
// umbral en píxeles) compara POSICIONES RELATIVAS, que son invariantes a una
// rotación rígida: si rotamos las 4 esquinas de cada caja para volver el documento
// a su orientación de lectura ANTES de extraer, todo lo de abajo funciona sin
// tocarse. Verificado con boxes reales: la fecha "16-07-2030" (caja 40×202, alto≫
// ancho = texto vertical) y su etiqueta "FECHA DE VENCIMIENTO" (37×368) quedaban
// con `cy(valor) < cy(etiqueta)` → el filtro `l.cy > label.cy` de `lineBelow` las
// descartaba → fechaNac/fechaVenc VACÍAS pese a leerse con score 0.99. Además el
// par apellidos/nombres salía INVERTIDO (mismo frame rotado).
//
// PaddleOCR devuelve cajas AXIS-ALIGNED (el orden de esquinas NO codifica dirección
// de lectura), así que NO se puede discriminar 90 vs 270 por geometría pura. Por eso
// el chooser es AUTO-VALIDANTE: cuando el frente es claramente VERTICAL prueba
// {90°, 270°}; cuando es HORIZONTAL prueba {0°, 180°} (upright vs cabeza-abajo). En
// ambos corre el extractor REAL bajo cada candidato y se queda con el que ancla MÁS
// campos requeridos. El 0° (identidad) gana SIEMPRE los empates en horizontal →
// AnchorLines byte-idénticas → CERO regresión (un upright nunca cae a 180°, y las 3
// cédulas conocidas, todas upright, quedan intactas por construcción). El 180° sólo
// gana si ancla ESTRICTAMENTE más campos que el 0° — el caso cabeza-abajo real.
// FAIL-CLOSED: si ningún candidato ancla campos, el resultado queda vacío.
// ---------------------------------------------------------------------------

/** Rota un punto (x,y) por `angleDeg` ∈ {0,90,180,270} (sentido matemático CCW). */
function rotatePoint(x: number, y: number, angleDeg: number): [number, number] {
  switch (((angleDeg % 360) + 360) % 360) {
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
    default:
      return [x, y];
  }
}

/**
 * Rota las 4 esquinas de cada `OcrLine` por `angleDeg`. Sólo importan posiciones
 * RELATIVAS (el anclaje compara distancias/orden), así que NO normalizamos la
 * traslación: la rotación rígida ya preserva `cy>label.cy`, `|Δx|`, `Δy` y los
 * factores de altura (`h*1.8`). Para 90/270 el min/max de las esquinas rotadas
 * intercambia ancho↔alto automáticamente. `angleDeg=0` devuelve copias idénticas
 * (identidad). NO muta la entrada.
 */
function rotateOcrLines(lines: OcrLine[], angleDeg: number): OcrLine[] {
  if (((angleDeg % 360) + 360) % 360 === 0) return lines;
  return lines.map((l) => ({
    ...l,
    box: l.box.map((p) => rotatePoint(p[0], p[1], angleDeg)) as OcrLine["box"],
  }));
}

/**
 * ¿El frente está rotado 90° (texto VERTICAL)? Heurística por aspecto de caja: en
 * un frente UPRIGHT las líneas impresas son anchas-y-bajas (ancho≫alto); en uno
 * rotado 90° son altas-y-angostas (alto≫ancho). Contamos cajas de texto legible
 * (score alto, ≥4 chars) verticales vs horizontales y exigimos MAYORÍA CLARA de
 * verticales para gatear la corrección (gate estricto → no toca upright). Validado
 * en el lote: rotados dan v≈12-14/h=0; upright dan h≈14-20/v=0 (separación limpia).
 */
function looksVertical(lines: OcrLine[]): boolean {
  let vert = 0;
  let horz = 0;
  for (const l of lines) {
    if (l.score < 0.8) continue;
    if (l.text.trim().length < 4) continue;
    const xs = l.box.map((p) => p[0]);
    const ys = l.box.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w <= 0 || h <= 0) continue;
    if (h / w > 1.3) vert++;
    else if (w / h > 1.3) horz++;
  }
  // Mayoría CLARA de verticales (y al menos 3 para no disparar con ruido).
  return vert >= 3 && vert > horz * 2;
}

/** Cuenta campos REQUERIDOS no vacíos de un `extracted` (oráculo del chooser). */
function requiredFieldCount(e: ExtractedDocument): number {
  let n = 0;
  if (e.titular.apellidos) n++;
  if (e.titular.nombres) n++;
  if (e.titular.fechaNacimiento) n++;
  if (e.documentoFisico.fechaVencimiento) n++;
  if (e.documento.numeroCedula) n++;
  return n;
}

/**
 * Devuelve las líneas del frente en su orientación de LECTURA probando el conjunto
 * de rotaciones {0,90,180,270} que corresponde a la geometría detectada: si el texto
 * se ve VERTICAL prueba {90°,270°}; si se ve HORIZONTAL prueba {0°,180°} (upright vs
 * cabeza-abajo). Corre el extractor REAL bajo cada candidato y devuelve las líneas del
 * que ancló MÁS campos requeridos (auto-validante; PaddleOCR no codifica dirección de
 * lectura). El primer candidato gana los empates: 0° (identidad) en horizontal — así
 * un upright nunca se reorienta, CERO regresión — y 90° en vertical. Si ningún
 * candidato ancla, devuelve el de mayor score igual y el extractor downstream fail-closea.
 *
 * Devuelve `{ lines, angle }` para que el Inspector pueda rotar también la imagen
 * de overlay por el MISMO ángulo y que las cajas dibujadas calcen.
 */
function orientFrontLines(frontLines: OcrLine[]): { lines: OcrLine[]; angle: number } {
  // Conjunto de candidatos según la geometría de las cajas:
  //   - Texto VERTICAL (alto≫ancho) → la imagen está rotada 90° en píxeles; el
  //     enderezamiento es {90,270} (sentido desconocido: PaddleOCR no codifica
  //     dirección de lectura, así que probamos ambos).
  //   - Texto HORIZONTAL → o bien UPRIGHT (0°) o bien CABEZA-ABAJO (180°). Probamos
  //     {0,180}. El 0° va PRIMERO y la comparación es estricta (`>`), de modo que un
  //     upright (que ancla todo a 0°) NUNCA cae a 180° → CERO regresión, y la rama
  //     0° devuelve `frontLines` por identidad (`rotateOcrLines(...,0)` no copia).
  // En ambos casos corremos el extractor REAL bajo cada candidato y nos quedamos con
  // el que ancla MÁS campos requeridos (auto-validante). El primer candidato gana los
  // empates (identidad-preferente). FAIL-CLOSED: si ninguno ancla, igual devolvemos el
  // de mayor score (0 en horizontal, 90 en vertical) y el downstream queda vacío.
  const candidates = looksVertical(frontLines) ? [90, 270] : [0, 180];
  let best: { lines: OcrLine[]; angle: number; score: number } | null = null;
  for (const angle of candidates) {
    const rotated = rotateOcrLines(frontLines, angle);
    const probe = emptyExtracted();
    extractFrontInto(rotated, probe);
    const score = requiredFieldCount(probe);
    if (best === null || score > best.score) best = { lines: rotated, angle, score };
  }
  return { lines: best!.lines, angle: best!.angle };
}

/**
 * Extrae los campos del FRENTE por anclaje posición→etiqueta (FUENTE AUTORITATIVA).
 * NORMALIZA primero la orientación (cédulas rotadas 90°) y luego ancla. Best-effort:
 * cada campo se setea sólo si su ancla existe; lo demás queda en blanco.
 */
function extractFront(frontLines: OcrLine[], extracted: ExtractedDocument): void {
  const { lines } = orientFrontLines(frontLines);
  extractFrontInto(lines, extracted);
}

/**
 * Núcleo del anclaje del frente sobre líneas YA orientadas (orientación de lectura).
 * Separado de `extractFront` para que el chooser de orientación (`orientFrontLines`)
 * pueda correrlo como sonda bajo cada rotación candidata SIN recursión. Toda la
 * lógica de anclaje vive acá, intacta.
 */
function extractFrontInto(frontLines: OcrLine[], extracted: ExtractedDocument): void {
  const lines = toAnchorLines(frontLines);
  const labels = collectKnownLabels(lines);

  // País / tipo: presencia textual (watermarks/rótulos). Canon tolera acentos/símbolos.
  const allText = lines.map((l) => canon(l.text)).join(" ");
  if (/REPUBLICA DEL PARAGUAY/.test(allText)) {
    extracted.documento.pais = "REPUBLICA DEL PARAGUAY";
  }
  if (/IDENTIDAD CIVIL/.test(allText)) {
    extracted.documento.tipo = "Cedula de Identidad Civil";
  }
  // Specimen: muestras llevan la palabra "SPECIMEN"/"MUESTRA".
  extracted.documento.specimen = /\bSPECIMEN\b|\bMUESTRA\b/.test(allText);

  // FORMATO VIEJO: etiqueta combinada "APELLIDOS, NOMBRES" con dos líneas de valor
  // debajo (1ª=apellidos, 2ª=nombres). Si la detectamos, resolvemos por aquí y
  // SALTAMOS la lógica de etiquetas separadas (que en este layout colapsaría: tanto
  // findLabel("APELLIDOS") como findLabel("NOMBRES") matchearían la MISMA línea
  // combinada). El resto de campos (fechas/sexo/lugar/CI) se comparten más abajo.
  const combinedLabel = findCombinedNameLabel(lines);
  if (combinedLabel) {
    const { apellidos: apeLine, nombres: nomLine } = resolveOldNames(lines, combinedLabel);
    const ape = cleanName(apeLine?.text ?? "");
    const nom = cleanName(nomLine?.text ?? "");
    if (ape) extracted.titular.apellidos = ape;
    if (nom) extracted.titular.nombres = nom;
  } else {
  // Nombres / Apellidos (valor debajo de la etiqueta). `accept: looksLikeName`
  // salta el ruido del watermark/guilloche ("DEL","PARA","ICA"...) que en capturas
  // movidas/comprimidas cae más cerca en Y que el valor real. Sin este filtro el
  // anclaje agarraba "DEL" (de "REPÚBLICA DEL PARAGUAY") como apellido. maxDx
  // ampliado: en la captura real el valor puede quedar levemente desalineado en X.
  //
  // ORDEN: resolvemos NOMBRES PRIMERO para poder EXCLUIR su línea exacta al anclar
  // APELLIDOS. En la captura real comprimida del cel, la fila de APELLIDOS quedó
  // VACÍA (el OCR no leyó "SOTELO MACHUCA"); el valor de NOMBRES ("SILVIO ANDRES",
  // cy≈772) cae a sólo ~17px de la etiqueta NOMBRES pero ~77px de APELLIDOS, y sin
  // guardas el anclaje de APELLIDOS lo agarraba → apellidos===nombres (BUG).
  //
  // GUARDAS para APELLIDOS:
  //   1) `maxDy` ESTRECHO (~48px): el gap real etiqueta→valor en este layout es ~18px
  //      (vencimiento 695→715, nombres 755→772, nac 914→933, lugar 955→973). Una banda
  //      angosta sólo admite la línea de la fila INMEDIATAMENTE bajo APELLIDOS; descarta
  //      el valor de NOMBRES (cy lejano) y la basura "Adwato" (cy≈858, muy abajo).
  //   2) excluimos la LÍNEA EXACTA elegida como nombres (`nombresLine`).
  //   3) si pese a todo apellidos===nombres, es señal de error de anclaje → lo dejamos
  //      VACÍO (fail-closed → revisión manual). NUNCA copiamos el valor de NOMBRES.
  const nombresLine = findValueLineBelow(lines, "NOMBRES", labels, {
    accept: looksLikeName,
    maxDx: 360,
  });
  const nombres = cleanName(nombresLine?.text ?? "");
  if (nombres) extracted.titular.nombres = nombres;

  // GUARDAS (revisadas — validadas contra la imagen real + variantes rotadas):
  //   1) `maxDy` ya NO es un absoluto frágil. El gap real etiqueta→valor escala con
  //      el tamaño del texto; un 48px fijo (tuneado a label-height≈39) VACIABA el
  //      apellido cuando la cédula se fotografía más grande (real: label-height≈55 →
  //      gap≈66 > 48). Ahora la banda es `max(56, h*1.8)`: admite el valor real
  //      aunque la foto sea más grande/rotada, y sigue MUY por debajo de la fila
  //      NOMBRES (a ~4-5× la altura de la etiqueta), que además se excluye por
  //      identidad (`nombresLine`) y por anti-copia.
  //   2) `looksLikeName` ahora rechaza por substring el watermark "REPÚBLICA DEL
  //      PARAGUAY" OCR-corrupto (real: "CPUBLICADELPARAGUAYRIEPUB" se colaba como
  //      apellido cuando la banda se ampliaba). Con eso, el ÚNICO candidato en banda
  //      es el apellido verdadero → la selección por cercanía-Y basta (NO se necesita
  //      preferir score; sería redundante).
  //   3) `minScore: 0.6` (más estricto que el 0.3 global): el apellido impreso real
  //      lee score ~0.97-0.99; un blob de ruido OCR de una foto demasiado distorsionada
  //      lee ~0.39 y NO debe convertirse en apellido. Fail-closed: ante texto ilegible,
  //      apellidos queda VACÍO (revisión manual), NUNCA basura — un apellido erróneo
  //      en KYC es peor que uno ausente.
  const apellidosExclude = nombresLine ? [...labels, nombresLine] : labels;
  const apellidos = cleanName(
    fieldBelow(lines, "APELLIDOS", apellidosExclude, {
      accept: looksLikeName,
      maxDx: 360,
      maxDy: 56,
      dyHeightFactor: 1.8,
      minScore: 0.6,
    })
  );
  // Anti-copia: apellidos jamás puede quedar igual a nombres (síntoma del bug).
  if (apellidos && apellidos !== nombres) extracted.titular.apellidos = apellidos;
  } // fin modo nuevo (etiquetas APELLIDOS/NOMBRES separadas)

  // Fecha de vencimiento. Etiqueta tolerante (`VENC`): el formato viejo la lee
  // "FECHA DE VENCIMENTO" (sin "I"). `accept` salta fragmentos de guilloche: sólo
  // acepta el candidato con forma DD-MM-YYYY.
  const vencLbl = findDateLabel(lines, "VENC");
  const venc = vencLbl
    ? printedDateToIso(valueBelow(lines, vencLbl, { accept: looksLikeDate, exclude: labels }))
    : "";
  if (venc) extracted.documentoFisico.fechaVencimiento = venc;

  // Fecha de nacimiento. Idem: el valor "13-11-1997" está debajo, con ruido en medio.
  const nacLbl = findDateLabel(lines, "NAC");
  const nac = nacLbl
    ? printedDateToIso(valueBelow(lines, nacLbl, { accept: looksLikeDate, exclude: labels }))
    : "";
  if (nac) extracted.titular.fechaNacimiento = nac;

  // Sexo (MASCULINO/FEMENINO). El fragmento de watermark "CAL" queda más cerca en Y
  // que "MASCULINO"; `accept` lo descarta y toma el valor real.
  const sexoRaw = canon(
    fieldBelow(lines, "SEXO", labels, { accept: (t) => /MASCULINO|FEMENINO/.test(canon(t)) })
  );
  if (/MASCULINO|FEMENINO/.test(sexoRaw)) {
    extracted.titular.sexo = sexoRaw.includes("FEM") ? "FEMENINO" : "MASCULINO";
  }

  // Donante (SI/NO). `accept` salta el ruido y los valores de campos vecinos que
  // caen entre la etiqueta DONANTE y su valor (p.ej. "SILVIO ANDRES" de NOMBRES,
  // que en la captura real se interpone en Y). Sólo acepta tokens SI/NO exactos.
  const donanteRaw = canon(
    fieldBelow(lines, "DONANTE", labels, {
      accept: (t) => /^(SI|NO)$/.test(canon(t)),
      maxDy: 260,
    })
  );
  if (donanteRaw === "SI" || donanteRaw === "NO") {
    extracted.titular.donante = donanteRaw === "SI";
  }

  // Lugar de nacimiento: "CIUDAD-DEPARTAMENTO" (splitea por "-" si está).
  // `accept: looksLikeCity` EXCLUYE explícitamente el número de cédula. En la
  // captura real el rótulo "N° 4895448" (cy≈956) cae en la MISMA fila que la
  // etiqueta "LUGAR DE NACIMIENTO" (cy≈955) y a sólo 192px en X → sin filtro el
  // anclaje lo tomaba como lugar de nacimiento (BUG: lugarNacimiento="4895448").
  // La ciudad real "ASUNCION" (cy≈973) está un pelo más abajo; el filtro salta el
  // número y la toma. Un lugar de nacimiento NUNCA puede ser numérico.
  const lugar = fieldBelow(lines, "LUGAR DE NACIMIENTO", labels, { accept: looksLikeCity });
  if (lugar) {
    const parts = lugar.split(/\s*-\s*/);
    extracted.titular.lugarNacimiento.ciudad = (parts[0] ?? "").trim();
    extracted.titular.lugarNacimiento.departamento = (parts[1] ?? "").trim();
  }

  // Nº de cédula. Dos sub-casos de anclaje (en orden de preferencia):
  //   (a) FUSIONADO: el OCR junta el rótulo y los dígitos en UN token "Nº2962683"
  //       (real CAYO, formato nuevo: "N2962683"). Una sola línea con forma
  //       "N[º°o]? + 6-8 dígitos" → el valor (y su ancla) ES esa misma línea.
  //   (b) SEPARADO: rótulo "Nº" con los dígitos a la DERECHA en la misma fila
  //       (layouts donde el OCR los separa).
  const fusedNo = findFusedCiLine(lines);
  if (fusedNo) {
    const digits = fusedNo.text.replace(/\D/g, "");
    if (digits.length >= 5) extracted.documento.numeroCedula = digits;
  } else {
    const noLabel = lines
      .filter((l) => /^N[º°O]?\.?$/i.test(l.text.trim()) || canon(l.text) === "NO")
      .sort((a, b) => b.score - a.score)[0];
    if (noLabel) {
      const num = valueRight(lines, noLabel, (t) => /\d{5,8}/.test(t.replace(/\D/g, "")));
      const digits = num.replace(/\D/g, "");
      if (digits.length >= 5) extracted.documento.numeroCedula = digits;
    }
  }
  // Fallback: si no encontramos por ancla "Nº", buscamos una línea de 6-8 dígitos
  // que NO sea una fecha (heurística defensiva, sólo si quedó vacío). Excluimos
  // tokens con forma DD-MM-YYYY: "12-07-2033" colapsa a "12072033" (8 dígitos) y
  // robaría el lugar del Nº real.
  if (!extracted.documento.numeroCedula) {
    const cand = oldFormatCiFallback(lines);
    if (cand) extracted.documento.numeroCedula = cand;
  }
}

/**
 * Fallback de Nº de cédula para el FORMATO VIEJO (sin rótulo "Nº"): el número va
 * suelto ABAJO-A-LA-DERECHA del frente (real: "8354119", 7 dígitos). Tomamos el
 * token de 6-8 dígitos que NO sea una fecha, priorizando el MÁS ABAJO y luego el
 * MÁS A LA DERECHA (spec §formato-viejo). Excluimos DD-MM-YYYY: "26-03-2028"
 * colapsa a 8 dígitos y robaría el lugar. Devuelve "" si no hay candidato.
 */
/**
 * Detecta la línea del Nº de cédula cuando el OCR FUSIONA el rótulo "Nº" con los
 * dígitos en un solo token (real CAYO frente nuevo: "N2962683"). Acepta el prefijo
 * N / Nº / N° / No / N. seguido de 6-8 dígitos (con posibles separadores OCR como
 * espacios/puntos que se descartan al contar). NO matchea una fecha (ya no empieza
 * por N) ni un IC. Devuelve la línea de mayor score; la propia línea es a la vez el
 * valor Y su ancla posicional (no hay rótulo separado).
 */
function findFusedCiLine(lines: AnchorLine[]): AnchorLine | undefined {
  return lines
    .filter((l) => {
      const t = l.text.trim();
      if (!/^N[º°o.]?\s?\d/i.test(t)) return false; // arranca con N + (rótulo opc) + dígito
      const digits = t.replace(/\D/g, "");
      return digits.length >= 6 && digits.length <= 8;
    })
    .sort((a, b) => b.score - a.score)[0];
}

/**
 * Línea-candidata del CI suelto del FORMATO VIEJO (token 6-8 dígitos no-fecha,
 * abajo-derecha). Devuelve la `AnchorLine` elegida para que el debug pueda
 * dibujar su ancla; `extractFront`/producción sólo usan sus dígitos vía
 * `oldFormatCiFallback`. Mismo criterio de selección en ambos (línea única).
 */
function oldFormatCiFallbackLine(lines: AnchorLine[]): AnchorLine | undefined {
  return lines
    .filter((l) => !DATE_RE.test(l.text))
    .filter((l) => {
      const d = l.text.replace(/\D/g, "");
      return d.length >= 6 && d.length <= 8;
    })
    // Más abajo primero; a igual fila, más a la derecha.
    .sort((a, b) => b.cy - a.cy || b.cx - a.cx)[0];
}

function oldFormatCiFallback(lines: AnchorLine[]): string {
  return oldFormatCiFallbackLine(lines)?.text.replace(/\D/g, "") ?? "";
}

// ---------------------------------------------------------------------------
// DEBUG (playground OCR del admin) — instrumentación ADITIVA del anclaje del
// FRENTE. NO la consume el pipeline de producción: `extractFront`/`run` quedan
// intactos. Reproduce EXACTAMENTE las mismas decisiones de anclaje que
// `extractFront`, pero captura, por cada campo, la LÍNEA OCR elegida (su índice
// + caja) y la caja de su ETIQUETA — para que el front dibuje qué ancló a qué.
// ---------------------------------------------------------------------------

/** bbox [x1,y1,x2,y2] de una línea OCR normalizada (por su índice). */
function boxOf(lines: OcrLine[], idx: number): [number, number, number, number] {
  const xs = lines[idx].box.map((p) => p[0]);
  const ys = lines[idx].box.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Ancla de un campo: índice/caja de la línea-valor + caja de la etiqueta. */
export interface FieldAnchor {
  /** Índice (en el `OcrLine[]` normalizado) de la línea cuyo texto fue el valor. */
  lineIndex: number;
  /** bbox [x1,y1,x2,y2] de esa línea-valor. */
  box: [number, number, number, number];
  /** bbox [x1,y1,x2,y2] de la etiqueta que ancló el valor (si la hubo). */
  labelBox: [number, number, number, number] | null;
  /** Texto crudo de la línea elegida (para inspección). */
  text: string;
}

/** Resultado del debug del frente: campos extraídos + anclas por campo. */
export interface FrontDebug {
  extracted: ExtractedDocument;
  anchors: Record<string, FieldAnchor>;
  /**
   * Ángulo (0/90/270) que se aplicó para enderezar el frente ANTES de anclar.
   * INFORMATIVO: las cajas de `anchors` se reportan en el espacio de la IMAGEN
   * ORIGINAL (mismo índice de línea → misma caja sin rotar), así calzan sobre
   * `imageUsed` sin rotar la imagen. El Inspector lo muestra como metadato
   * ("tratado como rotado 90°"); NO debe transformar la imagen con él.
   */
  angle: number;
}

/**
 * Variante de `extractFront` INSTRUMENTADA para el playground OCR. Devuelve los
 * MISMOS campos que `extractFront` (reusa los mismos predicados/umbrales) y,
 * además, por cada campo anclado por posición, la línea OCR elegida (lineIndex +
 * box) y la caja de su etiqueta. Los campos que se derivan por presencia textual
 * (pais/tipo/specimen) o por regex global (fallback de Nº) no tienen ancla
 * posicional y NO aparecen en `anchors` (su valor sí en `extracted`).
 *
 * Se mantiene SEPARADA de `extractFront` a propósito: producción no paga el costo
 * de la metadata y el contrato de `document()` no cambia.
 */
export function extractFrontDebug(frontLines: OcrLine[]): FrontDebug {
  const extracted = emptyExtracted();
  // Endereza la orientación primero (cédulas rotadas 90°): MISMA decisión que
  // producción (`orientFrontLines`). El ANCLAJE corre sobre las líneas rotadas
  // (posiciones relativas), pero las CAJAS de las anclas se reportan en el espacio
  // de la imagen ORIGINAL (vía `boxOf(frontLines, idx)`: `rotateOcrLines` es un
  // `.map` que preserva el orden, así que `idx` indexa idéntico ambas listas).
  // Así el overlay calza sobre `imageUsed` SIN rotar la imagen.
  const { angle } = orientFrontLines(frontLines);
  const orientedLines = rotateOcrLines(frontLines, angle);
  const lines = toAnchorLines(orientedLines);
  const labels = collectKnownLabels(lines);
  const anchors: Record<string, FieldAnchor> = {};

  /** Registra el ancla de un campo a partir de la línea-valor y su etiqueta. */
  const record = (
    field: string,
    valueLine: AnchorLine | undefined,
    label: string
  ): void => {
    if (!valueLine) return;
    const lbl = findLabel(lines, label);
    anchors[field] = {
      lineIndex: valueLine.idx,
      box: boxOf(frontLines, valueLine.idx),
      labelBox: lbl ? boxOf(frontLines, lbl.idx) : null,
      text: valueLine.text.trim(),
    };
  };

  // País / tipo / specimen: presencia textual (sin ancla posicional).
  const allText = lines.map((l) => canon(l.text)).join(" ");
  if (/REPUBLICA DEL PARAGUAY/.test(allText)) {
    extracted.documento.pais = "REPUBLICA DEL PARAGUAY";
  }
  if (/IDENTIDAD CIVIL/.test(allText)) {
    extracted.documento.tipo = "Cedula de Identidad Civil";
  }
  extracted.documento.specimen = /\bSPECIMEN\b|\bMUESTRA\b/.test(allText);

  // Registra un ancla con etiqueta EXPLÍCITA (no por nombre canónico): el modo
  // viejo usa etiquetas combinadas/tolerantes cuya caja no recupera findLabel.
  const recordWith = (
    field: string,
    valueLine: AnchorLine | undefined,
    label: AnchorLine | undefined
  ): void => {
    if (!valueLine) return;
    anchors[field] = {
      lineIndex: valueLine.idx,
      box: boxOf(frontLines, valueLine.idx),
      labelBox: label ? boxOf(frontLines, label.idx) : null,
      text: valueLine.text.trim(),
    };
  };

  // FORMATO VIEJO: etiqueta combinada "APELLIDOS, NOMBRES" + dos valores debajo
  // (1ª=apellidos, 2ª=nombres). Mismo helper compartido que extractFront → mismas
  // anclas. Si no hay etiqueta combinada, cae al modo nuevo (etiquetas separadas).
  const combinedLabel = findCombinedNameLabel(lines);
  if (combinedLabel) {
    const { apellidos: apeLine, nombres: nomLine } = resolveOldNames(lines, combinedLabel);
    const ape = cleanName(apeLine?.text ?? "");
    const nom = cleanName(nomLine?.text ?? "");
    if (ape) {
      extracted.titular.apellidos = ape;
      recordWith("apellidos", apeLine, combinedLabel);
    }
    if (nom) {
      extracted.titular.nombres = nom;
      recordWith("nombres", nomLine, combinedLabel);
    }
  } else {
  // NOMBRES (resuelto primero, igual que en extractFront).
  const nombresLine = findValueLineBelow(lines, "NOMBRES", labels, {
    accept: looksLikeName,
    maxDx: 360,
  });
  const nombres = cleanName(nombresLine?.text ?? "");
  if (nombres) {
    extracted.titular.nombres = nombres;
    record("nombres", nombresLine, "NOMBRES");
  }

  // APELLIDOS (mismas guardas que extractFront).
  const apellidosExclude = nombresLine ? [...labels, nombresLine] : labels;
  const apellidosLine = findValueLineBelow(lines, "APELLIDOS", apellidosExclude, {
    accept: looksLikeName,
    maxDx: 360,
    maxDy: 56,
    dyHeightFactor: 1.8,
    minScore: 0.6,
  });
  const apellidos = cleanName(apellidosLine?.text ?? "");
  if (apellidos && apellidos !== nombres) {
    extracted.titular.apellidos = apellidos;
    record("apellidos", apellidosLine, "APELLIDOS");
  }
  } // fin modo nuevo

  // Fecha de vencimiento (etiqueta tolerante `VENC`: soporta "VENCIMENTO" viejo).
  const vencLbl = findDateLabel(lines, "VENC");
  const vencLine = vencLbl
    ? lineBelow(lines, vencLbl, { accept: looksLikeDate, exclude: labels })
    : undefined;
  const venc = printedDateToIso(vencLine?.text ?? "");
  if (venc) {
    extracted.documentoFisico.fechaVencimiento = venc;
    recordWith("fechaVencimiento", vencLine, vencLbl);
  }

  // Fecha de nacimiento (etiqueta tolerante `NAC`).
  const nacLbl = findDateLabel(lines, "NAC");
  const nacLine = nacLbl
    ? lineBelow(lines, nacLbl, { accept: looksLikeDate, exclude: labels })
    : undefined;
  const nac = printedDateToIso(nacLine?.text ?? "");
  if (nac) {
    extracted.titular.fechaNacimiento = nac;
    recordWith("fechaNacimiento", nacLine, nacLbl);
  }

  // Sexo.
  const sexoLine = findValueLineBelow(lines, "SEXO", labels, {
    accept: (t) => /MASCULINO|FEMENINO/.test(canon(t)),
  });
  const sexoRaw = canon(sexoLine?.text ?? "");
  if (/MASCULINO|FEMENINO/.test(sexoRaw)) {
    extracted.titular.sexo = sexoRaw.includes("FEM") ? "FEMENINO" : "MASCULINO";
    record("sexo", sexoLine, "SEXO");
  }

  // Donante.
  const donanteLine = findValueLineBelow(lines, "DONANTE", labels, {
    accept: (t) => /^(SI|NO)$/.test(canon(t)),
    maxDy: 260,
  });
  const donanteRaw = canon(donanteLine?.text ?? "");
  if (donanteRaw === "SI" || donanteRaw === "NO") {
    extracted.titular.donante = donanteRaw === "SI";
    record("donante", donanteLine, "DONANTE");
  }

  // Lugar de nacimiento.
  const lugarLine = findValueLineBelow(lines, "LUGAR DE NACIMIENTO", labels, {
    accept: looksLikeCity,
  });
  const lugar = lugarLine?.text.trim() ?? "";
  if (lugar) {
    const parts = lugar.split(/\s*-\s*/);
    extracted.titular.lugarNacimiento.ciudad = (parts[0] ?? "").trim();
    extracted.titular.lugarNacimiento.departamento = (parts[1] ?? "").trim();
    record("lugarNacimiento", lugarLine, "LUGAR DE NACIMIENTO");
  }

  // Nº de cédula. (a) FUSIONADO "Nº2962683" en un token (real CAYO): el valor y su
  // ancla SON esa línea (labelBox = su propia caja). (b) SEPARADO: rótulo "Nº" con
  // dígitos a la DERECHA. Mismo orden de preferencia que extractFront.
  const fusedNo = findFusedCiLine(lines);
  if (fusedNo) {
    const digits = fusedNo.text.replace(/\D/g, "");
    if (digits.length >= 5) {
      extracted.documento.numeroCedula = digits;
      anchors["ci"] = {
        lineIndex: fusedNo.idx,
        box: boxOf(frontLines, fusedNo.idx),
        labelBox: boxOf(frontLines, fusedNo.idx),
        text: fusedNo.text.trim(),
      };
    }
  } else {
    const noLabel = lines
      .filter((l) => /^N[º°O]?\.?$/i.test(l.text.trim()) || canon(l.text) === "NO")
      .sort((a, b) => b.score - a.score)[0];
    if (noLabel) {
      const numLine = lines
        .filter((l) => l !== noLabel && l.score >= 0.3)
        .filter((l) => Math.abs(l.cy - noLabel.cy) <= 60)
        .filter((l) => l.cx > noLabel.cx)
        .filter((l) => /\d{5,8}/.test(l.text.replace(/\D/g, "")))
        .sort((a, b) => a.cx - b.cx)[0];
      if (numLine) {
        const digits = numLine.text.replace(/\D/g, "");
        if (digits.length >= 5) {
          extracted.documento.numeroCedula = digits;
          anchors["ci"] = {
            lineIndex: numLine.idx,
            box: boxOf(frontLines, numLine.idx),
            labelBox: boxOf(frontLines, noLabel.idx),
            text: numLine.text.trim(),
          };
        }
      }
    }
  }
  // Fallback (CI suelto del formato viejo, p.ej. "8354119" sin rótulo "Nº"):
  // token de 6-8 dígitos no-fecha, abajo-derecha. Ahora SÍ recupera la línea
  // elegida para anclarla en el Inspector (labelBox = su propia caja, no hay
  // rótulo separado). Mismo valor que producción vía `oldFormatCiFallback`.
  if (!extracted.documento.numeroCedula) {
    const candLine = oldFormatCiFallbackLine(lines);
    const digits = candLine?.text.replace(/\D/g, "") ?? "";
    if (digits) {
      extracted.documento.numeroCedula = digits;
      if (candLine) {
        anchors["ci"] = {
          lineIndex: candLine.idx,
          box: boxOf(frontLines, candLine.idx),
          labelBox: boxOf(frontLines, candLine.idx),
          text: candLine.text.trim(),
        };
      }
    }
  }

  return { extracted, anchors, angle };
}

/**
 * Extrae los campos del DORSO por anclaje (mismo patrón). Best-effort.
 */
function extractBack(backLines: OcrLine[], extracted: ExtractedDocument): void {
  const lines = toAnchorLines(backLines);
  const labels = collectKnownLabels(lines);
  const allText = lines.map((l) => canon(l.text)).join(" ");

  // Estado civil (SOL/CAS/VIU/DIV — habitualmente abreviado).
  const estado = canon(fieldBelow(lines, "ESTADO CIVIL", labels));
  if (estado) extracted.titular.estadoCivil = estado.split(" ")[0];

  // Nacionalidad.
  const nacio = canon(fieldBelow(lines, "NACIONALIDAD", labels));
  if (nacio) extracted.titular.nacionalidad = nacio;

  // Fecha de emisión. `accept: looksLikeDate` (igual que nacimiento/vencimiento):
  // salta fragmentos de guilloche/ruido y sólo toma el candidato con forma
  // DD-MM-YYYY. Sin este filtro el anclaje devolvía ruido y fechaEmision quedaba "".
  const emis = printedDateToIso(
    fieldBelow(lines, "FECHA DE EMISION", labels, { accept: looksLikeDate })
  );
  if (emis) extracted.documentoFisico.fechaEmision = emis;

  // IC: formato 999-9999999-999-999.
  const icMatch = allText.replace(/\s+/g, "").match(/\d{3}-?\d{7}-?\d{3}-?\d{3}/);
  // El allText canónico quitó los guiones; buscamos sobre el texto crudo concatenado.
  const rawJoin = lines.map((l) => l.text).join(" ");
  const ic = rawJoin.match(/\d{3}-\d{7}-\d{3}-\d{3}/);
  if (ic) extracted.registroInterno.ic = ic[0];
  else if (icMatch) extracted.registroInterno.ic = icMatch[0];

  // Ubicación: formato PN-...
  const ubi = rawJoin.match(/\bP[NM]-[A-Z0-9\-]+/i);
  if (ubi) extracted.registroInterno.ubicacion = ubi[0].toUpperCase();

  // Código de barras: texto "AA"+dígitos presente → true.
  extracted.documentoFisico.codigoBarras = /\bA{2}\d{3,}/.test(rawJoin.replace(/\s+/g, ""));

  // Autoridad emisora: líneas arriba-derecha del dorso (nombre/cargo/dependencia).
  // Heurística: las líneas con más texto en la mitad derecha y parte superior.
  extractAuthority(lines, extracted);
}

/**
 * Autoridad emisora: tomamos las líneas de la zona superior-derecha que no sean
 * etiquetas/valores ya consumidos y que parezcan nombre/cargo/dependencia.
 * Heurística tolerante (best-effort): firma con cargo policial ("COMISARIO"),
 * dependencia ("JEFE DPTO"/"IDENTIFICACIONES") y el nombre propio.
 */
function extractAuthority(lines: AnchorLine[], extracted: ExtractedDocument): void {
  const dependencia = lines.find((l) => /JEFE|DPTO|IDENTIFICACION/.test(canon(l.text)));
  if (dependencia) extracted.autoridadEmisora.dependencia = dependencia.text.trim();
  const cargo = lines.find((l) => /COMISARIO|PRINCIPAL|MCP|OFICIAL/.test(canon(l.text)));
  if (cargo) extracted.autoridadEmisora.cargo = cargo.text.trim();
  // El nombre: una línea de 2-3 palabras alfabéticas cercana al cargo, distinta de él.
  if (cargo) {
    const nameCand = lines
      .filter((l) => l !== cargo && l !== dependencia)
      .filter((l) => Math.abs(l.cy - cargo.cy) <= 180)
      .filter((l) => /^[A-Za-zÀ-ſ ]{4,40}$/.test(l.text.trim()))
      .filter(
        (l) =>
          !/COMISARIO|JEFE|DPTO|IDENTIFICACION|REPUBLICA|PARAGUAY/.test(canon(l.text))
      )
      // No tomar una ETIQUETA conocida como nombre (en la captura real el
      // candidato más cercano al cargo era el rótulo "ESTADO CIVIL").
      .filter((l) => !KNOWN_LABELS.some((lbl) => isLabel(l.text, lbl)))
      .sort((a, b) => a.cy - b.cy)[0];
    if (nameCand) extracted.autoridadEmisora.nombre = nameCand.text.trim();
  }
}

/** Limpia un valor de nombre: sólo letras/espacios, recorta basura, mínimo 2 chars. */
function cleanName(s: string): string {
  const v = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z ]+.*$/s, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  return v.length >= 2 ? v : "";
}

// ---------------------------------------------------------------------------
// Recorte de la foto del titular (frente) vía SCRFD.
// ---------------------------------------------------------------------------

async function cropDocFace(front: Buffer, engine: Engine): Promise<DocFaceCrop | null> {
  const faces = await engine.detect(front);
  const face: Face | null = engine.bestFace(faces);
  if (!face) return null;
  const [x1, y1, x2, y2] = face.bbox.map((v) => Math.round(v)) as [
    number,
    number,
    number,
    number
  ];
  const meta = await sharp(front).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  // Margen del 20% para no recortar la barbilla/frente.
  const mw = Math.round((x2 - x1) * 0.2);
  const mh = Math.round((y2 - y1) * 0.2);
  const left = Math.max(0, x1 - mw);
  const top = Math.max(0, y1 - mh);
  const width = Math.min(W - left, x2 - x1 + 2 * mw);
  const height = Math.min(H - top, y2 - y1 + 2 * mh);
  if (width <= 0 || height <= 0) return null;
  const jpeg = await sharp(front)
    .extract({ left, top, width, height })
    .jpeg({ quality: 90 })
    .toBuffer();
  return {
    base64Jpeg: jpeg.toString("base64"),
    bbox: [left, top, left + width, top + height],
  };
}

// ---------------------------------------------------------------------------
// Autenticidad por cruce (§6.c) — MRZ ya NO bloquea.
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

/** Fin-del-día de una fecha ISO ≥ ahora (vigente todo el día de vencimiento). */
function notExpired(iso: string, maxAgeYears = 0): boolean {
  if (iso === "") return false;
  const expiry = new Date(`${iso}T23:59:59.999Z`);
  if (expiry < new Date()) return false;
  // Spec §16: cédula PY es válida hasta los 75 años de edad.
  if (maxAgeYears > 0) {
    const birthDate = new Date(`${iso}T00:00:00Z`);
    const ageAtExpiry = (expiry.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (ageAtExpiry > maxAgeYears) return false;
  }
  return true;
}

/**
 * Cruce de autenticidad (§6.c) REESCRITO. Modelo:
 *
 *   - DUROS (cuentan para `consistent`): campos impresos REQUERIDOS presentes
 *     (apellidos, nombres, numeroCedula, fechaNacimiento, fechaVencimiento) +
 *     documento no vencido. Esto es exactamente la base de `passed`.
 *   - SOFT (informativos, NO bloquean): consistencia MRZ↔frente (nombre/Nº) SOLO
 *     si el MRZ parseó válido. Nunca reprueban — el MRZ es best-effort.
 *
 * Exportada para test.
 */
export function crossCheck(
  extracted: ExtractedDocument,
  mrz: MrzData,
  barcode: BarcodeData
): Authenticity {
  const checks: AuthenticityCheck[] = [];
  const hard: boolean[] = [];

  // 1) Campos impresos requeridos presentes. DURO.
  const required: Array<[string, string]> = [
    ["apellidos", extracted.titular.apellidos],
    ["nombres", extracted.titular.nombres],
    ["numeroCedula", extracted.documento.numeroCedula],
    ["fechaNacimiento", extracted.titular.fechaNacimiento],
    ["fechaVencimiento", extracted.documentoFisico.fechaVencimiento],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  checks.push({
    name: "printed_fields_present",
    passed: missing.length === 0,
    detail: missing.length ? `faltan: ${missing.join(",")}` : "campos impresos OK",
  });
  hard.push(missing.length === 0);

  // 2) No vencido (campo impreso autoritativo). DURO.
  const exp = extracted.documentoFisico.fechaVencimiento;
  const live = notExpired(exp);
  checks.push({
    name: "not_expired",
    passed: live,
    detail: `vence=${exp || "?"}`,
  });
  hard.push(live);

  // 3) MRZ check-digits. SOFT (informativo) — NO entra en `hard`.
  checks.push({
    name: "mrz_check_digits",
    passed: mrz.valid,
    detail: mrz.valid ? "MRZ check digits OK" : "MRZ no validó (best-effort)",
  });

  // 4) Cruces MRZ↔frente. SOFT (informativos, nunca bloquean). GATING: se disparan
  // cuando el MRZ TRAE LOS CAMPOS (no cuando `valid`). En un dorso PY real el OCR
  // suele degradar ≥1 char y `valid` puede ser false aunque los campos sean buenos;
  // exigir `valid` haría que el cruce NO sume señal NUNCA en producción. Fail-open:
  // si el MRZ no trae el campo, no se agrega el check (no se penaliza su ausencia).
  const mrzHasFields = !!(mrz.surname || mrz.documentNumber || mrz.optionalData);
  if (mrzHasFields) {
    // CI: en la cédula PY el `documentNumber` del MRZ es el SERIAL de la tarjeta
    // (p.ej. "AA0014114") y el NÚMERO DE CÉDULA va en `optional1` (p.ej.
    // "4895448 0207"). Por eso comparamos el CI del frente contra AMBOS campos:
    // documentNumber Y optionalData. Verificado contra un dorso PY real.
    const ocrNum = norm(extracted.documento.numeroCedula);
    const mrzNum = norm(mrz.documentNumber);
    const mrzOpt = norm(mrz.optionalData ?? "");
    if (ocrNum && (mrzNum || mrzOpt)) {
      const matchIn = (hay: string) => !!hay && (hay.includes(ocrNum) || ocrNum.includes(hay));
      const m = matchIn(mrzNum) || matchIn(mrzOpt);
      checks.push({
        name: "mrz_vs_front_number",
        passed: m,
        detail: `mrz.doc=${mrz.documentNumber} mrz.opt=${mrz.optionalData ?? ""} front=${extracted.documento.numeroCedula}`,
      });
    }
    const ocrSur = norm(extracted.titular.apellidos);
    const mrzSur = norm(mrz.surname);
    if (ocrSur && mrzSur) {
      const m = mrzSur.includes(ocrSur) || ocrSur.includes(mrzSur);
      checks.push({
        name: "mrz_vs_front_name",
        passed: m,
        detail: `mrz=${mrz.surname} front=${extracted.titular.apellidos}`,
      });
    }
    // Sexo: MRZ ya normalizado a MASCULINO/FEMENINO (mismo convenio que el frente).
    const ocrSex = norm(extracted.titular.sexo);
    const mrzSex = norm(mrz.sex);
    if (ocrSex && mrzSex) {
      checks.push({
        name: "mrz_vs_front_sex",
        passed: ocrSex === mrzSex,
        detail: `mrz=${mrz.sex} front=${extracted.titular.sexo}`,
      });
    }
  }

  // 5) Barcode ↔ Nº. SOFT.
  if (barcode.text) {
    const bc = norm(barcode.text);
    const num = norm(extracted.documento.numeroCedula);
    checks.push({
      name: "barcode_vs_number",
      passed: !!num && (bc.includes(num) || num.includes(bc)),
      detail: `barcode=${barcode.text}`,
    });
  }

  // consistent = sólo los cruces DUROS (impresos presentes + no vencido).
  // Los SOFT (MRZ/barcode) nunca bloquean.
  const consistent = hard.every((p) => p);
  return { consistent, checks };
}

// ---------------------------------------------------------------------------
// Cross-fill MRZ→frente (ADITIVO, fail-closed). Recupera campos que el OCR del
// FRENTE perdió, tomándolos del MRZ del dorso — SÓLO si el CI del MRZ cruza con
// el CI del frente (evita mezclar identidades).
// ---------------------------------------------------------------------------

/**
 * ¿El CI del MRZ (documentNumber o, en la cédula PY, el CI real en optionalData)
 * coincide con el CI del frente? Reusa el mismo criterio de inclusión bidireccional
 * que `crossCheck.mrz_vs_front_number`. Si el frente NO tiene CI, NO hay cómo cruzar
 * → false (fail-closed: no rellenamos a ciegas).
 */
function mrzCiMatchesFront(extracted: ExtractedDocument, mrz: MrzData): boolean {
  const ocrNum = norm(extracted.documento.numeroCedula);
  if (!ocrNum) return false;
  const mrzNum = norm(mrz.documentNumber);
  const mrzOpt = norm(mrz.optionalData ?? "");
  const matchIn = (hay: string) => !!hay && (hay.includes(ocrNum) || ocrNum.includes(hay));
  if (matchIn(mrzNum) || matchIn(mrzOpt)) return true;
  // FALLBACK sobre las LÍNEAS CRUDAS del MRZ: en la cédula PY el CI real va en el campo
  // de DATO OPCIONAL de la línea 1 (p.ej. "...4895448<0207..."), pero el parser `mrz`
  // a veces deja `optionalData` vacío (línea no-válida por ruido de check-digits del
  // OCR). El CI impreso del frente igual aparece VERBATIM en el texto crudo del MRZ.
  // Exigimos un CI de ≥6 dígitos presente como subcadena EXACTA del MRZ crudo: es un
  // vínculo de identidad fuerte (no bidireccional, no se infla con números cortos).
  if (ocrNum.length >= 6) {
    const mrzRaw = norm((mrz.rawLines ?? []).join(""));
    if (mrzRaw.includes(ocrNum)) return true;
  }
  return false;
}

/**
 * ¿El apellido del MRZ es la forma ESPACIADA (correcta) del apellido del frente que
 * llegó PEGADO? El MRZ TD1 separa los apellidos con `<` (→ espacio); el OCR del frente
 * comprimido a veces los pega sin espacio ("SOTELOMACHUCA" vs MRZ "SOTELO MACHUCA").
 * Devolvemos true SÓLO si:
 *   - ambos tienen EXACTAMENTE las mismas letras (norm igual → MISMA identidad; no
 *     mezclamos personas, sólo arreglamos espaciado), y
 *   - el MRZ trae MÁS tokens (más espacios) que el frente → el MRZ está mejor separado.
 * Si el frente ya está bien espaciado e idéntico (mismos tokens) NO devolvemos true
 * (no lo pisamos), y NUNCA degradamos un frente espaciado a la forma pegada del MRZ.
 */
function mrzSurnameBetterSpaced(frontApellidos: string, mrzSurname: string): boolean {
  if (!frontApellidos || !mrzSurname) return false;
  if (norm(frontApellidos) !== norm(mrzSurname)) return false; // distinta identidad textual
  const fTokens = frontApellidos.trim().split(/\s+/).filter(Boolean).length;
  const mTokens = mrzSurname.trim().split(/\s+/).filter(Boolean).length;
  return mTokens > fTokens; // el MRZ separa más apellidos → preferí su forma espaciada
}

/**
 * Confusiones de FILLER del MRZ: el OCR del dorso lee el separador `<` de la zona MRZ
 * como `C` o `K` (documentado en `detectTd1Lines`). Las usamos SÓLO para reconstruir el
 * espaciado de apellidos desde la línea 3 cruda cuando el parser ya no pudo separarlos.
 */
const MRZ_FILLER_CONFUSIONS = new Set(["<", "C", "K"]);

/**
 * Recupera la forma ESPACIADA del apellido a partir de la LÍNEA 3 CRUDA del MRZ TD1,
 * usando las letras del apellido del FRENTE como ancla. Resuelve el caso REAL en que el
 * OCR del dorso leyó los separadores `<` como `C`/`K` (línea 3
 * "SOTELOCMACHUCASK..." en vez de "SOTELO<MACHUCA<<..."): ahí `mrz.surname` sale PEGADO
 * igual que el frente y `mrzSurnameBetterSpaced` no alcanza.
 *
 * Estrategia (FAIL-CLOSED): alinea las letras del apellido del frente (SIN espacios)
 * contra el inicio de la línea 3; cada carácter EXTRA del MRZ entre dos letras del frente
 * es el separador `<` (leído C/K) → ahí va un espacio. Sólo se trata como separador si el
 * carácter es una confusión-de-filler CONOCIDA (`<`/C/K); cualquier otro desajuste es
 * ruido OCR real → devuelve null (no se arregla nada).
 *
 * GARANTÍAS:
 *   - El resultado tiene EXACTAMENTE las mismas letras que el apellido del frente (misma
 *     identidad; sólo reinserta espacios), verificado al final.
 *   - Devuelve null si: el frente ya trae espacio, no hay línea 3, la alineación se
 *     rompe, o no resulta en EXACTAMENTE 1 espacio (PY: 2 apellidos = 1 espacio; ≠1 es
 *     sospechoso → conservador).
 *
 * LIMITACIÓN conocida (cosmética, misma identidad): si el 2º apellido empieza en C/K, el
 * separador coincide con la 1ª letra real y el espacio puede caer una posición corrida.
 * No es un error de identidad (mismas letras) y está acotado por el match de CI.
 */
function recoverSpacedSurnameFromMrzLine3(
  frontApellidos: string,
  mrzLine3: string | undefined
): string | null {
  if (!frontApellidos || !mrzLine3) return null;
  if (/\s/.test(frontApellidos.trim())) return null; // ya espaciado → no aplica
  const S = frontApellidos
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z]/g, "");
  if (S.length < 4) return null;
  const raw = mrzLine3.toUpperCase().replace(/[^A-Z<]/g, "");
  if (raw.length < S.length + 1) return null; // sin char extra no hay separador que recuperar
  const out: string[] = [];
  let j = 0;
  let spaces = 0;
  for (let i = 0; i < S.length; i++) {
    if (j < raw.length && raw[j] !== S[i]) {
      // Char EXTRA en el MRZ = separador `<` (posiblemente leído C/K). Sólo si es una
      // confusión-de-filler conocida; cualquier otro desajuste es ruido OCR → fail-closed.
      if (!MRZ_FILLER_CONFUSIONS.has(raw[j])) return null;
      out.push(" ");
      spaces++;
      j++;
    }
    if (j >= raw.length || raw[j] !== S[i]) return null; // no alinea → fail-closed
    out.push(S[i]);
    j++;
  }
  if (spaces !== 1) return null;
  const recovered = out.join("").replace(/\s+/g, " ").trim();
  if (recovered.replace(/ /g, "") !== S) return null; // identidad intacta
  if (recovered.split(" ").some((t) => t.length < 2)) return null; // sin fragmentos
  return recovered;
}

/**
 * Rellena en el FRENTE (`extracted`) los campos que quedaron VACÍOS tras el OCR,
 * tomándolos del MRZ del dorso. ADITIVO + FAIL-CLOSED:
 *   - SÓLO actúa si el CI del MRZ cruza con el CI del frente (`mrzCiMatchesFront`);
 *     si no cruza (o falta), NO toca NADA (no se mezclan identidades).
 *   - NUNCA pisa un valor ya presente del frente (monotónico: sólo llena blancos).
 *   - Cada campo rellenado se marca en `extracted.fieldSources[campo] = "mrz"`.
 *
 * Campos cubiertos: fechaNacimiento, fechaVencimiento, sexo, apellidos, nombres
 * (los que el MRZ TD1 trae y el frente puede perder). Muta `extracted` in-place y
 * lo devuelve. Exportada para test.
 *
 * Debe llamarse DESPUÉS de `crossCheck` (que compara el MRZ GENUINO vs el frente);
 * si se rellenara antes, el cruce compararía el MRZ contra valores copiados del MRZ.
 */
export function crossFillFromMrz(extracted: ExtractedDocument, mrz: MrzData): ExtractedDocument {
  if (!mrzCiMatchesFront(extracted, mrz)) return extracted;
  const mark = (field: string) => {
    (extracted.fieldSources ??= {})[field] = "mrz";
  };
  if (!extracted.titular.fechaNacimiento && mrz.dateOfBirth) {
    extracted.titular.fechaNacimiento = mrz.dateOfBirth;
    mark("fechaNacimiento");
  }
  if (!extracted.documentoFisico.fechaVencimiento && mrz.expirationDate) {
    extracted.documentoFisico.fechaVencimiento = mrz.expirationDate;
    mark("fechaVencimiento");
  }
  if (!extracted.titular.sexo && mrz.sex) {
    extracted.titular.sexo = mrz.sex;
    mark("sexo");
  }
  if (!extracted.titular.apellidos && mrz.surname) {
    extracted.titular.apellidos = mrz.surname;
    mark("apellidos");
  } else if (extracted.titular.apellidos) {
    // Frente PRESENTE pero quizá PEGADO ("SOTELOMACHUCA"). El MRZ del dorso separa los
    // apellidos con `<`. Recuperamos la forma espaciada por DOS vías (CI ya cruzado):
    //   (a) el parser MRZ ya trae el apellido espaciado (dorso OCR-limpio) → preferilo.
    //   (b) el dorso leyó los `<` como C/K y `mrz.surname` salió pegado → reconstruí el
    //       espacio desde la LÍNEA 3 cruda anclando en las letras del frente.
    // NUNCA mezcla identidades (mismas letras) ni degrada un frente ya bien espaciado.
    let spaced: string | null = null;
    if (mrzSurnameBetterSpaced(extracted.titular.apellidos, mrz.surname)) {
      spaced = mrz.surname;
    } else {
      spaced = recoverSpacedSurnameFromMrzLine3(extracted.titular.apellidos, mrz.rawLines[2]);
    }
    if (spaced && spaced !== extracted.titular.apellidos) {
      extracted.titular.apellidos = spaced;
      mark("apellidos");
    }
  }
  if (!extracted.titular.nombres && mrz.givenNames) {
    extracted.titular.nombres = mrz.givenNames;
    mark("nombres");
  }
  return extracted;
}

// ---------------------------------------------------------------------------
// Backfill de MrzData con los datos AUTORITATIVOS del frente/dorso.
// ---------------------------------------------------------------------------

/**
 * Rellena los campos de DATO de `mrz` con los valores autoritativos del OCR
 * impreso, SIN tocar `valid`/`checkDigits`/`rawLines` (esos siguen reflejando el
 * parseo genuino del MRZ). Razón: `pipeline.ts:extractedFrom` construye la
 * identidad verificada desde `document.mrz` (ci/nombre/fechaNac/nacionalidad). Si
 * el MRZ vino basura pero el frente es bueno, la identidad debe persistir igual.
 *
 * Debe llamarse DESPUÉS de `crossCheck` (que compara el MRZ genuino vs frente).
 */
function backfillMrzFromExtracted(mrz: MrzData, extracted: ExtractedDocument): MrzData {
  return {
    ...mrz,
    documentNumber: extracted.documento.numeroCedula || mrz.documentNumber,
    surname: extracted.titular.apellidos || mrz.surname,
    givenNames: extracted.titular.nombres || mrz.givenNames,
    dateOfBirth: extracted.titular.fechaNacimiento || mrz.dateOfBirth,
    sex: extracted.titular.sexo || mrz.sex,
    expirationDate: extracted.documentoFisico.fechaVencimiento || mrz.expirationDate,
    nationality: extracted.titular.nacionalidad || mrz.nationality,
  };
}

// ---------------------------------------------------------------------------
// Extracción de PASAPORTE (ICAO 9303, MRZ TD3) — multi-documento P1 #3.
// ---------------------------------------------------------------------------

/**
 * Construye un `ExtractedDocument` para PASAPORTE desde el MRZ TD3 ya parseado.
 *
 * En el pasaporte el MRZ ES la fuente AUTORITATIVA (al revés que la cédula PY, donde
 * manda el frente impreso anclado por etiqueta y el MRZ es best-effort): un pasaporte
 * no tiene un layout de campos impresos estandarizado para anclar, así que todos los
 * datos salen del MRZ — que en el camino de pasaporte SÍ se valida por check digits
 * ICAO (ver `runPassport`). Campos ausentes quedan vacíos (fail-closed; nunca se
 * inventan valores).
 *
 * Mapeo TD3 → ExtractedDocument:
 *   documento.numeroCedula           ← documentNumber (nº de pasaporte; reusa el campo)
 *   documento.pais / mrz.paisCodigo  ← issuingCountry (ISO-3 país emisor)
 *   documento.tipo                   ← "PASAPORTE"
 *   titular.apellidos / nombres      ← surname / givenNames
 *   titular.fechaNacimiento / sexo   ← dateOfBirth / sex
 *   titular.nacionalidad             ← nationality DEL MRZ (NO el default "PARAGUAYA")
 *   documentoFisico.fechaVencimiento ← expirationDate
 *   mrz.linea1/linea2                ← rawLines (TD3 = 2 líneas; linea3 vacía)
 *
 * Exportado para test.
 */
export function extractPassport(mrz: MrzData): ExtractedDocument {
  const e = emptyExtracted();
  e.documento.tipo = "PASAPORTE";
  e.documento.pais = mrz.issuingCountry || "";
  e.documento.numeroCedula = mrz.documentNumber || "";
  e.titular.apellidos = mrz.surname || "";
  e.titular.nombres = mrz.givenNames || "";
  e.titular.fechaNacimiento = mrz.dateOfBirth || "";
  e.titular.sexo = mrz.sex || "";
  // Nacionalidad SIEMPRE del MRZ (no asumir PY): si el MRZ no la trae, queda vacía.
  e.titular.nacionalidad = mrz.nationality || "";
  e.documentoFisico.fechaVencimiento = mrz.expirationDate || "";
  // El pasaporte no aporta señal de chip/barcode por este camino: honestos en false.
  e.documentoFisico.chip = false;
  e.documentoFisico.codigoBarras = false;
  e.mrz.linea1 = mrz.rawLines[0] ?? "";
  e.mrz.linea2 = mrz.rawLines[1] ?? "";
  e.mrz.linea3 = "";
  e.mrz.paisCodigo = mrz.issuingCountry || "";
  return e;
}

// ---------------------------------------------------------------------------
// Parser legacy del texto OCR del frente (compat: pipeline.ts lee ocr.fields).
// ---------------------------------------------------------------------------

/**
 * Pobla `OcrData.fields` desde el JSON `extracted` (FUENTE AUTORITATIVA). Lo
 * mantenemos porque `pipeline.ts` (líneas 439/464/523) sigue leyendo
 * `ocr.fields.surname` y `ocr.confidence`. Firma compat-estable.
 *
 * Exportado para test.
 */
export function parseOcrFields(extracted: ExtractedDocument): OcrData["fields"] {
  const fields: OcrData["fields"] = {};
  if (extracted.documento.numeroCedula) fields.documentNumber = extracted.documento.numeroCedula;
  if (extracted.titular.apellidos) fields.surname = extracted.titular.apellidos;
  if (extracted.titular.nombres) fields.givenNames = extracted.titular.nombres;
  if (extracted.titular.fechaNacimiento) fields.dateOfBirth = extracted.titular.fechaNacimiento;
  if (extracted.documentoFisico.fechaVencimiento)
    fields.expirationDate = extracted.documentoFisico.fechaVencimiento;
  if (extracted.titular.nacionalidad) fields.nationality = extracted.titular.nacionalidad;
  return fields;
}

// ---------------------------------------------------------------------------
// Camino de extracción de PRODUCCIÓN para el Inspector OCR (Fix 2). Reproduce
// EXACTAMENTE el front-path de `DocumentModule.run`: OCR del frente CRUDO primero
// (anclaje de referencia) → fallback SÓLO-AMPLÍA-NO-PISA si faltan requeridos →
// cross-fill MRZ→frente si se provee un DORSO cuyo CI cruza. Reusa los MISMOS
// helpers que producción (`extractFront`, `frontRequiredMissing`, `fillMissingFront`,
// `crossFillFromMrz`), NO reimplementa. Devuelve, por campo, el ORIGEN: front (OCR
// crudo), upscale (fallback ampliado) o mrz (cross-fill del dorso).
// ---------------------------------------------------------------------------

/** Campos del frente que el Inspector marca con su origen (front/upscale/mrz). */
const PRODUCTION_SOURCE_FIELDS = [
  "apellidos",
  "nombres",
  "fechaNacimiento",
  "fechaVencimiento",
  "sexo",
  "lugarNacimiento",
  "numeroCedula",
  "pais",
  "tipo",
] as const;

/** Lee el valor "presente?" de un campo del frente por su nombre lógico. */
function frontFieldPresent(e: ExtractedDocument, field: string): boolean {
  switch (field) {
    case "apellidos":
      return !!e.titular.apellidos;
    case "nombres":
      return !!e.titular.nombres;
    case "fechaNacimiento":
      return !!e.titular.fechaNacimiento;
    case "fechaVencimiento":
      return !!e.documentoFisico.fechaVencimiento;
    case "sexo":
      return !!e.titular.sexo;
    case "lugarNacimiento":
      return !!e.titular.lugarNacimiento.ciudad;
    case "numeroCedula":
      return !!e.documento.numeroCedula;
    case "pais":
      return !!e.documento.pais;
    case "tipo":
      return !!e.documento.tipo;
    default:
      return false;
  }
}

export interface ProductionFrontResult {
  extracted: ExtractedDocument;
  /**
   * Origen por campo: "front" (OCR crudo), "upscale" (fallback ampliado),
   * "enhanced" (3er tier: pre-proceso de fondo de seguridad), "mrz" (dorso).
   */
  sources: Record<string, "front" | "upscale" | "enhanced" | "mrz">;
  /** ¿Se corrió el fallback ampliado (faltaban requeridos tras el crudo)? */
  usedUpscaleFallback: boolean;
  /** Líneas MRZ TD1 detectadas en el dorso (si se proveyó dorso), informativo. */
  mrz: MrzData | null;
}

/**
 * Ejecuta el front-path de PRODUCCIÓN para el Inspector. `back` opcional: si se
 * provee, intenta el cross-fill MRZ→frente (sólo si el CI del MRZ cruza con el del
 * frente; fail-closed). NO corre quality/liveness/match ni recorta la foto — sólo
 * la extracción de campos del documento, que es lo que el Inspector muestra.
 */
export async function runFrontProduction(
  front: Buffer,
  ocr: OcrClient,
  back?: Buffer
): Promise<ProductionFrontResult> {
  const extracted = emptyExtracted();
  const sources: Record<string, "front" | "upscale" | "enhanced" | "mrz"> = {};

  // 1) OCR del FRENTE CRUDO (pasada de referencia, igual que producción).
  try {
    const frontOcr = await ocr.recognize(front);
    extractFront(frontOcr.lines, extracted);
  } catch {
    /* fail-open: el fallback ampliado puede recuperar */
  }
  for (const f of PRODUCTION_SOURCE_FIELDS) {
    if (frontFieldPresent(extracted, f)) sources[f] = "front";
  }

  // 2) FALLBACK MONOTÓNICO (sólo-amplía-no-pisa) si faltan requeridos.
  let usedUpscaleFallback = false;
  if (frontRequiredMissing(extracted)) {
    try {
      const upscaled = await upscaleForOcr(front, 1600);
      const fb = await ocr.recognize(upscaled);
      const fbExtracted = emptyExtracted();
      extractFront(fb.lines, fbExtracted);
      fillMissingFront(extracted, fbExtracted);
      usedUpscaleFallback = true;
    } catch {
      /* fail-open */
    }
    // Campos que aparecieron recién tras el fallback → origen "upscale".
    for (const f of PRODUCTION_SOURCE_FIELDS) {
      if (!sources[f] && frontFieldPresent(extracted, f)) sources[f] = "upscale";
    }
  }

  // 2.5) 3er TIER ENHANCED (sólo-llena-blancos): si AÚN faltan requeridos tras el
  //      upscale, re-OCR-eamos el frente con pre-proceso de FONDO DE SEGURIDAD
  //      (canal verde → blur → adaptiveThreshold) que rescata el texto sobre el
  //      watermark/guilloché. MONOTÓNICO: nunca pisa lo ya leído. Geometría W×H
  //      preservada (anclaje px-absoluto intacto). FAIL-OPEN. La defensa anti-bleed
  //      vive en `looksLikeName` (rechaza nombre terminado en partícula del watermark).
  if (frontRequiredMissing(extracted) && ocr.recognizeEnhanced) {
    try {
      const enh = await ocr.recognizeEnhanced(front);
      const enhExtracted = emptyExtracted();
      extractFront(enh.lines, enhExtracted);
      fillMissingFront(extracted, enhExtracted);
    } catch {
      /* fail-open */
    }
    for (const f of PRODUCTION_SOURCE_FIELDS) {
      if (!sources[f] && frontFieldPresent(extracted, f)) sources[f] = "enhanced";
    }
  }

  // 3) CROSS-FILL MRZ→FRENTE (si hay dorso). Igual que producción: sólo si el CI
  //    del MRZ cruza con el del frente; nunca pisa un valor ya presente.
  let mrz: MrzData | null = null;
  if (back) {
    try {
      const backOcr = await ocr.recognize(back);
      const td1 = detectTd1Lines(backOcr.lines.map((l) => l.text));
      if (td1.length >= 3) {
        mrz = await parseMrz(td1);
        crossFillFromMrz(extracted, mrz);
      }
    } catch {
      /* fail-open: dorso ilegible no rompe el frente */
    }
    // crossFillFromMrz marca `extracted.fieldSources[campo]="mrz"`.
    for (const [f, src] of Object.entries(extracted.fieldSources ?? {})) {
      sources[f] = src;
    }
  }

  return { extracted, sources, usedUpscaleFallback, mrz };
}

// ---------------------------------------------------------------------------
// Orquestación del módulo.
// ---------------------------------------------------------------------------

export interface DocumentDeps {
  ocr: OcrClient;
  mrzReader: MrzReader;
  barcodeReader: BarcodeReader;
  engine: Engine;
  /**
    * Preprocesa el FRENTE SÓLO para la LECTURA OCR de campos: endereza (doc-crop,
    * deskew/perspectiva del sidecar) + amplía (resize-up). El texto enderezado y
    * ampliado es mucho más legible para PaddleOCR en capturas de celular
    * comprimidas/chicas (caso real: apellido no leído). OPCIONAL — si no se
    * inyecta, el OCR corre sobre el frente crudo (comportamiento histórico).
    * FAIL-OPEN: ante cualquier error debe devolver el buffer original.
    *
    * IMPORTANTE: NO toca el recorte de la foto del titular (`cropDocFace`), que
    * sigue corriendo sobre el frente CRUDO para no degradar el match facial.
    */
  preprocessFront?: (front: Buffer) => Promise<Buffer>;
  /**
    * Edad máxima en años para la validez del documento (spec §16).
    * Para cédula PY: 75 años (la CI es válida hasta esa edad).
    * 0 = no aplicar límite de edad.
    */
  maxDocumentAgeYears?: number;
}

/**
 * Amplía un JPEG hasta `minWidth` de ancho si es más chico (Lanczos3, sin
 * recortar). PaddleOCR lee mejor el texto ampliado; ampliar uno ya grande no
 * ayuda y sólo gasta CPU, así que sólo escalamos hacia arriba. FAIL-OPEN.
 */
export async function upscaleForOcr(image: Buffer, minWidth = 1600): Promise<Buffer> {
  try {
    const meta = await sharp(image).metadata();
    const w = meta.width ?? 0;
    if (w >= minWidth || w === 0) return image;
    return await sharp(image)
      .resize({ width: minWidth, kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
      .jpeg({ quality: 95 })
      .toBuffer();
  } catch {
    return image;
  }
}

export class DocumentModule {
  /**
   * Ejecuta el módulo ruteando por TIPO DE DOCUMENTO (multi-documento — P1 #3).
   * Fail-closed: cualquier error de OCR/sidecar/parse deja passed=false. No lanza.
   *
   *   - "passport" → extractor de pasaporte (página de datos, MRZ TD3, un solo lado).
   *   - "ci_py" (default) → extractor de cédula PY (frente impreso + dorso MRZ TD1).
   *     Camino histórico INTACTO (sigue siendo el más completo y el default).
   */
  async run(
    front: Buffer,
    back: Buffer,
    deps: DocumentDeps,
    documentType: DocumentType = "ci_py"
  ): Promise<DocumentResult> {
    if (documentType === "passport") return this.runPassport(front, deps);
    return this.runCedulaPy(front, back, deps);
  }

  /**
   * Extractor de PASAPORTE (ICAO 9303, MRZ TD3) — un solo lado (página de datos).
   * Lee la franja MRZ TD3 (2×44) por OCR, la parsea (nombres/apellidos/nº/nacionalidad/
   * país emisor/fechas/sexo + check digits) y recorta la foto del titular para el match.
   * No hay dorso ni barcode. Fail-closed: ante OCR/parse fallido, passed=false.
   *
   * `passed` exige: campos requeridos presentes (apellidos, nombres, nº, fecha nac,
   * vencimiento) + check digits MRZ válidos (documentNumber, dateOfBirth, expirationDate,
   * composite) + documento NO vencido + foto recortable. El MRZ ES la fuente autoritativa
   * del pasaporte (a diferencia de la cédula PY, donde es best-effort), por eso acá los
   * check digits SÍ gatean el resultado (validación ICAO).
   */
  private async runPassport(front: Buffer, deps: DocumentDeps): Promise<DocumentResult> {
    let mrz: MrzData = { ...EMPTY_MRZ };
    let docFaceCrop: DocFaceCrop | null = null;
    let rawText = "";
    let confidence = 0;

    // 1) OCR de la página de datos → líneas MRZ TD3 crudas. Fallback ampliado si no
    //    aparecieron 2 líneas TD3 (capturas chicas/comprimidas), igual que la cédula.
    let td3: string[] = [];
    try {
      const ocr = await deps.ocr.recognize(front);
      rawText = ocr.rawText;
      confidence = ocr.confidence;
      td3 = detectTd3Lines(ocr.lines.map((l) => l.text));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[document] OCR pasaporte falló: ${(e as Error).message}`);
    }
    if (td3.length < 2 && deps.preprocessFront) {
      try {
        const upscaled = await deps.preprocessFront(front);
        const ocr = await deps.ocr.recognize(upscaled);
        const found = detectTd3Lines(ocr.lines.map((l) => l.text));
        if (found.length >= 2) {
          td3 = found;
          if (!rawText) {
            rawText = ocr.rawText;
            confidence = ocr.confidence;
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[document] fallback OCR pasaporte falló: ${(e as Error).message}`);
      }
    }
    if (td3.length >= 2) {
      try {
        mrz = await parseMrz(td3);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[document] parseo MRZ TD3 falló: ${(e as Error).message}`);
      }
    }

    // 2) Foto del titular (página de datos) → alimenta el match facial.
    try {
      docFaceCrop = await cropDocFace(front, deps.engine);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[document] recorte de foto (pasaporte) falló: ${(e as Error).message}`);
    }

    const extracted = extractPassport(mrz);

    // Autenticidad: presencia de campos + check digits ICAO + no vencido. DUROS.
    const checks: AuthenticityCheck[] = [];
    const requiredPresent =
      !!extracted.titular.apellidos &&
      !!extracted.titular.nombres &&
      !!extracted.documento.numeroCedula &&
      !!extracted.titular.fechaNacimiento &&
      !!extracted.documentoFisico.fechaVencimiento;
    checks.push({
      name: "mrz_fields_present",
      passed: requiredPresent,
      detail: requiredPresent ? "campos MRZ OK" : "faltan campos MRZ requeridos",
    });
    const checkDigitsOk =
      mrz.checkDigits.documentNumber &&
      mrz.checkDigits.dateOfBirth &&
      mrz.checkDigits.expirationDate &&
      mrz.checkDigits.composite;
    checks.push({
      name: "mrz_check_digits",
      passed: checkDigitsOk,
      detail: checkDigitsOk ? "check digits ICAO OK" : "check digits MRZ inválidos",
    });
    const live = notExpired(extracted.documentoFisico.fechaVencimiento);
    checks.push({
      name: "not_expired",
      passed: live,
      detail: `vence=${extracted.documentoFisico.fechaVencimiento || "?"}`,
    });
    checks.push({
      name: "doc_face_present",
      passed: docFaceCrop !== null,
      detail: docFaceCrop ? "foto recortada" : "sin foto del titular",
    });

    const passed = requiredPresent && checkDigitsOk && live && docFaceCrop !== null;

    const ocr: OcrData = {
      rawText,
      fields: parseOcrFields(extracted),
      confidence,
    };

    return {
      documentType: "passport",
      mrz,
      barcode: { format: "", text: "" },
      ocr,
      docFaceCrop,
      extracted,
      authenticity: { consistent: requiredPresent && live, checks },
      passed,
    };
  }

  /**
   * Extractor de CÉDULA PY (frente impreso anclado por etiqueta + dorso MRZ TD1).
   * Cuerpo HISTÓRICO sin cambios funcionales (sólo renombrado de `run`→`runCedulaPy`
   * para el ruteo por tipo). Fail-closed: cualquier error deja passed=false.
   */
  private async runCedulaPy(front: Buffer, back: Buffer, deps: DocumentDeps): Promise<DocumentResult> {
    let mrz: MrzData = { ...EMPTY_MRZ };
    let barcode: BarcodeData = { format: "", text: "" };
    let docFaceCrop: DocFaceCrop | null = null;
    const extracted = emptyExtracted();
    let frontConfidence = 0;
    let frontRawText = "";

    // OCR del FRENTE (datos autoritativos) sobre el frente CRUDO. Esta pasada SIEMPRE
    // gana: el anclaje etiqueta→valor usa umbrales en PÍXELES ABSOLUTOS tuneados al
    // frame nativo del celular, así que el resultado crudo es el de referencia.
    let frontOcr: OcrResult | null = null;
    try {
      frontOcr = await deps.ocr.recognize(front);
      frontConfidence = frontOcr.confidence;
      frontRawText = frontOcr.rawText;
      extractFront(frontOcr.lines, extracted);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[document] OCR frente falló: ${(e as Error).message}`);
    }

    // FALLBACK MONOTÓNICO (sólo-amplía-no-pisa): si tras el OCR crudo falta algún
    // campo REQUERIDO y hay un preprocesador inyectado, re-OCR-eamos una variante
    // AMPLIADA del frente y rellenamos ÚNICAMENTE los campos que quedaron vacíos.
    // Razón: en capturas chicas/comprimidas el texto crudo es ilegible para
    // PaddleOCR; ampliarlo lo recupera. Es MONOTÓNICO por diseño — la pasada cruda
    // ya escribió todo lo que pudo leer y NUNCA se sobreescribe, así que el fallback
    // sólo puede AGREGAR, jamás regresionar un campo que ya leía (el upscale
    // reescala los gaps etiqueta→valor y podría romper el anclaje fino de APELLIDOS
    // si pisara; por eso sólo llena blancos). FAIL-OPEN.
    if (deps.preprocessFront && frontRequiredMissing(extracted)) {
      try {
        const upscaled = await deps.preprocessFront(front);
        const fb = await deps.ocr.recognize(upscaled);
        const fbExtracted = emptyExtracted();
        extractFront(fb.lines, fbExtracted);
        fillMissingFront(extracted, fbExtracted);
        // Si la pasada cruda no leyó NADA de texto, adoptamos su confianza/raw.
        if (!frontRawText) {
          frontRawText = fb.rawText;
          frontConfidence = fb.confidence;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[document] fallback OCR ampliado falló: ${(e as Error).message}`);
      }
    }

    // 3er TIER ENHANCED (sólo-llena-blancos): si AÚN falta algún campo REQUERIDO tras
    // el upscale, re-OCR-eamos el frente con pre-proceso de FONDO DE SEGURIDAD (canal
    // verde → blur → adaptiveThreshold) en el sidecar /ocr-enhanced. Recupera el texto
    // garbleado sobre el watermark "REPÚBLICA DEL PARAGUAY" + sello/guilloché (caso real
    // ORUE: apellidos/nombres/fechas ilegibles en crudo). MONOTÓNICO por diseño: la cruda
    // y el upscale ya escribieron lo legible y NUNCA se pisa, así que sólo puede AGREGAR.
    // Geometría W×H preservada (el endpoint NO recorta) ⇒ anclaje px-absoluto intacto. La
    // defensa anti-bleed del watermark vive en `looksLikeName` (rechaza un nombre cuyo
    // último token es una partícula de fondo: "ORUE SOSAA DEL" → vacío, no basura). Los
    // valores del enhanced igual pasan las validaciones (looksLikeName/looksLikeDate/score
    // mínimo) dentro de extractFront. FAIL-OPEN.
    if (deps.ocr.recognizeEnhanced && frontRequiredMissing(extracted)) {
      try {
        const enh = await deps.ocr.recognizeEnhanced(front);
        const enhExtracted = emptyExtracted();
        extractFront(enh.lines, enhExtracted);
        fillMissingFront(extracted, enhExtracted);
        if (!frontRawText) {
          frontRawText = enh.rawText;
          frontConfidence = enh.confidence;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[document] tier enhanced OCR falló: ${(e as Error).message}`);
      }
    }

    // OCR del DORSO (campos del dorso + reuso para MRZ — un solo OCR).
    let backOcr: OcrResult | null = null;
    try {
      backOcr = await deps.ocr.recognize(back);
      extractBack(backOcr.lines, extracted);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[document] OCR dorso falló: ${(e as Error).message}`);
    }

    // Recorte de la foto del titular (frente).
    try {
      docFaceCrop = await cropDocFace(front, deps.engine);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[document] recorte de foto falló: ${(e as Error).message}`);
    }

    // MRZ del dorso (BEST-EFFORT). Reusa el OCR del dorso ya calculado.
    try {
      const lines =
        deps.mrzReader instanceof OcrMrzReader && backOcr
          ? await deps.mrzReader.readLines(back, deps.ocr, backOcr)
          : await deps.mrzReader.readLines(back, deps.ocr);
      mrz = await parseMrz(lines);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[document] lectura MRZ falló: ${(e as Error).message}`);
    }
    // Guardamos las líneas crudas del MRZ en el JSON estructurado (best-effort).
    extracted.mrz.linea1 = mrz.rawLines[0] ?? "";
    extracted.mrz.linea2 = mrz.rawLines[1] ?? "";
    extracted.mrz.linea3 = mrz.rawLines[2] ?? "";
    // paisCodigo: el código de país emisor del MRZ (ISO-3, p.ej. "PRY"). Se publica
    // si el parser lo resolvió, AUNQUE el MRZ no valide globalmente: `issuingState`
    // es un campo de FORMATO estable que sobrevive al ruido de check-digits del OCR.
    extracted.mrz.paisCodigo = mrz.issuingCountry || "";

    // Barcode del dorso (serial). No bloqueante.
    try {
      barcode = await deps.barcodeReader.read(back);
    } catch {
      barcode = { format: "", text: "" };
    }
    // Si el barcode se leyó, refuerza la presencia del código de barras.
    if (barcode.text) extracted.documentoFisico.codigoBarras = true;

    // Autenticidad por cruce: compara el MRZ GENUINO contra el frente (SOFT) ANTES
    // de hacer backfill/cross-fill — si no, el MRZ se compararía contra sí mismo.
    const authenticity = crossCheck(extracted, mrz, barcode);

    // CROSS-FILL MRZ→FRENTE (aditivo, fail-closed): recupera campos que el OCR del
    // FRENTE perdió (fechas/sexo/nombre) desde el MRZ del dorso, SÓLO si el CI del
    // MRZ cruza con el del frente. Nunca pisa un valor ya presente. Se corre DESPUÉS
    // de crossCheck (cruce contra el MRZ genuino) y ANTES de calcular `passed`, así
    // un campo recuperado del MRZ puede satisfacer los requeridos. No-op si el MRZ
    // vino vacío (dorso degradado) o si el CI no cruza.
    crossFillFromMrz(extracted, mrz);

    // Backfill de los campos de DATO del MRZ con los autoritativos del frente/dorso
    // (mantiene `valid`/`checkDigits` honestos). Necesario para pipeline.extractedFrom.
    mrz = backfillMrzFromExtracted(mrz, extracted);

    // OcrData de compat (pipeline lee ocr.fields / ocr.confidence).
    const ocr: OcrData = {
      rawText: frontRawText,
      fields: parseOcrFields(extracted),
      confidence: frontConfidence,
    };

    // passed (CAMBIO CLAVE): campos impresos requeridos + no vencido + foto recortable.
    // El MRZ ya NO decide.
    const requiredPresent =
      !!extracted.titular.apellidos &&
      !!extracted.titular.nombres &&
      !!extracted.documento.numeroCedula &&
      !!extracted.titular.fechaNacimiento &&
      !!extracted.documentoFisico.fechaVencimiento;
    const passed =
      requiredPresent &&
      notExpired(extracted.documentoFisico.fechaVencimiento, deps.maxDocumentAgeYears ?? 0) &&
      docFaceCrop !== null;

    return {
      documentType: "ci_py",
      mrz,
      barcode,
      ocr,
      docFaceCrop,
      extracted,
      authenticity,
      passed,
    };
  }
}

export const documentModule = new DocumentModule();

/** Dependencias reales por defecto (on-prem). El engine se inyecta desde el server. */
export function defaultDocumentDeps(engine: Engine): DocumentDeps {
  const ocr = new PaddleOcrClient(OCR_SIDECAR_URL, process.env.TEKO_OCR_LANG || "spa");
  return {
    ocr,
    mrzReader: new OcrMrzReader(),
    barcodeReader: new ZxingBarcodeReader(),
    engine,
    maxDocumentAgeYears: CI_MAX_AGE_YEARS,
  };
}
