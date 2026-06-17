/**
 * Tests del módulo PROOF OF ADDRESS (P1 #4) — comprobante de domicilio.
 *
 * Cubren la lógica PURA sobre LÍNEAS OCR de ejemplo (sin imágenes ni sidecar):
 *   - extractProofOfAddress: parseo de titular / domicilio / fecha / emisor;
 *   - evaluateProofOfAddress: name-match (fuzzy), recency (maxAgeMonths), hasAddress;
 *   - runProofOfAddress: orquestación con un OcrClient inyectado (fail-closed).
 * Y el ruteo a revisión por workflow (shouldRouteToReview con onFail).
 */
import { describe, it, expect } from "vitest";
import {
  extractProofOfAddress,
  evaluateProofOfAddress,
  runProofOfAddress,
} from "./proofOfAddress";
import type { OcrClient, OcrResult } from "./document";
import { shouldRouteToReview } from "../lib/workflow";
import type { WorkflowDefinition } from "../types";

/** Reloj fijo para tests deterministas de recency. */
const NOW = new Date("2026-06-17T12:00:00.000Z");

/** Líneas OCR de una factura ANDE de ejemplo (formato libre, titular SOTELO). */
const ANDE_BILL = [
  "ANDE - Administración Nacional de Electricidad",
  "Factura de energía eléctrica",
  "Titular: SILVIO SOTELO",
  "Domicilio: Avenida Mariscal López 1234",
  "Barrio Villa Morra - Asunción",
  "Periodo: Mayo 2026",
  "Fecha de emisión: 02/06/2026",
  "Total a pagar: Gs. 185.000",
  "RUC: 1234567-8",
];

describe("extractProofOfAddress — parseo de campos", () => {
  it("extrae titular tras la etiqueta 'Titular:'", () => {
    const ex = extractProofOfAddress(ANDE_BILL, { now: NOW });
    expect(ex.holderName.toUpperCase()).toContain("SILVIO SOTELO");
  });

  it("extrae líneas de domicilio (calle/barrio) y descarta total/RUC/fecha", () => {
    const ex = extractProofOfAddress(ANDE_BILL, { now: NOW });
    const joined = ex.address.toUpperCase();
    expect(joined).toContain("MARISCAL");
    expect(joined).toContain("1234");
    expect(ex.addressLines.length).toBeGreaterThanOrEqual(1);
    // El total (Gs.) y el RUC no deben colarse como domicilio.
    expect(joined).not.toContain("TOTAL");
    expect(joined).not.toContain("RUC");
  });

  it("elige la fecha MÁS RECIENTE plausible y la normaliza a ISO", () => {
    const ex = extractProofOfAddress(ANDE_BILL, { now: NOW });
    expect(ex.documentDate).toBe("2026-06-02");
  });

  it("detecta el emisor (ANDE)", () => {
    const ex = extractProofOfAddress(ANDE_BILL, { now: NOW });
    expect(ex.issuer).toBe("ANDE");
  });

  it("parsea fecha en formato 'DD de MES de YYYY'", () => {
    const ex = extractProofOfAddress(
      ["Cliente: JUAN PEREZ", "Calle Palma 555 Centro", "Emitido el 15 de Mayo de 2026"],
      { now: NOW }
    );
    expect(ex.documentDate).toBe("2026-05-15");
  });

  it("no inventa fecha cuando no hay ninguna plausible", () => {
    const ex = extractProofOfAddress(["NOMBRE: ANA GOMEZ", "Avenida 1000"], { now: NOW });
    expect(ex.documentDate).toBe("");
  });
});

/**
 * Extracto Banco Continental real (sesión field-test 986a770c). El titular figura en
 * formato "APELLIDO, NOMBRE" arriba y abajo; "INTERNACIONAL CASI BILBAO" es la línea de
 * domicilio de la sucursal. Antes del fix, la coma en "MACHUCA," rompía el parseo del
 * nombre y se elegía "INTERNACIONAL CASI BILBAO" como titular (nameSim 0.60 → fail).
 */
const CONTINENTAL_STMT = [
  "SOTELO MACHUCA, SILVIO ANDRES",
  "020-11-057425/6",
  "continental",
  "INTERNACIONAL CASI BILBAO",
  "CIUDAD",
  "CENTRAL/ASUNCION",
  "Actual 22/05/26 05/06/26",
  "SILVIO A. SOTELO M.",
  "Cuenta Bancaria 0103179724 SOTELO MACHUCA, SILVIO ANDRES",
  "Página 1 FINAL",
];

describe("extractProofOfAddress — formato bancario 'APELLIDO, NOMBRE' (986a770c)", () => {
  it("extrae el titular pese a la coma (no la línea de domicilio de la sucursal)", () => {
    const ex = extractProofOfAddress(CONTINENTAL_STMT, { now: NOW });
    const c = ex.holderName.toUpperCase();
    expect(c).toContain("SOTELO");
    expect(c).toContain("MACHUCA");
    expect(c).toContain("SILVIO");
    expect(c).not.toContain("INTERNACIONAL"); // ya no se confunde con el domicilio
  });

  it("name-match contra la identidad verificada → pasa (antes: 0.60 fail)", () => {
    const ex = extractProofOfAddress(CONTINENTAL_STMT, { now: NOW });
    const ev = evaluateProofOfAddress(ex, {
      identityName: "SILVIO ANDRES SOTELO MACHUCA",
      now: NOW,
    });
    expect(ev.nameMatch).toBe(true);
    expect(ev.nameSimilarity).toBeGreaterThan(0.9);
    expect(ev.passed).toBe(true);
  });
});

