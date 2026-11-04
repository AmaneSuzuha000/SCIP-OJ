import type { ReactNode } from 'react';

/**
 * Renders one markdown cell.
 *
 * The course notebooks use a narrow subset -- headings, lists, bold, inline
 * code, links, paragraphs -- and are authored by us, so this handles exactly
 * that rather than pulling in a parser and its sanitiser. Anything it does not
 * recognise is shown as plain text, never interpreted as HTML.
 */

type Token =
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'text'; text: string };

/**
 * Link targets are authored by us, but an href is still a script-injection
 * surface, so only absolute http(s) URLs and relative paths survive.
 *
 * Relative paths matter: the notebooks link to the simulation labs as
 * ../case-studio.html, which resolves correctly against /learn/<id> and keeps
 * working under the /<repo>/ deployment prefix.
 */
function safeHref(href: string): string | null {
  if (/^https?:\/\/[^\s]+$/.test(href)) return href;
  // Protocol-relative (//host) and scheme-ful values are not relative paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  if (!/^[\w./#?=&%+-]+$/.test(href)) return null;
  return href;
}

function tokenize(text: string): Token[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  const tokens: Token[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, start) });
    const raw = match[0];
    if (raw.startsWith('**')) {
      tokens.push({ kind: 'bold', text: raw.slice(2, -2) });
    } else if (raw.startsWith('`')) {
      tokens.push({ kind: 'code', text: raw.slice(1, -1) });
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(raw);
      const href = link ? safeHref(link[2] ?? '') : null;
      if (link && href) {
        tokens.push({ kind: 'link', text: link[1] ?? '', href });
      } else if (link) {
        tokens.push({ kind: 'text', text: link[1] ?? '' });
      } else {
        tokens.push({ kind: 'text', text: raw });
      }
    }
    cursor = start + raw.length;
  }
  if (cursor < text.length) tokens.push({ kind: 'text', text: text.slice(cursor) });
  return tokens;
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  return tokenize(text).map((token, index) => {
    const key = keyPrefix + '-' + index;
    switch (token.kind) {
      case 'bold':
        return <strong key={key}>{token.text}</strong>;
      case 'code':
        return (
          <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-secondary">
            {token.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand underline underline-offset-2"
          >
            {token.text}
          </a>
        );
      default:
        return token.text;
    }
  });
}

export function MarkdownCell({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  // Ordered and unordered runs must not merge: in the course material a
  // numbered list is a sequence of steps and the numbers carry meaning.
  let ordered = false;

  const flushList = () => {
    if (list.length === 0) return;
    const className = 'ml-5 space-y-1 text-sm text-secondary ' + (ordered ? 'list-decimal' : 'list-disc');
    const items = list.map((item, index) => (
      <li key={index}>{inline(item, 'li-' + blocks.length + '-' + index)}</li>
    ));
    blocks.push(
      ordered ? (
        <ol key={'ol-' + blocks.length} className={className}>{items}</ol>
      ) : (
        <ul key={'ul-' + blocks.length} className={className}>{items}</ul>
      ),
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
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const isOrdered = Boolean(numbered);
      if (list.length > 0 && ordered !== isOrdered) flushList();
      ordered = isOrdered;
      list.push((numbered ?? bullet)?.[1] ?? '');
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
