/**
 * Verificación EN VIVO del screening AML (P1 #1) contra el dataset real cargado en
 * `aml_entities` del server. Exporta los módulos COMPILADOS (dist) — el mismo
 * código que corre el pipeline — y los ejercita end-to-end:
 *   (a) nombre sancionado (OFAC) → potential_match con el hit;
 *   (b) identidad real (SOTELO) → clear;
 *   (c) ruteo: workflow aml-screening (onMatch:review) + potential_match → in_review.
 * No usa imágenes ni engine: prueba la cadena provider→screenEntities→ruteo real.
 */
import { createLocalAmlProvider } from "/app/dist/modules/amlProvider.js";
import { screen } from "/app/dist/modules/aml.js";
import * as amlEntities from "/app/dist/db/repos/amlEntities.js";
import { shouldRouteToReview } from "/app/dist/lib/workflow.js";

const provider = createLocalAmlProvider({
  candidates: (input, limit) => amlEntities.candidates(input, limit),
  datasetVersion: () => amlEntities.datasetVersion(),
});

// Definición del workflow sembrado `aml-screening` (onMatch:review).
const amlWorkflow = {
  document: { required: true },
  match: { required: true },
  quality: {},
  aml: { required: true, threshold: 0.85, onMatch: "review" },
  review: { mode: "auto" },
};

async function run() {
  const count = await amlEntities.count();
  const version = await amlEntities.datasetVersion();
  console.log(`[verify] dataset: ${count} entidades · version=${version}\n`);

  // (a) HIT — entidad OFAC conocida.
  const hit = await screen(
    { nombres: "Vladimir", apellidos: "Putin", fechaNac: "1952-10-07", nacionalidad: "RU" },
    provider,
    { threshold: 0.85 }
  );
  console.log("== (a) Vladimir Putin (sancionado OFAC) ==");
  console.log(`   decision=${hit.decision} topScore=${hit.topScore} hits=${hit.hits.length}`);
  const top = hit.hits[0];
  if (top)
    console.log(
      `   top: ${top.name} [${top.lists.join(", ")}] score=${top.score} fields=${top.matchedFields.join(",")} id=${top.entityId}`
    );
  const routeHit = shouldRouteToReview(amlWorkflow, { amlDecision: hit.decision });
  console.log(`   shouldRouteToReview(onMatch:review) = ${routeHit}  → ${routeHit ? "in_review" : "auto"}\n`);

  // (b) CLEAR — identidad real.
  const clear = await screen(
    { nombres: "Silvio", apellidos: "Sotelo", nacionalidad: "PY" },
    provider,
    { threshold: 0.85 }
  );
  console.log("== (b) Silvio Sotelo (identidad real) ==");
  console.log(`   decision=${clear.decision} topScore=${clear.topScore} hits=${clear.hits.length}`);
  const routeClear = shouldRouteToReview(amlWorkflow, { amlDecision: clear.decision });
  console.log(`   shouldRouteToReview = ${routeClear}  → ${routeClear ? "in_review" : "auto"}\n`);

  // (c) Resumen de aserciones.
  const ok =
    hit.decision === "potential_match" &&
    top &&
    top.entityId === "Q7747" &&
    routeHit === true &&
    clear.decision === "clear" &&
    routeClear === false;
  console.log(`== RESULT: ${ok ? "PASS ✓" : "FAIL ✗"} ==`);
  process.exit(ok ? 0 : 1);
}

run().catch((e) => {
  console.error("[verify] ERROR:", e);
  process.exit(2);
});
