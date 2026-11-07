/** Types shared by the kernel worker and the page that drives it. */

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
