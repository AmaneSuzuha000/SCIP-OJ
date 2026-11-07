import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RequireAccess } from '@/components/RequireAccess';
import { Spinner } from '@/components/ui';

// Route-level splitting keeps first paint free of the editor and anything a
// given visitor never opens.
const HomePage = lazy(() => import('@/routes/HomePage').then((m) => ({ default: m.HomePage })));
const CoursePage = lazy(() => import('@/routes/CoursePage').then((m) => ({ default: m.CoursePage })));
const WorkbenchPage = lazy(() =>
  import('@/routes/WorkbenchPage').then((m) => ({ default: m.WorkbenchPage })),
);
const LearnPage = lazy(() => import('@/routes/LearnPage').then((m) => ({ default: m.LearnPage })));
const DocsPage = lazy(() => import('@/routes/DocsPage').then((m) => ({ default: m.DocsPage })));
const DocPage = lazy(() => import('@/routes/DocPage').then((m) => ({ default: m.DocPage })));
const LessonPage = lazy(() =>
  import('@/routes/LessonPage').then((m) => ({ default: m.LessonPage })),
);
const SubmissionsPage = lazy(() =>
  import('@/routes/SubmissionsPage').then((m) => ({ default: m.SubmissionsPage })),
);
const TeacherPage = lazy(() =>
  import('@/routes/TeacherPage').then((m) => ({ default: m.TeacherPage })),
);
const LoginPage = lazy(() => import('@/routes/LoginPage').then((m) => ({ default: m.LoginPage })));
const AuthCallbackPage = lazy(() =>
  import('@/routes/AuthCallbackPage').then((m) => ({ default: m.AuthCallbackPage })),
);
const NotFoundPage = lazy(() =>
  import('@/routes/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

/**
 * Every route goes through here, so one boundary covers the whole app: a page
 * that throws during render shows what failed instead of unmounting the shell
 * and leaving a blank document. It sits inside AppShell, so the navigation stays
 * usable and a student can click somewhere else rather than reload.
 */
function defer(node: ReactNode) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="py-10"><Spinner label="加载页面" /></div>}>
        {node}
      </Suspense>
    </ErrorBoundary>
  );
}

function guarded(node: ReactNode, staff = false) {
  return defer(<RequireAccess staff={staff}>{node}</RequireAccess>);
}

/**
 * GitHub Pages serves a project page from /<repo>/, so the browser path carries
 * a prefix the route table must not see. Without a basename the app renders on
 * the root page only and every deep link lands on the catch-all: the address is
 * correct while the page insists it does not exist.
 *
 * Vite inlines BASE_URL at build time, so this is the same prefix the asset
 * URLs and the injected config.js already use -- one source, not two.
 */
export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: defer(<HomePage />) },
        { path: 'login', element: defer(<LoginPage />) },
        { path: 'auth/callback', element: defer(<AuthCallbackPage />) },
        { path: 'course/:courseId', element: guarded(<CoursePage />) },
        { path: 'workbench/:assignmentId', element: guarded(<WorkbenchPage />) },
        { path: 'learn', element: defer(<LearnPage />) },
        { path: 'learn/:lessonId', element: defer(<LessonPage />) },
        { path: 'docs', element: defer(<DocsPage />) },
        { path: 'docs/:docId', element: defer(<DocPage />) },
        { path: 'submissions', element: guarded(<SubmissionsPage />) },
        { path: 'teacher', element: guarded(<TeacherPage />, true) },
        { path: '*', element: defer(<NotFoundPage />) },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);
