import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { RequireAccess } from '@/components/RequireAccess';
import { useSession } from '@/store/session';

/**
 * Navigation inside a data router issues a real fetch in jsdom, so the guard is
 * exercised directly with a plain MemoryRouter instead.
 */
function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route path="/secret" element={<RequireAccess><p>受保护内容</p></RequireAccess>} />
        <Route path="/login" element={<p>登录页</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAccess', () => {
  beforeEach(() => {
    useSession.getState().reset();
    useSession.setState({ session: null, profile: null, bootError: null });
  });

  it('sends a signed-out visitor to the login page instead of spinning', () => {
    useSession.setState({ access: 'unknown' });
    renderGuarded();
    expect(screen.getByText('登录页')).toBeInTheDocument();
  });

  it('shows a spinner only while a real session is being verified', () => {
    useSession.setState({
      access: 'checking',
      session: { user: { id: 'u1' } } as never,
    });
    renderGuarded();
    expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
    expect(screen.getByText(/正在验证访问权限/)).toBeInTheDocument();
  });

  it('renders the content once access is granted', () => {
    useSession.setState({
      access: 'granted',
      session: { user: { id: 'u1' } } as never,
    });
    renderGuarded();
    expect(screen.getByText('受保护内容')).toBeInTheDocument();
  });

  it('refuses a student on a staff-only page', () => {
    useSession.setState({
      access: 'granted',
      session: { user: { id: 'u1' } } as never,
      profile: { user_id: 'u1', display_name: '学生', student_no: '1', role: 'student' },
    });
    render(
      <MemoryRouter>
        <RequireAccess staff><p>教师内容</p></RequireAccess>
      </MemoryRouter>,
    );
    expect(screen.getByText('需要教师权限')).toBeInTheDocument();
    expect(screen.queryByText('教师内容')).not.toBeInTheDocument();
  });
});
