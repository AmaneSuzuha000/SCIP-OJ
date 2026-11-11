import { Badge } from '@/components/ui';

interface InstanceReport {
  score?: number;
  passed?: boolean;
  breakdown?: Record<string, number>;
  messages?: string[];
}

export interface GradingReportData {
  score?: number | null;
  passed?: boolean;
  breakdown?: Record<string, number>;
  messages?: string[];
  error?: string;
  instances?: InstanceReport[];
  execution?: {
    grader_ref?: string;
    pass_score?: number;
    n_instances?: number;
    image_digest?: string | null;
  };
}

const BREAKDOWN_LABELS: Record<string, string> = {
  F: '格式 F',
  C: '约束 C',
  I: '整数性 I',
  O: '目标 O',
};

export function GradingReport({
  report,
  errorMessage,
}: {
  report: Record<string, unknown> | null | undefined;
  errorMessage?: string | null;
}) {
  const data = (report ?? null) as GradingReportData | null;
  const diag = errorMessage || (typeof data?.error === 'string' ? data.error : null);
  const breakdown = data?.breakdown;
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const instances = Array.isArray(data?.instances) ? data.instances : [];
  const execMeta = data?.execution;

  if (!diag && !breakdown && messages.length === 0 && instances.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      {diag ? (
        <div className="rounded-[var(--radius-md)] border border-danger/40 bg-danger-soft/70 p-2.5 text-danger">
          {diag}
        </div>
      ) : null}

      {breakdown && Object.keys(breakdown).length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(breakdown)
            .filter(([key]) => key !== 'R')
            .map(([key, value]) => (
              <div
                key={key}
                className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-subtle bg-muted/50 px-2.5 py-2"
              >
                <span className="text-[11px] text-tertiary">{BREAKDOWN_LABELS[key] ?? key}</span>
                <span className="font-mono text-sm font-semibold text-primary tabular-nums">{value}</span>
              </div>
            ))}
        </div>
      ) : null}

      {messages.length > 0 ? (
        <ul className="space-y-1 rounded-[var(--radius-md)] bg-muted/40 p-2.5 text-secondary">
          {messages.map((msg, idx) => (
            <li key={idx}>• {String(msg)}</li>
          ))}
        </ul>
      ) : null}

      {instances.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-primary">私有实例明细（{instances.length} 组）</p>
          <div className="divide-y divide-subtle overflow-hidden rounded-[var(--radius-md)] border border-subtle bg-surface">
            {instances.map((inst, index) => (
              <div
                key={index}
                className={
                  'flex flex-col gap-1 border-l-2 px-3 py-2 ' +
                  (inst.passed ? 'border-l-success' : 'border-l-warning')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-secondary">实例 #{index + 1}</span>
                  <div className="flex items-center gap-2">
                    {typeof inst.passed === 'boolean' ? (
                      <Badge tone={inst.passed ? 'success' : 'warning'}>
                        {inst.passed ? '通过' : '未达标'}
                      </Badge>
                    ) : null}
                    <span className="font-mono font-semibold text-primary tabular-nums">
                      {inst.score ?? '—'} 分
                    </span>
                  </div>
                </div>
                {Array.isArray(inst.messages) && inst.messages.length > 0 ? (
                  <p className="text-tertiary">{inst.messages.join('；')}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {execMeta?.grader_ref ? (
        <p className="font-mono text-[11px] text-tertiary">
          评分器版本 {execMeta.grader_ref.slice(0, 8)}
          {execMeta.image_digest ? ' · 容器校验已记录' : ''}
        </p>
      ) : null}
    </div>
  );
}
