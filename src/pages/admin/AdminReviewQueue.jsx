import { CheckCircle2, ClipboardList, FileCheck2, FileSearch, Inbox, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import AdminPageHeader, { AdminHeaderTile } from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { SopStageTrack } from '../../components/ApplicationParts';
import { StatCard, getCaseCardClass } from '../../components/pageParts';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { areDocumentsReviewable, describeApplicantAcademic, getDocumentVerificationReadiness } from '../../lib/applicationRequirements';
import {
  getCaseOfficers,
  getDocumentsAwaitingReview,
  getIntakePool,
  getMyReviewQueue,
  getSubmissionWaitDays,
} from '../../lib/admissionsOffice';
import { getApplicationStatusLabel, getStatusTone, isAdmissionsHeadRole } from '../../lib/constants';
import { fmtDate, plural } from '../../lib/formatters';

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
  const isHead = isAdmissionsHeadRole(role);
  const [selectedId, setSelectedId] = useState(null);
  const [reviewTab, setReviewTab] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const today = useMemo(() => new Date(), []);
  const selected = applications.find((entry) => entry.id === selectedId);
  const myQueue = useMemo(
    () => getMyReviewQueue(applications, caseOfficers, currentUserId),
    [applications, caseOfficers, currentUserId],
  );
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

  const openReview = (applicationId, tab = null) => {
    setReviewTab(tab);
    setSelectedId(applicationId);
  };
  const closeReview = () => {
    setSelectedId(null);
    setReviewTab(null);
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
        description={isHead
          ? 'The cases you opened, through every stage you decide.'
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


      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardList} tone="info" label="In my review queue" value={myQueue.length} note="Cases you opened" />
        <StatCard icon={Inbox} tone="warning" label="Unclaimed submissions" value={unclaimedSubmissions} note="Waiting in the intake pool" />
        <StatCard icon={FileSearch} tone="warning" label="Documents awaiting verification" value={blockingDocuments.length} note="Files in your queue" />
        <StatCard icon={FileCheck2} tone="success" label="For verification" value={awaitingVerification.length} note="Awaiting document decisions" />
      </section>

      <section className="grid gap-4">
        <Card
          title="Your cases"
          action={(
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={myQueue.length ? 'warning' : 'success'}>{myQueue.length} in your queue</StatusBadge>
              {onOpenWorkspace ? (
                <Button type="button" variant="ghost" onClick={() => onOpenWorkspace('admin-intake')}>
                  Open intake pool
                </Button>
              ) : null}
            </div>
          )}
        >
          <div className="grid max-h-[720px] gap-3 overflow-y-auto pb-14 pr-1 sm:pb-1">
            {myQueue.length ? myQueue.map((entry) => {
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
              return (
                <article key={entry.id} className={getCaseCardClass(getStatusTone(entry.status))}>
                  <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
                    <div className="min-w-0 w-full flex-1">
                      <h3>{entry.studentName}</h3>
                      <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
                      <p className="mt-1 text-xs text-app-muted">
                        {describeApplicantAcademic(entry)} · Income ₱{Number(entry.studentHouseholdIncome || 0).toLocaleString()} · Submitted {fmtDate(entry.submittedAt || entry.updatedAt)}{days == null ? '' : ` · waiting ${days} day${days === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <StatusBadge tone={getStatusTone(entry.status)}>{getApplicationStatusLabel(entry.status)}</StatusBadge>
                  </div>
                  <SopStageTrack status={entry.status} />
                  <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                    {entry.status === 'For Verification' ? (
                      <Button type="button" onClick={() => openReview(entry.id, 'documents')}>Review documents</Button>
                    ) : entry.status === 'For Endorsement' ? (
                      <Button type="button" onClick={() => openReview(entry.id, 'endorsement')}>
                        {isHead ? 'Forward to interview' : 'Open case notes'}
                      </Button>
                    ) : (
                      <Button type="button" onClick={() => openReview(entry.id)}>Open case</Button>
                    )}
                    {documentsUnlocked && outstanding ? (
                      <StatusBadge tone="warning">{outstanding} document{outstanding === 1 ? '' : 's'} to verify</StatusBadge>
                    ) : null}
                    {!documentsUnlocked && attachedCount ? (
                      <StatusBadge tone="neutral">{attachedCount} attached document{attachedCount === 1 ? '' : 's'}</StatusBadge>
                    ) : null}
                    {officerChips.length > 1 ? (
                      <StatusBadge tone="info">{officerChips.join(' · ')}</StatusBadge>
                    ) : null}
                  </div>
                </article>
              );
            }) : (
              <EmptyState
                title="No cases in your review queue yet"
                description="Open a case from the intake pool and it is added here. Any officer who opens a case joins it."
                action={onOpenWorkspace
                  ? <Button type="button" onClick={() => onOpenWorkspace('admin-intake')}>Open intake pool</Button>
                  : undefined}
              />
            )}
          </div>
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
