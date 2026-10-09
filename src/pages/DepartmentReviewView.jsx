import { useState } from 'react';
import { StatCard } from '../components/pageParts';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import { Button, Card, EmptyState, Panel, StatusBadge } from '../components/ui';
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
  onChangeApplication,
  onEndorseApplication,
  onScheduleInterview,
  onRecordDeliberation,
  onReleaseResults,
  onFlagForValidation,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = queue.find((entry) => entry.id === selectedId);
  const awaitingEndorsement = queue.filter((entry) => entry.status === 'For Verification');
  const endorsed = queue.filter((entry) => ['Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'].includes(entry.status));
  const interviews = queue.filter((entry) => entry.status === 'Interview');

  return (
    <div className="grid gap-5">
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
        <div className="page-title-copy">
          <span className="page-section-label">Department Chair workspace</span>
          <h2>{profile.department || 'Department'} applicant screening</h2>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">Review applicants from your department, convene the interview panel, and record department-level recommendations.</p>
        </div>
        <StatusBadge tone="info">{queue.length} queued</StatusBadge>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting endorsement" value={awaitingEndorsement.length} note="Qualified applicants to endorse" />
        <StatCard label="Department recommendations" value={endorsed.length} note="Applications routed to the next SOP stage" />
        <StatCard label="Interviews scheduled" value={interviews.length} note="Panels from the applicant school" />
        <StatCard label="Department scope" value={profile.department || 'Unassigned'} note="Endorsement boundary" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <Card title="Endorsement queue" action={<StatusBadge tone={awaitingEndorsement.length ? 'warning' : 'success'}>{awaitingEndorsement.length} awaiting decision</StatusBadge>} className="min-w-0">
          <div className="grid max-h-[620px] gap-3 overflow-y-auto pr-1">
            {queue.length ? queue.map((entry) => {
              const linkedDocs = (entry.attachedDocuments || []).map((id) => documents.find((doc) => doc.id === id)).filter(Boolean);
              const verifiedCount = linkedDocs.filter((doc) => doc.verificationStatus === 'Verified').length;
              return (
                <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate">{entry.studentName}</h3>
                      <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram}</p>
                      <p className="mt-1 text-xs text-app-muted">QPI {entry.studentQpi ?? '—'} · {fmtCurrency(Number(entry.studentHouseholdIncome || 0))} · Updated {fmtDate(entry.updatedAt)}</p>
                    </div>
                    <StatusBadge tone={queueTone(entry.status)}>{entry.status}</StatusBadge>
                  </div>
                  <div className="rounded-xl bg-app-card/60 p-3 text-sm text-app-muted">
                    {entry.endorsement?.note || 'No recommendation has been recorded.'}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3">
                    <span className="text-xs text-app-muted">{verifiedCount}/{linkedDocs.length || 0} linked documents verified</span>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => setSelectedId(entry.id)}>Open review</Button>
                      <Button type="button" disabled={entry.status !== 'For Verification'} onClick={() => onEndorseApplication(entry.id)}>Endorse</Button>
                      <Button type="button" onClick={() => onFlagForValidation?.(entry.id)}>Flag for validation</Button>
                    </div>
                  </div>
                </article>
              );
            }) : <EmptyState title="No applicants in queue" description="Department endorsements will appear here once student applications are routed for review." />}
          </div>
        </Card>

        <Card title="Review guidance" action={<StatusBadge tone="info">SOP steps 4-6</StatusBadge>} className="min-w-0">
          <div className="grid gap-3">
            <Panel className="grid gap-3">
              <h3>Endorsement focus</h3>
              <p className="text-sm text-app-muted">Recommend qualified applicants once required submissions are verified and academic standing is active.</p>
            </Panel>
            <Panel className="grid gap-3">
              <h3>Interview panel</h3>
              <p className="text-sm text-app-muted">The interviewing body is drawn from the school where the applicant’s program belongs — your department convenes the panel.</p>
            </Panel>
            <Panel className="grid gap-3">
              <h3>Deliberation</h3>
              <p className="text-sm text-app-muted">The School Scholarship Sub-committee evaluates interviewed applicants and records its recommendation.</p>
            </Panel>
          </div>
        </Card>
      </section>

      {selected && (
        <ApplicationReviewModal
          application={selected}
          documents={documents}
          role="department_chair"
          onClose={() => setSelectedId(null)}
          onStatusChange={onChangeApplication}
          onEndorse={onEndorseApplication}
          onScheduleInterview={onScheduleInterview}
          onRecordDeliberation={onRecordDeliberation}
          onRelease={onReleaseResults}
        />
      )}
    </div>
  );
}
