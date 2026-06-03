/**
 * Módulo `document` — cédula PY (§6.c/§7).
 *
 * Contrato (spec §6): document(front, back) → {mrz, barcode, ocr, docFaceCrop,
 * authenticity{consistent, checks[]}, passed}. Rechazo duro si inconsistente/vencido.
 *
 * Fuentes:
 *   - MRZ TD1 (dorso): OCR de las 3 líneas + parser `mrz` (ICAO 9303) → FUENTE
 *     AUTORITATIVA legible-por-máquina (§3.13). Dígitos verificadores incluidos.
 *   - Barcode 1D Code128 (dorso): `@zxing/library` → serial, cruce con Nº del frente.
 *   - OCR visual (frente): PaddleOCR (sidecar Python) → datos legibles + recorte foto.
 *   - docFaceCrop: la foto del titular recortada del frente (engine SCRFD) para el match.
 *
 * Autenticidad por CRUCE (no peritaje físico, §13): MRZ↔OCR (nombre/Nº/fecha) +
 * dígitos verificadores del MRZ + no-vencimiento. consistent = todos los cruces OK.
 *
 * FAIL-CLOSED: si el OCR de las líneas MRZ no se obtiene, o el sidecar OCR está
 * caído, o el parser falla, el documento NO pasa (passed=false) → el pipeline lo
 * trata como rejected. Un sidecar caído nunca produce un documento "válido".
 *
 * Inyección: el cliente OCR y el lector MRZ/barcode se reciben para poder testear
 * el módulo sin sidecar ni binarios nativos.
 */
import sharp from "sharp";
import type { Engine, Face } from "../engine";
import type {
  Authenticity,
  AuthenticityCheck,
  BarcodeData,
  DocFaceCrop,
  DocumentResult,
  MrzData,
  OcrData,
} from "../types";
import { OCR_SIDECAR_URL } from "../config";

// ---------------------------------------------------------------------------
// Puertos inyectables (contratos mínimos) — implementaciones reales más abajo.
// ---------------------------------------------------------------------------

/** Cliente OCR: dado un JPEG/PNG, devuelve texto + confianza (PaddleOCR sidecar). */
export interface OcrClient {
  recognize(image: Buffer): Promise<{ rawText: string; confidence: number }>;
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
  constructor(private baseUrl: string = OCR_SIDECAR_URL) {}

