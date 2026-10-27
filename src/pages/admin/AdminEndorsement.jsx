import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import AdminPageHeader from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { SopStageTrack } from '../../components/ApplicationParts';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { describeApplicantAcademic, getDocumentVerificationReadiness } from '../../lib/applicationRequirements';
import { getCaseOfficers } from '../../lib/admissionsOffice';
import { getApplicationStatusLabel, getStatusTone } from '../../lib/constants';
import {
  getEndorsedApplications,
  getEndorsementAgeDays,
  getEndorsementDecisionEvent,
  getEndorsementHandoff,
  getEndorsementQueue,
  isEndorsementOverdue,
} from '../../lib/endorsement';
import { fmtDate } from '../../lib/formatters';

// SOP step 4 for the Admissions Office Head. The Admissions Office Staff hand a
// fully verified application over (`For Endorsement`) and the Head records the
// decision. This route is that lane's queue and record: every stage write still
// happens in the shared ApplicationReviewModal the rows open, so the page never
// duplicates the role-scoped transition map in src/lib/constants.js.
const VIEWS = [
  { key: 'awaiting', label: 'Awaiting decision' },
  { key: 'recorded', label: 'Decisions recorded' },
];

const waitLabel = (days) => {
  if (days == null) return 'Waiting age unknown';
  if (days <= 0) return 'Handed over today';
  return `Waiting ${days} day${days === 1 ? '' : 's'}`;
};

const documentsLabel = (readiness) => {
  if (!readiness.total) return 'No Document Vault file attached';
  const noun = readiness.total === 1 ? 'document' : 'documents';
  if (readiness.ready) return `${readiness.verified} of ${readiness.total} ${noun} verified`;
  return `${readiness.outstanding} of ${readiness.total} ${noun} still to verify`;
};

