import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { Dialog, Field, TextInput } from '@/components/Dialog';
import { listMyCourses } from '@/features/courses/api';
import { latestOf, listAssignments, listAssignmentSubmissions } from '@/features/grading/api';
import {
  confirmIdentity,
  getInviteCode,
  importRoster,
  listRoster,
  parseRosterCsv,
  rotateInviteCode,
} from '@/features/teacher/api';

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '评测中',
  done: '已完成',
  system_error: '系统异常',
};

type Tab = 'invite' | 'roster' | 'grading';

/**
 * The teacher console.
 *
 * Three jobs, one per tab: hand out the invitation code, reconcile the roster
 * against who has actually signed in, and read submissions. Every write goes
 * through an RPC that re-checks the caller is a teacher of this course; the
 * tab visibility below is only so a teacher is not shown controls that would
 * fail.
 */
export function TeacherPage() {
  const queryClient = useQueryClient();
  const [courseId, setCourseId] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('invite');

  const courses = useQuery({ queryKey: ['my-courses'], queryFn: listMyCourses });
  const taught = useMemo(
    () => (courses.data ?? []).filter((course) => course.role === 'teacher'),
    [courses.data],
  );
  // Default to the first course once the list arrives, so the page is usable
  // without a selection step the teacher has to discover.
  const activeCourse = courseId ?? taught[0]?.id ?? null;

  const assignments = useQuery({
    queryKey: ['assignments', activeCourse],
    queryFn: () => listAssignments(activeCourse as string),
    enabled: Boolean(activeCourse),
  });

  const submissions = useQuery({
    queryKey: ['assignment-submissions', assignmentId],
    queryFn: () => listAssignmentSubmissions(assignmentId as string),
    enabled: Boolean(assignmentId),
  });

  if (courses.isLoading) return <Spinner label="正在读取课程" />;
  if (courses.error) {
    return <EmptyState title="无法读取课程" hint={(courses.error as Error).message} />;
  }
  if (taught.length === 0) {
    return <EmptyState title="你名下还没有课程" hint="管理员把你设为授课教师后会出现" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-primary">教师控制台</h2>
        <label className="flex items-center gap-2 text-sm text-secondary">
          当前班级
          <select
            value={activeCourse ?? ''}
            onChange={(event) => {
              setCourseId(event.target.value);
              setAssignmentId(null);
            }}
            className="rounded-[var(--radius-md)] border border-subtle bg-surface px-2 py-1.5 text-sm text-primary"
          >
            {taught.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-1 border-b border-subtle">
        {(
          [
            ['invite', '邀请码'],
            ['roster', '花名册与核验'],
            ['grading', '提交与成绩'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors ' +
              (tab === key
                ? 'border-[var(--brand-500)] font-medium text-primary'
                : 'border-transparent text-secondary hover:text-primary')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {activeCourse && tab === 'invite' ? <InvitePanel courseId={activeCourse} /> : null}
      {activeCourse && tab === 'roster' ? <RosterPanel courseId={activeCourse} /> : null}

      {tab === 'grading' ? (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-primary">提交与成绩</h3>
          <select
            value={assignmentId ?? ''}
            onChange={(event) => setAssignmentId(event.target.value || null)}
            className="mt-3 w-full rounded-[var(--radius-md)] border border-subtle bg-surface px-2 py-1.5 text-sm text-primary"
          >
            <option value="">选择作业</option>
            {(assignments.data ?? []).map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {assignment.problem_id}
                {assignment.due_at ? ' · 截止 ' + assignment.due_at.slice(0, 10) : ''}
              </option>
            ))}
          </select>

          <div className="mt-4">
            {!assignmentId ? (
              <EmptyState title="先选择一次作业" />
            ) : submissions.isLoading ? (
              <Spinner label="正在读取提交" />
            ) : submissions.error ? (
              <EmptyState title="无法读取提交" hint={(submissions.error as Error).message} />
            ) : (submissions.data ?? []).length === 0 ? (
              <EmptyState title="这次作业还没有提交" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted text-left">
                      <th className="px-3 py-2 font-medium text-primary">编号</th>
                      <th className="px-3 py-2 font-medium text-primary">次数</th>
                      <th className="px-3 py-2 font-medium text-primary">状态</th>
                      <th className="px-3 py-2 font-medium text-primary">分数</th>
                      <th className="px-3 py-2 font-medium text-primary">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(submissions.data ?? []).map((row) => {
                      const latest = latestOf(row.gradings ?? []);
                      return (
                        <tr key={row.id} className="border-b border-subtle last:border-0">
                          <td className="px-3 py-2 font-mono text-xs text-secondary">{row.public_code}</td>
                          <td className="px-3 py-2 text-secondary">{row.attempt_no}</td>
                          <td className="px-3 py-2 text-secondary">
                            {latest ? (STATUS_LABEL[latest.status] ?? latest.status) : '未评测'}
                          </td>
                          <td className="px-3 py-2 text-secondary">
                            {latest?.score === null || latest?.score === undefined ? '—' : latest.score}
                          </td>
                          <td className="px-3 py-2 text-xs text-tertiary">
                            {new Date(row.created_at).toLocaleString('zh-CN')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The invitation code.
 *
 * Rotation is a separate action because it invalidates the code already sent
 * to the class; folding it into "save" would make a typo in the code field
 * silently break every student who has not joined yet.
 */
function InvitePanel({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const code = useQuery({
    queryKey: ['invite-code', courseId],
    queryFn: () => getInviteCode(courseId),
  });

  const rotate = useMutation({
    mutationFn: () => rotateInviteCode(courseId, next.trim() || null),
    onSuccess: async (value) => {
      setNext('');
      setMessage('邀请码已更新为 ' + value);
      await queryClient.invalidateQueries({ queryKey: ['invite-code', courseId] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : '更新失败'),
  });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <p className="text-sm font-semibold text-primary">学生选课邀请码</p>
        <p className="mt-1 text-xs text-tertiary">
          把码发到班级群。不要把邀请码写进仓库或公开仓库的文档。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-[var(--radius-md)] bg-muted px-3 py-2 font-mono text-base text-primary">
          {code.isLoading ? '读取中…' : (code.data ?? '尚未生成')}
        </code>
        {code.data ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(code.data ?? '');
              setMessage('已复制');
            }}
          >
            复制邀请码
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="轮换为新码" hint="留空则由系统生成随机码">
          <TextInput
            value={next}
            onChange={(event) => setNext(event.target.value)}
            placeholder="留空自动生成"
            autoComplete="off"
          />
        </Field>
        <Button size="sm" disabled={rotate.isPending} onClick={() => rotate.mutate()}>
          {rotate.isPending ? '更新中…' : '轮换邀请码'}
        </Button>
      </div>
      {message ? <p className="text-xs text-secondary">{message}</p> : null}
    </Card>
  );
}

/**
 * Roster reconciliation.
 *
 * The distinction that matters to a teacher is "claimed" vs "verified": a
 * student who typed a matching number has claimed the row, but until a teacher
 * checks them against a photo ID in person the exam gate still refuses them.
 * Both states are shown separately rather than collapsed into one column.
 */
function RosterPanel({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const roster = useQuery({
    queryKey: ['roster', courseId],
    queryFn: () => listRoster(courseId),
  });

  const importMutation = useMutation({
    mutationFn: () => importRoster(courseId, parseRosterCsv(csv)),
    onSuccess: async (result) => {
      setCsv('');
      setImportOpen(false);
      setMessage('已导入 ' + result.inserted + ' 条，跳过 ' + result.skipped + ' 条');
      await queryClient.invalidateQueries({ queryKey: ['roster', courseId] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : '导入失败'),
  });

  const verify = useMutation({
    mutationFn: (input: { rosterId: string; userId: string }) =>
      confirmIdentity(input.rosterId, input.userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roster', courseId] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : '核验失败'),
  });

  if (roster.isLoading) return <Spinner label="正在读取花名册" />;
  if (roster.error) {
    return <EmptyState title="无法读取花名册" hint={(roster.error as Error).message} />;
  }
  const rows = roster.data ?? [];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-primary">花名册与身份核验</p>
          <p className="mt-1 text-xs text-tertiary">
            核验只意味着你线下确认过这名学生。未核验的账号在开考模式下不能交卷。
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
          导入名单
        </Button>
      </div>

      {message ? <p className="text-xs text-secondary">{message}</p> : null}

      {rows.length === 0 ? (
        <EmptyState title="还没有导入花名册" hint="导入后学生才能把学号与账号对上" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted text-left">
                <th className="px-3 py-2 font-medium text-primary">学号</th>
                <th className="px-3 py-2 font-medium text-primary">姓名</th>
                <th className="px-3 py-2 font-medium text-primary">认领</th>
                <th className="px-3 py-2 font-medium text-primary">核验</th>
                <th className="px-3 py-2 font-medium text-primary">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rosterId} className="border-b border-subtle last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-secondary">{row.studentNo}</td>
                  <td className="px-3 py-2 text-secondary">{row.displayName}</td>
                  <td className="px-3 py-2">
                    <Badge tone={row.status === 'matched' ? 'brand' : 'neutral'}>
                      {row.status === 'matched' ? '已认领' : '待绑定'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {row.verifiedAt ? (
                      <Badge tone="neutral">已核验</Badge>
                    ) : (
                      <span className="text-xs text-tertiary">未核验</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.status === 'matched' && row.matchedUserId && !row.verifiedAt ? (
                      <Button
                        size="sm"
                        disabled={verify.isPending}
                        onClick={() =>
                          verify.mutate({ rosterId: row.rosterId, userId: row.matchedUserId as string })
                        }
                      >
                        核验本人身份
                      </Button>
                    ) : (
                      <span className="text-xs text-tertiary">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={importOpen}
        title="导入花名册"
        description="每行一条：学号,真实姓名,GitHub用户名（可选）。可带表头。"
        onClose={() => (importMutation.isPending ? undefined : setImportOpen(false))}
        busy={importMutation.isPending}
      >
        <Field label="名单内容">
          <textarea
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            rows={6}
            placeholder={'20260001,李同学\n20260002,王同学,wangtongxue'}
            className="w-full rounded-[var(--radius-md)] border border-subtle bg-surface px-3 py-2 font-mono text-xs text-primary placeholder:text-tertiary focus:border-[var(--brand-500)] focus:outline-none"
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setImportOpen(false)}
            disabled={importMutation.isPending}
          >
            取消
          </Button>
          <Button
            size="sm"
            disabled={importMutation.isPending || !csv.trim()}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? '导入中…' : '确认导入'}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
