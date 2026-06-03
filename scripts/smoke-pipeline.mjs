// Self-test del pipeline (corre DENTRO del container). Divide la cédula specimen
// en frente/dorso, usa el frente como "selfie", y maneja el flujo L1 completo por HTTP.
import sharp from "sharp";

const BASE = "http://localhost:4400";
const KEY = process.env.SMOKE_KEY;
const SPEC = "/app/cedula-specimen.png";

const meta = await sharp(SPEC).metadata();
const W = meta.width, H = meta.height, half = Math.floor(W / 2);
const front = await sharp(SPEC).extract({ left: 0, top: 0, width: half, height: H }).jpeg().toBuffer();
const back = await sharp(SPEC).extract({ left: half, top: 0, width: W - half, height: H }).jpeg().toBuffer();
const b64 = (b) => "data:image/jpeg;base64," + b.toString("base64");

// 1) crear sesión L1
let r = await fetch(BASE + "/v1/sessions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
  body: JSON.stringify({ external_ref: "selftest", assurance_required: "L1" }),
});
const sess = await r.json();
const tok = sess.verificationUrl.split("/").pop();
console.log("session", r.status, tok);

const vp = async (p, body) => {
  const r = await fetch(`${BASE}/verify/${tok}${p}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};

console.log("consent", await vp("/consent", { accepted: true, consentVersion: "1.0" }));
console.log("selfie", (await vp("/selfie", { image: b64(front), frames: [b64(front)] })).s);
console.log("document", (await vp("/document", { front: b64(front), back: b64(back) })).s);
console.log("submit", await vp("/submit", {}));

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await (await fetch(`${BASE}/verify/${tok}/status`)).json();
  if (["verified", "rejected", "needs_recapture", "error", "expired"].includes(st.state)) {
    console.log("FINAL", JSON.stringify(st));
    process.exit(0);
  }
}
console.log("TIMEOUT esperando estado final");
process.exit(1);
