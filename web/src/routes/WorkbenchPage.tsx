import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
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
  '    """返回 {"objective": number, "solution": ...}。"""',
  '    # instance 已剔除最优值，不要尝试读取 optimal_value',
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

type Tab = 'statement' | 'code';

export function WorkbenchPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const queryClient = useQueryClient();
  // Query param is a fast hint; getAssignment guarantees direct /workbench/:id works cleanly.
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
  const [tab, setTab] = useState<Tab>('statement');
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

  // Reset editor draft state cleanly when navigating across assignments.
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

  // Once statement/assignment finishes loading, upgrade unmodified starter code to problem template.
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
    setTab('code');
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
  }, [code, effectiveProblemId, selfTesting]);

  const resetTemplate = useCallback(() => {
    dirtyRef.current = false;
    clearDraft(assignmentId);
    setCode(initialTemplate);
    setPasteNotice(null);
  }, [assignmentId, initialTemplate]);

  if (!assignmentId) return <EmptyState title="缺少作业编号" />;

  const verdict = grading.data;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {(['statement', 'code'] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTab(name)}
                className={
                  'rounded-[var(--radius-md)] px-3 py-1.5 text-sm transition-colors ' +
                  (tab === name ? 'bg-muted font-medium text-primary' : 'text-secondary hover:bg-hover')
                }
              >
                {name === 'statement' ? '题目' : '代码'}
              </button>
            ))}
            {assignment.data ? (
              <span className="ml-2 text-xs text-tertiary">
                {assignment.data.problem_id} · 及格 {assignment.data.pass_score} ·{' '}
                {assignment.data.n_instances} 组私有实例
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'code' ? (
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
          <Card className="border-danger bg-danger-soft px-4 py-2.5 text-xs text-danger">
            严格防作弊模式：已禁用代码粘贴，且必须经教师核验身份后才能正式交卷。
            {pasteNotice ? `（${pasteNotice}）` : ''}
          </Card>
        ) : integrityPolicy === 'exam_warn' ? (
          <Card className="border-warning bg-warning-soft px-4 py-2 text-xs text-warning">
            考试监测模式：系统将记录编辑、粘贴与切屏行为供教师复核。
          </Card>
        ) : null}

        {tab === 'statement' ? (
          statement ? (
            <Card className="flex flex-col gap-3 p-6">
              <MarkdownCell source={statement.source} />
            </Card>
          ) : assignment.isLoading ? (
            <Spinner label="加载题目" />
          ) : (
            <EmptyState
              title="这道题没有内置题面"
              hint="以教师发布的作业说明为准；代码仍可在「代码」页编写并提交"
            />
          )
        ) : (
          <CodeEditor
            value={code}
            onChange={handleCodeChange}
            blockPaste={blockPaste}
            onSignal={handleSignal}
            ariaLabel="作业代码编辑器"
          />
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Card className="flex h-fit flex-col gap-3 p-4">
          <p className="text-sm font-medium text-primary">正式评测状态</p>
          {submit.isError ? (
            <p className="text-xs leading-relaxed text-danger">{(submit.error as Error).message}</p>
          ) : null}
          {submit.data ? (
            <p className="text-xs text-tertiary">
              第 {submit.data.attempt_no} 次提交 · {submit.data.public_code}
              {submit.data.late ? ' · 逾期提交' : ''}
            </p>
          ) : null}
          {grading.isLoading ? <Spinner label="查询评测结果" /> : null}
          {verdict ? (
            <div className="flex flex-col gap-2">
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
                <p className="text-2xl font-semibold text-primary">{verdict.score} 分</p>
              ) : null}
              {verdict.status === 'system_error' ? (
                <p className="text-xs text-danger">
                  这是基础设施故障，不是你的错误，成绩不会被记为 0 分。
                </p>
              ) : null}
              <GradingReport report={verdict.report_json} errorMessage={verdict.error_message} />
            </div>
          ) : null}
          <p className="mt-auto text-xs leading-relaxed text-tertiary">
            正式分数由隔离容器运行原生 PySCIPOpt 并与私有实例比对后写入。
          </p>
        </Card>

        {selfTesting || selfTestResult ? (
          <Card className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-primary">浏览器本地自测</p>
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
                  <pre className="max-h-36 overflow-auto rounded-[var(--radius-sm)] bg-muted p-2 font-mono text-secondary">
                    {selfTestResult.stdout}
                  </pre>
                ) : null}
                {selfTestResult.error ? (
                  <pre className="max-h-36 overflow-auto rounded-[var(--radius-sm)] bg-danger-soft p-2 font-mono text-danger">
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
  );
}
