import { useMemo, useState } from 'react';
import { Activity, Award, BarChart3, ChevronDown, FileWarning, Gavel, Inbox, SendHorizontal, Timer, XCircle } from 'lucide-react';
import AdminPageHeader, { AdminHeaderTile } from '../../components/AdminPageHeader';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, ExportButton, FormField, StatusBadge } from '../../components/ui';
import {
  ALL_FILTER_VALUE,
  TURNAROUND_TARGET_DAYS,
  buildOfficeStatistics,
  downloadStatisticsWorkbook,
  filterStatisticsApplications,
  formatDays,
  formatRate,
  getAcademicYearOptions,
  getStatisticsFacets,
  getStatisticsFileName,
} from '../../lib/admissionsStatistics';
import { getActorRoleLabel } from '../../lib/applicationRequirements';
import { buildProgramScopeIndex } from '../../lib/reviewScope';
import { getCurrentAcademicYear } from '../../lib/profile';
import { plural } from '../../lib/formatters';

// The Admissions Office Admin's statistics route (`admin-statistics`). It is
// read-only: every figure is an aggregate derived in src/lib/admissionsStatistics.js
// from the workspace the Admin already loads, and nothing here opens a case or moves
// a stage. Applicants are never named, and application rejection reasons (kept in
// the staff-only comment thread) are not read.

// One hue for magnitude; the outcome colours are status colours and always ship
// with a legend and the number beside them.
const BAR_FILL = 'bg-ateneo dark:bg-blue-400';
const BAR_TRACK = 'bg-app-muted-surface';
const OUTCOME_SEGMENTS = [
  { key: 'accepted', label: 'Accepted', fill: 'bg-emerald-500 dark:bg-emerald-400' },
  { key: 'notAccepted', label: 'Not accepted', fill: 'bg-rose-500 dark:bg-rose-400' },
  { key: 'inProgress', label: 'In progress', fill: 'bg-slate-400 dark:bg-slate-500' },
];
const DOCUMENT_SEGMENTS = [
  { key: 'verified', label: 'Verified', fill: 'bg-emerald-500 dark:bg-emerald-400' },
  { key: 'pending', label: 'Pending', fill: 'bg-amber-400 dark:bg-amber-300' },
  { key: 'reverted', label: 'Reverted for resubmission', fill: 'bg-rose-500 dark:bg-rose-400' },
];

const widthOf = (value, max) => `${max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0}%`;

