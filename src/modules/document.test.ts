/**
 * Tests del extractor de cédula PY — FORMATO VIEJO (etiqueta combinada
 * "APELLIDOS, NOMBRES"). Fixture construido con las CAJAS OCR REALES capturadas
 * del sidecar PaddleOCR sobre la cédula vieja (Dd6ZC-sV4AAhdNM.jpg). No requiere
 * sidecar: ejercita `extractFrontDebug` (que comparte el anclaje con la
 * extracción de producción `extractFront`) sobre líneas OCR pre-grabadas.
 *
 * Verifica: detección de formato viejo + apellidos/nombres por las dos líneas
 * bajo la etiqueta combinada, fecha de vencimiento con label OCR-degradado
 * ("VENCIMENTO"), nacimiento, sexo, lugar y CI suelto sin rótulo "Nº".
 */
import { describe, it, expect } from "vitest";
import {
  crossCheck,
  detectTd1Lines,
  extractFrontDebug,
  parseMrz,
} from "./document";
import type { BarcodeData, ExtractedDocument, OcrLine } from "../types";

/** Construye una OcrLine a partir de centro+tamaño (caja axis-aligned). */
function line(text: string, score: number, cx: number, cy: number, w = 120, h = 18): OcrLine {
  const x1 = cx - w / 2;
  const x2 = cx + w / 2;
  const y1 = cy - h / 2;
  const y2 = cy + h / 2;
  return {
    text,
    score,
    box: [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ],
  };
}

/**
 * OCR REAL de la cédula vieja (sidecar PaddleOCR), líneas con su centro (cx,cy)
 * y score tal como se volcaron. Anchos aproximados a partir del rango [x1-x2].
 */
const OLD_FRONT: OcrLine[] = [
  line("REPUBLICA DEL PARAGUAY", 0.99, 298, 61, 313),
  line("Cédula de Identidad Civil", 0.97, 303, 83, 229),
  line("APELLIDOS. NOMBRES", 0.97, 151, 117, 145),
  line("FRANCO MOREL", 0.98, 145, 134, 136),
  line("JULIO CESAR", 0.98, 134, 152, 114),
  line("FECHA DE NACIMIENTO", 1.0, 151, 172, 150),
  line("SEXO", 0.99, 325, 175, 37),
  line("19-04-1975", 1.0, 122, 190, 87),
  line("Masculino", 1.0, 348, 193, 83),
  line("LUGAR DE NACIMIENTO", 0.98, 152, 213, 149),
  line("SANTA ROSA MISIONES", 0.99, 175, 231, 195),
  line("FECHA DE VENCIMENTO", 0.98, 154, 254, 155),
  line("26-03-2028", 1.0, 120, 272, 88),
  line("8354119", 1.0, 476, 308, 89),
];

describe("document — formato VIEJO (etiqueta combinada APELLIDOS, NOMBRES)", () => {
  const { extracted } = extractFrontDebug(OLD_FRONT);

  it("apellidos = primera línea bajo la etiqueta combinada", () => {
    expect(extracted.titular.apellidos).toBe("FRANCO MOREL");
  });

  it("nombres = segunda línea bajo la etiqueta combinada", () => {
    expect(extracted.titular.nombres).toBe("JULIO CESAR");
  });

  it("no confunde Masculino ni la ciudad con apellido/nombre", () => {
    expect(extracted.titular.apellidos).not.toBe("MASCULINO");
    expect(extracted.titular.nombres).not.toContain("SANTA");
  });

  it("fecha de nacimiento (guiones) → ISO", () => {
    expect(extracted.titular.fechaNacimiento).toBe("1975-04-19");
  });

  it("fecha de vencimiento con label OCR-degradado VENCIMENTO → ISO", () => {
    expect(extracted.documentoFisico.fechaVencimiento).toBe("2028-03-26");
  });

  it("sexo masculino", () => {
    expect(extracted.titular.sexo).toBe("MASCULINO");
  });

  it("lugar de nacimiento", () => {
    expect(extracted.titular.lugarNacimiento.ciudad).toBe("SANTA ROSA MISIONES");
  });

  it("CI suelto (sin rótulo Nº) por fallback", () => {
    expect(extracted.documento.numeroCedula).toBe("8354119");
  });

  it("FAIL-CLOSED: si el OCR pierde la línea de apellido, NO toma el lugar como nombre", () => {
    // Quitamos "FRANCO MOREL": queda sólo JULIO CESAR (dy≈35) y, más abajo,
    // SANTA ROSA MISIONES (dy≈114). La guarda de adyacencia/banda debe RECHAZAR
    // el par {JULIO CESAR, SANTA ROSA MISIONES} → identidad vacía, no errónea.
    const dropped = OLD_FRONT.filter((l) => l.text !== "FRANCO MOREL");
    const { extracted: ex } = extractFrontDebug(dropped);
    expect(ex.titular.nombres).not.toContain("SANTA");
    expect(ex.titular.apellidos).not.toBe("JULIO CESAR");
    // El lugar nunca debe poblar nombre/apellido.
    expect(ex.titular.nombres).not.toBe("SANTA ROSA MISIONES");
  });

  it("ancla apellidos/nombres a la etiqueta combinada (inspector OCR)", () => {
    const dbg = extractFrontDebug(OLD_FRONT);
    expect(dbg.anchors.apellidos?.text).toBe("FRANCO MOREL");
    expect(dbg.anchors.nombres?.text).toBe("JULIO CESAR");
    // Ambos anclados a la MISMA etiqueta combinada.
    expect(dbg.anchors.apellidos?.labelBox).toEqual(dbg.anchors.nombres?.labelBox);
  });
});

