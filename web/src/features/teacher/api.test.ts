import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: () => ({ rpc }),
}));

const {
  exportGradebookCsv,
  getInviteCode,
  parseRosterCsv,
  readAllPages,
} = await import('@/features/teacher/api');

/**
 * The roster import is the one place a teacher pastes text they did not
 * generate, so the parser has to be forgiving about separators, quoting and
 * headers -- but never so forgiving that it invents a student number.
 */
describe('roster CSV', () => {
  it('parses comma-separated rows with a header', () => {
    const rows = parseRosterCsv('学号,真实姓名,可选GitHub用户名\n20260001,李同学,litongxue\n20260002,王同学,wangtongxue');
    expect(rows).toEqual([
      { studentNo: '20260001', displayName: '李同学', githubLogin: 'litongxue' },
      { studentNo: '20260002', displayName: '王同学', githubLogin: 'wangtongxue' },
    ]);
  });

  it('strips UTF-8 BOM, unquotes cells, and supports alphanumeric student IDs', () => {
    const rows = parseRosterCsv('\uFEFF"学号","姓名","GitHub"\r\n"U20260001","张 ""小"" 明","zxm"\r\n"IE-2026-02","陈同学"');
    expect(rows).toEqual([
      { studentNo: 'U20260001', displayName: '张 "小" 明', githubLogin: 'zxm' },
      { studentNo: 'IE-2026-02', displayName: '陈同学', githubLogin: undefined },
    ]);
  });

  it('accepts semicolons and tabs as well as commas', () => {
    expect(parseRosterCsv('20260001;李同学')).toEqual([{ studentNo: '20260001', displayName: '李同学', githubLogin: undefined }]);
    expect(parseRosterCsv('20260001\t李同学')).toEqual([{ studentNo: '20260001', displayName: '李同学', githubLogin: undefined }]);
  });

  it('drops rows with no student number rather than guessing', () => {
    const rows = parseRosterCsv('20260001,李同学\n说明文字,不是学号\n,没有学号\nabcdef,纯字母不是学号');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.studentNo).toBe('20260001');
  });

  it('ignores blank lines and trailing whitespace', () => {
    expect(parseRosterCsv('\n\n20260001, 李同学 \n\n')).toEqual([
      { studentNo: '20260001', displayName: '李同学', githubLogin: undefined },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseRosterCsv('')).toEqual([]);
    expect(parseRosterCsv('\n\n')).toEqual([]);
  });
});

describe('teacher RPCs and CSV export', () => {
  beforeEach(() => rpc.mockReset());

  it('reads the course invite code via SECURITY DEFINER rpc instead of raw table select', async () => {
    rpc.mockResolvedValue({ data: 'IE2026JOIN', error: null });
    await expect(getInviteCode('course-uuid-1')).resolves.toBe('IE2026JOIN');
    expect(rpc).toHaveBeenCalledWith('get_course_invite_code', { p_course_id: 'course-uuid-1' });
  });

  it('prepends UTF-8 BOM and neutralizes CSV formula injection cells on gradebook export', () => {
    const csv = exportGradebookCsv([
      {
        course_id: 'c1',
        user_id: 'u1',
        student_no: '=cmd|"/c calc"!A0',
        display_name: '+李同学',
        assignment_id: 'a1',
        problem_id: 'P001',
        pass_score: 90,
        best_submission_id: 's1',
        best_score: 100,
        passed: true,
        submission_count: 1,
        attempt_count: 1,
        latest_submission_at: '2026-11-12T00:00:00Z',
        last_submitted_at: '2026-11-12T00:00:00Z',
      },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=cmd|""/c calc""!A0"');
    expect(csv).toContain("'+李同学");
  });
});

/**
 * PostgREST caps a select at 1000 rows and says nothing about it. The roster
 * feeds the gradebook export, so a class larger than the cap must not lose its
 * tail silently.
 */
describe('roster paging', () => {
  it('keeps reading until a short page comes back', async () => {
    const all = Array.from({ length: 1251 }, (_, id) => ({ id }));
    const seen: [number, number][] = [];
    const rows = await readAllPages(async (from, to) => {
      seen.push([from, to]);
      return all.slice(from, to + 1);
    }, 500);
    expect(rows).toHaveLength(1251);
    expect(seen).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
  });

  it('stops on the first short page instead of asking for another', async () => {
    let calls = 0;
    const rows = await readAllPages(async () => {
      calls += 1;
      return [{ id: 1 }];
    }, 500);
    expect(rows).toEqual([{ id: 1 }]);
    expect(calls).toBe(1);
  });

  it('returns empty for an empty roster', async () => {
    expect(await readAllPages(async () => [])).toEqual([]);
  });
});
