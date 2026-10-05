import { useState } from 'react';
import { verificationStatuses, sopStages, sopStageIndex } from '../lib/constants';
import { AnnouncementItem, NotificationItem, StatCard } from '../components/pageParts';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import { Button, Card, EmptyState, FormField, StatusBadge } from '../components/ui';
import { fmtDate } from '../lib/formatters';

const stageTone = (status) => {
  if (status === 'Rejected') return 'danger';
  if (['Released', 'Approved'].includes(status)) return 'success';
  if (['For Verification', 'Endorsed'].includes(status)) return 'warning';
  return 'info';
};

// Standard Procedure stage track rendered above each queue entry.
function SopStageTrack({ status }) {
  const currentIndex = sopStageIndex(status);
  if (currentIndex == null) {
    return <StatusBadge tone="neutral">Draft — not yet in the SOP pipeline</StatusBadge>;
  }
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Standard Procedure stage track">
      {sopStages.map((stage, index) => (
        <li
          key={stage}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${index < currentIndex ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : index === currentIndex ? 'border-blue-400/50 bg-blue-500/15 text-sky-200' : 'border-app-border bg-app-surface text-app-muted'}`}
        >{stage}</li>
      ))}
    </ol>
  );
}

export default function AdminConsole({
  applications,
  documents,
  announcements,
  notifications,
  onChangeApplication,
  onEndorseApplication,
  onScheduleInterview,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  onCreateAnnouncement,
  onMarkRead,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = applications.find((entry) => entry.id === selectedId);
  const pendingDocuments = documents.filter((entry) => entry.verificationStatus === 'Pending');
  const reviewApplications = applications.filter((entry) => !['Draft', 'Approved', 'Released', 'Rejected'].includes(entry.status));
  const approvedApplications = applications.filter((entry) => entry.status === 'Approved');
  const releasedApplications = applications.filter((entry) => entry.status === 'Released');

  const exportAcceptedList = () => {
    const lines = ['SCHOLARPATH ADDU — ACCEPTED APPLICANTS FOR THE ADMISSIONS OFFICE', ''];
    [...approvedApplications, ...releasedApplications].forEach((entry) => {
      lines.push(`${entry.studentName} · ${entry.scholarshipTitle} · ${entry.status} · Reference ${entry.release?.reference || 'Pending release'}`);
    });
    const link = document.createElement('a');
    link.href = `data:text/plain;charset=utf-8,${encodeURIComponent(lines.join('\n'))}`;
    link.download = 'Accepted_applicants_Admissions_Office.txt';
    link.click();
  };

  return (
    <div className="grid gap-5">
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
        <div className="page-title-copy">
          <span className="page-section-label">Admissions Office workspace</span>
          <h2>Scholarship application operations</h2>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">Coordinate application operations, verify documents, track sub-committee recommendations, and release results through the Admissions Office.</p>
        </div>
        <StatusBadge tone="info">Internal operations</StatusBadge>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Applications in review" value={reviewApplications.length} note="Standard Procedure workflow queue" />
        <StatCard label="Documents for review" value={pendingDocuments.length} note="Blocking endorsement and approval" />
        <StatCard label="Approved — awaiting release" value={approvedApplications.length} note="Ready for the Admissions Office" />
        <StatCard label="Results released" value={releasedApplications.length} note="Released through the Admissions Office" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="Application review queue" action={<StatusBadge tone={reviewApplications.length ? 'warning' : 'success'}>{reviewApplications.length} awaiting action</StatusBadge>}>
          <div className="grid max-h-[540px] gap-3 overflow-y-auto pr-1">
            {reviewApplications.length ? reviewApplications.map((entry) => (
              <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3>{entry.studentName}</h3>
                    <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
                    <p className="mt-1 text-xs text-app-muted">QPI {entry.studentQpi ?? '—'} · Income ₱{Number(entry.studentHouseholdIncome || 0).toLocaleString()} · Updated {fmtDate(entry.updatedAt)}</p>
                  </div>
                  <StatusBadge tone={stageTone(entry.status)}>{entry.status}</StatusBadge>
                </div>
                <SopStageTrack status={entry.status} />
                <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                  <Button type="button" onClick={() => setSelectedId(entry.id)}>Open review</Button>
                </div>
              </article>
            )) : <EmptyState title="No applications in review" description="Submitted applications will appear here for central office review." />}
          </div>
        </Card>

        <Card title="Document verification" action={<StatusBadge tone={pendingDocuments.length ? 'warning' : 'success'}>{pendingDocuments.length} pending</StatusBadge>}>
          <div className="grid max-h-[540px] gap-3 overflow-y-auto pr-1">
            {pendingDocuments.length ? pendingDocuments.map((doc) => {
              const owner = applications.find((entry) => entry.attachedDocuments?.includes(doc.id));
              return (
                <article key={doc.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3>{doc.title}</h3>
                      <p className="mt-1 text-sm text-app-muted">{doc.fileName} · {doc.documentType}</p>
                      {owner && <p className="mt-1 text-xs text-app-muted">Owner {owner.studentName} · {owner.studentDepartment}</p>}
                    </div>
                    <StatusBadge tone="warning">Pending</StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                    {verificationStatuses.map((status) => (
                      <Button key={status} type="button" onClick={() => onChangeDocument(doc.id, status)}>{status}</Button>
                    ))}
                  </div>
                </article>
              );
            }) : <EmptyState title="All documents are verified" description="Pending files will show up here when students upload support documents." />}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card title="Recommendation and release" action={<StatusBadge tone={approvedApplications.length ? 'warning' : 'success'}>{approvedApplications.length} ready</StatusBadge>}>
          <p className="mb-3 text-sm text-app-muted">The School Scholarship Committee approves qualified applicants, then the Admissions Office releases the results.</p>
          <div className="grid max-h-[280px] gap-3 overflow-y-auto pr-1">
            {[...approvedApplications, ...releasedApplications].length ? [...approvedApplications, ...releasedApplications].map((entry) => (
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
          <Button className="mt-3" type="button" disabled={!approvedApplications.length && !releasedApplications.length} onClick={exportAcceptedList}>Export accepted list</Button>
        </Card>

        <Card title="Publish an update" action={<StatusBadge tone="info">SOP step 1</StatusBadge>}>
          <form className="grid gap-4" onSubmit={onCreateAnnouncement}>
            <FormField label="Audience">
              <select name="announcementAudience">
                <option>Students</option>
                <option>Admissions Office</option>
                <option>Department Chairs</option>
                <option>All users</option>
              </select>
            </FormField>
            <FormField label="Title">
              <input name="announcementTitle" placeholder="Application window update" />
            </FormField>
            <FormField label="Body">
              <textarea name="announcementBody" rows="4" placeholder="Announce application windows, answer inquiries, and share scholarship program information." />
            </FormField>
            <Button variant="primary" type="submit">Publish announcement</Button>
          </form>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="Recent announcements" action={<StatusBadge>{announcements.length} published</StatusBadge>}>
          <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-2">
            {announcements.length ? announcements.map((entry) => (
              <AnnouncementItem key={entry.id} entry={entry} />
            )) : <EmptyState title="No announcements yet" description="Publish scholarship updates and office notices from this panel." />}
          </div>
        </Card>

        <Card title="Admissions Office workflow snapshot">
          <div className="grid gap-3">
            <p className="text-sm text-app-muted">{reviewApplications.length} application(s) in review · {pendingDocuments.length} document(s) pending verification · {approvedApplications.length} approved for release</p>
            <div className="grid max-h-[300px] gap-3 overflow-y-auto pr-1">
              {notifications.length ? notifications.slice(0, 4).map((entry) => (
                <NotificationItem key={entry.id} entry={entry} onMarkRead={onMarkRead} />
              )) : <EmptyState title="No notification activity" description="Status changes and deadline alerts will appear here." />}
            </div>
          </div>
        </Card>
      </section>

      {selected && (
        <ApplicationReviewModal
          application={selected}
          documents={documents}
          role="admissions_office"
          onClose={() => setSelectedId(null)}
          onStatusChange={onChangeApplication}
          onEndorse={onEndorseApplication}
          onScheduleInterview={onScheduleInterview}
          onRecordDeliberation={onRecordDeliberation}
          onRelease={onReleaseResults}
          onChangeDocument={onChangeDocument}
        />
      )}
    </div>
  );
}
