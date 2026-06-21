import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  MATCH_THRESHOLD,
  LIVENESS_THRESHOLD,
  GLASSES_MAX,
  AML_MATCH_THRESHOLD,
  AML_NAME_ONLY_MARGIN,
  FACE_SEARCH_THRESHOLD,
} from "../../config";

/**
 * Drift guard (Task 4) — NO TAUTOLÓGICO.
 *
 * Compara las DOS fuentes reales que pueden divergir:
 *   1. El seed del SQL: migrations/0020_config_plane.sql, leído con fs.readFileSync
 *      y parseado con un regex sobre el INSERT real.
 *   2. Las constantes de src/config.ts, importadas directamente.
 *
 * NO hay valores numéricos hardcodeados en este test como tercera fuente.
 * Si alguien cambia MATCH_THRESHOLD en config.ts sin actualizar el INSERT del SQL
 * (o viceversa), el test FALLA — ese es el punto.
 *
 * Antes era tautológico: el mock de seededSystemExec() repetía los mismos literales
 * que los expect (0.4, 0.6, 0.5 aparecían en las tres fuentes: mock, expect, constante).
 * Ahora el valor leído por el test proviene exclusivamente del parseo del archivo SQL.
 */

const SQL_FILE = path.resolve(
  __dirname,
  "../../..",
  "migrations",
  "0020_config_plane.sql"
);

/**
 * Parsea las filas INSERT del scope 'system'/'thresholds' del SQL y devuelve
 * un Map de key → valor numérico.
 *
 * Formato esperado en el INSERT:
 *   ('system', NULL, 'thresholds', 'KEY', 'VALUE'::jsonb, ...)
 */
function parseSeedValues(sqlText: string): Map<string, number> {
  const map = new Map<string, number>();
  const rowRe =
    /\(\s*'system'\s*,\s*NULL\s*,\s*'thresholds'\s*,\s*'(\w+)'\s*,\s*'([\d.]+)'::jsonb/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(sqlText)) !== null) {
    map.set(m[1], parseFloat(m[2]));
  }
  return map;
}

/**
 * Devuelve el valor parseado del SQL para 'key', o lanza un error descriptivo
 * si no se encontró (para que el fallo del test sea claro).
 */
function seedVal(map: Map<string, number>, key: string): number {
  const v = map.get(key);
  if (v === undefined) {
    throw new Error(
      `Clave '${key}' no encontrada en migrations/0020_config_plane.sql. ` +
        `Verificar que el INSERT existe y que el formato del archivo coincide con el regex.`
    );
  }
  return v;
}

describe("config.ts ↔ migration seed — drift guard (Task 4)", () => {
  // Lectura y parseo del SQL real — si la clave no existe en el INSERT, seedVal() falla.
  const sqlText = readFileSync(SQL_FILE, "utf8");
  const seed = parseSeedValues(sqlText);

  it("matchCosine (SQL seed) == MATCH_THRESHOLD (config.ts)", () => {
    expect(seedVal(seed, "matchCosine")).toBe(MATCH_THRESHOLD);
  });

  it("livenessScore (SQL seed) == LIVENESS_THRESHOLD (config.ts)", () => {
    expect(seedVal(seed, "livenessScore")).toBe(LIVENESS_THRESHOLD);
  });

  it("qualityGlassesPct (SQL seed) == GLASSES_MAX (config.ts)", () => {
    expect(seedVal(seed, "qualityGlassesPct")).toBe(GLASSES_MAX);
  });

  it("amlMatch (SQL seed) == AML_MATCH_THRESHOLD (config.ts)", () => {
    expect(seedVal(seed, "amlMatch")).toBe(AML_MATCH_THRESHOLD);
  });

  it("amlNameOnlyMargin (SQL seed) == AML_NAME_ONLY_MARGIN (config.ts)", () => {
    expect(seedVal(seed, "amlNameOnlyMargin")).toBe(AML_NAME_ONLY_MARGIN);
  });

  it("faceSearch (SQL seed) == FACE_SEARCH_THRESHOLD (config.ts)", () => {
    expect(seedVal(seed, "faceSearch")).toBe(FACE_SEARCH_THRESHOLD);
  });
});
