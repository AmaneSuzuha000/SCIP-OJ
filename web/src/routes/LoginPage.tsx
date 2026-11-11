import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Badge, Button, Card, Spinner } from '@/components/ui';
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
    <div className="mx-auto flex max-w-md flex-col gap-5 py-10">
      <Card className="flex flex-col gap-4 p-6 sm:p-7">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge tone="brand">GitHub OAuth 授权访问</Badge>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-primary">登录课程平台</h1>
          <p className="text-xs leading-relaxed text-secondary">
            请使用已在课程名单中登记授权的 GitHub 账号登录，以访问班级作业、线上评测与提交记录。
          </p>
        </div>

        {bootError ? (
          <p className="rounded-[var(--radius-md)] bg-danger-soft p-3 text-xs text-danger">
            {bootError}
          </p>
        ) : null}

        {access === 'denied' ? (
          <p className="rounded-[var(--radius-md)] bg-warning-soft p-3 text-xs leading-relaxed text-warning">
            该 GitHub 账号尚未纳入本课程授权访问名单，请联系任课教师登记后再尝试登录。
          </p>
        ) : null}

        {error ? (
          <p className="rounded-[var(--radius-md)] bg-danger-soft p-3 text-xs text-danger">{error}</p>
        ) : null}

        <Button onClick={() => void start()} disabled={pending}>
          {pending ? <Spinner label="正在跳转" /> : '使用 GitHub 登录'}
        </Button>

        <div className="flex items-center justify-between border-t border-subtle pt-3 text-xs text-tertiary">
          <span>未登录也可先行体验：</span>
          <div className="flex items-center gap-3">
            <Link to="/learn" className="text-brand hover:underline">
              拓展学习
            </Link>
            <Link to="/docs" className="text-brand hover:underline">
              课程文档
            </Link>
          </div>
        </div>

        {import.meta.env.DEV ? (
          <p className="text-[11px] leading-relaxed text-tertiary">
            [DEV] 当前回调地址：<code className="text-secondary">{redirectTarget()}</code>
          </p>
        ) : null}
      </Card>

      {import.meta.env.DEV ? (
        <details className="rounded-[var(--radius-lg)] border border-subtle bg-surface p-4">
          <summary className="cursor-pointer text-xs font-medium text-secondary">
            [DEV] 本地开发会话导入
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[11px] leading-relaxed text-tertiary">
              仅用于本地开发环境无公网 OAuth 回调时导入调试会话 JSON。
            </p>
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
      ) : null}
    </div>
  );
}
