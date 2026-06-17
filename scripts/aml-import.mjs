#!/usr/bin/env node
/**
 * Import / refresh del dataset AML LOCAL (P1 #1) — Teko Verify.
 *
 * Carga un CSV "targets.simple.csv" de OpenSanctions (colecciones sanctions / peps)
 * a la tabla `aml_entities`. El matching del pipeline corre 100% contra esa tabla
 * local: el nombre del titular NUNCA sale del server (Ley 7593/2025).
 *
 * ⚠️ LICENCIA: el dataset de OpenSanctions es gratis SÓLO para uso NO comercial.
 * Para producción comercial hay que licenciar OpenSanctions o usar otra fuente. La
 * arquitectura (provider pluggable + tabla local) lo permite sin tocar el pipeline.
 * Ver docs/specs/aml-screening.md.
 *
 * Uso:
 *   # Descargar e importar la colección de sanciones:
 *   node scripts/aml-import.mjs --url https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv --collection sanctions
 *   # Importar PEPs:
 *   node scripts/aml-import.mjs --url https://data.opensanctions.org/datasets/latest/peps/targets.simple.csv --collection peps
 *   # Desde un archivo ya descargado (volumen del 34):
 *   node scripts/aml-import.mjs --file /home/soporte/teko/data/aml/sanctions.simple.csv --collection sanctions
 *   # Refresh = volver a correr el import (ON CONFLICT actualiza por entity_id).
 *
 * Flags:
 *   --url <u>          URL del CSV (se descarga a --file o a un tmp).
 *   --file <p>         Ruta local del CSV (si no hay --url) o destino de descarga.
 *   --collection <c>   sanctions | peps (define el topic base). Default: sanctions.
 *   --source <s>       nombre lógico de la fuente en aml_dataset_meta. Default: opensanctions.
 *   --version <v>      versión a registrar (default: fecha ISO de hoy).
 *   --limit <n>        importar sólo las primeras n filas (pruebas).
 *   --truncate         vaciar aml_entities antes de importar (full reload).
 *   --batch <n>        tamaño de lote de upsert (default 500).
 *
 * Requiere DATABASE_URL en el entorno (mismo que el server).
 */
import fs from "node:fs";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import pg from "pg";

// --------------------------------------------------------------------------- //
// Args
// --------------------------------------------------------------------------- //
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
const args = parseArgs(process.argv);

const COLLECTION = String(args.collection || "sanctions").toLowerCase();
const SOURCE = String(args.source || "opensanctions");
const VERSION = String(args.version || new Date().toISOString().slice(0, 10));
const LIMIT = args.limit ? parseInt(String(args.limit), 10) : Infinity;
const BATCH = args.batch ? parseInt(String(args.batch), 10) : 500;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[aml-import] falta DATABASE_URL");
  process.exit(1);
}

