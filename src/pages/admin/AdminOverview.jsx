import { useMemo } from 'react';
import { Activity, ArrowRight, Award, CalendarClock, CalendarDays, CheckCircle2, ClipboardList, FileCheck2, Gavel, History, Hourglass, Inbox, LibraryBig, Megaphone, SendHorizontal, Users } from 'lucide-react';
import AdminPageHeader, { AdminHeaderTile } from '../../components/AdminPageHeader';
import { StatCard } from '../../components/pageParts';
import { Card, EmptyState, StatusBadge } from '../../components/ui';
import { getApprovalQueue, getDocumentsAwaitingReview, getIntakePool, getMyReviewQueue, getRecentApplicationActivity, getReleaseQueue, getReviewQueue } from '../../lib/admissionsOffice';
import { getEndorsementQueue } from '../../lib/endorsement';
import { getApplicationStatusLabel, getStatusTone, isAdmissionsHeadRole } from '../../lib/constants';
import { fmtDate, plural } from '../../lib/formatters';

// The Admissions Office landing route. It carries only the metrics that steer the
// day's work, the links into each functional workspace, and the cross-cutting
// activity feed, so the queues and forms live on their own routes. Since
// Consultation 2 the Head verifies, forwards, checks, and releases; Staff share a
// read-only view of the same dashboard.
const workspaces = [
  {
    view: 'admin-intake',
    icon: Inbox,
    label: 'Intake pool',
    description: 'Every open application, where it is routed, and the interviewers covering each cluster.',
    action: 'Open intake pool',
  },
  {
    view: 'admin-review',
    icon: ClipboardList,
    label: 'Review queue',
    description: 'The cases you opened: document verification and the forward to interview.',
    action: 'Open review queue',
    headOnly: true,
  },
  {
    view: 'admin-interviews',
    icon: Users,
    label: 'Interview schedule',
    description: 'Interviews the interviewers of each school have scheduled.',
    action: 'Open interview schedule',
  },
  {
    view: 'admin-calendar',
    icon: CalendarDays,
    label: 'Office calendar',
    description: 'Interviews, scholarship deadlines, recorded decisions, and office planning entries.',
    action: 'Open calendar',
  },
  {
    view: 'admin-catalog',
    icon: LibraryBig,
    label: 'AdDU internal scholarship catalog',
    description: 'Publish internal tracks and their required documents.',
    action: 'Open catalog',
    headOnly: true,
  },
  {
    view: 'admin-release',
    icon: SendHorizontal,
    label: 'Final check and release',
    description: 'Check approved cases, release each scholarship\'s results, and export the final list to Excel.',
    action: 'Open final check and release',
    headOnly: true,
  },
  {
    view: 'admin-announcements',
    icon: Megaphone,
    label: 'Office announcements',
    description: 'Publish office notices and application windows.',
    action: 'Open announcements',
    headOnly: true,
  },
];

