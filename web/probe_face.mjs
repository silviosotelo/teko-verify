import { chromium } from "playwright-core"
import { setTimeout as sleep } from "node:timers/promises"
const CHROME = process.env.LOCALAPPDATA + "\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe"
const [url, y4m] = process.argv.slice(2)
const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream",`--use-file-for-fake-video-capture=${y4m}`,"--no-sandbox"] })
const c = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera"], ignoreHTTPSErrors: true })
const p = await c.newPage()
await p.goto(url, { waitUntil: "domcontentloaded" })
await sleep(1500)
// consent
const boxes = p.locator('input[type="checkbox"]'); const n = await boxes.count()
for (let i=0;i<n;i++){ try{ await boxes.nth(i).check({timeout:1200}) }catch{} }
const btn = p.locator("button").filter({hasText:/continuar|acepto|empezar|comenzar/i}).first()
if (await btn.count()) { try{ await btn.click({timeout:2000}) }catch{} }
await sleep(4000)
const reads = []
for (let i=0;i<6;i++){ reads.push(await p.evaluate(()=> (window).__teko_face ?? null)); await sleep(600) }
console.log("FACE_READS=" + JSON.stringify(reads))
await b.close()