// ===========================================================================
// MRZ TD1 (dorso de la cédula PY). Vectores: el canónico ICAO 9303 (ANNA
// ERIKSSON) y un dorso PY REAL capturado del sidecar (SOTELO MACHUCA). Verifica
// parseo de campos, dígitos verificadores (7-3-1), normalización de sexo,
// reordenamiento de líneas desordenadas y el cruce frente↔MRZ con el CI en
// `optional1` (particularidad de la cédula PY).
// ===========================================================================

/**
 * Dorso PY REAL (sidecar PaddleOCR, sesión e027db99). `documentNumber` = SERIAL
 * "AA0014114"; el NÚMERO DE CÉDULA "4895448" va en `optional1`. Dígitos
 * verificadores TODOS válidos (la captura fue limpia). Líneas en orden TD1.
 */
const PY_MRZ_REAL = [
  "INPRYAA001411414895448<0207<<<",
  "9711138M3307124PRY<<<<<<<<<<<5",
  "SOTELO<MACHUCA<<SILVIO<ANDRES<",
];

/** Vector canónico TD1 de ICAO 9303 (ANNA MARIA ERIKSSON) — oráculo de campos. */
const ICAO_TD1 = [
  "I<UTOD231458907<<<<<<<<<<<<<<<",
  "7408122F1204159UTO<<<<<<<<<<<6",
  "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
];

describe("MRZ TD1 — parser sobre vectores reales/canónicos", () => {
  it("dorso PY real: parsea campos + check digits válidos", async () => {
    const mrz = await parseMrz(PY_MRZ_REAL);
    expect(mrz.surname).toBe("SOTELO MACHUCA");
    expect(mrz.givenNames).toBe("SILVIO ANDRES");
    expect(mrz.issuingCountry).toBe("PRY");
    expect(mrz.nationality).toBe("PRY");
    // En la cédula PY el documentNumber del MRZ es el SERIAL de la tarjeta.
    expect(mrz.documentNumber).toBe("AA0014114");
    // El CI real "4895448" vive en optional1.
    expect(mrz.optionalData).toContain("4895448");
    // Fechas YYMMDD → ISO con ventana de siglo (nac 1997, venc 2033).
    expect(mrz.dateOfBirth).toBe("1997-11-13");
    expect(mrz.expirationDate).toBe("2033-07-12");
    // Sexo normalizado al convenio del frente.
    expect(mrz.sex).toBe("MASCULINO");
    // Dígitos verificadores ICAO 7-3-1 — la captura limpia valida.
    expect(mrz.checkDigits.documentNumber).toBe(true);
    expect(mrz.checkDigits.dateOfBirth).toBe(true);
    expect(mrz.checkDigits.expirationDate).toBe(true);
    expect(mrz.checkDigits.composite).toBe(true);
    expect(mrz.valid).toBe(true);
  });

  it("vector canónico ICAO TD1 (ERIKSSON): campos + sexo femenino", async () => {
    const mrz = await parseMrz(ICAO_TD1);
    expect(mrz.surname).toBe("ERIKSSON");
    expect(mrz.givenNames).toBe("ANNA MARIA");
    expect(mrz.documentNumber).toBe("D23145890");
    expect(mrz.dateOfBirth).toBe("1974-08-12");
    expect(mrz.expirationDate).toBe("2012-04-15");
    // "female" del parser → "FEMENINO".
    expect(mrz.sex).toBe("FEMENINO");
    // Los dígitos verificadores propios (doc/nac/venc/composite) son válidos
    // aunque `valid` global sea false (UTO no es un país ISO real).
    expect(mrz.checkDigits.documentNumber).toBe(true);
    expect(mrz.checkDigits.dateOfBirth).toBe(true);
    expect(mrz.checkDigits.expirationDate).toBe(true);
    expect(mrz.checkDigits.composite).toBe(true);
  });

  it("reordena 3 líneas TD1 desordenadas a su estructura canónica", () => {
    // Mezcladas: nombres primero, luego línea 2, luego línea 1.
    const shuffled = [PY_MRZ_REAL[2], PY_MRZ_REAL[1], PY_MRZ_REAL[0]];
    const ordered = detectTd1Lines(shuffled);
    expect(ordered).toEqual(PY_MRZ_REAL);
  });

  it("detectTd1Lines descarta rótulos y ruido del dorso", () => {
    // Texto crudo del dorso real: etiquetas + datos + las 3 líneas MRZ.
    const texts = [
      "ESTADO CIVIL",
      "NACIONALIDAD",
      "PARAGUAYA",
      "AA0014114",
      ...PY_MRZ_REAL,
    ];
    const ordered = detectTd1Lines(texts);
    expect(ordered).toEqual(PY_MRZ_REAL);
  });

  it("líneas insuficientes → MrzData vacío (fail-closed, no inventa)", async () => {
    const mrz = await parseMrz(["INPRYAA001411414895448<0207<<<"]);
    expect(mrz.valid).toBe(false);
    expect(mrz.surname).toBe("");
    expect(mrz.rawLines.length).toBe(1);
  });
});

