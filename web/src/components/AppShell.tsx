import { NavLink, Outlet } from 'react-router-dom';
import { AccountMenu } from '@/components/AccountMenu';
import { Button } from '@/components/ui';
import { signOut } from '@/features/auth/api';
import { useSession } from '@/store/session';
import { useTheme, type Theme } from '@/store/theme';

// The teacher console is teacher/admin only. Hiding the link is not the
// boundary -- the route guard and the database both check again -- but a
// student who clicks it gets a dead end that reads like a site error.
const NAV = [
  { to: '/', label: '课程教学', end: true, staff: false },
  { to: '/learn', label: '拓展学习', end: false, staff: false },
  { to: '/submissions', label: '提交记录', end: false, staff: false },
  { to: '/docs', label: '课程文档', end: false, staff: false },
  { to: '/teacher', label: '教师控制台', end: false, staff: true },
];

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'dark') {
    return (
      <svg aria-hidden="true" className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  if (theme === 'light') {
    return (
      <svg aria-hidden="true" className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </svg>
  );
}

export function AppShell() {
  const session = useSession((s) => s.session);
  const profile = useSession((s) => s.profile);
  const theme = useTheme((s) => s.theme);
  const cycle = useTheme((s) => s.cycle);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-[var(--z-header)] border-b border-subtle bg-surface/85 backdrop-blur">
        {/* One row on a laptop, two on a phone via flex order so AccountMenu
            and its dialogs mount only once in the DOM. */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:min-h-14 sm:flex-nowrap sm:py-0">
          <NavLink to="/" className="order-1 flex shrink-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] bg-brand-soft text-brand"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2 20 7v10l-8 5-8-5V7l8-5Z" />
                <path d="m12 22V12m0 0 8-5m-8 5L4 7" />
              </svg>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold tracking-[0.16em] text-primary">SCIP</span>
              <span className="text-xs font-medium tracking-[0.12em] text-tertiary">OJ</span>
            </span>
          </NavLink>

          <div className="order-2 ml-auto flex shrink-0 items-center gap-1.5 sm:order-3">
            <AccountMenu />
            <Button variant="ghost" size="sm" onClick={cycle} aria-label="切换配色" className="gap-1.5 px-2.5">
              <ThemeIcon theme={theme} />
              <span className="hidden sm:inline">
                {theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '跟随系统'}
              </span>
            </Button>
            {session ? (
              <Button variant="secondary" size="sm" onClick={() => void signOut()}>
                退出
              </Button>
            ) : (
              <NavLink to="/login">
                <Button size="sm">登录</Button>
              </NavLink>
            )}
          </div>

          <nav
            className="order-3 -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-4 sm:order-2 sm:mx-0 sm:w-auto sm:flex-1 sm:px-0"
            aria-label="主导航"
          >
            {NAV.filter((item) => !item.staff || (profile && profile.role !== 'student')).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'shrink-0 whitespace-nowrap rounded-[var(--radius-md)] px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-brand-soft font-medium text-brand'
                      : 'text-secondary hover:bg-hover hover:text-primary',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-subtle bg-surface/40 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-tertiary">
          <span>SCIP-OJ · 工业工程《系统建模与仿真》课程实验平台</span>
          <span>教学案例采用合成数据 · 网页本地运行仅作练习，不计入正式成绩</span>
        </div>
      </footer>
    </div>
  );
}
