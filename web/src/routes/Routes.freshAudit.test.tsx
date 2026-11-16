import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAssignment: vi.fn(),
  listAssignments: vi.fn(),
  listAssignmentSubmissions: vi.fn(),
  listMySubmissions: vi.fn(),
  getSubmissionDetail: vi.fn(),
  latestGrading: vi.fn(),
  submitCode: vi.fn(),
  listCourseLeaderboard: vi.fn(),
  listMyCourses: vi.fn(),
  getInviteCode: vi.fn(),
  listTeacherAssignmentSubmissions: vi.fn(),
  getTeacherGradebook: vi.fn(),
}));

vi.mock('@/features/grading/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/grading/api')>();
  return {
    ...actual,
    getAssignment: mocks.getAssignment,
    listAssignments: mocks.listAssignments,
    listAssignmentSubmissions: mocks.listAssignmentSubmissions,
    listMySubmissions: mocks.listMySubmissions,
    getSubmissionDetail: mocks.getSubmissionDetail,
    latestGrading: mocks.latestGrading,
    submitCode: mocks.submitCode,
    listCourseLeaderboard: mocks.listCourseLeaderboard,
  };
});

vi.mock('@/features/courses/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/courses/api')>();
  return {
    ...actual,
    listMyCourses: mocks.listMyCourses,
  };
});

vi.mock('@/features/teacher/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/teacher/api')>();
  return {
    ...actual,
    getInviteCode: mocks.getInviteCode,
    listTeacherAssignmentSubmissions: mocks.listTeacherAssignmentSubmissions,
    getTeacherGradebook: mocks.getTeacherGradebook,
  };
});

const { WorkbenchPage } = await import('./WorkbenchPage');
const { CoursePage } = await import('./CoursePage');
const { TeacherPage } = await import('./TeacherPage');
const { LearnPage } = await import('./LearnPage');
const { SubmissionsPage } = await import('./SubmissionsPage');
const { useSession } = await import('@/store/session');

