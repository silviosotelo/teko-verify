/**
 * Tests del módulo Face Search 1:N (P1 #2) — dedup/anti-fraude + KYC reusable.
 *
 * Cubren la lógica PURA (`searchFaces`): top-K por coseno, filtrado por umbral,
 * señal de duplicado (CI distinto) vs returning user (mismo CI), exclusión de la
 * sesión propia y fail-safe; la orquestación `runFaceSearch` contra un provider
 * in-memory; y el ruteo a revisión (`shouldRouteToReview`) por duplicado.
 */
import { describe, it, expect } from "vitest";
import {
  searchFaces,
  runFaceSearch,
  type GalleryEntry,
  type FaceGalleryProvider,
} from "./faceSearch";
import { shouldRouteToReview } from "../lib/workflow";
import type { WorkflowDefinition } from "../types";

/** Helper: vector 4D (la dim no importa, sólo que query y galería coincidan). */
const v = (...xs: number[]) => Float32Array.from(xs);

/** Galería base: SOTELO (mismo CI esperado) + dos terceros. */
function gallery(): GalleryEntry[] {
  return [
    { identityId: "id-sotelo", sessionId: "s-sotelo", ci: "1234567", name: "SOTELO", embedding: v(1, 0, 0, 0) },
    { identityId: "id-near", sessionId: "s-near", ci: "1234567", name: "SOTELO (2da captura)", embedding: v(0.95, 0.05, 0, 0) },
    { identityId: "id-far", sessionId: "s-far", ci: "9999999", name: "OTRO", embedding: v(0, 1, 0, 0) },
  ];
}

describe("searchFaces — top-K + umbral", () => {
  it("devuelve matches sobre el umbral ordenados por coseno desc y respeta topK", () => {
    const r = searchFaces(v(1, 0, 0, 0), gallery(), {
      threshold: 0.55,
      topK: 1,
      currentCi: "1234567",
      currentSessionId: "s-current",
    });
    // El idéntico (cos 1) primero; el ortogonal (cos 0) queda bajo umbral.
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].identityId).toBe("id-sotelo");
    expect(r.matches[0].cosine).toBeCloseTo(1, 3);
    expect(r.topCosine).toBeCloseTo(1, 3);
    // gallerySize cuenta los comparados (3, ninguno es la sesión actual).
    expect(r.gallerySize).toBe(3);
  });

  it("filtra los que están por debajo del umbral (no hay falsos positivos)", () => {
    const r = searchFaces(v(0, 1, 0, 0), gallery(), {
      threshold: 0.55,
      currentCi: "5555555",
      currentSessionId: "s-current",
    });
    // Sólo id-far (cos 1) está sobre umbral; los SOTELO (cos ~0) quedan fuera.
    expect(r.matches.map((m) => m.identityId)).toEqual(["id-far"]);
  });
});

describe("searchFaces — señales dedup vs returning user", () => {
  it("MISMO CI ⇒ returning user (KYC reusable), NO duplicado, passed=true", () => {
    const r = searchFaces(v(1, 0, 0, 0), gallery(), {
      threshold: 0.55,
      currentCi: "1234567", // el CI de SOTELO
      currentSessionId: "s-current",
    });
    expect(r.returningUser).toBe(true);
    expect(r.duplicateSuspected).toBe(false);
    expect(r.passed).toBe(true);
    expect(r.matches.every((m) => !m.ciMismatch)).toBe(true);
  });

  it("CI DISTINTO ⇒ duplicado/fraude (misma cara, otra identidad), passed=false", () => {
    // La misma cara de SOTELO, pero la sesión actual declara OTRO CI.
    const r = searchFaces(v(1, 0, 0, 0), gallery(), {
      threshold: 0.55,
      currentCi: "7777777", // CI distinto al de la galería SOTELO
      currentSessionId: "s-current",
    });
    expect(r.duplicateSuspected).toBe(true);
    expect(r.returningUser).toBe(false);
    expect(r.passed).toBe(false);
    expect(r.matches.every((m) => m.ciMismatch)).toBe(true);
  });

  it("sin CI en la consulta no afirma duplicado (conservador)", () => {
    const r = searchFaces(v(1, 0, 0, 0), gallery(), {
      threshold: 0.55,
      currentCi: "",
      currentSessionId: "s-current",
    });
    expect(r.duplicateSuspected).toBe(false);
    expect(r.matches.every((m) => !m.ciMismatch)).toBe(true);
  });
});

describe("searchFaces — exclusiones", () => {
  it("excluye la sesión propia (no se matchea a sí misma)", () => {
    // La sesión actual ES la de SOTELO: su propia identidad no debe aparecer.
    const r = searchFaces(v(1, 0, 0, 0), gallery(), {
      threshold: 0.55,
      currentCi: "1234567",
      currentSessionId: "s-sotelo",
    });
    expect(r.matches.find((m) => m.sessionId === "s-sotelo")).toBeUndefined();
    expect(r.gallerySize).toBe(2); // sólo id-near + id-far comparados
  });

  it("ignora embeddings de dimensión distinta (purgados/tombstone)", () => {
    const g: GalleryEntry[] = [
      { identityId: "id-tomb", sessionId: "s-tomb", ci: "1", name: "PURGADO", embedding: v() },
      ...gallery(),
    ];
    const r = searchFaces(v(1, 0, 0, 0), g, { threshold: 0.55, currentCi: "1234567" });
    expect(r.matches.find((m) => m.identityId === "id-tomb")).toBeUndefined();
    expect(r.gallerySize).toBe(3); // el tombstone no se cuenta como comparado
  });
});

describe("runFaceSearch — orquestación con provider", () => {
  it("delega la galería al provider (excluyendo la sesión actual) y corre el matching", async () => {
    let askedExclude: string | undefined;
    const provider: FaceGalleryProvider = {
      async gallery(_tenantId, excludeSessionId) {
        askedExclude = excludeSessionId;
        return gallery().filter((g) => g.sessionId !== excludeSessionId);
      },
    };
    const r = await runFaceSearch(
      { query: v(1, 0, 0, 0), tenantId: "t1", currentSessionId: "s-sotelo", currentCi: "1234567" },
      provider,
      { threshold: 0.55 }
    );
    expect(askedExclude).toBe("s-sotelo");
    // s-sotelo excluida por el provider; queda id-near (mismo CI) → returning user.
    expect(r.matches.find((m) => m.sessionId === "s-sotelo")).toBeUndefined();
    expect(r.returningUser).toBe(true);
    expect(r.duplicateSuspected).toBe(false);
  });
});

describe("shouldRouteToReview — ruteo por face search (P1 #2)", () => {
  const wf = (onDuplicate: "review" | "flag"): WorkflowDefinition => ({
    document: { required: true },
    match: { required: true },
    faceSearch: { required: true, onDuplicate },
    review: { mode: "auto" },
  });

  it("duplicado + onDuplicate:review ⇒ va a in_review (aunque review.mode sea auto)", () => {
    expect(shouldRouteToReview(wf("review"), { faceSearchDuplicate: true })).toBe(true);
  });

  it("duplicado + onDuplicate:flag ⇒ NO rutea (sólo se persiste el hallazgo)", () => {
    expect(shouldRouteToReview(wf("flag"), { faceSearchDuplicate: true })).toBe(false);
  });

  it("returning user (sin duplicado) ⇒ NO rutea aunque onDuplicate:review", () => {
    expect(shouldRouteToReview(wf("review"), { faceSearchDuplicate: false })).toBe(false);
  });
});
