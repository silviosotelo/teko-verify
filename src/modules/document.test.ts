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
  crossFillFromMrz,
  detectTd1Lines,
  extractFrontDebug,
  parseMrz,
} from "./document";
import type { BarcodeData, ExtractedDocument, MrzData, OcrLine } from "../types";

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
 * OCR REAL de la cédula vieja (Dd6ZC-sV4AAhdNM.jpg) capturado del SIDECAR sobre
 * la variante `deskew-upscale` (1600px) — la MISMA que ejecuta el Inspector OCR
 * y el fallback ampliado de producción. (cx,cy,w,h) son las cajas REALES.
 *
 * POR QUÉ UPSCALE Y NO RAW: a escala raw (~610px) el gap rótulo→nombres es ~35px
 * y un `maxDy` fijo de 80px lo admitía → el fixture viejo (raw) pasaba en VERDE
 * mientras la cédula REAL en el Inspector (upscale) devolvía nombres VACÍOS. Acá
 * el gap rótulo→"JULIO CESAR" es ~93px (rótulo h≈56): con el `maxDy=80` fijo caía
 * FUERA de banda → identidad vacía. Este fixture REPRODUCE esa regresión; el fix
 * (banda escalada `max(80, h*1.8)`) la corrige. NO tocar estas coords a mano.
 */
