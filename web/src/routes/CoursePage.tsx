import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, EmptyState, Spinner } from '@/components/ui';
import { listAssignments } from '@/features/grading/api';

export function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();

  const assignments = useQuery({
    queryKey: ['assignments', courseId],
    queryFn: () => listAssignments(courseId as string),
    enabled: Boolean(courseId),
  });

  if (!courseId) return <EmptyState title="缺少课程编号" />;
  if (assignments.isLoading) return <Spinner />;
  if (assignments.isError) {
    return <EmptyState title="无法读取作业列表" hint={(assignments.error as Error).message} />;
  }
  if (!assignments.data?.length) {
    return <EmptyState title="这门课程还没有已发布的作业" hint="教师发布后会自动出现在这里" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-primary">课程作业</h2>
      <div className="flex flex-col gap-3">
        {assignments.data.map((a) => (
          <Link key={a.id} to={'/workbench/' + a.id + '?problem=' + encodeURIComponent(a.problem_id)}>
            <Card className="flex items-center justify-between p-4 transition-shadow hover:shadow-[var(--shadow-md)]">
              <div>
                <p className="text-sm font-medium text-primary">{a.problem_id}</p>
                <p className="text-xs text-tertiary">
                  及格线 {a.pass_score} · {a.n_instances} 个私有实例
                  {a.due_at ? ' · 截止 ' + new Date(a.due_at).toLocaleString('zh-CN') : ''}
                </p>
              </div>
              <span className="text-xs text-brand">开始作答 →</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
