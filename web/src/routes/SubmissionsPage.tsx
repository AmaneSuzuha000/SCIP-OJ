import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { GradingReport } from '@/components/GradingReport';
import { getSubmissionDetail, latestOf, listMySubmissions } from '@/features/grading/api';
import { useSession } from '@/store/session';

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '评测中',
  done: '已完成',
  system_error: '系统异常',
};

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'brand' {
  if (status === 'done') return 'success';
  if (status === 'system_error') return 'danger';
  if (status === 'running') return 'brand';
  return 'neutral';
}

export function SubmissionsPage() {
  const session = useSession((s) => s.session);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const submissions = useQuery({
    queryKey: ['my-submissions'],
    queryFn: () => listMySubmissions(50),
    enabled: Boolean(session),
    // A queued attempt settles within seconds; poll only while one is open.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((row) => {
        const latest = latestOf(row.gradings);
        return latest?.status === 'queued' || latest?.status === 'running';
      })
        ? 3000
        : false,
  });

  const detail = useQuery({
    queryKey: ['submission-detail', selectedId],
    queryFn: () => getSubmissionDetail(selectedId as string),
    enabled: Boolean(session && selectedId),
  });

  if (!session) return <EmptyState title="请先登录" hint="登录后这里会显示你的提交记录" />;
  if (submissions.isLoading) return <Spinner label="加载提交记录" />;
  if (submissions.isError) {
    return <EmptyState title="无法读取提交记录" hint={(submissions.error as Error).message} />;
  }
  if (!submissions.data?.length) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-primary">提交记录</h2>
        <EmptyState title="还没有提交记录" hint="在课程作业中提交后，这里会显示每次评测的结果" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-primary">提交记录</h2>
      <Card className="divide-y divide-subtle">
        {submissions.data.map((row) => {
          const latest = latestOf(row.gradings);
          const status = latest?.status ?? 'queued';
          const expanded = selectedId === row.id;
          const detailLatest = detail.data && expanded ? latestOf(detail.data.gradings ?? []) : null;
          return (
            <div key={row.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm text-primary">{row.public_code}</p>
                  <p className="text-xs text-tertiary">
                    第 {row.attempt_no} 次提交 · {new Date(row.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
                <Badge tone={statusTone(status)}>{STATUS_LABEL[status] ?? status}</Badge>
                {latest?.score !== null && latest?.score !== undefined ? (
                  <span className="w-16 text-right font-mono text-sm font-semibold text-primary tabular-nums">
                    {latest.score} 分
                  </span>
                ) : (
                  <span className="w-16 text-right font-mono text-xs text-tertiary">—</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedId(expanded ? null : row.id)}
                >
                  {expanded ? '收起' : '详情'}
                </Button>
              </div>

              {expanded ? (
                <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-subtle bg-raised p-3">
                  {detail.isLoading ? (
                    <Spinner label="加载评测明细" />
                  ) : detail.isError ? (
                    <p className="text-xs text-danger">{(detail.error as Error).message}</p>
                  ) : detail.data ? (
                    <>
                      <GradingReport
                        report={detailLatest?.report_json}
                        errorMessage={detailLatest?.error_message}
                      />
                      <div>
                        <p className="mb-1 text-xs font-medium text-tertiary">提交代码</p>
                        <pre className="max-h-64 overflow-auto rounded-[var(--radius-sm)] bg-muted p-3 font-mono text-xs text-secondary">
                          {detail.data.code_text}
                        </pre>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>
      <p className="text-xs text-tertiary">
        若状态显示为「系统异常」，表示评测服务临时波动，本次结果不计入成绩，可稍候重提或联系教师复判。
      </p>
    </div>
  );
}
