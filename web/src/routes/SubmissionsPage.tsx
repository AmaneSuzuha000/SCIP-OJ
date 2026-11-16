import { useMemo, useState } from 'react';
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

type StatusFilter = 'all' | 'done' | 'active' | 'system_error';

export function SubmissionsPage() {
  const session = useSession((s) => s.session);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const filtered = useMemo(() => {
    const rows = submissions.data ?? [];
    if (filter === 'all') return rows;
    return rows.filter((row) => {
      const status = latestOf(row.gradings)?.status ?? 'queued';
      if (filter === 'active') return status === 'queued' || status === 'running';
      return status === filter;
    });
  }, [submissions.data, filter]);

  if (!session) return <EmptyState title="请先登录" hint="登录后这里会显示你的提交记录" />;
  if (submissions.isLoading) return <Spinner label="加载提交记录" />;
  if (submissions.isError) {
    return <EmptyState title="无法读取提交记录" hint={(submissions.error as Error).message} />;
  }
  if (!submissions.data?.length) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-tight text-primary">提交记录</h2>
        <EmptyState title="还没有提交记录" hint="在课程作业中提交后，这里会显示每次评测的结果" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-primary">提交记录</h2>
          <p className="mt-0.5 text-xs text-tertiary">
            共 {submissions.data.length} 条正式提交，展开任意记录可查阅四维分项报告与源码快照
          </p>
        </div>

        <div className="inline-flex rounded-[var(--radius-md)] border border-subtle bg-muted/70 p-0.5 text-xs">
          {(
            [
              ['all', '全部'],
              ['done', '已完成'],
              ['active', '评测中'],
              ['system_error', '系统异常'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={
                'cursor-pointer rounded-[var(--radius-sm)] px-2.5 py-1 transition-all ' +
                (filter === key
                  ? 'bg-surface font-semibold text-primary shadow-[var(--shadow-sm)]'
                  : 'text-secondary hover:text-primary')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="该筛选条件下暂无记录" hint="切换上方状态筛选可查看其他提交" />
      ) : (
        <Card className="divide-y divide-subtle overflow-hidden">
          {filtered.map((row) => {
            const latest = latestOf(row.gradings);
            const status = latest?.status ?? 'queued';
            const expanded = selectedId === row.id;
            const detailLatest = detail.data && expanded ? latestOf(detail.data.gradings ?? []) : null;
            const isLate = Boolean((row.metadata as { late?: boolean } | null)?.late);
            return (
              <div key={row.id} className="flex flex-col gap-3 p-4 transition-colors hover:bg-raised/40">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-semibold text-primary">
                        {row.public_code}
                      </p>
                      <Badge tone={statusTone(status)}>{STATUS_LABEL[status] ?? status}</Badge>
                      {isLate ? <Badge tone="warning">逾期</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-tertiary">
                      第 {row.attempt_no} 次提交 · {new Date(row.created_at).toLocaleString('zh-CN')}
                    </p>
                  </div>

                  {latest?.score !== null && latest?.score !== undefined ? (
                    <span className="w-16 text-right font-mono text-base font-bold text-primary tabular-nums">
                      {latest.score} <span className="text-xs font-normal text-tertiary">分</span>
                    </span>
                  ) : (
                    <span className="w-16 text-right font-mono text-xs text-tertiary">—</span>
                  )}
                  <Button
                    variant={expanded ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setSelectedId(expanded ? null : row.id)}
                  >
                    {expanded ? '收起' : '详情'}
                  </Button>
                </div>

                {expanded ? (
                  <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-subtle bg-raised p-4">
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
                          <div className="mb-1.5 flex items-center justify-between">
                            <p className="text-xs font-semibold text-secondary">提交代码</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                void navigator.clipboard?.writeText(detail.data?.code_text ?? '');
                                setCopiedId(row.id);
                                setTimeout(() => setCopiedId((cur) => (cur === row.id ? null : cur)), 1500);
                              }}
                            >
                              {copiedId === row.id ? '已复制' : '复制代码'}
                            </Button>
                          </div>
                          <pre className="max-h-64 overflow-auto rounded-[var(--radius-md)] border border-subtle bg-surface p-3.5 font-mono text-xs leading-relaxed text-secondary">
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
      )}
      <p className="text-xs text-tertiary">
        若状态显示为「系统异常」，表示评测服务临时波动，本次结果不计入成绩，可稍候重提或联系教师协助复判。
      </p>
    </div>
  );
}
