import { useMemo, useState } from 'react';
import { Activity, Award, BarChart3, CalendarClock, ChevronDown, FileCheck2, FileWarning, Gavel, Inbox, ListChecks, SendHorizontal, Timer, Users, XCircle } from 'lucide-react';
import AdminPageHeader, { AdminHeaderTile } from './AdminPageHeader';
import { StatCard } from './pageParts';
import { Button, Card, EmptyState, ExportButton, FormField, StatusBadge } from './ui';
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
  getStatisticsScope,
} from '../lib/admissionsStatistics';
import { getActorRoleLabel } from '../lib/applicationRequirements';
import { buildProgramScopeIndex, isInterviewerRole } from '../lib/reviewScope';
import { getCurrentAcademicYear } from '../lib/profile';
import { plural } from '../lib/formatters';

// The Statistics page every staff and reviewer role shares. It is read-only: every
// figure is an aggregate derived in src/lib/admissionsStatistics.js from the slices
// the signed-in role already loads, and nothing here opens a case or moves a stage.
// getStatisticsScope() decides the role's scope and sections: the Admin sees
// everything, Staff see volume only, and a reviewer sees its own level plus its own
// decisions and panel work. Applicants are never named.

// One hue for magnitude; the outcome colours are status colours and always ship
// with a legend and the number beside them.
const BAR_FILL = 'bg-ateneo dark:bg-blue-400';
const BAR_TRACK = 'bg-app-muted-surface';
const OUTCOME_SEGMENTS = [
  { key: 'accepted', label: 'Accepted', fill: 'bg-emerald-500 dark:bg-emerald-400' },
  { key: 'notAccepted', label: 'Not accepted', fill: 'bg-rose-500 dark:bg-rose-400' },
  { key: 'inProgress', label: 'In progress', fill: 'bg-slate-400 dark:bg-slate-500' },
];
const DECISION_SEGMENTS = [
  { key: 'approved', label: 'Approved', fill: 'bg-emerald-500 dark:bg-emerald-400' },
  { key: 'notAccepted', label: 'Not accepted', fill: 'bg-rose-500 dark:bg-rose-400' },
  { key: 'awaiting', label: 'Awaiting your decision', fill: 'bg-amber-400 dark:bg-amber-300' },
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

// One group of the scholarship or hierarchy breakdown. With outcomes it carries the
// accepted / not accepted split; without, only the volume.
function BreakdownRow({ row, outcomes, children, expanded, onToggle }) {
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
          <span className="block text-xs text-app-muted">{outcomes ? outcomeNote(row) : `${row.inProgress} still in progress`}</span>
        </div>
        <div className="flex shrink-0 items-baseline gap-3 text-sm">
          <span className="text-app-muted"><strong className="tabular-nums text-app-text">{row.applied}</strong> applied</span>
          {outcomes ? <span className="text-app-muted"><strong className="tabular-nums text-app-text">{formatRate(row.acceptanceRate)}</strong> accepted</span> : null}
        </div>
      </div>
      {outcomes ? <SplitBar segments={OUTCOME_SEGMENTS} values={row} label={row.label} /> : null}
      {children}
    </li>
  );
}

