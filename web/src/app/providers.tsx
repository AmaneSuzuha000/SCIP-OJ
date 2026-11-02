import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase, type Profile } from '@/lib/supabase';
import { useSession } from '@/store/session';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

/** Resolves session, profile and the server-side admission verdict once, then
 *  keeps them in sync with auth changes. The server remains the authority. */
function AuthBootstrap() {
  const setSession = useSession((s) => s.setSession);
  const setProfile = useSession((s) => s.setProfile);
  const setAccess = useSession((s) => s.setAccess);
  const setBootError = useSession((s) => s.setBootError);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function start() {
      let client;
      try {
        client = supabase();
      } catch (error) {
        setBootError(error instanceof Error ? error.message : '无法初始化后端连接');
        setAccess('denied');
        return;
      }

      const sync = async (session: Awaited<ReturnType<typeof client.auth.getSession>>['data']['session']) => {
        if (cancelled) return;
        setSession(session);
        if (!session) {
          setProfile(null);
          setAccess('unknown');
          return;
        }
        setAccess('checking');
        const [{ data: allowed }, { data: profile }] = await Promise.all([
          client.rpc('check_site_access'),
          client
            .from('profiles')
            .select('user_id,display_name,student_no,role')
            .eq('user_id', session.user.id)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        setProfile((profile as Profile | null) ?? null);
        setAccess(allowed === true ? 'granted' : 'denied');
      };

      const { data } = await client.auth.getSession();
      await sync(data.session);
      const sub = client.auth.onAuthStateChange((_event, session) => {
        void sync(session);
      });
      unsubscribe = () => sub.data.subscription.unsubscribe();
    }

    void start();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [setSession, setProfile, setAccess, setBootError]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthBootstrap />
      {children}
    </QueryClientProvider>
  );
}
