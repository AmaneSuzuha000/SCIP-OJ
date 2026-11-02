import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { router } from '@/app/router';

/**
 * Typecheck and "the dev server answers 200" both pass on an app that renders
 * nothing. This mounts the real route tree so a blank screen fails the build.
 *
 * The Supabase client is stubbed to throw: that is the state of a fresh
 * checkout with no .env.local, and it must still produce a readable page
 * rather than a white screen. Stubbing also keeps the suite off the network.
 */
vi.mock('@/lib/supabase', () => ({
  supabase: () => {
    throw new Error('缺少 Supabase 运行配置：请在部署时提供 config.js');
  },
}));

function mount(path: string) {
  const memory = createMemoryRouter(router.routes, { initialEntries: [path] });
  return render(
    <AppProviders>
      <RouterProvider router={memory} />
    </AppProviders>,
  );
}

describe('app renders without a backend', () => {
  it('paints the home page heading and sections', async () => {
    mount('/');
    expect(await screen.findByRole('heading', { level: 1, name: /把工业问题/ })).toBeInTheDocument();
    expect(screen.getByText('我的课程')).toBeInTheDocument();
    expect(screen.getAllByText('提交记录').length).toBeGreaterThan(0);
  });

  it('explains the missing backend instead of going blank', async () => {
    mount('/');
    expect(await screen.findByText(/后端未配置/)).toBeInTheDocument();
  });

  it('renders the login page with a sign-in affordance', async () => {
    mount('/login');
    expect(await screen.findByRole('heading', { name: /登录课程平台/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /使用 GitHub 登录/ })).toBeInTheDocument();
  });

  it('renders a 404 instead of throwing on an unknown route', async () => {
    mount('/definitely-not-a-page');
    expect(await screen.findByText('页面不存在')).toBeInTheDocument();
  });


});
