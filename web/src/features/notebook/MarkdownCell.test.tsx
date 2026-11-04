import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownCell } from '@/features/notebook/MarkdownCell';

/**
 * The problem statements carry TeX. A renderer that shows the dollar signs
 * instead looks fine in a screenshot of prose and wrong to the student reading
 * the actual question, so the delimiters are pinned here.
 */
describe('markdown formulas', () => {
  it('renders inline TeX through KaTeX instead of showing the source', async () => {
    const { container } = render(<MarkdownCell source={'到达服从参数为 $\\lambda$ 的泊松过程。'} />);
    // KaTeX is a lazy chunk; wait for the formula to replace the fallback.
    const katex = await screen.findByText('λ', {}, { timeout: 5000 });
    expect(katex).toBeInTheDocument();
    expect(container.textContent).not.toContain('$');
    expect(container.textContent).not.toContain('\\lambda');
  });

  it('handles \\text{}, relations and braces in one formula', async () => {
    const { container } = render(
      <MarkdownCell source={'约束 $\\text{meanWip} \\ge \\text{meanQueue}$ 必须成立。'} />,
    );
    expect(await screen.findByText(/meanWip/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(container.textContent).toContain('必须成立');
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders display math on its own', async () => {
    const { container } = render(<MarkdownCell source={'$$x^2 + y^2$$'} />);
    expect(await screen.findByText('x', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('leaves a lone dollar sign alone', () => {
    const { container } = render(<MarkdownCell source={'单价 $ 5 元，没有闭合。'} />);
    expect(container.textContent).toContain('$');
    expect(container.querySelector('.katex')).toBeNull();
  });
});
