import { useSummaryCards } from '../lib/summaryCardsContext';

const clsx = (...values) => values.flat(Infinity).filter(Boolean).join(' ');

// Placeholder shapes shown while data loads, so a page keeps its layout instead
// of reading empty and then jumping when the data arrives. The shimmer lives in
// `.skeleton` (src/styles.css). Every block is decorative: a skeleton region
// announces one polite "Loading" status through `SkeletonRegion` instead.

export function Skeleton({ className = '' }) {
  return <span className={clsx('skeleton block rounded-lg', className)} aria-hidden="true" />;
}

// A paragraph of grey lines; the last line is shorter, like real text.
export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <span className={clsx('grid gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={clsx('h-3.5', index === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </span>
  );
}

// Wraps a group of skeleton blocks so assistive technology hears one status
// instead of silence.
export function SkeletonRegion({ label = 'Loading', className = '', children }) {
  return (
    <div className={className} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

const cardShell = 'rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur';

export function SkeletonTitleBar() {
  return (
    <section className={clsx(cardShell, 'flex flex-col items-start justify-between gap-4 md:flex-row md:items-center')}>
      <div className="grid w-full max-w-md gap-2.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-3/4" />
      </div>
      <Skeleton className="h-14 w-full rounded-2xl md:w-80" />
    </section>
  );
}

// Placeholders for the summary cards, which are hidden by default, so none is drawn
// while the user has them hidden.
export function SkeletonMetrics({ count = 3 }) {
  const { visible } = useSummaryCards();
  if (!visible) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="grid gap-3 rounded-app border border-app-border bg-app-card p-4 shadow-card">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

// Cards in a responsive grid: scholarship tracks, Explorer results.
export function SkeletonCards({ count = 3, columns = 'md:grid-cols-2 xl:grid-cols-3' }) {
  return (
    <div className={clsx('grid gap-4', columns)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={clsx(cardShell, 'grid content-start gap-4')}>
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <Skeleton className="h-5 w-2/3" />
          </div>
          <SkeletonText lines={3} />
          <div className="grid gap-2">
            <Skeleton className="h-9 w-full rounded-xl" />
            <Skeleton className="h-9 w-full rounded-xl" />
          </div>
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

// A list of record rows: applications, documents, queue entries.
export function SkeletonRows({ rows = 4, className = '' }) {
  return (
    <div className={clsx('grid gap-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-2xl border border-app-border bg-app-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <Skeleton className="h-7 w-28 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ rows = 4, className = '' }) {
  return (
    <section className={clsx(cardShell, 'grid gap-4', className)}>
      <Skeleton className="h-5 w-48" />
      <SkeletonRows rows={rows} />
    </section>
  );
}

export function SkeletonCalendar() {
  return (
    <section className={clsx(cardShell, 'grid gap-4')}>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {Array.from({ length: 35 }, (_, index) => (
          <Skeleton key={index} className="h-12 rounded-xl sm:h-20" />
        ))}
      </div>
    </section>
  );
}

// Chat bubbles while a support conversation's messages load.
export function SupportMessagesSkeleton({ className = '' }) {
  return (
    <SkeletonRegion label="Loading messages" className={clsx('grid min-h-40 content-start gap-3 rounded-2xl bg-app-muted-surface p-3 sm:p-4', className)}>
      <Skeleton className="h-14 w-4/5 rounded-2xl" />
      <Skeleton className="ml-auto h-10 w-3/5 rounded-2xl" />
      <Skeleton className="h-12 w-2/3 rounded-2xl" />
    </SkeletonRegion>
  );
}

// Search bar and filter row above a grid of cards (Scholarship Explorer).
function SkeletonSearchBar() {
  return (
    <section className={clsx(cardShell, 'grid gap-3')}>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-32 rounded-xl" />
        <Skeleton className="h-9 w-32 rounded-xl" />
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>
    </section>
  );
}

// The profile page: a stepper column beside the open section's form.
function SkeletonProfile() {
  return (
    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <div className={clsx(cardShell, 'grid content-start gap-3')}>
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-9 w-full rounded-xl" />)}
      </div>
      <div className={clsx(cardShell, 'grid content-start gap-5')}>
        <Skeleton className="h-5 w-48" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="grid gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// The placeholder for a whole authenticated page while the workspace loads.
// The shape follows the route, so the layout the data lands in is already there.
export function ViewSkeleton({ view }) {
  let body;
  switch (view) {
    case 'dashboard':
      body = <SkeletonCards count={3} columns="xl:grid-cols-3" />;
      break;
    case 'explore':
      body = (
        <>
          <SkeletonSearchBar />
          <SkeletonCards count={6} />
        </>
      );
      break;
    case 'applications':
    case 'vault':
      body = (
        <>
          <SkeletonMetrics count={4} />
          <SkeletonCard rows={4} />
        </>
      );
      break;
    case 'calendar':
    case 'admin-calendar':
    case 'chair-calendar':
      body = <SkeletonCalendar />;
      break;
    case 'profile':
      body = <SkeletonProfile />;
      break;
    default:
      body = (
        <>
          <SkeletonMetrics count={4} />
          <SkeletonCard rows={5} />
        </>
      );
  }
  return (
    <SkeletonRegion label="Loading your workspace" className="grid min-w-0 gap-5">
      <SkeletonTitleBar />
      {body}
    </SkeletonRegion>
  );
}
