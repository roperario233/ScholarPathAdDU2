import { useMemo } from 'react';
import AdminPageHeader from '../../components/AdminPageHeader';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { getDocumentsAwaitingReview, getRecentApplicationActivity, getReleaseQueue, getReviewQueue } from '../../lib/admissionsOffice';
import { getApplicationStatusLabel, getStatusTone } from '../../lib/constants';
import { fmtDate } from '../../lib/formatters';

// The Admissions Office landing route. It carries only the metrics that steer the
// day's work, the links into each functional workspace, and the cross-cutting
// activity feed, so the queues and forms live on their own routes.
const workspaces = [
  {
    view: 'admin-review',
    label: 'Application review queue',
    note: 'SOP steps 2-6',
    description: 'Start application reviews, verify attached documents at the verification stage, and schedule interviews.',
    action: 'Open review queue',
  },
  {
    view: 'admin-catalog',
    label: 'AdDU internal scholarship catalog',
    note: 'Catalog management',
    description: 'Publish and update AdDU internal entries and the documents each one requires.',
    action: 'Open catalog',
  },
  {
    view: 'admin-release',
    label: 'Recommendation and results release',
    note: 'SOP steps 7-8',
    description: 'Release approved results to applicants and export the accepted list.',
    action: 'Open results release',
  },
  {
    view: 'admin-announcements',
    label: 'Office announcements',
    note: 'Communications',
    description: 'Publish application windows, answers to inquiries, and office notices.',
    action: 'Open announcements',
  },
];

export default function AdminOverview({ applications = [], documents = [], onOpenWorkspace }) {
  const reviewApplications = useMemo(() => getReviewQueue(applications), [applications]);
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
        title="Admissions Office overview"
        description="Coordinate application operations, verify application documents, track sub-committee recommendations, and release results through the Standard Procedure."
        badge="Internal operations"
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Applications in review" value={reviewApplications.length} note="Standard Procedure workflow queue" />
        <StatCard label="Documents awaiting verification" value={blockingDocuments.length} note="Files on applications at verification" />
        <StatCard label="Approved — awaiting release" value={approvedApplications.length} note="Ready for the Admissions Office" />
        <StatCard label="Results released" value={releasedApplications.length} note="Released through the Admissions Office" />
      </section>

      <section className="grid gap-4">
        <Card title="Admissions Office workspaces" action={<StatusBadge tone="info">{workspaces.length} workspaces</StatusBadge>}>
          <div className="grid gap-3 sm:grid-cols-2">
            {workspaces.map((workspace) => (
              <article key={workspace.view} className="grid content-start gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <strong className="min-w-0 text-sm text-app-text">{workspace.label}</strong>
                  <StatusBadge tone="neutral">{workspace.note}</StatusBadge>
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
            )) : <EmptyState title="No application activity yet" description="Status and SOP events will appear here once applications enter the review pipeline." />}
          </div>
        </Card>
      </section>
    </div>
  );
}
