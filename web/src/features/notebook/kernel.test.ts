import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadKernel, resetKernel, runCell } from '@/features/notebook/kernel';

/**
 * The kernel runs Python in a worker so that a cell which never returns can be
 * terminated. These tests stub the Worker boundary and pin the three outcomes
 * that matter: a normal result comes back, a hang is turned into a timeout
 * instead of a frozen page, and the kernel can be used again afterwards.
 */

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  listeners = new Set<(event: { data: unknown }) => void>();
  posted: Array<Record<string, unknown>> = [];
  terminated = false;

  constructor() {
    FakeWorker.all.push(this);
  }

  postMessage(message: Record<string, unknown>) {
    this.posted.push(message);
    if (message.type === 'boot') queueMicrotask(() => this.emit({ type: 'ready' }));
  }

  addEventListener(_type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.delete(listener);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data: Record<string, unknown>) {
    this.onmessage?.({ data });
    for (const listener of [...this.listeners]) listener({ data });
  }

  lastRun() {
    return [...this.posted].reverse().find((message) => message.type === 'run');
  }
}

describe('kernel worker bridge', () => {
  beforeEach(() => {
    FakeWorker.all = [];
    vi.stubGlobal('Worker', FakeWorker);
    resetKernel();
  });

  afterEach(() => {
    resetKernel();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the output a cell produced', async () => {
    const kernel = await loadKernel();
    const worker = FakeWorker.all[0]!;
    const running = runCell(kernel, 'print(1)');
    // ready() resolves asynchronously, so the run message lands a tick later.
    await vi.waitFor(() => expect(worker.lastRun()).toBeDefined());

    const message = worker.lastRun()!;
    expect(message?.code).toBe('print(1)');
    worker.emit({
      type: 'result',
      id: message?.id,
      result: { ok: true, stdout: '1\n', error: null, errorType: null },
    });

    await expect(running).resolves.toMatchObject({ ok: true, stdout: '1\n' });
  });

  it('turns a hung cell into a timeout instead of a frozen page', async () => {
    vi.useFakeTimers();
    const kernel = await loadKernel();
    const worker = FakeWorker.all[0]!;

    // Never answered: this is what 'while True: pass' looks like from here.
    const running = runCell(kernel, 'while True: pass');
    await vi.waitFor(() => expect(worker.lastRun()).toBeDefined());
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await running;

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('TimeoutError');
    expect(worker.terminated).toBe(true);
  });

  it('starts a fresh worker after the previous one was terminated', async () => {
    vi.useFakeTimers();
    const kernel = await loadKernel();
    const first = FakeWorker.all[0]!;

    const hung = runCell(kernel, 'while True: pass');
    await vi.waitFor(() => expect(first.lastRun()).toBeDefined());
    await vi.advanceTimersByTimeAsync(60_000);
    await hung;
    expect(first.terminated).toBe(true);

    // The same handle must still work: the page keeps one reference forever.
    const second = runCell(kernel, '1 + 1');
    const fresh = FakeWorker.all.at(-1)!;
    expect(fresh).not.toBe(first);
    expect(fresh.posted[0]?.type).toBe('boot');

    await vi.advanceTimersByTimeAsync(0);
    fresh?.emit({
      type: 'result',
      id: fresh.lastRun()?.id,
      result: { ok: true, stdout: '2\n', error: null, errorType: null },
    });
    await expect(second).resolves.toMatchObject({ ok: true });
  });

  it('reports a boot failure instead of hanging forever', async () => {
    class FailingWorker extends FakeWorker {
      override postMessage(message: Record<string, unknown>) {
        this.posted.push(message);
        if (message.type === 'boot') {
          queueMicrotask(() => this.emit({ type: 'boot-failed', message: '无法加载建模兼容层' }));
        }
      }
    }
    vi.stubGlobal('Worker', FailingWorker);
    resetKernel();

    await expect(loadKernel()).rejects.toThrow('无法加载建模兼容层');
  });
});
