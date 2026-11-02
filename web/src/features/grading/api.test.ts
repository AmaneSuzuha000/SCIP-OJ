import { describe, expect, it, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
const from = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: () => ({ functions: { invoke }, from }),
}));

const { submitCode, listAssignments, newRequestKey } = await import('./api');

describe('grading api', () => {
  beforeEach(() => {
    invoke.mockReset();
    from.mockReset();
  });

  it('sends the idempotency key and integrity signals to submit-assignment', async () => {
    invoke.mockResolvedValue({ data: { ok: true, submission_id: 's1' }, error: null });
    await submitCode({
      assignmentId: 'a1',
      codeText: 'def solve(i): return {}',
      requestKey: '11111111-1111-4111-8111-111111111111',
      clientIntegrity: {
        elapsed_seconds: 12,
        input_events: 3,
        paste_events: 0,
        blocked_pastes: 0,
        copy_events: 0,
        drop_events: 0,
        hidden_events: 0,
      },
    });
    expect(invoke).toHaveBeenCalledWith('submit-assignment', {
      body: {
        assignment_id: 'a1',
        code_text: 'def solve(i): return {}',
        request_key: '11111111-1111-4111-8111-111111111111',
        client_integrity: expect.objectContaining({ blocked_pastes: 0 }),
      },
    });
  });

  it('surfaces the edge function error message instead of returning empty data', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: '两次正式提交需至少间隔 20 秒' } });
    await expect(
      submitCode({ assignmentId: 'a1', codeText: 'x', requestKey: newRequestKey() }),
    ).rejects.toThrow('两次正式提交需至少间隔 20 秒');
  });

  it('throws on a failed assignment query rather than rendering an empty list', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }) }),
      }),
    });
    await expect(listAssignments('c1')).rejects.toThrow('permission denied');
  });

  it('generates distinct request keys', () => {
    expect(newRequestKey()).not.toBe(newRequestKey());
  });
});
