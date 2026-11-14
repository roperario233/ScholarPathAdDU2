import { CheckCircle2, ChevronDown, ClipboardList, FileCheck2, FileSearch, Gavel, Inbox, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import AdminPageHeader, { AdminHeaderTile } from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import MovedCaseNotice, { useMovedCase } from '../../components/MovedCaseNotice';
import { SopStageTrack } from '../../components/ApplicationParts';
import { StatCard, getCaseCardClass } from '../../components/pageParts';
import AcademicYearSelect from '../../components/AcademicYearSelect';
import FilterChips from '../../components/FilterChips';
import { Button, Card, EmptyState, FormField, StatusBadge } from '../../components/ui';
import { areDocumentsReviewable, describeApplicantAcademic, getDocumentVerificationReadiness } from '../../lib/applicationRequirements';
import {
  getApprovalQueue,
  getCaseOfficers,
  getDocumentsAwaitingReview,
  getIntakePool,
  getMyReviewQueue,
  getSubmissionWaitDays,
} from '../../lib/admissionsOffice';
import {
  DEFAULT_REVIEW_QUEUE_FILTERS,
  REVIEW_QUEUE_SORTS,
  countActiveReviewQueueFilters,
  filterReviewQueue,
  getReviewQueueFacets,
  hasReviewQueueRefinement,
} from '../../lib/reviewQueue';
import { formatInterviewDateShort, getInterviewModeLabel, isInterviewLive } from '../../lib/interview';
import { REVIEW_ROLE_LABELS, buildProgramScopeIndex, getApproverRoleForApplication } from '../../lib/reviewScope';
import { getLatestPanelRecommendation } from '../../lib/interview';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { ACADEMIC_YEAR_ALL, filterByAcademicYear, getAcademicYearChoices, getDefaultAcademicYear, resolveAcademicYear } from '../../lib/academicYearFilter';
import { getApplicationStatusLabel, getStatusTone, isAdmissionsAdminRole } from '../../lib/constants';
import { fmtDate, plural } from '../../lib/formatters';

const REVIEW_QUEUE_PAGE_SIZE = 50;
const EMPTY_LIST = [];
// The office queue reads oldest first, because first come, first served.
const DEFAULT_FILTERS = { ...DEFAULT_REVIEW_QUEUE_FILTERS, sort: 'oldest' };

// SOP steps 2-6 for the Admissions Office, as each officer sees it: the cases the
// signed-in account has opened. The office-wide list lives in the intake pool's
// coverage filter, so this route never repeats another officer's work and there is
// no assignment step to wait for. Opening a case is what joins the officer to it,
// and every stage action still happens inside the shared ApplicationReviewModal.
export default function AdminReviewQueue({
  applications = [],
  caseOfficers = [],
  caseOfficersReady = true,
  students = {},
  documents = [],
  scholarships = [],
  role = 'admissions_office',
  currentUserId = '',
  reviewerName = '',
  onChangeApplication,
  onRejectApplication,
  onWaitlistApplication,
  onEndorseApplication,
  interviewWorkspace = null,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  reviewComments = [],
  onAddComment,
  onOpenWorkspace,
  onJoinCase,
  onLeaveCase,
}) {
  const isAdmin = isAdmissionsAdminRole(role);
  const [selectedId, setSelectedId] = useState(null);
  const [reviewTab, setReviewTab] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [visibleQueueCount, setVisibleQueueCount] = useState(REVIEW_QUEUE_PAGE_SIZE);
  const today = useMemo(() => new Date(), []);
  const selected = applications.find((entry) => entry.id === selectedId);
  const myQueue = useMemo(
    () => getMyReviewQueue(applications, caseOfficers, currentUserId),
    [applications, caseOfficers, currentUserId],
  );
  const programIndex = useMemo(() => buildProgramScopeIndex(interviewWorkspace?.academicPrograms || []), [interviewWorkspace?.academicPrograms]);
  const approvalLevels = interviewWorkspace?.approvalLevels || EMPTY_LIST;
  // One list over the whole office, ordered by stage chips: the cases this officer
  // opened, every interview (applicants waiting for a schedule and interviews under
  // way), and the recommendations waiting on the school. A row says when it is not
  // the officer's own or is waiting on the school.
  // The queue opens on today's academic year; the dropdown widens it to any year.
  const [academicYear, setAcademicYear] = useState(() => getDefaultAcademicYear());
  const wholeQueue = useMemo(() => {
    const seen = new Set();
    return [
      ...myQueue,
      ...applications.filter((entry) => ['Endorsed', 'Interview'].includes(entry.status)),
      ...getApprovalQueue(applications),
    ].filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  }, [myQueue, applications]);
  const yearChoices = useMemo(() => getAcademicYearChoices(wholeQueue), [wholeQueue]);
  const yearChoice = resolveAcademicYear(academicYear, yearChoices);
  const queueCases = useMemo(() => filterByAcademicYear(wholeQueue, yearChoice), [wholeQueue, yearChoice]);
  const myCaseIds = useMemo(() => new Set(myQueue.map((entry) => entry.id)), [myQueue]);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const settledQuery = useDebouncedValue(filters.query, 250);
  const settledFilters = useMemo(() => ({ ...filters, query: settledQuery }), [filters, settledQuery]);
  const facets = useMemo(() => getReviewQueueFacets(queueCases, programIndex), [queueCases, programIndex]);
  // Stage chips count what is left once the search and the other filters apply,
  // so a chip never promises cases the list would then hide.
  const beforeStage = useMemo(
    () => filterReviewQueue(queueCases, { ...settledFilters, stage: 'all' }, programIndex),
    [queueCases, settledFilters, programIndex],
  );
  const stageChips = useMemo(() => {
    const counts = new Map();
    beforeStage.forEach((entry) => counts.set(entry.status, (counts.get(entry.status) || 0) + 1));
    const present = facets.stages;
    return [
      { value: 'all', label: 'All stages', count: beforeStage.length },
      ...present.map((option) => ({ value: option.value, label: option.label, count: counts.get(option.value) || 0 })),
    ];
  }, [beforeStage, facets.stages]);
  const stage = stageChips.some((chip) => chip.value === filters.stage) ? filters.stage : 'all';
  const filteredQueue = useMemo(
    () => (stage === 'all' ? beforeStage : beforeStage.filter((entry) => entry.status === stage)),
    [beforeStage, stage],
  );
  const isRefined = hasReviewQueueRefinement({ ...settledFilters, stage }, DEFAULT_FILTERS);
  const activeFilterCount = countActiveReviewQueueFilters(filters);
  const updateFilter = (patch) => {
    setFilters((current) => ({ ...current, ...patch }));
    setVisibleQueueCount(REVIEW_QUEUE_PAGE_SIZE);
  };
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setVisibleQueueCount(REVIEW_QUEUE_PAGE_SIZE);
  };
  const visibleQueue = filteredQueue.slice(0, visibleQueueCount);
  const intakePool = useMemo(() => getIntakePool(applications, caseOfficers), [applications, caseOfficers]);
  // Document Vault review begins at the verification stage, so the count is scoped
  // to this officer's own queue and always matches the list below it.
  const blockingDocuments = useMemo(
    () => getDocumentsAwaitingReview(myQueue, documents),
    [myQueue, documents],
  );
  const awaitingVerification = useMemo(
    () => myQueue.filter((entry) => entry.status === 'For Verification'),
    [myQueue],
  );
  const unclaimedSubmissions = intakePool.filter((entry) => entry.status === 'Submitted').length;
  // After a stage move the case's row glows, or a notice says where it went.
  const moved = useMovedCase(queueCases.map((entry) => entry.id));

  const openReview = (applicationId, tab = null) => {
    setReviewTab(tab);
    setSelectedId(applicationId);
  };
  const closeReview = (result) => {
    setSelectedId(null);
    setReviewTab(null);
    moved.handleClose(result);
  };

  // Every stage transition stays in the shared handler, so the queue only reports
  // the failure instead of duplicating the stage rules.
  const handleStatusChange = async (applicationId, status, options) => {
    const result = await onChangeApplication?.(applicationId, status, options);
    if (result?.error) setFeedback({ message: result.error });
    return result;
  };

  return (
    <div className="grid content-start gap-5">
      <AdminPageHeader
        title="Review queue"
        description={isAdmin
          ? 'The cases you opened, every interview, and the recommendations waiting on the school.'
          : 'The cases you opened. Pick up more from the intake pool.'}
      >
        {myQueue.length ? (
          <AdminHeaderTile
            icon={ClipboardList}
            tone="warning"
            label="Your queue"
            title={`${plural(myQueue.length, 'case')} in progress`}
            note={blockingDocuments.length
              ? `${plural(blockingDocuments.length, 'document')} to verify.`
              : 'No document waits on you right now.'}
          />
        ) : (
          <AdminHeaderTile
            icon={CheckCircle2}
            tone="success"
            label="Your queue"
            title="Your queue is clear"
            note={intakePool.length ? `${plural(intakePool.length, 'case')} waiting in the intake pool.` : 'Nothing is waiting in the intake pool.'}
            onClick={intakePool.length && onOpenWorkspace ? () => onOpenWorkspace('admin-intake') : undefined}
          />
        )}
      </AdminPageHeader>

      <MovedCaseNotice notice={moved.notice} onDismiss={moved.dismiss} offListNote="It has left your review queue." />

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
            aria-label="Dismiss stage change message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {!caseOfficersReady && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-800 dark:text-amber-100" role="status">
          The case-officer roster is unavailable, so this queue cannot list your cases yet. Apply
          {' '}<code>supabase/migrations/20261027043147_add_application_case_officers.sql</code>{' '}
          and reload.
        </div>
      )}


      <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard icon={ClipboardList} tone="info" label="In my review queue" value={myQueue.length} note="Cases you opened" />
        <StatCard icon={Inbox} tone="warning" label="Unclaimed submissions" value={unclaimedSubmissions} note="Waiting in the intake pool" />
        <StatCard icon={FileSearch} tone="warning" label="Documents awaiting verification" value={blockingDocuments.length} note="Files in your queue" />
        <StatCard icon={FileCheck2} tone="success" label="For verification" value={awaitingVerification.length} note="Awaiting document decisions" />
      </section>

      <section className="grid gap-4">
        <Card
          title="Review queue"
          action={(
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={queueCases.length ? 'warning' : 'success'}>
                {filteredQueue.length === queueCases.length
                  ? plural(queueCases.length, 'case')
                  : `${filteredQueue.length} of ${queueCases.length} shown`}
              </StatusBadge>
              {onOpenWorkspace ? (
                <Button type="button" variant="ghost" onClick={() => onOpenWorkspace('admin-intake')}>
                  Open intake pool
                </Button>
              ) : null}
            </div>
          )}
        >
          <FilterChips
            name="review-queue-stage"
            legend="Filter by stage"
            className="mb-3"
            value={stage}
            onChange={(value) => updateFilter({ stage: value })}
            options={stageChips}
          />
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
              <input
                type="search"
                value={filters.query}
                placeholder="Search student, program, scholarship"
                aria-label="Search the review queue"
                className="min-h-10 py-2 pl-9 text-sm"
                onChange={(event) => updateFilter({ query: event.target.value })}
              />
            </div>
            <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-app-text">
              <span className="shrink-0 text-xs text-app-muted">Sort by</span>
              <select
                aria-label="Sort cases"
                className="min-h-10 py-2 text-sm"
                value={filters.sort}
                onChange={(event) => updateFilter({ sort: event.target.value })}
              >
                {REVIEW_QUEUE_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <AcademicYearSelect
              value={yearChoice}
              onChange={(year) => { setAcademicYear(year); setVisibleQueueCount(REVIEW_QUEUE_PAGE_SIZE); }}
              years={yearChoices}
            />
            <Button
              type="button"
              aria-expanded={showMoreFilters}
              aria-controls="review-queue-more-filters"
              onClick={() => setShowMoreFilters((open) => !open)}
            >
              <span className="inline-flex items-center gap-1.5">
                More filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
                <ChevronDown size={16} aria-hidden="true" className={showMoreFilters ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </span>
            </Button>
            {isRefined ? <Button type="button" variant="ghost" onClick={resetFilters}>Reset</Button> : null}
          </div>
          {showMoreFilters ? (
            <div id="review-queue-more-filters" className="mb-3 grid gap-2 border-t border-app-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Scholarship" className="gap-1 [&_span]:text-xs">
                <select className="min-h-10 py-2 text-sm" value={filters.scholarshipId} onChange={(event) => updateFilter({ scholarshipId: event.target.value })}>
                  <option value="all">All scholarships</option>
                  {facets.scholarships.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
              {facets.departments.length > 1 ? (
                <FormField label="Department" className="gap-1 [&_span]:text-xs">
                  <select className="min-h-10 py-2 text-sm" value={filters.department} onChange={(event) => updateFilter({ department: event.target.value })}>
                    <option value="all">All departments</option>
                    {facets.departments.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </FormField>
              ) : null}
              {facets.programs.length > 1 ? (
                <FormField label="Program" className="gap-1 [&_span]:text-xs">
                  <select className="min-h-10 py-2 text-sm" value={filters.program} onChange={(event) => updateFilter({ program: event.target.value })}>
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
              ? `Showing ${filteredQueue.length} of ${plural(queueCases.length, 'case')} in this list.`
              : `${plural(filteredQueue.length, 'case')}.`}
          </p>
          <div className="grid max-h-[720px] gap-3 overflow-y-auto pb-14 pr-1 sm:pb-1">
            {queueCases.length && !filteredQueue.length ? (
              <EmptyState
                title="No cases match these filters"
                description="Clear the search or a filter to see the rest of this list."
                action={<div className="mt-3 flex justify-center"><Button type="button" onClick={resetFilters}>Reset search and filters</Button></div>}
              />
            ) : filteredQueue.length ? visibleQueue.map((entry) => {
              const { outstanding } = getDocumentVerificationReadiness(entry, documents);
              // Document Vault review begins at the verification stage, so a case
              // before it reports what is attached instead of promising work the
              // current stage does not allow yet.
              const documentsUnlocked = areDocumentsReviewable(entry.status);
              const attachedCount = Array.isArray(entry.attachedDocuments) ? entry.attachedDocuments.length : 0;
              const days = getSubmissionWaitDays(entry, today);
              const officers = getCaseOfficers(caseOfficers, entry.id);
              const officerChips = officers.map((officer) => (
                officer.officerId && officer.officerId === currentUserId ? 'You' : officer.officerName
              ));
              const isMine = myCaseIds.has(entry.id);
              const awaitingApproval = entry.status === 'Recommended';
              const isInterview = ['Endorsed', 'Interview'].includes(entry.status);
              const approver = awaitingApproval
                ? getApproverRoleForApplication(entry, approvalLevels, programIndex)
                : null;
              const recommendation = awaitingApproval
                ? getLatestPanelRecommendation((interviewWorkspace?.notes || EMPTY_LIST).filter((note) => note.applicationId === entry.id))
                : null;
              const interview = entry.interview;
              const interviewLine = entry.status === 'Interview' && isInterviewLive(interview)
                ? `${getInterviewModeLabel(interview.mode)} interview · ${formatInterviewDateShort(interview.startsAt)}${interview.locationLabel ? ` · ${interview.locationLabel}` : ''}`
                : entry.status === 'Endorsed' ? 'Documents verified. Waiting for the interview to be scheduled.' : '';
              return (
                <article
                  key={entry.id}
                  data-application-id={entry.id}
                  className={getCaseCardClass(awaitingApproval ? 'warning' : getStatusTone(entry.status))}
                >
                  <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
                    <div className="min-w-0 w-full flex-1">
                      <h3>{entry.studentName}</h3>
                      <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
                      <p className="mt-1 text-xs text-app-muted">
                        {describeApplicantAcademic(entry)} · Income ₱{Number(entry.studentHouseholdIncome || 0).toLocaleString()} · Submitted {fmtDate(entry.submittedAt || entry.updatedAt)}{days == null ? '' : ` · waiting ${days} day${days === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                      {awaitingApproval ? (
                        <StatusBadge tone="warning" className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-1"><Gavel size={12} aria-hidden="true" />Awaiting school approval</span>
                        </StatusBadge>
                      ) : null}
                      <StatusBadge tone={getStatusTone(entry.status)}>{getApplicationStatusLabel(entry.status)}</StatusBadge>
                    </div>
                  </div>
                  <SopStageTrack status={entry.status} />
                  <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                    {entry.status === 'For Verification' ? (
                      <Button type="button" onClick={() => openReview(entry.id, 'documents')}>Review documents</Button>
                    ) : entry.status === 'For Endorsement' ? (
                      <Button type="button" onClick={() => openReview(entry.id, 'endorsement')}>
                        {isAdmin ? 'Forward to interview' : 'Open case notes'}
                      </Button>
                    ) : isInterview ? (
                      <Button type="button" onClick={() => openReview(entry.id, 'interview')}>
                        {entry.status === 'Endorsed' ? 'Schedule interview' : 'Open interview'}
                      </Button>
                    ) : (
                      <Button type="button" onClick={() => openReview(entry.id)}>Open case</Button>
                    )}
                    {documentsUnlocked && outstanding && !awaitingApproval ? (
                      <StatusBadge tone="warning">{outstanding} document{outstanding === 1 ? '' : 's'} to verify</StatusBadge>
                    ) : null}
                    {!documentsUnlocked && attachedCount ? (
                      <StatusBadge tone="neutral">{attachedCount} attached document{attachedCount === 1 ? '' : 's'}</StatusBadge>
                    ) : null}
                    {awaitingApproval ? (
                      <StatusBadge tone="info">With the {REVIEW_ROLE_LABELS[approver] || 'Chairperson'}</StatusBadge>
                    ) : null}
                    {officerChips.length > 1 ? (
                      <StatusBadge tone="info">{officerChips.join(' · ')}</StatusBadge>
                    ) : null}
                    {!isMine ? <StatusBadge tone="neutral">Not opened by you</StatusBadge> : null}
                    {awaitingApproval ? (
                      <span className="min-w-0 flex-1 text-left text-xs text-app-muted">
                        {recommendation?.label || 'Recommended'} · the school approves, waitlists, or does not accept; you can override from the case.
                      </span>
                    ) : interviewLine ? (
                      <span className="min-w-0 flex-1 text-left text-xs text-app-muted">{interviewLine}</span>
                    ) : null}
                  </div>
                </article>
              );
            }) : (
              <EmptyState
                title="No cases in the review queue yet"
                description={`Open a case from the intake pool and it is added here. Interviews and recommendations waiting on the school appear here too.${yearChoice === ACADEMIC_YEAR_ALL ? '' : ' Choose All academic years to see older cases.'}`}
                action={onOpenWorkspace
                  ? <Button type="button" onClick={() => onOpenWorkspace('admin-intake')}>Open intake pool</Button>
                  : undefined}
              />
            )}
          </div>
          {visibleQueue.length < filteredQueue.length ? (
            <Button type="button" variant="secondary" className="mt-3 w-full" onClick={() => setVisibleQueueCount((count) => count + REVIEW_QUEUE_PAGE_SIZE)}>
              Show {Math.min(REVIEW_QUEUE_PAGE_SIZE, filteredQueue.length - visibleQueue.length)} more cases
            </Button>
          ) : null}
        </Card>
      </section>

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
          onStatusChange={handleStatusChange}
          onRejectApplication={onRejectApplication}
          onWaitlistApplication={onWaitlistApplication}
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
