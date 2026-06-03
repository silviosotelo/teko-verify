// Dump del OCR del sidecar para una imagen: imprime cada línea con el centro (cy,cx)
// para diseñar la extracción por etiqueta/región. Uso: node ocr-dump.mjs /app/front.jpg
import { readFileSync } from "fs";
const path = process.argv[2];
const b64 = readFileSync(path).toString("base64");
const r = await fetch("http://paddleocr-sidecar:8001/ocr", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: b64 }),
});
const j = await r.json();
const rows = (j.lines || []).map((l) => {
  const ys = l.box.map((p) => p[1]); const xs = l.box.map((p) => p[0]);
  const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  return { cy, cx, text: l.text, score: Math.round((l.score || 0) * 100) / 100 };
}).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
console.log("=== " + path + " (" + rows.length + " líneas) ===");
for (const r of rows) console.log(`cy=${r.cy} cx=${r.cx} s=${r.score} ${JSON.stringify(r.text)}`);
