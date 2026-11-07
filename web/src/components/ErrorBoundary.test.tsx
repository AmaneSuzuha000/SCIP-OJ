import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/**
 * React unmounts the whole tree when a component throws during render. These
 * tests pin the two halves of the fix: a broken page must show a message, and a
 * working page must not be affected by the boundary wrapping it.
 */
function Exploding(): never {
  throw new Error('评分结果字段缺失');
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the error and a way out instead of a blank page', () => {
    // React logs the caught error; silence it so the test output stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Exploding />
      </ErrorBoundary>,
    );
    expect(screen.getByText('这个页面没能显示出来')).toBeInTheDocument();
    expect(screen.getByText('评分结果字段缺失')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>正常内容</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('正常内容')).toBeInTheDocument();
    expect(screen.queryByText('这个页面没能显示出来')).toBeNull();
  });
});
