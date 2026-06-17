/**
 * Módulo `proofOfAddress` — comprobante de domicilio (P1 #4).
 *
 * El titular sube una FACTURA DE SERVICIO / EXTRACTO BANCARIO (imagen o PDF). El OCR
 * lee el texto y, con HEURÍSTICAS (los comprobantes son de FORMATO LIBRE), extrae:
 *   - nombre del TITULAR,
 *   - LÍNEAS DE DOMICILIO (bloque con patrón de dirección: calle/número/ciudad/barrio/CP;
 *     se descartan encabezados, montos, RUC, fechas),
 *   - FECHA del documento (la más reciente plausible),
 *   - EMISOR (ANDE/ESSAP/COPACO/banco/telco…) si se puede.
 *
 * Validaciones:
 *   - `nameMatch`  → fuzzy del nombre del comprobante vs el nombre de la identidad
 *                    verificada (reusa `normalizeName`/`nameSimilarity` de aml.ts).
 *   - `recent`     → fecha del documento dentro de `maxAgeMonths` (default 3).
 *   - `hasAddress` → se detectó al menos una línea de domicilio.
 *
 * NO es rechazo duro: produce señal/score (igual que aml/face_search). `decision()` no
 * lo consume; el ruteo a revisión humana lo decide el workflow (`proofOfAddress.onFail`).
 *
 * FAIL-CLOSED: ante OCR caído / excepción / sin texto, `passed=false` + `error`; nunca
 * se inventan datos ni un comprobante ilegible "pasa" en silencio.
 *
 * Inyección: el cliente OCR se recibe (igual que en `document`) para testear el módulo
 * sin sidecar. La función PURA `extractProofOfAddress` / `evaluateProofOfAddress` viven
 * los casos de test (sobre líneas OCR de ejemplo, sin imágenes).
 */
import type { OcrClient, OcrResult } from "./document";
import { PaddleOcrClient } from "./document";
import { normalizeName, nameSimilarity } from "./aml";
import { ensureRasterImage } from "../lib/raster";
import type { ProofOfAddressResult } from "../types";

/** Antigüedad máxima por defecto (meses) para considerar el comprobante "reciente". */
export const DEFAULT_MAX_AGE_MONTHS = 3;

/** Umbral de similitud de nombre por defecto (Jaro-Winkler tolerante a typos/orden). */
export const DEFAULT_NAME_THRESHOLD = 0.82;

// ---------------------------------------------------------------------------
// Normalización de texto OCR
// ---------------------------------------------------------------------------

/** Canon para comparar/clasificar texto: sin acentos, mayúsculas, espacios colapsados. */
function canon(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Normaliza un input multilínea o arreglo de líneas a líneas limpias no vacías. */
function toLines(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(/\r?\n/);
  return raw.map((l) => l.replace(/[\t ]+/g, " ").trim()).filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Fecha del documento (la más reciente plausible)
// ---------------------------------------------------------------------------

const MONTHS_ES: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10,
  NOVIEMBRE: 11, DICIEMBRE: 12,
};

/** ¿La fecha (y/m/d) es un calendario válido y no demasiado futura/antigua? */
function plausibleDate(y: number, m: number, d: number, now: Date): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 1990 || y > now.getFullYear() + 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // p.ej. 31/02
  // Tolerancia: no aceptamos fechas más de 1 día en el futuro (relojes/UTC).
  if (dt.getTime() > now.getTime() + 24 * 3600 * 1000) return null;
  return dt;
}

/** Extrae TODAS las fechas plausibles del texto, en formatos numéricos y "DD de MES de YYYY". */
function findDates(text: string, now: Date): Date[] {
  const out: Date[] = [];
  const c = canon(text);

  // 1) DD/MM/YYYY | DD-MM-YYYY | DD.MM.YYYY (también con año de 2 dígitos).
  const numRe = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;
  for (const m of c.matchAll(numRe)) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const dt = plausibleDate(y, parseInt(m[2], 10), parseInt(m[1], 10), now);
    if (dt) out.push(dt);
  }

  // 2) YYYY-MM-DD | YYYY/MM/DD.
  const isoRe = /\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/g;
  for (const m of c.matchAll(isoRe)) {
    const dt = plausibleDate(
      parseInt(m[1], 10),
      parseInt(m[2], 10),
      parseInt(m[3], 10),
      now
    );
    if (dt) out.push(dt);
  }

  // 3) "DD de MES de YYYY" (o "DD MES YYYY").
  const txtRe = /\b(\d{1,2})\s+(?:DE\s+)?([A-Z]+)\s+(?:DE\s+)?(\d{4})\b/g;
  for (const m of c.matchAll(txtRe)) {
    const mon = MONTHS_ES[m[2]];
    if (!mon) continue;
    const dt = plausibleDate(parseInt(m[3], 10), mon, parseInt(m[1], 10), now);
    if (dt) out.push(dt);
  }

  return out;
}

