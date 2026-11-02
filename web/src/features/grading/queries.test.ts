import { describe, expect, it, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
const from = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: () => ({ functions: { invoke }, from }),
}));

const { latestOf, listMySubmissions } = await import('@/features/grading/api');
const { listMyCourses } = await import('@/features/courses/api');

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = self;
  api.eq = self;
  api.order = self;
  api.limit = self;
  api.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return api;
}

describe('latestOf', () => {
  it('returns the newest grading by created_at', () => {
    const older = { id: 'a', status: 'done', score: 60, created_at: '2026-01-01T00:00:00Z' };
    const newer = { id: 'b', status: 'done', score: 95, created_at: '2026-02-01T00:00:00Z' };
    expect(latestOf([older, newer])?.id).toBe('b');
    expect(latestOf([newer, older])?.id).toBe('b');
  });

  it('handles an empty history without throwing', () => {
    expect(latestOf([])).toBeNull();
  });

  it('tolerates rows without a timestamp', () => {
    type Row = { id: string; status: string; created_at?: string };
    const noTime: Row = { id: 'x', status: 'queued' };
    const timed: Row = { id: 'y', status: 'done', created_at: '2026-01-01T00:00:00Z' };
    expect(latestOf<Row>([noTime, timed])?.id).toBe('y');
  });
});

describe('listMySubmissions', () => {
  beforeEach(() => from.mockReset());

  it('surfaces a query error instead of pretending the list is empty', async () => {
    from.mockReturnValue(chain({ data: null, error: { message: 'permission denied' } }));
    await expect(listMySubmissions()).rejects.toThrow('permission denied');
  });

  it('returns rows unchanged when the query succeeds', async () => {
    const rows = [
      { id: 's1', public_code: 'SUB-1', attempt_no: 1, gradings: [{ id: 'g1', status: 'done', score: 100 }] },
    ];
    from.mockReturnValue(chain({ data: rows, error: null }));
    await expect(listMySubmissions()).resolves.toEqual(rows);
  });
});

describe('listMyCourses', () => {
  beforeEach(() => from.mockReset());

  it('flattens the embedded course relation', async () => {
    from.mockReturnValue(
      chain({
        data: [
          { role: 'student', courses: { id: 'c1', name: '系统建模与仿真', code: 'SCIP2026A' } },
          { role: 'teacher', courses: { id: 'c2', name: '运筹学', code: null } },
        ],
        error: null,
      }),
    );
    await expect(listMyCourses()).resolves.toEqual([
      { id: 'c1', name: '系统建模与仿真', code: 'SCIP2026A', role: 'student' },
      { id: 'c2', name: '运筹学', code: null, role: 'teacher' },
    ]);
  });

  it('drops rows whose course relation is not visible', async () => {
    from.mockReturnValue(
      chain({ data: [{ role: 'student', courses: null }], error: null }),
    );
    await expect(listMyCourses()).resolves.toEqual([]);
  });

  it('throws on failure rather than showing an empty course list', async () => {
    from.mockReturnValue(chain({ data: null, error: { message: 'jwt expired' } }));
    await expect(listMyCourses()).rejects.toThrow('jwt expired');
  });
});
