import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
import { listMyCourses } from '@/features/courses/api';
import { latestOf, listAssignments, listAssignmentSubmissions } from '@/features/grading/api';

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '评测中',
  done: '已完成',
  system_error: '系统异常',
};

export function TeacherPage() {
  const [courseId, setCourseId] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);

  const courses = useQuery({ queryKey: ['my-courses'], queryFn: listMyCourses });
  const taught = useMemo(
    () => (courses.data ?? []).filter((course) => course.role === 'teacher'),
    [courses.data],
  );

  const assignments = useQuery({
    queryKey: ['assignments', courseId],
    queryFn: () => listAssignments(courseId as string),
    enabled: Boolean(courseId),
  });

  const submissions = useQuery({
    queryKey: ['submissions', assignmentId],
    queryFn: () => listAssignmentSubmissions(assignmentId as string),
    enabled: Boolean(assignmentId),
  });

  // One row per submission attempt. Which attempt counts toward the course
  // grade is a server decision (score_policy), not something this table derives.
  const rows = useMemo(() => submissions.data ?? [], [submissions.data]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-primary">教师控制台</h2>
        <p className="text-xs text-tertiary">
          只读视图。判分与录入仍走服务器流程，这里的任何操作都不会直接改成绩。
        </p>
      </div>

      {courses.isLoading ? <Spinner label="加载课程" /> : null}
      {!courses.isLoading && !taught.length ? (
        <EmptyState title="你名下还没有课程" hint="管理员把你设为授课教师后会出现" />
      ) : null}

      {taught.length ? (
        <Card className="flex flex-wrap items-center gap-2 p-4">
          <span className="text-xs text-tertiary">课程</span>
          {taught.map((course) => (
            <button
              key={course.id}
              onClick={() => {
                setCourseId(course.id);
                setAssignmentId(null);
              }}
              className={[
                'rounded-[var(--radius-md)] px-3 py-1.5 text-sm transition-colors',
                courseId === course.id
                  ? 'bg-brand text-white'
                  : 'bg-muted text-secondary hover:bg-hover',
              ].join(' ')}
            >
              {course.name}
            </button>
          ))}
        </Card>
      ) : null}

      {courseId ? (
        assignments.isLoading ? (
          <Spinner label="加载作业" />
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-tertiary">作业</span>
            <div className="flex flex-wrap gap-2">
              {(assignments.data ?? []).map((assignment) => (
                <button
                  key={assignment.id}
                  onClick={() => setAssignmentId(assignment.id)}
                  className={[
                    'rounded-[var(--radius-md)] border px-3 py-1.5 text-sm transition-colors',
                    assignmentId === assignment.id
                      ? 'border-brand bg-brand-soft text-brand'
                      : 'border-subtle text-secondary hover:bg-hover',
                  ].join(' ')}
                >
                  {assignment.problem_id}
                </button>
              ))}
            </div>
          </div>
        )
      ) : null}

      {assignmentId ? (
        submissions.isLoading ? (
          <Spinner label="加载提交" />
        ) : submissions.isError ? (
          <EmptyState title="无法读取提交" hint={(submissions.error as Error).message} />
        ) : !rows.length ? (
          <EmptyState title="这次作业还没有提交" />
        ) : (
          <Card className="divide-y divide-subtle">
            <div className="flex items-center gap-3 p-3 text-xs text-tertiary">
              <span className="flex-1">提交编号</span>
              <span className="w-20 text-center">尝试</span>
              <span className="w-20 text-center">状态</span>
              <span className="w-16 text-right">得分</span>
            </div>
            {rows.map((row) => {
              const latest = latestOf(row.gradings);
              return (
                <div key={row.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="flex-1 font-mono text-xs text-primary">{row.public_code}</span>
                  <span className="w-20 text-center text-xs text-tertiary">{row.attempt_no}</span>
                  <span className="w-20 text-center">
                    <Badge tone={latest?.status === 'done' ? 'success' : latest?.status === 'system_error' ? 'danger' : 'neutral'}>
                      {STATUS_LABEL[latest?.status ?? 'queued'] ?? latest?.status ?? '排队中'}
                    </Badge>
                  </span>
                  <span className="w-16 text-right font-semibold text-primary">
                    {latest?.score ?? '—'}
                  </span>
                </div>
              );
            })}
          </Card>
        )
      ) : null}
    </div>
  );
}
