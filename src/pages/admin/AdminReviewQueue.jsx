import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import AdminPageHeader from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { SopStageTrack } from '../../components/ApplicationParts';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { areDocumentsReviewable, describeApplicantAcademic, getDocumentVerificationReadiness } from '../../lib/applicationRequirements';
import { getDocumentsAwaitingReview, getReviewQueue } from '../../lib/admissionsOffice';
import { getApplicationStatusLabel, getStatusTone } from '../../lib/constants';
import { fmtDate } from '../../lib/formatters';

// SOP steps 2-6 for the Admissions Office. Document Vault verification happens
// inside the shared ApplicationReviewModal, so this route is the queue plus the
// review surface and nothing else.
export default function AdminReviewQueue({
  applications = [],
  students = {},
  documents = [],
  scholarships = [],
  onChangeApplication,
  onEndorseApplication,
  onScheduleInterview,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  reviewComments = [],
  onAddComment,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [reviewTab, setReviewTab] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [startingReviewId, setStartingReviewId] = useState(null);
  const selected = applications.find((entry) => entry.id === selectedId);
  const reviewApplications = useMemo(() => getReviewQueue(applications), [applications]);
  const blockingDocuments = useMemo(
    () => getDocumentsAwaitingReview(applications, documents),
    [applications, documents],
  );
  const awaitingVerification = useMemo(
    () => reviewApplications.filter((entry) => entry.status === 'For Verification'),
    [reviewApplications],
  );

  // Open the shared review surface. Opening a Submitted application also starts
  // its review: the move to Under Review happens once in the background so the
  // reviewer never has to press a separate "Mark under review" button, and the
  // application's files stay locked until it reaches verification. The modal
  // opens immediately either way, and a failed write is reported in the banner
  // instead of blocking the read. `tab` is only passed for an application whose
  // documents are already reviewable.
  const openReview = (applicationId, tab = null) => {
    const entry = applications.find((item) => item.id === applicationId);
    setReviewTab(tab);
    setSelectedId(applicationId);
    if (entry?.status !== 'Submitted') return;
    setStartingReviewId(applicationId);
    Promise.resolve(onChangeApplication?.(applicationId, 'Under Review', {
      note: 'The Admissions Office opened this application for review. Attached documents are reviewed at the verification stage.',
    })).then((result) => {
      setStartingReviewId((current) => (current === applicationId ? null : current));
      if (result?.error) {
        setFeedback({ tone: 'error', message: `Review could not be started: ${result.error}` });
      }
    });
  };
  const closeReview = () => {
    setSelectedId(null);
    setReviewTab(null);
  };

  // "Continue to verification" is a real stage transition: confirm it only after
  // the write succeeds, and report how many attached files just entered the
  // document review queue.
  const handleStatusChange = async (applicationId, status, options) => {
    const result = await onChangeApplication?.(applicationId, status, options);
    if (!result?.error && status === 'For Verification') {
      const entry = applications.find((item) => item.id === applicationId);
      const { outstanding } = getDocumentVerificationReadiness(entry, documents);
      setFeedback({
        tone: 'success',
        message: outstanding
          ? `Application continued to verification. ${outstanding} attached document${outstanding === 1 ? ' is' : 's are'} now in the review queue.`
          : 'Application continued to verification. No attached documents are awaiting verification.',
      });
    }
    return result;
  };

  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title="Application review queue"
        description="Opening an application starts its review. Continue it to verification to review its attached documents, then schedule interviews after endorsement."
        badge={`${reviewApplications.length} awaiting action`}
        badgeTone={reviewApplications.length ? 'warning' : 'success'}
      />

      {feedback?.message && (
        <div
          className={`flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
            feedback.tone === 'error'
              ? 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200'
              : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
          }`}
          role="status"
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

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Applications in review" value={reviewApplications.length} note="Standard Procedure workflow queue" />
        <StatCard label="Documents awaiting verification" value={blockingDocuments.length} note="Files on applications at verification" />
        <StatCard label="For verification" value={awaitingVerification.length} note="Awaiting document decisions" />
      </section>

      <section className="grid gap-4">
        <Card title="Application review queue" action={<StatusBadge tone={reviewApplications.length ? 'warning' : 'success'}>{reviewApplications.length} awaiting action</StatusBadge>}>
          <div className="grid max-h-[720px] gap-3 overflow-y-auto pr-1">
            {reviewApplications.length ? reviewApplications.map((entry) => {
              const { outstanding } = getDocumentVerificationReadiness(entry, documents);
              // Document Vault review begins at the verification stage, so a
              // Submitted or Under Review entry reports what is attached instead
              // of promising work the current stage does not allow yet.
              const documentsUnlocked = areDocumentsReviewable(entry.status);
              const attachedCount = Array.isArray(entry.attachedDocuments) ? entry.attachedDocuments.length : 0;
              const startingThisReview = startingReviewId === entry.id;
              return (
                <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3>{entry.studentName}</h3>
                      <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
                      <p className="mt-1 text-xs text-app-muted">{describeApplicantAcademic(entry)} · Income ₱{Number(entry.studentHouseholdIncome || 0).toLocaleString()} · Updated {fmtDate(entry.updatedAt)}</p>
                    </div>
                    <StatusBadge tone={getStatusTone(entry.status)}>{getApplicationStatusLabel(entry.status)}</StatusBadge>
                  </div>
                  <SopStageTrack status={entry.status} />
                  <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                    {entry.status === 'Submitted' ? (
                      <Button type="button" onClick={() => openReview(entry.id)} disabled={startingThisReview}>
                        {startingThisReview ? 'Starting review…' : 'Start review'}
                      </Button>
                    ) : entry.status === 'For Verification' ? (
                      <Button type="button" onClick={() => openReview(entry.id, 'documents')}>Review documents</Button>
                    ) : entry.status === 'For Endorsement' ? (
                      <Button type="button" onClick={() => openReview(entry.id, 'endorsement')}>Open endorsement</Button>
                    ) : (
                      <Button type="button" onClick={() => openReview(entry.id)}>Open review</Button>
                    )}
                    {documentsUnlocked && outstanding ? (
                      <StatusBadge tone="warning">{outstanding} document{outstanding === 1 ? '' : 's'} to verify</StatusBadge>
                    ) : null}
                    {!documentsUnlocked && attachedCount ? (
                      <StatusBadge tone="neutral">{attachedCount} attached document{attachedCount === 1 ? '' : 's'}</StatusBadge>
                    ) : null}
                  </div>
                </article>
              );
            }) : <EmptyState title="No applications in review" description="Submitted applications will appear here for central office review." />}
          </div>
        </Card>
      </section>

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          students={students}
          role="admissions_office"
          initialTab={reviewTab}
          onClose={closeReview}
          onStatusChange={handleStatusChange}
          onEndorse={onEndorseApplication}
          onScheduleInterview={onScheduleInterview}
          onRecordDeliberation={onRecordDeliberation}
          onRelease={onReleaseResults}
          onChangeDocument={onChangeDocument}
          reviewComments={reviewComments}
          onAddComment={onAddComment}
        />
      )}
    </div>
  );
}
