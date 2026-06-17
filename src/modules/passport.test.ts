/**
 * Tests del extractor de PASAPORTE (ICAO 9303, MRZ TD3) — multi-documento P1 #3.
 *
 * Cubre:
 *   1) parseMrz() sobre el MRZ TD3 ESPECIMEN de ICAO (2×44) → campos + los 4 check
 *      digits válidos (documentNumber/dateOfBirth/expirationDate/composite).
 *   2) extractPassport() → mapeo MRZ → ExtractedDocument (nº, país emisor,
 *      nombres/apellidos, nacionalidad DEL MRZ, fechas, sexo).
 *   3) detectTd3Lines() → detecta y ordena las 2 líneas TD3 desde texto OCR ruidoso
 *      y NO confunde un frente de cédula (sin MRZ) con TD3.
 *   4) Ruteo por documentType en DocumentModule.run(): "passport" → camino pasaporte;
 *      default/"ci_py" → camino cédula PY (no-regresión).
 *
 * El MRZ usado es el ESPECIMEN público de pasaporte alemán (ERIKA MUSTERMANN), el
 * mismo que documenta la librería `mrz`. País emisor/nacionalidad reales ("D") →
 * la librería lo valida (valid=true) y los 4 check digits ICAO cierran.
 */
import { describe, it, expect } from "vitest";
import {
  parseMrz,
  detectTd3Lines,
  extractPassport,
  DocumentModule,
  type DocumentDeps,
  type OcrClient,
  type OcrResult,
  type MrzReader,
  type BarcodeReader,
} from "./document";
import type { Engine } from "../engine";

// MRZ TD3 especimen (2×44) — pasaporte alemán ERIKA MUSTERMANN. Check digits válidos.
const TD3_L1 = "P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<";
const TD3_L2 = "C01X00T478D<<6408125F2702283<<<<<<<<<<<<<<<4";

describe("parseMrz — TD3 (pasaporte)", () => {
  it("parsea el especimen ICAO con los 4 check digits válidos", async () => {
    const mrz = await parseMrz([TD3_L1, TD3_L2]);
    expect(mrz.documentType).toBe("P");
    expect(mrz.issuingCountry).toBe("D");
    expect(mrz.surname).toBe("MUSTERMANN");
    expect(mrz.givenNames).toContain("ERIKA");
    expect(mrz.documentNumber).toBe("C01X00T47");
    expect(mrz.nationality).toBe("D");
    expect(mrz.dateOfBirth).toBe("1964-08-12");
    expect(mrz.sex).toBe("FEMENINO");
    expect(mrz.expirationDate).toBe("2027-02-28");
    // Los 4 dígitos verificadores ICAO deben validar (composite ← finalCheckDigit en TD3).
    expect(mrz.checkDigits.documentNumber).toBe(true);
    expect(mrz.checkDigits.dateOfBirth).toBe(true);
    expect(mrz.checkDigits.expirationDate).toBe(true);
    expect(mrz.checkDigits.composite).toBe(true);
    expect(mrz.valid).toBe(true);
  });

  it("detecta un check digit corrupto (nº de documento alterado)", async () => {
    // Alteramos el dígito verificador del nº de documento (posición 10 de la línea 2:
    // "8" → "0"). Debe quedar inválido.
    const badL2 = "C01X00T470D<<6408125F2702283<<<<<<<<<<<<<<<4";
    const mrz = await parseMrz([TD3_L1, badL2]);
    expect(mrz.checkDigits.documentNumber).toBe(false);
  });
});

