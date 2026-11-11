import { describe, expect, it, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
const from = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: () => ({ functions: { invoke }, from }),
}));

const {
  submitCode,
  listAssignments,
  newRequestKey,
  extractEdgeError,
  createRequestKeyManager,
  regradeBatch,
} = await import('./api');

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

  it('extracts JSON error bodies from Edge Function Response context and falls back on non-JSON', async () => {
    const jsonResp = new Response(JSON.stringify({ error: '同一题目每 20 秒仅允许一次提交' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(extractEdgeError({ message: 'Edge Function returned a non-2xx status code', context: jsonResp })).resolves.toBe(
      '同一题目每 20 秒仅允许一次提交',
    );

    const htmlResp = new Response('<html>502 Bad Gateway</html>', { status: 502 });
    await expect(extractEdgeError({ message: 'gateway error', context: htmlResp })).resolves.toBe('gateway error');
  });

  it('reuses idempotency key across identical drafts and rotates on edit or confirmation', () => {
    const mgr = createRequestKeyManager();
    const k1 = mgr.keyFor('a1', 'def solve(i): pass');
    const k2 = mgr.keyFor('a1', 'def solve(i): pass');
    expect(k2).toBe(k1);

    const k3 = mgr.keyFor('a1', 'def solve(i): return {}');
    expect(k3).not.toBe(k1);

    mgr.confirmAndRotate();
    const k4 = mgr.keyFor('a1', 'def solve(i): return {}');
    expect(k4).not.toBe(k3);
  });

  it('chunks batch regrades into slices of 50 with distinct deterministic UUID request_keys', async () => {
    invoke
      .mockResolvedValueOnce({
        data: {
          ok: true,
          total: 50,
          success_count: 50,
          results: Array.from({ length: 50 }, (_, i) => ({ id: `sub-${i}`, success: true, grading_id: `g-${i}` })),
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          total: 5,
          success_count: 4,
          results: Array.from({ length: 5 }, (_, i) => ({
            id: `sub-${50 + i}`,
            success: i !== 4,
            error: i === 4 ? 'not done' : undefined,
          })),
        },
        error: null,
      });

    const ids = Array.from({ length: 55 }, (_, i) => `sub-${String(i).padStart(3, '0')}`);
    const res = await regradeBatch({
      submissionIds: [...ids].reverse(),
      reason: 'recheck',
      requestKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    const call1 = invoke.mock.calls[0]![1].body;
    const call2 = invoke.mock.calls[1]![1].body;
    expect(call1.submission_ids).toHaveLength(50);
    expect(call1.submission_ids[0]).toBe('sub-000');
    expect(call2.submission_ids).toHaveLength(5);
    expect(call2.submission_ids[4]).toBe('sub-054');
    expect(call1.request_key).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(call2.request_key).not.toBe(call1.request_key);
    expect(call2.request_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(res.total).toBe(55);
    expect(res.success_count).toBe(54);
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
