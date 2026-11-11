import { Link, useParams } from 'react-router-dom';
import { Badge, Card, EmptyState } from '@/components/ui';
import { DOCUMENTS, DOC_GROUP_LABEL, findDoc } from '@/features/docs/documents';
import { MarkdownCell } from '@/features/notebook/MarkdownCell';

export function DocPage() {
  const { docId } = useParams<{ docId: string }>();
  const doc = findDoc(docId);

  if (!doc) {
    return <EmptyState title="找不到这篇文档" hint="它可能已被合并或改名，请返回课程文档目录查看" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link to="/docs" className="w-fit text-xs text-brand hover:underline">
          ← 返回课程文档
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{DOC_GROUP_LABEL[doc.group]}</Badge>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">{doc.title}</h1>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
        <Card className="flex flex-col gap-3 p-6 sm:p-7">
          <MarkdownCell source={doc.source} />
        </Card>

        <aside className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-subtle bg-surface/60 p-4 lg:sticky lg:top-20 lg:self-start">
          <p className="px-2 text-xs font-semibold text-primary">全部文档导航</p>
          <div className="flex flex-col gap-1">
            {DOCUMENTS.map((other) => {
              const active = other.id === doc.id;
              return (
                <Link
                  key={other.id}
                  to={'/docs/' + other.id}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'rounded-[var(--radius-md)] px-2.5 py-2 text-xs transition-colors ' +
                    (active
                      ? 'bg-brand-soft font-medium text-brand'
                      : 'text-secondary hover:bg-hover hover:text-primary')
                  }
                >
                  {other.title}
                </Link>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
