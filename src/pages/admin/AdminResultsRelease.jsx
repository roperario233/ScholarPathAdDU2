import { useMemo, useState } from 'react';
import AdminPageHeader from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { buildAcceptedApplicantsReport, getApprovalQueue, getReleaseQueue } from '../../lib/admissionsOffice';
import { fmtDate } from '../../lib/formatters';

// SOP steps 7-8 for the Admissions Office Head: approve the sub-committee's
// recommendations, then release the approved results. The Head opens a
// recommendation in the shared review surface so the decision is made after
// reading the statement, documents, and profile snapshot.
export default function AdminResultsRelease({
  applications = [],
  documents = [],
  students = {},
  scholarships = [],
  role = 'admissions_head',
  onChangeApplication,
  onApproveApplication,
  onReleaseResults,
  interviewWorkspace = null,
}) {
  const [approvalId, setApprovalId] = useState(null);
  const approvalApplications = useMemo(() => getApprovalQueue(applications), [applications]);
  const { approved: approvedApplications, released: releasedApplications, all: queue } = useMemo(
    () => getReleaseQueue(applications),
    [applications],
  );
  const selectedForApproval = applications.find((entry) => entry.id === approvalId);

  // The review surface offers Approve and Reject at this stage; every other move
  // stays with the role-scoped transition map in App.jsx.
  const handleStatusChange = (applicationId, status, options) => (
    status === 'Approved'
      ? onApproveApplication?.(applicationId, options?.note)
      : onChangeApplication?.(applicationId, status, options)
  );

  const exportAcceptedList = () => {
    const link = document.createElement('a');
    link.href = `data:text/plain;charset=utf-8,${encodeURIComponent(buildAcceptedApplicantsReport(queue))}`;
    link.download = 'Accepted_applicants_Admissions_Office.txt';
    link.click();
  };

  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title="Recommendation and results release"
        description="Approve sub-committee recommendations and release approved results."
        badge={`${approvalApplications.length + approvedApplications.length} awaiting decision`}
        badgeTone={approvalApplications.length + approvedApplications.length ? 'warning' : 'success'}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Awaiting your approval" value={approvalApplications.length} note="Sub-committee recommendations" />
        <StatCard label="Approved — awaiting release" value={approvedApplications.length} note="Ready for release" />
        <StatCard label="Results released" value={releasedApplications.length} note="Released to applicants" />
      </section>

      <section className="grid gap-4">
        <Card title="Recommendations awaiting approval" action={<StatusBadge tone={approvalApplications.length ? 'warning' : 'success'}>{approvalApplications.length} ready</StatusBadge>}>
          <div className="grid max-h-[520px] gap-3 overflow-y-auto pr-1">
            {approvalApplications.length ? approvalApplications.map((entry) => (
              <article key={entry.id} className="grid gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate">{entry.studentName}</h3><p className="text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p></div>
                  <StatusBadge tone="warning">Recommended</StatusBadge>
                </div>
                <span className="text-xs text-app-muted">Deliberation recorded {entry.deliberation?.decidedAt ? fmtDate(entry.deliberation.decidedAt) : 'on file'}</span>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-2">
                  <span className="text-xs text-app-muted">Read the case before approving.</span>
                  <Button type="button" onClick={() => setApprovalId(entry.id)}>Review and approve</Button>
                </div>
              </article>
            )) : <EmptyState title="No recommendations awaiting approval" />}
          </div>
        </Card>
      </section>

      <section className="grid gap-4">
        <Card title="Approved results" action={<StatusBadge tone={approvedApplications.length ? 'warning' : 'success'}>{approvedApplications.length} ready to release</StatusBadge>}>
          <div className="grid max-h-[640px] gap-3 overflow-y-auto pr-1">
            {queue.length ? queue.map((entry) => (
              <article key={entry.id} className="grid gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate">{entry.studentName}</h3><p className="text-sm text-app-muted">{entry.scholarshipTitle}</p></div>
                  <StatusBadge tone={entry.status === 'Released' ? 'success' : 'warning'}>{entry.status}</StatusBadge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-2">
                  <span className="text-xs text-app-muted">{entry.release ? `Reference ${entry.release.reference}` : 'Not yet released'}</span>
                  <Button type="button" disabled={entry.status !== 'Approved'} onClick={() => onReleaseResults(entry.id)}>Release results</Button>
                </div>
              </article>
            )) : <EmptyState title="Nothing to release yet" />}
          </div>
          <Button className="mt-3" type="button" disabled={!queue.length} onClick={exportAcceptedList}>Export accepted list</Button>
        </Card>
      </section>

      {selectedForApproval && (
        <ApplicationReviewModal
          application={selectedForApproval}
          scholarship={scholarships.find((entry) => entry.id === selectedForApproval.scholarshipId)}
          documents={documents}
          students={students}
          role={role}
          onClose={() => setApprovalId(null)}
          onStatusChange={handleStatusChange}
          onRelease={onReleaseResults}
          interviewWorkspace={interviewWorkspace}
        />
      )}
    </div>
  );
}
