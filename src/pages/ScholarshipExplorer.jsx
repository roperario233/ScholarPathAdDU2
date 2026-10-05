import { EmptyState } from '../components/pageParts';
import { fmtCurrency, fmtDate } from '../lib/formatters';
import { coverageTypes } from '../lib/constants';
import { DENIAL_MESSAGE, evaluateApplicationGate, getDeadlineStatus, isInternalScholarship } from '../lib/eligibility';
import { SelectPicker } from './LoginScreen';

export default function ScholarshipExplorer({ profile, scholarships, searchQuery, filters, onSearchChange, onFilterChange, onApply }) {
  const activeFilterCount = [filters.category, filters.coverage, filters.deadline].filter((value) => value !== 'all').length + (filters.activeOnly ? 1 : 0);

  return (
    <div className="grid gap-4">
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row">
        <div className="page-title-copy">
          <span className="page-section-label">Scholarship explorer</span>
          <h2>Find scholarships that fit your goals</h2>
        </div>
        <div className="grid w-full gap-3 sm:grid-cols-3 md:w-auto text-center">
          <div className="page-metric">
            <strong>{scholarships.length}</strong>
            <span>Visible programs</span>
          </div>
          <div className="page-metric">
            <strong>{profile.hasActiveGovernmentGrant ? 'Gov grant active' : 'No gov grant'}</strong>
            <span>Exclusion logic status</span>
          </div>
          <div className="page-metric">
            <strong>{activeFilterCount}</strong>
            <span>Active filters</span>
          </div>
        </div>
      </section>

      <section className="explorer-filters rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="explorer-search-row">
          <label className="explorer-search-field">
            <span className="text-sm font-semibold text-app-text">Search scholarships</span>
            <input value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search by name, category, coverage, or origin" />
          </label>
          <div className="explorer-filter-summary" aria-live="polite">
            <strong>{activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied` : 'Browse all programs'}</strong>
            <span>{scholarships.length} matching program{scholarships.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="explorer-filter-grid">
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
        <SelectPicker
          label="Coverage"
          value={filters.coverage}
          onChange={(value) => onFilterChange({ coverage: value })}
          options={coverageTypes.map((item) => ({ value: item, label: item === 'all' ? 'All coverage' : item }))}
          idPrefix="explorer-coverage"
        />
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
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm font-semibold text-app-text">
          <input type="checkbox" checked={filters.activeOnly} onChange={(event) => onFilterChange({ activeOnly: event.target.checked })} />
          Active only
        </label>
        {(activeFilterCount > 0 || searchQuery) && <button type="button" className="explorer-reset-button" onClick={() => { onSearchChange(''); onFilterChange({ category: 'all', coverage: 'all', deadline: 'all', activeOnly: false }); }}>Clear filters</button>}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {scholarships.length ? scholarships.map((scholarship) => {
          const deadline = getDeadlineStatus(scholarship.deadline);
          const isInternal = isInternalScholarship(scholarship);
          const gateResult = isInternal ? evaluateApplicationGate(profile, scholarship) : null;
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
                <span><strong>QPI</strong> {scholarship.minimumQpi}+</span>
                <span><strong>Income</strong> ≤ {fmtCurrency(scholarship.maximumIncome)}</span>
                <span><strong>Deadline</strong> {fmtDate(scholarship.deadline)}</span>
                <span><strong>Degrees</strong> {scholarship.ruleFamily === 'work-study' || scholarship.eligibleDegrees.includes('ALL') ? 'All programs' : scholarship.eligibleDegrees.length}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {scholarship.tags.map((tag) => <span key={tag} className="rounded-full border border-app-border bg-app-surface px-2.5 py-1 text-xs text-app-muted">{tag}</span>)}
              </div>

              {gateResult && !gateResult.allowed && (
                <p className="mt-3 text-sm text-rose-700 dark:text-rose-300" role="status">
                  {DENIAL_MESSAGE} {gateResult.reasons.join(' ')}
                </p>
              )}
              <button
                type="button"
                className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onApply(scholarship)}
                disabled={Boolean(gateResult && !gateResult.allowed)}
                title={gateResult && !gateResult.allowed ? DENIAL_MESSAGE : undefined}
              >
                {gateResult && !gateResult.allowed ? 'Not qualified' : 'Add to applications'}
              </button>
            </article>
          );
        }) : <EmptyState title="No scholarships match your filters" description="Relax the filters or use a broader search term to surface more programs." action={<button className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => { onSearchChange(''); onFilterChange({ category: 'all', coverage: 'all', deadline: 'all', activeOnly: false }); }}>Reset filters</button>} />}
      </section>
    </div>
  );
}
