import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = 'https://amanesuzuha000.github.io/SCIP-OJ';
const cache = join(homedir(), 'AppData', 'Local', 'ms-playwright');
let executablePath = null;
for (const rev of ['chromium-1228','chromium-1223','chromium-1194']) {
  const c = join(cache, rev, 'chrome-win64', 'chrome.exe');
  if (existsSync(c)) { executablePath = c; break; }
}
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('response', (r) => {
  const p = new URL(r.url()).pathname;
  if (r.status() >= 400 && /\.[a-z0-9]+$/i.test(p)) errs.push(r.status() + ' ' + p);
});

for (const path of ['/docs', '/docs/student-guide', '/docs/grading-protocol']) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const t = (await page.locator('body').innerText()).replace(/\n/g, ' ');
  console.log(path.padEnd(26), '->', t.slice(60, 150));
}

// The lesson that failed once: confirm it runs on the deployed build.
await page.goto(BASE + '/learn/06_IE_Stochastic_Inventory_PySCIPOpt', { waitUntil: 'networkidle' });
const t0 = Date.now();
await page.getByRole('button', { name: '全部运行' }).click();
await page.waitForFunction(() => !document.body.innerText.includes('运行中…'), null, { timeout: 300000 });
const pres = await page.locator('pre').allInnerTexts();
const bad = pres.find((t) => t.includes('Traceback') || t.includes('Error:'));
console.log('lesson 06:', ((Date.now() - t0) / 1000).toFixed(0) + 's', bad ? 'FAIL' : 'PASS');
if (bad) console.log(bad.slice(0, 500));
else console.log('  output:', pres.filter((t) => t.trim()).slice(-1)[0]?.slice(0, 160));

console.log('resource errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
