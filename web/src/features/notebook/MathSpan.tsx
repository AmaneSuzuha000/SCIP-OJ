import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * One formula, rendered by KaTeX.
 *
 * This module is loaded lazily (see MarkdownCell) so the KaTeX bundle and its
 * fonts are only fetched by pages that actually contain math. Most of the
 * course material has none.
 *
 * KaTeX escapes the TeX it is given, and strict mode rejects the constructs
 * that could inject markup, so the HTML produced here is safe to set directly.
 */
export function MathSpan({ tex, display }: { tex: string; display: boolean }) {
  const html = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    strict: 'ignore',
    output: 'html',
  });

  if (display) {
    return (
      <span
        className="my-2 block overflow-x-auto text-center"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <span className="align-baseline" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default MathSpan;
