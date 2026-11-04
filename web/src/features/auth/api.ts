import { supabase } from '@/lib/supabase';

/**
 * GitHub is the only identity provider: the site whitelist keys on the numeric
 * GitHub id (auth.identities.provider_id), so any other provider cannot be
 * admitted by the server.
 */
export function redirectTarget(): string {
  // Must include the deployment prefix. On a project page the app lives at
  // /<repo>/, so origin + '/auth/callback' points at the user's root site,
  // which is a different deployment entirely -- GitHub sends the student
  // there, and they land back on whatever else is published under the origin.
  const base = import.meta.env.BASE_URL || '/';
  return new URL(base + 'auth/callback', window.location.origin).href;
}

export async function signInWithGitHub(): Promise<void> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: redirectTarget(), scopes: 'read:user' },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase().auth.signOut();
  if (error) throw new Error(error.message);
}

export interface SessionSnapshot {
  access_token: string;
  refresh_token: string;
}

/**
 * Parse what Supabase stores in localStorage, under the key
 * 'sb-<project-ref>-auth-token'.
 *
 * This exists because a Supabase project only redirects back to origins listed
 * in its Redirect URLs; anything else falls back to the Site URL. On a machine
 * where localhost is not listed, the only way to work locally is to carry a
 * session over from the deployed site by hand.
 */
export function parseSessionSnapshot(raw: string): SessionSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  // supabase-js has wrapped the payload in { currentSession } in some versions.
  const outer = value as Record<string, unknown>;
  const inner =
    outer.currentSession && typeof outer.currentSession === 'object'
      ? (outer.currentSession as Record<string, unknown>)
      : outer;

  const access = inner.access_token;
  const refresh = inner.refresh_token;
  if (typeof access !== 'string' || typeof refresh !== 'string') return null;
  if (!access || !refresh) return null;
  return { access_token: access, refresh_token: refresh };
}

/** Adopt a session copied from another origin, so local dev needs no dashboard change. */
export async function adoptSession(snapshot: SessionSnapshot): Promise<void> {
  const { error } = await supabase().auth.setSession({
    access_token: snapshot.access_token,
    refresh_token: snapshot.refresh_token,
  });
  if (error) throw new Error(error.message);
}
