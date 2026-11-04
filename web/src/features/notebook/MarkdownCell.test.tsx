import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownCell } from '@/features/notebook/MarkdownCell';

/**
 * The course material writes TeX two ways: the notebooks and problem
 * statements use `$...$`, the hand-written guides use `\\(...\\)` and
 * `\\[...\\]`. Both have to render, because half the formulas in the course
 * use the second convention and would otherwise appear as their source.
 */
describe('markdown formulas', () => {
  it('renders inline ${} through KaTeX instead of showing the source', async () => {
    const { container } = render(<MarkdownCell source={'到达服从参数为 $\\lambda$ 的泊松过程。'} />);
    const katex = await screen.findByText('λ', {}, { timeout: 5000 });
    expect(katex).toBeInTheDocument();
    expect(container.textContent).not.toContain('$');
    expect(container.textContent).not.toContain('\\lambda');
  });

  it('renders inline \\(\\) the same way', async () => {
    const { container } = render(
      <MarkdownCell source={'每列车需要 \\(n\\) 个工位，变量 \\(x_{ij} \\in \\{0,1\\}\\)。'} />,
    );
    expect(await screen.findByText('n', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.textContent).not.toContain('\\(');
    expect(container.textContent).toContain('个工位');
  });

  it('renders display math written as \\[..\\] on its own lines', async () => {
    const { container } = render(
      <MarkdownCell
        source={'利用率定义为\n\\[\n\\rho_c=\\frac{\\text{serviceMean}}{\\text{arrivalMean}\\cdot c}.\n\\]\n其余照常。'}
      />,
    );
    expect(await screen.findByText('ρ', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(container.textContent).not.toContain('\\[');
    expect(container.textContent).not.toContain('\\frac');
    expect(container.textContent).toContain('其余照常');
  });

  it('handles \\text{}, relations and braces in one formula', async () => {
    const { container } = render(
      <MarkdownCell source={'约束 $\\text{meanWip} \\ge \\text{meanQueue}$ 必须成立。'} />,
    );
    expect(await screen.findByText(/meanWip/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(container.textContent).toContain('必须成立');
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders display math written as $$ on one line', async () => {
    const { container } = render(<MarkdownCell source={'$$x^2 + y^2$$'} />);
    expect(await screen.findByText('x', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('leaves a lone dollar sign alone', () => {
    const { container } = render(<MarkdownCell source={'单价 $ 5 元，没有闭合。'} />);
    expect(container.textContent).toContain('$');
    expect(container.querySelector('.katex')).toBeNull();
  });

  // The stock model writes its objective on its own line. A line-at-a-time
  // parser would render half a formula on each side of the split.
  it('renders a display formula spanning several lines', async () => {
    const source =
      '最小化期望持有与缺货成本：\n\n$$\n\\min \\sum_{s} p_s \\left[ c_h h_s + c_u u_s \\right]\n$$\n\n两项成本均为正。';
    const { container } = render(<MarkdownCell source={source} />);
    await waitFor(() => expect(container.querySelector('.katex-display')).not.toBeNull(), {
      timeout: 5000,
    });
    expect(container.textContent).not.toContain('$$');
    expect(container.textContent).not.toContain('\\sum_');
    expect(container.textContent).toContain('两项成本均为正');
  });

  it('renders subscripts that were typed as plain characters', async () => {
    // Before: "最小化 Σ_s p_s [c_h h_s+c_u u_s]" -- a subscript that is not a
    // subscript. The rendering has to be a real formula, not that string.
    const source = '最小化 $\\sum_{s} p_s \\left[ c_h h_s + c_u u_s \\right]$。';
    const { container } = render(<MarkdownCell source={source} />);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull(), {
      timeout: 5000,
    });
    expect(container.textContent).not.toContain('Σ_s');
  });
});