describe("evaluateProofOfAddress — validaciones", () => {
  it("name-match contra SOTELO pasa con typo/orden y reciente + domicilio → passed", () => {
    const ex = extractProofOfAddress(ANDE_BILL, { now: NOW });
    const r = evaluateProofOfAddress(ex, {
      identityName: "SOTELO SILVIO",
      now: NOW,
      maxAgeMonths: 3,
    });
    expect(r.nameMatch).toBe(true);
    expect(r.recent).toBe(true);
    expect(r.hasAddress).toBe(true);
    expect(r.passed).toBe(true);
  });

  it("nombre que NO coincide → nameMatch=false y passed=false (si se exige)", () => {
    const ex = extractProofOfAddress(ANDE_BILL, { now: NOW });
    const r = evaluateProofOfAddress(ex, {
      identityName: "MARIA RODRIGUEZ",
      now: NOW,
      requireNameMatch: true,
    });
    expect(r.nameMatch).toBe(false);
    expect(r.passed).toBe(false);
  });

  it("requireNameMatch=false ignora el nombre (pasa con recent + address)", () => {
    const ex = extractProofOfAddress(ANDE_BILL, { now: NOW });
    const r = evaluateProofOfAddress(ex, {
      identityName: "MARIA RODRIGUEZ",
      now: NOW,
      requireNameMatch: false,
    });
    expect(r.passed).toBe(true);
  });

  it("documento viejo (> maxAgeMonths) → recent=false y passed=false", () => {
    const ex = extractProofOfAddress(
      ["Titular: SILVIO SOTELO", "Calle Palma 100 Asuncion", "Fecha: 02/01/2026"],
      { now: NOW }
    );
    const r = evaluateProofOfAddress(ex, {
      identityName: "SILVIO SOTELO",
      now: NOW,
      maxAgeMonths: 3,
    });
    expect(r.recent).toBe(false);
    expect(r.passed).toBe(false);
  });

  it("sin domicilio → hasAddress=false y passed=false", () => {
    const r = evaluateProofOfAddress(
      { holderName: "SILVIO SOTELO", addressLines: [], address: "", documentDate: "2026-06-01", issuer: "" },
      { identityName: "SILVIO SOTELO", now: NOW }
    );
    expect(r.hasAddress).toBe(false);
    expect(r.passed).toBe(false);
  });
});

describe("runProofOfAddress — orquestación + fail-closed", () => {
  function ocrOf(text: string): OcrClient {
    return {
      recognize: async (): Promise<OcrResult> => ({ rawText: text, confidence: 0.9, lines: [] }),
    };
  }

  it("OCR ok → extrae y valida contra la identidad", async () => {
    const img = Buffer.from("ffd8ffphoto", "utf8"); // no se decodifica (OCR inyectado)
    const r = await runProofOfAddress(img, {
      ocr: ocrOf(ANDE_BILL.join("\n")),
      identityName: "SILVIO SOTELO",
      now: NOW,
    });
    expect(r.passed).toBe(true);
    expect(r.issuer).toBe("ANDE");
    expect(r.documentDate).toBe("2026-06-02");
  });

  it("OCR vacío → fail-closed (passed=false + error)", async () => {
    const r = await runProofOfAddress(Buffer.from("x"), {
      ocr: ocrOf("   "),
      identityName: "SILVIO SOTELO",
      now: NOW,
    });
    expect(r.passed).toBe(false);
    expect(r.error).toBe("ocr_empty");
  });

  it("OCR que lanza → fail-closed (passed=false + error)", async () => {
    const ocr: OcrClient = {
      recognize: async () => {
        throw new Error("sidecar down");
      },
    };
    const r = await runProofOfAddress(Buffer.from("x"), {
      ocr,
      identityName: "SILVIO SOTELO",
      now: NOW,
    });
    expect(r.passed).toBe(false);
    expect(r.error).toContain("sidecar down");
  });
});

describe("shouldRouteToReview — ruteo por comprobante de domicilio", () => {
  const def: WorkflowDefinition = {
    document: { required: true },
    proofOfAddress: { required: true, onFail: "review" },
    review: { mode: "auto" },
  };

  it("onFail='review' + check fallido → revisión humana", () => {
    expect(shouldRouteToReview(def, { proofOfAddressFailed: true })).toBe(true);
  });

  it("onFail='review' + check OK → no rutea", () => {
    expect(shouldRouteToReview(def, { proofOfAddressFailed: false })).toBe(false);
  });

  it("onFail='flag' (default) + check fallido → NO rutea (sólo persiste)", () => {
    const flagDef: WorkflowDefinition = {
      document: { required: true },
      proofOfAddress: { required: true, onFail: "flag" },
      review: { mode: "auto" },
    };
    expect(shouldRouteToReview(flagDef, { proofOfAddressFailed: true })).toBe(false);
  });
});
