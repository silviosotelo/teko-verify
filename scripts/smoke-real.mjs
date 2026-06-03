// Self-test del pipeline con imágenes REALES (corre dentro del container).
// Lee /app/selfie.jpg, /app/front.jpg, /app/back.jpg y maneja un flujo L3 completo.
import { readFileSync } from "fs";

const BASE = "http://localhost:4400";
const KEY = process.env.SMOKE_KEY;
const b64 = (p) => "data:image/jpeg;base64," + readFileSync(p).toString("base64");
const selfie = b64("/app/selfie.jpg");
const front = b64("/app/front.jpg");
const back = b64("/app/back.jpg");

let r = await fetch(BASE + "/v1/sessions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
  body: JSON.stringify({ external_ref: "silvio-server-L3", assurance_required: "L3" }),
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
console.log("selfie", (await vp("/selfie", { image: selfie, frames: [selfie, selfie] })).s);
console.log("document", (await vp("/document", { front, back })).s);
console.log("submit", await vp("/submit", {}));

for (let i = 0; i < 48; i++) {
  await new Promise((r) => setTimeout(r, 2500));
  const st = await (await fetch(`${BASE}/verify/${tok}/status`)).json();
  if (["verified", "rejected", "needs_recapture", "error", "expired"].includes(st.state)) {
    console.log("FINAL", JSON.stringify(st));
    process.exit(0);
  }
}
console.log("TIMEOUT");
process.exit(1);
