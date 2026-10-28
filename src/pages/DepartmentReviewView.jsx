import { useState } from 'react';
import { StatCard } from '../components/pageParts';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import { Button, Card, EmptyState, StatusBadge } from '../components/ui';
import { getApplicationStatusLabel } from '../lib/constants';
import { REVIEW_ROLE_LABELS, buildProgramScopeIndex, getApplicationScope, getReviewScopeLabel, isInterviewerRole } from '../lib/reviewScope';
import { areEndorsementRecordsVisible, describeApplicantAcademic, getDocumentVerificationReadiness } from '../lib/applicationRequirements';
import { downloadApplicantSummaryCsv } from '../lib/admissionsOffice';
import { getLatestPanelRecommendation } from '../lib/interview';
import { fmtCurrency, fmtDate } from '../lib/formatters';

const queueTone = (status) => {
  if (['Approved', 'Released'].includes(status)) return 'success';
  if (status === 'Rejected') return 'danger';
  if (['For Verification', 'Endorsed', 'Recommended'].includes(status)) return 'warning';
  return 'info';
};

// The workspace of every account scoped to the academic hierarchy (Consultation
// 2): an interviewer, and the Chairperson, Assistant Dean, or Dean of a school.
// Applications reach it automatically by the applicant's program. Any of them
// may schedule and run the interview of an applicant in scope; only the level
// configured for the applicant's school approves the recommendation. Document
// verification and release stay with the Admissions Office Head.
export default function DepartmentReviewView({
  profile,
  queue,
  documents,
  scholarships = [],
  reviewComments = [],
  onChangeApplication,
  onRejectApplication,
  onApproveApplication,
  onRecordDeliberation,
  onAddComment,
  interviewWorkspace = null,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [reviewTab, setReviewTab] = useState(null);
  const role = profile.role || 'department_chair';
  const isInterviewer = isInterviewerRole(role);
  const selected = queue.find((entry) => entry.id === selectedId);
  const stageContextFor = interviewWorkspace?.stageContextFor || (() => ({}));
  // SOP 5a: the interview panel comes from the applicant's school, so any scoped
  // reviewer may sit on it, and one who schedules the interview leads it.
  const panelApplicationIds = new Set((interviewWorkspace?.panelists || [])
    .filter((row) => !row.removedAt && row.profileId && row.profileId === interviewWorkspace?.viewerId)
    .map((row) => row.applicationId));
  const awaitingInterview = queue.filter((entry) => entry.status === 'Endorsed');
  const inInterview = queue.filter((entry) => entry.status === 'Interview');
  const panelInterviews = inInterview.filter((entry) => panelApplicationIds.has(entry.id));
  const awaitingApproval = isInterviewer ? [] : queue.filter((entry) => (
    entry.status === 'Recommended' && stageContextFor(entry).isApprover
  ));
  const decidedInScope = queue.filter((entry) => ['Recommended', 'Approved', 'Released'].includes(entry.status));
  const notesFor = (applicationId) => (interviewWorkspace?.notes || []).filter((note) => note.applicationId === applicationId);
  const programIndex = buildProgramScopeIndex(interviewWorkspace?.academicPrograms || []);

  const openCase = (entry, tab = null) => {
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

  const exportSummary = () => downloadApplicantSummaryCsv(decidedInScope, {
    scopeOf: (entry) => getApplicationScope(entry, programIndex),
    recommendationOf: (entry) => getLatestPanelRecommendation(notesFor(entry.id))?.label || '',
  }, `Applicant_summary_${(getReviewScopeLabel(profile) || 'scope').replace(/[^A-Za-z0-9]+/g, '_')}.csv`);

  const renderInterviewRow = (entry) => {
    const onPanel = panelApplicationIds.has(entry.id);
    const recommendation = getLatestPanelRecommendation(notesFor(entry.id));
    return (
      <article key={entry.id} className="grid gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
        <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
          <div className="min-w-0 w-full">
            <h3 className="truncate">{entry.studentName}</h3>
            <p className="text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
          </div>
          <StatusBadge tone={queueTone(entry.status)}>{getApplicationStatusLabel(entry.status)}</StatusBadge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-2">
          <span className="text-xs text-app-muted">
            {entry.status === 'Endorsed'
              ? `Documents verified ${entry.updatedAt ? fmtDate(entry.updatedAt) : ''}. Schedule the interview.`
              : recommendation
                ? `Recommendation recorded: ${recommendation.label}`
                : onPanel ? 'You are on this panel. Record the recommendation after the interview.' : 'Another reviewer is on this panel.'}
          </span>
          <Button type="button" onClick={() => openCase(entry, 'interview')}>
            {entry.status === 'Endorsed' ? 'Schedule interview' : onPanel ? 'Open interview' : 'View interview'}
          </Button>
        </div>
      </article>
    );
  };

  return (
    <div className="grid gap-5">
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
        <div className="page-title-copy">
          <span className="page-section-label">{REVIEW_ROLE_LABELS[role] || 'Reviewer'} workspace</span>
          <h2>{getReviewScopeLabel(profile) || 'Review scope unassigned'} applicants</h2>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            {isInterviewer
              ? 'Applicants in your scope reach you once the Admissions Office has verified their documents. Schedule the interview, record your recommendation level, then send the recommendation to the school.'
              : 'Interview the applicants in your scope or follow the interviewer’s work, and decide the recommendations your school routes to you. Document verification and release stay with the Admissions Office Head.'}
          </p>
        </div>
        <StatusBadge tone="info">{queue.length} in scope</StatusBadge>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Waiting for an interview" value={awaitingInterview.length} />
        <StatCard label="Interviews on your panel" value={panelInterviews.length} />
        {isInterviewer
          ? <StatCard label="Recommendations sent" value={decidedInScope.length} />
          : <StatCard label="Awaiting your approval" value={awaitingApproval.length} />}
        <StatCard label="Review scope" value={getReviewScopeLabel(profile) || 'Unassigned'} />
      </section>

      {!isInterviewer ? (
        <Card
          title="Recommendations awaiting your approval"
          action={<StatusBadge tone={awaitingApproval.length ? 'warning' : 'success'}>{awaitingApproval.length} to decide</StatusBadge>}
        >
          <div className="grid max-h-[520px] gap-3 overflow-y-auto pb-14 pr-1 sm:pb-1">
            {awaitingApproval.length ? awaitingApproval.map((entry) => {
              const recommendation = getLatestPanelRecommendation(notesFor(entry.id));
              return (
                <article key={entry.id} className="grid gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
                  <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                    <div className="min-w-0 w-full">
                      <h3 className="truncate">{entry.studentName}</h3>
                      <p className="text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
                    </div>
                    <StatusBadge tone="warning">{recommendation?.label || 'Recommended'}</StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-2">
                    <span className="text-xs text-app-muted">
                      {[recommendation?.authorName ? `Interviewed by ${recommendation.authorName}` : '', entry.deliberation?.decidedAt ? `sent ${fmtDate(entry.deliberation.decidedAt)}` : ''].filter(Boolean).join(' · ') || 'Read the case before deciding.'}
                    </span>
                    <Button type="button" onClick={() => openCase(entry)}>Review and decide</Button>
                  </div>
                </article>
              );
            }) : <EmptyState title="No recommendations awaiting your approval" description="Recommendations your school routes to your level appear here." />}
          </div>
          <Button className="mt-3" type="button" variant="secondary" disabled={!decidedInScope.length} onClick={exportSummary}>Export to Excel</Button>
        </Card>
      ) : null}

      <Card
        title="Interviews"
        action={<StatusBadge tone={awaitingInterview.length ? 'warning' : 'success'}>{awaitingInterview.length} to schedule</StatusBadge>}
      >
        <div className="grid max-h-[620px] gap-3 overflow-y-auto pb-14 pr-1 sm:pb-1">
          {[...awaitingInterview, ...inInterview].length
            ? [...awaitingInterview, ...inInterview].map(renderInterviewRow)
            : <EmptyState title="No interviews waiting" description="Applicants appear here once the Admissions Office has verified their documents." />}
        </div>
      </Card>

      <Card title="All applications in your scope" className="min-w-0">
        <div className="grid max-h-[620px] gap-3 overflow-y-auto pb-14 pr-1 sm:pb-1">
          {queue.length ? queue.map((entry) => {
            const { verified, total, outstanding, ready } = getDocumentVerificationReadiness(entry, documents);
            return (
              <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
                <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
                  <div className="min-w-0 w-full">
                    <h3 className="truncate">{entry.studentName}</h3>
                    <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram}</p>
                    <p className="mt-1 text-xs text-app-muted">{describeApplicantAcademic(entry)} · {fmtCurrency(Number(entry.studentHouseholdIncome || 0))} · Updated {fmtDate(entry.updatedAt)}</p>
                  </div>
                  <StatusBadge tone={queueTone(entry.status)}>{getApplicationStatusLabel(entry.status)}</StatusBadge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3">
                  <span className={`text-xs ${ready ? 'text-app-muted' : 'text-amber-700 dark:text-amber-300'}`}>
                    {verified}/{total || 0} linked documents verified
                    {!ready ? ` · ${outstanding} with the Admissions Office Head` : ''}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => openCase(entry)}>Open review</Button>
                    {areEndorsementRecordsVisible(entry.status) ? (
                      <Button type="button" variant="secondary" onClick={() => openCase(entry, 'endorsement')}>Case notes</Button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          }) : <EmptyState title="No applicants in scope" description="Applications appear here as students in your scope submit them." />}
        </div>
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
          onClose={() => { setSelectedId(null); setReviewTab(null); }}
          onStatusChange={handleStatusChange}
          onRejectApplication={onRejectApplication}
          onRecordDeliberation={onRecordDeliberation}
          interviewWorkspace={interviewWorkspace}
        />
      )}
    </div>
  );
}
