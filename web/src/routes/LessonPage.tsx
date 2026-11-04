import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { CodeEditor } from '@/features/editor/CodeEditor';
import { MarkdownCell } from '@/features/notebook/MarkdownCell';
import { lessons, type LessonCell } from '@/features/notebook/lessons';
import {
  loadKernel,
  runCell,
  type CellResult,
  type KernelProgress,
} from '@/features/notebook/kernel';

/**
 * One lesson: prose and runnable cells side by side, driven by the browser
 * Python kernel. No notebook server, no embedded IDE -- the page is the course.
 *
 * Cells share a single Python namespace because that is how the notebooks are
 * written: cell 2 defines solve(), cell 3 calls it. Renumbering or running them
 * out of order would silently change what a lesson means.
 */

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

  // A new lesson means a new namespace: variables from the previous lesson must
  // not leak into this one.
  useEffect(() => {
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

  /** Run every code cell in order, stopping at the first failure. */
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

  if (!lesson) {
    return (
      <Card className="p-6">
        <p className="text-sm text-secondary">没有这一课。返回学习页重新选择。</p>
      </Card>
    );
  }

  const busy = runningAll || Object.values(states).some((state) => state.kind === 'running');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-primary">{lesson.title}</h2>
          {lesson.summary ? <p className="mt-1 text-sm text-secondary">{lesson.summary}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="brand">浏览器内运行</Badge>
          <Button onClick={runAll} disabled={busy} size="sm">
            {runningAll ? '运行中…' : '全部运行'}
          </Button>
        </div>
      </div>

      <KernelStatus progress={progress} error={kernelError} busy={busy} />

      <p className="text-xs text-tertiary">
        练习环境只用于学习：这里的结果不计入成绩，正式评测在隔离容器中用原生 PySCIPOpt 重新求解。
      </p>

      <div className="flex flex-col gap-3">
        {lesson.cells.map((cell, index) =>
          cell.kind === 'markdown' ? (
            <Card key={index} className="p-5">
              <MarkdownCell source={cell.source} />
            </Card>
          ) : (
            <CodeCell
              key={index}
              index={index}
              autoFocused={index === firstCodeIndex(lesson.cells)}
              source={edits[index] ?? cell.source}
              state={states[index] ?? { kind: 'idle' }}
              busy={busy}
              onChange={(value) => setEdits((prev) => ({ ...prev, [index]: value }))}
              onRun={() => execute(index, edits[index] ?? cell.source)}
            />
          ),
        )}
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
      <Card className="border-danger p-4">
        <p className="text-sm font-medium text-danger">建模环境未能启动</p>
        <p className="mt-1 text-xs text-secondary">{error}</p>
        <p className="mt-2 text-xs text-tertiary">
          首次使用需要下载约 10 MB 的 Python 运行时；如果网络受限，这里会一直失败。
        </p>
      </Card>
    );
  }
  if (!progress || progress.stage === 'ready') {
    return busy ? null : (
      <p className="text-xs text-tertiary">点「全部运行」或任意单元的运行按钮，首次会加载建模环境。</p>
    );
  }
  return <Spinner label={progress.message} />;
}

function CodeCell({
  source,
  state,
  busy,
  onChange,
  onRun,
  autoFocused,
}: {
  index: number;
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
      <div className="flex items-center justify-between border-b border-subtle bg-muted/40 px-3 py-2">
        <span className="text-xs font-medium text-tertiary">Python</span>
        <Button variant="ghost" size="sm" onClick={onRun} disabled={busy}>
          {running ? '运行中…' : '运行'}
        </Button>
      </div>
      <div className="p-3">
        <CodeEditor
          value={source}
          onChange={onChange}
          readOnly={running}
          ariaLabel={autoFocused ? '第一个代码单元' : '代码单元'}
        />
      </div>
      {state.kind === 'done' ? <CellOutput result={state.result} /> : null}
    </Card>
  );
}

function CellOutput({ result }: { result: CellResult }) {
  return (
    <div className="border-t border-subtle bg-raised px-3 py-2">
      {result.stdout ? (
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-secondary">
          {result.stdout}
        </pre>
      ) : null}
      {result.ok ? (
        result.stdout ? null : <p className="text-xs text-tertiary">该单元没有输出。</p>
      ) : (
        <div className="mt-1">
          <Badge tone="danger">{result.errorType ?? '运行错误'}</Badge>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-danger">
            {result.error}
          </pre>
        </div>
      )}
    </div>
  );
}
