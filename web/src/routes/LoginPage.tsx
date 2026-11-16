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
    <div className="mx-auto flex max-w-md flex-col gap-5 py-8 sm:py-12">
      <Card className="overflow-hidden shadow-[var(--shadow-md)]">
        <div className="bg-blueprint-lines border-b border-subtle bg-brand-soft/45 px-6 py-5">
          <Badge tone="brand">GitHub OAuth 授权访问</Badge>
          <h1 className="mt-2.5 text-xl font-bold tracking-tight text-primary">登录课程平台</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-secondary">
            请使用已在课程名单中登记授权的 GitHub 账号登录，以访问班级作业、线上评测与提交记录。
          </p>
        </div>

        <div className="flex flex-col gap-4 p-6">
          {bootError ? (
            <p className="rounded-[var(--radius-md)] border border-danger/35 bg-danger-soft/75 p-3 text-xs text-danger">
              {bootError}
            </p>
          ) : null}

          {access === 'denied' ? (
            <p className="rounded-[var(--radius-md)] border border-warning/35 bg-warning-soft/75 p-3 text-xs leading-relaxed text-warning">
              该 GitHub 账号尚未纳入本课程授权访问名单，请联系任课教师登记后再尝试登录。
            </p>
          ) : null}

          {error ? (
            <p className="rounded-[var(--radius-md)] border border-danger/35 bg-danger-soft/75 p-3 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <ul className="space-y-2 rounded-[var(--radius-md)] border border-subtle bg-raised p-3.5 text-xs text-secondary">
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
              加入所在教学班级并同步花名册身份状态
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
              提交模型代码至云端隔离容器接受独立算例检验
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
              完整保存提交历史、四维得分明细与复判审计记录
            </li>
          </ul>

          <Button onClick={() => void start()} disabled={pending} className="w-full">
            {pending ? (
              <Spinner label="正在跳转" />
            ) : (
              <>
                <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"
                  />
                </svg>
                <span>使用 GitHub 登录</span>
              </>
            )}
          </Button>

          <div className="flex items-center justify-between border-t border-subtle pt-3 text-xs text-tertiary">
            <span>未登录也可先行体验：</span>
            <div className="flex items-center gap-3">
              <Link to="/learn" className="font-medium text-brand hover:underline">
                拓展学习
              </Link>
              <Link to="/docs" className="font-medium text-brand hover:underline">
                课程文档
              </Link>
            </div>
          </div>

          {import.meta.env.DEV ? (
            <p className="text-[11px] leading-relaxed text-tertiary">
              [DEV] 当前回调地址：<code className="text-secondary">{redirectTarget()}</code>
            </p>
          ) : null}
        </div>
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
