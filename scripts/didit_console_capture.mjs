import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'C:/Users/sotelos/Downloads/didit_console';
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = 'rohekawebservices@gmail.com';
const PASS = 'eX24h&Y8KO4F';
const log = (...a) => console.log('[cap]', ...a);

let n = 0;
const pad = () => String(++n).padStart(2, '0');

async function shot(page, name) {
  const file = `${OUT}/${pad()}_${name}.png`;
  try {
    await page.screenshot({ path: file, fullPage: true });
    log('shot', file);
  } catch (e) {
    log('shot-fail', name, e.message);
  }
}

async function dump(page, name) {
  // capture visible text + nav links to understand structure
  const info = await page.evaluate(() => {
    const txt = document.body ? document.body.innerText.slice(0, 4000) : '';
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ t: (a.innerText || '').trim().slice(0, 40), h: a.getAttribute('href') }))
      .filter(l => l.h && !l.h.startsWith('javascript'));
    const btns = Array.from(document.querySelectorAll('button'))
      .map(b => (b.innerText || '').trim().slice(0, 40)).filter(Boolean);
    return { url: location.href, title: document.title, txt, links, btns };
  });
  fs.writeFileSync(`${OUT}/_dump_${name}.json`, JSON.stringify(info, null, 1));
  log('dump', name, info.url);
  return info;
}

async function launch() {
  const attempts = [
    { channel: 'chrome' },
    { channel: 'msedge' },
    {},
  ];
  for (const opt of attempts) {
    try {
      const b = await chromium.launch({ headless: true, ...opt });
      log('launched with', JSON.stringify(opt));
      return b;
    } catch (e) { log('launch-fail', JSON.stringify(opt), e.message.split('\n')[0]); }
  }
  throw new Error('no browser available');
}
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);

try {
  log('goto sign-in');
  await page.goto('https://business.didit.me/es/sign-in', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await shot(page, 'signin');
  await dump(page, 'signin');

  // Fill email
  const emailSel = ['input[type=email]', 'input[name=email]', 'input[name=username]', 'input[autocomplete=username]'];
  for (const s of emailSel) { const el = await page.$(s); if (el) { await el.fill(EMAIL); log('filled email via', s); break; } }
  // some flows need clicking continue before password appears
  let passEl = await page.$('input[type=password]');
  if (!passEl) {
    const cont = await page.$('button:has-text("Continuar"), button:has-text("Continue"), button[type=submit]');
    if (cont) { await cont.click(); await page.waitForTimeout(2500); }
    passEl = await page.$('input[type=password]');
  }
  if (passEl) { await passEl.fill(PASS); log('filled pass'); }
  await shot(page, 'signin_filled');

  const submit = await page.$('button[type=submit], button:has-text("Iniciar"), button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Entrar")');
  if (submit) { await submit.click(); log('submitted'); }
  await page.waitForTimeout(6000);
  await shot(page, 'after_login');
  const after = await dump(page, 'after_login');

  if (/sign-in|login/i.test(after.url)) {
    log('LOGIN MAY HAVE FAILED - still on auth page');
  }

  // Try to discover and visit console sections
  const paths = [
    '', 'dashboard', 'verifications', 'sessions', 'settings', 'workflows',
    'developers', 'api-keys', 'webhooks', 'team', 'members', 'billing', 'usage',
    'business-verifications', 'monitoring'
  ];
  const base = new URL(after.url).origin;
  // detect locale segment
  const m = after.url.match(/\/(es|en)\//);
  const loc = m ? m[1] : 'es';
  for (const p of paths) {
    const url = p ? `${base}/${loc}/${p}` : `${base}/${loc}`;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3500);
      const status = resp ? resp.status() : '?';
      const cur = page.url();
      // skip if redirected back to sign-in
      if (/sign-in|login/i.test(cur) && p !== '') { log('skip(redirect-auth)', p); continue; }
      await shot(page, `sec_${p || 'root'}`);
      await dump(page, `sec_${p || 'root'}`);
      log('visited', p, status, cur);
    } catch (e) { log('nav-fail', p, e.message); }
  }
} catch (e) {
  log('FATAL', e.message);
  await shot(page, 'fatal');
} finally {
  await browser.close();
  log('done, screenshots:', n);
}
