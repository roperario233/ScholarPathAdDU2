import { useState } from 'react';
import { StatCard } from '../components/pageParts';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import { Button, Card, EmptyState, Panel, StatusBadge } from '../components/ui';
import { getApplicationStatusLabel } from '../lib/constants';
import { areEndorsementRecordsVisible, describeApplicantAcademic, getDocumentVerificationReadiness } from '../lib/applicationRequirements';
import { fmtCurrency, fmtDate } from '../lib/formatters';

const queueTone = (status) => {
  if (['Approved', 'Released'].includes(status)) return 'success';
  if (status === 'Rejected') return 'danger';
  if (['For Verification', 'Endorsed'].includes(status)) return 'warning';
  return 'info';
};

export default function DepartmentReviewView({
  profile,
  queue,
  documents,
  scholarships = [],
  reviewComments = [],
  onChangeApplication,
  onEndorseApplication,
  onAddComment,
  onFlagForValidation,
  interviewWorkspace = null,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [reviewTab, setReviewTab] = useState(null);
  const selected = queue.find((entry) => entry.id === selectedId);
  const awaitingEndorsement = queue.filter((entry) => entry.status === 'For Endorsement');
  const endorsed = queue.filter((entry) => ['Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'].includes(entry.status));
  // SOP 5a: the interview panel comes from the applicant's school, so a Chair
  // may sit on it. The Admissions Office coordinates the schedule.
  const panelApplicationIds = new Set((interviewWorkspace?.panelists || [])
    .filter((row) => !row.removedAt && row.profileId && row.profileId === interviewWorkspace?.viewerId)
    .map((row) => row.applicationId));
  const panelInterviews = queue.filter((entry) => entry.status === 'Interview' && panelApplicationIds.has(entry.id));

  return (
    <div className="grid gap-5">
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
        <div className="page-title-copy">
          <span className="page-section-label">Department Chair workspace</span>
          <h2>{profile.department || 'Department'} applicant screening</h2>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">Review applicants from your department, endorse verified applications, and sit on the interview panel the Admissions Office schedules for your school.</p>
        </div>
        <StatusBadge tone="info">{queue.length} queued</StatusBadge>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting endorsement" value={awaitingEndorsement.length} />
        <StatCard label="Department recommendations" value={endorsed.length} />
        <StatCard label="Interviews on your panel" value={panelInterviews.length} />
        <StatCard label="Department" value={profile.department || 'Unassigned'} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <Card title="Endorsement queue" action={<StatusBadge tone={awaitingEndorsement.length ? 'warning' : 'success'}>{awaitingEndorsement.length} awaiting decision</StatusBadge>} className="min-w-0">
          <div className="grid max-h-[620px] gap-3 overflow-y-auto pr-1">
            {queue.length ? queue.map((entry) => {
              // An application can only be endorsed once every attached vault file
              // is Verified (manuscript 3.3.3); the database enforces this too.
              const { verified, total, outstanding, ready } = getDocumentVerificationReadiness(entry, documents);
              return (
                <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate">{entry.studentName}</h3>
                      <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram}</p>
                      <p className="mt-1 text-xs text-app-muted">{describeApplicantAcademic(entry)} · {fmtCurrency(Number(entry.studentHouseholdIncome || 0))} · Updated {fmtDate(entry.updatedAt)}</p>
                    </div>
                    <StatusBadge tone={queueTone(entry.status)}>{getApplicationStatusLabel(entry.status)}</StatusBadge>
                  </div>
                  <div className="rounded-xl bg-app-card/60 p-3 text-sm text-app-muted">
                    {entry.endorsement?.note
                      || (entry.status === 'For Verification'
                        ? 'With the Admissions Office for document verification. Your endorsement action opens once the office sends it to endorsement.'
                        : entry.status === 'For Endorsement'
                          ? 'Sent to endorsement by the Admissions Office. Ready for your endorsement decision.'
                          : 'No recommendation has been recorded.')}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3">
                    <span className={`text-xs ${ready ? 'text-app-muted' : 'text-amber-700 dark:text-amber-300'}`}>
                      {verified}/{total || 0} linked documents verified
                      {!ready ? ` · ${outstanding} still need${outstanding === 1 ? 's' : ''} verification` : ''}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => { setReviewTab(null); setSelectedId(entry.id); }}
                      >Open review</Button>
                      {entry.status === 'Interview' && interviewWorkspace ? (
                        <Button
                          type="button"
                          onClick={() => { setReviewTab('interview'); setSelectedId(entry.id); }}
                        >{panelApplicationIds.has(entry.id) ? 'Open interview' : 'View interview'}</Button>
                      ) : null}
                      {areEndorsementRecordsVisible(entry.status) ? (
                        <Button
                          type="button"
                          onClick={() => { setReviewTab('endorsement'); setSelectedId(entry.id); }}
                        >Open endorsement</Button>
                      ) : null}
                      <Button
                        type="button"
                        disabled={!['Submitted', 'Under Review'].includes(entry.status)}
                        onClick={() => onFlagForValidation?.(entry.id)}
                      >Flag for validation</Button>
                    </div>
                  </div>
                </article>
              );
            }) : <EmptyState title="No applicants in queue" description="Department endorsements will appear here once student applications are routed for review." />}
          </div>
        </Card>

      </section>

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          role="department_chair"
          initialTab={reviewTab}
          reviewComments={reviewComments}
          onAddComment={onAddComment}
          onClose={() => { setSelectedId(null); setReviewTab(null); }}
          onStatusChange={onChangeApplication}
          onEndorse={onEndorseApplication}
          interviewWorkspace={interviewWorkspace}
        />
      )}
    </div>
  );
}