/** ISO YYYY-MM-DD de un Date UTC. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Diferencia en meses (aprox) entre dos fechas — para el gate de "reciente". */
function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth()) +
    (to.getUTCDate() >= from.getUTCDate() ? 0 : -1)
  );
}

// ---------------------------------------------------------------------------
// Emisor (best-effort)
// ---------------------------------------------------------------------------

/** Emisores conocidos PY (servicios públicos, telcos, bancos). Best-effort. */
const ISSUERS: Array<{ key: string; label: string }> = [
  { key: "ANDE", label: "ANDE" },
  { key: "ESSAP", label: "ESSAP" },
  { key: "COPACO", label: "COPACO" },
  { key: "TIGO", label: "Tigo" },
  { key: "PERSONAL", label: "Personal" },
  { key: "CLARO", label: "Claro" },
  { key: "VOX", label: "Vox" },
  { key: "ITAU", label: "Banco Itaú" },
  { key: "ITAÚ", label: "Banco Itaú" },
  { key: "UENO", label: "Ueno Bank" },
  { key: "SUDAMERIS", label: "Sudameris" },
  { key: "CONTINENTAL", label: "Banco Continental" },
  { key: "VISION BANCO", label: "Visión Banco" },
  { key: "BASA", label: "BASA" },
  { key: "GNB", label: "Banco GNB" },
  { key: "FAMILIAR", label: "Banco Familiar" },
];