export default function AdminEndorsement({
  applications = [],
  documents = [],
  caseOfficers = [],
  students = {},
  scholarships = [],
  role = 'admissions_head',
  reviewerName = '',
  currentUserId = '',
  onChangeApplication,
  onRejectApplication,
  onEndorseApplication,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  reviewComments = [],
  onAddComment,
  onJoinCase,
  onLeaveCase,
  interviewWorkspace = null,
  onOpenWorkspace,
  initialView = 'awaiting',
}) {
  const [view, setView] = useState(
    VIEWS.some((entry) => entry.key === initialView) ? initialView : 'awaiting',
  );
  const [selectedId, setSelectedId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const today = useMemo(() => new Date(), []);

  const awaiting = useMemo(() => getEndorsementQueue(applications), [applications]);
  const recorded = useMemo(() => getEndorsedApplications(applications), [applications]);
  const overdue = useMemo(
    () => awaiting.filter((entry) => isEndorsementOverdue(entry, today)),
    [awaiting, today],
  );
  const selected = applications.find((entry) => entry.id === selectedId) || null;
  const activeView = VIEWS.some((entry) => entry.key === view) ? view : 'awaiting';

  const closeReview = () => setSelectedId(null);

  // Every stage transition stays in the shared handler, so this page only reports
  // the failure instead of re-deriving the endorsement rules.
  const handleStatusChange = async (applicationId, status, options) => {
    const result = await onChangeApplication?.(applicationId, status, options);
    if (result?.error) setFeedback({ message: result.error });
    return result;
  };

  const renderAwaitingRow = (entry) => {
    const readiness = getDocumentVerificationReadiness(entry, documents);
    const handoff = getEndorsementHandoff(entry);
    const age = getEndorsementAgeDays(entry, today);
    const late = isEndorsementOverdue(entry, today);
    const officers = getCaseOfficers(caseOfficers, entry.id).map((officer) => (
      officer.officerId && officer.officerId === currentUserId ? 'You' : officer.officerName
    ));

    return (
      <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
        <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
          <div className="min-w-0 w-full flex-1">
            <h3>{entry.studentName}</h3>
            <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
            <p className="mt-1 text-xs text-app-muted">
              {describeApplicantAcademic(entry)} · Income ₱{Number(entry.studentHouseholdIncome || 0).toLocaleString()}
            </p>
          </div>
          <StatusBadge tone={getStatusTone(entry.status)}>{getApplicationStatusLabel(entry.status)}</StatusBadge>
        </div>

        <SopStageTrack status={entry.status} />

        <p className="m-0 text-sm text-app-text">
          {handoff ? (
            <>
              <strong>Sent by {handoff.actor || 'the Admissions Office'}</strong> · {fmtDate(handoff.at)}
              {handoff.note ? <span className="text-app-muted"> — {handoff.note}</span> : null}
            </>
          ) : (
            <span className="text-app-muted">No hand-off is recorded for this application.</span>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
          <Button type="button" onClick={() => setSelectedId(entry.id)}>Review and endorse</Button>
          <StatusBadge tone={readiness.ready ? 'success' : 'warning'} className="max-w-full">{documentsLabel(readiness)}</StatusBadge>
          <StatusBadge tone={late ? 'danger' : 'neutral'} className="max-w-full">
            {waitLabel(age)}{late ? ' · past the 5-day target' : ''}
          </StatusBadge>
          {officers.length ? (
            <StatusBadge tone="info" className="max-w-full">Prepared by {officers.join(' · ')}</StatusBadge>
          ) : null}
        </div>
      </article>
    );
  };

  const renderRecordedRow = (entry) => {
    const record = entry.endorsement;
    const decision = getEndorsementDecisionEvent(entry);
    const age = getEndorsementAgeDays(entry, today);

    return (
      <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
        <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
          <div className="min-w-0 w-full flex-1">
            <h3>{entry.studentName}</h3>
            <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
          </div>
          <StatusBadge tone={getStatusTone(entry.status)}>{getApplicationStatusLabel(entry.status)}</StatusBadge>
        </div>

        <p className="m-0 text-sm text-app-text">
          <strong>Endorsed</strong> by {record?.reviewedBy || decision?.actor || 'the Office of Admissions & Aid'}
          {' · '}{fmtDate(record?.decidedAt || decision?.at)}
          {record?.note ? <span className="text-app-muted"> — {record.note}</span> : null}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-3">
          <span className="text-xs text-app-muted">
            {age == null
              ? 'Decision timing not recorded'
              : `Decided ${age} day${age === 1 ? '' : 's'} after the hand-off`}
          </span>
          <Button type="button" variant="secondary" onClick={() => setSelectedId(entry.id)}>Open case</Button>
        </div>
      </article>
    );
  };

  const visible = activeView === 'awaiting' ? awaiting : recorded;
  const cardTitle = activeView === 'awaiting' ? 'Awaiting your decision' : 'Endorsement decisions';
  const cardTone = activeView === 'awaiting' ? (visible.length ? 'warning' : 'success') : 'success';

  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title="Endorsement"
        description="Standard Procedure step 4: record the Office of Admissions & Aid decision on the cases the Staff sent for endorsement."
        badge={`${awaiting.length} awaiting decision`}
        badgeTone={awaiting.length ? 'warning' : 'success'}
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
            aria-label="Dismiss endorsement message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Awaiting your endorsement" value={awaiting.length} note="Handed over by the Admissions Office Staff" />
        <StatCard label="Past the 5-day target" value={overdue.length} note="Waiting on your decision" />
        <StatCard label="Endorsed — next is interview scheduling" value={recorded.length} note="Decisions recorded in this lane" />
      </section>



      <section className="grid gap-4">
        <Card
          title={cardTitle}
          action={(
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={cardTone}>
                {visible.length} case{visible.length === 1 ? '' : 's'}
              </StatusBadge>
              <div className="w-[13rem] max-w-full">
                <select
                  value={activeView}
                  onChange={(event) => setView(event.target.value)}
                  aria-label="Filter endorsement cases"
                  className="min-h-10 w-full"
                >
                  {VIEWS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
                </select>
              </div>
            </div>
          )}
        >
          <div className="grid max-h-[720px] gap-3 overflow-y-auto pb-14 pr-1 sm:pb-1">
            {visible.length ? visible.map(activeView === 'awaiting' ? renderAwaitingRow : renderRecordedRow) : (
              <EmptyState
                title={activeView === 'awaiting' ? 'No case is awaiting your endorsement' : 'No endorsement decision recorded yet'}
                description={activeView === 'awaiting'
                  ? 'The Admissions Office Staff send a case here once every attached document is verified. Cases still being prepared stay in the intake pool and the review queue.'
                  : 'Once you record a decision, the case and its note appear here as it moves on to interview scheduling.'}
                action={activeView === 'awaiting' && onOpenWorkspace
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
          initialTab="endorsement"
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
