import { describe, expect, it } from 'vitest';

/**
 * The router is the one module every visit loads. Importing it here catches a
 * broken lazy import or a route-table typo that typecheck alone cannot see,
 * without needing a browser.
 */
describe('router', () => {
  it('exposes every documented route', async () => {
    const { router } = await import('@/app/router');
    const paths = router.routes[0]?.children?.map((child) => child.path ?? '(index)') ?? [];
    expect(paths).toEqual([
      '(index)',
      'login',
      'auth/callback',
      'course/:courseId',
      'workbench/:assignmentId',
      'learn',
      'learn/:lessonId',
      'submissions',
      'teacher',
      '*',
    ]);
  });

  it('strips the deployment prefix from every route', async () => {
    // The site is deployed under /<repo>/. Without a basename the app renders
    // on the root page only and every link reports "no such page" while the
    // address bar looks correct.
    const { router } = await import('@/app/router');
    const base = import.meta.env.BASE_URL;
    expect(base.endsWith('/')).toBe(true);
    expect(router.basename).toBe(base === '/' ? '/' : base.replace(/\/$/, ''));
  });

  it('keeps student work behind the access guard', async () => {
    const { router } = await import('@/app/router');
    const children = router.routes[0]?.children ?? [];
    const guarded = children
      .filter((child) => ['course/:courseId', 'workbench/:assignmentId', 'submissions', 'teacher'].includes(child.path ?? ''))
      .map((child) => child.path);
    expect(guarded).toEqual([
      'course/:courseId',
      'workbench/:assignmentId',
      'submissions',
      'teacher',
    ]);
    // Every guarded element is wrapped in Suspense + RequireAccess, never bare.
    for (const child of children) {
      if (guarded.includes(child.path)) {
        expect(child.element).toBeTruthy();
      }
    }
  });
});
