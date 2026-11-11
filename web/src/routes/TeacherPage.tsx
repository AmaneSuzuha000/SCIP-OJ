import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { Dialog, Field, TextInput } from '@/components/Dialog';
import { GradingReport } from '@/components/GradingReport';
import { listMyCourses } from '@/features/courses/api';
import {
  latestOf,
  listAssignments,
  regradeBatch,
  regradeSubmission,
} from '@/features/grading/api';
import { findStatement } from '@/features/problems/statements';
import {
  confirmIdentity,
  exportGradebookCsv,
  getInviteCode,
  getTeacherGradebook,
  importRoster,
  listRoster,
  listTeacherAssignmentSubmissions,
  parseRosterCsv,
  publishAssignment,
  rotateInviteCode,
  type TeacherSubmissionRow,
} from '@/features/teacher/api';

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '评测中',
  done: '已完成',
  system_error: '系统异常',
};

const SCORE_POLICY_LABEL: Record<string, string> = {
  highest_before_due: '截止前最高分',
  latest: '最后一次有效',
  highest: '历史最高分',
};

const INTEGRITY_LABEL: Record<string, string> = {
  standard: '常规提交',
  exam_warn: '考试监测',
  exam_block: '严格禁贴（需核验）',
};

const PROBLEM_OPTIONS = [
  { id: 'P001', label: 'P001 · 0-1 背包问题' },
  { id: 'P002', label: 'P002 · 指派优化问题' },
] as const;

type Tab = 'invite' | 'roster' | 'assignments' | 'grading';

/**
 * The teacher console.
 *
 * Four jobs, one per tab: hand out the invitation code, reconcile the roster
 * against who has actually signed in, publish/configure assignments, and manage
 * grades & regrades. Every write goes through RPCs or Edge Functions that
 * re-check staff permissions in PostgreSQL.
 */
