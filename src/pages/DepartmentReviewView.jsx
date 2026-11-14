import { useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, ChevronDown, ClipboardCheck, Layers, Search, SendHorizontal, UserCheck } from 'lucide-react';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import {
  DEFAULT_REVIEW_QUEUE_FILTERS,
  REVIEW_QUEUE_SORTS,
  countActiveReviewQueueFilters,
  filterReviewQueue,
  getReviewQueueFacets,
  hasReviewQueueRefinement,
} from '../lib/reviewQueue';
import AdminPageHeader, { AdminHeaderTile } from '../components/AdminPageHeader';
import { StatCard, getCaseCardClass } from '../components/pageParts';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import MovedCaseNotice, { useMovedCase } from '../components/MovedCaseNotice';
import FilterChips from '../components/FilterChips';
import { Button, Card, EmptyState, ExportButton, FormField, StatusBadge } from '../components/ui';
import { getApplicationStatusLabel } from '../lib/constants';
import { REVIEW_ROLE_LABELS, buildProgramScopeIndex, getApplicationScope, getReviewScopeLabel, isInterviewerRole } from '../lib/reviewScope';
import { areEndorsementRecordsVisible, describeApplicantAcademic, getActorRoleLabel, getDocumentVerificationReadiness } from '../lib/applicationRequirements';
import { downloadApplicantSummary, getApplicantSummaryFileName } from '../lib/admissionsOffice';
import { getLatestPanelRecommendation } from '../lib/interview';
import { getGrantAmountForApplication } from '../lib/grantAmount';
import { fmtCurrency, fmtDate, plural } from '../lib/formatters';

const queueTone = (status) => {
  if (['Approved', 'Released'].includes(status)) return 'success';
  if (status === 'Rejected') return 'danger';
  if (status === 'Declined') return 'neutral';
  if (['For Verification', 'Endorsed', 'Recommended', 'Waitlisted'].includes(status)) return 'warning';
  return 'info';
};

const REVIEW_LIST_PAGE_SIZE = 50;
const EMPTY_STAGE_CONTEXT = () => ({});
const EMPTY_COPY = {
  action: { title: 'Nothing needs your action', description: 'Interviews to schedule, interviews on your panel, and recommendations routed to your level appear here.' },
  interviews: { title: 'No interviews waiting', description: 'Applicants appear here once the Admissions Office has verified their documents.' },
  approval: { title: 'No recommendations awaiting your approval', description: 'Recommendations your school routes to your level appear here.' },
  all: { title: 'No applicants in scope', description: 'Applications appear here as students in your scope submit them.' },
};

