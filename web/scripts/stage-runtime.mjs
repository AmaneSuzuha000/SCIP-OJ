/**
 * Stage the browser Python runtime next to the app build.
 *
 * Pyodide plus the wheels the course loads is roughly 26 MB. That is far too
 * much for git, so nothing is committed: the core comes out of node_modules and
 * the wheels are fetched at build time from the Pyodide CDN, then cached.
 *
 * Serving it from our own origin rather than letting the browser call the CDN
 * matters here: jsDelivr is unreliable from mainland China, and a lesson that
 * silently fails to start is worse than a slower first load.
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// scripts/ lives inside web/, so the app root is one level up.
const APP = resolve(import.meta.dirname, '..');
const SOURCE = join(APP, 'node_modules', 'pyodide');
const TARGET = join(APP, 'dist', 'runtime', 'pyodide');
const CACHE = join(APP, 'node_modules', '.cache', 'pyodide-wheels');

const CDN = 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/';
const CORE = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
/** Roots of the import graph the lessons need; dependencies are resolved below. */
const ROOTS = ['numpy', 'scipy'];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Walk pyodide-lock.json so a scipy update cannot silently drop openblas. */
function resolveWheels(lock) {
  const needed = new Set();
  const visit = (name) => {
    if (needed.has(name)) return;
    const entry = lock.packages[name];
    if (!entry) throw new Error('pyodide-lock.json 中没有包：' + name);
    needed.add(name);
    for (const dep of entry.depends ?? []) visit(dep);
  };
  ROOTS.forEach(visit);
  return [...needed].map((name) => lock.packages[name].file_name);
}

async function fetchToCache(file) {
  const cached = join(CACHE, file);
  if (await exists(cached)) return cached;
  process.stdout.write('  下载 ' + file + ' … ');
  const response = await fetch(CDN + file);
  if (!response.ok) throw new Error('下载失败 ' + file + ' (' + response.status + ')');
  await writeFile(cached, Buffer.from(await response.arrayBuffer()));
  const { size } = await stat(cached);
  console.log((size / 1048576).toFixed(1) + ' MB');
  return cached;
}

if (!(await exists(SOURCE))) {
  console.error('缺少 pyodide：请先在 web/ 下 npm install（它已列入 devDependencies）');
  process.exit(1);
}

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });
await mkdir(CACHE, { recursive: true });

for (const name of CORE) await cp(join(SOURCE, name), join(TARGET, name));

const lock = JSON.parse(await readFile(join(SOURCE, 'pyodide-lock.json'), 'utf8'));
const wheels = resolveWheels(lock);
for (const file of wheels) await cp(await fetchToCache(file), join(TARGET, file));

const files = await readdir(TARGET);
const total = await Promise.all(files.map(async (f) => (await stat(join(TARGET, f))).size));
const megabytes = (total.reduce((a, b) => a + b, 0) / 1048576).toFixed(1);
console.log('运行时就绪：dist/runtime/pyodide（' + files.length + ' 个文件，' + megabytes + ' MB）');
