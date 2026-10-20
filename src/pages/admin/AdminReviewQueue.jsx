import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import AdminPageHeader from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { SopStageTrack } from '../../components/ApplicationParts';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { describeApplicantAcademic, getDocumentVerificationReadiness } from '../../lib/applicationRequirements';
import { getDocumentsAwaitingReview, getReviewQueue } from '../../lib/admissionsOffice';
import { getStatusTone } from '../../lib/constants';
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
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [reviewTab, setReviewTab] = useState(null);
  const [feedback, setFeedback] = useState(null);
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

  // Open the shared review surface, optionally straight on its Documents tab so
  // a queued file is one click away instead of something the reviewer has to
  // find by opening the application and switching tabs.
  const openReview = (applicationId, tab = null) => {
    setReviewTab(tab);
    setSelectedId(applicationId);
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
        description="Verify supporting documents, record Standard Procedure decisions, and schedule interviews for submitted applications."
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
        <StatCard label="Documents to verify" value={blockingDocuments.length} note="Attached files still Pending" />
        <StatCard label="For verification" value={awaitingVerification.length} note="Awaiting document decisions" />
      </section>

      <section className="grid gap-4">
        <Card title="Application review queue" action={<StatusBadge tone={reviewApplications.length ? 'warning' : 'success'}>{reviewApplications.length} awaiting action</StatusBadge>}>
          <div className="grid max-h-[720px] gap-3 overflow-y-auto pr-1">
            {reviewApplications.length ? reviewApplications.map((entry) => {
              const { outstanding } = getDocumentVerificationReadiness(entry, documents);
              return (
                <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3>{entry.studentName}</h3>
                      <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
                      <p className="mt-1 text-xs text-app-muted">{describeApplicantAcademic(entry)} · Income ₱{Number(entry.studentHouseholdIncome || 0).toLocaleString()} · Updated {fmtDate(entry.updatedAt)}</p>
                    </div>
                    <StatusBadge tone={getStatusTone(entry.status)}>{entry.status}</StatusBadge>
                  </div>
                  <SopStageTrack status={entry.status} />
                  <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                    <Button type="button" onClick={() => openReview(entry.id)}>Open review</Button>
                    {outstanding ? (
                      <Button type="button" onClick={() => openReview(entry.id, 'documents')}>Review documents</Button>
                    ) : null}
                    {outstanding ? <StatusBadge tone="warning">{outstanding} document{outstanding === 1 ? '' : 's'} to verify</StatusBadge> : null}
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
        />
      )}
    </div>
  );
}
