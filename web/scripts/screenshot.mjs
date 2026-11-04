import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4187/SCIP-OJ';
const OUT = join(import.meta.dirname, '..', 'shots');
const cache = join(homedir(), 'AppData', 'Local', 'ms-playwright');
let executablePath = null;
for (const rev of ['chromium-1228','chromium-1223','chromium-1194']) {
  const c = join(cache, rev, 'chrome-win64', 'chrome.exe');
  if (existsSync(c)) { executablePath = c; break; }
}

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on('pageerror', (e) => problems.push(String(e).slice(0, 200)));
page.on('response', (r) => {
  const p = new URL(r.url()).pathname;
  if (r.status() >= 400 && /\.[a-z0-9]+$/i.test(p)) problems.push(r.status() + ' ' + p);
});

await page.goto(BASE + '/learn/03_IE_Facility_Location_PySCIPOpt', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '全部运行' }).click();
await page.waitForFunction(() => !document.body.innerText.includes('运行中…'), { timeout: 300000 });
await page.waitForTimeout(600);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'lesson-result.png') });

// The notebook links to the lab pages; make one actually open.
const lab = await page.evaluate(async () => {
  const a = [...document.querySelectorAll('a')].find((x) => x.textContent?.includes('IE-DES-01'));
  return a ? a.getAttribute('href') : null;
});
console.log('notebook 链接:', lab);
if (lab) {
  const target = new URL(lab, BASE + '/learn/03_IE_Facility_Location_PySCIPOpt');
  const res = await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  console.log('打开实验页:', res?.status(), target.pathname);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'lab-page.png') });
}

console.log('资源错误:', problems.length ? problems.join(' | ') : '无');
await browser.close();
