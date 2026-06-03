// Regresión: corre el módulo `document` por el camino OCR REAL (PaddleOCR sidecar)
// sobre las imágenes limpias /app/cleanfront.jpg + /app/cleanback.jpg. Verifica que
// el código nuevo NO rompe los campos que ya andaban (nombres, CI, fechas, sexo,
// estado civil, nacionalidad, lugar) y que extrae bien con OCR genuino.
// Corre dentro del container: node /app/validate-real-ocr.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire("/app/");
const doc = require("/app/dist/modules/document.js");

const front = readFileSync("/app/cleanfront.jpg");
const back = readFileSync("/app/cleanback.jpg");

const fakeEngine = {
  async detect() { return []; }, // sin cara → cropDocFace devuelve null, no toca `extracted`
  bestFace() { return null; },
};

const res = await doc.documentModule.run(front, back, {
  ocr: new doc.PaddleOcrClient(),        // <-- OCR REAL (sidecar)
  mrzReader: new doc.OcrMrzReader(),     // <-- MRZ REAL
  barcodeReader: { async read() { return { format: "", text: "" }; } },
  engine: fakeEngine,
});
const e = res.extracted;
const got = {
  apellidos: e.titular.apellidos,
  nombres: e.titular.nombres,
  donante: e.titular.donante,
  fechaNacimiento: e.titular.fechaNacimiento,
  fechaVencimiento: e.documentoFisico.fechaVencimiento,
  fechaEmision: e.documentoFisico.fechaEmision,
  sexo: e.titular.sexo,
  numeroCedula: e.documento.numeroCedula,
  estadoCivil: e.titular.estadoCivil,
  nacionalidad: e.titular.nacionalidad,
  ciudad: e.titular.lugarNacimiento.ciudad,
  autoridadNombre: e.autoridadEmisora.nombre,
};
console.log("REAL-OCR EXTRACTED:", JSON.stringify(got, null, 2));

// En la imagen LIMPIA esperamos los valores correctos (no hay corrimiento de
// captura). Esto valida el camino OCR genuino con el código nuevo.
const expect = {
  apellidos: "SOTELO MACHUCA",
  nombres: "SILVIO ANDRES",
  fechaNacimiento: "1997-11-13",
  fechaVencimiento: "2033-07-12",
  fechaEmision: "2023-07-12",
  sexo: "MASCULINO",
  numeroCedula: "4895448",
  nacionalidad: "PARAGUAYA",
  ciudad: "ASUNCION",
};
let ok = true;
for (const [k, v] of Object.entries(expect)) {
  const pass = got[k] === v;
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"} ${k}: got=${JSON.stringify(got[k])} want=${JSON.stringify(v)}`);
}
console.log(ok ? "\nREAL-OCR ALL PASS" : "\nREAL-OCR SOME FAIL");
process.exit(ok ? 0 : 1);