export function TeacherPage() {
  const [courseId, setCourseId] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('invite');

  const courses = useQuery({ queryKey: ['my-courses'], queryFn: listMyCourses });
  const taught = useMemo(
    () =>
      (courses.data ?? []).filter(
        (course) => course.role === 'teacher' || course.role === 'ta' || course.role === 'admin',
      ),
    [courses.data],
  );
  // Default to the first course once the list arrives, so the page is usable
  // without a selection step the teacher has to discover.
  const activeCourse = courseId ?? taught[0]?.id ?? null;
  const activeCourseObj = taught.find((c) => c.id === activeCourse);

  const assignments = useQuery({
    queryKey: ['assignments', activeCourse],
    queryFn: () => listAssignments(activeCourse as string),
    enabled: Boolean(activeCourse),
  });

  if (courses.isLoading) return <Spinner label="正在读取课程" />;
  if (courses.error) {
    return <EmptyState title="无法读取课程" hint={(courses.error as Error).message} />;
  }
  if (taught.length === 0) {
    return <EmptyState title="你名下还没有课程" hint="管理员把你设为授课教师或助教后会出现" />;
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

      <div className="flex gap-1 overflow-x-auto border-b border-subtle">
        {(
          [
            ['invite', '邀请码'],
            ['roster', '花名册与核验'],
            ['assignments', '作业发布'],
            ['grading', '提交与成绩'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ' +
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
      {activeCourse && tab === 'assignments' ? (
        <AssignmentPanel courseId={activeCourse} assignments={assignments.data ?? []} />
      ) : null}
      {activeCourse && tab === 'grading' ? (
        <GradingPanel
          courseId={activeCourse}
          courseCode={activeCourseObj?.code ?? undefined}
          assignments={assignments.data ?? []}
          assignmentId={assignmentId}
          onSelectAssignment={setAssignmentId}
        />
      ) : null}
    </div>
  );
}

function AssignmentPanel({
  courseId,
  assignments,
}: {
  courseId: string;
  assignments: Awaited<ReturnType<typeof listAssignments>>;
}) {
  const queryClient = useQueryClient();
  const [problemId, setProblemId] = useState<string>('P001');
  const [passScore, setPassScore] = useState<string>('90');
  const [nInstances, setNInstances] = useState<string>('3');
  const [scorePolicy, setScorePolicy] = useState<'highest_before_due' | 'latest' | 'highest'>(
    'highest_before_due',
  );
  const [integrityPolicy, setIntegrityPolicy] = useState<'standard' | 'exam_warn' | 'exam_block'>(
    'standard',
  );
  const [dueAt, setDueAt] = useState<string>('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () => {
      const parsedDue = dueAt.trim() ? new Date(dueAt).toISOString() : null;
      return publishAssignment({
        courseId,
        problemId,
        passScore: Number(passScore),
        nInstances: Number(nInstances),
        scorePolicy,
        integrityPolicy,
        dueAt: parsedDue,
      });
    },
    onSuccess: async (res) => {
      setFeedback(res.message || '作业发布成功');
      await queryClient.invalidateQueries({ queryKey: ['assignments', courseId] });
      await queryClient.invalidateQueries({ queryKey: ['teacher-gradebook', courseId] });
    },
    onError: (err) => setFeedback(err instanceof Error ? err.message : '发布失败'),
  });

  function loadForEdit(a: (typeof assignments)[number]) {
    setProblemId(a.problem_id);
    setPassScore(String(a.pass_score));
    setNInstances(String(a.n_instances));
    setScorePolicy(a.score_policy ?? 'highest_before_due');
    setIntegrityPolicy(a.integrity_policy);
    if (a.due_at) {
      const d = new Date(a.due_at);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setDueAt(local);
    } else {
      setDueAt('');
    }
    setFeedback(`已载入 ${a.problem_id} 的当前配置，修改后保存即可更新`);
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-sm font-semibold text-primary">发布 / 调整课程作业</h3>
          <p className="mt-1 text-xs text-tertiary">
            同一班级下每道题目对应一份配置；重新发布会更新截止时间、实例数量和考试策略。
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-primary">题目</span>
            <select
              value={problemId}
              onChange={(e) => setProblemId(e.target.value)}
              className="rounded-[var(--radius-md)] border border-subtle bg-surface px-3 py-2 text-sm text-primary"
            >
              {PROBLEM_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <Field label="及格分数线 (0-100)">
            <TextInput
              type="number"
              min={0}
              max={100}
              value={passScore}
              onChange={(e) => setPassScore(e.target.value)}
            />
          </Field>

          <Field label="私有测试实例数 (1-20)">
            <TextInput
              type="number"
              min={1}
              max={20}
              value={nInstances}
              onChange={(e) => setNInstances(e.target.value)}
            />
          </Field>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-primary">计分策略</span>
            <select
              value={scorePolicy}
              onChange={(e) =>
                setScorePolicy(e.target.value as 'highest_before_due' | 'latest' | 'highest')
              }
              className="rounded-[var(--radius-md)] border border-subtle bg-surface px-3 py-2 text-sm text-primary"
            >
              <option value="highest_before_due">截止前最高分</option>
              <option value="latest">最后一次有效</option>
              <option value="highest">历史最高分</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-primary">作答完整度模式</span>
            <select
              value={integrityPolicy}
              onChange={(e) =>
                setIntegrityPolicy(e.target.value as 'standard' | 'exam_warn' | 'exam_block')
              }
              className="rounded-[var(--radius-md)] border border-subtle bg-surface px-3 py-2 text-sm text-primary"
            >
              <option value="standard">常规提交</option>
              <option value="exam_warn">考试监测（记录粘贴与切屏）</option>
              <option value="exam_block">严格禁贴（需线下核验身份）</option>
            </select>
          </label>

          <Field label="截止时间（可选）">
            <TextInput
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>
            {publish.isPending ? '保存中…' : '保存并发布'}
          </Button>
          {feedback ? <span className="text-xs text-secondary">{feedback}</span> : null}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-primary">已发布作业 ({assignments.length})</h3>
        {assignments.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="尚未发布作业" hint="在上方表单选择题目即可发布给本班学生" />
          </div>
        ) : (
          <div className="mt-3 divide-y divide-subtle">
            {assignments.map((a) => {
              const stmt = findStatement(a.problem_id);
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm font-medium text-primary">
                      {a.problem_id}
                      {stmt ? ` · ${stmt.title}` : ''}
                    </p>
                    <p className="text-xs text-tertiary">
                      及格 {a.pass_score} · {a.n_instances} 组实例 ·{' '}
                      {SCORE_POLICY_LABEL[a.score_policy ?? 'highest_before_due'] ?? a.score_policy} ·{' '}
                      {INTEGRITY_LABEL[a.integrity_policy] ?? a.integrity_policy}
                      {a.due_at ? ' · 截止 ' + new Date(a.due_at).toLocaleString('zh-CN') : ''}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => loadForEdit(a)}>
                    编辑配置
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function GradingPanel({
  courseId,
  courseCode,
  assignments,
  assignmentId,
  onSelectAssignment,
}: {
  courseId: string;
  courseCode?: string;
  assignments: Awaited<ReturnType<typeof listAssignments>>;
  assignmentId: string | null;
  onSelectAssignment: (next: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [inspectRow, setInspectRow] = useState<TeacherSubmissionRow | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const gradebook = useQuery({
    queryKey: ['teacher-gradebook', courseId],
    queryFn: () => getTeacherGradebook(courseId),
  });

  const submissions = useQuery({
    queryKey: ['teacher-assignment-submissions', assignmentId],
    queryFn: () => listTeacherAssignmentSubmissions(assignmentId as string),
    enabled: Boolean(assignmentId),
  });

  const selectedAssignment = assignments.find((a) => a.id === assignmentId);

  const singleRegrade = useMutation({
    mutationFn: (submissionId: string) =>
      regradeSubmission({ submissionId, reason: '教师控制台单条复判' }),
    onSuccess: async () => {
      setActionMsg('复判请求已入队，完成后成绩单将自动更新');
      await queryClient.invalidateQueries({ queryKey: ['teacher-assignment-submissions', assignmentId] });
      await queryClient.invalidateQueries({ queryKey: ['teacher-gradebook', courseId] });
    },
    onError: (err) => setActionMsg(err instanceof Error ? err.message : '复判失败'),
  });

  const batchRegrade = useMutation({
    mutationFn: () =>
      regradeBatch({
        courseId,
        problemId: selectedAssignment?.problem_id,
        reason: '教师控制台整题批量复判',
      }),
    onSuccess: async (res) => {
      setActionMsg(`批量复判完成：成功入队 ${res.success_count}/${res.total} 条`);
      await queryClient.invalidateQueries({ queryKey: ['teacher-assignment-submissions', assignmentId] });
      await queryClient.invalidateQueries({ queryKey: ['teacher-gradebook', courseId] });
    },
    onError: (err) => setActionMsg(err instanceof Error ? err.message : '批量复判失败'),
  });

  function downloadCsv() {
    const csv = exportGradebookCsv(gradebook.data ?? []);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gradebook-${courseCode || courseId.slice(0, 8)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-primary">课程成绩簿</h3>
            <p className="text-xs text-tertiary">按有效计分策略汇总所有已选课学生与试验记录</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!gradebook.data?.length}
            onClick={downloadCsv}
          >
            导出 CSV 成绩单
          </Button>
        </div>

        {gradebook.isLoading ? (
          <Spinner label="读取成绩簿" />
        ) : gradebook.isError ? (
          <EmptyState title="无法读取成绩簿" hint={(gradebook.error as Error).message} />
        ) : !gradebook.data?.length ? (
          <EmptyState title="成绩簿为空" hint="学生选课并发布作业后会生成记录" />
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="px-3 py-2 font-medium text-primary">学号</th>
                  <th className="px-3 py-2 font-medium text-primary">姓名</th>
                  <th className="px-3 py-2 font-medium text-primary">题目</th>
                  <th className="px-3 py-2 font-medium text-primary">有效分</th>
                  <th className="px-3 py-2 font-medium text-primary">达标</th>
                  <th className="px-3 py-2 font-medium text-primary">提交数</th>
                </tr>
              </thead>
              <tbody>
                {gradebook.data.map((row) => (
                  <tr
                    key={`${row.user_id}-${row.assignment_id}`}
                    className="border-b border-subtle last:border-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-secondary">
                      {row.student_no ?? '未绑定'}
                    </td>
                    <td className="px-3 py-2 text-secondary">{row.display_name ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-secondary">{row.problem_id}</td>
                    <td className="px-3 py-2 font-semibold text-primary">
                      {row.best_score ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {row.passed === null ? (
                        <span className="text-xs text-tertiary">—</span>
                      ) : (
                        <Badge tone={row.passed ? 'success' : 'warning'}>
                          {row.passed ? '通过' : '未通过'}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-tertiary">{row.submission_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-primary">提交明细与复判</h3>
          {selectedAssignment ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={batchRegrade.isPending || !(submissions.data?.length)}
              onClick={() => batchRegrade.mutate()}
            >
              {batchRegrade.isPending ? '批量调度中…' : '整题批量复判'}
            </Button>
          ) : null}
        </div>

        <select
          value={assignmentId ?? ''}
          onChange={(event) => {
            setActionMsg(null);
            onSelectAssignment(event.target.value || null);
          }}
          className="mt-3 w-full rounded-[var(--radius-md)] border border-subtle bg-surface px-2 py-1.5 text-sm text-primary"
        >
          <option value="">选择作业</option>
          {assignments.map((assignment) => (
            <option key={assignment.id} value={assignment.id}>
              {assignment.problem_id}
              {assignment.due_at ? ' · 截止 ' + assignment.due_at.slice(0, 10) : ''}
            </option>
          ))}
        </select>

        {actionMsg ? <p className="mt-2 text-xs text-secondary">{actionMsg}</p> : null}

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
                    <th className="px-3 py-2 font-medium text-primary">操作</th>
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
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setInspectRow(row)}
                            >
                              查看
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={singleRegrade.isPending}
                              onClick={() => singleRegrade.mutate(row.id)}
                            >
                              复判
                            </Button>
                          </div>
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

      <Dialog
        open={Boolean(inspectRow)}
        title={inspectRow ? `提交详情 · ${inspectRow.public_code}` : '提交详情'}
        size="lg"
        onClose={() => setInspectRow(null)}
      >
        {inspectRow ? (
          <div className="flex flex-col gap-3">
            {(() => {
              const latest = latestOf(inspectRow.gradings ?? []);
              return (
                <>
                  <GradingReport
                    report={latest?.report_json}
                    errorMessage={latest?.error_message}
                  />
                  <div>
                    <p className="mb-1 text-xs font-medium text-tertiary">提交代码</p>
                    <pre className="max-h-72 overflow-auto rounded-[var(--radius-sm)] bg-muted p-3 font-mono text-xs text-secondary">
                      {inspectRow.code_text}
                    </pre>
                  </div>
                </>
              );
            })()}
          </div>
        ) : null}
      </Dialog>
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
