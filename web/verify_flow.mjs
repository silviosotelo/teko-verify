/**
 * Verificación end-to-end del gating con cámara falsa por etapa.
 *
 * Como Chromium fija el archivo de cámara falsa al lanzar, usamos DOS lanzamientos
 * sobre la MISMA verifyUrl (rehidratación de estado del backend):
 *   Fase 1: video de ROSTRO → pasa Selfie (Caso B selfie: detecta→countdown→/selfie)
 *           y deja la sesión en el paso Cédula.
 *   Fase 2: relanzamos con el video de DOC → la app rehidrata en DocCapture.
 *           Probamos el gate de cédula leyendo el pill de feedback como sonda.
 *
 * Señales duras: page.on('request') (POSTs de captura) + presencia del countdown.
 *
 * Uso: node verify_flow.mjs <verifyUrl> <faceY4m> <docY4m> <docLabel>
 */
import { chromium } from "playwright-core"
import { setTimeout as sleep } from "node:timers/promises"

const CHROME =
  process.env.LOCALAPPDATA +
  "\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe"
const OUT = "C:\\Users\\sotelos\\Downloads\\capture_gating"

const [verifyUrl, faceY4m, docY4m, docLabel = "doc"] = process.argv.slice(2)
if (!verifyUrl || !faceY4m || !docY4m) {
  console.error("usage: node verify_flow.mjs <verifyUrl> <faceY4m> <docY4m> <docLabel>")
  process.exit(2)
}

async function launch(y4m) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${y4m}`,
      "--no-sandbox",
    ],
  })
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ["camera"],
    ignoreHTTPSErrors: true,
  })
  const page = await ctx.newPage()
  const posts = []
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/(selfie|document|doc-check)$/.test(req.url()))
      posts.push(req.url().replace(/^.*\/verify\/[^/]+/, ""))
  })
  return { browser, page, posts }
}

const screenText = (page) =>
  page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim())

const probe = (page) =>
  page.evaluate(() => ({
    pills: Array.from(document.querySelectorAll("span.rounded-full")).map(
      (e) => e.textContent?.trim() || "",
    ),
    countdown: Array.from(document.querySelectorAll("span.text-7xl"))
      .map((e) => e.textContent?.trim())
      .filter(Boolean),
    heading: document.querySelector("h1")?.textContent?.trim() || "",
  }))

async function passConsent(page) {
  const boxes = page.locator('input[type="checkbox"]')
  const n = await boxes.count()
  for (let i = 0; i < n; i++) {
    try {
      await boxes.nth(i).check({ timeout: 1500 })
    } catch {}
  }
  const btn = page
    .locator("button")
    .filter({ hasText: /continuar|acepto|empezar|comenzar|siguiente/i })
    .first()
  if (await btn.count()) {
    try {
      await btn.click({ timeout: 2000 })
    } catch {}
  }
}

// ============ FASE 1: pasar Selfie con rostro (Caso B selfie) ===============
console.log("=== FASE 1: Selfie con rostro ===")
{
  const { browser, page, posts } = await launch(faceY4m)
  await page.goto(verifyUrl, { waitUntil: "domcontentloaded" })
  await sleep(1500)
  let txt = await screenText(page)
  if (/consentimiento|autorizo|verifiquemos/i.test(txt)) {
    await passConsent(page)
    await sleep(2500)
  }
  // Observar hasta 20s: esperamos heading "selfie" → countdown → advance a Cédula.
  let countdownSeen = false
  let reachedDoc = false
  const pills = new Set()
  for (let i = 0; i < 20; i++) {
    const p = await probe(page)
    p.pills.forEach((x) => x && pills.add(x))
    if (p.countdown.length) countdownSeen = true
    if (/c[ée]dula/i.test(p.heading)) {
      reachedDoc = true
      break
    }
    await sleep(1000)
  }
  await page.screenshot({ path: `${OUT}\\caseB_selfie.png` })
  console.log("FASE1 pills:", JSON.stringify([...pills]))
  console.log("FASE1 countdownSeen:", countdownSeen)
  console.log("FASE1 selfiePOSTs:", JSON.stringify(posts))
  console.log("FASE1 reachedDoc:", reachedDoc)
  console.log("FASE1 heading final:", (await probe(page)).heading)
  await browser.close()
}

// ============ FASE 2: DocCapture con video de documento ====================
console.log(`=== FASE 2: DocCapture con ${docLabel} ===`)
{
  const { browser, page, posts } = await launch(docY4m)
  await page.goto(verifyUrl, { waitUntil: "domcontentloaded" })
  await sleep(2500)
  let txt = await screenText(page)
  if (/consentimiento|autorizo|verifiquemos/i.test(txt)) {
    await passConsent(page)
    await sleep(2500)
  }
  const pills = new Set()
  let countdownSeen = false
  let h = ""
  for (let i = 0; i < 14; i++) {
    const p = await probe(page)
    h = p.heading
    p.pills.forEach((x) => x && pills.add(x))
    if (p.countdown.length) countdownSeen = true
    await sleep(1000)
  }
  await page.screenshot({ path: `${OUT}\\doc_${docLabel}.png` })
  console.log("FASE2 heading:", h)
  console.log("FASE2 pills:", JSON.stringify([...pills]))
  console.log("FASE2 countdownSeen:", countdownSeen)
  console.log("FASE2 docPOSTs:", JSON.stringify(posts))
  console.log(
    "RESULT_JSON=" +
      JSON.stringify({
        docLabel,
        heading: h,
        pills: [...pills],
        countdownSeen,
        docPosts: posts.length,
      }),
  )
  await browser.close()
}