// The header tile, shaped like the student Dashboard's "Next deadline" tile: it
// names the one piece of work that needs the signed-in lane next and opens it.
// The Head's order follows the pipeline's end first, because a released result
// is what applicants are waiting on: final check, then the intake pool, then the
// officer's own queue. Staff only read, so their tile reports the open cases.
function getNextAction({ isHead, approved, intakePool, myQueue, openCases }) {
  if (!isHead) {
    return {
      icon: Activity,
      label: 'Open applications',
      title: plural(openCases, 'open case'),
      note: 'Read-only for Admissions Office Staff',
      view: 'admin-intake',
    };
  }
  if (approved) {
    return {
      icon: SendHorizontal,
      label: 'Needs your attention',
      tone: 'warning',
      title: `${plural(approved, 'approved case')} ready for release`,
      note: 'Tick each final check, then release the results',
      view: 'admin-release',
    };
  }
  if (intakePool) {
    return {
      icon: Inbox,
      label: 'Needs your attention',
      tone: 'warning',
      title: `${plural(intakePool, 'application')} in the intake pool`,
      note: 'Pick one up to verify its documents',
      view: 'admin-intake',
    };
  }
  if (myQueue) {
    return {
      icon: ClipboardList,
      label: 'Needs your attention',
      tone: 'warning',
      title: `${plural(myQueue, 'case')} in your review queue`,
      note: 'Verify documents, then forward to interview',
      view: 'admin-review',
    };
  }
  return {
    icon: CheckCircle2,
    label: 'Office status',
    tone: 'success',
    title: 'You are all caught up',
    note: 'No case needs your action right now',
    view: null,
  };
}

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

  const nextAction = getNextAction({
    isHead,
    approved: approvedApplications.length,
    intakePool: intakePool.length,
    myQueue: myQueue.length,
    openCases: reviewApplications.length,
  });

  return (
    <div className="grid content-start gap-5">
      <AdminPageHeader
        title={isHead ? 'Admissions Office Head dashboard' : 'Admissions Office dashboard'}
        description={isHead
          ? 'Verify documents, forward cases to the interviewers, then check and release the results.'
          : 'A read-only view of the office\'s open applications.'}
        featured
      >
        <AdminHeaderTile
          {...nextAction}
          onClick={nextAction.view ? () => onOpenWorkspace?.(nextAction.view) : undefined}
        />
      </AdminPageHeader>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Inbox} tone="warning" label="Intake pool" value={intakePool.length} note="Open cases nobody has picked up" />
        {isHead ? (
          <>
            <StatCard icon={ClipboardList} tone="info" label="In my review queue" value={myQueue.length} note="Cases you opened" />
            <StatCard icon={FileCheck2} tone="info" label="Under document verification" value={verifiedAwaitingForward.length} note="Verify, then forward to interview" />
            {endorsementApplications.length
              ? <StatCard icon={History} tone="neutral" label="Legacy endorsements" value={endorsementApplications.length} note="Handed off before the change" />
              : null}
            <StatCard icon={Gavel} tone="warning" label="With the schools for approval" value={approvalApplications.length} note="Interviewer recommendations" />
            <StatCard icon={Award} tone="success" label="Approved — final check" value={approvedApplications.length} note="Check, then release" />
            <StatCard icon={SendHorizontal} tone="success" label="Results released" value={releasedApplications.length} note="Released to applicants" />
            <StatCard icon={Activity} tone="info" label="Open cases across the office" value={reviewApplications.length} note="Every application awaiting action" />
          </>
        ) : (
          <>
            <StatCard icon={Hourglass} tone="warning" label="Documents awaiting verification" value={blockingDocuments.length} note="Files across the office" />
            <StatCard icon={Gavel} tone="warning" label="With the schools for approval" value={approvalApplications.length} note="Interviewer recommendations" />
            <StatCard icon={SendHorizontal} tone="success" label="Results released" value={releasedApplications.length} note="Released through the Admissions Office Head" />
          </>
        )}
      </section>

      <section className="grid gap-4">
        <Card title="Admissions Office workspaces" action={<StatusBadge tone="info">{visibleWorkspaces.length} workspaces</StatusBadge>}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleWorkspaces.map((workspace) => {
              const Icon = workspace.icon;
              return (
                <button
                  key={workspace.view}
                  type="button"
                  className="disclosure-action group relative grid content-start gap-3 overflow-hidden rounded-2xl border border-app-border bg-[color:var(--surface)] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400/50 hover:shadow-app focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20"
                  onClick={() => onOpenWorkspace(workspace.view)}
                >
                  <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-blue-500/10 transition group-hover:scale-125" aria-hidden="true" />
                  <span className="relative grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-md shadow-blue-900/20" aria-hidden="true"><Icon size={20} /></span>
                  <span className="relative grid gap-1">
                    <strong className="text-sm font-bold text-app-text">{workspace.label}</strong>
                    <span className="text-sm font-normal text-app-muted">{workspace.description}</span>
                  </span>
                  <span className="relative mt-auto inline-flex items-center gap-1.5 text-sm font-bold text-[color:var(--accent)]">
                    {workspace.action}
                    <ArrowRight size={15} className="transition group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      </section>

      <section className="grid gap-4">
        <Card title="Recent application activity" action={<StatusBadge tone={recentActivity.length ? 'info' : 'neutral'}>{recentActivity.length} recent</StatusBadge>}>
          <ol className="m-0 grid max-h-[640px] list-none gap-3 overflow-y-auto p-0 pr-1">
            {recentActivity.length ? recentActivity.map((event) => (
              <li key={`${event.application.id}-${event.id || event.at}`} className="relative grid gap-2 rounded-2xl border border-app-border bg-app-surface p-4 pl-5 shadow-sm transition before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-gradient-to-b before:from-ateneo before:via-sky-400 before:to-cyan-300 hover:-translate-y-0.5 hover:shadow-app">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block text-sm text-app-text">{event.application.studentName} · {event.application.scholarshipTitle}</strong>
                    <span className="inline-flex items-center gap-1.5 text-xs text-app-muted"><CalendarClock size={12} aria-hidden="true" />{event.actor || 'Application workspace'} · {fmtDate(event.at || event.application.updatedAt)}</span>
                  </div>
                  <StatusBadge tone={getStatusTone(event.application.status)}>{getApplicationStatusLabel(event.application.status)}</StatusBadge>
                </div>
                <p className="m-0 text-sm text-app-muted">{event.note || `Application moved to ${event.stage}.`}</p>
              </li>
            )) : <li><EmptyState title="No application activity yet" description="Status and SOP events appear here as cases move." /></li>}
          </ol>
        </Card>
      </section>
    </div>
  );
}
