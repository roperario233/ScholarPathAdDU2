import { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import AcademicYearSelect from './AcademicYearSelect';
import { Button, FormField } from './ui';
import {
  INTERVIEW_MODE_OPTIONS,
  INTERVIEW_WHEN_OPTIONS,
  countActiveInterviewFilters,
  hasInterviewRefinement,
} from '../lib/interviewFilters';

// The search, sort, and "More filters" controls shared by the Admissions Office
// interview board and every reviewer's Interviews page. The category chips stay
// with each page; this only narrows and orders what the category holds. Controlled:
// the page owns the filters (and debounces the query) so it can read them too.
export default function InterviewFilterBar({
  filters,
  onChange,
  onReset,
  facets,
  sorts,
  // Mode and date only mean something for an interview that has a time, so the
  // list of applicants still to be scheduled hides them.
  showScheduleFilters = true,
  shown = 0,
  total = 0,
  noun = 'interview',
  // The academic-year choice belongs to the page, which scopes the whole board by it.
  academicYear = null,
  academicYears = [],
  onAcademicYearChange = null,
}) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveInterviewFilters(filters) - (showScheduleFilters ? 0 : ['mode', 'when'].filter((key) => filters[key] !== 'all').length);
  const refined = hasInterviewRefinement(filters);
  return (
    <div className="mb-3 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            type="search"
            value={filters.query}
            placeholder="Search applicant, scholarship, program, panel"
            aria-label="Search interviews"
            className="min-h-10 py-2 pl-9 text-sm"
            onChange={(event) => onChange({ query: event.target.value })}
          />
        </div>
        <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-app-text">
          <span className="shrink-0 text-xs text-app-muted">Sort by</span>
          <select
            aria-label="Sort interviews"
            className="min-h-10 py-2 text-sm"
            value={filters.sort}
            onChange={(event) => onChange({ sort: event.target.value })}
          >
            {sorts.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {onAcademicYearChange ? (
          <AcademicYearSelect value={academicYear} onChange={onAcademicYearChange} years={academicYears} />
        ) : null}
        <Button
          type="button"
          aria-expanded={open}
          aria-controls="interview-more-filters"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="inline-flex items-center gap-1.5">
            More filters{activeCount ? ` (${activeCount})` : ''}
            <ChevronDown size={16} aria-hidden="true" className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </span>
        </Button>
        {refined ? <Button type="button" variant="ghost" onClick={onReset}>Reset</Button> : null}
      </div>
      {open ? (
        <div id="interview-more-filters" className="grid gap-2 border-t border-app-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {showScheduleFilters ? (
            <>
              <FormField label="Date" className="gap-1 [&_span]:text-xs">
                <select className="min-h-10 py-2 text-sm" value={filters.when} onChange={(event) => onChange({ when: event.target.value })}>
                  {INTERVIEW_WHEN_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Mode" className="gap-1 [&_span]:text-xs">
                <select className="min-h-10 py-2 text-sm" value={filters.mode} onChange={(event) => onChange({ mode: event.target.value })}>
                  {INTERVIEW_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
            </>
          ) : null}
          <FormField label="Scholarship" className="gap-1 [&_span]:text-xs">
            <select className="min-h-10 py-2 text-sm" value={filters.scholarshipId} onChange={(event) => onChange({ scholarshipId: event.target.value })}>
              <option value="all">All scholarships</option>
              {facets.scholarships.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FormField>
          {facets.departments.length > 1 ? (
            <FormField label="Department" className="gap-1 [&_span]:text-xs">
              <select className="min-h-10 py-2 text-sm" value={filters.department} onChange={(event) => onChange({ department: event.target.value })}>
                <option value="all">All departments</option>
                {facets.departments.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
          ) : null}
          {facets.programs.length > 1 ? (
            <FormField label="Program" className="gap-1 [&_span]:text-xs">
              <select className="min-h-10 py-2 text-sm" value={filters.program} onChange={(event) => onChange({ program: event.target.value })}>
                <option value="all">All programs</option>
                {facets.programs.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
          ) : null}
        </div>
      ) : null}
      <p className="m-0 text-xs text-app-muted" aria-live="polite">
        {refined
          ? `Showing ${shown} of ${total} ${total === 1 ? noun : `${noun}s`} in this list.`
          : `${total} ${total === 1 ? noun : `${noun}s`}.`}
      </p>
    </div>
  );
}
