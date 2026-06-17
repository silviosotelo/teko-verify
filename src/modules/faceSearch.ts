/**
 * Módulo `faceSearch` — búsqueda facial 1:N (P1 #2): dedup / anti-fraude +
 * KYC reusable (returning user).
 *
 * A diferencia del match 1:1 (`modules/match`, selfie ↔ foto del documento), acá
 * comparamos el embedding de la selfie contra TODA la galería de identidades ya
 * verificadas del tenant (los vectores ArcFace 512D que el pipeline ya persiste en
 * `verified_identities.face_embedding`). Dos señales emergen del resultado:
 *
 *   - DUPLICADO / FRAUDE: la cara matchea una identidad existente con un CI
 *     DISTINTO → posible misma persona usando otra identidad → señal fuerte que el
 *     workflow puede rutear a `in_review`.
 *   - USUARIO RECURRENTE / KYC reusable: la cara matchea una identidad con el MISMO
 *     CI → ya verificamos a esta persona antes; se expone su verificación previa.
 *
 * NO es rechazo duro: produce señal/score. El ruteo a revisión lo decide el workflow
 * (`faceSearch.onDuplicate`). Fail-closed lo maneja el pipeline (si la búsqueda no
 * corre, se trata como duplicado sospechado para que un workflow con onDuplicate
 * :review igualmente mande a revisión humana).
 *
 * Arquitectura (testeable sin DB, igual que `aml`):
 *   - `searchFaces(query, gallery, opts)` → PURO: brute-force coseno sobre el set,
 *     top-K sobre umbral, deriva las señales. Acá viven los tests.
 *   - `FaceGalleryProvider.gallery(...)` → trae los embeddings de la galería del
 *     tenant (la impl real lee de `verified_identities`; un provider in-memory
 *     devuelve un set fijo en los tests).
 *   - `runFaceSearch(input, provider, opts)` → orquesta gallery → searchFaces.
 *
 * Escala (v1 → futuro): brute-force en Node alcanza para miles de identidades por
 * tenant (512 floats × N, producto punto). Para decenas/cientos de miles conviene
 * un índice ANN: pgvector (columna `vector(512)` + índice ivfflat/hnsw, operador
 * `<=>` de distancia coseno) reemplazaría el escaneo lineal sin tocar la firma de
 * `searchFaces`. Queda ANOTADO; no se implementa en v1.
 */
import type { FaceSearchMatch, FaceSearchResult } from "../types";
import { cosineSimilarity } from "./match";
import { FACE_SEARCH_THRESHOLD } from "../config";

/** Una entrada de la galería de identidades verificadas (embedding ya decodificado). */
export interface GalleryEntry {
  identityId: string;
  sessionId: string;
  ci: string;
  name: string;
  /** Embedding ArcFace 512D L2-normalizado de la identidad. */
  embedding: Float32Array;
}

export interface FaceSearchOptions {
  /** Umbral coseno de "misma cara" (default FACE_SEARCH_THRESHOLD). */
  threshold?: number;
  /** Máximo de matches a devolver (default 10). */
  topK?: number;
  /** CI de la sesión consultada — define ciMismatch (duplicado vs returning user). */
  currentCi?: string;
  /** Sesión consultada — se EXCLUYE de la galería (no matchearse a sí misma). */
  currentSessionId?: string;
}

/**
 * PURO: busca la cara `query` contra `gallery` por coseno (brute-force). Devuelve los
 * top-K sobre umbral ordenados desc + las señales dedup/returning-user.
 *
 * Exclusiones (defensa en profundidad — el provider ya debería excluir la sesión
 * actual, pero acá también):
 *   - entradas de `currentSessionId` (no compararse consigo misma).
 *   - embeddings de dimensión distinta a la consulta (tombstones/purgados → length 0).
 *
 * Señales: `ciMismatch` por match = el CI de la galería ≠ `currentCi`.
 *   - duplicateSuspected = hay ≥1 match con ciMismatch (cara conocida, CI distinto).
 *   - returningUser      = hay ≥1 match con MISMO CI (ya verificado antes).
 */
export function searchFaces(
  query: Float32Array,
  gallery: GalleryEntry[],
  opts: FaceSearchOptions = {}
): FaceSearchResult {
  const threshold = opts.threshold ?? FACE_SEARCH_THRESHOLD;
  const topK = opts.topK ?? 10;
  const currentCi = (opts.currentCi ?? "").trim();

  let compared = 0;
  const matches: FaceSearchMatch[] = [];
  for (const e of gallery) {
    if (opts.currentSessionId && e.sessionId === opts.currentSessionId) continue;
    if (!e.embedding || e.embedding.length !== query.length) continue;
    compared++;
    const cosine = cosineSimilarity(query, e.embedding);
    if (cosine < threshold) continue;
    matches.push({
      identityId: e.identityId,
      sessionId: e.sessionId,
      ci: e.ci,
      name: e.name,
      cosine: Number(cosine.toFixed(4)),
      // CI vacío en la consulta ⇒ no podemos afirmar mismatch (conservador: tratamos
      // como mismatch sólo si AMBOS CI existen y difieren; sin CI, NO marca duplicado).
      ciMismatch: currentCi !== "" && e.ci.trim() !== currentCi,
    });
  }

  matches.sort((a, b) => b.cosine - a.cosine);
  const top = matches.slice(0, topK);
  const topCosine = top.length > 0 ? top[0].cosine : 0;
  const duplicateSuspected = top.some((m) => m.ciMismatch);
  const returningUser = top.some((m) => !m.ciMismatch);

  return {
    matches: top,
    topCosine,
    threshold,
    gallerySize: compared,
    duplicateSuspected,
    returningUser,
    queryCi: currentCi,
    // `passed` informa la columna del check: clear = sin sospecha de duplicado. Un
    // returning user (mismo CI) NO es un problema → passed sigue true.
    passed: !duplicateSuspected,
  };
}

/**
 * Fuente de la galería de embeddings. La impl real lee `verified_identities` del
 * tenant (decodificando el bytea a Float32Array); un provider in-memory la fija en
 * los tests. Mantener este seam evita acoplar el módulo al singleton de repos.
 */
export interface FaceGalleryProvider {
  gallery(tenantId: string, excludeSessionId?: string): Promise<GalleryEntry[]>;
}

/** Input del orquestador: la cara a buscar + el contexto de la sesión consultada. */
export interface FaceSearchInput {
  query: Float32Array;
  tenantId: string;
  currentSessionId: string;
  currentCi: string;
}

/**
 * Orquesta la búsqueda 1:N: galería del provider → searchFaces (puro). La sesión
 * actual se excluye en el provider Y en searchFaces (defensa en profundidad).
 */
export async function runFaceSearch(
  input: FaceSearchInput,
  provider: FaceGalleryProvider,
  opts: { threshold?: number } = {}
): Promise<FaceSearchResult> {
  const gallery = await provider.gallery(input.tenantId, input.currentSessionId);
  return searchFaces(input.query, gallery, {
    threshold: opts.threshold,
    currentCi: input.currentCi,
    currentSessionId: input.currentSessionId,
  });
}
