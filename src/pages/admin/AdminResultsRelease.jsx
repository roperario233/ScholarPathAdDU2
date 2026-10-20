import { useMemo } from 'react';
import AdminPageHeader from '../../components/AdminPageHeader';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { buildAcceptedApplicantsReport, getReleaseQueue } from '../../lib/admissionsOffice';

// SOP steps 7-8: the School Scholarship Committee approves qualified applicants
// and the Admissions Office releases the results.
export default function AdminResultsRelease({ applications = [], onReleaseResults }) {
  const { approved: approvedApplications, released: releasedApplications, all: queue } = useMemo(
    () => getReleaseQueue(applications),
    [applications],
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
        description="The School Scholarship Committee approves qualified applicants, then the Admissions Office releases the results."
        badge={`${approvedApplications.length} ready`}
        badgeTone={approvedApplications.length ? 'warning' : 'success'}
      />

      <section className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Approved — awaiting release" value={approvedApplications.length} note="Ready for the Admissions Office" />
        <StatCard label="Results released" value={releasedApplications.length} note="Released through the Admissions Office" />
      </section>

      <section className="grid gap-4">
        <Card title="Recommendation and release" action={<StatusBadge tone={approvedApplications.length ? 'warning' : 'success'}>{approvedApplications.length} ready</StatusBadge>}>
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
            )) : <EmptyState title="Nothing to release yet" description="Approved applications will queue here for release through the Admissions Office." />}
          </div>
          <Button className="mt-3" type="button" disabled={!queue.length} onClick={exportAcceptedList}>Export accepted list</Button>
        </Card>
      </section>
    </div>
  );
}