function renderWithQuery(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('fresh audit route fixes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
    try {
      globalThis.localStorage?.clear?.();
    } catch {
      // Ignore in runtimes without backing localStorage storage.
    }
  });

  it('WorkbenchPage loads prior submission verdict and sends reported_policy on submit', async () => {
    mocks.getAssignment.mockResolvedValue({
      id: 'a-exam',
      course_id: 'c-1',
      problem_id: 'P001',
      pass_score: 90,
      n_instances: 3,
      due_at: null,
      score_policy: 'highest_before_due',
      integrity_policy: 'exam_warn',
    });
    mocks.listAssignmentSubmissions.mockResolvedValue([
      {
        id: 'sub-prev',
        assignment_id: 'a-exam',
        attempt_no: 2,
        created_at: '2026-11-16T10:00:00Z',
        public_code: 'SUB-PREV0002',
        metadata: { late: true },
        gradings: [{ id: 'g-prev', submission_id: 'sub-prev', status: 'done', score: 95, passed: true }],
      },
    ]);
    mocks.latestGrading.mockResolvedValue({
      id: 'g-prev',
      submission_id: 'sub-prev',
      status: 'done',
      score: 95,
      passed: true,
      report_json: { messages: ['此前提交已评测通过'] },
      error_message: null,
    });
    mocks.submitCode.mockResolvedValue({
      ok: true,
      submission_id: 'sub-new',
      public_code: 'SUB-NEW00003',
      attempt_no: 3,
      grading_id: 'g-new',
      status: 'queued',
    });

    renderWithQuery(
      <MemoryRouter initialEntries={['/workbench/a-exam']}>
        <Routes>
          <Route path="/workbench/:assignmentId" element={<WorkbenchPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/最近提交：第 2 次 · SUB-PREV0002 · 逾期提交/)).toBeInTheDocument();
    expect(await screen.findByText('95')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提交作业' }));
    await waitFor(() => expect(mocks.submitCode).toHaveBeenCalledTimes(1));
    expect(mocks.submitCode.mock.calls[0]![0]).toMatchObject({
      assignmentId: 'a-exam',
      clientIntegrity: expect.objectContaining({
        reported_policy: 'exam_warn',
      }),
    });
  });

  it('CoursePage switches leaderboard filter between overall and specific problem_id', async () => {
    mocks.listAssignments.mockResolvedValue([
      {
        id: 'a1',
        course_id: 'c1',
        problem_id: 'P001',
        pass_score: 90,
        n_instances: 3,
        due_at: null,
        score_policy: 'highest_before_due',
        integrity_policy: 'standard',
      },
      {
        id: 'a2',
        course_id: 'c1',
        problem_id: 'P002',
        pass_score: 90,
        n_instances: 3,
        due_at: null,
        score_policy: 'highest_before_due',
        integrity_policy: 'standard',
      },
    ]);
    mocks.listCourseLeaderboard.mockResolvedValue([]);

    renderWithQuery(
      <MemoryRouter initialEntries={['/course/c1']}>
        <Routes>
          <Route path="/course/:courseId" element={<CoursePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.listCourseLeaderboard).toHaveBeenCalledWith('c1', undefined));
    fireEvent.click(await screen.findByRole('button', { name: 'P002' }));
    await waitFor(() => expect(mocks.listCourseLeaderboard).toHaveBeenCalledWith('c1', 'P002'));
  });

  it('TeacherPage inspect dialog renders late flag and integrity review counters', async () => {
    mocks.listMyCourses.mockResolvedValue([
      { id: 'c1', name: '运筹学与线性规划', code: 'OR2026', role: 'teacher' },
    ]);
    mocks.listAssignments.mockResolvedValue([
      {
        id: 'a1',
        course_id: 'c1',
        problem_id: 'P001',
        pass_score: 90,
        n_instances: 3,
        due_at: null,
        score_policy: 'highest_before_due',
        integrity_policy: 'exam_warn',
      },
    ]);
    mocks.getInviteCode.mockResolvedValue('OR-2026');
    mocks.getTeacherGradebook.mockResolvedValue([]);
    mocks.listTeacherAssignmentSubmissions.mockResolvedValue([
      {
        id: 's1',
        assignment_id: 'a1',
        attempt_no: 1,
        created_at: '2026-11-16T10:00:00Z',
        public_code: 'SUB-11112222',
        code_text: 'def solve(inst): return {"objective": 0, "solution": []}',
        metadata: {
          late: true,
          integrity: {
            policy: 'exam_warn',
            client_policy_matches: true,
            counters: {
              elapsed_seconds: 88,
              input_events: 42,
              paste_events: 1,
              blocked_pastes: 0,
              hidden_events: 2,
              drop_events: 0,
            },
          },
        },
        gradings: [
          {
            id: 'g1',
            submission_id: 's1',
            status: 'done',
            score: 100,
            passed: true,
            report_json: null,
            error_message: null,
            created_at: '2026-11-16T10:01:00Z',
          },
        ],
      },
    ]);

    renderWithQuery(
      <MemoryRouter>
        <TeacherPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '提交与成绩' }));
    const select = await screen.findByDisplayValue('选择作业');
    fireEvent.change(select, { target: { value: 'a1' } });
    fireEvent.click(await screen.findByRole('button', { name: '查看' }));

    expect(await screen.findByText('逾期提交')).toBeInTheDocument();
    expect(screen.getByText(/用时 88s · 编辑 42 · 粘贴 1 · 拦截粘贴 0 · 切屏 2/)).toBeInTheDocument();
  });

  it('LearnPage filters cases by category tab and search keyword', async () => {
    renderWithQuery(
      <MemoryRouter>
        <LearnPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '全部 (11)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '正式同款 (2)' }));
    expect(screen.queryByText(/铝材下料/)).toBeNull();
    expect(screen.getByText(/0-1 背包问题/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '专题拓展 (9)' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索建模案例' }), {
      target: { value: '铝材' },
    });
    expect(screen.getByText(/铝材下料/)).toBeInTheDocument();
    expect(screen.queryByText(/设施选址/)).toBeNull();
  });

  it('SubmissionsPage filters by grading status and expands detail view', async () => {
    useSession.setState({
      session: { user: { id: 'u-stu' } } as never,
      access: 'granted',
    });
    mocks.listMySubmissions.mockResolvedValue([
      {
        id: 's-done',
        assignment_id: 'a1',
        attempt_no: 2,
        created_at: '2026-11-16T10:00:00Z',
        public_code: 'SUB-DONE0001',
        metadata: null,
        gradings: [{ id: 'g1', submission_id: 's-done', status: 'done', score: 100, passed: true }],
      },
      {
        id: 's-err',
        assignment_id: 'a1',
        attempt_no: 1,
        created_at: '2026-11-16T09:00:00Z',
        public_code: 'SUB-ERR00001',
        metadata: { late: true },
        gradings: [{ id: 'g0', submission_id: 's-err', status: 'system_error', score: null, passed: null }],
      },
    ]);
    mocks.getSubmissionDetail.mockResolvedValue({
      id: 's-done',
      assignment_id: 'a1',
      attempt_no: 2,
      created_at: '2026-11-16T10:00:00Z',
      public_code: 'SUB-DONE0001',
      metadata: null,
      code_text: 'def solve(inst): return {"objective": 10, "solution": [1]}',
      gradings: [
        {
          id: 'g1',
          submission_id: 's-done',
          status: 'done',
          score: 100,
          passed: true,
          report_json: { messages: ['全部算例通过'] },
          error_message: null,
        },
      ],
    });

    renderWithQuery(
      <MemoryRouter>
        <SubmissionsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('SUB-DONE0001')).toBeInTheDocument();
    expect(screen.getByText('SUB-ERR00001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '系统异常' }));
    expect(screen.queryByText('SUB-DONE0001')).toBeNull();
    expect(screen.getByText('SUB-ERR00001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]!);
    expect(await screen.findByText('全部算例通过')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制代码' })).toBeInTheDocument();
  });
});