function ChildRows({ rows, outcomes }) {
  return (
    <ul className="m-0 grid list-none gap-3 border-t border-app-border p-0 pt-3">
      {rows.map((child) => (
        <li key={child.key} className="grid gap-1.5">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="min-w-0 text-app-text [overflow-wrap:anywhere]">{child.label}</span>
            <span className="shrink-0 text-xs text-app-muted">
              <strong className="tabular-nums text-app-text">{child.applied}</strong> applied
              {outcomes ? <> · <strong className="tabular-nums text-app-text">{formatRate(child.acceptanceRate)}</strong> accepted</> : ` · ${child.inProgress} in progress`}
            </span>
          </div>
          {outcomes ? <SplitBar segments={OUTCOME_SEGMENTS} values={child} label={child.label} /> : null}
        </li>
      ))}
    </ul>
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

// A small labelled figure inside a section card.
function MiniFigure({ label, value }) {
  return (
    <div className="grid gap-0.5 rounded-xl border border-app-border bg-app-surface px-3 py-2">
      <strong className="text-lg tabular-nums text-app-text">{value}</strong>
      <span className="text-[0.7rem] leading-tight text-app-muted">{label}</span>
    </div>
  );
}

function HeadlineCards({ headline, outcomes, documents }) {
  if (!outcomes) {
    return (
      <>
        <StatCard icon={Inbox} tone="info" label="Applications submitted" value={headline.submitted} note="In the selected view" />
        <StatCard icon={Activity} tone="warning" label="Open cases" value={headline.open} note="Still moving through the office" />
        <StatCard icon={FileCheck2} tone="info" label="Before or at verification" value={headline.forVerification} note="Submitted, under review, or verifying" />
        <StatCard icon={Users} tone="info" label="For or in interview" value={headline.inInterview} note="With the interviewers" />
        <StatCard icon={Gavel} tone="warning" label="Awaiting the school" value={headline.awaitingApproval} note="Recommended, not yet decided" />
        <StatCard icon={ListChecks} tone="neutral" label="Closed" value={headline.closed} note="Decided by the school" />
        <StatCard icon={Timer} tone="warning" label="Documents pending" value={documents.pending} note="Attached files awaiting the Admin" />
        <StatCard icon={FileWarning} tone="warning" label="Document revert rate" value={formatRate(documents.revertRate)} note="Of decided Document Vault files" />
      </>
    );
  }
  return (
    <>
      <StatCard icon={Inbox} tone="info" label="Applications submitted" value={headline.submitted} note="In the selected view" />
      <StatCard icon={Activity} tone="warning" label="Open cases" value={headline.open} note="Still moving through the office" />
      <StatCard icon={Gavel} tone="warning" label="Awaiting the school" value={headline.awaitingApproval} note="Recommended, not yet decided" />
      <StatCard icon={Award} tone="success" label="Approved, awaiting release" value={headline.awaitingRelease} note="Held until the scholarship is released" />
      <StatCard icon={SendHorizontal} tone="success" label="Released" value={headline.released} note="Accepted and released" />
      <StatCard icon={XCircle} tone="neutral" label="Not accepted" value={headline.notAccepted} note="Decided by the school" />
      <StatCard icon={Timer} tone="info" label="Median days to decision" value={formatDays(headline.medianDaysToDecision)} note="Submission to the school’s decision" />
      <StatCard icon={FileWarning} tone="warning" label="Document revert rate" value={formatRate(documents.revertRate)} note="Of decided Document Vault files" />
    </>
  );
}

function getHeaderTile({ stats, outcomes, filterSummary }) {
  const { headline, decisions } = stats;
  if (decisions?.awaiting) {
    return {
      icon: Gavel,
      label: 'Awaiting your decision',
      tone: 'warning',
      title: plural(decisions.awaiting, 'recommendation'),
      note: `You are the approving level · ${filterSummary}`,
    };
  }
  if (!outcomes) {
    return { icon: Activity, label: 'Open cases', tone: 'info', title: plural(headline.open, 'open case'), note: filterSummary };
  }
  return {
    icon: BarChart3,
    label: 'Acceptance rate',
    tone: headline.decided ? 'success' : 'neutral',
    title: headline.decided ? `${formatRate(headline.acceptanceRate)} of decided cases` : 'No decided cases yet',
    note: headline.decided ? `${headline.accepted} of ${plural(headline.decided, 'decided case')} · ${filterSummary}` : filterSummary,
  };
}

export default function StatisticsWorkspace({
  applications = [],
  documents = [],
  interviewNotes = [],
  interviewPanelists = [],
  approvalLevels = [],
  academicPrograms = [],
  profile = {},
  role = 'admissions_admin',
  headerLabel,
  title = 'Statistics',
  description = '',
  origin = 'Statistics',
}) {
  const programIndex = useMemo(() => buildProgramScopeIndex(academicPrograms), [academicPrograms]);
  // The parent rebuilds the profile object on every render, so the scope is keyed on
  // the fields that decide it.
  const { id: viewerId = '', reviewSchool, reviewCluster, reviewDepartment, department } = profile || {};
  const scopeProfile = useMemo(
    () => ({ id: viewerId, role, reviewSchool, reviewCluster, reviewDepartment, department }),
    [viewerId, role, reviewSchool, reviewCluster, reviewDepartment, department],
  );
  const scope = useMemo(() => getStatisticsScope(role, scopeProfile), [role, scopeProfile]);
  const outcomes = scope.sections.outcomes;

  const defaultFilters = useMemo(() => ({
    academicYear: getCurrentAcademicYear(),
    scholarshipId: ALL_FILTER_VALUE,
    school: ALL_FILTER_VALUE,
  }), []);
  const [filters, setFilters] = useState(defaultFilters);
  const [trendBucket, setTrendBucket] = useState('month');
  const [expandedGroups, setExpandedGroups] = useState({});

  const yearOptions = useMemo(() => getAcademicYearOptions(applications), [applications]);
  const facets = useMemo(() => getStatisticsFacets(applications, programIndex), [applications, programIndex]);
  // A reviewer has no school filter: its queue is already its scope.
  const { showSchoolFilter } = scope;
  const effectiveFilters = showSchoolFilter ? filters : { ...filters, school: ALL_FILTER_VALUE };
  const inView = useMemo(
    () => filterStatisticsApplications(applications, showSchoolFilter ? filters : { ...filters, school: ALL_FILTER_VALUE }, programIndex),
    [applications, filters, showSchoolFilter, programIndex],
  );
  const stats = useMemo(
    () => buildOfficeStatistics({
      applications: inView,
      documents,
      interviewNotes,
      interviewPanelists,
      approvalLevels,
      programIndex,
      trendBucket,
      scope,
      profile: scopeProfile,
      viewerId,
    }),
    [inView, documents, interviewNotes, interviewPanelists, approvalLevels, programIndex, trendBucket, scope, scopeProfile, viewerId],
  );
  const { headline } = stats;

  const updateFilter = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const hasChangedFilters = Object.keys(defaultFilters).some((key) => effectiveFilters[key] !== defaultFilters[key]);

  const scholarshipLabel = facets.scholarships.find((option) => option.value === filters.scholarshipId)?.label;
  const filterSummary = [
    filters.academicYear === ALL_FILTER_VALUE ? 'All academic years' : `Academic year ${filters.academicYear}`,
    scholarshipLabel || 'All scholarships',
    scope.showSchoolFilter
      ? (filters.school === ALL_FILTER_VALUE ? 'All schools' : filters.school)
      : scope.scopeLabel,
  ].join(' · ');

  const exportWorkbook = () => downloadStatisticsWorkbook(stats, {
    title,
    origin,
    scope: scope.showSchoolFilter ? '' : scope.scopeLabel,
    filters: filterSummary,
    exportedBy: getActorRoleLabel(role),
  }, getStatisticsFileName(filters.academicYear === ALL_FILTER_VALUE ? 'all_years' : filters.academicYear));

  const funnelSubmitted = stats.funnel[0]?.count || 0;
  const showMyInterviews = Boolean(stats.myInterviews) && (isInterviewerRole(role) || stats.myInterviews.involved > 0);
  const showDecisions = Boolean(stats.decisions?.total);

  return (
    <div className="grid content-start gap-5">
      <AdminPageHeader title={title} description={description} label={headerLabel}>
        <AdminHeaderTile {...getHeaderTile({ stats, outcomes, filterSummary })} />
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
          {scope.showSchoolFilter ? (
            <FormField label="School" className="gap-1 [&_span]:text-xs">
              <select className="min-h-10 py-2 text-sm" value={filters.school} onChange={(event) => updateFilter({ school: event.target.value })}>
                <option value={ALL_FILTER_VALUE}>All schools</option>
                {facets.schools.map((school) => <option key={school} value={school}>{school}</option>)}
              </select>
            </FormField>
          ) : (
            // A reviewer's scope is fixed by its account, so it is stated, not chosen.
            <div className="grid content-start gap-1">
              <span className="text-xs font-semibold text-app-muted">Your scope</span>
              <div className="readonly-control !min-h-10 !py-2 text-sm" aria-label={`Your scope: ${scope.scopeLabel}`}>{scope.scopeLabel}</div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
            <ExportButton onClick={exportWorkbook} disabled={!inView.length} className="min-h-10">Export to Excel</ExportButton>
            {hasChangedFilters ? <Button type="button" variant="ghost" onClick={() => setFilters(defaultFilters)}>Reset</Button> : null}
          </div>
        </div>
        <p className="m-0 mt-3 text-xs text-app-muted">
          {plural(inView.length, 'submitted application')} in view. Drafts are not counted.
          {outcomes
            ? ' Rates include decided outcomes still held until release; the page names no applicant.'
            : ' Application volume and timing only; decisions and panel recommendations are not shown. The page names no applicant.'}
        </p>
      </Card>

      <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4" aria-label="Headline figures">
        <HeadlineCards headline={headline} outcomes={outcomes} documents={stats.documents} />
      </section>

      {!inView.length ? (
        <EmptyState title="No submitted applications in this view" description="Choose another academic year or scholarship, or reset the filters." />
      ) : (
        <>
          {showDecisions ? (
            <Card title="Your decisions" action={<Legend segments={DECISION_SEGMENTS} />}>
              <p className="m-0 mb-3 text-xs text-app-muted">The recommendations in your scope for which your level is the configured approver, and the panel’s recommendation against your decision.</p>
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniFigure label="Awaiting your decision" value={stats.decisions.awaiting} />
                  <MiniFigure label="Approved" value={stats.decisions.approved} />
                  <MiniFigure label="Not accepted" value={stats.decisions.notAccepted} />
                  <MiniFigure label="Median days to decide" value={formatDays(stats.decisions.medianDaysToDecision)} />
                </div>
                <SplitBar segments={DECISION_SEGMENTS} values={stats.decisions} label="Your decisions" />
                <ul className="m-0 grid list-none gap-3 p-0">
                  {stats.decisions.byLevel.map((row) => (
                    <li key={row.key} className="grid gap-1.5">
                      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm">
                        <span className="min-w-0 text-app-text">Panel: {row.label}</span>
                        <span className="shrink-0 text-xs text-app-muted">
                          <strong className="tabular-nums text-app-text">{row.count}</strong> · {row.approved} approved · {row.notAccepted} not accepted · {row.awaiting} awaiting
                        </span>
                      </div>
                      <SplitBar segments={DECISION_SEGMENTS} values={row} label={`Panel ${row.label}`} />
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ) : null}

          {showMyInterviews ? (
            <Card title="My interviews" action={<StatusBadge tone="info">{plural(stats.myInterviews.involved, 'case')}</StatusBadge>}>
              <p className="m-0 mb-3 text-xs text-app-muted">The interviews in your scope where you sit on the panel or that you scheduled, and the recommendation levels you recorded.</p>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="grid content-start grid-cols-2 gap-2">
                  <MiniFigure label="On the panel" value={stats.myInterviews.onPanel} />
                  <MiniFigure label="Panels you lead" value={stats.myInterviews.leading} />
                  <MiniFigure label="Interviews you scheduled" value={stats.myInterviews.scheduledByMe} />
                  <MiniFigure label="Upcoming interviews" value={stats.myInterviews.upcoming} />
                </div>
                <div className="grid content-start gap-2">
                  <h4 className="m-0 inline-flex items-center gap-1.5 text-sm font-bold text-app-text">
                    <CalendarClock size={15} aria-hidden="true" />
                    Your latest recommendation per case
                  </h4>
                  <BarList rows={stats.myInterviews.levels} emptyLabel="You have not recorded a recommendation level yet." />
                </div>
              </div>
            </Card>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="Application pipeline" action={<StatusBadge tone="info">{plural(funnelSubmitted, 'application')}</StatusBadge>}>
              <p className="m-0 mb-3 text-xs text-app-muted">How many applications reached each stage, from their recorded status history.</p>
              <BarList
                rows={stats.funnel}
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
            <Card title="By scholarship" action={outcomes ? <Legend segments={OUTCOME_SEGMENTS} /> : null}>
              <ul className="m-0 grid list-none gap-3 p-0">
                {stats.byScholarship.map((row) => <BreakdownRow key={row.key} row={row} outcomes={outcomes} />)}
              </ul>
            </Card>
            <Card title={stats.breakdown.title} action={outcomes ? <Legend segments={OUTCOME_SEGMENTS} /> : null}>
              <ul className="m-0 grid list-none gap-3 p-0">
                {stats.byHierarchy.map((group) => {
                  const hasChildren = group.children.length > 0;
                  const expanded = Boolean(expandedGroups[group.key]);
                  return (
                    <BreakdownRow
                      key={group.key}
                      row={group}
                      outcomes={outcomes}
                      expanded={expanded}
                      onToggle={hasChildren ? () => setExpandedGroups((current) => ({ ...current, [group.key]: !expanded })) : undefined}
                    >
                      {hasChildren && expanded ? <ChildRows rows={group.children} outcomes={outcomes} /> : null}
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

          <section className={`grid gap-4 ${stats.recommendations ? 'lg:grid-cols-2' : ''}`}>
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
                <div className={`grid gap-4 ${stats.recommendations ? '' : 'md:grid-cols-2'}`}>
                  <div className="grid content-start gap-2">
                    <h4 className="m-0 text-sm font-bold text-app-text">Most often reverted</h4>
                    <BarList
                      rows={stats.documents.byType.filter((row) => row.reverted > 0).slice(0, 6)}
                      getValue={(row) => row.reverted}
                      noteOf={(row) => `${formatRate(row.revertRate)} of decided files · ${plural(row.total, 'file')} attached`}
                      emptyLabel="No attached file has been reverted for resubmission."
                    />
                  </div>
                  <div className="grid content-start gap-2">
                    <h4 className="m-0 text-sm font-bold text-app-text">What to correct — top reasons</h4>
                    <BarList rows={stats.documents.reasons.slice(0, 6)} emptyLabel="No revert reasons recorded." />
                  </div>
                </div>
              </div>
            </Card>

            {stats.recommendations ? (
              <Card title="Panel recommendations" action={<StatusBadge tone="info">{plural(stats.recommendations.recorded, 'case')}</StatusBadge>}>
                <p className="m-0 mb-3 text-xs text-app-muted">The latest recommendation level the interview panel recorded for each case, and how those cases ended.</p>
                <BarList
                  rows={stats.recommendations.levels}
                  noteOf={(row) => (row.count ? outcomeNote(row) : '')}
                  emptyLabel="No panel has recorded a recommendation level yet."
                />
              </Card>
            ) : null}
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
