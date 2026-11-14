import { Award, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import FilterChips from './FilterChips';
import { Button, EmptyState, ExportButton, ModalShell, StatusBadge } from './ui';

const PAGE_SIZE = 50;

// The filter groups a released case falls into, by its stored status. `Declined`
// is a student's own answer to an offer or the waitlist, so it is kept apart from
// the school's Not accepted.
const FILTERS = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'accepted', label: 'Accepted', match: (entry) => entry.status === 'Released' },
  { value: 'waitlisted', label: 'Waitlisted', match: (entry) => entry.status === 'Waitlisted' },
  { value: 'notAccepted', label: 'Not accepted', match: (entry) => entry.status === 'Rejected' },
  { value: 'declined', label: 'Declined', match: (entry) => entry.status === 'Declined' },
];

// One results release, opened from its card on the Final check and release page.
// A scholarship's release can cover hundreds or thousands of applicants, so the
// list lives in its own dialog (not inline on the page) with a search, a result
// filter, and a page of 50 at a time. It lists; it never writes a stage. Opening a
// case stacks the shared review modal over this one.
export default function ReleasedResultsModal({
  title,
  kindLabel,
  releasedAtLabel,
  coveredCount,
  covered = [],
  getResult,
  onOpenCase,
  onExport,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  // How many rows are shown, remembered with the search and filter they were chosen
  // under, so a new search or filter starts again from the first page.
  const [paging, setPaging] = useState({ key: '', count: PAGE_SIZE });
  const settledQuery = useDebouncedValue(query, 250);

  // The list's scrollbar gutter, measured. The list is pulled that far into the
  // dialog's own padding, so its scrollbar sits out in the margin and the rows end
  // exactly where the title row's buttons, the card and the search do, whatever
  // width the browser gives a scrollbar. The observer reports once when it starts,
  // so there is no synchronous measure in the effect.
  const bodyRef = useRef(null);
  const [gutter, setGutter] = useState(0);
  useEffect(() => {
    const element = bodyRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setGutter(element.offsetWidth - element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const filterOptions = useMemo(() => FILTERS
    .map((option) => ({ ...option, count: covered.filter(option.match).length }))
    // A group nobody fell into is noise; "All" always stays.
    .filter((option) => option.value === 'all' || option.count > 0), [covered]);

  const activeFilter = filterOptions.some((option) => option.value === filter) ? filter : 'all';

  const matches = useMemo(() => {
    const needle = settledQuery.trim().toLowerCase();
    const match = (FILTERS.find((option) => option.value === activeFilter) || FILTERS[0]).match;
    return covered.filter((entry) => match(entry)
      && (!needle
        || String(entry.studentName || '').toLowerCase().includes(needle)
        || String(entry.studentProgram || '').toLowerCase().includes(needle)));
  }, [covered, settledQuery, activeFilter]);

  const pageKey = `${settledQuery.trim()}|${activeFilter}`;
  const visible = paging.key === pageKey ? paging.count : PAGE_SIZE;
  const shown = matches.slice(0, visible);
  const filtering = Boolean(settledQuery.trim()) || activeFilter !== 'all';

  return (
    <ModalShell
      title={`${title} released results`}
      onClose={onClose}
      className="application-detail-modal results-round-modal !h-[min(92dvh,900px)] !max-h-[min(92dvh,900px)] !w-[min(880px,100%)]"
      header={(
        <div className="card-header mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 min-w-0 flex-1">{title} released results</h2>
          <div className="flex shrink-0 items-center gap-2">
            <ExportButton disabled={!covered.length} onClick={onExport} />
            <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    >
      <div className="shrink-0">
      <header className="mb-3 grid gap-3 rounded-2xl border border-app-border bg-gradient-to-br from-blue-500/10 via-app-surface to-app-surface p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-ateneo-bright to-ateneo-strong text-white shadow-md shadow-blue-900/20">
            <Award size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-lg font-semibold leading-tight [overflow-wrap:anywhere]">{title}</h3>
            <p className="m-0 mt-0.5 text-sm text-app-muted">{kindLabel} · {releasedAtLabel}</p>
          </div>
          <StatusBadge tone="info">{coveredCount} {coveredCount === 1 ? 'application' : 'applications'} covered</StatusBadge>
        </div>
      </header>

      {covered.length ? (
        <div className="grid gap-3 pb-3">
          <div className="relative min-w-0">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
            <input
              type="search"
              value={query}
              placeholder="Search applicant or program"
              aria-label="Search the applications covered by this release"
              className="min-h-10 py-2 pl-9 text-sm"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filterOptions.length > 2 ? (
            <FilterChips
              name="released-results-filter"
              legend="Filter by result"
              options={filterOptions}
              value={activeFilter}
              onChange={setFilter}
            />
          ) : null}
        </div>
      ) : null}
      </div>

      {/* The base body class pads its right edge; that padding is dropped and the
          measured gutter is bled into the dialog's padding instead (see above). */}
      <div ref={bodyRef} className="application-detail-modal-body !pr-0" style={{ marginRight: -gutter }} role="region" aria-label="Applications covered by this release">
        {!covered.length ? (
          <EmptyState title="The covered applications are not loaded in this session." />
        ) : !matches.length ? (
          <EmptyState title="No applications match" />
        ) : (
          <div className="grid content-start gap-2 pb-1">
            <p className="m-0 text-xs text-app-muted" aria-live="polite">
              {filtering ? `${matches.length} of ${covered.length} applications` : `${covered.length} ${covered.length === 1 ? 'application' : 'applications'}`}
              {shown.length < matches.length ? ` · showing the first ${shown.length}` : ''}
            </p>
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {shown.map((entry) => {
                const result = getResult(entry);
                return (
                  <li key={entry.id} className="flex min-w-0 flex-col items-start gap-1 rounded-xl border border-app-border bg-app-card px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="min-w-0 [overflow-wrap:anywhere]">
                      <strong className="block text-sm font-semibold">{entry.studentName}</strong>
                      <span className="text-xs text-app-muted">{entry.studentProgram || 'Program on file'}</span>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
                      <Button type="button" variant="secondary" onClick={() => onOpenCase(entry.id)}>View case</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {shown.length < matches.length ? (
              <Button type="button" variant="secondary" className="w-full" onClick={() => setPaging({ key: pageKey, count: visible + PAGE_SIZE })}>
                Show {Math.min(PAGE_SIZE, matches.length - shown.length)} more
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
