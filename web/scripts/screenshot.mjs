import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = 'https://amanesuzuha000.github.io/SCIP-OJ';
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
page.on('pageerror', (e) => problems.push(String(e).slice(0, 300)));
page.on('response', (r) => {
  const p = new URL(r.url()).pathname;
  if (r.status() >= 400 && /\.[a-z0-9]+$/i.test(p)) problems.push(r.status() + ' ' + p);
});

for (const [path, shotName] of [['/docs', 'live-docs.png'], ['/docs/student-guide', 'live-doc.png']]) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const text = (await page.locator('body').innerText()).slice(0, 160).replace(/\n/g, ' | ');
  console.log(path, '->', text);
  await page.screenshot({ path: join(OUT, shotName) });
}

console.log('资源错误:', problems.length ? problems.join(' | ') : '无');
await browser.close();
