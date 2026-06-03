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
  ExtractedDocument,
  MrzData,
  OcrData,
  OcrLine,
} from "../types";
import { OCR_SIDECAR_URL } from "../config";

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

  async recognize(image: Buffer): Promise<OcrResult> {
    const res = await fetch(`${this.baseUrl}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: image.toString("base64") }),
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
export class OcrMrzReader implements MrzReader {
  async readLines(back: Buffer, ocr: OcrClient, pre?: OcrResult): Promise<string[]> {
    const { rawText } = pre ?? (await ocr.recognize(back));
    const candidates = rawText
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, "").toUpperCase())
      .filter((l) => /^[A-Z0-9<]{20,}$/.test(l))
      // Excluí rótulos: puras letras (ni dígitos ni `<`) y cortos (<28).
      .filter((l) => !(/^[A-Z]+$/.test(l) && l.length < 28));
    // TD1 = 3 líneas; tomamos las 3 más largas del alfabeto MRZ y las ordenamos
    // por estructura TD1 (NO alfabéticamente).
    const top3 = candidates.sort((a, b) => b.length - a.length).slice(0, 3);
    return orderTd1(top3);
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
}

/** Centro y dimensiones de una caja de 4 esquinas. */
function toAnchorLines(lines: OcrLine[]): AnchorLine[] {
  return lines.map((l) => {
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
function valueBelow(
  lines: AnchorLine[],
  label: AnchorLine,
  opts: {
    maxDx?: number;
    maxDy?: number;
    minScore?: number;
    exclude?: AnchorLine[];
    /**
     * Predicado de FORMA esperada del valor. El frente de la cédula PY tiene un
     * fondo de guilloche/watermark que el OCR fragmenta en ruido ("CAL", "WAL",
     * "AYREPUBLIC"...) salpicado entre la etiqueta y su valor real. Sin filtro,
     * `valueBelow` devuelve el fragmento de ruido más cercano en Y. Con `accept`,
     * se devuelve el candidato MÁS CERCANO que pasa el predicado, saltando el ruido.
     * Si no se provee, se acepta cualquier texto (comportamiento histórico).
     */
    accept?: (text: string) => boolean;
  } = {}
): string {
  const maxDx = opts.maxDx ?? 280;
  const maxDy = opts.maxDy ?? 220;
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
  return candidates[0]?.text.trim() ?? "";
}

/** Atajo: localiza la etiqueta y devuelve su valor-debajo (o "" si no hay). */
function fieldBelow(
  lines: AnchorLine[],
  label: string,
  labels: AnchorLine[],
  opts?: { maxDx?: number; maxDy?: number; minScore?: number; accept?: (text: string) => boolean }
): string {
  const lbl = findLabel(lines, label);
  if (!lbl) return "";
  return valueBelow(lines, lbl, { ...opts, exclude: labels });
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

/** ¿El texto contiene una fecha impresa DD-MM-YYYY (o con / .)? */
function looksLikeDate(s: string): boolean {
  return /\d{2}[\/.\-]\d{2}[\/.\-]\d{4}/.test(s);
}

/** "DD-MM-YYYY" (o con / .) → ISO "YYYY-MM-DD". "" si no matchea. */
function printedDateToIso(s: string): string {
  const m = s.match(/(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/);
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
 * Predicado de PLAUSIBILIDAD de un valor de nombre (apellidos/nombres). El fondo
 * guilloche/watermark del frente salpica ruido entre la etiqueta y su valor real;
 * sin este filtro `valueBelow` devuelve el fragmento más cercano en Y (p.ej. "DEL"
 * del watermark "REPÚBLICA DEL PARAGUAY"). Un nombre real:
 *   - tras canon, queda sólo en letras+espacios;
 *   - cada token tiene ≥4 chars (descarta "DEL","PAR","ICA","Y"...);
 *   - no es una stopword de fondo;
 *   - longitud total razonable (≥4, ≤40).
 */
function looksLikeName(s: string): boolean {
  const c = canon(s);
  if (!c) return false;
  if (!/^[A-Z ]+$/.test(c)) return false; // sólo letras y espacios
  if (c.length < 4 || c.length > 40) return false;
  const tokens = c.split(" ").filter(Boolean);
  if (tokens.length === 0) return false;
  // Al menos un token "fuerte" (≥4 chars y no-stopword); ninguna stopword sola.
  const strong = tokens.filter((t) => t.length >= 4 && !NAME_STOPWORDS.has(t));
  if (strong.length === 0) return false;
  // Rechazá si el texto ENTERO colapsa a una stopword conocida.
  if (NAME_STOPWORDS.has(c.replace(/ /g, ""))) return false;
  return true;
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
 * Extrae los campos del FRENTE por anclaje posición→etiqueta (FUENTE AUTORITATIVA).
 * Best-effort: cada campo se setea sólo si su ancla existe; lo demás queda en blanco.
 */
function extractFront(frontLines: OcrLine[], extracted: ExtractedDocument): void {
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

  // Apellidos / Nombres (valor debajo de la etiqueta). `accept: looksLikeName`
  // salta el ruido del watermark/guilloche ("DEL","PARA","ICA"...) que en capturas
  // movidas/comprimidas cae más cerca en Y que el valor real. Sin este filtro el
  // anclaje agarraba "DEL" (de "REPÚBLICA DEL PARAGUAY") como apellido. maxDx
  // ampliado: en la captura real el valor puede quedar levemente desalineado en X.
  const apellidos = cleanName(
    fieldBelow(lines, "APELLIDOS", labels, { accept: looksLikeName, maxDx: 360 })
  );
  if (apellidos) extracted.titular.apellidos = apellidos;
  const nombres = cleanName(
    fieldBelow(lines, "NOMBRES", labels, { accept: looksLikeName, maxDx: 360 })
  );
  if (nombres) extracted.titular.nombres = nombres;

  // Fecha de vencimiento. `accept` salta fragmentos de guilloche: sólo acepta el
  // candidato con forma DD-MM-YYYY.
  const venc = printedDateToIso(
    fieldBelow(lines, "FECHA DE VENCIMIENTO", labels, { accept: looksLikeDate })
  );
  if (venc) extracted.documentoFisico.fechaVencimiento = venc;

  // Fecha de nacimiento. Idem: el valor "13-11-1997" está debajo, con ruido en medio.
  const nac = printedDateToIso(
    fieldBelow(lines, "FECHA DE NACIMIENTO", labels, { accept: looksLikeDate })
  );
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
  const lugar = fieldBelow(lines, "LUGAR DE NACIMIENTO", labels);
  if (lugar) {
    const parts = lugar.split(/\s*-\s*/);
    extracted.titular.lugarNacimiento.ciudad = (parts[0] ?? "").trim();
    extracted.titular.lugarNacimiento.departamento = (parts[1] ?? "").trim();
  }

  // Nº de cédula: el rótulo "Nº"/"No" con los dígitos a la DERECHA, en la misma fila.
  const noLabel = lines
    .filter((l) => /^N[º°O]?\.?$/i.test(l.text.trim()) || canon(l.text) === "NO")
    .sort((a, b) => b.score - a.score)[0];
  if (noLabel) {
    const num = valueRight(lines, noLabel, (t) => /\d{5,8}/.test(t.replace(/\D/g, "")));
    const digits = num.replace(/\D/g, "");
    if (digits.length >= 5) extracted.documento.numeroCedula = digits;
  }
  // Fallback: si no encontramos por ancla "Nº", buscamos una línea de 6-8 dígitos
  // que NO sea una fecha (heurística defensiva, sólo si quedó vacío). Excluimos
  // tokens con forma DD-MM-YYYY: "12-07-2033" colapsa a "12072033" (8 dígitos) y
  // robaría el lugar del Nº real.
  if (!extracted.documento.numeroCedula) {
    const cand = lines
      .filter((l) => !/\d{2}[\/.\-]\d{2}[\/.\-]\d{4}/.test(l.text))
      .map((l) => l.text.replace(/\D/g, ""))
      .find((d) => d.length >= 6 && d.length <= 8);
    if (cand) extracted.documento.numeroCedula = cand;
  }
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
function notExpired(iso: string): boolean {
  return iso !== "" && new Date(`${iso}T23:59:59.999Z`) >= new Date();
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

  // 4) Cruces MRZ↔frente SÓLO si el MRZ parseó válido. SOFT.
  if (mrz.valid) {
    const ocrNum = norm(extracted.documento.numeroCedula);
    const mrzNum = norm(mrz.documentNumber);
    if (ocrNum && mrzNum) {
      const m = mrzNum.includes(ocrNum) || ocrNum.includes(mrzNum);
      checks.push({
        name: "mrz_vs_front_number",
        passed: m,
        detail: `mrz=${mrz.documentNumber} front=${extracted.documento.numeroCedula}`,
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
// Orquestación del módulo.
// ---------------------------------------------------------------------------

export interface DocumentDeps {
  ocr: OcrClient;
  mrzReader: MrzReader;
  barcodeReader: BarcodeReader;
  engine: Engine;
}

export class DocumentModule {
  /**
   * Ejecuta el módulo. Fail-closed: cualquier error de OCR/sidecar/parse deja
   * passed=false. No lanza: convierte el fallo en un DocumentResult no-aprobado.
   */
  async run(front: Buffer, back: Buffer, deps: DocumentDeps): Promise<DocumentResult> {
    let mrz: MrzData = { ...EMPTY_MRZ };
    let barcode: BarcodeData = { format: "", text: "" };
    let docFaceCrop: DocFaceCrop | null = null;
    const extracted = emptyExtracted();
    let frontConfidence = 0;
    let frontRawText = "";

    // OCR del FRENTE (datos autoritativos + recorte de foto).
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
    // paisCodigo sólo si el MRZ parseó válido.
    extracted.mrz.paisCodigo = mrz.valid ? mrz.issuingCountry : "";

    // Barcode del dorso (serial). No bloqueante.
    try {
      barcode = await deps.barcodeReader.read(back);
    } catch {
      barcode = { format: "", text: "" };
    }
    // Si el barcode se leyó, refuerza la presencia del código de barras.
    if (barcode.text) extracted.documentoFisico.codigoBarras = true;

    // Autenticidad por cruce: compara el MRZ GENUINO contra el frente (SOFT) ANTES
    // de hacer backfill — si no, el MRZ se compararía contra sí mismo.
    const authenticity = crossCheck(extracted, mrz, barcode);

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
      notExpired(extracted.documentoFisico.fechaVencimiento) &&
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
  const ocr = new PaddleOcrClient();
  return {
    ocr,
    mrzReader: new OcrMrzReader(),
    barcodeReader: new ZxingBarcodeReader(),
    engine,
  };
}
