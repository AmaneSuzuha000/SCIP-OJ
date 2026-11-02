import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
import { latestOf, listMySubmissions } from '@/features/grading/api';
import { useSession } from '@/store/session';

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '评测中',
  done: '已完成',
  system_error: '系统异常',
};

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'done') return 'success';
  if (status === 'system_error') return 'danger';
  return 'neutral';
}

export function SubmissionsPage() {
  const session = useSession((s) => s.session);
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
          return (
            <div key={row.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-primary">{row.public_code}</p>
                <p className="text-xs text-tertiary">
                  第 {row.attempt_no} 次提交 · {new Date(row.created_at).toLocaleString('zh-CN')}
                </p>
              </div>
              <Badge tone={statusTone(status)}>{STATUS_LABEL[status] ?? status}</Badge>
              {latest?.score !== null && latest?.score !== undefined ? (
                <span className="w-16 text-right text-sm font-semibold text-primary">
                  {latest.score} 分
                </span>
              ) : (
                <span className="w-16 text-right text-xs text-tertiary">—</span>
              )}
            </div>
          );
        })}
      </Card>
      <p className="text-xs text-tertiary">
        「系统异常」是基础设施故障，不计入成绩；请稍后重试或联系教师。
      </p>
    </div>
  );
}
