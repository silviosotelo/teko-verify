/**
 * Seed de DEMOSTRACIÓN del panel AML (P1 #1) — crea una sesión real en estado
 * `in_review` que lleva el resultado GENUINO del screening (corrido contra el
 * dataset local) para un nombre sancionado, de modo que el panel "AML / Sanciones"
 * del detalle de sesión tenga datos reales que mostrar (screenshots de verificación).
 *
 * NO es parte del pipeline; es una utilidad de demo. Usa los módulos COMPILADOS.
 * Uso: docker exec teko-teko-verify-1 node /app/scripts/aml-demo-seed.mjs "Vladimir" "Putin" 1952-10-07 RU
 */
import { createLocalAmlProvider } from "/app/dist/modules/amlProvider.js";
import { screen } from "/app/dist/modules/aml.js";
import * as amlEntities from "/app/dist/db/repos/amlEntities.js";
import * as sessions from "/app/dist/db/repos/sessions.js";
import * as checks from "/app/dist/db/repos/checks.js";
import * as tenants from "/app/dist/db/repos/tenants.js";
import { pool } from "/app/dist/db/pool.js";
import crypto from "node:crypto";

const [nombres = "Vladimir", apellidos = "Putin", fechaNac = "1952-10-07", nacionalidad = "RU"] =
  process.argv.slice(2);

const provider = createLocalAmlProvider({
  candidates: (input, limit) => amlEntities.candidates(input, limit),
  datasetVersion: () => amlEntities.datasetVersion(),
});

const amlWorkflow = {
  document: { required: true },
  match: { required: true },
  quality: {},
  aml: { required: true, threshold: 0.85, onMatch: "review" },
  review: { mode: "auto" },
};

async function main() {
  const list = await tenants.list({ limit: 1 });
  const tenant = (list.tenants ?? list)[0];
  if (!tenant) throw new Error("no hay tenants");

  const aml = await screen({ nombres, apellidos, fechaNac, nacionalidad }, provider, {
    threshold: 0.85,
  });

  const sess = await sessions.create({
    tenantId: tenant.id,
    externalRef: `aml-demo:${Date.now()}`,
    linkToken: crypto.randomBytes(24).toString("hex"),
    assuranceRequired: "L2",
    workflowSnapshot: amlWorkflow,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });

  // Check `document` mínimo (para que el detalle tenga identidad extraída coherente).
  await checks.create({
    tenantId: tenant.id,
    sessionId: sess.id,
    type: "document",
    score: 0.98,
    passed: true,
    detail: {
      docType: "ID_CARD",
      passed: true,
      extracted: {
        titular: { nombres, apellidos, fechaNacimiento: fechaNac, nacionalidad, numeroDocumento: "DEMO-AML" },
      },
      checks: { mrzValid: true, expired: false },
    },
  });

  // Check `aml` REAL (potential_match contra el dataset local).
  await checks.create({
    tenantId: tenant.id,
    sessionId: sess.id,
    type: "aml",
    score: aml.topScore,
    passed: aml.passed,
    detail: aml,
  });

  // Ruteo a revisión humana (cola in_review), como haría el pipeline con onMatch:review.
  await sessions.update(tenant.id, sess.id, {
    state: "in_review",
    result: { decision: "verified", loa: "L2", reasons: ["aml_potential_match"] },
  });

  console.log(JSON.stringify({
    tenantId: tenant.id,
    sessionId: sess.id,
    state: "in_review",
    amlDecision: aml.decision,
    topScore: aml.topScore,
    topHit: aml.hits[0]?.name,
    lists: aml.hits[0]?.lists,
  }, null, 2));
  await pool.end();
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
