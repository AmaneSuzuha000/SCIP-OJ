import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
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

function defer(node: ReactNode) {
  return (
    <Suspense fallback={<div className="py-10"><Spinner label="加载页面" /></div>}>
      {node}
    </Suspense>
  );
}

function guarded(node: ReactNode, staff = false) {
  return defer(<RequireAccess staff={staff}>{node}</RequireAccess>);
}

export const router = createBrowserRouter([
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
      { path: 'submissions', element: guarded(<SubmissionsPage />) },
      { path: 'teacher', element: guarded(<TeacherPage />, true) },
      { path: '*', element: defer(<NotFoundPage />) },
    ],
  },
]);
