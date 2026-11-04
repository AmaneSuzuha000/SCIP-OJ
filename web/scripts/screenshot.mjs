import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4192/SCIP-OJ';
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

await page.goto(BASE + '/docs', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.screenshot({ path: join(OUT, 'docs-index.png') });
console.log('docs-index.png');

await page.goto(BASE + '/docs/student-guide', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, 'docs-article.png') });
console.log('docs-article.png');

console.log('资源错误:', problems.length ? problems.join(' | ') : '无');
await browser.close();
