import { useState } from 'react';
import { Button, ModalShell, Panel, StatusBadge } from './ui';
import DocumentPreviewModal from './DocumentPreviewModal';
import ReasonModal from './ReasonModal';
import { ProfileSnapshotList, RequirementChecklist, SupportingDocumentList } from './ApplicationParts';
import { getNextApplicationStatuses, getDocumentTypeLabel, verificationStatuses } from '../lib/constants';
import { getApplicationReadiness } from '../lib/applicationRequirements';
import { getApplicationProgress } from '../lib/eligibility';
import { fmtCurrency, fmtDate, toPercent } from '../lib/formatters';

const DetailRow = ({ label, value }) => (
  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-app-border/60 py-2 last:border-b-0">
    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">{label}</span>
    <strong className="text-sm text-app-text">{value}</strong>
  </div>
);

// Shared SOP review surface for the Admissions Office and Department Chairs.
export default function ApplicationReviewModal({
  application,
  scholarship,
  documents,
  role,
  onClose,
  onStatusChange,
  onEndorse,
  onScheduleInterview,
  onRecordDeliberation,
  onRelease,
  onChangeDocument,
}) {
  const [interviewDate, setInterviewDate] = useState(application.interview?.scheduledAt || '');
  const [interviewPanel, setInterviewPanel] = useState(application.interview?.panel || '');
  const [deliberationNote, setDeliberationNote] = useState('');
  const [previewDoc, setPreviewDoc] = useState(null);
  const [rejectReasonOpen, setRejectReasonOpen] = useState(false);
  const nextStatuses = getNextApplicationStatuses(application.status, role);
  const linkedDocuments = (application.attachedDocuments || [])
    .map((id) => documents.find((doc) => doc.id === id))
    .filter(Boolean);
  const isAdmissionsOffice = role === 'admissions_office';
  // The scholarship's own requirement list, scoped to the standing the student
  // declared at submit time (the frozen profile snapshot).
  const { requirements, supportingDocuments = [] } = getApplicationReadiness({
    application,
    scholarship,
    documents,
    profile: { yearStanding: application.profileSnapshot?.yearStanding || '' },
  });

  return (
    <>
    <ModalShell title={application.scholarshipTitle} onClose={onClose} className="application-detail-modal">
      <div className="application-detail-modal-body">
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-base font-semibold">{application.studentName}</h3>
          <p className="mt-1 text-sm text-app-muted">{application.studentProgram || 'Program on file'} · {application.studentDepartment || 'Department on file'}</p>
        </div>
        <StatusBadge tone={['Released', 'Approved'].includes(application.status) ? 'success' : application.status === 'Rejected' ? 'danger' : 'info'}>{application.status}</StatusBadge>
      </div>

      <div className="mb-2 h-2 overflow-hidden rounded-full bg-app-muted-surface">
        <div className="h-full rounded-full bg-gradient-to-r from-ateneo-strong via-ateneo to-ateneo-bright" style={{ width: `${getApplicationProgress(application.status)}%` }} />
      </div>
      <p className="mb-4 text-xs text-app-muted">Standard Procedure stage progress: {toPercent(getApplicationProgress(application.status))}</p>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="grid content-start gap-4">
          <Panel className="grid gap-1">
            <h4 className="mb-1 text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Applicant profile</h4>
            <DetailRow label="QPI" value={application.studentQpi != null && application.studentQpi !== '' ? Number(application.studentQpi).toFixed(2) : 'Not encoded'} />
            <DetailRow label="Household income" value={application.studentHouseholdIncome != null && application.studentHouseholdIncome !== '' ? fmtCurrency(Number(application.studentHouseholdIncome)) : 'Not encoded'} />
            <DetailRow label="Submitted" value={application.submittedAt ? fmtDate(application.submittedAt) : 'Not yet'} />
            <DetailRow label="Certified" value={application.certifiedAt ? fmtDate(application.certifiedAt) : 'Not yet'} />
            <DetailRow label="Document status" value={application.documentStatus} />
          </Panel>

          <Panel className="grid gap-1">
            <h4 className="mb-1 text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Profile at submission</h4>
            <ProfileSnapshotList snapshot={application.profileSnapshot} />
            <p className="m-0 text-xs text-app-muted">The applicant profile above shows the current values; compare them when a value changed after submission.</p>
          </Panel>

          <Panel className="grid gap-2">
            <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Required submissions</h4>
            <RequirementChecklist requirements={requirements} onPreview={setPreviewDoc} />
          </Panel>

          <Panel className="grid gap-2">
            <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Supporting documents</h4>
            <SupportingDocumentList documents={supportingDocuments} onPreview={setPreviewDoc} />
          </Panel>

          <Panel className="grid gap-2">
            <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Application statement</h4>
            <p className="m-0 whitespace-pre-line text-sm text-app-text">{application.statement || 'No statement recorded.'}</p>
          </Panel>

          <Panel className="grid gap-2">
            <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Linked vault documents</h4>
            {linkedDocuments.length ? (
              <ul className="grid gap-2">
                {linkedDocuments.map((doc) => (
                  <li key={doc.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 text-sm text-app-text">{doc.title} <span className="text-app-muted">· {getDocumentTypeLabel(doc.documentType)}</span></span>
                    <span className="flex items-center gap-2">
                      <Button type="button" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => setPreviewDoc(doc)}>View</Button>
                      <StatusBadge tone={doc.verificationStatus === 'Verified' ? 'success' : doc.verificationStatus === 'Rejected' ? 'danger' : 'warning'}>{doc.verificationStatus}</StatusBadge>
                      {isAdmissionsOffice && onChangeDocument && (
                        <span className="flex gap-1">
                          {verificationStatuses.filter((status) => status !== doc.verificationStatus).map((status) => (
                            <Button key={status} type="button" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => onChangeDocument(doc.id, status)}>{status}</Button>
                          ))}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-app-muted">No documents attached yet.</p>}
          </Panel>
        </section>

        <section className="grid content-start gap-4">
          {application.endorsement && (
            <Panel className="grid gap-1">
              <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Endorsement · SOP step 4</h4>
              <p className="text-sm text-app-muted">{application.endorsement.note}</p>
              <p className="text-xs text-app-muted">By {application.endorsement.reviewedBy} · {fmtDate(application.endorsement.decidedAt)}</p>
            </Panel>
          )}
          {application.interview && (
            <Panel className="grid gap-1">
              <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Interview · SOP step 5</h4>
              <p className="text-sm text-app-muted">{application.interview.panel} · {application.interview.school}</p>
              <p className="text-sm text-app-muted">{application.interview.scheduledAt ? `Scheduled ${fmtDate(application.interview.scheduledAt)}` : 'Schedule pending'}</p>
              {application.interview.outcome && <p className="text-sm text-app-text">Outcome: {application.interview.outcome}</p>}
            </Panel>
          )}
          {application.deliberation && (
            <Panel className="grid gap-1">
              <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Deliberation · SOP step 6</h4>
              <p className="text-sm text-app-muted">{application.deliberation.decision} · {application.deliberation.note}</p>
              <p className="text-sm text-app-muted">By {application.deliberation.decidedBy} · {fmtDate(application.deliberation.decidedAt)}</p>
            </Panel>
          )}
          {application.release && (
            <Panel className="grid gap-1">
              <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Release of results · SOP step 8</h4>
              <p className="text-sm text-app-muted">Released to {application.release.releasedTo} · Reference {application.release.reference}</p>
              <p className="text-sm text-app-muted">{fmtDate(application.release.releasedAt)}</p>
            </Panel>
          )}

          {isAdmissionsOffice && application.status === 'Endorsed' && (
            <Panel className="grid gap-3">
              <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Schedule the interview</h4>
              <label className="grid gap-2 text-sm text-app-text">
                <span className="font-semibold">Interview date</span>
                <input type="date" value={interviewDate} onChange={(event) => setInterviewDate(event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm text-app-text">
                <span className="font-semibold">Panel / school</span>
                <input value={interviewPanel} onChange={(event) => setInterviewPanel(event.target.value)} placeholder={`${application.studentDepartment || 'Applicant school'} Scholarship Panel`} />
              </label>
              <Button variant="primary" type="button" onClick={() => onScheduleInterview(application.id, { scheduledAt: interviewDate, panel: interviewPanel })}>Schedule interview</Button>
            </Panel>
          )}

          {isAdmissionsOffice && application.status === 'Interview' && (
            <Panel className="grid gap-3">
              <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Evaluation and deliberation</h4>
              <label className="grid gap-2 text-sm text-app-text">
                <span className="font-semibold">Sub-committee note</span>
                <textarea rows="3" value={deliberationNote} onChange={(event) => setDeliberationNote(event.target.value)} placeholder="Record the School Scholarship Sub-committee deliberation." />
              </label>
              <Button variant="primary" type="button" onClick={() => { onRecordDeliberation(application.id, 'Recommended', deliberationNote); setDeliberationNote(''); }}>Recommend for approval</Button>
            </Panel>
          )}

          <Panel className="grid gap-3">
            <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Stage actions</h4>
            <div className="flex flex-wrap gap-2">
              {nextStatuses.map((status) => (
                <Button
                  key={status}
                  type="button"
                  variant={status === 'Rejected' ? 'danger' : 'primary'}
                  onClick={() => {
                    if (status === 'Rejected') {
                      // A rejection must carry a recorded reason, so it opens the
                      // reason dialog instead of a window.prompt.
                      setRejectReasonOpen(true);
                      return;
                    }
                    if (status === 'Endorsed') {
                      onEndorse?.(application.id);
                    } else if (status === 'Interview') {
                      onScheduleInterview?.(application.id, { scheduledAt: interviewDate, panel: interviewPanel });
                    } else if (status === 'Recommended') {
                      onRecordDeliberation?.(application.id, 'Recommended', deliberationNote);
                    } else if (status === 'Released') {
                      onRelease?.(application.id);
                    } else {
                      onStatusChange(application.id, status);
                    }
                    onClose();
                  }}
                >{status}</Button>
              ))}
              {!nextStatuses.length && <p className="text-sm text-app-muted">This application has reached a terminal stage.</p>}
            </div>
          </Panel>

          <Panel className="grid gap-2">
            <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Application timeline</h4>
            {(application.timeline || []).length ? (
              <ol className="grid gap-2 pl-5">
                {application.timeline.map((event) => (
                  <li key={event.id} className="text-sm text-app-muted">
                    <strong className="text-app-text">{event.stage}</strong> · {event.note}
                    <span className="block text-xs">{event.actor} · {fmtDate(event.at)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-app-muted">No stage events recorded yet.</p>}
          </Panel>
        </section>
      </div>
      </div>
    </ModalShell>
    {rejectReasonOpen ? (
      <ReasonModal
        title="Reject application"
        label="Reason for rejection"
        hint="Record why this application is being rejected. The applicant sees this reason."
        confirmLabel="Reject application"
        onConfirm={(note) => {
          onStatusChange(application.id, 'Rejected', { note });
          setRejectReasonOpen(false);
          onClose();
        }}
        onClose={() => setRejectReasonOpen(false)}
      />
    ) : null}
    {previewDoc ? <DocumentPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} /> : null}
    </>
  );
}
