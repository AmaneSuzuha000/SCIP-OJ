import { Link } from 'react-router-dom';
import { Badge, Card } from '@/components/ui';
import { DOCUMENTS, DOC_GROUP_LABEL, type DocGroup } from '@/features/docs/documents';

const ORDER: DocGroup[] = ['student', 'teacher', 'case'];

/**
 * The course handbooks.
 *
 * Bundled at build time from docs/ so students always have the latest guides
 * in an integrated reader.
 */
export function DocsPage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-[var(--radius-lg)] border border-subtle bg-surface p-6 shadow-[var(--shadow-sm)]">
        <Badge tone="brand">课程文档</Badge>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-primary sm:text-3xl">指南与规范</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-secondary">
          汇聚平台使用指南、课程学习路径建议、拓展建模案例说明与实验评价规范。
        </p>
      </section>

      {ORDER.map((group) => {
        const docs = DOCUMENTS.filter((doc) => doc.group === group);
        if (docs.length === 0) return null;
        return (
          <section key={group} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-primary">{DOC_GROUP_LABEL[group]}</h2>
              <Badge tone="neutral">{docs.length}</Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {docs.map((doc) => (
                <Link key={doc.id} to={'/docs/' + doc.id} className="group">
                  <Card className="flex h-full flex-col gap-3 p-5 transition-all duration-[var(--duration-fast)] group-hover:-translate-y-0.5 group-hover:border-brand/45 group-hover:shadow-[var(--shadow-md)]">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-base font-semibold text-primary group-hover:text-brand">
                        {doc.title}
                      </p>
                      <Badge tone="neutral">{DOC_GROUP_LABEL[doc.group]}</Badge>
                    </div>
                    {doc.summary ? (
                      <p className="line-clamp-2 text-xs leading-relaxed text-tertiary">{doc.summary}</p>
                    ) : null}
                    <div className="mt-auto flex items-center justify-between border-t border-subtle pt-3 text-xs">
                      <span className="font-mono text-tertiary">{doc.id}</span>
                      <span className="font-medium text-brand">阅读正文 →</span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
