import { NavLink, Outlet } from 'react-router-dom';
import { Badge, Button } from '@/components/ui';
import { signOut } from '@/features/auth/api';
import { useSession } from '@/store/session';
import { useTheme } from '@/store/theme';

const NAV = [
  { to: '/', label: '课程教学', end: true },
  { to: '/learn', label: '拓展学习', end: false },
  { to: '/submissions', label: '提交记录', end: false },
  { to: '/docs', label: '课程文档', end: false },
  { to: '/teacher', label: '教师控制台', end: false },
];

export function AppShell() {
  const session = useSession((s) => s.session);
  const profile = useSession((s) => s.profile);
  const theme = useTheme((s) => s.theme);
  const cycle = useTheme((s) => s.cycle);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-[var(--z-header)] border-b border-subtle bg-surface/85 backdrop-blur">
        {/* One row on a laptop, two on a phone. Five nav items plus the theme
            and login controls do not fit beside each other at 390px, and
            squeezing them truncates labels mid-word. */}
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-2 sm:h-14 sm:flex-row sm:items-center sm:gap-6 sm:py-0">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex shrink-0 items-baseline gap-2">
              <span className="text-sm font-semibold tracking-[0.18em] text-primary">SCIP</span>
              <span className="text-sm font-light text-tertiary">LAB</span>
            </NavLink>

            <div className="ml-auto flex shrink-0 items-center gap-2 sm:hidden">
              {profile ? (
                <Badge tone={profile.role === 'student' ? 'neutral' : 'brand'}>
                  {profile.display_name ?? profile.role}
                </Badge>
              ) : null}
              <Button variant="ghost" size="sm" onClick={cycle} aria-label="切换配色">
                {theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '跟随系统'}
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
          </div>

          <nav
            className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0"
            aria-label="主导航"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'shrink-0 whitespace-nowrap rounded-[var(--radius-md)] px-3 py-1.5 text-sm transition-colors',
                    isActive ? 'bg-muted font-medium text-primary' : 'text-secondary hover:bg-hover',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto hidden shrink-0 items-center gap-2 sm:flex">
            {profile ? (
              <Badge tone={profile.role === 'student' ? 'neutral' : 'brand'}>
                {profile.display_name ?? profile.role}
              </Badge>
            ) : null}
            <Button variant="ghost" size="sm" onClick={cycle} aria-label="切换配色">
              {theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '跟随系统'}
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
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-subtle py-6">
        <div className="mx-auto w-full max-w-6xl px-4 text-xs text-tertiary">
          工业工程《系统建模与仿真》· 教学数据为合成示例，网页练习不计入正式成绩
        </div>
      </footer>
    </div>
  );
}
