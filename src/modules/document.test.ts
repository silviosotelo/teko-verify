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
import { extractFrontDebug } from "./document";
import type { OcrLine } from "../types";

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