describe("MRZ TD1 — cruce frente↔MRZ (crossCheck, SOFT)", () => {
  /** Frente autoritativo de la misma persona (SOTELO MACHUCA, CI 4895448). */
  function frontExtracted(): ExtractedDocument {
    return {
      documento: { pais: "REPUBLICA DEL PARAGUAY", tipo: "Cedula de Identidad Civil", numeroCedula: "4895448", specimen: false },
      titular: {
        apellidos: "SOTELO MACHUCA",
        nombres: "SILVIO ANDRES",
        fechaNacimiento: "1997-11-13",
        sexo: "MASCULINO",
        lugarNacimiento: { ciudad: "ASUNCION", departamento: "" },
        nacionalidad: "PARAGUAYA",
        estadoCivil: "",
        donante: true,
        firma: "Sin firma",
      },
      documentoFisico: { fechaEmision: "", fechaVencimiento: "2033-07-12", chip: true, codigoBarras: false },
      registroInterno: { ic: "", ubicacion: "" },
      autoridadEmisora: { nombre: "", cargo: "", dependencia: "" },
      mrz: { linea1: "", linea2: "", linea3: "", paisCodigo: "" },
    };
  }
  const noBarcode: BarcodeData = { format: "", text: "" };

  it("CI del frente matchea el optional1 del MRZ (no el serial)", async () => {
    const mrz = await parseMrz(PY_MRZ_REAL);
    const auth = crossCheck(frontExtracted(), mrz, noBarcode);
    const numCheck = auth.checks.find((c) => c.name === "mrz_vs_front_number");
    expect(numCheck?.passed).toBe(true); // 4895448 ∈ optional1, aunque ≠ AA0014114
  });

  it("apellido y sexo del MRZ cruzan con el frente (SOFT)", async () => {
    const mrz = await parseMrz(PY_MRZ_REAL);
    const auth = crossCheck(frontExtracted(), mrz, noBarcode);
    expect(auth.checks.find((c) => c.name === "mrz_vs_front_name")?.passed).toBe(true);
    expect(auth.checks.find((c) => c.name === "mrz_vs_front_sex")?.passed).toBe(true);
  });

  it("MRZ ausente NO reprueba: consistent depende sólo de los campos impresos", () => {
    const auth = crossCheck(frontExtracted(), { ...emptyMrz() }, noBarcode);
    // Sin MRZ no se agregan los checks de cruce; los DUROS (impresos + no vencido) pasan.
    expect(auth.checks.find((c) => c.name === "mrz_vs_front_number")).toBeUndefined();
    expect(auth.consistent).toBe(true);
  });
});

/** MrzData vacío para tests (mismo shape que EMPTY_MRZ interno). */
function emptyMrz(): import("../types").MrzData {
  return {
    rawLines: [],
    documentType: "",
    issuingCountry: "",
    documentNumber: "",
    surname: "",
    givenNames: "",
    nationality: "",
    dateOfBirth: "",
    sex: "",
    expirationDate: "",
    checkDigits: { documentNumber: false, dateOfBirth: false, expirationDate: false, composite: false },
    valid: false,
  };
}
