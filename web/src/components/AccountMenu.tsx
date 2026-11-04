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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-[var(--radius-md)] px-2 py-1 text-sm text-secondary hover:bg-hover"
      >
        {profile.display_name ?? profile.role}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-[var(--z-header)] mt-1 w-56 rounded-[var(--radius-md)] border border-subtle bg-surface p-1 shadow-[var(--shadow-md)]"
        >
          <div className="px-3 py-2">
            <p className="truncate text-xs text-tertiary">
              {isStudent ? (profile.student_no ?? '未绑定学号') : profile.role === 'admin' ? '管理员' : '教师'}
            </p>
          </div>
          <hr className="my-1 border-subtle" />
          <MenuItem
            onClick={() => {
              setOpen(false);
              setProfileOpen(true);
            }}
          >
            个人资料
          </MenuItem>
          {isStudent ? (
            <MenuItem
              onClick={() => {
                setOpen(false);
                setJoinOpen(true);
              }}
            >
              加入课程
            </MenuItem>
          ) : null}
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
      className="w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-sm text-secondary hover:bg-hover"
    >
      {children}
    </button>
  );
}
