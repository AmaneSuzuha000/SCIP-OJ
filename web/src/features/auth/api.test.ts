import { describe, expect, it } from 'vitest';
import { parseSessionSnapshot } from '@/features/auth/api';

describe('parseSessionSnapshot', () => {
  it('reads the flat payload supabase-js writes to localStorage', () => {
    const raw = JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r1', expires_at: 1 });
    expect(parseSessionSnapshot(raw)).toEqual({ access_token: 'a.b.c', refresh_token: 'r1' });
  });

  it('reads the wrapped currentSession payload', () => {
    const raw = JSON.stringify({
      currentSession: { access_token: 'x', refresh_token: 'y' },
      expiresAt: 123,
    });
    expect(parseSessionSnapshot(raw)).toEqual({ access_token: 'x', refresh_token: 'y' });
  });

  it('rejects junk instead of adopting a half session', () => {
    expect(parseSessionSnapshot('not json')).toBeNull();
    expect(parseSessionSnapshot('{}')).toBeNull();
    expect(parseSessionSnapshot(JSON.stringify({ access_token: 'only' }))).toBeNull();
    expect(parseSessionSnapshot(JSON.stringify({ access_token: '', refresh_token: '' }))).toBeNull();
  });
});
