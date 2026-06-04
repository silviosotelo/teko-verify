/**
 * Verificación del gating de auto-captura (Caso A: NO captura sin documento/rostro).
 *
 * Lanza Chromium (binario de la cache de Playwright) con cámara FALSA alimentada
 * desde un .y4m, viewport móvil y permiso de cámara concedido. Maneja:
 *  - Caso A selfie: video sin rostro (gris) → assert NO countdown, NO POST /selfie.
 *  - Caso A doc + Caso B doc: rehidrata en DocCapture y prueba blank vs orue,
 *    leyendo el pill de feedback como sonda del veredicto del gate.
 *
 * Uso: node verify_gating.mjs <verifyUrl> <y4mFile> <label>
 */
import { chromium } from "playwright-core"
import { setTimeout as sleep } from "node:timers/promises"

const CHROME =
  process.env.LOCALAPPDATA +
  "\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe"
const OUT = "C:\\Users\\sotelos\\Downloads\\capture_gating"

const verifyUrl = process.argv[2]
const y4m = process.argv[3]
const label = process.argv[4] || "run"

if (!verifyUrl || !y4m) {
  console.error("usage: node verify_gating.mjs <verifyUrl> <y4m> <label>")
  process.exit(2)
}

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

// --- Señales duras ---------------------------------------------------------
const capturePosts = []
page.on("request", (req) => {
  const u = req.url()
  if (
    req.method() === "POST" &&
    /\/(selfie|document|doc-check)$/.test(u)
  ) {
    capturePosts.push({ t: Date.now(), url: u.replace(/^.*\/verify\//, "verify/") })
  }
})
const consoleErrs = []
page.on("console", (m) => {
  if (m.type() === "error") consoleErrs.push(m.text())
})

const log = (...a) => console.log(`[${label}]`, ...a)

await page.goto(verifyUrl, { waitUntil: "domcontentloaded" })
await sleep(1500)

// Avanzar el consentimiento si estamos ahí (marcar checkbox + botón continuar).
async function passConsent() {
  // Marcar todos los checkboxes visibles.
  const boxes = page.locator('input[type="checkbox"]')
  const n = await boxes.count()
  for (let i = 0; i < n; i++) {
    try {
      await boxes.nth(i).check({ timeout: 1500 })
    } catch {}
  }
  // Botón de continuar (primer botón habilitado que no sea "cancelar").
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

const screenText = async () =>
  (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim()

let txt = await screenText()
log("pantalla inicial:", txt.slice(0, 80))
if (/consentimiento|autorizo|verifiquemos/i.test(txt)) {
  await passConsent()
  await sleep(2500)
  txt = await screenText()
  log("tras consentimiento:", txt.slice(0, 80))
}

// --- Observación ~14s: pill de feedback + countdown + POSTs ----------------
const samples = []
const start = Date.now()
let countdownSeen = false
const probe = async () => {
  return await page.evaluate(() => {
    // Pill de feedback en vivo (texto dentro del óvalo/guía).
    const pills = Array.from(
      document.querySelectorAll("span.rounded-full"),
    ).map((e) => e.textContent?.trim() || "")
    // El countdown es un <span> grande (text-7xl) con un dígito.
    const big = Array.from(document.querySelectorAll("span.text-7xl"))
      .map((e) => e.textContent?.trim())
      .filter(Boolean)
    return { pills, countdown: big }
  })
}

for (let i = 0; i < 14; i++) {
  const p = await probe()
  if (p.countdown.length) countdownSeen = true
  samples.push({ s: ((Date.now() - start) / 1000).toFixed(1), ...p })
  await sleep(1000)
}

await page.screenshot({ path: `${OUT}\\caseA_${label}.png` })

// --- Veredicto -------------------------------------------------------------
const uniquePills = [...new Set(samples.flatMap((s) => s.pills).filter(Boolean))]
log("pills observados:", JSON.stringify(uniquePills))
log("countdown visto:", countdownSeen)
log("POSTs de captura:", JSON.stringify(capturePosts))
log("errores consola:", consoleErrs.length)

const result = {
  label,
  y4m: y4m.split(/[\\/]/).pop(),
  finalScreen: (await screenText()).slice(0, 60),
  uniquePills,
  countdownSeen,
  capturePosts: capturePosts.length,
  capturePostUrls: capturePosts.map((c) => c.url),
}
console.log("RESULT_JSON=" + JSON.stringify(result))

await browser.close()
