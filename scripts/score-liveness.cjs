/**
 * Diagnóstico de calibración de liveness — corre el ENSEMBLE PAD REAL de producción
 * (dist/modules/liveness.js + dist/engine.js) sobre selfies genuinas en evidencia y
 * sobre proxies de ataque (doc_front = foto impresa de la cédula). Imprime los scores
 * "real" del ensemble para elegir un umbral que separe genuino de print.
 *
 * Uso (dentro del contenedor): node /app/score-liveness.cjs <path1.jpg> [path2.jpg ...]
 * Cada arg con prefijo "GEN:" o "ATK:" se etiqueta; sin prefijo = sin etiqueta.
 */
const fs = require("fs");
const { engine } = require("/app/dist/engine.js");
const { livenessModule } = require("/app/dist/modules/liveness.js");

(async () => {
  await engine.init();
  await livenessModule.init();
  const args = process.argv.slice(2);
  const rows = [];
  for (const a of args) {
    let label = "?";
    let p = a;
    const m = a.match(/^(GEN|ATK):(.*)$/);
    if (m) {
      label = m[1];
      p = m[2];
    }
    if (!fs.existsSync(p)) {
      rows.push({ label, p, err: "missing" });
      continue;
    }
    const buf = fs.readFileSync(p);
    try {
      const r = await livenessModule.run(buf, engine, {});
      rows.push({
        label,
        p,
        score: r.score,
        passed070: r.score >= 0.7,
        passed060: r.score >= 0.6,
        attackType: r.attackType,
      });
    } catch (e) {
      rows.push({ label, p, err: String(e && e.message) });
    }
  }
  for (const r of rows) {
    if (r.err) {
      console.log(`${r.label}\tERR ${r.err}\t${r.p}`);
    } else {
      console.log(
        `${r.label}\tscore=${r.score.toFixed(4)}\tp@0.70=${r.passed070}\tp@0.60=${r.passed060}\t${r.p.split("/").slice(-2).join("/")}`
      );
    }
  }
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
