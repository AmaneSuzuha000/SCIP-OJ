import type { ReactNode } from 'react';

/**
 * Renders one markdown cell.
 *
 * The course notebooks use a narrow subset -- headings, lists, bold, inline
 * code, paragraphs -- and are authored by us, so this handles exactly that
 * rather than pulling in a parser and its sanitiser. Anything unrecognised is
 * shown as plain text, never interpreted as HTML.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on the three inline forms the notebooks actually use.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(pattern);
  parts.forEach((part, index) => {
    const key = keyPrefix + '-' + index;
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={key}>{part.slice(2, -2)}</strong>);
      return;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-secondary">
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }
    nodes.push(part);
  });
  return nodes;
}

export function MarkdownCell({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={'ul-' + blocks.length} className="ml-5 list-disc space-y-1 text-sm text-secondary">
        {list.map((item, index) => (
          <li key={index}>{inline(item, 'li-' + blocks.length + '-' + index)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  source.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushList();
      return;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = (heading[1] ?? '#').length;
      const sizes = ['text-lg', 'text-base', 'text-sm', 'text-sm'] as const;
      const size = sizes[Math.min(level, 4) - 1] ?? 'text-sm';
      blocks.push(
        <p
          key={'h-' + index}
          className={size + ' font-semibold text-primary ' + (level <= 2 ? 'mt-1' : 'mt-2')}
        >
          {inline(heading[2] ?? '', 'h-' + index)}
        </p>,
      );
      return;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1] ?? '');
      return;
    }
    flushList();
    blocks.push(
      <p key={'p-' + index} className="text-sm leading-relaxed text-secondary">
        {inline(line, 'p-' + index)}
      </p>,
    );
  });
  flushList();

  return <div className="flex flex-col gap-2">{blocks}</div>;
}
