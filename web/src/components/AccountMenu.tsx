import { useEffect, useRef, useState } from 'react';
import { JoinCourseDialog } from '@/features/courses/JoinCourseDialog';
import { ProfileDialog } from '@/features/profile/ProfileDialog';
import { useSession } from '@/store/session';

/**
 * The account menu: who you are signed in as, and the two settings that change
 * what the rest of the site shows you.
 *
 * Kept out of AppShell because it owns two dialogs; inlining them there would
 * make the header re-render every time a form field changes.
 */
export function AccountMenu() {
  const profile = useSession((s) => s.profile);
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Clicking anywhere else closes the menu. Without this the menu stays open
  // while the page underneath navigates, which looks like a stuck overlay.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!profile) return null;
  const isStudent = profile.role === 'student';
  const label = profile.display_name ?? profile.role;
  const initial = (label.trim()[0] ?? 'U').toUpperCase();
  const roleHint = isStudent
    ? (profile.student_no ?? '未绑定学号')
    : profile.role === 'admin'
      ? '平台管理员'
      : '课程教师';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-subtle bg-raised/70 px-2.5 py-1 text-sm text-secondary transition-colors hover:border-strong hover:bg-hover hover:text-primary"
      >
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-[var(--text-inverse)]"
        >
          {initial}
        </span>
        <span className="max-w-28 truncate font-medium text-primary">{label}</span>
        {profile.student_no ? (
          <span className="hidden rounded-[var(--radius-sm)] bg-muted px-1.5 py-0.5 font-mono text-[10px] text-tertiary md:inline">
            {profile.student_no}
          </span>
        ) : null}
        <svg
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-tertiary transition-transform duration-[var(--duration-fast)] ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-[var(--z-header)] mt-1.5 w-60 rounded-[var(--radius-lg)] border border-subtle bg-surface p-1.5 shadow-[var(--shadow-lg)]"
        >
          <div className="rounded-[var(--radius-md)] bg-raised px-3 py-2.5">
            <p className="truncate text-xs font-semibold text-primary">{label}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-tertiary">{roleHint}</p>
          </div>
          <hr className="my-1.5 border-subtle" />
          <MenuItem
            onClick={() => {
              setOpen(false);
              setProfileOpen(true);
            }}
          >
            <span>个人资料</span>
            <span className="text-[11px] text-tertiary">学号 / 姓名</span>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              setJoinOpen(true);
            }}
          >
            <span>加入课程</span>
            <span className="text-[11px] text-tertiary">输入邀请码</span>
          </MenuItem>
        </div>
      ) : null}

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
      <JoinCourseDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-left text-sm text-secondary transition-colors hover:bg-hover hover:text-primary"
    >
      {children}
    </button>
  );
}