  async recognize(image: Buffer): Promise<{ rawText: string; confidence: number }> {
    const res = await fetch(`${this.baseUrl}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: image.toString("base64") }),
    });
    if (!res.ok) {
      throw new Error(`OCR sidecar HTTP ${res.status}`);
    }
    const data = (await res.json()) as { text?: string; confidence?: number };
    return {
      rawText: data.text ?? "",
      confidence: typeof data.confidence === "number" ? data.confidence : 0,
    };
  }
}

/** MRZ por OCR del dorso: usa el sidecar y quita ruido para aislar 3 líneas de 30 chars. */
export class OcrMrzReader implements MrzReader {
  async readLines(back: Buffer, ocr: OcrClient): Promise<string[]> {
    const { rawText } = await ocr.recognize(back);
    const candidates = rawText
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, "").toUpperCase())
      .filter((l) => /^[A-Z0-9<]{20,}$/.test(l));
    // TD1 = 3 líneas; tomamos las 3 más largas con el alfabeto MRZ.
    return candidates
      .sort((a, b) => b.length - a.length)
      .slice(0, 3)
      .sort();
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
// Parsing MRZ (parser `mrz`, ICAO 9303 TD1).
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
 *   - Expiración (`isExpiry=true`): SIEMPRE 20xx. Una cédula vigente caduca en este
 *     siglo; no existen vencimientos en 19xx en circulación.
 *   - Nacimiento (`isExpiry=false`): pivote en el año-actual de 2 dígitos `now`.
 *     `yy > now` ⇒ 19xx (p.ej. con now=26, '90' → 1990); en otro caso 20xx
 *     (p.ej. '10' → 2010). Limitación conocida: no distingue centenarios (alguien
 *     nacido en 2026 vs un futuro 19xx imposible); suficiente para cédula adulta.
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
 * el borde del import dinámico contra esta interfaz propia (no dependemos del .d.ts
 * del paquete) y normalizamos de inmediato a nuestro MrzData.
 */
interface MrzParseResult {
  valid: boolean;
  fields: Record<string, string | null | undefined>;
  details: Array<{ field: string; valid: boolean }>;
}

async function parseMrz(lines: string[]): Promise<MrzData> {
  if (lines.length < 3) return { ...EMPTY_MRZ, rawLines: lines };
  try {
    const mod = (await import("mrz")) as unknown as {
      parse: (input: string[] | string) => MrzParseResult;
    };
    const r = mod.parse(lines);
    const f = r.fields;
    const dn = !!r.details.find((d) => d.field === "documentNumber")?.valid;
    const dob = !!r.details.find((d) => d.field === "birthDate")?.valid;
    const exp = !!r.details.find((d) => d.field === "expirationDate")?.valid;
    const comp = !!r.details.find((d) => d.field === "compositeCheckDigit")?.valid;
    return {
      rawLines: lines,
      documentType: f.documentCode ?? "",
      issuingCountry: f.issuingState ?? "",
      documentNumber: f.documentNumber ?? "",
      surname: f.lastName ?? "",
      givenNames: f.firstName ?? "",
      nationality: f.nationality ?? "",
      dateOfBirth: mrzDateToIso(f.birthDate, false),
      sex: f.sex ?? "",
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
// Autenticidad por cruce (§6.c).
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

/**
 * Cruce de autenticidad (§6.c). Modelo duro/blando:
 *
 *   - DUROS (siempre cuentan para `consistent`): los cruces MRZ-intrínsecos
 *     `check_digits` (dígitos verificadores ICAO) y `not_expired`. Son la garantía
 *     de que `consistent` nunca puede ser vacuamente-true.
 *   - DUROS CONDICIONALES: `doc_number_match` y `mrz_vs_ocr_name` cuentan SOLO si el
 *     OCR del frente aportó el dato (Nº/apellido). Si el OCR no lo devolvió, el cruce
 *     se trata como NO-DISPONIBLE (soft) y NO reprueba — un documento genuino con MRZ
 *     válido puede llegar a `consistent=true` aunque el OCR del frente venga pobre.
 *     Cuando el dato SÍ está y no cuadra, sí reprueba (anti-falsificación).
 *   - BLANDO: `barcode_vs_doc_number` (best-effort; el barcode puede no leerse).
 *
 * Exportada para test (verifica el camino verified del propio módulo).
 */
export function crossCheck(mrz: MrzData, ocr: OcrData, barcode: BarcodeData): Authenticity {
  const checks: AuthenticityCheck[] = [];
  // Cruces que cuentan para `consistent`. Arrancamos con los DUROS intrínsecos del
  // MRZ → garantiza que `hard` nunca esté vacío (evita vacuous-true).
  const hard: boolean[] = [];

  // 1) Dígitos verificadores del MRZ (auto-consistencia ICAO 9303). DURO.
  checks.push({
    name: "check_digits",
    passed: mrz.valid,
    detail: mrz.valid ? "MRZ check digits OK" : "MRZ check digits inválidos",
  });
  hard.push(mrz.valid);

  // 2) No vencido. DURO. Comparamos contra el FIN DEL DÍA (UTC) de la fecha de
  // vencimiento: un documento que vence HOY sigue vigente todo el día (no a las 00:00).
  const notExpired =
    mrz.expirationDate !== "" &&
    new Date(`${mrz.expirationDate}T23:59:59.999Z`) >= new Date();
  checks.push({
    name: "not_expired",
    passed: notExpired,
    detail: `expira=${mrz.expirationDate || "?"}`,
  });
  hard.push(notExpired);

  // 3) Nº de documento MRZ ↔ OCR del frente. DURO sólo si el OCR aportó el Nº.
  const ocrNum = ocr.fields.documentNumber ? norm(ocr.fields.documentNumber) : "";
  const mrzNum = norm(mrz.documentNumber);
  if (ocrNum) {
    const docNumMatch = !!mrzNum && (mrzNum.includes(ocrNum) || ocrNum.includes(mrzNum));
    checks.push({
      name: "doc_number_match",
      passed: docNumMatch,
      detail: `mrz=${mrz.documentNumber} ocr=${ocr.fields.documentNumber ?? "?"}`,
    });
    hard.push(docNumMatch);
  } else {
    checks.push({
      name: "doc_number_match",
      passed: true,
      detail: "no disponible (OCR frente sin Nº) — soft",
    });
  }

  // 4) Apellido MRZ ↔ OCR. DURO sólo si el OCR aportó el apellido.
  const ocrSurname = ocr.fields.surname ? norm(ocr.fields.surname) : "";
  const mrzSurname = norm(mrz.surname);
  if (ocrSurname) {
    const nameMatch =
      !!mrzSurname && (mrzSurname.includes(ocrSurname) || ocrSurname.includes(mrzSurname));
    checks.push({
      name: "mrz_vs_ocr_name",
      passed: nameMatch,
      detail: `mrz=${mrz.surname} ocr=${ocr.fields.surname ?? "?"}`,
    });
    hard.push(nameMatch);
  } else {
    checks.push({
      name: "mrz_vs_ocr_name",
      passed: true,
      detail: "no disponible (OCR frente sin apellido) — soft",
    });
  }

  // 5) Serial del barcode ↔ Nº de documento (cruce dorso↔frente). BLANDO.
  if (barcode.text) {
    const bc = norm(barcode.text);
    const serialMatch = bc.includes(mrzNum) || mrzNum.includes(bc);
    checks.push({
      name: "barcode_vs_doc_number",
      passed: serialMatch,
      detail: `barcode=${barcode.text}`,
    });
  }

  // consistent = todos los cruces DUROS pasan. `hard` siempre contiene al menos
  // check_digits + not_expired, así que nunca es vacuamente-true.
  const consistent = hard.every((p) => p);
  return { consistent, checks };
}

// ---------------------------------------------------------------------------
// Orquestación del módulo.
// ---------------------------------------------------------------------------

/**
 * Parsea campos estructurados del texto OCR del frente (cédula PY). Best-effort.
 *
 * Nombres (surname/givenNames): se extraen SOLO si se puede anclar la línea a las
 * etiquetas del frente ("APELLIDOS"/"NOMBRES", insensible a acentos). Si no hay
 * ancla confiable, los nombres quedan SIN setear — deliberadamente: un nombre OCR
 * presente-pero-errado convierte el cruce 'mrz_vs_ocr_name' en un check DURO que
 * reprueba (rechaza un documento genuino). Dejarlo sin setear lo trata como soft /
 * no-disponible y no bloquea (el nombre autoritativo sale del MRZ del dorso).
 *
 * NOTA: exportado para test (cruce/parse del propio módulo).
 */
export function parseOcrFields(rawText: string): OcrData["fields"] {
  const fields: OcrData["fields"] = {};
  const numMatch = rawText.match(/\b(\d{6,8})\b/);
  if (numMatch) fields.documentNumber = numMatch[1];
  const dateMatches = rawText.match(/\b(\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/g);
  if (dateMatches && dateMatches.length >= 1) {
    const toIso = (d: string) => {
      const [dd, mm, yyyy] = d.split(/[\/.-]/);
      return `${yyyy}-${mm}-${dd}`;
    };
    fields.dateOfBirth = toIso(dateMatches[0]);
    if (dateMatches.length >= 2) fields.expirationDate = toIso(dateMatches[dateMatches.length - 1]);
  }

  // Nombres anclados por etiqueta. Normalizamos acentos para tolerar "APELLIDO(S)"
  // sin tilde. Sólo letras/espacios en el valor (descartamos números/símbolos).
  const noAccents = rawText.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const value = (re: RegExp): string | undefined => {
    const m = noAccents.match(re);
    if (!m) return undefined;
    const v = m[1]
      .replace(/[^A-Za-zÀ-ſ ]+.*$/s, "") // corta en el primer no-nombre
      .trim()
      .replace(/\s+/g, " ");
    return v.length >= 2 ? v : undefined;
  };
  // "APELLIDO(S): PEREZ" / "APELLIDOS GONZALEZ" (con o sin dos puntos).
  const surname = value(/APELLIDOS?\s*:?\s*([A-Za-zÀ-ſ][^\r\n]*)/i);
  if (surname) fields.surname = surname;
  // "NOMBRE(S): JUAN CARLOS".
  const given = value(/NOMBRES?\s*:?\s*([A-Za-zÀ-ſ][^\r\n]*)/i);
  if (given) fields.givenNames = given;

  return fields;
}

export interface DocumentDeps {
  ocr: OcrClient;
  mrzReader: MrzReader;
  barcodeReader: BarcodeReader;
  engine: Engine;
}

export class DocumentModule {
  /**
   * Ejecuta el módulo. Fail-closed: cualquier error de OCR/sidecar/parse deja
   * passed=false (el documento no acredita nada). No lanza: convierte el fallo en
   * un DocumentResult no-aprobado para que el pipeline lo registre como check.
   */
  async run(front: Buffer, back: Buffer, deps: DocumentDeps): Promise<DocumentResult> {
    let mrz: MrzData = { ...EMPTY_MRZ };
    let barcode: BarcodeData = { format: "", text: "" };
    let ocr: OcrData = { rawText: "", fields: {}, confidence: 0 };
    let docFaceCrop: DocFaceCrop | null = null;

    // OCR del frente (datos + recorte de foto).
    try {
      const ocrFront = await deps.ocr.recognize(front);
      ocr = {
        rawText: ocrFront.rawText,
        fields: parseOcrFields(ocrFront.rawText),
        confidence: ocrFront.confidence,
      };
    } catch (e) {
      ocr = { rawText: "", fields: {}, confidence: 0 };
      // eslint-disable-next-line no-console
      console.warn(`[document] OCR frente falló: ${(e as Error).message}`);
    }

    try {
      docFaceCrop = await cropDocFace(front, deps.engine);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[document] recorte de foto falló: ${(e as Error).message}`);
    }

    // MRZ del dorso (fuente autoritativa).
    try {
      const lines = await deps.mrzReader.readLines(back, deps.ocr);
      mrz = await parseMrz(lines);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[document] lectura MRZ falló: ${(e as Error).message}`);
    }

    // Barcode del dorso (serial). No bloqueante si no se lee.
    try {
      barcode = await deps.barcodeReader.read(back);
    } catch {
      barcode = { format: "", text: "" };
    }

    const authenticity = crossCheck(mrz, ocr, barcode);
    // passed exige: MRZ con dígitos válidos + cruces duros consistentes + foto recortable.
    const passed = mrz.valid && authenticity.consistent && docFaceCrop !== null;

    return {
      documentType: "ci_py",
      mrz,
      barcode,
      ocr,
      docFaceCrop,
      authenticity,
      passed,
    };
  }
}

export const documentModule = new DocumentModule();

/** Dependencias reales por defecto (on-prem). El engine se inyecta desde el server. */
export function defaultDocumentDeps(engine: Engine): DocumentDeps {
  const ocr = new PaddleOcrClient();
  return {
    ocr,
    mrzReader: new OcrMrzReader(),
    barcodeReader: new ZxingBarcodeReader(),
    engine,
  };
}
