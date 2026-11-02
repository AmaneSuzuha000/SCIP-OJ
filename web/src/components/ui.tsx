import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:brightness-110 border-transparent',
  secondary: 'bg-surface text-primary border-strong hover:bg-hover',
  ghost: 'bg-transparent text-secondary border-transparent hover:bg-hover',
  danger: 'bg-danger text-white border-transparent hover:brightness-110',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
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
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] border font-medium',
        'transition-colors duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-50',
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
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-muted text-secondary',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    brand: 'bg-brand-soft text-brand',
  } as const;
  return (
    <span
      className={[
        'inline-flex items-center rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium',
        tones[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-tertiary">
      <span className="size-3 animate-spin rounded-full border-2 border-strong border-t-transparent" />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[var(--radius-lg)] border border-dashed border-strong px-6 py-10 text-center">
      <p className="text-sm font-medium text-secondary">{title}</p>
      {hint ? <p className="text-xs text-tertiary">{hint}</p> : null}
    </div>
  );
}
