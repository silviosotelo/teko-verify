// Smoke bootstrap: crea un tenant (policy L1) + una API key, imprime la key en claro.
// Se corre DENTRO del container (node /app/scripts/smoke-bootstrap.mjs) para usar
// los modulos compilados y la conexion pg del propio servicio.
const tenants = await import("/app/dist/db/repos/tenants.js");
const apiKeys = await import("/app/dist/db/repos/apiKeys.js");
const cryptoMod = await import("/app/dist/lib/crypto.js");
let policyMod = {};
try { policyMod = await import("/app/dist/lib/policy.js"); } catch {}

const pick = (m, n) => (m && (m[n] ?? (m.default && m.default[n])));
const createTenant = pick(tenants, "create");
const createKey = pick(apiKeys, "create");
const generateApiKey = pick(cryptoMod, "generateApiKey");
const mergePolicy = pick(policyMod, "mergePolicy");

const basePolicy = mergePolicy ? mergePolicy({ assuranceRequired: "L1" }) : {
  assuranceRequired: "L1",
  maxRecaptureAttempts: 3,
  livenessChallenges: [],
  retentionDays: 90,
  thresholds: {},
};

const slug = "smoke-" + Math.floor(Math.random() * 1e9).toString(36);
const t = await createTenant({ name: "Smoke Test", slug, policies: basePolicy });
const k = generateApiKey();
await createKey({ tenantId: t.id, keyHash: k.hash, prefix: k.prefix, label: "smoke", scopes: ["sessions"] });

console.log("TENANT_ID=" + t.id);
console.log("API_KEY=" + k.plain);
console.log("POLICY=" + JSON.stringify(basePolicy));
process.exit(0);
