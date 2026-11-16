import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-[var(--text-inverse)] border-transparent shadow-[var(--shadow-sm)] hover:bg-[var(--brand-600)]',
  secondary:
    'bg-surface text-primary border-strong shadow-[var(--shadow-sm)] hover:bg-hover hover:border-strong',
  ghost: 'bg-transparent text-secondary border-transparent hover:bg-hover hover:text-primary',
  danger: 'bg-danger text-white border-transparent shadow-[var(--shadow-sm)] hover:brightness-110',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs sm:text-[13px]',
  md: 'h-10 px-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={[
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-md)] border font-medium',
        'transition-[color,background-color,border-color,box-shadow,filter,transform] duration-[var(--duration-fast)]',
        'active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(' ')}
    />
  );
}

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={[
        'rounded-[var(--radius-lg)] border border-subtle bg-surface shadow-[var(--shadow-sm)]',
        className,
      ].join(' ')}
    />
  );
}

export function Badge({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-muted text-secondary ring-strong/35',
    success: 'bg-success-soft text-success ring-success/25',
    warning: 'bg-warning-soft text-warning ring-warning/30',
    danger: 'bg-danger-soft text-danger ring-danger/25',
    brand: 'bg-brand-soft text-brand ring-brand/25',
  } as const;
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-[var(--radius-full)] px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="inline-flex items-center gap-2.5 text-sm text-secondary">
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-subtle" />
        <span className="size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-strong bg-raised/70 px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-[var(--radius-md)] border border-subtle bg-surface text-tertiary shadow-[var(--shadow-sm)]"
      >
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
          <path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" />
        </svg>
      </span>
      <p className="mt-1 text-sm font-semibold text-primary">{title}</p>
      {hint ? <p className="max-w-md text-xs leading-relaxed text-tertiary">{hint}</p> : null}
    </div>
  );
}
