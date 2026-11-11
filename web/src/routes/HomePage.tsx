import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
import { listMyCourses } from '@/features/courses/api';
import { useSession } from '@/store/session';

export function HomePage() {
  const bootError = useSession((s) => s.bootError);
  const access = useSession((s) => s.access);
  const session = useSession((s) => s.session);
  const profile = useSession((s) => s.profile);

  const courses = useQuery({
    queryKey: ['my-courses'],
    queryFn: listMyCourses,
    enabled: Boolean(session),
  });

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Badge tone="brand">工业工程 · 系统建模与仿真</Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-primary">
          把工业问题，做成可验证的建模实验
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-secondary">
          用 PySCIPOpt 建立模型，用可信评测验证结果。课程练习只作即时反馈，正式作业在隔离容器中运行私有实例。
        </p>
      </section>

      {bootError ? (
        <Card className="border-danger bg-danger-soft p-4 text-sm text-danger">
          后端未配置：{bootError}
        </Card>
      ) : null}

      {access === 'denied' && !bootError ? (
        <Card className="border-warning bg-warning-soft p-4 text-sm text-warning">
          当前 GitHub 账号不在课程白名单内，请联系任课教师登记。
        </Card>
      ) : null}

      {/* A student without a student number is invisible to the roster, so
          their grades have nothing to attach to. Say so here rather than
          waiting for them to open a menu they have no reason to open. */}
      {profile && profile.role === 'student' && !profile.student_no ? (
        <Card className="border-warning bg-warning-soft p-4 text-sm text-warning">
          还没有绑定学号。成绩按学号归档，请从头像菜单的「个人资料」填写。
        </Card>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-primary">我的课程</h2>
        {!session ? (
          <EmptyState title="请先登录" hint="登录后这里会显示你选修和任教的课程" />
        ) : courses.isLoading ? (
          <Spinner label="加载课程" />
        ) : courses.isError ? (
          <EmptyState title="无法读取课程" hint={(courses.error as Error).message} />
        ) : !courses.data?.length ? (
          <EmptyState title="还没有选课记录" hint="向任课教师索取邀请码，从头像菜单的「加入课程」输入" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.data.map((course) => (
              <Link key={course.id} to={'/course/' + course.id} className="group">
                <Card className="flex h-full flex-col gap-2 p-5 transition-shadow group-hover:shadow-[var(--shadow-md)]">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-primary">{course.name}</p>
                    {course.role === 'teacher' ? (
                      <Badge tone="brand">教师</Badge>
                    ) : course.role === 'ta' ? (
                      <Badge tone="brand">助教</Badge>
                    ) : course.role === 'admin' ? (
                      <Badge tone="brand">管理员</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-tertiary">{course.code ?? '未设置课程代码'}</p>
                  <span className="mt-auto pt-2 text-xs text-brand">进入课程 →</span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* What the site actually contains. A visitor who is not logged in --
          a prospective student, or someone checking the course exists -- was
          otherwise shown a login prompt and nothing else. */}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            to: '/learn',
            title: '拓展学习',
            desc: 'PySCIPOpt 建模案例，浏览器内直接运行，无需安装环境',
          },
          {
            to: '/docs',
            title: '课程文档',
            desc: '学生、教师与判分口径的指南和规范',
          },
          {
            to: session ? '/submissions' : '/login',
            title: '提交记录',
            desc: '每次评测的状态与得分',
          },
        ].map((item) => (
          <Link key={item.to} to={item.to} className="group">
            <Card className="h-full p-5 transition-shadow group-hover:shadow-[var(--shadow-md)]">
              <p className="text-sm font-medium text-primary">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-tertiary">{item.desc}</p>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