// The workspace of every account scoped to the academic hierarchy (Consultation
// 2): an interviewer, and the Chairperson, Assistant Dean, or Dean of a school.
// Applications reach it automatically by the applicant's program. Any of them
// may schedule and run the interview of an applicant in scope; only the level
// configured for the applicant's school approves the recommendation. Document
// verification and release stay with the Admissions Office Admin.
export default function DepartmentReviewView({
  profile,
  queue,
  documents,
  scholarships = [],
  reviewComments = [],
  onChangeApplication,
  onRejectApplication,
  onWaitlistApplication,
  onApproveApplication,
  onRecordDeliberation,
  onAddComment,
  interviewWorkspace = null,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [reviewTab, setReviewTab] = useState(null);
  const [visibleCount, setVisibleCount] = useState(REVIEW_LIST_PAGE_SIZE);
  // null = not chosen yet: open on the work waiting for this reviewer, or on the
  // whole scope when nothing is waiting. Opening a case pins the pick so the chip
  // never switches under the reader.
  const [chosenFilter, setChosenFilter] = useState(null);
  const [refine, setRefine] = useState(DEFAULT_REVIEW_QUEUE_FILTERS);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const role = profile.role || 'department_chair';
  const isInterviewer = isInterviewerRole(role);
  const selected = queue.find((entry) => entry.id === selectedId);
  const stageContextFor = interviewWorkspace?.stageContextFor || EMPTY_STAGE_CONTEXT;
  // SOP 5a: the interview panel comes from the applicant's school, so any scoped
  // reviewer may sit on it, and one who schedules the interview leads it.
  const panelApplicationIds = useMemo(() => new Set((interviewWorkspace?.panelists || [])
    .filter((row) => !row.removedAt && row.profileId && row.profileId === interviewWorkspace?.viewerId)
    .map((row) => row.applicationId)), [interviewWorkspace?.panelists, interviewWorkspace?.viewerId]);
  const awaitingInterview = useMemo(() => queue.filter((entry) => entry.status === 'Endorsed'), [queue]);
  const inInterview = useMemo(() => queue.filter((entry) => entry.status === 'Interview'), [queue]);
  const panelInterviews = useMemo(() => inInterview.filter((entry) => panelApplicationIds.has(entry.id)), [inInterview, panelApplicationIds]);
  const awaitingApproval = useMemo(() => isInterviewer ? [] : queue.filter((entry) => (
    entry.status === 'Recommended' && stageContextFor(entry).isApprover
  )), [isInterviewer, queue, stageContextFor]);
  const decidedInScope = useMemo(() => queue.filter((entry) => ['Recommended', 'Approved', 'Waitlisted', 'Released', 'Declined'].includes(entry.status)), [queue]);
  const notesByApplication = useMemo(() => {
    const notes = new Map();
    (interviewWorkspace?.notes || []).forEach((note) => {
      if (!notes.has(note.applicationId)) notes.set(note.applicationId, []);
      notes.get(note.applicationId).push(note);
    });
    return notes;
  }, [interviewWorkspace?.notes]);
  const notesFor = (applicationId) => notesByApplication.get(applicationId) || [];
  const programIndex = useMemo(() => buildProgramScopeIndex(interviewWorkspace?.academicPrograms || []), [interviewWorkspace?.academicPrograms]);
  const awaitingApprovalIds = useMemo(() => new Set(awaitingApproval.map((entry) => entry.id)), [awaitingApproval]);
  const needsAction = useMemo(() => queue.filter((entry) => (
    awaitingApprovalIds.has(entry.id)
    || entry.status === 'Endorsed'
    || (entry.status === 'Interview' && panelApplicationIds.has(entry.id))
  )), [queue, awaitingApprovalIds, panelApplicationIds]);
  const interviewEntries = useMemo(() => queue.filter((entry) => ['Endorsed', 'Interview'].includes(entry.status)), [queue]);
  const filters = [
    { key: 'action', label: 'Needs action', entries: needsAction, alert: true },
    { key: 'interviews', label: 'Interviews', entries: interviewEntries, alert: awaitingInterview.length > 0 },
    ...(isInterviewer ? [] : [{ key: 'approval', label: 'Awaiting approval', entries: awaitingApproval, alert: true }]),
    { key: 'all', label: 'All applications', entries: queue, alert: false },
  ];
  const filter = filters.some((entry) => entry.key === chosenFilter)
    ? chosenFilter
    : needsAction.length ? 'action' : 'all';
  const laneEntries = filters.find((entry) => entry.key === filter).entries;
  // Search, facets, and sorting narrow whatever the chosen lane holds. The facets
  // read the whole scope so a pick stays valid when the lane changes.
  const settledQuery = useDebouncedValue(refine.query, 250);
  const settledRefine = useMemo(() => ({ ...refine, query: settledQuery }), [refine, settledQuery]);
  const facets = useMemo(() => getReviewQueueFacets(queue, programIndex), [queue, programIndex]);
  const activeEntries = useMemo(
    () => filterReviewQueue(laneEntries, settledRefine, programIndex),
    [laneEntries, settledRefine, programIndex],
  );
  const visibleEntries = activeEntries.slice(0, visibleCount);
  const activeFilterCount = countActiveReviewQueueFilters(refine);
  const isRefined = hasReviewQueueRefinement(settledRefine);
  // After a stage move the case's row glows, or a notice says where it went.
  const moved = useMovedCase(activeEntries.map((entry) => entry.id));

  const changeFilter = (key) => {
    setChosenFilter(key);
    setVisibleCount(REVIEW_LIST_PAGE_SIZE);
  };
  const updateRefine = (patch) => {
    setRefine((previous) => ({ ...previous, ...patch }));
    setVisibleCount(REVIEW_LIST_PAGE_SIZE);
  };
  const resetRefine = () => {
    setRefine(DEFAULT_REVIEW_QUEUE_FILTERS);
    setVisibleCount(REVIEW_LIST_PAGE_SIZE);
  };

  const openCase = (entry, tab = null) => {
    setChosenFilter(filter);
    setReviewTab(tab);
    setSelectedId(entry.id);
  };

  // The review modal's Approve button routes through the approval action so
  // the decision carries its note; every other move uses the shared transition.
  const handleStatusChange = (applicationId, status, options) => (
    status === 'Approved' && onApproveApplication
      ? onApproveApplication(applicationId, options?.note)
      : onChangeApplication?.(applicationId, status, options)
  );

  const exportSummary = () => downloadApplicantSummary(decidedInScope, {
    scopeOf: (entry) => getApplicationScope(entry, programIndex),
    recommendationOf: (entry) => getLatestPanelRecommendation(notesFor(entry.id)),
    grantOf: (entry) => getGrantAmountForApplication(interviewWorkspace?.grantAmounts, entry.id),
    source: {
      origin: `${REVIEW_ROLE_LABELS[role] || 'Reviewer'} workspace › Recommendations`,
      contents: 'Every recommended, approved, waitlisted, released, and declined application in this scope, including cases you have already decided. Recommended cases are still awaiting the school’s approval.',
      exportedBy: `${profile.fullName ? `${profile.fullName}, ` : ''}${getActorRoleLabel(role)}${getReviewScopeLabel(profile) ? ` (${getReviewScopeLabel(profile)})` : ''}`,
    },
  }, getApplicantSummaryFileName(getReviewScopeLabel(profile) || 'scope', 'recommendations'));

  const renderRow = (entry) => {
    const onPanel = panelApplicationIds.has(entry.id);
    const recommendation = getLatestPanelRecommendation(notesFor(entry.id));
    const { verified, total, outstanding, ready } = getDocumentVerificationReadiness(entry, documents);
    const decidable = awaitingApprovalIds.has(entry.id);
    let action = { label: 'Open review', tab: null };
    let hint = `${verified}/${total || 0} linked documents verified${!ready ? ` · ${outstanding} with the Admissions Office Admin` : ''}`;
    let hintTone = ready ? 'text-app-muted' : 'text-amber-700 dark:text-amber-300';
    if (entry.status === 'Endorsed') {
      action = { label: 'Schedule interview', tab: 'interview' };
      hint = `Documents verified${entry.updatedAt ? ` ${fmtDate(entry.updatedAt)}` : ''}. Schedule the interview.`;
      hintTone = 'text-app-muted';
    } else if (entry.status === 'Interview') {
      action = { label: onPanel ? 'Open interview' : 'View interview', tab: 'interview' };
      hint = recommendation
        ? `Recommendation recorded: ${recommendation.label}`
        : onPanel ? 'You are on this panel. Record the recommendation after the interview.' : 'Another reviewer is on this panel.';
      hintTone = 'text-app-muted';
    } else if (decidable) {
      action = { label: 'Review and decide', tab: null };
      hint = [recommendation?.authorName ? `Interviewed by ${recommendation.authorName}` : '', entry.deliberation?.decidedAt ? `sent ${fmtDate(entry.deliberation.decidedAt)}` : ''].filter(Boolean).join(' · ') || 'Read the case before deciding.';
      hintTone = 'text-app-muted';
    }
    return (
      <article key={entry.id} data-application-id={entry.id} className={getCaseCardClass(queueTone(entry.status))}>
        <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
          <div className="min-w-0 w-full">
            <h3 className="truncate">{entry.studentName}</h3>
            <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
            <p className="mt-1 text-xs text-app-muted">{describeApplicantAcademic(entry)} · {fmtCurrency(Number(entry.studentHouseholdIncome || 0))} · Updated {fmtDate(entry.updatedAt)}</p>
          </div>
          <StatusBadge tone={queueTone(entry.status)}>
            {decidable && recommendation?.label ? recommendation.label : getApplicationStatusLabel(entry.status)}
          </StatusBadge>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-app-border pt-3">
          <div className="flex flex-wrap gap-2 !flex-none">
            <Button type="button" onClick={() => openCase(entry, action.tab)}>{action.label}</Button>
            {areEndorsementRecordsVisible(entry.status) ? (
              <Button type="button" variant="secondary" onClick={() => openCase(entry, 'endorsement')}>Case notes</Button>
            ) : null}
          </div>
          <span className={`min-w-0 flex-1 text-left text-xs ${hintTone}`}>{hint}</span>
        </div>
      </article>
    );
  };

  return (
    <div className="grid content-start gap-5">
      <AdminPageHeader
        label={`${REVIEW_ROLE_LABELS[role] || 'Reviewer'} workspace`}
        title={`${getReviewScopeLabel(profile) || 'Review scope unassigned'} applicants`}
        description={isInterviewer
              ? 'Applicants in your scope reach you once the Admissions Office has verified their documents. Schedule the interview, record your recommendation level, then send the recommendation to the school.'
              : 'Interview the applicants in your scope or follow the interviewer’s work, and decide the recommendations your school routes to you. Document verification and release stay with the Admissions Office Admin.'}
      >
        {awaitingApproval.length ? (
          <AdminHeaderTile
            icon={ClipboardCheck}
            tone="warning"
            label="Needs your approval"
            title={`${plural(awaitingApproval.length, 'recommendation')} to decide`}
            note={`${plural(queue.length, 'applicant')} in your scope.`}
          />
        ) : awaitingInterview.length ? (
          <AdminHeaderTile
            icon={CalendarClock}
            tone="warning"
            label="Needs an interview"
            title={`${plural(awaitingInterview.length, 'applicant')} waiting`}
            note={`${plural(queue.length, 'applicant')} in your scope.`}
          />
        ) : panelInterviews.length ? (
          <AdminHeaderTile
            icon={UserCheck}
            label="On your panel"
            title={plural(panelInterviews.length, 'interview in progress', 'interviews in progress')}
            note="Record the recommendation after each one."
          />
        ) : (
          <AdminHeaderTile
            icon={CheckCircle2}
            tone="success"
            label="Your scope"
            title="Nothing waiting on you"
            note={`${plural(queue.length, 'applicant')} in your scope.`}
          />
        )}
      </AdminPageHeader>

      <MovedCaseNotice notice={moved.notice} onDismiss={moved.dismiss} offListNote="It stays listed under All applications." />

      <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard icon={CalendarClock} tone="warning" label="Waiting for an interview" value={awaitingInterview.length} />
        <StatCard icon={UserCheck} tone="info" label="Interviews on your panel" value={panelInterviews.length} />
        {isInterviewer
          ? <StatCard icon={SendHorizontal} tone="success" label="Recommendations sent" value={decidedInScope.length} />
          : <StatCard icon={ClipboardCheck} tone="warning" label="Awaiting your approval" value={awaitingApproval.length} />}
        <StatCard icon={Layers} tone="neutral" label="Review scope" value={getReviewScopeLabel(profile) || 'Unassigned'} />
      </section>

      <Card title="Applications in your scope" className="min-w-0">
        <FilterChips
          name="review-filter"
          legend="Filter applications in your scope"
          className="mb-3"
          value={filter}
          onChange={changeFilter}
          options={filters.map((entry) => ({
            value: entry.key,
            label: entry.label,
            count: entry.entries.length,
            alert: entry.alert && entry.entries.length > 0,
          }))}
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
            <input
              type="search"
              value={refine.query}
              placeholder="Search applicant, scholarship, program"
              aria-label="Search applications in your scope"
              className="min-h-10 py-2 pl-9 text-sm"
              onChange={(event) => updateRefine({ query: event.target.value })}
            />
          </div>
          <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-app-text">
            <span className="shrink-0 text-xs text-app-muted">Sort by</span>
            <select
              aria-label="Sort applications"
              className="min-h-10 py-2 text-sm"
              value={refine.sort}
              onChange={(event) => updateRefine({ sort: event.target.value })}
            >
              {REVIEW_QUEUE_SORTS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            aria-expanded={showMoreFilters}
            aria-controls="review-more-filters"
            onClick={() => setShowMoreFilters((open) => !open)}
          >
            <span className="inline-flex items-center gap-1.5">
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
              <ChevronDown size={16} aria-hidden="true" className={showMoreFilters ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </span>
          </Button>
          {hasReviewQueueRefinement(refine) ? <Button type="button" variant="ghost" onClick={resetRefine}>Reset</Button> : null}
        </div>
        {showMoreFilters ? (
          <div id="review-more-filters" className="mb-3 grid gap-2 border-t border-app-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Stage" className="gap-1 [&_span]:text-xs">
              <select className="min-h-10 py-2 text-sm" value={refine.stage} onChange={(event) => updateRefine({ stage: event.target.value })}>
                <option value="all">All stages</option>
                {facets.stages.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Scholarship" className="gap-1 [&_span]:text-xs">
              <select className="min-h-10 py-2 text-sm" value={refine.scholarshipId} onChange={(event) => updateRefine({ scholarshipId: event.target.value })}>
                <option value="all">All scholarships</option>
                {facets.scholarships.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
            {facets.departments.length > 1 ? (
              <FormField label="Department" className="gap-1 [&_span]:text-xs">
                <select className="min-h-10 py-2 text-sm" value={refine.department} onChange={(event) => updateRefine({ department: event.target.value })}>
                  <option value="all">All departments</option>
                  {facets.departments.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
            ) : null}
            {facets.programs.length > 1 ? (
              <FormField label="Program" className="gap-1 [&_span]:text-xs">
                <select className="min-h-10 py-2 text-sm" value={refine.program} onChange={(event) => updateRefine({ program: event.target.value })}>
                  <option value="all">All programs</option>
                  {facets.programs.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
            ) : null}
          </div>
        ) : null}
        <p className="mb-3 text-xs text-app-muted" aria-live="polite">
          {isRefined
            ? `Showing ${activeEntries.length} of ${plural(laneEntries.length, 'application')} in this list.`
            : `${plural(activeEntries.length, 'application')}.`}
        </p>
        <div className="grid max-h-[720px] gap-3 overflow-y-auto pb-14 pr-1 sm:pb-1">
          {activeEntries.length ? visibleEntries.map(renderRow) : isRefined && laneEntries.length ? (
            <EmptyState
              title="No applications match"
              description="Clear the search or a filter to see the rest of this list."
              action={<div className="mt-3 flex justify-center"><Button type="button" onClick={resetRefine}>Reset search and filters</Button></div>}
            />
          ) : (
            <EmptyState
              title={EMPTY_COPY[filter].title}
              description={EMPTY_COPY[filter].description}
              action={filter !== 'all' && queue.length ? (
                <div className="mt-3 flex justify-center">
                  <Button type="button" onClick={() => changeFilter('all')}>Show all applications ({queue.length})</Button>
                </div>
              ) : null}
            />
          )}
        </div>
        {visibleEntries.length < activeEntries.length ? (
          <Button type="button" variant="secondary" className="mt-3 w-full" onClick={() => setVisibleCount((count) => count + REVIEW_LIST_PAGE_SIZE)}>
            Show {Math.min(REVIEW_LIST_PAGE_SIZE, activeEntries.length - visibleEntries.length)} more applications
          </Button>
        ) : null}
        {!isInterviewer ? (
          <ExportButton className="mt-3" disabled={!decidedInScope.length} onClick={exportSummary}>Export recommended and decided cases</ExportButton>
        ) : null}
      </Card>

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          role={role}
          initialTab={reviewTab}
          reviewComments={reviewComments}
          onAddComment={onAddComment}
          onClose={(result) => { setSelectedId(null); setReviewTab(null); moved.handleClose(result); }}
          onStatusChange={handleStatusChange}
          onRejectApplication={onRejectApplication}
          onWaitlistApplication={onWaitlistApplication}
          onRecordDeliberation={onRecordDeliberation}
          interviewWorkspace={interviewWorkspace}
        />
      )}
    </div>
  );
}
