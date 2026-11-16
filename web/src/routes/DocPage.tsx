import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, EmptyState } from '@/components/ui';
import { DOCUMENTS, DOC_GROUP_LABEL, findDoc } from '@/features/docs/documents';
import { MarkdownCell, headingAnchorId } from '@/features/notebook/MarkdownCell';

function extractSections(source: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  let inCode = false;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = /^##\s+(.*)$/.exec(line);
    if (match?.[1]) {
      const title = match[1].replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
      out.push({ id: headingAnchorId(match[1]), title });
    }
  }
  return out;
}

export function DocPage() {
  const { docId } = useParams<{ docId: string }>();
  const doc = findDoc(docId);

  const sections = useMemo(() => (doc ? extractSections(doc.source) : []), [doc]);

  if (!doc) {
    return <EmptyState title="找不到这篇文档" hint="它可能已被合并或改名，请返回课程文档目录查看" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <Link to="/docs" className="w-fit text-xs font-medium text-brand hover:underline">
          ← 返回课程文档
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone="brand">{DOC_GROUP_LABEL[doc.group]}</Badge>
          <h1 className="text-2xl font-bold tracking-tight text-primary">{doc.title}</h1>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="flex flex-col gap-3 p-6 sm:p-8">
          <MarkdownCell source={doc.source} />
        </Card>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          {sections.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-subtle bg-surface p-4 shadow-[var(--shadow-sm)]">
              <p className="border-b border-subtle px-2 pb-2 text-xs font-semibold text-primary">
                本页章节概览
              </p>
              <div className="flex flex-col gap-1">
                {sections.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="cursor-pointer rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-xs text-secondary transition-colors hover:bg-hover hover:text-primary"
                  >
                    {sec.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-subtle bg-surface p-4 shadow-[var(--shadow-sm)]">
            <p className="border-b border-subtle px-2 pb-2 text-xs font-semibold text-primary">
              全部文档导航
            </p>
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
                        ? 'bg-brand-soft font-semibold text-brand'
                        : 'text-secondary hover:bg-hover hover:text-primary')
                    }
                  >
                    {other.title}
                  </Link>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
