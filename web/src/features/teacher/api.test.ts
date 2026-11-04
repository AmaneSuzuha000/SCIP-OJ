import { describe, expect, it } from 'vitest';
import { parseRosterCsv, readAllPages } from '@/features/teacher/api';

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

  it('accepts semicolons and tabs as well as commas', () => {
    expect(parseRosterCsv('20260001;李同学')).toEqual([{ studentNo: '20260001', displayName: '李同学', githubLogin: undefined }]);
    expect(parseRosterCsv('20260001\t李同学')).toEqual([{ studentNo: '20260001', displayName: '李同学', githubLogin: undefined }]);
  });

  it('drops rows with no numeric student number rather than guessing', () => {
    const rows = parseRosterCsv('20260001,李同学\n说明文字,不是学号\n,没有学号');
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
