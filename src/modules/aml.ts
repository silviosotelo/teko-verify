/**
 * Módulo `aml` — screening de sanciones / PEP / listas por matching LOCAL (P1 #1).
 *
 * On-prem DURO (Ley 7593/2025): el nombre/PII del titular NUNCA sale del server.
 * El cruce corre contra una COPIA LOCAL del dataset (`aml_entities`), nunca contra
 * una API externa comercial. La fuente es swappable detrás de `AmlProvider`.
 *
 * Arquitectura (testeable sin DB):
 *   - `normalizeName` / `jaroWinkler` / `nameSimilarity` → puros, deterministas.
 *   - `screenEntities(input, entities, opts)` → PURO: dado un set de candidatos,
 *     calcula hits + score + decisión. Es donde viven los casos de test.
 *   - `AmlProvider.candidates(input)` → trae un set COARSE de candidatos (la impl
 *     local hace un prefiltro por overlap de tokens en PG; un provider in-memory
 *     devuelve una lista fija en los tests).
 *   - `screen(input, provider, opts)` → orquesta candidates → screenEntities.
 *
 * NO es rechazo duro: produce señal/score. El ruteo a revisión humana lo decide el
 * workflow (`aml.onMatch`). Fail-closed lo maneja el pipeline (si el screening no
 * corre, se trata como potential_match).
 */
import type { AmlDecision, AmlEntity, AmlHit, AmlInput, AmlResult } from "../types";
import { AML_MATCH_THRESHOLD } from "../config";

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

/**
 * Normaliza un nombre para comparar: NFD → quita diacríticos → mayúsculas →
 * reemplaza todo lo no [A-Z0-9] por espacio → colapsa espacios → trim.
 * "José Ñandú-Pérez" → "JOSE NANDU PEREZ".
 */
export function normalizeName(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacríticos
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Tokens (palabras) de un nombre normalizado. */
export function tokenize(norm: string): string[] {
  return norm ? norm.split(" ").filter(Boolean) : [];
}

/**
 * Tokens "indexables" (len ≥ 2, dedup) de un nombre + alias — para el prefiltro
 * coarse por overlap de arreglos en PG. Exportado para reusarlo en el import.
 */
export function indexTokens(name: string, aliases: string[] = []): string[] {
  const all = new Set<string>();
  for (const src of [name, ...aliases]) {
    for (const t of tokenize(normalizeName(src))) {
      if (t.length >= 2) all.add(t);
    }
  }
  return [...all];
}

// ---------------------------------------------------------------------------
// Similitud
// ---------------------------------------------------------------------------

/** Jaro similarity (0..1). */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const maxDist = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatch = new Array<boolean>(la).fill(false);
  const bMatch = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, lb);
    for (let j = start; j < end; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  // Transposiciones.
  let t = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  return (matches / la + matches / lb + (matches - t) / matches) / 3;
}

