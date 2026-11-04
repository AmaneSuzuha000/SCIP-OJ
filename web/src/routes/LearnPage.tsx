import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';
import { lessons } from '@/features/notebook/lessons';

/**
 * The course index. Every entry is a notebook the graders also read, so what a
 * student practises here and what gets graded cannot drift apart.
 */
export function LearnPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-primary">建模实验</h2>
        <p className="mt-1 text-sm text-secondary">
          11 个 PySCIPOpt 案例，直接在浏览器里运行，无需安装任何环境。
        </p>
      </div>

      <Card className="border-warning/40 bg-warning-soft/40 p-4">
        <p className="text-xs leading-relaxed text-secondary">
          <span className="font-medium text-primary">练习不等于成绩。</span>
          这里的求解在浏览器内核中完成，只用于学习；提交作业后由隔离容器里的原生 PySCIPOpt
          重新求解，那一份结果才是成绩。
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {lessons.map((lesson) => {
          const codeCells = lesson.cells.filter((cell) => cell.kind === 'code').length;
          return (
            <Link key={lesson.id} to={'/learn/' + lesson.id} className="group">
              <Card className="h-full p-5 transition-colors duration-[var(--duration-fast)] group-hover:bg-hover">
                <p className="text-sm font-medium text-primary">{lesson.title}</p>
                {lesson.summary ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-tertiary">
                    {lesson.summary}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-tertiary">{codeCells} 个可运行单元</p>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
