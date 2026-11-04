import { Suspense, lazy, type ReactNode } from 'react';

// KaTeX is ~280 kB and ships fonts, so it is fetched only by pages whose
// material actually contains a formula. Everything else never pays for it.
const MathSpan = lazy(() => import('./MathSpan'));

/**
 * Renders course markdown.
 *
 * The course material uses a narrow subset: headings, bullet and numbered
 * lists, bold, inline code, links, block quotes, fenced code, tables and TeX.
 * This handles exactly that rather than pulling in a full parser and its
 * sanitiser; anything it does not recognise is shown as text, never
 * interpreted as HTML.
 *
 * TeX arrives in two conventions because the material comes from two places:
 * the notebooks and problem statements use `$...$`, while the hand-written
 * guides use `\\(...\\)` and `\\[...\\]`. Both are supported -- half the
 * formulas in the course would otherwise render as their source.
 */

type Token =
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'math'; tex: string; display: boolean }
  | { kind: 'text'; text: string };

/**
 * Link targets are authored by us, but an href is still a script-injection
 * surface, so only absolute http(s) URLs and relative paths survive.
 *
 * Relative paths matter: the notebooks link to docs as ../case-studio.html,
 * which resolves correctly against /learn/<id> and keeps working under the
 * /<repo>/ deployment prefix.
 */
function safeHref(href: string): string | null {
  if (/^https?:\/\/[^\s]+$/.test(href)) return href;
  // Protocol-relative (//host) and scheme-ful values are not relative paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  if (!/^[\w./#?=&%+-]+$/.test(href)) return null;
  return href;
}

/**
 * Display math may span lines, so it is pulled out before the source is split
 * into lines -- a line-at-a-time parser would see half a formula on each side.
 */
const DISPLAY_MATH = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/;

function unwrap(raw: string): string {
  // Both `$$..$$` and `\\[..\\]` are two characters at each end.
  return raw.slice(2, -2);
}

function tokenize(text: string): Token[] {
  // Display math first: otherwise `$$x$$` would match the single-$ branch and
  // leave the extra dollars as literal text. Same for the bracketed form.
  const pattern =
    /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  const tokens: Token[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, start) });
    const raw = match[0];
    if (raw.startsWith('$$') || raw.startsWith('\\[')) {
      tokens.push({ kind: 'math', tex: unwrap(raw), display: true });
    } else if (raw.startsWith('\\(')) {
      tokens.push({ kind: 'math', tex: raw.slice(2, -2), display: false });
    } else if (raw.startsWith('$')) {
      const inner = raw.slice(1, -1);
      // A lone `$5` in prose is not math. Requiring non-space at both ends
      // keeps prices and stray dollars out of the renderer.
      if (/^\S(?:[\s\S]*\S)?$/.test(inner)) {
        tokens.push({ kind: 'math', tex: inner, display: false });
      } else {
        tokens.push({ kind: 'text', text: raw });
      }
    } else if (raw.startsWith('**')) {
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
        return <strong key={key} className="font-semibold text-primary">{token.text}</strong>;
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
      case 'math':
        // Until the chunk arrives the formula shows as its TeX source, which is
        // still readable -- and if the chunk never loads it stays that way
        // rather than leaving a hole in the sentence.
        return (
          <Suspense key={key} fallback={<span className="font-mono text-[0.9em]">{token.tex}</span>}>
            <MathSpan tex={token.tex} display={token.display} />
          </Suspense>
        );
      default:
        return token.text;
    }
  });
}

/** A run of table rows, kept together so the header can be separated. */
function renderTable(rows: string[], key: string) {
  const cells = (line: string) =>
    line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((cell) => cell.trim());
  const header = cells(rows[0] ?? '');
  const body = rows.slice(1).filter((line) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(line));
  return (
    <div key={key} className="overflow-x-auto rounded-md border border-subtle">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted">
            {header.map((cell, index) => (
              <th key={index} className="border-b border-subtle px-3 py-2 text-left font-medium text-primary">
                {inline(cell, key + '-h-' + index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((line, rowIndex) => (
            <tr key={rowIndex} className="border-b border-subtle last:border-0">
              {cells(line).map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top text-secondary">
                  {inline(cell, key + '-' + rowIndex + '-' + cellIndex)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Everything except display math: one pass over the lines of a text run. */
function renderProse(source: string, keyPrefix: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  // Ordered and unordered runs must not merge: in the course material a
  // numbered list is a sequence of steps and the numbers carry meaning.
  let ordered = false;

  const flushList = () => {
    if (list.length === 0) return;
    const className = 'ml-5 space-y-1 text-sm text-secondary ' + (ordered ? 'list-decimal' : 'list-disc');
    const items = list.map((item, index) => (
      <li key={index}>{inline(item, keyPrefix + '-li-' + blocks.length + '-' + index)}</li>
    ));
    blocks.push(
      ordered ? (
        <ol key={keyPrefix + '-ol-' + blocks.length} className={className}>{items}</ol>
      ) : (
        <ul key={keyPrefix + '-ul-' + blocks.length} className={className}>{items}</ul>
      ),
    );
    list = [];
  };

  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').replace(/\s+$/, '');

    // A fenced block swallows everything up to its closing fence, so the
    // content inside is never treated as markdown.
    if (/^\s*```/.test(line)) {
      flushList();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push(
        <pre key={keyPrefix + '-pre-' + index} className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed text-secondary">
          <code className="font-mono">{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Consecutive pipe rows form one table.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      const rows: string[] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index] ?? '')) {
        rows.push(lines[index] ?? '');
        index += 1;
      }
      index -= 1;
      blocks.push(renderTable(rows, keyPrefix + '-tbl-' + index));
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = (heading[1] ?? '#').length;
      const sizes = ['text-xl', 'text-base', 'text-sm', 'text-sm'] as const;
      const size = sizes[Math.min(level, 4) - 1] ?? 'text-sm';
      blocks.push(
        <p
          key={keyPrefix + '-h-' + index}
          className={size + ' font-semibold text-primary ' + (level <= 2 ? 'mt-2' : 'mt-3')}
        >
          {inline(heading[2] ?? '', keyPrefix + '-h-' + index)}
        </p>,
      );
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      blocks.push(
        <blockquote key={keyPrefix + '-q-' + index} className="border-l-2 border-brand pl-3 text-sm text-secondary">
          {inline(quote[1] ?? '', keyPrefix + '-q-' + index)}
        </blockquote>,
      );
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const isOrdered = Boolean(numbered);
      if (list.length > 0 && ordered !== isOrdered) flushList();
      ordered = isOrdered;
      list.push((numbered ?? bullet)?.[1] ?? '');
      continue;
    }
    flushList();
    blocks.push(
      <p key={keyPrefix + '-p-' + index} className="text-sm leading-relaxed text-secondary">
        {inline(line, keyPrefix + '-p-' + index)}
      </p>,
    );
  }
  flushList();
  return blocks;
}

export function MarkdownCell({ source }: { source: string }) {
  const parts = source.split(DISPLAY_MATH);
  const blocks: ReactNode[] = [];

  parts.forEach((part, index) => {
    // split() with a capture group keeps the delimiters, so odd entries are
    // the display-math runs themselves.
    if (index % 2 === 1) {
      const tex = unwrap(part);
      blocks.push(
        <Suspense key={index} fallback={<pre className="font-mono text-xs text-tertiary">{tex}</pre>}>
          <MathSpan tex={tex} display />
        </Suspense>,
      );
      return;
    }
    blocks.push(...renderProse(part, 'b' + index));
  });

  return <div className="flex flex-col gap-2">{blocks}</div>;
}