/** Jaro-Winkler (0..1) — bonus por prefijo común (hasta 4 chars, p=0.1). */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  if (j <= 0) return 0;
  let prefix = 0;
  const max = Math.min(4, a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

/**
 * Similitud entre dos nombres NORMALIZADOS, robusta al orden de tokens y a tokens
 * faltantes/sobrantes (apellido+nombre invertidos, segundo nombre ausente, etc.).
 *   - Exacto → 1.
 *   - token_sort: Jaro-Winkler sobre los tokens ORDENADOS y unidos.
 *   - coverage: para cada token de la consulta, su mejor Jaro-Winkler contra
 *     cualquier token del candidato; se promedia. Penaliza si el candidato tiene
 *     muchos más tokens (evita que "JUAN" matchee fuerte a un nombre largo).
 * Se devuelve el máximo de ambas señales, acotado a [0,1].
 */
export function nameSimilarity(aNorm: string, bNorm: string): number {
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;

  const at = tokenize(aNorm);
  const bt = tokenize(bNorm);
  if (at.length === 0 || bt.length === 0) return 0;

  // token_sort
  const sortJoin = (t: string[]) => [...t].sort().join(" ");
  const sortScore = jaroWinkler(sortJoin(at), sortJoin(bt));

  // coverage: promedio del mejor match por token de la consulta.
  let sum = 0;
  for (const qa of at) {
    let best = 0;
    for (const qb of bt) {
      const s = jaroWinkler(qa, qb);
      if (s > best) best = s;
    }
    sum += best;
  }
  let coverage = sum / at.length;
  // Penaliza candidatos mucho más largos que la consulta (menos específicos).
  if (bt.length > at.length) {
    coverage *= at.length / bt.length + (1 - at.length / bt.length) * 0.6;
  }

  return Math.min(1, Math.max(sortScore, coverage));
}

// ---------------------------------------------------------------------------
// Comparación de fecha de nacimiento
// ---------------------------------------------------------------------------

/** Año (YYYY) de una fecha parcial/completa, o null. */
function yearOf(d: string | null | undefined): string | null {
  if (!d) return null;
  const m = /(\d{4})/.exec(d);
  return m ? m[1] : null;
}

/** ¿Coinciden las fechas? 'exact' (YYYY-MM-DD igual), 'year' (mismo año), o null. */
function dobMatch(query?: string, entity?: string | null): "exact" | "year" | null {
  if (!query || !entity) return null;
  const qFull = /^\d{4}-\d{2}-\d{2}$/.test(query.trim()) ? query.trim() : null;
  // OpenSanctions birth_date puede traer varias fechas separadas por ';'.
  const candidates = entity.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const qYear = yearOf(query);
  for (const c of candidates) {
    if (qFull && /^\d{4}-\d{2}-\d{2}$/.test(c) && c === qFull) return "exact";
  }
  if (qYear) {
    for (const c of candidates) if (yearOf(c) === qYear) return "year";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Screening (puro)
// ---------------------------------------------------------------------------

export interface ScreenOptions {
  /** Umbral de potential_match (default AML_MATCH_THRESHOLD). */
  threshold?: number;
  /** Máximo de hits a devolver (default 10). */
  maxHits?: number;
  /** Nombre del proveedor (para auditoría). */
  provider?: string;
  /** Versión del dataset (informativo). */
  datasetVersion?: string | null;
}

/** Nombre completo normalizado de un input (nombres + apellidos). */
export function fullNameNorm(input: AmlInput): string {
  return normalizeName(`${input.nombres ?? ""} ${input.apellidos ?? ""}`);
}

/**
 * PURO: dado el input y un set de candidatos del dataset, calcula hits/score/decisión.
 * Cada candidato se puntúa por el MEJOR nombre (canónico o alias). La fecha de
 * nacimiento y la nacionalidad SUMAN señal (boost) y se reportan en matchedFields,
 * pero el nombre es el driver primario (sin nombre no hay hit).
 */
export function screenEntities(
  input: AmlInput,
  entities: AmlEntity[],
  opts: ScreenOptions = {}
): AmlResult {
  const threshold = opts.threshold ?? AML_MATCH_THRESHOLD;
  const maxHits = opts.maxHits ?? 10;
  const qNorm = fullNameNorm(input);
  const qNat = normalizeName(input.nacionalidad);

  const hits: AmlHit[] = [];

  if (qNorm) {
    for (const e of entities) {
      // Mejor similitud sobre nombre canónico + alias.
      let best = nameSimilarity(qNorm, normalizeName(e.name));
      let via: "name" | "alias" = "name";
      for (const al of e.aliases ?? []) {
        const s = nameSimilarity(qNorm, normalizeName(al));
        if (s > best) {
          best = s;
          via = "alias";
        }
      }
      if (best <= 0) continue;

      const matchedFields: string[] = [via];
      let score = best;

      // Boost por fecha de nacimiento.
      const dob = dobMatch(input.fechaNac, e.birthDate);
      if (dob === "exact") {
        score = Math.min(1, score + 0.08);
        matchedFields.push("dob");
      } else if (dob === "year") {
        score = Math.min(1, score + 0.04);
        matchedFields.push("dob");
      } else if (input.fechaNac && e.birthDate && yearOf(input.fechaNac) && yearOf(e.birthDate)) {
        // Año presente en ambos pero distinto → leve penalización (desambigua homónimos).
        score = Math.max(0, score - 0.05);
      }

      // Boost por nacionalidad/país.
      if (qNat && (e.countries ?? []).some((c) => normalizeName(c).includes(qNat) || qNat.includes(normalizeName(c)))) {
        score = Math.min(1, score + 0.03);
        matchedFields.push("nationality");
      }

      // Sólo retenemos candidatos con señal de nombre razonable (evita ruido).
      if (best >= Math.min(threshold, 0.7)) {
        hits.push({
          entityId: e.entityId,
          name: e.name,
          lists: e.lists ?? [],
          score: Number(score.toFixed(4)),
          matchedFields,
          topics: e.topics,
          countries: e.countries,
        });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, maxHits);
  const topScore = top.length > 0 ? top[0].score : 0;
  const decision: AmlDecision = topScore >= threshold ? "potential_match" : "clear";

  return {
    query: {
      nombres: input.nombres ?? "",
      apellidos: input.apellidos ?? "",
      fechaNac: input.fechaNac,
      nacionalidad: input.nacionalidad,
      normalized: qNorm,
    },
    hits: top,
    topScore,
    decision,
    threshold,
    provider: opts.provider ?? "local",
    datasetVersion: opts.datasetVersion ?? null,
    passed: decision === "clear",
  };
}

// ---------------------------------------------------------------------------
// Proveedor (pluggable)
// ---------------------------------------------------------------------------

/**
 * Fuente del dataset de screening. La impl LOCAL lee de `aml_entities` (PG). Para
 * cambiar de fuente (otra lista, otro vendor on-prem) se implementa esta interfaz
 * sin tocar el pipeline ni el matching.
 */
export interface AmlProvider {
  /** Identificador del proveedor (auditoría). */
  readonly name: string;
  /** Trae un set COARSE de candidatos para el input (prefiltro por tokens). */
  candidates(input: AmlInput): Promise<AmlEntity[]>;
  /** Versión/fecha del dataset cargado (informativo). */
  datasetVersion?(): Promise<string | null>;
}

/**
 * Orquesta el screening: candidatos del proveedor → screenEntities (puro).
 * Sin candidatos → decisión `clear` (sin hits). El error se maneja arriba (pipeline).
 */
export async function screen(
  input: AmlInput,
  provider: AmlProvider,
  opts: ScreenOptions = {}
): Promise<AmlResult> {
  const entities = await provider.candidates(input);
  const datasetVersion =
    opts.datasetVersion ?? (provider.datasetVersion ? await provider.datasetVersion() : null);
  return screenEntities(input, entities, {
    ...opts,
    provider: opts.provider ?? provider.name,
    datasetVersion,
  });
}
