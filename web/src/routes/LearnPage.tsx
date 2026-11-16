import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState } from '@/components/ui';
import { lessons } from '@/features/notebook/lessons';

function parseLessonMeta(title: string) {
  const match = /^([A-Z]+(?:-[A-Z]+)*-\d+|P\d+)\s*(?:·\s*)?(.*)$/.exec(title.trim());
  const code = match?.[1] ?? 'LAB';
  const cleanTitle = (match?.[2] || title).trim();
  const isCore = code.startsWith('P');
  return { code, cleanTitle, isCore };
}

type CategoryFilter = 'all' | 'core' | 'extended';

/**
 * The interactive modeling case index. Every entry bundles a browser-runnable
 * PySCIPOpt notebook for exploration and sensitivity experiments.
 */
export function LearnPage() {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');

  const items = useMemo(
    () =>
      lessons.map((lesson, idx) => ({
        lesson,
        index: idx + 1,
        codeCells: lesson.cells.filter((cell) => cell.kind === 'code').length,
        ...parseLessonMeta(lesson.title),
      })),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category === 'core' && !item.isCore) return false;
      if (category === 'extended' && item.isCore) return false;
      if (!q) return true;
      return (
        item.code.toLowerCase().includes(q) ||
        item.cleanTitle.toLowerCase().includes(q) ||
        item.lesson.summary.toLowerCase().includes(q)
      );
    });
  }, [items, category, query]);

  const coreCount = items.filter((i) => i.isCore).length;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-[var(--radius-lg)] border border-subtle bg-surface p-6 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">拓展学习 · {lessons.length} 套交互式实验</Badge>
          <Badge tone="neutral">WebAssembly · PySCIPOpt</Badge>
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-primary">PySCIPOpt 建模实验案例</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-secondary">
          全部案例均在浏览器内直接执行并支持实时修改参数对比，无需在本地电脑安装配置求解器。
        </p>

        <div className="mt-4 rounded-[var(--radius-md)] border border-warning/35 bg-warning-soft/55 px-4 py-2.5 text-xs leading-relaxed text-secondary">
          <span className="font-semibold text-primary">学习边界说明：</span>
          这里的求解仅在当前浏览器会话内运行，用于课前预习、模型推导与敏感性实验；正式作业分数以「课程教学」中提交作业后的云端隔离评测为准。
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-4">
          <div className="inline-flex rounded-[var(--radius-md)] border border-subtle bg-muted/70 p-0.5 text-xs">
            {(
              [
                ['all', `全部 (${items.length})`],
                ['core', `正式同款 (${coreCount})`],
                ['extended', `专题拓展 (${items.length - coreCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key)}
                className={
                  'cursor-pointer rounded-[var(--radius-sm)] px-3 py-1 transition-all ' +
                  (category === key
                    ? 'bg-surface font-semibold text-primary shadow-[var(--shadow-sm)]'
                    : 'text-secondary hover:text-primary')
                }
              >
                {label}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索案例名称、编号或关键词…"
            aria-label="搜索建模案例"
            className="w-full rounded-[var(--radius-md)] border border-subtle bg-raised px-3 py-1.5 text-xs text-primary placeholder:text-tertiary focus:border-brand focus:outline-none sm:w-64"
          />
        </div>
      </section>

      {filtered.length === 0 ? (
        <EmptyState title="未找到匹配的实验案例" hint="清空搜索关键词或切换分类查看全部 11 套案例" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map(({ lesson, index, codeCells, code, cleanTitle, isCore }) => (
            <Link key={lesson.id} to={'/learn/' + lesson.id} className="group">
              <Card className="flex h-full flex-col gap-3 p-5 transition-all duration-[var(--duration-fast)] group-hover:-translate-y-0.5 group-hover:border-brand/45 group-hover:shadow-[var(--shadow-md)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-tertiary">
                      #{String(index).padStart(2, '0')}
                    </span>
                    <span className="rounded-[var(--radius-sm)] border border-brand/20 bg-brand-soft px-2 py-0.5 font-mono text-xs font-semibold text-brand">
                      {code}
                    </span>
                  </div>
                  <Badge tone={isCore ? 'brand' : 'neutral'}>
                    {isCore ? '正式同款' : '专题拓展'}
                  </Badge>
                </div>
                <p className="text-base font-semibold text-primary group-hover:text-brand">
                  {cleanTitle}
                </p>
                {lesson.summary ? (
                  <p className="line-clamp-2 text-xs leading-relaxed text-tertiary">
                    {lesson.summary}
                  </p>
                ) : null}
                <div className="mt-auto flex items-center justify-between border-t border-subtle pt-3 text-xs">
                  <span className="font-mono text-tertiary">{codeCells} 个可执行代码单元</span>
                  <span className="font-medium text-brand">进入实验 →</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
