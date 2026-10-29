import { ArrowRight } from 'lucide-react';
import { StatusBadge } from './ui';

const TILE_ICON_TONES = {
  info: 'bg-blue-500/15 text-blue-600 dark:text-blue-200',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-200',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200',
  neutral: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
};

// The tile that sits beside a staff page title, shaped like the student
// Dashboard's "Next deadline" tile: an icon, a small label, one bold line, and a
// muted note. It states the one fact the page is about (what needs doing next, the
// next interview, how many are published). Pass `onClick` when the tile can take
// the viewer to the work it names; without it the tile only informs.
export function AdminHeaderTile({ icon: Icon, label, title, note, tone = 'info', onClick }) {
  const content = (
    <>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${TILE_ICON_TONES[tone] || TILE_ICON_TONES.info}`} aria-hidden="true"><Icon size={18} /></span>
      <span className="grid min-w-0 flex-1">
        <span className="block text-xs font-semibold text-app-muted">{label}</span>
        <strong className="block text-sm font-bold text-app-text [overflow-wrap:anywhere]">{title}</strong>
        {note ? <span className="block text-xs text-app-muted [overflow-wrap:anywhere]">{note}</span> : null}
      </span>
      {onClick ? <ArrowRight size={16} className="shrink-0 text-[color:var(--accent)] transition group-hover:translate-x-1" aria-hidden="true" /> : null}
    </>
  );
  const shell = 'group flex w-full min-w-0 items-center gap-3 rounded-2xl border border-app-border bg-app-surface/70 p-3 text-left md:w-80';
  // A linking tile is a `div` with a button role rather than a `<button>`: the
  // global button rules (no border, the authenticated action palette) would
  // otherwise restyle it, and it must read the same as a plain tile.
  return onClick ? (
    <div
      role="button"
      tabIndex={0}
      className={`${shell} cursor-pointer transition hover:-translate-y-0.5 hover:border-blue-400/50 hover:shadow-app focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onClick(event);
      }}
    >
      {content}
    </div>
  ) : <div className={shell}>{content}</div>;
}

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
        <div className="relative flex w-full shrink-0 flex-wrap items-center gap-2 md:w-auto">
          {children}
          {badge && <StatusBadge tone={badgeTone}>{badge}</StatusBadge>}
        </div>
      )}
    </section>
  );
}
