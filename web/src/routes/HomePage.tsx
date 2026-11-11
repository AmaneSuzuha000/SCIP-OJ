import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
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
      <section className="relative overflow-hidden rounded-[var(--radius-lg)] border border-subtle bg-gradient-to-br from-brand-soft/60 via-surface to-surface p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">工业工程 · 系统建模与仿真</Badge>
            <Badge tone="neutral">PySCIPOpt 教学实验平台</Badge>
          </div>
          <h1 className="max-w-2xl text-2xl font-semibold tracking-tight text-primary sm:text-3xl">
            把工业问题，做成可验证的建模实验
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-secondary">
            用 PySCIPOpt 建立数学规划模型，先在浏览器内即时探索与调试样例，再由云端隔离容器运行独立测试算例并生成可信评价报告。
          </p>
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {!session ? (
              <Link to="/login">
                <Button size="sm">使用 GitHub 登录</Button>
              </Link>
            ) : null}
            <Link to="/learn">
              <Button variant={session ? 'primary' : 'secondary'} size="sm">
                浏览 11 个建模案例
              </Button>
            </Link>
            <Link to="/docs">
              <Button variant="ghost" size="sm">
                查看使用指南 →
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {bootError ? (
        <Card className="border-danger bg-danger-soft p-4 text-sm text-danger">
          后端未配置：{bootError}
        </Card>
      ) : null}

      {access === 'denied' && !bootError ? (
        <Card className="border-warning bg-warning-soft p-4 text-sm text-warning">
          当前 GitHub 账号尚未纳入课程授权名单，请联系任课教师登记授权。
        </Card>
      ) : null}

      {/* A student without a student number is invisible to the roster, so
          their grades have nothing to attach to. Say so here rather than
          waiting for them to open a menu they have no reason to open. */}
      {profile && profile.role === 'student' && !profile.student_no ? (
        <Card className="border-warning bg-warning-soft p-4 text-sm text-warning">
          还没有绑定学号。课程成绩按学号归档，请从右上角头像菜单进入「个人资料」补充填写。
        </Card>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">我的课程</h2>
          {courses.data?.length ? (
            <span className="text-xs text-tertiary">共 {courses.data.length} 门课程</span>
          ) : null}
        </div>
        {!session ? (
          <EmptyState title="登录后查看所属班级与课程作业" hint="未登录访客可直接前往「拓展学习」体验交互式建模案例" />
        ) : courses.isLoading ? (
          <Spinner label="加载课程" />
        ) : courses.isError ? (
          <EmptyState title="无法读取课程" hint={(courses.error as Error).message} />
        ) : !courses.data?.length ? (
          <EmptyState title="还没有选课记录" hint="请向任课教师获取邀请码，在右上角头像菜单点击「加入课程」" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.data.map((course) => (
              <Link key={course.id} to={'/course/' + course.id} className="group">
                <Card className="flex h-full flex-col gap-2.5 p-5 transition-all duration-[var(--duration-fast)] group-hover:-translate-y-0.5 group-hover:border-brand/40 group-hover:shadow-[var(--shadow-md)]">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-primary group-hover:text-brand">
                      {course.name}
                    </p>
                    {course.role === 'teacher' ? (
                      <Badge tone="brand">教师</Badge>
                    ) : course.role === 'ta' ? (
                      <Badge tone="brand">助教</Badge>
                    ) : course.role === 'admin' ? (
                      <Badge tone="brand">管理员</Badge>
                    ) : null}
                  </div>
                  <p className="font-mono text-xs text-tertiary">{course.code ?? '常规班级'}</p>
                  <span className="mt-auto pt-2 text-xs font-medium text-brand">进入课程 →</span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            to: '/learn',
            title: '拓展学习',
            desc: '11 套工业工程经典优化建模案例，浏览器内零配置直接运行与调参',
            icon: (
              <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m8 9 3 3-3 3m5 0h3" />
                <rect x="3" y="4" width="18" height="16" rx="2" />
              </svg>
            ),
          },
          {
            to: '/docs',
            title: '课程文档',
            desc: '学生使用指南、学习路径建议与课程实验评价规范一览',
            icon: (
              <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
              </svg>
            ),
          },
          {
            to: session ? '/submissions' : '/login',
            title: '提交记录',
            desc: '回溯历次正式提交源码、四维分项得分及完整测试算例反馈',
            icon: (
              <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            ),
          },
        ].map((item) => (
          <Link key={item.to} to={item.to} className="group">
            <Card className="flex h-full flex-col gap-2.5 p-5 transition-all duration-[var(--duration-fast)] group-hover:-translate-y-0.5 group-hover:border-brand/40 group-hover:shadow-[var(--shadow-md)]">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-brand-soft text-brand">
                  {item.icon}
                </span>
                <p className="text-sm font-semibold text-primary group-hover:text-brand">
                  {item.title}
                </p>
              </div>
              <p className="text-xs leading-relaxed text-tertiary">{item.desc}</p>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
