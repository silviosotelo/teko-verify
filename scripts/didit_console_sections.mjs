import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'C:/Users/sotelos/Downloads/didit_console';
const EMAIL = 'rohekawebservices@gmail.com';
const PASS = 'eX24h&Y8KO4F';
const ORG = '4081f080-4097-4802-9ecd-a1ecee7e5061';
const APP = '9df0ea5d-4577-4754-8774-e619c0d936bc';
const CB = `/es/console/${ORG}/${APP}`;
const log = (...a) => console.log('[sec]', ...a);

let n = 18; // continue numbering after first run
const pad = () => String(++n).padStart(2, '0');
async function shot(p, name) { try { await p.screenshot({ path: `${OUT}/${pad()}_${name}.png`, fullPage: true }); log('shot', name); } catch (e) { log('shot-fail', name, e.message); } }
async function dump(p, name) {
  const info = await p.evaluate(() => ({
    url: location.href, title: document.title,
    txt: document.body ? document.body.innerText.slice(0, 6000) : '',
    links: Array.from(document.querySelectorAll('a[href]')).map(a => ({ t: (a.innerText||'').trim().slice(0,40), h: a.getAttribute('href') })).filter(l => l.h && !l.h.startsWith('javascript')),
  }));
  fs.writeFileSync(`${OUT}/_dump_${name}.json`, JSON.stringify(info, null, 1));
  return info;
}

const browser = await (async () => { for (const o of [{channel:'chrome'},{channel:'msedge'},{}]) { try { return await chromium.launch({ headless:true, ...o }); } catch(e){} } throw new Error('no browser'); })();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-ES' });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);

async function login() {
  await page.goto('https://business.didit.me/es/sign-in', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const em = await page.$('input[type=email]'); if (em) await em.fill(EMAIL);
  let pw = await page.$('input[type=password]');
  if (!pw) { const c = await page.$('button[type=submit]'); if (c) { await c.click(); await page.waitForTimeout(2000); } pw = await page.$('input[type=password]'); }
  if (pw) await pw.fill(PASS);
  const s = await page.$('button[type=submit]'); if (s) await s.click();
  await page.waitForTimeout(6000);
  log('login url', page.url());
}

const routes = [
  ['users', `${CB}/users`],
  ['businesses', `${CB}/businesses`],
  ['kyc_verifications', `${CB}/kyc/verifications`],
  ['kyb_verifications', `${CB}/kyb/verifications`],
  ['transactions', `${CB}/transactions`],
  ['workflows', `${CB}/workflows`],
  ['customization', `${CB}/customization`],
  ['questionnaires', `${CB}/questionnaires`],
  ['lists', `${CB}/lists`],
  ['integrate', `${CB}/integrate`],
  ['developers_api-keys', `${CB}/developers/api-keys`],
  ['developers_webhooks', `${CB}/developers/webhooks`],
  ['reports', `${CB}/reports`],
  ['settings_team', `/es/console/${ORG}/settings/team`],
  ['org_settings', `/es/console/${ORG}/settings?app=${APP}`],
  ['verification_detail', `${CB}/kyc/verifications?session-id=8b3f366c-3c76-4d1b-a529-f02071c66d9f`],
];

try {
  await login();
  for (const [name, path] of routes) {
    try {
      await page.goto(`https://business.didit.me${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
      await shot(page, name);
      await dump(page, name);
      log('ok', name, page.url());
    } catch (e) { log('fail', name, e.message.split('\n')[0]); }
  }
  // open a workflow to capture the editor
  try {
    await page.goto(`https://business.didit.me${CB}/workflows`, { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(3500);
    const wf = await page.$('a[href*="/workflows/"], [role="row"] a, table a');
    if (wf) { await wf.click(); await page.waitForTimeout(5000); await shot(page,'workflow_editor'); await dump(page,'workflow_editor'); log('workflow editor', page.url()); }
    else { log('no workflow link found'); }
  } catch(e){ log('wf-fail', e.message.split('\n')[0]); }
} catch (e) { log('FATAL', e.message); }
finally { await browser.close(); log('done at', n); }