describe("extractPassport — mapeo MRZ → ExtractedDocument", () => {
  it("mapea todos los campos desde el MRZ TD3 (nacionalidad del MRZ, no PY)", async () => {
    const mrz = await parseMrz([TD3_L1, TD3_L2]);
    const e = extractPassport(mrz);
    expect(e.documento.tipo).toBe("PASAPORTE");
    expect(e.documento.pais).toBe("D");
    expect(e.documento.numeroCedula).toBe("C01X00T47");
    expect(e.titular.apellidos).toBe("MUSTERMANN");
    expect(e.titular.nombres).toContain("ERIKA");
    expect(e.titular.nacionalidad).toBe("D");
    expect(e.titular.fechaNacimiento).toBe("1964-08-12");
    expect(e.titular.sexo).toBe("FEMENINO");
    expect(e.documentoFisico.fechaVencimiento).toBe("2027-02-28");
    expect(e.mrz.linea1).toBe(TD3_L1);
    expect(e.mrz.linea2).toBe(TD3_L2);
    expect(e.mrz.linea3).toBe("");
    expect(e.mrz.paisCodigo).toBe("D");
  });
});

describe("detectTd3Lines", () => {
  it("extrae y ordena las 2 líneas TD3 desde texto OCR ruidoso", () => {
    const td3 = detectTd3Lines([
      "PASSPORT",
      "Type / Type  P",
      TD3_L2, // dígito-pesada
      "Surname MUSTERMANN",
      TD3_L1, // letra-pesada (nombres)
    ]);
    expect(td3).toHaveLength(2);
    // orderTd3: línea de nombres (letra-pesada) primero.
    expect(td3[0]).toBe(TD3_L1);
    expect(td3[1]).toBe(TD3_L2);
  });

  it("NO confunde un frente sin franja MRZ con TD3", () => {
    const td3 = detectTd3Lines([
      "REPUBLICA DEL PARAGUAY",
      "Cedula de Identidad Civil",
      "FRANCO MOREL",
      "JULIO CESAR",
    ]);
    expect(td3.length).toBeLessThan(2);
  });
});

// --- Ruteo por documentType en DocumentModule.run() ------------------------- //

/** OCR mock: devuelve las líneas dadas como cajas OCR (box dummy). */
function ocrStub(lines: string[]): OcrClient {
  const result: OcrResult = {
    rawText: lines.join("\n"),
    confidence: 0.9,
    lines: lines.map((text) => ({
      text,
      score: 0.9,
      box: [
        [0, 0],
        [100, 0],
        [100, 10],
        [0, 10],
      ],
    })),
  };
  return { recognize: async () => result };
}

/** Engine mock: sin caras (cropDocFace → null) — evita sharp/modelos en el test. */
const engineStub = {
  detect: async () => [],
  bestFace: () => null,
} as unknown as Engine;

const mrzReaderStub: MrzReader = { readLines: async () => [] };
const barcodeReaderStub: BarcodeReader = {
  read: async () => ({ format: "", text: "" }),
};

function depsWith(ocr: OcrClient): DocumentDeps {
  return {
    ocr,
    mrzReader: mrzReaderStub,
    barcodeReader: barcodeReaderStub,
    engine: engineStub,
  };
}

describe("DocumentModule.run — ruteo por documentType", () => {
  const mod = new DocumentModule();
  const FAKE = Buffer.from("fake-image");

  it("documentType='passport' → camino pasaporte (extrae MRZ TD3)", async () => {
    const res = await mod.run(FAKE, FAKE, depsWith(ocrStub([TD3_L1, TD3_L2])), "passport");
    expect(res.documentType).toBe("passport");
    expect(res.extracted.documento.tipo).toBe("PASAPORTE");
    expect(res.extracted.documento.numeroCedula).toBe("C01X00T47");
    expect(res.extracted.titular.apellidos).toBe("MUSTERMANN");
    expect(res.mrz.checkDigits.documentNumber).toBe(true);
  });

  it("default (sin documentType) → camino cédula PY (no-regresión)", async () => {
    const res = await mod.run(FAKE, FAKE, depsWith(ocrStub([])));
    expect(res.documentType).toBe("ci_py");
    // No debe haberse construido un ExtractedDocument de pasaporte.
    expect(res.extracted.documento.tipo).not.toBe("PASAPORTE");
  });

  it("documentType='ci_py' explícito → mismo camino cédula PY", async () => {
    const res = await mod.run(FAKE, FAKE, depsWith(ocrStub([])), "ci_py");
    expect(res.documentType).toBe("ci_py");
  });
});
