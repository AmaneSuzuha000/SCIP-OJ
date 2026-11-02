import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button, Card, Spinner } from '@/components/ui';
import {
  adoptSession,
  parseSessionSnapshot,
  redirectTarget,
  signInWithGitHub,
} from '@/features/auth/api';
import { useSession } from '@/store/session';

export function LoginPage() {
  const access = useSession((s) => s.access);
  const bootError = useSession((s) => s.bootError);
  const setAccess = useSession((s) => s.setAccess);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [importing, setImporting] = useState(false);
  const location = useLocation();

  if (access === 'granted') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function start() {
    setPending(true);
    setError(null);
    try {
      await signInWithGitHub();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
      setPending(false);
    }
  }

  async function importSession() {
    setImporting(true);
    setError(null);
    try {
      const snapshot = parseSessionSnapshot(pasted);
      if (!snapshot) {
        setError('这段内容不像会话 JSON：需要包含 access_token 和 refresh_token。');
        return;
      }
      await adoptSession(snapshot);
      // The auth listener in AuthBootstrap re-checks admission against the server.
      setAccess('checking');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-12">
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-primary">登录课程平台</h1>
          <p className="text-xs leading-relaxed text-tertiary">
            使用 GitHub 账号登录。只有任课教师登记过的账号可以访问课程内容。
          </p>
        </div>

        {bootError ? (
          <p className="rounded-[var(--radius-md)] bg-danger-soft p-3 text-xs text-danger">
            {bootError}
          </p>
        ) : null}

        {access === 'denied' ? (
          <p className="rounded-[var(--radius-md)] bg-warning-soft p-3 text-xs text-warning">
            这个 GitHub 账号不在课程白名单内，请联系任课教师登记后再试。
          </p>
        ) : null}

        {error ? (
          <p className="rounded-[var(--radius-md)] bg-danger-soft p-3 text-xs text-danger">{error}</p>
        ) : null}

        <Button onClick={() => void start()} disabled={pending}>
          {pending ? <Spinner label="正在跳转" /> : '使用 GitHub 登录'}
        </Button>

        <p className="text-[11px] leading-relaxed text-tertiary">
          当前回调地址：<code className="text-secondary">{redirectTarget()}</code>
          。这个地址必须登记在 Supabase 的 Redirect URLs 里，否则登录成功后会被送回站点首页。
        </p>
      </Card>

      <details className="rounded-[var(--radius-lg)] border border-subtle bg-surface p-4">
        <summary className="cursor-pointer text-xs font-medium text-secondary">
          跳不回本机？从线上站带一份登录状态过来
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <ol className="list-decimal pl-4 text-[11px] leading-relaxed text-tertiary">
            <li>在线上站用同一个 GitHub 账号登录一次。</li>
            <li>F12 → Application → Local Storage，找到键名以 sb- 开头、以 -auth-token 结尾的那条。</li>
            <li>复制它的值，粘贴到下面。</li>
          </ol>
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={4}
            spellCheck={false}
            placeholder='{"access_token":"...","refresh_token":"..."}'
            className="w-full rounded-[var(--radius-md)] border border-subtle bg-canvas p-2 font-mono text-[11px] text-primary outline-none focus:border-brand"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void importSession()}
            disabled={importing || !pasted.trim()}
          >
            {importing ? '正在导入' : '导入登录状态'}
          </Button>
        </div>
      </details>
    </div>
  );
}
