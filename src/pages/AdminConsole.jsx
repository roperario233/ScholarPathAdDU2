import { useState } from 'react';
import { verificationStatuses, sopStages, sopStageIndex, getDocumentTypeLabel } from '../lib/constants';
import { getVerifiableAttributeOption } from '../lib/profile';
import { AnnouncementItem, StatCard } from '../components/pageParts';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import { Button, Card, EmptyState, FormField, StatusBadge } from '../components/ui';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import RequiredDocumentsEditor from '../components/RequiredDocumentsEditor';
import { normalizeRequirements } from '../lib/applicationRequirements';
import { getProofStaleReason } from '../lib/verification';
import { fmtCurrency, fmtDate } from '../lib/formatters';

const stageTone = (status) => {
  if (status === 'Rejected') return 'danger';
  if (['Released', 'Approved'].includes(status)) return 'success';
  if (['For Verification', 'Endorsed'].includes(status)) return 'warning';
  return 'info';
};

// Renders a declared attribute value: the value a proof was uploaded to attest
// (any verifiable attribute) or the student's current QPI and household income
// from the staff directory.
const formatDeclaredValue = (key, value) => {
  if (value == null || value === '') return 'not provided';
  if (key === 'qpi') return Number(value).toFixed(2);
  if (key === 'householdIncome') return fmtCurrency(Number(value));
  return String(value);
};

const hasAttestedValue = (doc, key) => Boolean(doc.attestedValues) && Object.prototype.hasOwnProperty.call(doc.attestedValues, key);

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
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${index < currentIndex ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : index === currentIndex ? 'border-ateneo-strong/50 bg-ateneo/15 text-ateneo-strong dark:border-blue-400/50 dark:bg-blue-500/15 dark:text-sky-200' : 'border-app-border bg-app-surface text-app-muted'}`}
        >{stage}</li>
      ))}
    </ol>
  );
}

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
  const [previewDoc, setPreviewDoc] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [editingScholarship, setEditingScholarship] = useState(null);
  const selected = applications.find((entry) => entry.id === selectedId);
  const pendingDocuments = documents.filter((entry) => entry.verificationStatus === 'Pending');
  const reviewApplications = applications.filter((entry) => !['Draft', 'Approved', 'Released', 'Rejected'].includes(entry.status));
  const approvedApplications = applications.filter((entry) => entry.status === 'Approved');
  const releasedApplications = applications.filter((entry) => entry.status === 'Released');
  const internalScholarships = scholarships.filter((entry) => (
    entry.isExternal !== true
    && entry.category === 'Internal Endowment'
    && ['general-pool', 'honors', 'work-study'].includes(entry.ruleFamily)
  ));
  const recentActivity = applications
    .flatMap((entry) => {
      const timeline = entry.timeline || [];
      return (timeline.length ? timeline : [{
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
              const owner = students[doc.ownerId] || null;
              const attached = applications.find((entry) => entry.attachedDocuments?.includes(doc.id));
              const ownerName = owner?.fullName || doc.ownerName || attached?.studentName || '';
              const ownerSchool = owner?.department || doc.ownerDepartment || attached?.studentDepartment || '';
              // The declared value a staff member can compare the file against,
              // read from the profiles directory first and the attached
              // application second.
              const declaredFor = (key) => {
                if (key === 'qpi') return owner?.qpi ?? attached?.studentQpi ?? null;
                if (key === 'householdIncome') return owner?.householdIncome ?? attached?.studentHouseholdIncome ?? null;
                return null;
              };
              return (
                <article key={doc.id} className="grid gap-3 rounded-[18px] border border-app-border bg-app-surface p-4">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3>{doc.title}</h3>
                      <p className="mt-1 text-sm text-app-muted">{doc.fileName} · {getDocumentTypeLabel(doc.documentType)}</p>
                      <p className="mt-1 text-xs text-app-muted">Owner {ownerName || 'Student applicant'}{ownerSchool ? ` · ${ownerSchool}` : ''}</p>
                    </div>
                    <StatusBadge tone="warning">Pending</StatusBadge>
                  </div>
                  {Array.isArray(doc.linkedAttributes) && doc.linkedAttributes.length ? (
                    <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Proves</span>
                      {doc.linkedAttributes.map((key) => {
                        const declared = declaredFor(key);
                        const hasDeclared = declared != null && declared !== '';
                        const attested = hasAttestedValue(doc, key);
                        // The directory only carries QPI and household income, so the
                        // value check runs for those; the academic-year check runs for all.
                        const staleReason = getProofStaleReason(doc, key, {
                          profile: hasDeclared && ['qpi', 'householdIncome'].includes(key) ? { [key]: declared } : null,
                        });
                        return (
                          <span key={key} className="inline-flex flex-wrap items-center gap-1">
                            <StatusBadge tone="info">{getVerifiableAttributeOption(key)?.label || key}</StatusBadge>
                            {attested
                              ? <span className="text-xs text-app-muted">Declared at upload: {formatDeclaredValue(key, doc.attestedValues[key])}</span>
                              : hasDeclared ? <span className="text-xs text-app-muted">Declared: {formatDeclaredValue(key, declared)}</span> : null}
                            {staleReason === 'value' && <span className="text-xs text-app-muted">Profile now: {formatDeclaredValue(key, declared)}</span>}
                            {staleReason && <StatusBadge tone="danger">{staleReason === 'year' ? 'Outdated · earlier academic year' : 'Outdated · profile changed'}</StatusBadge>}
                          </span>
                        );
                      })}
                      {!doc.linkedAttributes.some((key) => hasAttestedValue(doc, key) || declaredFor(key) != null) && (
                        <span className="text-xs text-app-muted">Declared values are in the student’s My Profile.</span>
                      )}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                    <Button type="button" onClick={() => setPreviewDoc(doc)}>View</Button>
                    {verificationStatuses.filter((status) => status !== doc.verificationStatus).map((status) => (
                      <Button key={status} type="button" onClick={() => onChangeDocument(doc.id, status)}>{status}</Button>
                    ))}
                  </div>
                </article>
              );
            }) : <EmptyState title="All documents are verified" description="Pending files will show up here when students upload support documents." />}
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

      {previewDoc ? <DocumentPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} /> : null}
    </div>
  );
}
