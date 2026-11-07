import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card } from '@/components/ui';

/**
 * Catches a render error and shows what failed instead of a blank page.
 *
 * React unmounts the whole tree when a component throws during render, so
 * without this every unexpected value -- a grading response shaped differently
 * than the page expects, a null it dereferences on the first paint -- leaves the
 * student looking at white space with no way forward and nothing to report. The
 * page that most needs to say "this broke" is the one that just broke.
 *
 * There are no resetKeys: every route change remounts through the router, and
 * the retry button reloads, which is the only reliable way to recover from an
 * error in code that has already run.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Nothing is sent anywhere: the course site has no error collector, and
    // adding one silently would be a privacy decision made on the student's
    // behalf. The console is where a teacher debugging with devtools looks.
    console.error('页面渲染失败', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-primary">这个页面没能显示出来</h1>
          <p className="mt-2 text-sm text-secondary">
            错误发生在渲染阶段，通常意味着收到的数据和页面预期的不一致。刷新一般能恢复；如果反复出现，请把下面的信息告诉老师。
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-[var(--radius-md)] bg-muted p-3 font-mono text-xs text-tertiary">
            {error.message}
          </pre>
          <div className="mt-5 flex gap-2">
            <Button onClick={this.reload}>刷新页面</Button>
            <Button variant="secondary" onClick={() => window.location.assign('.')}>
              回首页
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
