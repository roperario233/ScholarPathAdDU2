import { Search } from 'lucide-react';
import FilterChips from './FilterChips';
import { Button } from './ui';

// The status chips, search box, and sort dropdown that head a student's own list
// (Your applications, Your documents). It matches the Admissions Office and
// reviewer lists: chips first, then one row of search and sort. Controlled; the
// page owns the values and does the filtering.
export default function ListToolbar({
  name,
  legend,
  chips = [],
  status,
  onStatusChange,
  query,
  onQueryChange,
  searchLabel,
  searchPlaceholder,
  sorts = [],
  sort,
  onSortChange,
  onReset = null,
}) {
  return (
    <div className="grid gap-3">
      <FilterChips name={name} legend={legend} value={status} onChange={onStatusChange} options={chips} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            className="min-h-10 py-2 pl-9 text-sm"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-app-text">
          <span className="shrink-0 text-xs text-app-muted">Sort by</span>
          <select
            aria-label={`Sort ${searchLabel.toLowerCase().includes('document') ? 'documents' : 'applications'}`}
            className="min-h-10 py-2 text-sm"
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
          >
            {sorts.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {onReset ? <Button type="button" variant="ghost" onClick={onReset}>Reset</Button> : null}
      </div>
    </div>
  );
}
