import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
import { listAssignments, listCourseLeaderboard } from '@/features/grading/api';
import { findStatement } from '@/features/problems/statements';

const INTEGRITY_LABEL: Record<string, { text: string; tone: 'neutral' | 'warning' | 'danger' }> = {
  exam_warn: { text: '考试监测', tone: 'warning' },
  exam_block: { text: '严格禁贴 · 需核验', tone: 'danger' },
};

const POLICY_LABEL: Record<string, string> = {
  highest_before_due: '截止前最高分',
  latest: '最后一次有效',
  highest: '历史最高分',
};

export function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const [lbProblem, setLbProblem] = useState<string>('ALL');

  useEffect(() => {
    setLbProblem('ALL');
  }, [courseId]);

  const assignments = useQuery({
    queryKey: ['assignments', courseId],
    queryFn: () => listAssignments(courseId as string),
    enabled: Boolean(courseId),
  });

  const leaderboard = useQuery({
    queryKey: ['leaderboard', courseId, lbProblem],
    queryFn: () =>
      listCourseLeaderboard(courseId as string, lbProblem === 'ALL' ? undefined : lbProblem),
    enabled: Boolean(courseId),
  });

  if (!courseId) return <EmptyState title="缺少课程编号" />;
  if (assignments.isLoading) return <Spinner label="读取课程作业" />;
  if (assignments.isError) {
    return <EmptyState title="无法读取作业列表" hint={(assignments.error as Error).message} />;
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <Link to="/" className="w-fit text-xs font-medium text-brand hover:underline">
          ← 返回我的课程
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-primary">课程作业</h1>
            <p className="mt-0.5 text-xs text-tertiary">
              点击任一题目进入在线建模工作台，支持浏览器本地自测与云端正式评测
            </p>
          </div>
          {assignments.data?.length ? (
            <Badge tone="brand">共 {assignments.data.length} 项作业</Badge>
          ) : null}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        {!assignments.data?.length ? (
          <EmptyState title="这门课程还没有已发布的作业" hint="教师发布后会自动出现在这里" />
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2">
            {assignments.data.map((a) => {
              const stmt = findStatement(a.problem_id);
              const integrity = INTEGRITY_LABEL[a.integrity_policy];
              return (
                <Link
                  key={a.id}
                  to={'/workbench/' + a.id + '?problem=' + encodeURIComponent(a.problem_id)}
                  className="group"
                >
                  <Card className="flex h-full flex-col justify-between gap-4 p-5 transition-all duration-[var(--duration-fast)] group-hover:-translate-y-0.5 group-hover:border-brand/45 group-hover:shadow-[var(--shadow-md)]">
                    <div className="flex flex-col gap-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="rounded-[var(--radius-sm)] border border-brand/20 bg-brand-soft px-2 py-0.5 font-mono text-xs font-semibold text-brand">
                          {a.problem_id}
                        </span>
                        {integrity ? (
                          <Badge tone={integrity.tone}>{integrity.text}</Badge>
                        ) : (
                          <Badge tone="neutral">常规提交</Badge>
                        )}
                      </div>
                      <p className="text-base font-semibold text-primary group-hover:text-brand">
                        {stmt ? stmt.title : a.problem_id}
                      </p>
                      <div className="flex flex-wrap gap-1.5 text-[11px] text-secondary">
                        <span className="rounded-[var(--radius-sm)] bg-muted px-2 py-0.5 font-mono">
                          及格线 {a.pass_score} 分
                        </span>
                        <span className="rounded-[var(--radius-sm)] bg-muted px-2 py-0.5 font-mono">
                          {a.n_instances} 组算例
                        </span>
                        {a.score_policy ? (
                          <span className="rounded-[var(--radius-sm)] bg-muted px-2 py-0.5">
                            {POLICY_LABEL[a.score_policy] ?? a.score_policy}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-subtle pt-3 text-xs">
                      <span className="text-tertiary">
                        {a.due_at
                          ? '截止 ' + new Date(a.due_at).toLocaleString('zh-CN')
                          : '无固定截止时间'}
                      </span>
                      <span className="font-medium text-brand">进入作答 →</span>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-primary">课程排行榜</h2>
            {assignments.data && assignments.data.length > 0 ? (
              <div className="inline-flex rounded-[var(--radius-md)] border border-subtle bg-muted/70 p-0.5 text-xs">
                {(['ALL', ...assignments.data.map((a) => a.problem_id)] as const).map((pid) => (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => setLbProblem(pid)}
                    className={
                      'cursor-pointer rounded-[var(--radius-sm)] px-2.5 py-1 transition-all ' +
                      (lbProblem === pid
                        ? 'bg-surface font-semibold text-primary shadow-[var(--shadow-sm)]'
                        : 'text-secondary hover:text-primary')
                    }
                  >
                    {pid === 'ALL' ? '综合' : pid}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="text-xs text-tertiary">学号已在服务端脱敏处理，仅展示在籍学生正式成绩</span>
        </div>
        {leaderboard.isLoading ? (
          <Spinner label="加载排行榜" />
        ) : leaderboard.isError ? (
          <EmptyState title="暂时无法加载排行榜" hint={(leaderboard.error as Error).message} />
        ) : !leaderboard.data?.length ? (
          <EmptyState title="暂无上榜记录" hint="完成正式提交并评测得分后将在这里展示" />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-subtle bg-raised text-left text-xs">
                  <th className="px-4 py-3 font-semibold text-secondary">排名</th>
                  <th className="px-4 py-3 font-semibold text-secondary">学号</th>
                  <th className="px-4 py-3 font-semibold text-secondary">姓名</th>
                  <th className="px-4 py-3 font-semibold text-secondary">有效得分</th>
                  <th className="px-4 py-3 font-semibold text-secondary">提交数</th>
                  <th className="px-4 py-3 font-semibold text-secondary">状态</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.data.map((row, idx) => (
                  <tr
                    key={`${row.student_no_masked}-${idx}`}
                    className="border-b border-subtle last:border-0 hover:bg-raised/70"
                  >
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {idx < 3 ? (
                        <Badge tone={idx === 0 ? 'warning' : 'brand'}>#{idx + 1}</Badge>
                      ) : (
                        <span className="text-tertiary">#{idx + 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-secondary tabular-nums">
                      {row.student_no_masked}
                    </td>
                    <td className="px-4 py-3 font-medium text-primary">{row.display_name ?? '未命名'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-12 font-mono font-semibold text-primary tabular-nums">
                          {row.best_score} 分
                        </span>
                        <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block">
                          <div
                            className={`h-full rounded-full ${row.passed ? 'bg-success' : 'bg-brand'}`}
                            style={{ width: `${Math.max(0, Math.min(100, row.best_score))}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-tertiary tabular-nums">
                      {row.attempt_count}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={row.passed ? 'success' : 'neutral'}>
                        {row.passed ? '已达标' : '继续加油'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
