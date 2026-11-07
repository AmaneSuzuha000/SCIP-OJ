/**
 * The in-browser Python practice kernel: a handle onto a worker.
 *
 * The course notebooks are written against PySCIPOpt, which is a binding to a
 * C++ solver and therefore cannot run in a browser. Rather than ship a second
 * full JupyterLab just to host a kernel, this drives Pyodide directly and
 * installs a PySCIPOpt-compatible shim (web/runtime/pyscipopt.py) backed by
 * SciPy's HiGHS. The notebooks run unmodified.
 *
 * The interpreter lives in kernel-worker.ts. It cannot live here: a cell that
 * never returns blocks the thread it runs on, and on the main thread that freezes
 * the tab -- no repaint, no button, no way out but force-quitting. A worker can
 * be terminated, so a runaway cell costs a runtime restart instead of the page.
 * Pyodide's own interrupt buffer would be lighter but needs COOP/COEP headers,
 * which GitHub Pages will not serve.
 *
 * This is the PRACTICE path only. Formal grades are produced by real PySCIPOpt
 * inside the isolated container, so nothing here can influence a score.
 */
import type { CellResult, KernelProgress } from './kernel-protocol';

export type { CellResult, KernelProgress };

type ProgressFn = (progress: KernelProgress) => void;

/**
 * Generous on purpose. Course notebooks solve small MILPs that finish in
 * seconds; this only has to catch code that will never finish at all.
 */
const RUN_TIMEOUT_MS = 60_000;

const TIMEOUT_MESSAGE =
  '运行超过 60 秒，已停止并重置 Python 环境（之前定义的变量需要重新运行）。' +
  '如果这是死循环，检查循环条件；如果只是求解规模大，试着减小实例。';

export class Kernel {
  private worker: Worker | null = null;
  private booting: Promise<void> | null = null;
  private booted = false;
  private seq = 0;
  private pending = new Map<number, (result: CellResult) => void>();
  private progress: ProgressFn | undefined;

  constructor(onProgress?: ProgressFn) {
    this.progress = onProgress;
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./kernel-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => this.receive(event.data);
    worker.onerror = (event: ErrorEvent) => {
      this.abort('Python 运行时崩溃：' + (event.message || '未知错误'));
    };
    return worker;
  }

  /** Long-lived handler: progress, results, and a crash mid-run. */
  private receive(data: Record<string, unknown>) {
    if (data.type === 'progress') {
      this.progress?.(data.progress as KernelProgress);
      return;
    }
    if (data.type === 'result') {
      const deliver = this.pending.get(data.id as number);
      if (!deliver) return;
      this.pending.delete(data.id as number);
      deliver(data.result as CellResult);
      return;
    }
    if (data.type === 'boot-failed') {
      this.abort(String(data.message ?? '无法启动 Python 环境'));
    }
  }

  /**
   * Throw away the worker and everything in it.
   *
   * Called on timeout, on a crash, and by resetKernel. Every caller still
   * waiting gets a failure rather than a promise that never settles.
   */
  private abort(reason: string) {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.booting = null;
    this.booted = false;
    for (const deliver of waiting) {
      deliver({ ok: false, stdout: '', error: reason, errorType: 'KernelError' });
    }
  }

  /**
   * Boot the interpreter. Idempotent, and a terminated worker reboots here.
   *
   * The one-shot listener cleans itself up; receive() stays attached for the
   * life of the worker to carry progress and results.
   */
  ready(): Promise<void> {
    if (this.booted && this.worker) return Promise.resolve();
    if (this.booting) return this.booting;
    if (!this.worker) this.worker = this.spawn();

    const worker = this.worker;
    this.booting = new Promise<void>((resolve, reject) => {
      const settle = (event: MessageEvent<Record<string, unknown>>) => {
        if (event.data.type === 'ready') {
          worker.removeEventListener('message', settle);
          this.booted = true;
          this.booting = null;
          resolve();
        } else if (event.data.type === 'boot-failed') {
          worker.removeEventListener('message', settle);
          reject(new Error(String(event.data.message ?? '无法启动 Python 环境')));
        }
      };
      worker.addEventListener('message', settle);
      worker.postMessage({ type: 'boot' });
    }).catch((cause) => {
      this.abort(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    });
    return this.booting;
  }

  async run(code: string): Promise<CellResult> {
    await this.ready();
    const worker = this.worker;
    if (!worker) {
      return { ok: false, stdout: '', error: 'Python 环境不可用', errorType: 'KernelError' };
    }

    return new Promise<CellResult>((resolve) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.abort(TIMEOUT_MESSAGE);
        resolve({ ok: false, stdout: '', error: TIMEOUT_MESSAGE, errorType: 'TimeoutError' });
      }, RUN_TIMEOUT_MS);

      this.pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      worker.postMessage({ type: 'run', id, code });
    });
  }

  dispose() {
    this.abort('内核已关闭');
  }
}

let singleton: Kernel | null = null;
let bootPromise: Promise<Kernel> | null = null;

/**
 * Boot once per page; concurrent callers share the same promise.
 *
 * A failed boot clears the cache so a retry starts clean. Once booted the
 * handle outlives a terminated worker: it starts a fresh one on next use.
 */
export function loadKernel(onProgress?: ProgressFn): Promise<Kernel> {
  if (singleton) return Promise.resolve(singleton);
  if (bootPromise) return bootPromise;

  const kernel = new Kernel(onProgress);
  bootPromise = kernel
    .ready()
    .then(() => {
      singleton = kernel;
      return kernel;
    })
    .catch((cause) => {
      kernel.dispose();
      bootPromise = null;
      throw cause;
    });
  return bootPromise;
}

export function resetKernel(): void {
  singleton?.dispose();
  singleton = null;
  bootPromise = null;
}

/** Run one cell. Output is captured whole so it stays attached to that cell. */
export function runCell(kernel: Kernel, code: string): Promise<CellResult> {
  return kernel.run(code);
}
