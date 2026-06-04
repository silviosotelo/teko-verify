/**
 * Flujo en UN solo contexto con video face→doc concatenado.
 * Selfie pasa durante el segmento de rostro; al avanzar a DocCapture el video
 * ya muestra el documento. Lee pills + countdown + POSTs + el box de debug.
 * Uso: node verify_single.mjs <verifyUrl> <y4m>
 */
import { chromium } from "playwright-core"
import { setTimeout as sleep } from "node:timers/promises"
const CHROME = process.env.LOCALAPPDATA + "\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe"
const OUT = "C:\\Users\\sotelos\\Downloads\\capture_gating"
const [url, y4m] = process.argv.slice(2)

const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream",`--use-file-for-fake-video-capture=${y4m}`,"--no-sandbox"] })
const c = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera"], ignoreHTTPSErrors: true })
const p = await c.newPage()
const posts = []
p.on("request", (r) => { if (r.method()==="POST" && /\/(selfie|document|doc-check)$/.test(r.url())) posts.push({ t: Date.now(), u: r.url().replace(/^.*\/verify\/[^/]+/, "") }) })

const probe = () => p.evaluate(() => ({
  heading: document.querySelector("h1")?.textContent?.trim() || "",
  pills: Array.from(document.querySelectorAll("span.rounded-full")).map(e=>e.textContent?.trim()||""),
  countdown: Array.from(document.querySelectorAll("span.text-7xl")).map(e=>e.textContent?.trim()).filter(Boolean),
  face: (window).__teko_face ?? null,
  doc: (window).__teko_doc ?? null,
}))

await p.goto(url, { waitUntil: "domcontentloaded" })
await sleep(1500)
// consent
const boxes = p.locator('input[type="checkbox"]'); const n = await boxes.count()
for (let i=0;i<n;i++){ try{ await boxes.nth(i).check({timeout:1200}) }catch{} }
const btn = p.locator("button").filter({hasText:/continuar|acepto|empezar|comenzar/i}).first()
if (await btn.count()) { try{ await btn.click({timeout:2000}) }catch{} }
await sleep(1500)

const timeline = []
let selfieShot=false, docShot=false, sawDocScreen=false
const docSamples = []
const seenPills = { selfie:new Set(), doc:new Set() }
for (let i=0;i<55;i++){
  const s = await probe()
  const onDoc = /c[ée]dula/i.test(s.heading)
  if (onDoc) { sawDocScreen = true; if (s.doc) docSamples.push(s.doc) }
  s.pills.forEach(x=>{ if(x) (onDoc?seenPills.doc:seenPills.selfie).add(x) })
  if (s.countdown.length) { if(onDoc) docShot=true; else selfieShot=true }
  timeline.push({ s:((i*0.6)).toFixed(1), h:s.heading.slice(0,16), cd:s.countdown[0]||"", pill:s.pills[0]||"" })
  await sleep(600)
}
// Última muestra de debug del doc gate (más estable).
const lastDoc = docSamples[docSamples.length-1] ?? null
console.log("DOC_DEBUG last:", JSON.stringify(lastDoc), "| samples:", docSamples.length)
await p.screenshot({ path: `${OUT}\\single_flow_final.png` })

console.log("SELFIE pills:", JSON.stringify([...seenPills.selfie]))
console.log("DOC pills:", JSON.stringify([...seenPills.doc]))
console.log("reached DocCapture:", sawDocScreen)
console.log("selfie countdown:", selfieShot, "| doc countdown:", docShot)
console.log("POSTs:", JSON.stringify(posts.map(x=>x.u)))
console.log("RESULT_JSON=" + JSON.stringify({ selfiePills:[...seenPills.selfie], docPills:[...seenPills.doc], reachedDoc:sawDocScreen, selfieShot, docShot, posts:posts.map(x=>x.u) }))
await b.close()
