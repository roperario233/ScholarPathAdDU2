import { StatusBadge } from './ui';

// One title surface per staff route (Admissions Office, interviewer, and the
// reviewer ladder). By default it is the plain bar the student pages use: a
// section label, one title, a soft corner glow. `featured` adds the gradient rail
// and larger glow that belong to a landing Dashboard only, so pass it from the
// Admissions Office Dashboard and nowhere else. The label defaults to the
// Admissions Office workspace; reviewer pages pass their own role label.
export default function AdminPageHeader({ title, description, badge, badgeTone = 'info', label = 'Admissions Office workspace', featured = false, children }) {
  return (
    <section className={`page-title-bar relative flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center ${featured ? 'pl-7' : ''}`}>
      {featured ? (
        <>
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-ateneo via-sky-400 to-cyan-300" aria-hidden="true" />
          <span className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-blue-500/15 blur-3xl" aria-hidden="true" />
        </>
      ) : (
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-blue-500/10 blur-2xl" aria-hidden="true" />
      )}
      <div className="page-title-copy relative">
        <span className="page-section-label">{label}</span>
        <h2 className={featured ? 'text-xl font-extrabold leading-tight tracking-tight sm:text-2xl' : undefined}>{title}</h2>
        {description && <p className="mt-2 max-w-2xl text-sm text-app-muted">{description}</p>}
      </div>
      {(badge || children) && (
        <div className="relative flex shrink-0 flex-wrap items-center gap-2">
          {children}
          {badge && <StatusBadge tone={badgeTone}>{badge}</StatusBadge>}
        </div>
      )}
    </section>
  );
}
