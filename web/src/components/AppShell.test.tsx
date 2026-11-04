import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from '@/components/AppShell';
import { useSession } from '@/store/session';
import type { Profile } from '@/lib/supabase';

const STUDENT: Profile = { user_id: 'u1', display_name: '李同学', student_no: '20260001', role: 'student' };
const TEACHER: Profile = { user_id: 'u2', display_name: '王老师', student_no: null, role: 'teacher' };

/**
 * The shell renders the account menu, whose dialogs read the query cache to
 * refresh the course list after enrolment -- so the providers the real app
 * supplies have to be present here too.
 */
function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The session store is the single source of what the shell knows about you. */
function signIn(profile: Profile | null) {
  useSession.setState({
    session: profile ? ({ user: { id: profile.user_id } } as never) : null,
    profile,
    access: profile ? 'granted' : 'unknown',
  });
}

describe('navigation by role', () => {
  beforeEach(() => signIn(null));

  it('does not offer the teacher console to a signed-out visitor', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: '教师控制台' })).toBeNull();
    expect(screen.getByRole('link', { name: '课程教学' })).toBeInTheDocument();
  });

  it('does not offer the teacher console to a student', () => {
    signIn(STUDENT);
    renderShell();
    expect(screen.queryByRole('link', { name: '教师控制台' })).toBeNull();
  });

  it('offers the teacher console to a teacher', () => {
    signIn(TEACHER);
    renderShell();
    expect(screen.getByRole('link', { name: '教师控制台' })).toBeInTheDocument();
  });

  it('shows the account menu with the display name once signed in', () => {
    signIn(STUDENT);
    renderShell();
    // The header renders its controls twice -- once for a phone and once for a
    // laptop -- and CSS hides one, so the name legitimately appears twice.
    expect(screen.getAllByRole('button', { name: '李同学' }).length).toBeGreaterThan(0);
  });
});
