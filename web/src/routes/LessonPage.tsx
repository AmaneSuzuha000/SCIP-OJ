import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { CodeEditor } from '@/features/editor/CodeEditor';
import { MarkdownCell } from '@/features/notebook/MarkdownCell';
import { lessons, type LessonCell } from '@/features/notebook/lessons';
import {
  loadKernel,
  resetKernel,
  resetKernelNamespace,
  runCell,
  type CellResult,
  type KernelProgress,
} from '@/features/notebook/kernel';

type CellState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: CellResult };

const firstCodeIndex = (cells: LessonCell[]) => cells.findIndex((cell) => cell.kind === 'code');

export function LessonPage() {
  const { lessonId } = useParams();
  const lesson = useMemo(() => lessons.find((item) => item.id === lessonId), [lessonId]);

  const [progress, setProgress] = useState<KernelProgress | null>(null);
  const [kernelError, setKernelError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<number, CellState>>({});
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [runningAll, setRunningAll] = useState(false);
  const kernel = useRef<Awaited<ReturnType<typeof loadKernel>> | null>(null);

  useEffect(() => {
    void resetKernelNamespace();
    kernel.current = null;
    setStates({});
    setEdits({});
    setKernelError(null);
    setProgress(null);
  }, [lessonId]);

  const ensureKernel = useCallback(async () => {
    if (kernel.current) return kernel.current;
    try {
      kernel.current = await loadKernel(setProgress);
      return kernel.current;
    } catch (cause) {
      setKernelError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, []);

  const execute = useCallback(
    async (index: number, code: string) => {
      setStates((prev) => ({ ...prev, [index]: { kind: 'running' } }));
      try {
        const pyodide = await ensureKernel();
        const result = await runCell(pyodide, code);
        setStates((prev) => ({ ...prev, [index]: { kind: 'done', result } }));
        return result;
      } catch {
        setStates((prev) => ({ ...prev, [index]: { kind: 'idle' } }));
        return null;
      }
    },
    [ensureKernel],
  );

  const runAll = useCallback(async () => {
    if (!lesson || runningAll) return;
    setRunningAll(true);
    try {
      for (let index = 0; index < lesson.cells.length; index += 1) {
        const cell = lesson.cells[index];
        if (!cell || cell.kind !== 'code') continue;
        const code = edits[index] ?? cell.source;
        const result = await execute(index, code);
        if (!result?.ok) break;
      }
    } finally {
      setRunningAll(false);
    }
  }, [lesson, runningAll, edits, execute]);

  const resetEnv = useCallback(async () => {
    const wasBusy =
      runningAll || Object.values(states).some((state) => state.kind === 'running');
    setRunningAll(false);
    setStates({});
    setKernelError(null);
    if (wasBusy) {
      resetKernel();
      kernel.current = null;
      setProgress(null);
      return;
    }
    await resetKernelNamespace();
  }, [runningAll, states]);

  if (!lesson) {
    return (
      <Card className="flex flex-col gap-3 p-6">
        <p className="text-sm text-secondary">未找到该建模案例。</p>
        <Link to="/learn" className="w-fit text-xs text-brand hover:underline">
          ← 返回拓展学习
        </Link>
      </Card>
    );
  }

  const busy = runningAll || Object.values(states).some((state) => state.kind === 'running');
  let codeCounter = 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link to="/learn" className="w-fit text-xs text-brand hover:underline">
          ← 返回拓展学习
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-primary">{lesson.title}</h1>
            {lesson.summary ? <p className="mt-1 text-sm text-secondary">{lesson.summary}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone="brand">浏览器本地运行</Badge>
            <Button variant="secondary" onClick={() => void resetEnv()} size="sm">
              重置环境
            </Button>
            <Button onClick={runAll} disabled={busy} size="sm">
              {runningAll ? '运行中…' : '全部运行'}
            </Button>
          </div>
        </div>
      </div>

      <KernelStatus progress={progress} error={kernelError} busy={busy} />

      <div className="rounded-[var(--radius-md)] border border-subtle bg-muted/40 px-3.5 py-2 text-xs text-tertiary">
        提示：此处求解在浏览器本地环境中运行，仅作探索与练习；提交正式作业后将由云端隔离容器独立评测。
      </div>

      <div className="flex flex-col gap-3.5">
        {lesson.cells.map((cell, index) => {
          if (cell.kind === 'markdown') {
            return (
              <Card key={index} className="p-5 sm:p-6">
                <MarkdownCell source={cell.source} />
              </Card>
            );
          }
          codeCounter += 1;
          return (
            <CodeCell
              key={index}
              index={index}
              cellNumber={codeCounter}
              autoFocused={index === firstCodeIndex(lesson.cells)}
              source={edits[index] ?? cell.source}
              state={states[index] ?? { kind: 'idle' }}
              busy={busy}
              onChange={(value) => setEdits((prev) => ({ ...prev, [index]: value }))}
              onRun={() => execute(index, edits[index] ?? cell.source)}
            />
          );
        })}
      </div>
    </div>
  );
}

function KernelStatus({
  progress,
  error,
  busy,
}: {
  progress: KernelProgress | null;
  error: string | null;
  busy: boolean;
}) {
  if (error) {
    return (
      <Card className="border-danger bg-danger-soft/40 p-4">
        <p className="text-sm font-medium text-danger">浏览器求解环境未能就绪</p>
        <p className="mt-1 text-xs text-secondary">{error}</p>
        <p className="mt-2 text-xs text-tertiary">
          首次运行需按需加载 Python 建模运行时，请检查网络连接后点击「重置环境」重试。
        </p>
      </Card>
    );
  }
  if (!progress || progress.stage === 'ready') {
    return busy ? null : (
      <p className="text-xs text-tertiary">点击「全部运行」或单个代码单元右上角「运行」，首次会自动初始化求解环境。</p>
    );
  }
  return <Spinner label={progress.message} />;
}

function CodeCell({
  cellNumber,
  source,
  state,
  busy,
  onChange,
  onRun,
  autoFocused,
}: {
  index: number;
  cellNumber: number;
  autoFocused: boolean;
  source: string;
  state: CellState;
  busy: boolean;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  const running = state.kind === 'running';
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-subtle bg-muted/50 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] font-medium text-tertiary">
            In [{cellNumber}]
          </span>
          <span className="text-xs font-medium text-secondary">Python · PySCIPOpt</span>
        </div>
        <div className="flex items-center gap-2">
          {state.kind === 'done' ? (
            <Badge tone={state.result.ok ? 'success' : 'danger'}>
              {state.result.ok ? '执行完成' : '出错'}
            </Badge>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onRun} disabled={busy}>
            {running ? '运行中…' : '运行'}
          </Button>
        </div>
      </div>
      <div className="p-3">
        <CodeEditor
          value={source}
          onChange={onChange}
          readOnly={running}
          minHeight={140}
          ariaLabel={autoFocused ? '第一个代码单元' : '代码单元'}
        />
      </div>
      {state.kind === 'done' ? <CellOutput result={state.result} /> : null}
    </Card>
  );
}

function CellOutput({ result }: { result: CellResult }) {
  return (
    <div
      className={
        'border-t border-subtle border-l-3 bg-raised px-4 py-3 ' +
        (result.ok ? 'border-l-success' : 'border-l-danger')
      }
    >
      {result.stdout ? (
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-secondary">
          {result.stdout}
        </pre>
      ) : null}
      {result.ok ? (
        result.stdout ? null : <p className="text-xs text-tertiary">执行成功（无标准输出）。</p>
      ) : (
        <div className="mt-1">
          <Badge tone="danger">{result.errorType ?? '运行错误'}</Badge>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-danger">
            {result.error}
          </pre>
        </div>
      )}
    </div>
  );
}
