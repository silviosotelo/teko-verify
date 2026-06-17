/**
 * Repositorio de `aml_entities` (P1 #1) — copia LOCAL del dataset de sanciones/PEP.
 *
 * El screening corre 100% on-prem: `candidates()` hace un prefiltro COARSE por
 * overlap de tokens (índice GIN sobre `tokens`), y el fuzzy matching fino lo hace
 * el módulo `aml` en la app. El nombre del titular nunca sale del server.
 *
 * NO está scopeado por tenant: la lista de sanciones es global (compartida por
 * todos los tenants), a diferencia del resto de las tablas.
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import type { AmlEntity, AmlInput } from "../../types";
import { indexTokens, normalizeName, tokenize } from "../../modules/aml";

interface EntityRow {
  entity_id: string;
  schema: string | null;
  name: string;
  name_norm: string;
  aliases: string[];
  lists: string[];
  topics: string[];
  countries: string[];
  birth_date: string | null;
}

function mapEntity(row: EntityRow): AmlEntity {
  return {
    entityId: row.entity_id,
    name: row.name,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    lists: Array.isArray(row.lists) ? row.lists : [],
    topics: Array.isArray(row.topics) ? row.topics : [],
    countries: Array.isArray(row.countries) ? row.countries : [],
    birthDate: row.birth_date,
    schema: row.schema,
  };
}

/** Tokens de consulta (len ≥ 2) para el prefiltro por overlap. */
function queryTokens(input: AmlInput): string[] {
  const norm = normalizeName(`${input.nombres ?? ""} ${input.apellidos ?? ""}`);
  return [...new Set(tokenize(norm).filter((t) => t.length >= 2))];
}

/**
 * Candidatos COARSE para un input: filas cuyo arreglo `tokens` solapa con algún
 * token de la consulta (operador && acelerado por GIN). Limita a `limit` filas;
 * el ranking fino lo hace `screenEntities`. Sin tokens de consulta → vacío.
 */
export async function candidates(
  input: AmlInput,
  limit = 500,
  exec: Executor = pool
): Promise<AmlEntity[]> {
  const tokens = queryTokens(input);
  if (tokens.length === 0) return [];
  const res = await exec.query<EntityRow>(
    `SELECT entity_id, schema, name, name_norm, aliases, lists, topics, countries, birth_date
       FROM aml_entities
      WHERE tokens && $1::text[]
      LIMIT $2`,
    [tokens, limit]
  );
  return res.rows.map(mapEntity);
}

/** Cuenta total de entidades cargadas. */
export async function count(exec: Executor = pool): Promise<number> {
  const res = await exec.query<{ n: string }>("SELECT count(*)::text AS n FROM aml_entities");
  return parseInt(res.rows[0]?.n ?? "0", 10);
}

/** Versión del dataset cargado (de aml_dataset_meta), o null. */
export async function datasetVersion(exec: Executor = pool): Promise<string | null> {
  const res = await exec.query<{ version: string | null }>(
    "SELECT version FROM aml_dataset_meta ORDER BY refreshed_at DESC LIMIT 1"
  );
  return res.rows[0]?.version ?? null;
}

export interface UpsertEntityInput {
  entityId: string;
  schema?: string | null;
  name: string;
  aliases?: string[];
  lists?: string[];
  topics?: string[];
  countries?: string[];
  birthDate?: string | null;
  source?: string;
}

/**
 * Upsert idempotente de una entidad (usado por el import). Recalcula name_norm +
 * tokens. ON CONFLICT (entity_id) reemplaza (refresh del dataset).
 */
export async function upsert(input: UpsertEntityInput, exec: Executor = pool): Promise<void> {
  const aliases = input.aliases ?? [];
  await exec.query(
    `INSERT INTO aml_entities
       (entity_id, schema, name, name_norm, aliases, lists, topics, countries, birth_date, source, tokens)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11::text[])
     ON CONFLICT (entity_id) DO UPDATE SET
       schema=EXCLUDED.schema, name=EXCLUDED.name, name_norm=EXCLUDED.name_norm,
       aliases=EXCLUDED.aliases, lists=EXCLUDED.lists, topics=EXCLUDED.topics,
       countries=EXCLUDED.countries, birth_date=EXCLUDED.birth_date,
       source=EXCLUDED.source, tokens=EXCLUDED.tokens`,
    [
      input.entityId,
      input.schema ?? null,
      input.name,
      normalizeName(input.name),
      JSON.stringify(aliases),
      JSON.stringify(input.lists ?? []),
      JSON.stringify(input.topics ?? []),
      JSON.stringify(input.countries ?? []),
      input.birthDate ?? null,
      input.source ?? "opensanctions",
      indexTokens(input.name, aliases),
    ]
  );
}

/** Registra la metadata del dataset (versión + conteo) tras un import/refresh. */
export async function setMeta(
  source: string,
  version: string | null,
  entityCount: number,
  exec: Executor = pool
): Promise<void> {
  await exec.query(
    `INSERT INTO aml_dataset_meta (source, version, entity_count, refreshed_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (source) DO UPDATE SET
       version=EXCLUDED.version, entity_count=EXCLUDED.entity_count, refreshed_at=now()`,
    [source, version, entityCount]
  );
}
