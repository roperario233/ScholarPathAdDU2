import { useMemo, useState } from 'react';
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

  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title="Application review queue"
        description="Verify supporting documents, record Standard Procedure decisions, and schedule interviews for submitted applications."
        badge={`${reviewApplications.length} awaiting action`}
        badgeTone={reviewApplications.length ? 'warning' : 'success'}
      />

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
                    <Button type="button" onClick={() => setSelectedId(entry.id)}>Open review</Button>
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
          onClose={() => setSelectedId(null)}
          onStatusChange={onChangeApplication}
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
