import { useRef } from 'react';

const clsx = (...values) => values.flat(Infinity).filter(Boolean).join(' ');

export const buttonClasses = {
  base: 'inline-flex min-h-10 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60',
  primary: 'bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-sm',
  secondary: 'border border-blue-500/35 bg-gradient-to-br from-ateneo-strong/20 via-ateneo/15 to-ateneo-bright/10 text-app-text shadow-card hover:border-blue-500/60 hover:from-ateneo-strong/30 hover:via-ateneo/25 hover:to-ateneo-bright/20',
  ghost: 'border border-transparent text-app-muted hover:bg-blue-500/10 hover:text-app-text',
  danger: 'border border-rose-400/30 bg-gradient-to-br from-rose-500/15 to-orange-400/10 text-rose-700 shadow-card hover:border-rose-400/55 dark:text-rose-200',
};

export function Button({ variant = 'secondary', className = '', children, ...props }) {
  return <button className={clsx(buttonClasses.base, buttonClasses[variant], className)} {...props}>{children}</button>;
}

// Decorative warning glyph for actions that need a confirmation. The caller sets
// the colour and size; the visible label carries the meaning, so the icon is
// hidden from assistive tech.
export function WarningIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function Card({ title, action, children, className = '', ...props }) {
  return (
    <section className={clsx('relative overflow-hidden rounded-app border bg-app-card p-5 shadow-app backdrop-blur before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-ateneo before:via-sky-400 before:to-cyan-300', className)} {...props}>
      {(title || action) && (
        <div className="card-header mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
          {title && <h3 className="min-w-0 flex-1">{title}</h3>}
          {action && <div className="card-header-action shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className = '', ...props }) {
  return <div className={clsx('rounded-[18px] border border-app-border bg-app-surface p-4', className)} {...props}>{children}</div>;
}

const statusClasses = {
  success: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300 dark:border-emerald-400/50 dark:bg-emerald-400/20 dark:text-emerald-100',
  danger: 'border-rose-400/40 bg-rose-400/10 text-rose-300 dark:border-rose-400/50 dark:bg-rose-400/20 dark:text-rose-100',
  warning: 'border-amber-400/40 bg-amber-400/10 text-amber-300 dark:border-amber-400/50 dark:bg-amber-400/20 dark:text-amber-100',
  info: 'border-sky-400/40 bg-sky-400/10 text-sky-300 dark:border-sky-400/50 dark:bg-sky-400/20 dark:text-sky-100',
  neutral: 'border-app-border bg-app-surface text-app-text',
};

export function StatusBadge({ tone = 'neutral', title, children, className = '' }) {
  return <span className={clsx('inline-flex w-fit items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold', statusClasses[tone] || statusClasses.neutral, className)} title={title || undefined}>{children}</span>;
}

export function FormField({ label, hint, error, labelAdornment, children, className = '' }) {
  return (
    // content-start keeps label, control, and hint packed at the top, so a field
    // beside a taller neighbour (longer hint or error) is not stretched out of line.
    <label className={clsx('grid content-start gap-2', className)}>
      <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-app-text">
        <span className="min-w-0">{label}</span>
        {labelAdornment}
      </span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
      {error && <span className="text-sm text-rose-300" role="alert">{error}</span>}
    </label>
  );
}

export function SettingToggle({ checked, onChange, title, description }) {
  return (
    <label className="group flex cursor-pointer items-start gap-4 rounded-xl bg-app-surface p-4 transition-colors hover:bg-app-card">
      <span className="relative mt-0.5 h-7 w-12 shrink-0 rounded-full bg-slate-400/20 transition-colors has-[:checked]:bg-ateneo">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="pointer-events-none absolute bottom-[3px] left-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
      <span className="min-w-0">
        <strong className="block text-sm font-semibold text-app-text">{title}</strong>
        <span className="mt-1 block text-sm text-app-muted">{description}</span>
      </span>
    </label>
  );
}

export function EmptyState({ title, description, action, className = '' }) {
  return (
    <div className={clsx('rounded-app border border-dashed border-app-border p-6 text-center text-app-muted', className)}>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

/**
 * The backdrop only dismisses a modal when the press and the click both land on
 * the backdrop itself. A drag-select that starts inside the dialog and is released
 * outside dispatches its `click` on the backdrop, which used to close the modal
 * mid-selection.
 */
export const shouldDismissOverlay = ({ pressStartedOnOverlay, target, currentTarget }) =>
  Boolean(pressStartedOnOverlay) && target === currentTarget;

export function ModalShell({ title, closeLabel = 'Close', onClose, children, className = '', overlayClassName = '', header = null, ...props }) {
  // A drag-select that starts on text inside the dialog and ends on the backdrop
  // fires `click` on the backdrop — the nearest common ancestor of the press and
  // the release — which used to dismiss the modal mid-selection (and with it the
  // whole review modal underneath). The Meet link in the Interview tab was the
  // usual casualty.
  const pressStartedOnOverlay = useRef(false);
  const markPress = (event) => {
    pressStartedOnOverlay.current = event.target === event.currentTarget;
  };
  const handleOverlayClick = (event) => {
    if (!onClose) return;
    if (!shouldDismissOverlay({
      pressStartedOnOverlay: pressStartedOnOverlay.current,
      target: event.target,
      currentTarget: event.currentTarget,
    })) return;
    pressStartedOnOverlay.current = false;
    onClose();
  };
  return (
    <div
      className={clsx('modal-overlay', overlayClassName)}
      role="presentation"
      onPointerDown={markPress}
      onMouseDown={markPress}
      onClick={handleOverlayClick}
    >
      <section className={clsx('rounded-app border bg-app-card p-5 shadow-app backdrop-blur', className)} role="dialog" aria-modal="true" aria-label={title || undefined} onClick={(event) => event.stopPropagation()} {...props}>
        {/* `header` replaces the title/Close row for dialogs that need their own
            layout (for example the centred warning header). `title` still names
            the dialog for assistive tech. */}
        {header || ((title || onClose) && (
          <div className="card-header mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
            {title && <h2 className="min-w-0 flex-1">{title}</h2>}
            {onClose && <div className="shrink-0"><Button variant="secondary" type="button" onClick={onClose}>{closeLabel}</Button></div>}
          </div>
        ))}
        {children}
      </section>
    </div>
  );
}