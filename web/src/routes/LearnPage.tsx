import { Link } from 'react-router-dom';
import { Badge, Card } from '@/components/ui';
import { lessons } from '@/features/notebook/lessons';

function parseLessonMeta(title: string) {
  const match = /^([A-Z]+(?:-[A-Z]+)*-\d+|P\d+)\s*(?:·\s*)?(.*)$/.exec(title.trim());
  const code = match?.[1] ?? 'LAB';
  const cleanTitle = (match?.[2] || title).trim();
  const isCore = code.startsWith('P');
  return { code, cleanTitle, isCore };
}

/**
 * The interactive modeling case index. Every entry bundles a browser-runnable
 * PySCIPOpt notebook for exploration and sensitivity experiments.
 */
export function LearnPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Badge tone="brand">拓展学习 · 11 套交互式实验</Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">PySCIPOpt 建模实验案例</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-secondary">
          全部案例均在浏览器内直接执行并支持实时修改参数对比，无需在本地电脑安装配置求解器。
        </p>
      </div>

      <Card className="border-warning/40 bg-warning-soft/50 px-4 py-3">
        <p className="text-xs leading-relaxed text-secondary">
          <span className="font-semibold text-primary">学习边界说明：</span>
          这里的求解仅在当前浏览器会话内运行，用于课前预习、模型推导与敏感性实验；正式作业分数以「课程教学」中提交作业后的云端隔离评测为准。
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {lessons.map((lesson) => {
          const codeCells = lesson.cells.filter((cell) => cell.kind === 'code').length;
          const { code, cleanTitle, isCore } = parseLessonMeta(lesson.title);
          return (
            <Link key={lesson.id} to={'/learn/' + lesson.id} className="group">
              <Card className="flex h-full flex-col gap-2.5 p-5 transition-all duration-[var(--duration-fast)] group-hover:-translate-y-0.5 group-hover:border-brand/40 group-hover:shadow-[var(--shadow-md)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-brand">{code}</span>
                  <Badge tone={isCore ? 'brand' : 'neutral'}>
                    {isCore ? '正式同款' : '专题拓展'}
                  </Badge>
                </div>
                <p className="text-sm font-semibold text-primary group-hover:text-brand">
                  {cleanTitle}
                </p>
                {lesson.summary ? (
                  <p className="line-clamp-2 text-xs leading-relaxed text-tertiary">
                    {lesson.summary}
                  </p>
                ) : null}
                <div className="mt-auto flex items-center justify-between pt-2 text-xs">
                  <span className="text-tertiary">{codeCells} 个可执行代码单元</span>
                  <span className="font-medium text-brand">进入实验 →</span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
