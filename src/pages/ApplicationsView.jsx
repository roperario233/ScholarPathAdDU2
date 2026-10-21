import { useEffect, useMemo, useState } from 'react';
import { Card, EmptyState } from '../components/pageParts';
import { Button, ModalShell, Panel, StatusBadge } from '../components/ui';
import ApplicationWorkspaceModal from '../components/ApplicationWorkspaceModal';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import { DocumentDecisionRecord, DocumentRejectionReason, ProfileSnapshotList, RejectedDocumentReplacer, RequirementChecklist, StatusHistoryList, SupportingDocumentList } from '../components/ApplicationParts';
import { getApplicantPhotoDocument, getApplicationReadiness, getProfileSnapshotSections, getReplacementOptions, getReplaceableRejectedDocuments } from '../lib/applicationRequirements';
import { DOCUMENT_REPLACEMENT_STATUSES, applicationStatuses, getApplicationStatusGuidance, getApplicationStatusLabel, getDocumentTypeLabel } from '../lib/constants';
import { getApplicationProgress, isAdduInternalProgram } from '../lib/eligibility';
import { fmtDate, toPercent } from '../lib/formatters';

const statusTone = { Approved: 'success', Rejected: 'danger', Draft: 'neutral', Submitted: 'info', 'Under Review': 'info', 'For Verification': 'warning', 'For Endorsement': 'warning', Endorsed: 'warning', Interview: 'info', Recommended: 'info', Released: 'success' };

const sectionHeading = 'm-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted';

// The frozen profile snapshot as report lines, grouped like the on-screen list.
// The 2x2 ID photo leads the snapshot on screen; a text report can only name the
// file the application attaches, so it records that line instead of the image.
const snapshotLines = (snapshot, isOpenDraft, applicantPhoto = null) => {
  const photoLine = `- 2x2 applicant photo: ${applicantPhoto ? `${applicantPhoto.title} (${applicantPhoto.verificationStatus})` : 'Not attached'}`;
  if (!snapshot) return [photoLine, isOpenDraft ? '(Recorded when you submit the application.)' : '(No profile snapshot was recorded.)'];
  const { legacy, sections } = getProfileSnapshotSections(snapshot);
  return [
    photoLine,
    ...sections.flatMap((section) => [
      `${section.title}:`,
      ...section.rows.map((row) => `- ${row.label}: ${row.value || 'Not encoded'}${row.verification ? ` [${row.verification}]` : ''}`),
    ]),
    ...(legacy ? ['(Submitted before the extended profile details were recorded.)'] : []),
    ...(snapshot.capturedAt ? [`Self-reported values as of ${fmtDate(snapshot.capturedAt)}.`] : []),
  ];
};

// A file line in the text report. A rejected file records why, so the exported
// report carries the same reason the student sees on screen.
const describeReportDocument = (doc) => `${doc.title} (${doc.verificationStatus}${doc.verificationStatus === 'Rejected' && doc.rejectionReason ? ` — ${doc.rejectionReason}` : ''})`;