function detectIssuer(text: string): string {
  const c = canon(text);
  for (const i of ISSUERS) {
    if (c.includes(canon(i.key))) return i.label;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Domicilio (heurística)
// ---------------------------------------------------------------------------

/** Palabras-clave de DOMICILIO (calle/avenida/barrio/etc.). */
const ADDRESS_KEYWORDS = [
  "CALLE", "AVENIDA", "AVDA", "AV ", "RUTA", "BARRIO", "BO ", "BÂ°", "MANZANA",
  "MZA", "LOTE", "CASA", "EDIFICIO", "PISO", "DEPTO", "DEPARTAMENTO", "ESQUINA",
  "ESQ", "C/", "ENTRE", "KM ", "ZONA", "CIUDAD", "LOCALIDAD", "DISTRITO",
  "ASUNCION", "LUQUE", "CAPIATA", "LAMBARE", "FERNANDO", "ENCARNACION",
  "CIUDAD DEL ESTE", "SAN LORENZO", "MARIANO", "Ã‘EMBY", "NEMBY", "AREGUA",
  "VILLA ELISA", "ITAUGUA", "DOMICILIO", "DIRECCION",
];

/** Etiquetas/encabezados que NUNCA son domicilio (montos, totales, IDs, fechas). */
const ADDRESS_STOPWORDS = [
  "TOTAL", "MONTO", "IMPORTE", "SALDO", "VENCIMIENTO", "FACTURA", "RUC",
  "TIMBRADO", "NRO", "NUMERO", "N°", "FECHA", "PERIODO", "CONSUMO", "KWH",
  "GUARANIES", "GS.", "GS ", "$", "IVA", "SUBTOTAL", "CUENTA", "CLIENTE",
  "TELEFONO", "CORREO", "EMAIL", "WWW", "HTTP", "PAGAR", "PAGO", "CODIGO",
];

/** Departamentos/ciudades PY frecuentes (refuerzan que la línea es domicilio). */
const HAS_NUMBER = /\d/;

/**
 * ¿La línea parece una LÍNEA DE DOMICILIO? Heurística:
 *   - NO es un encabezado/monto (stopwords) salvo que tenga keyword de calle fuerte;
 *   - tiene una keyword de dirección, O bien tiene un número + ≥2 palabras alfabéticas
 *     (patrón "calle 123 barrio centro") sin ser puramente numérica/monto.
 */
function looksLikeAddressLine(line: string): boolean {
  const c = canon(line);
  if (c.length < 4 || c.length > 90) return false;

  const hasKeyword = ADDRESS_KEYWORDS.some((k) => c.includes(canon(k.trim())));

  // Stopwords: si la línea es claramente un monto/etiqueta y NO trae keyword de calle,
  // se descarta (fail-closed: preferimos no ensuciar el domicilio con un total).
  const hasStop = ADDRESS_STOPWORDS.some((s) => c.includes(canon(s.trim())));
  if (hasStop && !hasKeyword) return false;

  if (hasKeyword) return true;

  // Sin keyword: aceptamos "texto + número" (calle implícita) con suficiente alfabético.
  const words = c.split(" ").filter((w) => /[A-Z]/.test(w) && w.length >= 3);
  return HAS_NUMBER.test(c) && words.length >= 2;
}

// ---------------------------------------------------------------------------
// Nombre del titular (heurística)
// ---------------------------------------------------------------------------

/** Etiquetas que suelen PRECEDER al nombre del titular en un comprobante. */
const NAME_LABELS = ["TITULAR", "CLIENTE", "NOMBRE", "SR ", "SRA ", "SEÑOR", "USUARIO", "A NOMBRE DE"];

/** ¿`token` es una palabra de nombre plausible (alfabética, ≥2 chars)? */
function isNameToken(tok: string): boolean {
  return /^[A-ZÁÉÍÓÚÑ]{2,}$/.test(tok);
}

/** ¿La línea (canon) parece un NOMBRE de persona (2-6 tokens alfabéticos, sin dígitos)? */
function looksLikeHolderName(line: string): boolean {
  const c = canon(line);
  if (HAS_NUMBER.test(c)) return false;
  if (ADDRESS_STOPWORDS.some((s) => c.includes(canon(s.trim())))) return false;
  if (ADDRESS_KEYWORDS.some((k) => c.includes(canon(k.trim())))) return false;
  const tokens = c.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return false;
  return tokens.every(isNameToken);
}

/** Quita el prefijo de etiqueta ("TITULAR:", "CLIENTE -", "SR.") del valor de un nombre. */
function stripNameLabel(line: string): string {
  let out = line;
  for (const lbl of NAME_LABELS) {
    const re = new RegExp(`^\\s*${lbl.trim()}\\s*[:\\-.]*\\s*`, "i");
    out = out.replace(re, "");
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// Extracción PURA
// ---------------------------------------------------------------------------

export interface ProofExtraction {
  holderName: string;
  addressLines: string[];
  address: string;
  documentDate: string;
  issuer: string;
}

export interface ExtractOptions {
  /** Reloj inyectable para tests deterministas (default Date.now). */
  now?: Date;
}

/**
 * PURO: dado el texto OCR (multilínea o arreglo de líneas), extrae los campos del
 * comprobante. Testeable sin imágenes (se le pasan líneas OCR de ejemplo).
 */
export function extractProofOfAddress(
  input: string | string[],
  opts: ExtractOptions = {}
): ProofExtraction {
  const now = opts.now ?? new Date();
  const lines = toLines(input);
  const fullText = lines.join("\n");

  // --- Titular: 1º un valor tras una etiqueta de nombre; si no, la 1ª línea-nombre.
  let holderName = "";
  for (const l of lines) {
    const c = canon(l);
    const hasLabel = NAME_LABELS.some((lbl) => c.startsWith(canon(lbl.trim())) || c.includes(canon(lbl.trim())));
    if (hasLabel) {
      const candidate = stripNameLabel(l);
      if (candidate && looksLikeHolderName(candidate)) {
        holderName = candidate.trim();
        break;
      }
    }
  }
  if (!holderName) {
    for (const l of lines) {
      if (looksLikeHolderName(l)) {
        holderName = l.trim();
        break;
      }
    }
  }

  // --- Domicilio: líneas con patrón de dirección (se quita el prefijo "DOMICILIO:").
  const addressLines: string[] = [];
  for (const l of lines) {
    if (looksLikeAddressLine(l)) {
      const cleaned = l.replace(/^\s*(DOMICILIO|DIRECCI[ÓO]N)\s*[:\-.]*\s*/i, "").trim();
      if (cleaned.length >= 3) addressLines.push(cleaned);
    }
  }

  // --- Fecha: la MÁS RECIENTE plausible (emisión típica más reciente que vencimiento).
  const dates = findDates(fullText, now);
  let documentDate = "";
  if (dates.length > 0) {
    const latest = dates.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
    documentDate = isoDate(latest);
  }

  return {
    holderName,
    addressLines,
    address: addressLines.join(", "),
    documentDate,
    issuer: detectIssuer(fullText),
  };
}

// ---------------------------------------------------------------------------
// Evaluación PURA (validaciones → ProofOfAddressResult)
// ---------------------------------------------------------------------------

export interface EvaluateOptions {
  /** Nombre de la identidad verificada (apellidos+nombres) para el name-match. */
  identityName: string;
  maxAgeMonths?: number;
  requireNameMatch?: boolean;
  nameThreshold?: number;
  /** Reloj inyectable para tests deterministas. */
  now?: Date;
  /** Confianza media del OCR (informativa). */
  ocrConfidence?: number;
}

/**
 * PURO: dada una extracción + el nombre de la identidad, calcula nameMatch/recent/
 * hasAddress/passed. Aislado para los tests (no toca OCR ni imágenes).
 */
export function evaluateProofOfAddress(
  ex: ProofExtraction,
  opts: EvaluateOptions
): ProofOfAddressResult {
  const now = opts.now ?? new Date();
  const maxAgeMonths = opts.maxAgeMonths ?? DEFAULT_MAX_AGE_MONTHS;
  const requireNameMatch = opts.requireNameMatch ?? true;
  const nameThreshold = opts.nameThreshold ?? DEFAULT_NAME_THRESHOLD;

  const identityNorm = normalizeName(opts.identityName);
  const holderNorm = normalizeName(ex.holderName);
  const sim = identityNorm && holderNorm ? nameSimilarity(identityNorm, holderNorm) : 0;
  const nameMatch = sim >= nameThreshold;

  let recent = false;
  if (ex.documentDate) {
    const docDt = new Date(`${ex.documentDate}T00:00:00.000Z`);
    if (!Number.isNaN(docDt.getTime())) {
      const age = monthsBetween(docDt, now);
      recent = age >= 0 && age <= maxAgeMonths;
    }
  }

  const hasAddress = ex.addressLines.length > 0;

  // passed: domicilio + reciente SIEMPRE; nombre coincide sólo si se exige.
  const passed = hasAddress && recent && (!requireNameMatch || nameMatch);

  return {
    holderName: ex.holderName,
    addressLines: ex.addressLines,
    address: ex.address,
    documentDate: ex.documentDate,
    issuer: ex.issuer,
    identityName: identityNorm,
    nameSimilarity: Number(sim.toFixed(4)),
    nameMatch,
    recent,
    maxAgeMonths,
    hasAddress,
    passed,
    ocrConfidence: opts.ocrConfidence,
  };
}

// ---------------------------------------------------------------------------
// Orquestación (OCR → extracción → evaluación)
// ---------------------------------------------------------------------------

export interface RunOptions extends Omit<EvaluateOptions, "ocrConfidence"> {
  ocr?: OcrClient;
}

/** Resultado fail-closed cuando el OCR no corre o lanza. */
function failClosed(opts: EvaluateOptions, error: string): ProofOfAddressResult {
  return {
    holderName: "",
    addressLines: [],
    address: "",
    documentDate: "",
    issuer: "",
    identityName: normalizeName(opts.identityName),
    nameSimilarity: 0,
    nameMatch: false,
    recent: false,
    maxAgeMonths: opts.maxAgeMonths ?? DEFAULT_MAX_AGE_MONTHS,
    hasAddress: false,
    passed: false,
    error,
  };
}

/**
 * Corre el módulo sobre una IMAGEN/PDF del comprobante: rasteriza PDF (`ensureRasterImage`),
 * OCR-ea vía el cliente inyectado (PaddleOCR por default), extrae y evalúa. FAIL-CLOSED.
 */
export async function runProofOfAddress(
  image: Buffer,
  opts: RunOptions
): Promise<ProofOfAddressResult> {
  const ocr = opts.ocr ?? new PaddleOcrClient();
  let res: OcrResult;
  try {
    const raster = await ensureRasterImage(image);
    res = await ocr.recognize(raster);
  } catch (e) {
    return failClosed(opts, e instanceof Error ? e.message : String(e));
  }
  const text = res.rawText || res.lines.map((l) => l.text).join("\n");
  if (!text.trim()) return failClosed(opts, "ocr_empty");
  const ex = extractProofOfAddress(text, { now: opts.now });
  return evaluateProofOfAddress(ex, { ...opts, ocrConfidence: res.confidence });
}
