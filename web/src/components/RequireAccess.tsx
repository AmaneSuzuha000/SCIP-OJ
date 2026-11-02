import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { EmptyState, Spinner } from '@/components/ui';
import { useSession } from '@/store/session';

/** Client-side convenience only. The database enforces the real boundary. */
export function RequireAccess({ children, staff = false }: { children: ReactNode; staff?: boolean }) {
  const access = useSession((s) => s.access);
  const session = useSession((s) => s.session);
  const profile = useSession((s) => s.profile);
  const location = useLocation();

  // No session at all means "not signed in", not "still checking". Sending them
  // to /login is what stops a logged-out visitor staring at a spinner forever.
  if (!session && (access === 'unknown' || access === 'checking')) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (access === 'unknown' || access === 'checking') {
    return <div className="py-16"><Spinner label="正在验证访问权限" /></div>;
  }
  if (access === 'denied') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (staff && profile && profile.role === 'student') {
    return <EmptyState title="需要教师权限" hint="这个页面只对授课教师开放" />;
  }
  return <>{children}</>;
}
