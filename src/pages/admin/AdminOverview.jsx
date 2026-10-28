import { useMemo } from 'react';
import AdminPageHeader from '../../components/AdminPageHeader';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { getApprovalQueue, getDocumentsAwaitingReview, getIntakePool, getMyReviewQueue, getRecentApplicationActivity, getReleaseQueue, getReviewQueue } from '../../lib/admissionsOffice';
import { getEndorsementQueue } from '../../lib/endorsement';
import { getApplicationStatusLabel, getStatusTone, isAdmissionsHeadRole } from '../../lib/constants';
import { fmtDate } from '../../lib/formatters';

// The Admissions Office landing route. It carries only the metrics that steer the
// day's work, the links into each functional workspace, and the cross-cutting
// activity feed, so the queues and forms live on their own routes. Since
// Consultation 2 the Head verifies, forwards, checks, and releases; Staff share a
// read-only view of the same dashboard.
const workspaces = [
  {
    view: 'admin-intake',
    label: 'Intake pool',
    description: 'Every open application, where it is routed, and the interviewers covering each cluster.',
    action: 'Open intake pool',
  },
  {
    view: 'admin-review',
    label: 'Review queue',
    description: 'The cases you opened: document verification and the forward to interview.',
    action: 'Open review queue',
    headOnly: true,
  },
  {
    view: 'admin-interviews',
    label: 'Interview schedule',
    description: 'Interviews the interviewers of each school have scheduled.',
    action: 'Open interview schedule',
  },
  {
    view: 'admin-calendar',
    label: 'Office calendar',
    description: 'Interviews, scholarship deadlines, recorded decisions, and office planning entries.',
    action: 'Open calendar',
  },
  {
    view: 'admin-catalog',
    label: 'AdDU internal scholarship catalog',
    description: 'Publish internal tracks and their required documents.',
    action: 'Open catalog',
    headOnly: true,
  },
  {
    view: 'admin-release',
    label: 'Final check and release',
    description: 'Check approved cases, release each scholarship\'s results, and export the final list to Excel.',
    action: 'Open final check and release',
    headOnly: true,
  },
  {
    view: 'admin-announcements',
    label: 'Office announcements',
    description: 'Publish office notices and application windows.',
    action: 'Open announcements',
    headOnly: true,
  },
];

export default function AdminOverview({ applications = [], documents = [], caseOfficers = [], currentUserId = '', role = 'admissions_office', onOpenWorkspace }) {
  const isHead = isAdmissionsHeadRole(role);
  const visibleWorkspaces = useMemo(
    () => workspaces.filter((workspace) => !workspace.headOnly || isHead),
    [isHead],
  );
  const reviewApplications = useMemo(() => getReviewQueue(applications), [applications]);
  // The officer's own cases, and the pool nobody has opened yet. Together they are
  // the day's work for either office lane.
  const myQueue = useMemo(
    () => getMyReviewQueue(applications, caseOfficers, currentUserId),
    [applications, caseOfficers, currentUserId],
  );
  const intakePool = useMemo(() => getIntakePool(applications, caseOfficers), [applications, caseOfficers]);
  const approvalApplications = useMemo(() => getApprovalQueue(applications), [applications]);
  // Legacy cases handed off for endorsement before Consultation 2.
  const endorsementApplications = useMemo(
    () => getEndorsementQueue(applications),
    [applications],
  );
  const verifiedAwaitingForward = useMemo(
    () => applications.filter((entry) => entry.status === 'For Verification'),
    [applications],
  );
  const blockingDocuments = useMemo(
    () => getDocumentsAwaitingReview(applications, documents),
    [applications, documents],
  );
  const { approved: approvedApplications, released: releasedApplications } = useMemo(
    () => getReleaseQueue(applications),
    [applications],
  );
  const recentActivity = useMemo(() => getRecentApplicationActivity(applications, 5), [applications]);

  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title={isHead ? 'Admissions Office Head dashboard' : 'Admissions Office dashboard'}
        description={isHead
          ? 'Verify documents, forward cases to the interviewers, then check and release the results.'
          : 'A read-only view of the office\'s open applications.'}
        badge={isHead ? 'Final check and release' : 'Read-only'}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Intake pool" value={intakePool.length} note="Open cases nobody has picked up" />
        {isHead ? (
          <>
            <StatCard label="In my review queue" value={myQueue.length} note="Cases you opened" />
            <StatCard label="Under document verification" value={verifiedAwaitingForward.length} note="Verify, then forward to interview" />
            {endorsementApplications.length
              ? <StatCard label="Legacy endorsements" value={endorsementApplications.length} note="Handed off before the change" />
              : null}
            <StatCard label="With the schools for approval" value={approvalApplications.length} note="Interviewer recommendations" />
            <StatCard label="Approved — final check" value={approvedApplications.length} note="Check, then release" />
            <StatCard label="Results released" value={releasedApplications.length} note="Released to applicants" />
            <StatCard label="Open cases across the office" value={reviewApplications.length} note="Every application awaiting action" />
          </>
        ) : (
          <>
            <StatCard label="Documents awaiting verification" value={blockingDocuments.length} note="Files across the office" />
            <StatCard label="With the schools for approval" value={approvalApplications.length} note="Interviewer recommendations" />
            <StatCard label="Results released" value={releasedApplications.length} note="Released through the Admissions Office Head" />
          </>
        )}
      </section>

      <section className="grid gap-4">
        <Card title="Admissions Office workspaces" action={<StatusBadge tone="info">{visibleWorkspaces.length} workspaces</StatusBadge>}>
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleWorkspaces.map((workspace) => (
              <article key={workspace.view} className="grid content-start gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <strong className="min-w-0 text-sm text-app-text">{workspace.label}</strong>
                </div>
                <p className="m-0 text-sm text-app-muted">{workspace.description}</p>
                <div>
                  <Button type="button" onClick={() => onOpenWorkspace(workspace.view)}>{workspace.action}</Button>
                </div>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-4">
        <Card title="Recent application activity" action={<StatusBadge tone={recentActivity.length ? 'info' : 'neutral'}>{recentActivity.length} recent</StatusBadge>}>
          <div className="grid max-h-[640px] gap-3 overflow-y-auto pr-1">
            {recentActivity.length ? recentActivity.map((event) => (
              <article key={`${event.application.id}-${event.id || event.at}`} className="grid gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block text-sm text-app-text">{event.application.studentName} · {event.application.scholarshipTitle}</strong>
                    <span className="text-xs text-app-muted">{event.actor || 'Application workspace'} · {fmtDate(event.at || event.application.updatedAt)}</span>
                  </div>
                  <StatusBadge tone={getStatusTone(event.application.status)}>{getApplicationStatusLabel(event.application.status)}</StatusBadge>
                </div>
                <p className="m-0 text-sm text-app-muted">{event.note || `Application moved to ${event.stage}.`}</p>
              </article>
            )) : <EmptyState title="No application activity yet" description="Status and SOP events appear here as cases move." />}
          </div>
        </Card>
      </section>
    </div>
  );
}
