import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

/**
 * Account switching must not let a slow response from the previous account win.
 *
 * The old vanilla shell had a test for this (tests/test_auth_context.mjs) that
 * went with the portal. The property still matters: sign out and back in as
 * someone else, and the first account's profile and admission verdict must not
 * land on the second account's session.
 */
const state = vi.hoisted(() => ({
  handlers: [] as ((event: string, session: unknown) => void)[],
  pending: [] as { resolve: (v: unknown) => void; userId: string }[],
  session: null as unknown,
}));

vi.mock('@/lib/supabase', () => {
  const makeClient = () => ({
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        state.handlers.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    rpc: async () => ({ data: true, error: null }),
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: () =>
            new Promise((resolve) => {
              state.pending.push({ resolve, userId: id });
            }),
        }),
      }),
    }),
  });
  return { supabase: () => makeClient() };
});

vi.mock('@/store/session', async () => {
  const actual = await vi.importActual<typeof import('@/store/session')>('@/store/session');
  return actual;
});

import { AppProviders } from '@/app/providers';
import { useSession } from '@/store/session';

function Sync() {
  const profile = useSession((s) => s.profile);
  return <span data-testid="name">{profile?.display_name ?? 'none'}</span>;
}

describe('account switching', () => {
  beforeEach(() => {
    state.handlers.length = 0;
    state.pending.length = 0;
    state.session = null;
    useSession.setState({ session: null, profile: null, access: 'unknown' });
  });

  it('ignores a previous account profile that resolves after the new one', async () => {
    render(
      <AppProviders>
        <Sync />
      </AppProviders>,
    );

    // start() is async: wait until it has subscribed before firing events.
    await waitFor(() => expect(state.handlers.length).toBe(1));

    // Sign in as the first account, then the second, before either resolves.
    await act(async () => {
      state.handlers[0]!('SIGNED_IN', { user: { id: 'old' } });
      state.handlers[0]!('SIGNED_IN', { user: { id: 'new' } });
    });

    await waitFor(() => expect(state.pending.length).toBe(2));
    const forOld = state.pending.find((p) => p.userId === 'old')!;
    const forNew = state.pending.find((p) => p.userId === 'new')!;

    // The new account answers first, the old one straggles in afterwards.
    await act(async () => {
      forNew.resolve({ data: { user_id: 'new', display_name: '新同学', role: 'student' }, error: null });
    });
    await act(async () => {
      forOld.resolve({ data: { user_id: 'old', display_name: '旧同学', role: 'teacher' }, error: null });
    });

    await waitFor(() => {
      expect(useSession.getState().profile?.display_name).toBe('新同学');
    });
  });
});
