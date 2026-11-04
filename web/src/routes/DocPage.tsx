import { Link, useParams } from 'react-router-dom';
import { Card, EmptyState } from '@/components/ui';
import { DOCUMENTS, DOC_GROUP_LABEL, findDoc } from '@/features/docs/documents';
import { MarkdownCell } from '@/features/notebook/MarkdownCell';

export function DocPage() {
  const { docId } = useParams<{ docId: string }>();
  const doc = findDoc(docId);

  if (!doc) {
    return <EmptyState title="找不到这篇文档" hint="它可能已被合并或改名" />;
  }

  const siblings = DOCUMENTS.filter((other) => other.group === doc.group && other.id !== doc.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link to="/docs" className="text-xs text-brand">
          ← 课程文档
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">{doc.title}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
        <Card className="flex flex-col gap-3 p-6">
          <MarkdownCell source={doc.source} />
        </Card>

        <aside className="flex flex-col gap-2 lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-medium text-tertiary">{DOC_GROUP_LABEL[doc.group]}</p>
          {siblings.map((other) => (
            <Link
              key={other.id}
              to={'/docs/' + other.id}
              className="rounded-md px-2 py-1.5 text-xs text-secondary hover:bg-muted hover:text-primary"
            >
              {other.title}
            </Link>
          ))}
        </aside>
      </div>
    </div>
  );
}
