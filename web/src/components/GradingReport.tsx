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

const BREAKDOWN_META: Record<string, { label: string; max: number }> = {
  F: { label: '格式 F', max: 10 },
  C: { label: '约束 C', max: 35 },
  I: { label: '整数性 I', max: 10 },
  O: { label: '目标 O', max: 45 },
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
        <div className="rounded-[var(--radius-md)] border border-danger/35 bg-danger-soft/75 px-3 py-2.5 leading-relaxed text-danger">
          {diag}
        </div>
      ) : null}

      {breakdown && Object.keys(breakdown).length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(breakdown)
            .filter(([key]) => key !== 'R')
            .map(([key, value]) => {
              const meta = BREAKDOWN_META[key];
              const max = meta?.max ?? 100;
              const ratio = Math.max(0, Math.min(100, (Number(value) / max) * 100));
              const full = Number(value) >= max;
              return (
                <div
                  key={key}
                  className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-subtle bg-raised px-3 py-2.5"
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-[11px] font-medium text-tertiary">
                      {meta?.label ?? key}
                    </span>
                    {meta ? (
                      <span className="font-mono text-[10px] text-tertiary">/{meta.max}</span>
                    ) : null}
                  </div>
                  <span className="font-mono text-base font-semibold text-primary tabular-nums">
                    {value}
                  </span>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={
                        'h-full rounded-full transition-all ' +
                        (full ? 'bg-success' : Number(value) > 0 ? 'bg-brand' : 'bg-strong/40')
                      }
                      style={{ width: `${ratio}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      ) : null}

      {messages.length > 0 ? (
        <ul className="space-y-1.5 rounded-[var(--radius-md)] border border-subtle bg-raised/70 p-3 text-secondary">
          {messages.map((msg, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-brand" />
              <span>{String(msg)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {instances.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-primary">私有实例明细（{instances.length} 组）</p>
          </div>
          <div className="divide-y divide-subtle overflow-hidden rounded-[var(--radius-md)] border border-subtle bg-surface">
            {instances.map((inst, index) => (
              <div
                key={index}
                className={
                  'flex flex-col gap-1 border-l-3 px-3 py-2.5 ' +
                  (inst.passed ? 'border-l-success' : 'border-l-warning')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-medium text-secondary">
                    实例 #{index + 1}
                  </span>
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
                  <p className="leading-relaxed text-tertiary">{inst.messages.join('；')}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {execMeta?.grader_ref ? (
        <div className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-tertiary">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
          <span>
            评分器版本 {execMeta.grader_ref.slice(0, 8)}
            {execMeta.image_digest ? ' · 容器校验已记录' : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
}
