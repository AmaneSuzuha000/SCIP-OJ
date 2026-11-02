import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Spinner } from '@/components/ui';
import { useSession } from '@/store/session';

/**
 * OAuth return target. The Supabase client parses the URL fragment on creation
 * and fires onAuthStateChange, so this page only waits for the server verdict.
 *
 * It also has to fail loudly: if Supabase rejects the exchange it appends
 * error / error_description to the URL, and a page that only spins would leave
 * the user with no idea whether their account or the configuration is at fault.
 */
function readOAuthError(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const code = hash.get('error') ?? query.get('error');
  if (!code) return null;
  const detail = hash.get('error_description') ?? query.get('error_description') ?? '';
  return detail ? decodeURIComponent(detail.replace(/\+/g, ' ')) : code;
}

export function AuthCallbackPage() {
  const access = useSession((s) => s.access);
  const session = useSession((s) => s.session);
  const navigate = useNavigate();
  const oauthError = useMemo(readOAuthError, []);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (oauthError) return;
    if (access === 'granted') navigate('/', { replace: true });
    if (access === 'denied' && session) navigate('/login', { replace: true });
  }, [access, session, navigate, oauthError]);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  if (oauthError) {
    return (
      <div className="mx-auto max-w-md py-12">
        <Card className="flex flex-col gap-3 p-6">
          <h1 className="text-base font-semibold text-danger">GitHub 登录失败</h1>
          <p className="text-xs leading-relaxed text-secondary">{oauthError}</p>
          <p className="text-xs leading-relaxed text-tertiary">
            常见原因：Supabase 的 Redirect URLs 里没有登记当前地址，或 GitHub OAuth App 的回调地址填错。
          </p>
          <Link to="/login"><Button size="sm">返回登录</Button></Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-16">
      <Spinner label="正在验证账号" />
      {slow ? (
        <p className="max-w-sm text-center text-xs leading-relaxed text-tertiary">
          超过 8 秒仍未完成。若一直停在这里，多半是当前地址没有登记在 Supabase 的 Redirect URLs 中。
          <Link to="/login" className="ml-1 text-brand underline">返回登录</Link>
        </p>
      ) : null}
    </div>
  );
}
