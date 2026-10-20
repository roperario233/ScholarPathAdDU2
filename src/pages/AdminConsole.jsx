import { useState } from 'react';
import { ADMISSIONS_REVIEW_EXCLUDED_STATUSES } from '../lib/constants';
import { AnnouncementItem, StatCard } from '../components/pageParts';
import { SopStageTrack, describeStatusActor } from '../components/ApplicationParts';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import { Button, Card, EmptyState, FormField, StatusBadge } from '../components/ui';
import RequiredDocumentsEditor from '../components/RequiredDocumentsEditor';
import { describeApplicantAcademic, getDocumentVerificationReadiness, normalizeRequirements } from '../lib/applicationRequirements';
import { fmtDate } from '../lib/formatters';

const stageTone = (status) => {
  if (status === 'Rejected') return 'danger';
  if (['Released', 'Approved'].includes(status)) return 'success';
  if (['For Verification', 'Endorsed'].includes(status)) return 'warning';
  return 'info';
};

export default function AdminConsole({
  applications,
  students = {},
  documents,
  scholarships,
  announcements,
  onChangeApplication,
  onEndorseApplication,
  onScheduleInterview,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  onCreateAnnouncement,
  onSaveScholarship,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [editingScholarship, setEditingScholarship] = useState(null);
  const selected = applications.find((entry) => entry.id === selectedId);
  const pendingDocuments = documents.filter((entry) => entry.verificationStatus === 'Pending');
  // A Pending file only blocks a forward stage when an application actually
  // relies on it; an unattached vault upload gates nothing (manuscript 3.3.3).
  const attachedDocumentIds = new Set(applications.flatMap((entry) => entry.attachedDocuments || []));
  const blockingDocuments = pendingDocuments.filter((entry) => attachedDocumentIds.has(entry.id));
  const reviewApplications = applications.filter((entry) => !ADMISSIONS_REVIEW_EXCLUDED_STATUSES.includes(entry.status));
  const approvedApplications = applications.filter((entry) => entry.status === 'Approved');
  const releasedApplications = applications.filter((entry) => entry.status === 'Released');
  const internalScholarships = scholarships.filter((entry) => (
    entry.isExternal !== true
    && entry.category === 'Internal Endowment'
    && ['general-pool', 'honors', 'work-study'].includes(entry.ruleFamily)
  ));
  // Prefer the append-only status log (the trustworthy actor), falling back to
  // the browser-written timeline for rows that predate it.
  const recentActivity = applications
    .flatMap((entry) => {
      const log = Array.isArray(entry.statusLog) ? entry.statusLog : [];
      const timeline = entry.timeline || [];
      const events = log.length
        ? log.map((event) => ({
            id: event.id,
            stage: event.toStatus,
            note: event.reason || `Application moved to ${event.toStatus}.`,
            actor: describeStatusActor(event, true),
            at: event.at,
          }))
        : timeline;
      return (events.length ? events : [{
          id: `current-${entry.id}`,
          stage: entry.status,
          note: `Application is currently ${entry.status}.`,
          actor: 'Application workspace',
          at: entry.updatedAt,
        }]).map((event) => ({ ...event, application: entry }));
    })
    .sort((left, right) => new Date(right.at || right.application.updatedAt || 0) - new Date(left.at || left.application.updatedAt || 0))
    .slice(0, 5);

  const saveScholarshipFromForm = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ruleFamily = String(data.get('ruleFamily') || 'general-pool');
    let requiredDocuments = [];
    try {
      requiredDocuments = normalizeRequirements(JSON.parse(String(data.get('requiredDocuments') || '[]')));
    } catch {
      requiredDocuments = [];
    }
    if (!requiredDocuments.length) {
      setCatalogError('Add at least one required document with a label and an accepted document type.');
      return;
    }
    setCatalogError('');
    const scholarship = {
      ...(editingScholarship || {}),
      title: String(data.get('scholarshipTitle') || '').trim(),
      category: 'Internal Endowment',
      origin: 'AdDU',
      coverageType: String(data.get('coverageType') || 'Full Tuition'),
      coverage: String(data.get('scholarshipCoverage') || '').trim(),
      minimumQpi: data.get('minimumQpi') || null,
      minimumShsAverage: data.get('minimumShsAverage') || null,
      maximumIncome: data.get('maximumIncome') || null,
      eligibleDegrees: ruleFamily === 'work-study' ? ['ALL'] : [],
      allowsMultipleGrants: false,
      departmentScope: null,
      deadline: data.get('deadline') || null,
      isActive: data.get('isActive') === 'true',
      tags: ['AdDU Internal'],
      ruleFamily,
      govProgram: null,
      isMatchable: true,
      applicationRoute: null,
      isExternal: false,
      requiredDocuments,
    };
    const saved = await onSaveScholarship(scholarship);
    if (saved) setEditingScholarship(null);
  };

  const startEditingScholarship = (scholarship) => {
    setEditingScholarship(null);
    window.requestAnimationFrame(() => setEditingScholarship(scholarship));
  };

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
          <p className="mt-2 max-w-2xl text-sm text-app-muted">Coordinate application operations, verify application documents, track sub-committee recommendations, and release results through the Admissions Office.</p>
        </div>
        <StatusBadge tone="info">Internal operations</StatusBadge>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Applications in review" value={reviewApplications.length} note="Standard Procedure workflow queue" />
        <StatCard label="Documents for review" value={blockingDocuments.length} note="Attached files still Pending — review inside each application" />
        <StatCard label="Approved — awaiting release" value={approvedApplications.length} note="Ready for the Admissions Office" />
        <StatCard label="Results released" value={releasedApplications.length} note="Released through the Admissions Office" />
      </section>

      <section className="grid gap-4">
        <Card title="Application review queue" action={<StatusBadge tone={reviewApplications.length ? 'warning' : 'success'}>{reviewApplications.length} awaiting action</StatusBadge>}>
          <div className="grid max-h-[540px] gap-3 overflow-y-auto pr-1">
            {reviewApplications.length ? reviewApplications.map((entry) => {
              const { outstanding } = getDocumentVerificationReadiness(entry, documents);
              return (
              <article key={entry.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4 shadow-sm">
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3>{entry.studentName}</h3>
                    <p className="mt-1 text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p>
                    <p className="mt-1 text-xs text-app-muted">{describeApplicantAcademic(entry)} · Income ₱{Number(entry.studentHouseholdIncome || 0).toLocaleString()} · Updated {fmtDate(entry.updatedAt)}</p>
                  </div>
                  <StatusBadge tone={stageTone(entry.status)}>{entry.status}</StatusBadge>
                </div>
                <SopStageTrack status={entry.status} />
                <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                  <Button type="button" onClick={() => setSelectedId(entry.id)}>Open review</Button>
                  {outstanding ? <StatusBadge tone="warning">{outstanding} document{outstanding === 1 ? '' : 's'} to verify</StatusBadge> : null}
                </div>
              </article>
              );
            }) : <EmptyState title="No applications in review" description="Submitted applications will appear here for central office review." />}
          </div>
        </Card>

      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="Publish or update an AdDU internal scholarship" action={<StatusBadge tone="info">Catalog management</StatusBadge>}>
          <form key={editingScholarship?.id || 'new-scholarship'} className="grid gap-4" onSubmit={saveScholarshipFromForm}>
            <FormField label="Scholarship title">
              <input name="scholarshipTitle" required defaultValue={editingScholarship?.title || ''} placeholder="Grant-in-Aid (GIA)" />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Internal eligibility rule">
                <select name="ruleFamily" required defaultValue={editingScholarship?.ruleFamily || 'general-pool'}>
                  <option value="general-pool">Grant-in-Aid / general pool</option>
                  <option value="honors">Jubilee / honors</option>
                  <option value="work-study">Student Assistant / Working Scholar</option>
                </select>
              </FormField>
              <FormField label="Coverage type">
                <select name="coverageType" required defaultValue={editingScholarship?.coverageType || 'Full Tuition'}>
                  <option>Full Tuition</option>
                  <option>Partial Tuition</option>
                  <option>Allowance</option>
                </select>
              </FormField>
            </div>
            <FormField label="Coverage description">
              <textarea name="scholarshipCoverage" rows="2" required defaultValue={editingScholarship?.coverage || ''} placeholder="Describe the covered fees or support." />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Minimum QPI (enrolled students)" hint="Applies to 1st–5th year students. Leave blank to use the internal rule default (2.50).">
                <input type="number" name="minimumQpi" min="0" max="4" step="0.01" defaultValue={editingScholarship?.minimumQpi ?? ''} />
              </FormField>
              <FormField label="Minimum SHS general average (incoming first-years)" hint="Applies to incoming 1st years, who have no collegiate QPI yet. Leave blank to use the internal rule default (85).">
                <input type="number" name="minimumShsAverage" min="60" max="100" step="1" defaultValue={editingScholarship?.minimumShsAverage ?? ''} />
              </FormField>
            </div>
            <FormField label="Maximum household income" hint="Leave blank to use the internal rule default.">
              <input type="number" name="maximumIncome" min="0" step="1000" defaultValue={editingScholarship?.maximumIncome ?? ''} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
              <FormField label="Application deadline">
                <input type="date" name="deadline" defaultValue={editingScholarship?.deadline?.slice(0, 10) || ''} />
              </FormField>
              <FormField label="Catalog status">
                <select name="isActive" defaultValue={editingScholarship ? String(editingScholarship.isActive !== false) : 'true'}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </FormField>
            </div>
            <RequiredDocumentsEditor scholarship={editingScholarship} />
            {catalogError ? <p className="form-error m-0" role="alert">{catalogError}</p> : null}
            <p className="m-0 text-xs text-app-muted">This form publishes AdDU-administered programs only. Government-linked and external programs remain managed through their established catalog source; eligibility verification does not make an award or disbursement decision.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" type="submit">{editingScholarship ? 'Save scholarship changes' : 'Publish scholarship'}</Button>
              {editingScholarship && <Button type="button" onClick={() => setEditingScholarship(null)}>Cancel edit</Button>}
            </div>
          </form>
          <div className="mt-5 grid max-h-[360px] gap-2 overflow-y-auto border-t border-app-border pt-4">
            <h4 className="m-0 text-sm font-bold text-app-text">Existing internal catalog entries</h4>
            {internalScholarships.map((entry) => (
              <article key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-app-surface p-3">
                <div className="min-w-0">
                  <strong className="block truncate text-sm text-app-text">{entry.title}</strong>
                  <span className="text-xs text-app-muted">{entry.ruleFamily} · {entry.isActive === false ? 'Inactive' : 'Active'}</span>
                </div>
                <Button type="button" onClick={() => startEditingScholarship(entry)}>Edit</Button>
              </article>
            ))}
            {!internalScholarships.length && <p className="m-0 text-sm text-app-muted">No internal scholarships are loaded from Supabase.</p>}
          </div>
        </Card>

        <Card title="Recent application activity" action={<StatusBadge tone={recentActivity.length ? 'info' : 'neutral'}>{recentActivity.length} recent</StatusBadge>}>
          <div className="grid max-h-[640px] gap-3 overflow-y-auto pr-1">
            {recentActivity.length ? recentActivity.map((event) => (
              <article key={`${event.application.id}-${event.id || event.at}`} className="grid gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block text-sm text-app-text">{event.application.studentName} · {event.application.scholarshipTitle}</strong>
                    <span className="text-xs text-app-muted">{event.actor || 'Application workspace'} · {fmtDate(event.at || event.application.updatedAt)}</span>
                  </div>
                  <StatusBadge tone={stageTone(event.application.status)}>{event.application.status}</StatusBadge>
                </div>
                <p className="m-0 text-sm text-app-muted">{event.note || `Application moved to ${event.stage}.`}</p>
              </article>
            )) : <EmptyState title="No application activity yet" description="Status and SOP events will appear here once applications enter the review pipeline." />}
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

      <section className="grid gap-4">
        <Card title="Recent announcements" action={<StatusBadge>{announcements.length} published</StatusBadge>}>
          <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-2">
            {announcements.length ? announcements.map((entry) => (
              <AnnouncementItem key={entry.id} entry={entry} />
            )) : <EmptyState title="No announcements yet" description="Publish scholarship updates and office notices from this panel." />}
          </div>
        </Card>
      </section>

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          students={students}
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
