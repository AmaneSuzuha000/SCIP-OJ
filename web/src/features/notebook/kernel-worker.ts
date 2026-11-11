/**
 * The Python kernel, running off the main thread.
 *
 * Pyodide has to live in a worker, not in the page, because of how a runaway
 * cell behaves: `while True: pass` blocks the thread it runs on, and on the main
 * thread that means the tab stops responding -- no repaint, no button, no way
 * out but force-quitting. A worker can be terminated, so a cell that never
 * returns costs one runtime restart instead of the whole page.
 *
 * Pyodide's own interrupt buffer would be lighter, but it needs a shared
 * buffer and therefore COOP/COEP headers, which GitHub Pages will not serve.
 *
 * This is the PRACTICE path only. Grades come from real PySCIPOpt in an
 * isolated container, so nothing here can influence a score.
 */
import type { CellResult, KernelProgress } from './kernel-protocol';

interface PyodideLike {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackage(names: string | string[]): Promise<void>;
  FS: { writeFile(path: string, data: Uint8Array): void };
  setStdout(options: { batched: (text: string) => void }): void;
  setStderr(options: { batched: (text: string) => void }): void;
}

type Incoming =
  | { type: 'boot' }
  | { type: 'run'; id: number; code: string }
  | { type: 'reset'; id: number };

const BASE = import.meta.env.BASE_URL || '/';

function indexUrl(): string {
  return new URL(BASE + 'runtime/pyodide/', self.location.href).href;
}

let pyodide: PyodideLike | null = null;
let stdout = '';
let stderr = '';

function progress(p: KernelProgress) {
  self.postMessage({ type: 'progress', progress: p });
}

/**
 * Load numpy and scipy, then prove scipy actually imports.
 *
 * loadPackage resolves once the wheels are installed, but a dropped or
 * truncated download has been observed to leave scipy absent anyway -- the
 * first cell then dies with "scipy is not available" although boot reported
 * success. Verifying the import turns that silent half-loaded state into a
 * retry, which is what a student on a flaky connection needs.
 */
async function loadPackages(py: PyodideLike): Promise<void> {
  const attempt = async () => {
    await py.loadPackage(['numpy', 'scipy']);
    await py.runPythonAsync('import scipy.optimize');
  };
  try {
    await attempt();
  } catch {
    await attempt();
  }
}

async function boot(): Promise<PyodideLike> {
  if (pyodide) return pyodide;
  progress({ stage: 'loading', message: '正在加载 Python 运行时，首次使用需要下载约 29 MB…' });

  const mod = await import(/* @vite-ignore */ indexUrl() + 'pyodide.mjs');
  const py = (await mod.loadPyodide({ indexURL: indexUrl() })) as PyodideLike;

  progress({ stage: 'packages', message: '正在加载 numpy 与 scipy…' });
  await loadPackages(py);

  // Pages serves 404.html for anything missing, so a wrong URL here still
  // returns 200 with HTML in the body. Check the content, not just the status.
  const shim = await fetch(new URL(BASE + 'runtime/pyscipopt.py', self.location.href));
  if (!shim.ok) throw new Error('无法加载建模兼容层（pyscipopt.py）：HTTP ' + shim.status);
  const source = await shim.text();
  if (!source.startsWith('"""')) {
    throw new Error(
      '建模兼容层内容不对（收到 ' + source.slice(0, 40).replace(/\s+/g, ' ') + '…），' +
        '多半是部署里缺少 runtime/pyscipopt.py',
    );
  }
  const purelib = String(
    await py.runPythonAsync('import sysconfig; sysconfig.get_path("purelib")'),
  ).replace(/\/+$/, '');
  py.FS.writeFile(purelib + '/pyscipopt.py', new TextEncoder().encode(source));

  pyodide = py;
  progress({ stage: 'ready', message: '建模环境已就绪' });
  return py;
}

async function resetNamespace(): Promise<void> {
  const py = await boot();
  await py.runPythonAsync(`
import sys as _scip_sys
_main_ns = _scip_sys.modules['__main__'].__dict__
_keep = {'__name__', '__doc__', '__package__', '__loader__', '__spec__', '__builtins__'}
for _k in list(_main_ns.keys()):
    if _k not in _keep:
        del _main_ns[_k]
del _main_ns, _k, _keep, _scip_sys
`);
  progress({ stage: 'ready', message: '建模环境已重置' });
}

async function run(code: string): Promise<CellResult> {
  const py = await boot();
  progress({ stage: 'running', message: '正在运行…' });
  stdout = '';
  stderr = '';
  py.setStdout({ batched: (text) => { stdout += text + '\n'; } });
  py.setStderr({ batched: (text) => { stderr += text + '\n'; } });
  try {
    await py.runPythonAsync(code);
    return { ok: true, stdout: stdout + stderr, error: null, errorType: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const typeMatch = /^([A-Za-z_][A-Za-z0-9_.]*Error|[A-Za-z_][A-Za-z0-9_.]*Exception)/.exec(message);
    return {
      ok: false,
      stdout: stdout + stderr,
      error: message,
      errorType: typeMatch?.[1] ?? null,
    };
  }
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const data = event.data;
  if (data.type === 'boot') {
    try {
      await boot();
      self.postMessage({ type: 'ready' });
    } catch (cause) {
      self.postMessage({ type: 'boot-failed', message: cause instanceof Error ? cause.message : String(cause) });
    }
    return;
  }
  if (data.type === 'run') {
    try {
      const result = await run(data.code);
      self.postMessage({ type: 'result', id: data.id, result });
    } catch (cause) {
      self.postMessage({
        type: 'boot-failed',
        id: data.id,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    return;
  }
  if (data.type === 'reset') {
    try {
      await resetNamespace();
      self.postMessage({ type: 'reset-done', id: data.id });
    } catch (cause) {
      self.postMessage({
        type: 'boot-failed',
        id: data.id,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
};
