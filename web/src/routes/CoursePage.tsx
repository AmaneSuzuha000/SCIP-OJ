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

  const assignments = useQuery({
    queryKey: ['assignments', courseId],
    queryFn: () => listAssignments(courseId as string),
    enabled: Boolean(courseId),
  });

  const leaderboard = useQuery({
    queryKey: ['leaderboard', courseId],
    queryFn: () => listCourseLeaderboard(courseId as string),
    enabled: Boolean(courseId),
  });

  if (!courseId) return <EmptyState title="缺少课程编号" />;
  if (assignments.isLoading) return <Spinner />;
  if (assignments.isError) {
    return <EmptyState title="无法读取作业列表" hint={(assignments.error as Error).message} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/" className="w-fit text-xs text-brand hover:underline">
          ← 返回我的课程
        </Link>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-primary">课程作业</h1>
          {assignments.data?.length ? (
            <span className="text-xs text-tertiary">共 {assignments.data.length} 项作业</span>
          ) : null}
        </div>
        {!assignments.data?.length ? (
          <EmptyState title="这门课程还没有已发布的作业" hint="教师发布后会自动出现在这里" />
        ) : (
          <div className="flex flex-col gap-3">
            {assignments.data.map((a) => {
              const stmt = findStatement(a.problem_id);
              const integrity = INTEGRITY_LABEL[a.integrity_policy];
              return (
                <Link
                  key={a.id}
                  to={'/workbench/' + a.id + '?problem=' + encodeURIComponent(a.problem_id)}
                  className="group"
                >
                  <Card className="flex items-center justify-between gap-3 p-4 transition-all duration-[var(--duration-fast)] group-hover:-translate-y-0.5 group-hover:border-brand/40 group-hover:shadow-[var(--shadow-md)]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-primary group-hover:text-brand">
                          {a.problem_id}
                          {stmt ? ` · ${stmt.title}` : ''}
                        </p>
                        {integrity ? <Badge tone={integrity.tone}>{integrity.text}</Badge> : null}
                      </div>
                      <p className="mt-1.5 text-xs text-tertiary">
                        及格线 {a.pass_score} 分 · {a.n_instances} 组测试算例
                        {a.score_policy ? ' · ' + (POLICY_LABEL[a.score_policy] ?? a.score_policy) : ''}
                        {a.due_at ? ' · 截止 ' + new Date(a.due_at).toLocaleString('zh-CN') : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-brand">进入作答 →</span>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">课程排行榜</h2>
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
                <tr className="border-b border-subtle bg-muted/60 text-left text-xs">
                  <th className="px-3 py-2.5 font-medium text-secondary">排名</th>
                  <th className="px-3 py-2.5 font-medium text-secondary">学号</th>
                  <th className="px-3 py-2.5 font-medium text-secondary">姓名</th>
                  <th className="px-3 py-2.5 font-medium text-secondary">有效得分</th>
                  <th className="px-3 py-2.5 font-medium text-secondary">提交数</th>
                  <th className="px-3 py-2.5 font-medium text-secondary">状态</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.data.map((row, idx) => (
                  <tr
                    key={`${row.student_no_masked}-${idx}`}
                    className="border-b border-subtle last:border-0 hover:bg-muted/35"
                  >
                    <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
                      {idx < 3 ? (
                        <Badge tone="brand">#{idx + 1}</Badge>
                      ) : (
                        <span className="text-tertiary">#{idx + 1}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-secondary tabular-nums">
                      {row.student_no_masked}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-primary">{row.display_name ?? '未命名'}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-primary tabular-nums">
                      {row.best_score} 分
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-tertiary tabular-nums">
                      {row.attempt_count}
                    </td>
                    <td className="px-3 py-2.5">
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