const OLD_FRONT: OcrLine[] = [
  line("REPUBLICA DEL PARAGUAY", 0.999, 784, 159, 821, 78),
  line("Cédula de Identidad Civil", 0.993, 793, 217, 605, 64),
  line("APELLIDOS, NOMBRES", 0.983, 396, 304, 381, 56),
  line("FRANCO MOREL", 0.998, 384, 349, 362, 59),
  line("JULIO CESAR", 0.996, 354, 397, 302, 55),
  line("FECHA DE NACIMIENTO", 0.994, 399, 450, 395, 55),
  line("SEXO", 0.994, 854, 456, 102, 43),
  line("19-04-1975", 1.0, 320, 495, 232, 52),
  line("Masculino", 1.0, 913, 504, 219, 52),
  line("LUGAR DE NACIMIENTO", 0.998, 400, 558, 394, 50),
  line("SANTA ROSA MISIONES", 0.998, 460, 604, 513, 53),
  line("FECHA DE VENCIMENTO", 0.976, 406, 666, 409, 50),
  line("26-03-2028", 0.996, 317, 711, 231, 51),
  line("8354119", 1.0, 1250, 808, 229, 60),
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

  it("CI suelto (sin rótulo Nº) por fallback, CON ancla en el inspector", () => {
    expect(extracted.documento.numeroCedula).toBe("8354119");
    const dbg = extractFrontDebug(OLD_FRONT);
    // El CI suelto del formato viejo ahora se ancla (su propia caja como labelBox).
    expect(dbg.anchors.ci?.text).toBe("8354119");
    expect(dbg.anchors.ci?.box).toBeDefined();
  });

  it("FAIL-CLOSED: si el OCR pierde la línea de apellido, NO toma el lugar como nombre", () => {
    // Quitamos "FRANCO MOREL": queda sólo JULIO CESAR (dy≈93) y, mucho más abajo,
    // SANTA ROSA MISIONES (dy≈300). Con la banda escalada `max(80, h*1.8)`≈101 el
    // lugar SIGUE fuera de banda → sólo 1 candidato → identidad vacía, no errónea.
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
// FRENTE FORMATO NUEVO — cédula real SOTELO CAYO (CI 2962683). Fixture con las
// CAJAS OCR REALES (sidecar PaddleOCR, /admin/ocr-debug sobre el frente). Layout
// distinto al de SOTELO MACHUCA: FECHA DE VENCIMIENTO arriba-derecha, FECHA DE
// NACIMIENTO + SEXO abajo, LUGAR abajo, Nº abajo-izquierda FUSIONADO con dígitos.
//
// Bugs que cubre (todos vistos en el OCR real):
//   - etiqueta "FECHA" degradada a "FEGHA" → findDateLabel ya no exige "FECHA".
//   - "LUGAR DE NACIMIENTO" (score 1.0) NO debe ganarle a la etiqueta NAC.
//   - valor de vencimiento "16=12-2035" (separador `=` por OCR) debe parsear.
//   - Nº fusionado "N2962683" debe anclar (CI con caja en anchors).
// ===========================================================================

/** OcrLine desde una caja [x1,y1,x2,y2] axis-aligned (esquinas reales del sidecar). */
function lineBox(text: string, score: number, x1: number, y1: number, x2: number, y2: number): OcrLine {
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

/** OCR REAL del frente CAYO (cajas exactas capturadas del sidecar). */
const CAYO_FRONT: OcrLine[] = [
  lineBox("DEL", 1.0, 264, 70, 305, 92),
  lineBox("REPUBLISADELPARAGUAY", 0.88, 430, 67, 1318, 127),
  lineBox("Cedula de Identidad Sivil", 0.92, 434, 142, 924, 189),
  lineBox("APELLIDOS", 1.0, 527, 250, 674, 281),
  lineBox("FECHA DEVENCIMIENTO", 0.99, 1117, 248, 1426, 278),
  lineBox("SOTELO", 0.92, 534, 280, 736, 329),
  lineBox("16=12-2035", 0.98, 1162, 281, 1393, 326),
  lineBox("NOMBRES", 1.0, 523, 387, 660, 422),
  lineBox("DONANTE", 1.0, 1208, 386, 1341, 424),
  lineBox("CAYO", 0.96, 531, 416, 671, 467),
  lineBox("SI", 0.85, 1238, 414, 1292, 464),
  lineBox("FEGHA-DENACIMIENTOUCAC", 0.91, 523, 766, 864, 800),
  lineBox("SEXO", 0.99, 878, 766, 960, 801),
  lineBox("22-04-1969", 0.98, 527, 807, 768, 855),
  lineBox("MASCULINO", 1.0, 894, 807, 1184, 855),
  lineBox("N2962683", 0.97, 83, 846, 355, 908),
  lineBox("LUGAR DE NACIMIENTO", 1.0, 524, 863, 825, 897),
  lineBox("LUQUE", 1.0, 526, 906, 704, 958),
];

describe("document — frente FORMATO NUEVO (SOTELO CAYO, CI 2962683)", () => {
  const dbg = extractFrontDebug(CAYO_FRONT);
  const ex = dbg.extracted;

  it("apellidos / nombres", () => {
    expect(ex.titular.apellidos).toBe("SOTELO");
    expect(ex.titular.nombres).toBe("CAYO");
  });

  it("fecha de NACIMIENTO se ancla pese a 'FECHA'→'FEGHA' degradado (no la roba LUGAR)", () => {
    expect(ex.titular.fechaNacimiento).toBe("1969-04-22");
  });

  it("fecha de VENCIMIENTO parsea con separador OCR '=' (16=12-2035)", () => {
    expect(ex.documentoFisico.fechaVencimiento).toBe("2035-12-16");
  });

  it("sexo y lugar", () => {
    expect(ex.titular.sexo).toBe("MASCULINO");
    expect(ex.titular.lugarNacimiento.ciudad).toBe("LUQUE");
  });

  it("CI fusionado 'N2962683' → valor + ANCLA (box en anchors)", () => {
    expect(ex.documento.numeroCedula).toBe("2962683");
    expect(dbg.anchors.ci?.text).toBe("N2962683");
    expect(dbg.anchors.ci?.box).toBeDefined();
  });

  it("donante Sí", () => {
    expect(ex.titular.donante).toBe(true);
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

// ===========================================================================
// CROSS-FILL MRZ→FRENTE (crossFillFromMrz). Recupera campos VACÍOS del frente
// desde el MRZ del dorso, SÓLO si el CI del MRZ cruza con el del frente. Fail-
// closed: CI no coincidente ⇒ NO rellena (no se mezclan identidades).
// ===========================================================================

describe("document — cross-fill MRZ→frente (crossFillFromMrz)", () => {
  /** Frente CAYO con las FECHAS perdidas por el OCR (lo que el bug producía). */
  function cayoFrontMissingDates(): ExtractedDocument {
    return {
      documento: { pais: "REPUBLICA DEL PARAGUAY", tipo: "Cedula de Identidad Civil", numeroCedula: "2962683", specimen: false },
      titular: {
        apellidos: "SOTELO", nombres: "CAYO", fechaNacimiento: "", sexo: "MASCULINO",
        lugarNacimiento: { ciudad: "LUQUE", departamento: "" }, nacionalidad: "PARAGUAYA",
        estadoCivil: "", donante: true, firma: "Sin firma",
      },
      documentoFisico: { fechaEmision: "", fechaVencimiento: "", chip: true, codigoBarras: false },
      registroInterno: { ic: "", ubicacion: "" },
      autoridadEmisora: { nombre: "", cargo: "", dependencia: "" },
      mrz: { linea1: "", linea2: "", linea3: "", paisCodigo: "" },
    };
  }

  /** MRZ del dorso CAYO con CI 2962683 en optionalData y fechas válidas. */
  function cayoMrz(): MrzData {
    return {
      ...emptyMrz(),
      documentNumber: "AA1802315",
      optionalData: "2962683 0207",
      surname: "SOTELO", givenNames: "CAYO", nationality: "PRY",
      dateOfBirth: "1969-04-22", sex: "MASCULINO", expirationDate: "2035-12-16",
    };
  }

  it("CI coincidente: rellena fechas vacías del frente desde el MRZ y marca source=mrz", () => {
    const ex = crossFillFromMrz(cayoFrontMissingDates(), cayoMrz());
    expect(ex.titular.fechaNacimiento).toBe("1969-04-22");
    expect(ex.documentoFisico.fechaVencimiento).toBe("2035-12-16");
    expect(ex.fieldSources?.fechaNacimiento).toBe("mrz");
    expect(ex.fieldSources?.fechaVencimiento).toBe("mrz");
  });

  it("NUNCA pisa un valor del frente ya presente (monotónico)", () => {
    const front = cayoFrontMissingDates();
    front.titular.fechaNacimiento = "1969-04-22"; // ya leído del frente
    const mrz = { ...cayoMrz(), dateOfBirth: "1900-01-01" }; // MRZ distinto
    const ex = crossFillFromMrz(front, mrz);
    expect(ex.titular.fechaNacimiento).toBe("1969-04-22"); // se respeta el frente
    expect(ex.fieldSources?.fechaNacimiento).toBeUndefined(); // no marcado
  });

  it("CI NO coincidente: NO rellena nada (fail-closed, no mezcla identidades)", () => {
    const front = cayoFrontMissingDates();
    const mrz = { ...cayoMrz(), documentNumber: "ZZ0000000", optionalData: "9999999 0000" };
    const ex = crossFillFromMrz(front, mrz);
    expect(ex.titular.fechaNacimiento).toBe("");
    expect(ex.documentoFisico.fechaVencimiento).toBe("");
    expect(ex.fieldSources).toBeUndefined();
  });

  it("frente sin CI: NO puede cruzar ⇒ NO rellena", () => {
    const front = cayoFrontMissingDates();
    front.documento.numeroCedula = "";
    const ex = crossFillFromMrz(front, cayoMrz());
    expect(ex.titular.fechaNacimiento).toBe("");
  });

  it("MRZ vacío (dorso degradado): no-op", () => {
    const front = cayoFrontMissingDates();
    const ex = crossFillFromMrz(front, emptyMrz());
    expect(ex.titular.fechaNacimiento).toBe("");
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