// Horizontal bars with the label and the value always visible, so the bar length is
// never the only carrier of the number.
function BarList({ rows, getValue = (row) => row.count, formatValue = (value) => value, noteOf, emptyLabel = 'Nothing recorded yet.' }) {
  const max = Math.max(0, ...rows.map((row) => getValue(row)));
  if (!rows.length || max === 0) return <p className="m-0 text-sm text-app-muted">{emptyLabel}</p>;
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {rows.map((row) => {
        const value = getValue(row);
        const note = noteOf?.(row);
        return (
          <li key={row.key || row.label} className="grid gap-1" title={`${row.label}: ${formatValue(value)}${note ? ` · ${note}` : ''}`}>
            <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-app-text">{row.label}</span>
              <strong className="shrink-0 tabular-nums text-app-text">{formatValue(value)}</strong>
            </div>
            <div className={`h-2 overflow-hidden rounded ${BAR_TRACK}`} aria-hidden="true">
              <div className={`h-full rounded ${BAR_FILL}`} style={{ width: widthOf(value, max) }} />
            </div>
            {note ? <span className="text-xs text-app-muted">{note}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Legend({ segments }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-app-muted">
      {segments.map((segment) => (
        <li key={segment.key} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${segment.fill}`} aria-hidden="true" />
          {segment.label}
        </li>
      ))}
    </ul>
  );
}

// A part-to-whole bar: segments separated by a 2px gap so neighbouring colours never
// touch, with a text equivalent for screen readers.
function SplitBar({ segments, values, label }) {
  const total = segments.reduce((sum, segment) => sum + (values[segment.key] || 0), 0);
  const description = segments.map((segment) => `${segment.label} ${values[segment.key] || 0}`).join(', ');
  return (
    <div className={`flex h-2.5 gap-0.5 overflow-hidden rounded ${BAR_TRACK}`} role="img" aria-label={`${label}: ${description}`} title={description}>
      {total > 0 ? segments.map((segment) => (values[segment.key] ? (
        <span key={segment.key} className={`h-full first:rounded-l last:rounded-r ${segment.fill}`} style={{ width: `${(values[segment.key] / total) * 100}%` }} />
      ) : null)) : null}
    </div>
  );
}

const outcomeNote = (row) => [
  `${row.accepted} accepted`,
  `${row.notAccepted} not accepted`,
  `${row.inProgress} in progress`,
].join(' · ');

function BreakdownRow({ row, children, expanded, onToggle }) {
  return (
    <li className="grid gap-2 rounded-2xl border border-app-border bg-app-surface p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          {onToggle ? (
            <button
              type="button"
              className="disclosure-action inline-flex min-w-0 items-center gap-1.5 text-left text-sm font-bold text-app-text"
              aria-expanded={expanded}
              onClick={onToggle}
            >
              <ChevronDown size={15} aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              <span className="[overflow-wrap:anywhere]">{row.label}</span>
            </button>
          ) : <strong className="block text-sm text-app-text [overflow-wrap:anywhere]">{row.label}</strong>}
          <span className="block text-xs text-app-muted">{outcomeNote(row)}</span>
        </div>
        <div className="flex shrink-0 items-baseline gap-3 text-sm">
          <span className="text-app-muted"><strong className="tabular-nums text-app-text">{row.applied}</strong> applied</span>
          <span className="text-app-muted"><strong className="tabular-nums text-app-text">{formatRate(row.acceptanceRate)}</strong> accepted</span>
        </div>
      </div>
      <SplitBar segments={OUTCOME_SEGMENTS} values={row} label={row.label} />
      {children}
    </li>
  );
}

function TrendChart({ rows }) {
  if (!rows.length) return <p className="m-0 text-sm text-app-muted">No submissions in this view.</p>;
  const max = Math.max(...rows.map((row) => row.count));
  // Label every bucket when there is room, otherwise every few so labels never
  // collide on a phone; each bar still names itself on hover and to a screen reader.
  const labelEvery = rows.length <= 8 ? 1 : Math.ceil(rows.length / 6);
  return (
    <div className="grid gap-2">
      <ol className="m-0 flex h-44 list-none items-end gap-1 border-b border-app-border p-0">
        {rows.map((row) => (
          <li
            key={row.key}
            className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end"
            title={`${row.label}: ${plural(row.count, 'submission')}`}
            aria-label={`${row.label}: ${plural(row.count, 'submission')}`}
            tabIndex={0}
          >
            <span className={`mb-1 text-[0.65rem] font-semibold tabular-nums text-app-text ${rows.length <= 12 ? '' : 'opacity-0 group-hover:opacity-100 group-focus:opacity-100'}`}>{row.count}</span>
            <span className={`w-full max-w-10 rounded-t ${BAR_FILL}`} style={{ height: max ? `${(row.count / max) * 85}%` : 0, minHeight: row.count ? 3 : 0 }} aria-hidden="true" />
          </li>
        ))}
      </ol>
      <ol className="m-0 flex list-none gap-1 p-0" aria-hidden="true">
        {rows.map((row, index) => (
          <li key={row.key} className="min-w-0 flex-1 truncate text-center text-[0.65rem] text-app-muted">
            {index % labelEvery === 0 || index === rows.length - 1 ? row.label : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}

function TurnaroundList({ rows }) {
  const max = Math.max(TURNAROUND_TARGET_DAYS, ...rows.map((row) => row.p90 || 0));
  return (
    <div className="grid gap-3">
      <ul className="m-0 grid list-none gap-3 p-0">
        {rows.map((row) => (
          <li key={row.key} className="grid gap-1">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 text-app-text">{row.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                {row.overTarget ? <StatusBadge tone="warning" className="!px-2 !py-0">Over {TURNAROUND_TARGET_DAYS} days</StatusBadge> : null}
                <strong className="tabular-nums text-app-text">{formatDays(row.median)}</strong>
              </span>
            </div>
            <div className={`relative h-2 overflow-hidden rounded ${BAR_TRACK}`} aria-hidden="true">
              {row.p90 != null ? <span className="absolute inset-y-0 left-0 rounded bg-blue-500/30 dark:bg-blue-300/30" style={{ width: widthOf(row.p90, max) }} /> : null}
              {row.median != null ? <span className={`absolute inset-y-0 left-0 rounded ${row.overTarget ? 'bg-amber-500 dark:bg-amber-400' : BAR_FILL}`} style={{ width: widthOf(row.median, max) }} /> : null}
            </div>
            <span className="text-xs text-app-muted">
              {row.count ? `${plural(row.count, 'case')} measured · 90% within ${formatDays(row.p90)}` : 'No case has completed this step yet.'}
            </span>
          </li>
        ))}
      </ul>
      <Legend segments={[
        { key: 'median', label: 'Median', fill: BAR_FILL },
        { key: 'p90', label: '90th percentile', fill: 'bg-blue-500/30 dark:bg-blue-300/30' },
        { key: 'over', label: `Median over the ${TURNAROUND_TARGET_DAYS}-day target`, fill: 'bg-amber-500 dark:bg-amber-400' },
      ]}
      />
    </div>
  );
}

function SegmentedToggle({ options, value, onChange, label }) {
  return (
    <div className="inline-flex rounded-lg border border-app-border bg-app-surface p-0.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={`disclosure-action rounded-md px-2.5 py-1 text-xs font-semibold transition ${value === option.value ? 'bg-ateneo text-white dark:bg-blue-500' : 'text-app-muted hover:text-app-text'}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function AdminStatistics({
  applications = [],
  documents = [],
  interviewNotes = [],
  academicPrograms = [],
  role = 'admissions_admin',
}) {
  const programIndex = useMemo(() => buildProgramScopeIndex(academicPrograms), [academicPrograms]);
  const defaultFilters = useMemo(() => ({
    academicYear: getCurrentAcademicYear(),
    scholarshipId: ALL_FILTER_VALUE,
    school: ALL_FILTER_VALUE,
  }), []);
  const [filters, setFilters] = useState(defaultFilters);
  const [trendBucket, setTrendBucket] = useState('month');
  const [expandedSchools, setExpandedSchools] = useState({});

  const yearOptions = useMemo(() => getAcademicYearOptions(applications), [applications]);
  const facets = useMemo(() => getStatisticsFacets(applications, programIndex), [applications, programIndex]);
  const inView = useMemo(
    () => filterStatisticsApplications(applications, filters, programIndex),
    [applications, filters, programIndex],
  );
  const stats = useMemo(
    () => buildOfficeStatistics({ applications: inView, documents, interviewNotes, programIndex, trendBucket }),
    [inView, documents, interviewNotes, programIndex, trendBucket],
  );
  const { headline } = stats;

  const updateFilter = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const hasChangedFilters = Object.keys(defaultFilters).some((key) => filters[key] !== defaultFilters[key]);

  const scholarshipLabel = facets.scholarships.find((option) => option.value === filters.scholarshipId)?.label;
  const filterSummary = [
    filters.academicYear === ALL_FILTER_VALUE ? 'All academic years' : `Academic year ${filters.academicYear}`,
    scholarshipLabel || 'All scholarships',
    filters.school === ALL_FILTER_VALUE ? 'All schools' : filters.school,
  ].join(' · ');

  const exportWorkbook = () => downloadStatisticsWorkbook(stats, {
    origin: 'Admissions Office › Statistics',
    filters: filterSummary,
    exportedBy: getActorRoleLabel(role),
  }, getStatisticsFileName(filters.academicYear === ALL_FILTER_VALUE ? 'all_years' : filters.academicYear));

  const funnelSubmitted = stats.funnel[0]?.count || 0;

  return (
    <div className="grid content-start gap-5">
      <AdminPageHeader
        title="Office statistics"
        description="How the scholarship cycle is going: applications, outcomes, stage turnaround, document verification, and panel recommendations."
      >
        <AdminHeaderTile
          icon={BarChart3}
          label="Acceptance rate"
          tone={headline.decided ? 'success' : 'neutral'}
          title={headline.decided ? `${formatRate(headline.acceptanceRate)} of decided cases` : 'No decided cases yet'}
          note={headline.decided ? `${headline.accepted} of ${plural(headline.decided, 'decided case')} · ${filterSummary}` : filterSummary}
        />
      </AdminPageHeader>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <FormField label="Academic year" className="gap-1 [&_span]:text-xs">
            <select className="min-h-10 py-2 text-sm" value={filters.academicYear} onChange={(event) => updateFilter({ academicYear: event.target.value })}>
              <option value={ALL_FILTER_VALUE}>All academic years</option>
              {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </FormField>
          <FormField label="Scholarship" className="gap-1 [&_span]:text-xs">
            <select className="min-h-10 py-2 text-sm" value={filters.scholarshipId} onChange={(event) => updateFilter({ scholarshipId: event.target.value })}>
              <option value={ALL_FILTER_VALUE}>All scholarships</option>
              {facets.scholarships.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FormField>
          <FormField label="School" className="gap-1 [&_span]:text-xs">
            <select className="min-h-10 py-2 text-sm" value={filters.school} onChange={(event) => updateFilter({ school: event.target.value })}>
              <option value={ALL_FILTER_VALUE}>All schools</option>
              {facets.schools.map((school) => <option key={school} value={school}>{school}</option>)}
            </select>
          </FormField>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
            <ExportButton onClick={exportWorkbook} disabled={!inView.length} className="min-h-10">Export to Excel</ExportButton>
            {hasChangedFilters ? <Button type="button" variant="ghost" onClick={() => setFilters(defaultFilters)}>Reset</Button> : null}
          </div>
        </div>
        <p className="m-0 mt-3 text-xs text-app-muted">
          {plural(inView.length, 'submitted application')} in view. Drafts are not counted. Rates include decided outcomes still held until release; the page names no applicant.
        </p>
      </Card>

      <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4" aria-label="Headline figures">
        <StatCard icon={Inbox} tone="info" label="Applications submitted" value={headline.submitted} note="In the selected view" />
        <StatCard icon={Activity} tone="warning" label="Open cases" value={headline.open} note="Still moving through the office" />
        <StatCard icon={Gavel} tone="warning" label="Awaiting the school" value={headline.awaitingApproval} note="Recommended, not yet decided" />
        <StatCard icon={Award} tone="success" label="Approved, awaiting release" value={headline.awaitingRelease} note="Held until the scholarship is released" />
        <StatCard icon={SendHorizontal} tone="success" label="Released" value={headline.released} note="Accepted and released" />
        <StatCard icon={XCircle} tone="neutral" label="Not accepted" value={headline.notAccepted} note="Decided by the school" />
        <StatCard icon={Timer} tone="info" label="Median days to decision" value={formatDays(headline.medianDaysToDecision)} note="Submission to the school’s decision" />
        <StatCard icon={FileWarning} tone="warning" label="Document revert rate" value={formatRate(stats.documents.revertRate)} note="Of decided Document Vault files" />
      </section>

      {!inView.length ? (
        <EmptyState title="No submitted applications in this view" description="Choose another academic year, scholarship, or school, or reset the filters." />
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="Application pipeline" action={<StatusBadge tone="info">{plural(funnelSubmitted, 'application')}</StatusBadge>}>
              <p className="m-0 mb-3 text-xs text-app-muted">How many applications reached each stage, from their recorded status history.</p>
              <BarList
                rows={stats.funnel}
                formatValue={(value) => value}
                noteOf={(row) => (row.share != null ? `${formatRate(row.share)} of submitted` : '')}
              />
            </Card>
            <Card title="Where cases stand now">
              <p className="m-0 mb-3 text-xs text-app-muted">The current stage of every application in view.</p>
              <BarList rows={stats.distribution} />
            </Card>
          </section>

          <Card
            title="Submissions over time"
            action={(
              <SegmentedToggle
                label="Group submissions by"
                value={trendBucket}
                onChange={setTrendBucket}
                options={[{ value: 'month', label: 'Monthly' }, { value: 'week', label: 'Weekly' }]}
              />
            )}
          >
            <TrendChart rows={stats.trend} />
          </Card>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="By scholarship" action={<Legend segments={OUTCOME_SEGMENTS} />}>
              <ul className="m-0 grid list-none gap-3 p-0">
                {stats.byScholarship.map((row) => <BreakdownRow key={row.key} row={row} />)}
              </ul>
            </Card>
            <Card title="By school and department" action={<Legend segments={OUTCOME_SEGMENTS} />}>
              <ul className="m-0 grid list-none gap-3 p-0">
                {stats.byHierarchy.map((school) => {
                  const expanded = Boolean(expandedSchools[school.key]);
                  return (
                    <BreakdownRow
                      key={school.key}
                      row={school}
                      expanded={expanded}
                      onToggle={() => setExpandedSchools((current) => ({ ...current, [school.key]: !expanded }))}
                    >
                      {expanded ? (
                        <ul className="m-0 grid list-none gap-3 border-t border-app-border p-0 pt-3">
                          {school.departments.map((department) => (
                            <li key={department.key} className="grid gap-1.5">
                              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm">
                                <span className="min-w-0 text-app-text [overflow-wrap:anywhere]">{department.label}</span>
                                <span className="shrink-0 text-xs text-app-muted">
                                  <strong className="tabular-nums text-app-text">{department.applied}</strong> applied · <strong className="tabular-nums text-app-text">{formatRate(department.acceptanceRate)}</strong> accepted
                                </span>
                              </div>
                              <SplitBar segments={OUTCOME_SEGMENTS} values={department} label={department.label} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </BreakdownRow>
                  );
                })}
              </ul>
            </Card>
          </section>

          <Card title="Stage turnaround" action={<StatusBadge tone="neutral">Target {TURNAROUND_TARGET_DAYS} days per step</StatusBadge>}>
            <p className="m-0 mb-3 text-xs text-app-muted">Days between the first time a case entered one stage and the first time it entered the next, from the append-only status log.</p>
            <TurnaroundList rows={stats.turnaround} />
          </Card>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="Document Vault verification" action={<StatusBadge tone="info">{plural(stats.documents.total, 'attached file')}</StatusBadge>}>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <SplitBar segments={DOCUMENT_SEGMENTS} values={stats.documents} label="Attached files by verification state" />
                  <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 text-center">
                    {DOCUMENT_SEGMENTS.map((segment) => (
                      <li key={segment.key} className="grid gap-0.5 rounded-xl border border-app-border bg-app-surface px-2 py-2">
                        <strong className="text-lg tabular-nums text-app-text">{stats.documents[segment.key]}</strong>
                        <span className="inline-flex items-center justify-center gap-1.5 text-[0.7rem] text-app-muted">
                          <span className={`h-2 w-2 shrink-0 rounded-sm ${segment.fill}`} aria-hidden="true" />
                          {segment.key === 'reverted' ? 'Reverted' : segment.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 text-xs text-app-muted">Median time from upload to the office’s decision: {formatDays(stats.documents.medianDaysToDecision)}.</p>
                </div>
                <div className="grid gap-2">
                  <h4 className="m-0 text-sm font-bold text-app-text">Most often reverted</h4>
                  <BarList
                    rows={stats.documents.byType.filter((row) => row.reverted > 0).slice(0, 6)}
                    getValue={(row) => row.reverted}
                    noteOf={(row) => `${formatRate(row.revertRate)} of decided files · ${plural(row.total, 'file')} attached`}
                    emptyLabel="No attached file has been reverted for resubmission."
                  />
                </div>
                <div className="grid gap-2">
                  <h4 className="m-0 text-sm font-bold text-app-text">What to correct — top reasons</h4>
                  <BarList rows={stats.documents.reasons.slice(0, 6)} emptyLabel="No revert reasons recorded." />
                </div>
              </div>
            </Card>

            <Card title="Panel recommendations" action={<StatusBadge tone="info">{plural(stats.recommendations.recorded, 'case')}</StatusBadge>}>
              <p className="m-0 mb-3 text-xs text-app-muted">The latest recommendation level the interview panel recorded for each case, and how those cases ended.</p>
              <BarList
                rows={stats.recommendations.levels}
                noteOf={(row) => (row.count ? outcomeNote(row) : '')}
                emptyLabel="No panel has recorded a recommendation level yet."
              />
            </Card>
          </section>

          <Card title="Applicant profile" action={<StatusBadge tone="neutral">Frozen at submission</StatusBadge>}>
            <p className="m-0 mb-4 text-xs text-app-muted">Self-reported answers frozen in each application’s profile snapshot. They are not Registrar-verified.</p>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <section className="grid content-start gap-2">
                <h4 className="m-0 text-sm font-bold text-app-text">Applicant status</h4>
                <BarList rows={stats.profile.applicantStatus} />
              </section>
              <section className="grid content-start gap-2">
                <h4 className="m-0 text-sm font-bold text-app-text">Year standing</h4>
                <BarList rows={stats.profile.yearStanding} />
              </section>
              <section className="grid content-start gap-2">
                <h4 className="m-0 text-sm font-bold text-app-text">Annual household income</h4>
                <BarList rows={stats.profile.householdIncome} />
              </section>
              <section className="grid content-start gap-2">
                <h4 className="m-0 text-sm font-bold text-app-text">QPI (enrolled students)</h4>
                <BarList rows={stats.profile.qpi} emptyLabel="No enrolled applicant in view." />
              </section>
              <section className="grid content-start gap-2">
                <h4 className="m-0 text-sm font-bold text-app-text">Senior high school general average (incoming first years)</h4>
                <BarList rows={stats.profile.shsAverage} emptyLabel="No incoming first-year applicant in view." />
              </section>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
