// Validación SINTÉTICA de la extracción del frente/dorso (document.ts).
//
// CONTEXTO: la captura ORIGINAL del usuario se perdió (bug de mount:
// TEKO_EVIDENCE_DIR=/data/teko/evidence pero el volumen monta en /data/evidence,
// así que la evidencia se escribió en la capa efímera del container y desapareció
// al reconstruirlo). No se puede re-correr OCR sobre la imagen real.
//
// Sustituto fiel: usamos el seam de inyección de `documentModule.run` con un
// OcrClient FALSO cuyas `lines` (con cajas) provienen del dump OCR REAL de la
// imagen limpia (/tmp/front.jpg, /tmp/back.jpg) MÁS ruido de watermark spliceado
// DEBAJO de las etiquetas y MÁS CERCA en Y que el valor real — reproduciendo el
// fallo observado (apellidos="DEL", donante=false, fechaEmision="").
//
// Corre dentro del container: node /app/validate-extract.mjs
import { createRequire } from "module";
const require = createRequire("/app/");
const doc = require("/app/dist/modules/document.js");

// Caja a partir de centro+tamaño (esquinas [[x1,y1]..]).
const box = (cx, cy, w = 220, h = 40) => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2],
];
const L = (text, cx, cy, score = 0.98, w = 220, h = 40) => ({
  text,
  score,
  box: box(cx, cy, w, h),
});

// === FRENTE: cajas REALES del dump de /tmp/front.jpg + RUIDO de watermark
// spliceado DEBAJO de las etiquetas, MÁS CERCA en Y que el valor real. ===
const frontLines = [
  L("DEL", 541, 139, 1), // watermark arriba (excluido por cy>label)
  L("REPUJBLIGADELPARAGUAY", 1637, 172, 0.97, 600),
  L("Cedula", 955, 297, 0.97),
  L("de", 1147, 298, 1),
  L("Identidad Civil", 1474, 297, 0.99, 360),
  L("FECHA DE VENCIMIENTO", 2382, 476, 0.99, 420),
  L("APELLIDOS", 1138, 483, 1, 300),
  // ---- RUIDO DEL WATERMARK debajo de APELLIDOS y MÁS CERCA que el valor real:
  L("DEL", 1180, 515, 0.5, 90), // <-- el culpable: "REPÚBLICA DEL PARAGUAY"
  L("PARA", 1260, 540, 0.4, 110), // <-- fragmento guilloche
  L("12-07-2033", 2394, 561, 0.99),
  L("SOTELO MACHUCA", 1408, 569, 0.96, 360), // valor REAL (más lejos en Y)
  L("DONANTE", 2386, 734, 1, 200),
  L("NOMBRES", 1124, 743, 1, 220),
  // ---- RUIDO debajo de DONANTE (valor vecino de NOMBRES se interpone en Y):
  L("SILVIO ANDRES", 1340, 822, 0.98, 280), // valor de NOMBRES (no es SI/NO)
  L("SI", 2375, 810, 0.97, 60), // valor REAL de DONANTE
  L("1997", 2336, 1302, 1),
  L("FECHA DE NACIMIENTO", 1279, 1451, 0.99, 420),
  L("CAL", 1598, 1446, 0.87, 100), // ruido cerca de SEXO
  L("SEXO", 1738, 1441, 1, 120),
  L("13-11-1997", 1222, 1536, 0.99),
  L("MASCULINO", 1946, 1524, 1, 260),
  L("LUGAR DE NACIMIENTO", 1280, 1634, 1, 420),
  L("No", 204, 1642, 0.72, 60),
  L("4895448", 465, 1643, 1, 200),
  L("ASUNCION", 1241, 1719, 0.99, 240),
];

// === DORSO: cajas REALES del dump de /tmp/back.jpg + ruido debajo de EMISIÓN ===
const backLines = [
  L("ESTADO CIVIL", 591, 165, 0.99, 300),
  L("FECHA DE EMISIÓN", 1670, 166, 0.98, 360),
  L("SO", 607, 261, 0.81, 80),
  L("ruido12", 1680, 230, 0.3, 120), // ruido entre etiqueta y fecha
  L("12-07-2023", 1686, 263, 1, 240), // fecha REAL de emisión
  L("NACIONALIDAD", 610, 354, 1, 300),
  L("PARAGUAYA", 741, 438, 0.99, 240),
  L("José Vega", 2238, 493, 1, 200),
  L("Comisario Principal McP", 2484, 571, 0.98, 420),
  L("Jefe Dpto Identificaciones", 2510, 653, 0.99, 460),
  L("019-14.111997A144-000-000", 1538, 750, 0.91, 600),
  L("UBICACIÓN", 1105, 862, 0.99, 240),
  L("PN-11-21-001/448", 1350, 949, 0.99, 360),
  L("AA0014114", 2410, 1112, 1, 240),
];

const fakeOcr = {
  async recognize(image) {
    // El módulo OCR-ea front y back con la misma instancia; distinguimos por
    // tamaño del buffer marcador.
    const tag = image.toString("utf8", 0, 5);
    if (tag === "BACK_") return { rawText: backLines.map((l) => l.text).join("\n"), confidence: 0.9, lines: backLines };
    return { rawText: frontLines.map((l) => l.text).join("\n"), confidence: 0.9, lines: frontLines };
  },
};

// MRZ reader falso: devuelve las 2 líneas TD1 reales del dorso (de la sesión real).
const fakeMrz = {
  async readLines() {
    return ["IDPRYAA001411414895448<0207<2Z", "9711138M3307124PRY<<<<<5", "SOTELO<MACHUCA<<SILVIO<ANDRES"];
  },
};
const fakeBarcode = { async read() { return { format: "", text: "" }; } };
// Engine falso: devuelve una cara para que cropDocFace no rompa (no se evalúa aquí).
const fakeEngine = {
  async detect() { return [{ bbox: [100, 100, 300, 400], score: 0.99, kps: [] }]; },
  bestFace(faces) { return faces[0] ?? null; },
};

const front = Buffer.from("FRONT_marker_image_data_padding_padding_padding");
const back = Buffer.from("BACK_marker_image_data_padding_padding_padding");

const res = await doc.documentModule.run(front, back, {
  ocr: fakeOcr,
  mrzReader: fakeMrz,
  barcodeReader: fakeBarcode,
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
console.log("EXTRACTED:", JSON.stringify(got, null, 2));

const expect = {
  apellidos: "SOTELO MACHUCA",
  nombres: "SILVIO ANDRES",
  donante: true,
  fechaNacimiento: "1997-11-13",
  fechaVencimiento: "2033-07-12",
  fechaEmision: "2023-07-12",
  sexo: "MASCULINO",
  numeroCedula: "4895448",
};
let ok = true;
for (const [k, v] of Object.entries(expect)) {
  const pass = got[k] === v;
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"} ${k}: got=${JSON.stringify(got[k])} want=${JSON.stringify(v)}`);
}
// El nombre de la autoridad NO debe ser una etiqueta filtrada.
const authBad = got.autoridadNombre === "ESTADO CIVIL";
console.log(`${authBad ? "FAIL" : "PASS"} autoridadNombre no es etiqueta: ${JSON.stringify(got.autoridadNombre)}`);
if (authBad) ok = false;
console.log(ok ? "\nALL PASS" : "\nSOME FAIL");
process.exit(ok ? 0 : 1);
