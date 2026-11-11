import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { GradingReport } from '@/components/GradingReport';
import { CodeEditor } from '@/features/editor/CodeEditor';
import {
  createRequestKeyManager,
  getAssignment,
  latestGrading,
  submitCode,
  type ClientIntegritySignals,
} from '@/features/grading/api';
import type { KernelProgress } from '@/features/notebook/kernel-protocol';
import type { SelfTestResult } from '@/features/problems/selftest';
import { findStatement } from '@/features/problems/statements';
import { MarkdownCell } from '@/features/notebook/MarkdownCell';

const FALLBACK_TEMPLATE = [
  'def solve(instance):',
  '    """返回 {"status": "optimal", "objective": float, "solution": ...}。"""',
  '    # 请依据 instance 中的输入参数建立模型并求解',
  '    raise NotImplementedError',
].join('\n');

const DRAFT_PREFIX = 'scip-oj.draft.';

function readDraft(assignmentId: string | undefined): string | null {
  if (!assignmentId) return null;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(DRAFT_PREFIX + assignmentId);
  } catch {
    return null;
  }
}

function writeDraft(assignmentId: string | undefined, value: string): void {
  if (!assignmentId) return;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DRAFT_PREFIX + assignmentId, value);
    }
  } catch {
    // Ignore quota/private-mode errors cleanly.
  }
}

function clearDraft(assignmentId: string | undefined): void {
  if (!assignmentId) return;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(DRAFT_PREFIX + assignmentId);
    }
  } catch {
    // Ignore cleanly.
  }
}

type ViewMode = 'statement' | 'code' | 'split';

