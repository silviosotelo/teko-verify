import pw from "/home/soporte/facenox-web/node_modules/playwright-core/index.js"
const { chromium } = pw

const BASE = "http://localhost:4380/v8app/"
const OUT = "/home/soporte/fr-v8/web/shots"

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/home/soporte/.hermes/home/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--no-sandbox",
  ],
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: ["camera"],
})
const page = await ctx.newPage()
page.on("console", (m) => console.log("PAGE:", m.type(), m.text()))

await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(3000) // camera + first detect

// Recognize screen
await page.screenshot({ path: `${OUT}/01-recognize.png` })

// Enrolar
await page.locator("nav button", { hasText: "Enrolar" }).click()
await page.waitForTimeout(2000)
await page.screenshot({ path: `${OUT}/02-enroll.png` })

// Personas
await page.locator("nav button", { hasText: "Personas" }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/03-personas.png` })

// Ajustes
await page.locator("nav button", { hasText: "Ajustes" }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/04-ajustes.png` })

await browser.close()
console.log("DONE")
