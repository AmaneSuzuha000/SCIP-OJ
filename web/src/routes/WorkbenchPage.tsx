import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { CodeEditor } from '@/features/editor/CodeEditor';
import { latestGrading, newRequestKey, submitCode } from '@/features/grading/api';
import { useTheme } from '@/store/theme';

const TEMPLATE = [
  'def solve(instance):',
  '    """返回 {"objective": number, "solution": ...}。"""',
  '    # instance 已剔除最优值，不要尝试读取 optimal_value',
  '    raise NotImplementedError',
].join('\n');

export function WorkbenchPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const theme = useTheme((s) => s.theme);
  const [code, setCode] = useState(TEMPLATE);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  // One request key per attempt: retrying the same attempt must stay idempotent.
  const requestKey = useMemo(() => newRequestKey(), []);
  const dark = theme === 'dark';

  const submit = useMutation({
    mutationFn: () =>
      submitCode({ assignmentId: assignmentId as string, codeText: code, requestKey }),
    onSuccess: (receipt) => setSubmissionId(receipt.submission_id),
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

  if (!assignmentId) return <EmptyState title="缺少作业编号" />;

  const verdict = grading.data;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-primary">作答</h2>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? '提交中…' : '提交作业'}
          </Button>
        </div>
        <CodeEditor value={code} onChange={setCode} dark={dark} ariaLabel="作业代码编辑器" />
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm font-medium text-primary">评测状态</p>
        {submit.isError ? (
          <p className="text-xs leading-relaxed text-danger">{(submit.error as Error).message}</p>
        ) : null}
        {submit.data ? (
          <p className="text-xs text-tertiary">
            第 {submit.data.attempt_no} 次提交 · {submit.data.public_code}
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
                ? '已完成'
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
          </div>
        ) : null}
        <p className="mt-auto text-xs leading-relaxed text-tertiary">
          浏览器内只能看到格式与自测反馈；正式分数由隔离容器评测私有实例后写入。
        </p>
      </Card>
    </div>
  );
}
