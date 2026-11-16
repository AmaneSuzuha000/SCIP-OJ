import { useEffect, type InputHTMLAttributes, type ReactNode } from 'react';
import { Button } from '@/components/ui';

/**
 * A dialog that behaves like one.
 *
 * The native <dialog> would be shorter, but its showModal/close lifecycle does
 * not survive React's re-render model without an effect anyway, and it cannot
 * refuse to close while a request is in flight. Escape and the backdrop both
 * dismiss, but neither while busy: closing mid-submit would leave the user
 * without the result of an action they started.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  busy = false,
  size = 'md',
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  busy?: boolean;
  size?: 'md' | 'lg';
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    // Scrolling the page behind an open dialog makes it look detached from
    // what it is asking about.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, busy, onClose]);

  if (!open) return null;
  const widthClass = size === 'lg' ? 'max-w-2xl' : 'max-w-md';
  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-[rgb(15_23_42_/_48%)] p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[90dvh] w-full ${widthClass} overflow-y-auto rounded-[var(--radius-lg)] border border-subtle bg-surface p-6 shadow-[var(--shadow-lg)]`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-subtle pb-3.5">
          <div>
            <h2 className="text-base font-semibold text-primary">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-tertiary">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭"
            className="-mr-1 -mt-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-base text-tertiary transition-colors hover:bg-hover hover:text-primary disabled:opacity-40"
          >
            ×
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-primary">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-tertiary">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return (
    <input
      {...rest}
      className={
        'w-full rounded-[var(--radius-md)] border border-strong/80 bg-surface px-3 py-2 text-sm text-primary ' +
        'placeholder:text-tertiary transition-shadow focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--brand-500)]/15 focus:outline-none ' +
        className
      }
    />
  );
}

export function DialogActions({
  confirmLabel,
  busy,
  onCancel,
}: {
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2 border-t border-subtle pt-4">
      <Button variant="secondary" size="sm" type="button" onClick={onCancel} disabled={busy}>
        取消
      </Button>
      <Button size="sm" type="submit" disabled={busy}>
        {busy ? '处理中…' : confirmLabel}
      </Button>
    </div>
  );
}
