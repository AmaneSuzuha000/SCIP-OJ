// End-to-end proof: every course notebook runs in the page, in a browser.
//
// This is the claim the whole embedded-runtime design rests on, so it runs all
// eleven and reports each one rather than sampling.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Read the notebook list from the source of truth rather than the generated
// TypeScript module, which Node cannot import directly.
const CONTENT = join(import.meta.dirname, '..', '..', 'content');
const lessons = (await readdir(CONTENT))
  .filter((name) => name.endsWith('.ipynb'))
  .sort()
  .map((name) => ({ id: name.replace(/\.ipynb$/, '') }));

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), 'AppData', 'Local', 'ms-playwright');
  for (const revision of ['chromium-1228', 'chromium-1223', 'chromium-1194']) {
    const candidate = join(cache, revision, 'chrome-win64', 'chrome.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const executablePath = findChrome();
if (!executablePath) {
  console.error('没有可用 Chromium：设置 CHROME_PATH 或运行 npx playwright install chromium');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();

const networkErrors = [];
page.on('response', (response) => {
  // GitHub Pages answers an unknown path with 404.html and a 404 status; the
  // router inside that document renders the page. A deep link therefore *is* a
  // 404 over the wire, so only failures of real assets count here.
  const isSpaFallback =
    response.status() === 404 && !/\.[a-z0-9]+$/i.test(new URL(response.url()).pathname);
  if (response.status() >= 400 && !isSpaFallback) {
    networkErrors.push(response.status() + ' ' + response.url());
  }
});
page.on('pageerror', (error) => networkErrors.push('pageerror: ' + String(error)));

let failures = 0;
for (const lesson of lessons) {
  await page.goto(BASE + '/learn/' + lesson.id, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '全部运行' }).click();
  // The kernel is cached after the first lesson; later ones finish quickly.
  await page.waitForFunction(() => !document.body.innerText.includes('运行中…'), {
    timeout: 300000,
  });

  const pre = await page.locator('pre').allInnerTexts();
  const traceback = pre.find((text) => text.includes('Traceback') || text.includes('Error:'));
  const banner = await page.locator('body').innerText();
  const startupFailed = banner.includes('建模环境未能启动');

  if (traceback || startupFailed) {
    failures += 1;
    console.log('FAIL ' + lesson.id);
    if (traceback) console.log('  ' + traceback.split('\n').slice(-4).join('\n  '));
    if (startupFailed) console.log('  内核启动失败');
  } else {
    const last = pre[pre.length - 1] ?? '';
    console.log('PASS ' + lesson.id + '  ->  ' + last.split('\n')[0].slice(0, 70));
  }
}

console.log('');
console.log(lessons.length + ' 课，' + failures + ' 处失败');
if (networkErrors.length) {
  console.log('网络/页面错误:');
  for (const line of [...new Set(networkErrors)].slice(0, 8)) console.log('  ' + line);
}

await browser.close();
process.exit(failures === 0 && networkErrors.length === 0 ? 0 : 1);