// --------------------------------------------------------------------------- //
// Normalización + tokens (espejo de src/modules/aml.ts; el import es standalone)
// --------------------------------------------------------------------------- //
function normalizeName(s) {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
function indexTokens(name, aliases = []) {
  const all = new Set();
  for (const src of [name, ...aliases]) {
    for (const t of normalizeName(src).split(" ")) {
      if (t && t.length >= 2) all.add(t);
    }
  }
  return [...all];
}

// --------------------------------------------------------------------------- //
// Mapeo dataset → etiqueta de lista
// --------------------------------------------------------------------------- //
function listsFor(datasetField, collection) {
  const codes = String(datasetField || "")
    .split(/[;,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const labels = new Set();
  for (const c of codes) {
    if (c.includes("ofac") || c.startsWith("us_")) labels.add("OFAC");
    else if (c.startsWith("un_") || c.includes("un_sc")) labels.add("UN");
    else if (c.startsWith("eu_")) labels.add("EU");
    else if (c.startsWith("gb_") || c.includes("hmt")) labels.add("UK");
    else if (c.startsWith("ca_")) labels.add("CA");
    else if (c.startsWith("au_")) labels.add("AU");
    else if (c.startsWith("ch_")) labels.add("CH");
    else if (c.includes("interpol")) labels.add("INTERPOL");
    else if (c.includes("pep") || c.includes("everypolitician") || c.includes("wikidata"))
      labels.add("PEP");
    else if (c) labels.add(c.toUpperCase());
  }
  if (collection === "peps") labels.add("PEP");
  if (collection === "sanctions" && labels.size === 0) labels.add("SANCTIONS");
  return [...labels];
}
function topicsFor(collection) {
  return collection === "peps" ? ["role.pep"] : ["sanction"];
}

// --------------------------------------------------------------------------- //
// CSV streaming parser (maneja comillas, "" escapadas y saltos de línea dentro de campos)
// --------------------------------------------------------------------------- //
async function* csvRecords(stream) {
  let field = "";
  let record = [];
  let inQuotes = false;
  let prevQuoteClose = false;
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inQuotes) {
        if (ch === '"') {
          inQuotes = false;
          prevQuoteClose = true;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        if (prevQuoteClose) {
          // comilla escapada ("") dentro de campo entrecomillado
          field += '"';
          inQuotes = true;
          prevQuoteClose = false;
        } else {
          inQuotes = true;
        }
      } else if (ch === ",") {
        record.push(field);
        field = "";
        prevQuoteClose = false;
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r") continue; // CRLF → ignoramos \r
        record.push(field);
        field = "";
        prevQuoteClose = false;
        yield record;
        record = [];
      } else {
        field += ch;
        prevQuoteClose = false;
      }
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    yield record;
  }
}

// --------------------------------------------------------------------------- //
// Descarga (si --url)
// --------------------------------------------------------------------------- //
async function ensureFile() {
  if (args.file && fs.existsSync(String(args.file)) && !args.url) {
    return String(args.file);
  }
  if (args.url) {
    const dest = String(args.file || `/tmp/aml-${COLLECTION}.csv`);
    console.log(`[aml-import] descargando ${args.url} → ${dest}`);
    const res = await fetch(String(args.url));
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    await pipeline(res.body, fs.createWriteStream(dest));
    return dest;
  }
  if (args.file) return String(args.file);
  throw new Error("falta --url o --file");
}

// --------------------------------------------------------------------------- //
// Main
// --------------------------------------------------------------------------- //
async function main() {
  const file = await ensureFile();
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  if (args.truncate) {
    console.log("[aml-import] TRUNCATE aml_entities");
    await client.query("TRUNCATE aml_entities");
  }

  let header = null;
  let col = {};
  let imported = 0;
  let skipped = 0;
  let batch = [];

  async function flush() {
    if (batch.length === 0) return;
    // Upsert por lote en una transacción.
    await client.query("BEGIN");
    try {
      for (const e of batch) {
        await client.query(
          `INSERT INTO aml_entities
             (entity_id, schema, name, name_norm, aliases, lists, topics, countries, birth_date, source, tokens)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11::text[])
           ON CONFLICT (entity_id) DO UPDATE SET
             schema=EXCLUDED.schema, name=EXCLUDED.name, name_norm=EXCLUDED.name_norm,
             aliases=EXCLUDED.aliases, lists=EXCLUDED.lists, topics=EXCLUDED.topics,
             countries=EXCLUDED.countries, birth_date=EXCLUDED.birth_date,
             source=EXCLUDED.source, tokens=EXCLUDED.tokens`,
          e
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    batch = [];
  }

  const stream = createReadStream(file);
  for await (const rec of csvRecords(stream)) {
    if (!header) {
      header = rec.map((h) => h.trim());
      header.forEach((h, idx) => (col[h] = idx));
      if (col.id === undefined || col.name === undefined) {
        throw new Error(`CSV sin columnas id/name: header=${header.join(",")}`);
      }
      continue;
    }
    if (imported >= LIMIT) break;
    const get = (name) => (col[name] !== undefined ? rec[col[name]] ?? "" : "");
    const entityId = get("id").trim();
    const name = get("name").trim();
    if (!entityId || !name) {
      skipped++;
      continue;
    }
    const aliases = get("aliases")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    const countries = get("countries")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    const birthDate = get("birth_date").trim() || null;
    const schema = get("schema").trim() || null;
    const datasetField = get("dataset");

    batch.push([
      entityId,
      schema,
      name,
      normalizeName(name),
      JSON.stringify(aliases),
      JSON.stringify(listsFor(datasetField, COLLECTION)),
      JSON.stringify(topicsFor(COLLECTION)),
      JSON.stringify(countries),
      birthDate,
      SOURCE,
      indexTokens(name, aliases),
    ]);
    imported++;
    if (batch.length >= BATCH) {
      await flush();
      if (imported % 10000 === 0) console.log(`[aml-import] ${imported} filas...`);
    }
  }
  await flush();

  const total = (await client.query("SELECT count(*)::int AS n FROM aml_entities")).rows[0].n;
  await client.query(
    `INSERT INTO aml_dataset_meta (source, version, entity_count, refreshed_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (source) DO UPDATE SET version=EXCLUDED.version, entity_count=EXCLUDED.entity_count, refreshed_at=now()`,
    [SOURCE, VERSION, total]
  );

  console.log(
    `[aml-import] OK · colección=${COLLECTION} importadas=${imported} omitidas=${skipped} total_tabla=${total} version=${VERSION}`
  );
  await client.end();
}

main().catch((err) => {
  console.error("[aml-import] FALLÓ:", err);
  process.exit(1);
});
