/**
 * The in-browser Python practice kernel.
 *
 * The course notebooks are written against PySCIPOpt, which is a binding to a
 * C++ solver and therefore cannot run in a browser. Rather than ship a second
 * full JupyterLab just to host a kernel, this module boots Pyodide directly and
 * installs a PySCIPOpt-compatible shim (web/runtime/pyscipopt.py) backed by
 * SciPy's HiGHS. The notebooks run unmodified.
 *
 * This is the PRACTICE path only. Formal grades are produced by real PySCIPOpt
 * inside the isolated container, so nothing here can influence a score.
 */

export interface KernelProgress {
  stage: 'loading' | 'packages' | 'ready' | 'running';
  message: string;
}

export interface CellResult {
  ok: boolean;
  stdout: string;
  error: string | null;
  errorType: string | null;
}

type ProgressFn = (progress: KernelProgress) => void;

interface PyodideLike {
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
  loadPackage(names: string | string[]): Promise<void>;
  FS: { writeFile(path: string, data: Uint8Array): void; mkdir(path: string): void };
  setStdout(options: { batched: (text: string) => void }): void;
  setStderr(options: { batched: (text: string) => void }): void;
  globals: { get(name: string): unknown };
}

/** Where the Pyodide distribution lives. The deploy places it under runtime/. */
function indexUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return new URL(base + 'runtime/pyodide/', window.location.href).href;
}

let kernelPromise: Promise<PyodideLike> | null = null;

async function boot(onProgress?: ProgressFn): Promise<PyodideLike> {
  onProgress?.({ stage: 'loading', message: '正在加载 Python 运行时，首次使用需要下载约 10 MB…' });

  const mod = await import(/* @vite-ignore */ indexUrl() + 'pyodide.mjs');
  const pyodide = (await mod.loadPyodide({ indexURL: indexUrl() })) as PyodideLike;

  onProgress?.({ stage: 'packages', message: '正在加载 numpy 与 scipy…' });
  await pyodide.loadPackage(['numpy', 'scipy']);

  // Install the compat layer where 'import pyscipopt' will find it.
  //
  // Pages serves 404.html for anything missing, so a wrong URL here still
  // returns 200 with HTML in the body. Check the content, not just the status,
  // or the failure resurfaces later as a bizarre SyntaxError inside CPython.
  const shimUrl = new URL(import.meta.env.BASE_URL + 'runtime/pyscipopt.py', window.location.href);
  const shim = await fetch(shimUrl);
  if (!shim.ok) throw new Error('无法加载建模兼容层（pyscipopt.py）：HTTP ' + shim.status);
  const source = await shim.text();
  if (!source.startsWith('"""')) {
    throw new Error(
      '建模兼容层内容不对（收到 ' + source.slice(0, 40).replace(/\s+/g, ' ') + '…），' +
        '多半是部署里缺少 runtime/pyscipopt.py',
    );
  }
  pyodide.FS.writeFile(
    '/lib/python3.13/site-packages/pyscipopt.py',
    new TextEncoder().encode(source),
  );

  onProgress?.({ stage: 'ready', message: '建模环境已就绪' });
  return pyodide;
}

/** Boot once per page; concurrent callers share the same promise. */
export function loadKernel(onProgress?: ProgressFn): Promise<PyodideLike> {
  kernelPromise ??= boot(onProgress).catch((cause) => {
    kernelPromise = null; // let a retry start cleanly
    throw cause;
  });
  return kernelPromise;
}

export function resetKernel(): void {
  kernelPromise = null;
}

/**
 * Run one notebook cell. Output is captured rather than streamed so a cell's
 * result stays attached to that cell in the UI.
 */
export async function runCell(pyodide: PyodideLike, code: string): Promise<CellResult> {
  let stdout = '';
  let stderr = '';
  pyodide.setStdout({ batched: (text) => { stdout += text + '\n'; } });
  pyodide.setStderr({ batched: (text) => { stderr += text + '\n'; } });

  try {
    await pyodide.runPythonAsync(code);
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
