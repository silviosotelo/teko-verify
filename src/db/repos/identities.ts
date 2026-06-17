/**
 * Repositorio de verified_identities (§5).
 *
 * face_embedding tiene dos representaciones (types.ts):
 *   - persistido en PG: bytea ↔ Buffer (lectura: pg devuelve Buffer directo).
 *   - en escritura desde el engine: VerifiedIdentityInput.faceEmbedding es Float32Array
 *     → se serializa a Buffer SIN copia de datos vía Buffer.from(view) (512×4 = 2048 bytes).
 *
 * Se exponen dos formas de lectura:
 *   - get*  → VerifiedIdentity (faceEmbedding: Buffer, fiel a types.ts).
 *   - getDecoded* → además el Float32Array reconstruido para el match/uso en engine.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type {
  DocumentType,
  LoA,
  VerifiedIdentity,
  VerifiedIdentityInput,
} from "../../types";
import type { GalleryEntry } from "../../modules/faceSearch";

interface IdentityRow {
  id: string;
  tenant_id: string;
  session_id: string;
  ci: string;
  nombre: string;
  fecha_nac: string;
  nacionalidad: string;
  tipo_doc: DocumentType;
  assurance_level: LoA;
  face_embedding: Buffer;
  created_at: Date;
}

function mapIdentity(row: IdentityRow): VerifiedIdentity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    ci: row.ci,
    nombre: row.nombre,
    fechaNac: row.fecha_nac,
    nacionalidad: row.nacionalidad,
    tipoDoc: row.tipo_doc,
    assuranceLevel: row.assurance_level,
    faceEmbedding: row.face_embedding,
    createdAt: iso(row.created_at),
  };
}

/** Reconstruye el Float32Array 512D desde el Buffer bytea (para el engine/match). */
export function decodeEmbedding(buf: Buffer): Float32Array {
  // Copiamos a un ArrayBuffer propio y alineado para evitar sorpresas de byteOffset.
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

/** Serializa el Float32Array del engine a Buffer para bytea (sin copiar los datos). */
function encodeEmbedding(emb: Float32Array): Buffer {
  return Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength);
}

export async function create(
  input: VerifiedIdentityInput,
  exec: Executor = pool
): Promise<VerifiedIdentity> {
  const res = await exec.query<IdentityRow>(
    `INSERT INTO verified_identities
       (tenant_id, session_id, ci, nombre, fecha_nac, nacionalidad,
        tipo_doc, assurance_level, face_embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.tenantId,
      input.sessionId,
      input.ci,
      input.nombre,
      input.fechaNac,
      input.nacionalidad,
      input.tipoDoc,
      input.assuranceLevel,
      encodeEmbedding(input.faceEmbedding),
    ]
  );
  return mapIdentity(res.rows[0]);
}

export async function getById(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<VerifiedIdentity | null> {
  const res = await exec.query<IdentityRow>(
    "SELECT * FROM verified_identities WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return res.rows[0] ? mapIdentity(res.rows[0]) : null;
}

export async function getBySession(
  tenantId: string,
  sessionId: string,
  exec: Executor = pool
): Promise<VerifiedIdentity | null> {
  const res = await exec.query<IdentityRow>(
    "SELECT * FROM verified_identities WHERE tenant_id = $1 AND session_id = $2",
    [tenantId, sessionId]
  );
  return res.rows[0] ? mapIdentity(res.rows[0]) : null;
}

/**
 * Galería de embeddings para la búsqueda facial 1:N (P1 #2). Devuelve las
 * identidades verificadas del tenant con su embedding YA decodificado a
 * Float32Array, listo para el brute-force coseno de `searchFaces`.
 *
 * Reusa el biométrico que el pipeline ya persiste (`face_embedding` bytea, 512×4 =
 * 2048 bytes): NO duplicamos el vector en otra columna. Excluye:
 *   - la sesión consultada (`excludeSessionId`) — no compararse a sí misma;
 *   - embeddings PURGADOS/tombstone (octet_length ≠ 2048): `purgeEmbedding` los deja
 *     en un Buffer vacío por minimización (§12); no son comparables.
 *
 * Escala v1: escaneo lineal en Node (suficiente para miles por tenant). Para escala
 * mayor, migrar a pgvector (ver nota en modules/faceSearch.ts).
 */
export async function listGallery(
  tenantId: string,
  opts: { excludeSessionId?: string; limit?: number } = {},
  exec: Executor = pool
): Promise<GalleryEntry[]> {
  const res = await exec.query<
    Pick<IdentityRow, "id" | "session_id" | "ci" | "nombre" | "face_embedding">
  >(
    `SELECT id, session_id, ci, nombre, face_embedding
       FROM verified_identities
      WHERE tenant_id = $1
        AND ($2::uuid IS NULL OR session_id <> $2::uuid)
        AND octet_length(face_embedding) = 2048
      ORDER BY created_at DESC
      LIMIT $3`,
    [tenantId, opts.excludeSessionId ?? null, opts.limit ?? 100000]
  );
  return res.rows.map((r) => ({
    identityId: r.id,
    sessionId: r.session_id,
    ci: r.ci,
    name: r.nombre,
    embedding: decodeEmbedding(r.face_embedding),
  }));
}

export async function listByTenant(
  tenantId: string,
  opts: { limit?: number; offset?: number } = {},
  exec: Executor = pool
): Promise<VerifiedIdentity[]> {
  const res = await exec.query<IdentityRow>(
    `SELECT * FROM verified_identities WHERE tenant_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [tenantId, opts.limit ?? 50, opts.offset ?? 0]
  );
  return res.rows.map(mapIdentity);
}

/**
 * Borra solo el embedding biométrico de una identidad (minimización/retención §12)
 * sin borrar la fila completa. Devuelve true si afectó una fila del tenant.
 * Nota: face_embedding es NOT NULL; lo dejamos en un Buffer vacío como tombstone.
 */
export async function purgeEmbedding(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<boolean> {
  const res = await exec.query(
    "UPDATE verified_identities SET face_embedding = $3 WHERE id = $1 AND tenant_id = $2",
    [id, tenantId, Buffer.alloc(0)]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function remove(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<boolean> {
  const res = await exec.query(
    "DELETE FROM verified_identities WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return (res.rowCount ?? 0) > 0;
}
