import { StatusBadge } from './ui';

// One title surface per staff route (Admissions Office, interviewer, and the
// reviewer ladder). It follows the student pages' title bar: a gradient rail, a
// soft glow, and a compact title. The section label defaults to the
// Admissions Office workspace; reviewer pages pass their own role label. The rail
// and glow are absolute, so the bar keeps the height of a plain title bar.
export default function AdminPageHeader({ title, description, badge, badgeTone = 'info', label = 'Admissions Office workspace', children }) {
  return (
    <section className="page-title-bar relative flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 pl-7 shadow-app backdrop-blur md:flex-row md:items-center">
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-ateneo via-sky-400 to-cyan-300" aria-hidden="true" />
      <span className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-blue-500/15 blur-3xl" aria-hidden="true" />
      <div className="relative min-w-0">
        <div className="page-title-copy">
          <span className="page-section-label">{label}</span>
          <h2 className="text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">{title}</h2>
          {description && <p className="mt-2 max-w-2xl text-sm text-app-muted">{description}</p>}
        </div>
      </div>
      {(badge || children) && (
        <div className="relative flex shrink-0 flex-wrap items-center gap-2">
          {children}
          {badge && <StatusBadge tone={badgeTone} className="!px-4 !py-1.5 !text-sm shadow-sm">{badge}</StatusBadge>}
        </div>
      )}
    </section>
  );
}