export function WorkbenchPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const queryClient = useQueryClient();
  const [search] = useSearchParams();
  const queryProblemId = search.get('problem') ?? undefined;

  const assignment = useQuery({
    queryKey: ['assignment', assignmentId],
    queryFn: () => getAssignment(assignmentId as string),
    enabled: Boolean(assignmentId),
  });

  const effectiveProblemId = assignment.data?.problem_id ?? queryProblemId;
  const statement = useMemo(() => findStatement(effectiveProblemId), [effectiveProblemId]);
  const initialTemplate = statement?.template?.trim() ? statement.template : FALLBACK_TEMPLATE;

  const savedDraft = useMemo(() => readDraft(assignmentId), [assignmentId]);
  const [code, setCode] = useState<string>(() => savedDraft ?? initialTemplate);
  const dirtyRef = useRef(Boolean(savedDraft));
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [tab, setTab] = useState<ViewMode>('statement');
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [selfTestProgress, setSelfTestProgress] = useState<KernelProgress | null>(null);
  const [selfTesting, setSelfTesting] = useState(false);
  const [selfTestResult, setSelfTestResult] = useState<SelfTestResult | null>(null);

  const keyManagerRef = useRef(createRequestKeyManager());
  const startedAtRef = useRef(Date.now());
  const signalsRef = useRef({
    input_events: 0,
    paste_events: 0,
    blocked_pastes: 0,
    copy_events: 0,
    drop_events: 0,
    hidden_events: 0,
  });

  useEffect(() => {
    const nextDraft = readDraft(assignmentId);
    dirtyRef.current = Boolean(nextDraft);
    setCode(nextDraft ?? initialTemplate);
    setSubmissionId(null);
    setSelfTestResult(null);
    setSelfTestProgress(null);
    setPasteNotice(null);
    startedAtRef.current = Date.now();
    signalsRef.current = {
      input_events: 0,
      paste_events: 0,
      blocked_pastes: 0,
      copy_events: 0,
      drop_events: 0,
      hidden_events: 0,
    };
  }, [assignmentId]);

  useEffect(() => {
    if (!dirtyRef.current && statement?.template?.trim()) {
      setCode(statement.template);
    }
  }, [statement?.template]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.hidden) signalsRef.current.hidden_events += 1;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const handleCodeChange = useCallback(
    (next: string) => {
      dirtyRef.current = true;
      setCode(next);
      writeDraft(assignmentId, next);
    },
    [assignmentId],
  );

  const handleSignal = useCallback(
    (kind: 'input' | 'paste' | 'blocked_paste' | 'copy' | 'drop') => {
      if (kind === 'input') signalsRef.current.input_events += 1;
      else if (kind === 'paste') signalsRef.current.paste_events += 1;
      else if (kind === 'blocked_paste') {
        signalsRef.current.blocked_pastes += 1;
        setPasteNotice('严格防作弊模式下已拦截粘贴，请手动编写代码');
      } else if (kind === 'copy') signalsRef.current.copy_events += 1;
      else if (kind === 'drop') signalsRef.current.drop_events += 1;
    },
    [],
  );

  const integrityPolicy = assignment.data?.integrity_policy ?? 'standard';
  const blockPaste = integrityPolicy === 'exam_block';

  const submit = useMutation({
    mutationFn: () => {
      const requestKey = keyManagerRef.current.keyFor(assignmentId as string, code);
      const clientIntegrity: ClientIntegritySignals = {
        elapsed_seconds: Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
        ...signalsRef.current,
      };
      return submitCode({
        assignmentId: assignmentId as string,
        codeText: code,
        requestKey,
        clientIntegrity,
      });
    },
    onSuccess: async (receipt) => {
      setSubmissionId(receipt.submission_id);
      keyManagerRef.current.confirmAndRotate();
      await queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
    },
  });

  const grading = useQuery({
    queryKey: ['grading', submissionId],
    queryFn: () => latestGrading(submissionId as string),
    enabled: Boolean(submissionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 2000 : false;
    },
  });

  const runSelfTest = useCallback(async () => {
    if (selfTesting) return;
    setSelfTesting(true);
    setSelfTestResult(null);
    if (tab === 'statement') setTab('code');
    try {
      const { runLocalSelfTest } = await import('@/features/problems/selftest');
      const result = await runLocalSelfTest(effectiveProblemId, code, setSelfTestProgress);
      setSelfTestResult(result);
    } catch (cause) {
      setSelfTestResult({
        ok: false,
        summary: '本地自测运行失败',
        stdout: '',
        error: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setSelfTesting(false);
    }
  }, [code, effectiveProblemId, selfTesting, tab]);

  const resetTemplate = useCallback(() => {
    dirtyRef.current = false;
    clearDraft(assignmentId);
    setCode(initialTemplate);
    setPasteNotice(null);
  }, [assignmentId, initialTemplate]);

  if (!assignmentId) return <EmptyState title="缺少作业编号" />;

  const verdict = grading.data;
  const backPath = assignment.data?.course_id ? '/course/' + assignment.data.course_id : '/';
  const showStatement = tab === 'statement' || tab === 'split';
  const showCode = tab === 'code' || tab === 'split';

  const statementCard = statement ? (
    <Card className="flex flex-col gap-3 p-5 sm:p-6">
      <MarkdownCell source={statement.source} />
    </Card>
  ) : assignment.isLoading ? (
    <Spinner label="加载题目" />
  ) : (
    <EmptyState
      title="暂未匹配到内置题面"
      hint="请以教师发布的作业说明为准；你仍可在代码区完成建模并提交"
    />
  );

  const editorCard = (
    <CodeEditor
      value={code}
      onChange={handleCodeChange}
      blockPaste={blockPaste}
      minHeight={420}
      onSignal={handleSignal}
      ariaLabel="作业代码编辑器"
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to={backPath} className="w-fit text-xs text-brand hover:underline">
          ← 返回课程作业
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex rounded-[var(--radius-md)] border border-subtle bg-muted/50 p-0.5">
                {(
                  [
                    ['statement', '题目'],
                    ['code', '代码'],
                    ['split', '分屏对照'],
                  ] as const
                ).map(([name, label]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setTab(name)}
                    className={
                      'cursor-pointer rounded-[var(--radius-sm)] px-3 py-1 text-xs transition-colors sm:text-sm ' +
                      (name === 'split' ? 'hidden xl:inline-flex ' : '') +
                      (tab === name
                        ? 'bg-surface font-medium text-primary shadow-[var(--shadow-sm)]'
                        : 'text-secondary hover:text-primary')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {assignment.data ? (
                <span className="ml-1 font-mono text-xs text-tertiary">
                  {assignment.data.problem_id} · 及格 {assignment.data.pass_score} ·{' '}
                  {assignment.data.n_instances} 组算例
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {showCode ? (
                <Button variant="ghost" size="sm" onClick={resetTemplate} disabled={submit.isPending}>
                  恢复模板
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runSelfTest()}
                disabled={selfTesting || submit.isPending}
              >
                {selfTesting ? '自测中…' : '本地自测'}
              </Button>
              <Button onClick={() => submit.mutate()} disabled={submit.isPending} size="sm">
                {submit.isPending ? '提交中…' : '提交作业'}
              </Button>
            </div>
          </div>

          {integrityPolicy === 'exam_block' ? (
            <Card className="border-danger/40 bg-danger-soft/60 px-4 py-2.5 text-xs text-danger">
              严格防作弊模式：已禁用代码粘贴，且须经教师完成花名册核验后方可正式交卷。
              {pasteNotice ? `（${pasteNotice}）` : ''}
            </Card>
          ) : integrityPolicy === 'exam_warn' ? (
            <Card className="border-warning/40 bg-warning-soft/60 px-4 py-2 text-xs text-warning">
              考试监测模式：系统将记录编辑、粘贴与切换窗口操作供教师复核。
            </Card>
          ) : null}

          {tab === 'split' ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="max-h-[75dvh] overflow-y-auto">{statementCard}</div>
              <div>{editorCard}</div>
            </div>
          ) : showStatement ? (
            statementCard
          ) : (
            editorCard
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex h-fit flex-col gap-3 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-primary">正式评测状态</p>
              {assignment.data ? (
                <Badge tone="neutral">及格线 {assignment.data.pass_score}</Badge>
              ) : null}
            </div>
            {submit.isError ? (
              <p className="rounded-[var(--radius-sm)] bg-danger-soft/60 p-2.5 text-xs leading-relaxed text-danger">
                {(submit.error as Error).message}
              </p>
            ) : null}
            {submit.data ? (
              <p className="font-mono text-xs text-tertiary">
                第 {submit.data.attempt_no} 次提交 · {submit.data.public_code}
                {submit.data.late ? ' · 逾期提交' : ''}
              </p>
            ) : null}
            {grading.isLoading ? <Spinner label="查询评测结果" /> : null}
            {verdict ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    tone={
                      verdict.status === 'done'
                        ? verdict.passed
                          ? 'success'
                          : 'warning'
                        : verdict.status === 'system_error'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {verdict.status === 'done'
                      ? verdict.passed
                        ? '已通过'
                        : '未达标'
                      : verdict.status === 'system_error'
                        ? '系统异常，不计分'
                        : '评测中'}
                  </Badge>
                  {verdict.score !== null ? (
                    <p className="font-mono text-2xl font-semibold text-primary tabular-nums">
                      {verdict.score} <span className="text-xs font-normal text-tertiary">分</span>
                    </p>
                  ) : null}
                </div>
                {verdict.status === 'system_error' ? (
                  <p className="rounded-[var(--radius-sm)] bg-danger-soft/60 p-2 text-xs text-danger">
                    服务端出现临时异常，本次记录不会计为 0 分，请稍后重试或联系教师协助复判。
                  </p>
                ) : null}
                <GradingReport report={verdict.report_json} errorMessage={verdict.error_message} />
              </div>
            ) : !submit.data && !submit.isError ? (
              <p className="rounded-[var(--radius-md)] bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-tertiary">
                编写模型后建议先点击「本地自测」检查格式与公开样例，确认无误再正式交卷。
              </p>
            ) : null}
            <p className="mt-auto border-t border-subtle pt-2.5 text-[11px] leading-relaxed text-tertiary">
              正式成绩由云端隔离容器调用原生 PySCIPOpt 验证全部测试算例后写入。
            </p>
          </Card>

          {selfTesting || selfTestResult ? (
            <Card className="flex flex-col gap-2.5 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-primary">浏览器本地自测</p>
                <Badge tone={selfTestResult ? (selfTestResult.ok ? 'success' : 'danger') : 'neutral'}>
                  {selfTesting ? '运行中' : selfTestResult?.ok ? '样例通过' : '未通过'}
                </Badge>
              </div>
              {selfTesting && selfTestProgress ? <Spinner label={selfTestProgress.message} /> : null}
              {selfTestResult ? (
                <div className="flex flex-col gap-2 text-xs">
                  <p className={selfTestResult.ok ? 'text-secondary' : 'text-danger'}>
                    {selfTestResult.summary}
                  </p>
                  {selfTestResult.stdout ? (
                    <pre className="max-h-36 overflow-auto rounded-[var(--radius-sm)] bg-muted p-2.5 font-mono text-secondary">
                      {selfTestResult.stdout}
                    </pre>
                  ) : null}
                  {selfTestResult.error ? (
                    <pre className="max-h-36 overflow-auto rounded-[var(--radius-sm)] bg-danger-soft p-2.5 font-mono text-danger">
                      {selfTestResult.error}
                    </pre>
                  ) : null}
                </div>
              ) : null}
              <p className="text-[11px] text-tertiary">
                本地自测仅校验格式与公开教学样例，不计入正式成绩。
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
