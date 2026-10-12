import { useState } from 'react';
import { EmptyState } from '../components/pageParts';
import { fmtCurrency, fmtDate } from '../lib/formatters';
import { coverageTypes } from '../lib/constants';
import { DENIAL_MESSAGE, evaluateApplicationGate, evaluateScholarship, getDeadlineStatus, getScholarshipAcademicDisplay, isInternalScholarship } from '../lib/eligibility';
import { SelectPicker } from './LoginScreen';

export default function ScholarshipExplorer({ profile, scholarships, searchQuery, filters, onSearchChange, onFilterChange, onApply }) {
  const [expandedEligibilityId, setExpandedEligibilityId] = useState(null);
  const activeFilterCount = [filters.category, filters.coverage, filters.deadline].filter((value) => value !== 'all').length + (filters.activeOnly ? 1 : 0);

  return (
    <div className="grid gap-4">
      <section className="explorer-filters grid gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="explorer-filter-head">
          <span className="page-section-label">Scholarship explorer</span>
          <label className="explorer-search-field">
            <span className="sr-only">Search scholarships</span>
            <input value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search by name, category, coverage, or origin" aria-label="Search scholarships" />
          </label>
        </div>
        <div className="explorer-filter-toolbar">
          <div className="explorer-filter-slot">
            <SelectPicker
              label="Category"
              value={filters.category}
              onChange={(value) => onFilterChange({ category: value })}
              options={[
                { value: 'all', label: 'All categories' },
                { value: 'Internal Endowment', label: 'Internal Endowment' },
                { value: 'Corporate & External', label: 'Corporate & External' },
                { value: 'State-Sponsored', label: 'State-Sponsored' },
                { value: 'Specialized Service', label: 'Specialized Service' },
              ]}
              idPrefix="explorer-category"
            />
          </div>
          <div className="explorer-filter-slot">
            <SelectPicker
              label="Coverage"
              value={filters.coverage}
              onChange={(value) => onFilterChange({ coverage: value })}
              options={coverageTypes.map((item) => ({ value: item, label: item === 'all' ? 'All coverage' : item }))}
              idPrefix="explorer-coverage"
            />
          </div>
          <div className="explorer-filter-slot">
            <SelectPicker
              label="Deadline"
              value={filters.deadline}
              onChange={(value) => onFilterChange({ deadline: value })}
              options={[
                { value: 'all', label: 'Any deadline' },
                { value: 'open', label: 'Open only' },
                { value: 'urgent', label: 'Urgent only' },
                { value: 'closed', label: 'Closed only' },
              ]}
              idPrefix="explorer-deadline"
            />
          </div>
          <label className="explorer-active-only">
            <input type="checkbox" checked={filters.activeOnly} onChange={(event) => onFilterChange({ activeOnly: event.target.checked })} />
            Active only
          </label>
          {(activeFilterCount > 0 || searchQuery) && <button type="button" className="explorer-reset-button" onClick={() => { onSearchChange(''); onFilterChange({ category: 'all', coverage: 'all', deadline: 'all', activeOnly: false }); }}>Clear filters</button>}
        </div>
        <p className="explorer-filter-caption" aria-live="polite">
          <span><strong>{scholarships.length}</strong> matching program{scholarships.length === 1 ? '' : 's'}{activeFilterCount ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied` : ' · Browse all programs'}</span>
          <span className="explorer-govgrant-chip">{profile.hasActiveGovernmentGrant ? 'Gov grant active' : 'No active gov grant'}</span>
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {scholarships.length ? scholarships.map((scholarship) => {
          const deadline = getDeadlineStatus(scholarship.deadline);
          const isInternal = isInternalScholarship(scholarship);
          const gateResult = isInternal ? evaluateApplicationGate(profile, scholarship) : null;
          const academicDisplay = getScholarshipAcademicDisplay(profile, scholarship);
          const isEligibilityExpanded = String(expandedEligibilityId) === String(scholarship.id);
          const eligibilityResult = isInternal
            ? evaluateScholarship(profile, scholarship)
            : null;
          return (
            <article key={scholarship.id} className="rounded-app border bg-app-card p-5 shadow-app backdrop-blur scholarship-card">
                <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <span className="pill">{scholarship.category}</span>
                  <h3 className="scholarship-card-title">{scholarship.title}</h3>
                </div>
                <span className={`inline-flex max-w-full shrink-0 items-center justify-center rounded-full px-3 py-1 text-xs font-semibold ${deadline.tone}`}>{deadline.label}</span>
              </div>

              <p className="scholarship-card-coverage">{scholarship.coverage}</p>

              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-app-muted">
                {academicDisplay
                  ? <span><strong>{academicDisplay.label}</strong> {academicDisplay.floorLabel}+</span>
                  : scholarship.minimumQpi != null
                    ? <span><strong>QPI</strong> {scholarship.minimumQpi}+</span>
                    : null}
                <span><strong>Income</strong> ≤ {fmtCurrency(scholarship.maximumIncome)}</span>
                <span><strong>Deadline</strong> {fmtDate(scholarship.deadline)}</span>
                <span><strong>Degrees</strong> {scholarship.ruleFamily === 'work-study' || scholarship.eligibleDegrees.includes('ALL') ? 'All programs' : scholarship.eligibleDegrees.length}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {scholarship.tags.map((tag) => <span key={tag} className="rounded-full border border-app-border bg-app-surface px-2.5 py-1 text-xs text-app-muted">{tag}</span>)}
              </div>

              <button
                type="button"
                className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                onClick={() => setExpandedEligibilityId(isEligibilityExpanded ? null : scholarship.id)}
                aria-expanded={isEligibilityExpanded}
                aria-controls={`eligibility-details-${scholarship.id}`}
              >
                {isEligibilityExpanded ? 'Close eligibility details' : 'Check eligibility'}
              </button>

              {isEligibilityExpanded && (
                <section
                  id={`eligibility-details-${scholarship.id}`}
                  className="mt-3 grid gap-3 rounded-xl border border-app-border bg-app-surface p-4"
                  aria-label={`Eligibility details for ${scholarship.title}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="m-0 text-sm font-bold text-app-text">Smart Eligibility Checker</h4>
                    {isInternal && (
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${gateResult.allowed ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'}`}>
                        {gateResult.allowed ? 'Qualified to proceed' : 'Not qualified'}
                      </span>
                    )}
                  </div>

                  {isInternal ? (
                    <>
                      <p className="m-0 text-sm text-app-muted">
                        {gateResult.allowed
                          ? 'Your saved profile meets the current AdDU qualification rules for this scholarship.'
                          : DENIAL_MESSAGE}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-app-muted">
                        <span><strong>{academicDisplay ? academicDisplay.detailLabel : 'Minimum QPI'}:</strong> {academicDisplay ? academicDisplay.floorLabel : (scholarship.minimumQpi ?? 'See program rules')}</span>
                        <span><strong>Maximum household income:</strong> {scholarship.maximumIncome == null ? 'See program rules' : fmtCurrency(scholarship.maximumIncome)}</span>
                        <span><strong>Degree scope:</strong> {scholarship.ruleFamily === 'work-study' || scholarship.eligibleDegrees?.includes('ALL') ? 'All programs' : scholarship.eligibleDegrees?.length ? `${scholarship.eligibleDegrees.length} eligible program(s)` : 'See program rules'}</span>
                      </div>
                      {!gateResult.allowed && gateResult.reasons.length > 0 && (
                        <ul className="m-0 grid gap-1 pl-5 text-sm text-rose-700 dark:text-rose-300" role="status">
                          {gateResult.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                        </ul>
                      )}
                      {eligibilityResult?.infoNotes?.map((note) => (
                        <p key={note} className="m-0 text-xs text-app-muted">{note}</p>
                      ))}
                    </>
                  ) : (
                    <p className="m-0 text-sm text-app-muted">
                      Eligibility for this external program is determined by the provider. Please review its published requirements before applying.
                    </p>
                  )}

                  {isInternal && gateResult.allowed && (
                    <button
                      type="button"
                      className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                      onClick={() => onApply(scholarship)}
                    >
                      Add to applications
                    </button>
                  )}
                </section>
              )}

              {!isInternal && (
                <button
                  type="button"
                  className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                  onClick={() => onApply(scholarship)}
                >
                  Add to applications
                </button>
              )}
            </article>
          );
        }) : <EmptyState title="No scholarships match your filters" description="Relax the filters or use a broader search term to surface more programs." action={<button className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => { onSearchChange(''); onFilterChange({ category: 'all', coverage: 'all', deadline: 'all', activeOnly: false }); }}>Reset filters</button>} />}
      </section>
    </div>
  );
}