export default function ApplicationsView({
  applications,
  documents,
  scholarships,
  profile,
  attributeVerifications,
  openApplicationId,
  onOpenApplication,
  onAttach,
  onDetach,
  onUploadAndAttach,
  onReplaceDocument,
  onSaveDraft,
  onSubmit,
  onSaveProfile,
  onOpenProfile,
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);

  const scholarshipById = useMemo(() => Object.fromEntries(scholarships.map((entry) => [entry.id, entry])), [scholarships]);
  const readinessFor = (entry) => getApplicationReadiness({ application: entry, scholarship: scholarshipById[entry.scholarshipId], documents, profile });

  const filtered = useMemo(() => applications.filter((entry) => {
    const matchesQuery = !query.trim() || entry.scholarshipTitle.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (status === 'all' || entry.status === status);
  }), [applications, query, status]);
  const selected = applications.find((entry) => entry.id === selectedId);
  // Only an AdDU internal draft opens the workspace; external entries are tracked.
  const workspaceApplication = applications.find((entry) => (
    entry.id === openApplicationId && entry.status === 'Draft' && isAdduInternalProgram(scholarshipById[entry.scholarshipId])
  ));

  const exportReport = (entry) => {
    const scholarship = scholarshipById[entry.scholarshipId];
    const readiness = readinessFor(entry);
    const content = [
      'SCHOLARPATH ADDU — APPLICATION REPORT',
      '',
      `Application: ${entry.scholarshipTitle}`,
      `ID: ${entry.id}`,
      `Status: ${getApplicationStatusLabel(entry.status)}`,
      `Progress: ${toPercent(getApplicationProgress(entry.status))}`,
      `Deadline: ${scholarship ? fmtDate(scholarship.deadline) : 'N/A'}`,
      `Submitted: ${entry.submittedAt ? fmtDate(entry.submittedAt) : 'Not yet'}`,
      `Certified: ${entry.certifiedAt ? fmtDate(entry.certifiedAt) : 'Not yet'}`,
      '',
      'REQUIRED DOCUMENTS',
      ...(readiness.requirements.length
        ? readiness.requirements.map((item) => `- ${item.label}: ${item.attached.length ? item.attached.map(describeReportDocument).join(', ') : 'Not attached'}`)
        : ['- None listed']),
      '',
      'SUPPORTING DOCUMENTS',
      ...(readiness.supportingDocuments.length
        ? readiness.supportingDocuments.map((doc) => `- ${doc.title} (${getDocumentTypeLabel(doc.documentType)}, ${doc.verificationStatus}${doc.verificationStatus === 'Rejected' && doc.rejectionReason ? ` — ${doc.rejectionReason}` : ''})`)
        : ['- None attached']),
      '',
      'PROFILE SNAPSHOT',
      ...snapshotLines(entry.profileSnapshot, entry.status === 'Draft' && readiness.route === 'internal', getApplicantPhotoDocument(entry, documents)),
      '',
      'STATEMENT',
      entry.statement || '(none)',
      '',
      entry.notes || '',
    ].join('\n');
    const link = document.createElement('a');
    link.href = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
    link.download = `Application_${entry.scholarshipTitle.replace(/[^a-z0-9]+/gi, '_')}.txt`;
    link.click();
  };

  const selectedReadiness = selected ? readinessFor(selected) : null;

  // The Document Vault sends the student here with the application to fix
  // (`onResolveDocument` -> navigate('applications', { applicationId })). A
  // Draft still opens the workspace; anything else opens its details, where the
  // rejected file can be replaced.
  useEffect(() => {
    if (!openApplicationId) return;
    const entry = applications.find((item) => item.id === openApplicationId);
    if (!entry || entry.status === 'Draft') return;
    setSelectedId(entry.id);
    onOpenApplication(null);
  }, [openApplicationId, applications, onOpenApplication]);

  // A rejected attached file the student can still replace is shown in one
  // prominent panel above the lists, so it cannot be missed.
  const replaceableRejected = selected && onReplaceDocument && DOCUMENT_REPLACEMENT_STATUSES.includes(selected.status)
    ? getReplaceableRejectedDocuments(selected, documents)
    : [];

  // The reason and the review record shown under an attached file in the lists.
  // The replace controls live in the action panel above, so the file rows stay
  // compact. The student sees the Admissions Office lane, never the reviewer's
  // name.
  const renderAttachmentNote = function AttachmentNote(doc) {
    return (
      <>
        <DocumentRejectionReason doc={doc} />
        <DocumentDecisionRecord doc={doc} showReviewer={false} />
      </>
    );
  };

  return <div className="blue-action-view grid gap-4">
    <Card title="Your applications" className="application-list-card">
      <div className="grid gap-4 rounded-2xl border border-app-border bg-app-surface/60 p-3 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-4"><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Find an application</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search applications" aria-label="Search applications" /></label><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Application status</span><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter applications by status"><option value="all">All statuses</option>{applicationStatuses.map((item) => <option key={item} value={item}>{getApplicationStatusLabel(item)}</option>)}</select></label></div>
      <div className="mt-6 flex items-center justify-between gap-3 border-b border-app-border/70 px-1 pb-3"><p className="m-0 text-sm font-semibold text-app-text">{filtered.length} {filtered.length === 1 ? 'application' : 'applications'} found</p><span className="text-xs text-app-muted">Attach the required documents, then submit</span></div>
      <div className="mt-4 grid max-h-[560px] gap-4 overflow-y-auto pr-2">
        {filtered.length ? filtered.map((entry) => {
          const scholarship = scholarshipById[entry.scholarshipId];
          const readiness = readinessFor(entry);
          const isTracked = readiness.route === 'external';
          const isDraft = entry.status === 'Draft' && !isTracked;
          // A rejected file the student can still swap (Submitted / Under Review /
          // For Verification) is the next thing they must do.
          const needsReplacement = !isTracked && getReplaceableRejectedDocuments(entry, documents).length > 0;
          return <article key={entry.id} className="application-result-card grid grid-rows-[auto_auto_1fr_auto] items-stretch gap-4 rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-app">
            <div className="flex min-w-0 items-start justify-between gap-4"><div className="min-w-0 flex-1"><h3>{entry.scholarshipTitle}</h3><p>{scholarship?.category || 'Scholarship'} · Updated {fmtDate(entry.updatedAt)}</p></div><StatusBadge className="max-w-full shrink-0" tone={isTracked ? 'neutral' : statusTone[entry.status] || 'info'}>{isTracked ? 'Tracked' : getApplicationStatusLabel(entry.status)}</StatusBadge></div>
            <div className="h-2 overflow-hidden rounded-full bg-app-muted-surface"><div className="h-full rounded-full bg-gradient-to-r from-ateneo-strong via-ateneo to-ateneo-bright" style={{ width: `${isDraft ? Math.round((readiness.attachedCount / Math.max(readiness.requiredCount, 1)) * 100) : getApplicationProgress(entry.status)}%` }} /></div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-app-border/60 pt-3 text-sm text-app-muted">
              {isTracked
                ? <span>Tracked only — apply through the provider.</span>
                : <><span><strong>Documents</strong> {readiness.attachedCount} of {readiness.requiredCount} attached</span>{isDraft ? <span><strong>Statement</strong> {String(entry.statement || '').trim() ? 'Written' : 'Not yet'}</span> : <span><strong>Progress</strong> {toPercent(getApplicationProgress(entry.status))}</span>}</>}
              <span><strong>Deadline</strong> {scholarship ? fmtDate(scholarship.deadline) : 'N/A'}</span>
            </div>
            <p className="m-0 text-sm text-app-muted">{needsReplacement ? 'Action needed: replace the rejected document so your application can continue.' : isDraft ? (readiness.requirements.some((item) => item.state === 'missing' || item.state === 'rejected') ? 'Next: attach the remaining required documents.' : 'Next: review your statement, certify, and submit.') : (isTracked ? entry.notes : getApplicationStatusGuidance(entry.status) || entry.notes)}</p>
            <div className="flex flex-wrap items-center gap-3 border-t border-app-border/60 pt-3">
              {isDraft
                ? <Button variant="primary" type="button" onClick={() => onOpenApplication(entry.id)}>Continue application</Button>
                : <Button variant={needsReplacement ? 'primary' : 'secondary'} type="button" onClick={() => setSelectedId(entry.id)}>View details</Button>}
              <button className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20" type="button" onClick={() => exportReport(entry)}>Export report</button>
            </div>
          </article>;
        }) : <EmptyState title={applications.length ? 'No matching applications' : 'No applications yet'} description={applications.length ? 'Try a different search or status filter.' : 'Start an application from the Scholarship Explorer.'} />}
      </div>
    </Card>

    {selected && selectedReadiness && (
      <ModalShell title={selected.scholarshipTitle} onClose={() => setSelectedId(null)} className="application-detail-modal">
        <div className="application-detail-modal-body grid content-start gap-4">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-app-muted"><span><strong>Status</strong> {selectedReadiness.route === 'external' ? 'Tracked' : getApplicationStatusLabel(selected.status)}</span><span><strong>Submitted</strong> {selected.submittedAt ? fmtDate(selected.submittedAt) : 'Not yet'}</span>{selected.certifiedAt ? <span><strong>Certified</strong> {fmtDate(selected.certifiedAt)}</span> : null}</div>
          {selectedReadiness.route !== 'external' && getApplicationStatusGuidance(selected.status) ? (
            <p className="m-0 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-app-text">
              {getApplicationStatusGuidance(selected.status)}
            </p>
          ) : null}
          {selectedReadiness.route === 'external' ? <p className="m-0 text-sm text-app-muted">{selected.notes}</p> : (
            <>
              {replaceableRejected.length ? (
                <Panel className="grid gap-3 !border-rose-400/40">
                  <div className="grid gap-1">
                    <h3 className="m-0 text-sm font-bold uppercase tracking-[0.1em] text-rose-600 dark:text-rose-300">Action needed</h3>
                    <p className="m-0 text-sm text-app-text">
                      The Admissions Office rejected {replaceableRejected.length === 1 ? 'a document' : `${replaceableRejected.length} documents`} on this application.
                      {' '}Replace {replaceableRejected.length === 1 ? 'it' : 'them'} so the review can continue.
                    </p>
                  </div>
                  {replaceableRejected.map((doc) => (
                    <RejectedDocumentReplacer
                      key={doc.id}
                      doc={doc}
                      options={getReplacementOptions({ application: selected, requirements: selectedReadiness.requirements, rejectedDocument: doc, documents })}
                      onReplace={(oldDocumentId, payload) => onReplaceDocument(selected.id, oldDocumentId, payload)}
                    />
                  ))}
                </Panel>
              ) : null}
              <Panel className="grid gap-2"><h3 className={sectionHeading}>Required documents</h3><RequirementChecklist requirements={selectedReadiness.requirements} onPreview={setPreview} renderAttachmentNote={renderAttachmentNote} /></Panel>
              <Panel className="grid gap-2"><h3 className={sectionHeading}>Supporting documents</h3><SupportingDocumentList documents={selectedReadiness.supportingDocuments} onPreview={setPreview} renderAttachmentNote={renderAttachmentNote} /></Panel>
              <Panel className="grid gap-2"><h3 className={sectionHeading}>Statement</h3><p className="m-0 whitespace-pre-line text-sm text-app-text">{selected.statement || 'No statement recorded.'}</p></Panel>
              <Panel className="grid gap-1"><h3 className={sectionHeading}>Profile snapshot</h3><ProfileSnapshotList snapshot={selected.profileSnapshot} applicantPhoto={getApplicantPhotoDocument(selected, documents)} onPreviewPhoto={setPreview} /></Panel>
              <Panel className="grid gap-2">
                <h3 className={sectionHeading}>Status history</h3>
                {/* The student sees the actor's role (their profile read is scoped
                    to their own row, so a reviewer's name cannot be resolved). */}
                <StatusHistoryList statusLog={selected.statusLog} timeline={selected.timeline} />
              </Panel>
            </>
          )}
        </div>
      </ModalShell>
    )}

    {workspaceApplication && (
      <ApplicationWorkspaceModal
        key={workspaceApplication.id}
        application={workspaceApplication}
        scholarship={scholarshipById[workspaceApplication.scholarshipId]}
        documents={documents}
        profile={profile}
        attributeVerifications={attributeVerifications}
        onAttach={onAttach}
        onDetach={onDetach}
        onUploadAndAttach={onUploadAndAttach}
        onSaveDraft={onSaveDraft}
        onSubmit={onSubmit}
        onSaveProfile={onSaveProfile}
        onOpenProfile={onOpenProfile}
        onClose={() => onOpenApplication(null)}
      />
    )}
    {preview ? <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} /> : null}
  </div>;
}
