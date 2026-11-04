import { Link } from 'react-router-dom';
import { Badge, Card } from '@/components/ui';
import { DOCUMENTS, DOC_GROUP_LABEL, type DocGroup } from '@/features/docs/documents';

const ORDER: DocGroup[] = ['student', 'teacher', 'case'];

/**
 * The course handbooks.
 *
 * These live in docs/ and used to be reachable only by guessing a URL, so in
 * practice nobody read them. They are bundled at build time and linked here.
 */
export function DocsPage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Badge tone="brand">课程文档</Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-primary">指南与规范</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-secondary">
          学生需要知道的流程与规范都在这里。判分口径以《课程实验与评价规范》为准。
        </p>
      </section>

      {ORDER.map((group) => {
        const docs = DOCUMENTS.filter((doc) => doc.group === group);
        if (docs.length === 0) return null;
        return (
          <section key={group} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-primary">{DOC_GROUP_LABEL[group]}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {docs.map((doc) => (
                <Link key={doc.id} to={'/docs/' + doc.id} className="group">
                  <Card className="flex h-full flex-col gap-2 p-5 transition-shadow group-hover:shadow-[var(--shadow-md)]">
                    <p className="text-sm font-medium text-primary">{doc.title}</p>
                    {doc.summary ? (
                      <p className="line-clamp-2 text-xs leading-relaxed text-tertiary">{doc.summary}</p>
                    ) : null}
                    <span className="mt-auto text-xs text-brand">阅读 →</span>
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
