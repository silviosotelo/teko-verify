/**
 * Tests del módulo AML (P1 #1) — matching LOCAL de sanciones/PEP.
 *
 * Cubren la lógica PURA (normalización, fuzzy de nombres, screening con boosts de
 * dob/nacionalidad, decisión clear/potential_match por umbral) y la orquestación
 * `screen()` contra un provider in-memory (integración sin DB).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeName,
  tokenize,
  indexTokens,
  jaroWinkler,
  nameSimilarity,
  fullNameNorm,
  screenEntities,
  screen,
  type AmlProvider,
} from "./aml";
import type { AmlEntity, AmlInput } from "../types";

describe("normalizeName", () => {
  it("quita diacríticos, mayúsculas, colapsa separadores", () => {
    expect(normalizeName("José Ñandú-Pérez")).toBe("JOSE NANDU PEREZ");
    expect(normalizeName("  o'brien,  john  ")).toBe("O BRIEN JOHN");
  });
  it("vacío/null → ''", () => {
    expect(normalizeName(undefined)).toBe("");
    expect(normalizeName(null)).toBe("");
    expect(normalizeName("")).toBe("");
  });
});

describe("tokenize / indexTokens", () => {
  it("tokeniza por espacios", () => {
    expect(tokenize("JUAN PEREZ")).toEqual(["JUAN", "PEREZ"]);
    expect(tokenize("")).toEqual([]);
  });
  it("indexTokens: dedup, incluye alias, descarta len<2", () => {
    const t = indexTokens("Juan A Perez", ["J. Perez"]);
    expect(t).toContain("JUAN");
    expect(t).toContain("PEREZ");
    expect(t).not.toContain("A"); // len 1 descartado
    // dedup: PEREZ aparece una sola vez
    expect(t.filter((x) => x === "PEREZ")).toHaveLength(1);
  });
});

describe("jaroWinkler", () => {
  it("idéntico → 1", () => {
    expect(jaroWinkler("MARTHA", "MARTHA")).toBe(1);
  });
  it("typo cercano → alto; distinto → bajo", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeGreaterThan(0.9);
    expect(jaroWinkler("ABCDE", "VWXYZ")).toBeLessThan(0.5);
  });
});

describe("nameSimilarity — robusta a orden/tokens faltantes", () => {
  it("orden de tokens invertido (apellido/nombre) → casi 1", () => {
    expect(nameSimilarity("JUAN PEREZ", "PEREZ JUAN")).toBeGreaterThan(0.95);
  });
  it("typo en un token → alto", () => {
    expect(nameSimilarity("VLADIMIR PUTIN", "VLADIMIR PUTYN")).toBeGreaterThan(0.85);
  });
  it("nombres distintos → bajo", () => {
    expect(nameSimilarity("MARIA GONZALEZ", "PEDRO RODRIGUEZ")).toBeLessThan(0.6);
  });
  it("token de la consulta corto vs candidato largo → penalizado", () => {
    expect(nameSimilarity("JUAN", "JUAN CARLOS PEREZ GOMEZ")).toBeLessThan(0.8);
  });
  it("vacío → 0", () => {
    expect(nameSimilarity("", "JUAN")).toBe(0);
  });
});

// --- Fixtures de entidades del dataset --------------------------------------
function ent(over: Partial<AmlEntity> & { entityId: string; name: string }): AmlEntity {
  return {
    aliases: [],
    lists: ["OFAC"],
    topics: ["sanction"],
    countries: [],
    birthDate: null,
    schema: "Person",
    ...over,
  };
}

const PUTIN = ent({
  entityId: "Q7747",
  name: "Vladimir Putin",
  aliases: ["Vladimir Vladimirovich Putin", "Putin Vladimir"],
  lists: ["OFAC", "EU"],
  countries: ["ru"],
  birthDate: "1952-10-07",
});
const NOISE = ent({ entityId: "X1", name: "Maria Gonzalez Lopez", countries: ["es"] });

describe("screenEntities — hit vs clear", () => {
  const input: AmlInput = { nombres: "Vladimir", apellidos: "Putin", nacionalidad: "RU" };

  it("nombre sancionado → potential_match con el hit arriba", () => {
    const r = screenEntities(input, [PUTIN, NOISE], { threshold: 0.85 });
    expect(r.decision).toBe("potential_match");
    expect(r.hits[0].entityId).toBe("Q7747");
    expect(r.topScore).toBeGreaterThanOrEqual(0.85);
    expect(r.passed).toBe(false);
  });

  it("nombre limpio → clear, sin hits sobre umbral", () => {
    const r = screenEntities(
      { nombres: "Silvio", apellidos: "Sotelo" },
      [PUTIN, NOISE],
      { threshold: 0.85 }
    );
    expect(r.decision).toBe("clear");
    expect(r.hits).toHaveLength(0);
    expect(r.passed).toBe(true);
  });

  it("match por alias cuenta en matchedFields", () => {
    const r = screenEntities(
      { nombres: "Vladimir Vladimirovich", apellidos: "Putin" },
      [PUTIN],
      { threshold: 0.85 }
    );
    expect(r.hits[0].matchedFields).toContain("alias");
  });

  it("boost por dob exacta sube el score y añade 'dob'", () => {
    const withDob = screenEntities(
      { nombres: "Vladimir", apellidos: "Putin", fechaNac: "1952-10-07" },
      [PUTIN],
      { threshold: 0.85 }
    );
    const noDob = screenEntities({ nombres: "Vladimir", apellidos: "Putin" }, [PUTIN], {
      threshold: 0.85,
    });
    expect(withDob.hits[0].matchedFields).toContain("dob");
    expect(withDob.topScore).toBeGreaterThanOrEqual(noDob.topScore);
  });

  it("boost por nacionalidad añade 'nationality'", () => {
    const r = screenEntities(input, [PUTIN], { threshold: 0.85 });
    expect(r.hits[0].matchedFields).toContain("nationality");
  });

  it("umbral configurable: bajarlo convierte clear en potential_match", () => {
    const lenient = screenEntities(
      { nombres: "Vladimer", apellidos: "Putn" },
      [PUTIN],
      { threshold: 0.6 }
    );
    expect(lenient.decision).toBe("potential_match");
  });

  it("query vacía → clear sin hits (no matchea todo)", () => {
    const r = screenEntities({ nombres: "", apellidos: "" }, [PUTIN]);
    expect(r.decision).toBe("clear");
    expect(r.hits).toHaveLength(0);
    expect(r.query.normalized).toBe("");
  });

  it("hits ordenados por score desc y acotados a maxHits", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      ent({ entityId: `P${i}`, name: "Vladimir Putin" })
    );
    const r = screenEntities(input, many, { maxHits: 5 });
    expect(r.hits.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < r.hits.length; i++) {
      expect(r.hits[i - 1].score).toBeGreaterThanOrEqual(r.hits[i].score);
    }
  });
});

describe("fullNameNorm", () => {
  it("concatena nombres+apellidos normalizados", () => {
    expect(fullNameNorm({ nombres: "José", apellidos: "Ñandú" })).toBe("JOSE NANDU");
  });
});

describe("screen — orquestación con provider in-memory", () => {
  function memProvider(entities: AmlEntity[], version = "2026-06-16"): AmlProvider {
    return {
      name: "mem-test",
      candidates: async () => entities,
      datasetVersion: async () => version,
    };
  }

  it("propaga provider + datasetVersion y produce hit", async () => {
    const r = await screen(
      { nombres: "Vladimir", apellidos: "Putin", nacionalidad: "RU" },
      memProvider([PUTIN, NOISE]),
      { threshold: 0.85 }
    );
    expect(r.provider).toBe("mem-test");
    expect(r.datasetVersion).toBe("2026-06-16");
    expect(r.decision).toBe("potential_match");
  });

  it("sin candidatos → clear", async () => {
    const r = await screen({ nombres: "Silvio", apellidos: "Sotelo" }, memProvider([]));
    expect(r.decision).toBe("clear");
    expect(r.hits).toHaveLength(0);
  });
});
