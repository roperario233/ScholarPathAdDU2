import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import AdminPageHeader from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, FormField, StatusBadge } from '../../components/ui';
import { describeApplicantAcademic } from '../../lib/applicationRequirements';
import {
  DEFAULT_INTAKE_POOL_FILTERS,
  INTAKE_POOL_COVERAGE,
  INTAKE_POOL_SORTS,
  INTAKE_POOL_STAGE_OPTIONS,
  filterIntakePool,
  getCaseOfficers,
  getCaseOpenedAt,
  getIntakePool,
  getIntakePoolFacets,
  getOfficerWorkload,
  getSubmissionWaitDays,
  getTakenCases,
  getUnclaimedInProgress,
} from '../../lib/admissionsOffice';
import { getApplicationStatusLabel, getStatusTone, isAdmissionsHeadRole } from '../../lib/constants';
import { fmtDate } from '../../lib/formatters';

const PAGE_SIZE = 20;
const WAITING_THRESHOLD_DAYS = 7;

const waitLabel = (days) => {
  if (days == null) return 'Submission date unknown';
  if (days <= 0) return 'Submitted today';
  return `Waiting ${days} day${days === 1 ? '' : 's'}`;
};

// The Intake pool is the office's master list of open applications. Nothing here
// is owned: an application leaves the unclaimed pool the moment any Admissions
// Office account opens it, and stays discoverable under the "With officers"
// coverage filter, which is how a taken case is found again. Picking up a case
// starts its review (Submitted -> Under Review) and opens the shared review
// surface, where a second officer who opens the same case simply joins it.
export default function AdminIntakePool({
  applications = [],
  caseOfficers = [],
  caseOfficersReady = true,
  students = {},
  documents = [],
  scholarships = [],
  role = 'admissions_office',
  currentUserId = '',
  reviewerName = '',
  onPickUpApplication,
  onChangeApplication,
  onEndorseApplication,
  interviewWorkspace = null,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  reviewComments = [],
  onAddComment,
  onJoinCase,
  onLeaveCase,
}) {
  const isHead = isAdmissionsHeadRole(role);
  const [filters, setFilters] = useState(DEFAULT_INTAKE_POOL_FILTERS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState(null);
  const [reviewTab, setReviewTab] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [pickingUpId, setPickingUpId] = useState(null);
  const today = useMemo(() => new Date(), []);

  const unclaimed = useMemo(() => getIntakePool(applications, caseOfficers), [applications, caseOfficers]);
  const unclaimedInProgress = useMemo(
    () => getUnclaimedInProgress(applications, caseOfficers),
    [applications, caseOfficers],
  );
  const taken = useMemo(() => getTakenCases(applications, caseOfficers), [applications, caseOfficers]);
  const workload = useMemo(
    () => (isHead ? getOfficerWorkload(applications, caseOfficers) : []),
    [applications, caseOfficers, isHead],
  );
  const facets = useMemo(() => getIntakePoolFacets(applications), [applications]);
  const filtered = useMemo(
    () => filterIntakePool(applications, caseOfficers, filters, today),
    [applications, caseOfficers, filters, today],
  );
  const visible = filtered.slice(0, visibleCount);
  const oldestWait = useMemo(() => {
    const days = unclaimed.map((entry) => getSubmissionWaitDays(entry, today)).filter((value) => value != null);
    return days.length ? Math.max(...days) : null;
  }, [unclaimed, today]);
  const selected = applications.find((entry) => entry.id === selectedId);

  const updateFilter = (patch) => {
    setFilters((previous) => ({ ...previous, ...patch }));
    setVisibleCount(PAGE_SIZE);
  };
  const resetFilters = () => {
    setFilters(DEFAULT_INTAKE_POOL_FILTERS);
    setVisibleCount(PAGE_SIZE);
  };

  const openReview = (applicationId) => {
    setReviewTab(null);
    setSelectedId(applicationId);
  };
  const closeReview = () => {
    setSelectedId(null);
    setReviewTab(null);
  };

  // Picking up runs the join before the modal opens, so a failed pickup reports
  // why instead of opening a case that never left the pool. Opening a case that
  // already has officers only reads it; the review modal joins the officer then.
  const handlePickUp = async (applicationId) => {
    setPickingUpId(applicationId);
    setFeedback(null);
    const result = await onPickUpApplication?.(applicationId);
    setPickingUpId(null);
    if (result?.error) {
      setFeedback({ message: result.error });
      return;
    }
    openReview(applicationId);
  };

  const coverageLabel = INTAKE_POOL_COVERAGE.find((option) => option.value === filters.coverage)?.label || 'Unclaimed';

  const renderRow = (entry) => {
    const officers = getCaseOfficers(caseOfficers, entry.id);
    const openedAt = getCaseOpenedAt(caseOfficers, entry.id);
    const days = getSubmissionWaitDays(entry, today);
    const attachedCount = Array.isArray(entry.attachedDocuments) ? entry.attachedDocuments.length : 0;
    const isUnclaimed = officers.length === 0;
    const pickingUp = pickingUpId === entry.id;
    const officerChips = officers.map((officer) => (
      officer.officerId && officer.officerId === currentUserId ? 'You' : officer.officerName
    ));
    return (
      <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3>{entry.studentName}</h3>
            <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
            <p className="mt-1 text-xs text-app-muted">
              {describeApplicantAcademic(entry)} · Income ₱{Number(entry.studentHouseholdIncome || 0).toLocaleString()} · Submitted {fmtDate(entry.submittedAt || entry.updatedAt)}
            </p>
          </div>
          <StatusBadge tone={getStatusTone(entry.status)}>{getApplicationStatusLabel(entry.status)}</StatusBadge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={days != null && days >= WAITING_THRESHOLD_DAYS ? 'warning' : 'neutral'}>{waitLabel(days)}</StatusBadge>
          {attachedCount
            ? <StatusBadge tone="neutral">{attachedCount} document{attachedCount === 1 ? '' : 's'}</StatusBadge>
            : <StatusBadge tone="neutral">No documents attached</StatusBadge>}
          {officerChips.length ? <StatusBadge tone="info">{officerChips.join(' · ')}</StatusBadge> : null}
          {openedAt ? <span className="text-xs text-app-muted">Picked up {fmtDate(openedAt)}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
          {isUnclaimed ? (
            <Button type="button" onClick={() => handlePickUp(entry.id)} disabled={pickingUp}>
              {pickingUp ? 'Picking up…' : 'Pick up for review'}
            </Button>
          ) : (
            <Button type="button" onClick={() => openReview(entry.id)}>Open case</Button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title="Application intake pool"
        description="The office's master list of open applications, oldest submission first. Pick up an unclaimed case to start its review; any officer who opens a case joins it."
        badge={`${unclaimed.length} unclaimed`}
        badgeTone={unclaimed.length ? 'warning' : 'success'}
      />

      {feedback?.message && (
        <div
          className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200"
          role="alert"
        >
          <span className="min-w-0">{feedback.message}</span>
          <button
            type="button"
            className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-current transition hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss intake pool message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {!caseOfficersReady && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-800 dark:text-amber-100" role="status">
          The case-officer roster is unavailable, so every application currently reads as unopened. Apply
          {' '}<code>supabase/migrations/20261027043147_add_application_case_officers.sql</code>{' '}
          to the Supabase project and reload.
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Unclaimed submissions" value={unclaimed.filter((entry) => entry.status === 'Submitted').length} note="Nobody has opened these yet" />
        <StatCard label="Oldest waiting" value={oldestWait == null ? '—' : `${oldestWait}d`} note="First come, first served" />
        <StatCard label="In progress, no officer" value={unclaimedInProgress.length} note="Moving without an officer" />
        <StatCard label="With officers" value={taken.length} note="Taken and discoverable below" />
      </section>

      <section>
        <Card
          title="Find a case"
          action={<StatusBadge tone={filtered.length ? 'info' : 'neutral'}>{filtered.length} in view</StatusBadge>}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <FormField label="Coverage">
              <select value={filters.coverage} onChange={(event) => updateFilter({ coverage: event.target.value })}>
                {INTAKE_POOL_COVERAGE.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Stage">
              <select value={filters.stage} onChange={(event) => updateFilter({ stage: event.target.value })}>
                <option value="all">All stages</option>
                {INTAKE_POOL_STAGE_OPTIONS.map((status) => (
                  <option key={status} value={status}>{getApplicationStatusLabel(status)}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Search">
              <input
                type="search"
                value={filters.query}
                placeholder="Student, program, scholarship"
                onChange={(event) => updateFilter({ query: event.target.value })}
              />
            </FormField>
            <FormField label="Scholarship">
              <select value={filters.scholarshipId} onChange={(event) => updateFilter({ scholarshipId: event.target.value })}>
                <option value="all">All scholarships</option>
                {facets.scholarships.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Department">
              <select value={filters.department} onChange={(event) => updateFilter({ department: event.target.value })}>
                <option value="all">All departments</option>
                {facets.departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Sort">
              <select value={filters.sort} onChange={(event) => updateFilter({ sort: event.target.value })}>
                {INTAKE_POOL_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3">
            <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-app-text">
              <input
                type="checkbox"
                checked={filters.waitingOverDays > 0}
                onChange={(event) => updateFilter({ waitingOverDays: event.target.checked ? WAITING_THRESHOLD_DAYS : 0 })}
              />
              Waiting over {WAITING_THRESHOLD_DAYS} days
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-app-muted">
                {coverageLabel} · {filtered.length} of {unclaimed.length + taken.length} open
              </span>
              <Button type="button" variant="ghost" onClick={resetFilters}>Reset filters</Button>
            </div>
          </div>
        </Card>
      </section>


      <section>
        <Card
          title="Applications"
          action={<StatusBadge tone={filtered.length ? 'warning' : 'success'}>{filtered.length} in view</StatusBadge>}
        >
          {filtered.length ? (
            <div className="grid gap-3">
              {visible.map(renderRow)}
              {filtered.length > visible.length ? (
                <div className="flex justify-center">
                  <Button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                    Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title={filters.coverage === 'unclaimed' ? 'No unclaimed applications' : 'No applications match these filters'}
              description={filters.coverage === 'unclaimed'
                ? 'New submissions appear here, oldest first. Switch the coverage filter to see cases that already have officers.'
                : "Clear a filter or switch the coverage filter to see more of the office's open work."}
              action={<Button type="button" variant="ghost" onClick={resetFilters}>Reset filters</Button>}
            />
          )}
        </Card>
      </section>

      {isHead ? (
        <section>
          <Card
            title="Officer workload"
            action={<StatusBadge tone="info">{workload.length} officer{workload.length === 1 ? '' : 's'} on cases</StatusBadge>}
          >
            {workload.length ? (
              <ul className="m-0 grid gap-2 p-0">
                {workload.map((officer) => (
                  <li key={officer.officerId || officer.officerName} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[14px] border border-app-border bg-app-surface p-3">
                    <span className="min-w-0 text-sm font-semibold text-app-text">{officer.officerName}</span>
                    <span className="text-xs text-app-muted">
                      {officer.officerRole === 'admissions_head' ? 'Admissions Office Head' : 'Admissions Office Staff'} · {officer.cases} open case{officer.cases === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-sm text-app-muted">No case has been opened yet. Officers join a case by opening it.</p>
            )}
            <p className="mt-3 mb-0 text-xs text-app-muted">
              Officers join a case themselves, so this list reflects who is actually working each application. It is read-only: there is no assignment step.
            </p>
          </Card>
        </section>
      ) : null}

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          students={students}
          role={role}
          reviewerName={reviewerName}
          initialTab={reviewTab}
          onClose={closeReview}
          onStatusChange={onChangeApplication}
          onEndorse={onEndorseApplication}
          interviewWorkspace={interviewWorkspace}
          onRecordDeliberation={onRecordDeliberation}
          onRelease={onReleaseResults}
          onChangeDocument={onChangeDocument}
          reviewComments={reviewComments}
          onAddComment={onAddComment}
          caseOfficers={caseOfficers}
          currentUserId={currentUserId}
          onJoinCase={onJoinCase}
          onLeaveCase={onLeaveCase}
        />
      )}
    </div>
  );
}


