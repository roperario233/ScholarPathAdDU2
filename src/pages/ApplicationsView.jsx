import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Award, CalendarClock, CircleAlert, FileEdit, Eye, Hourglass, Search, TriangleAlert } from 'lucide-react';
import { Card, EmptyState } from '../components/pageParts';
import { Button, ModalShell, Panel, StatusBadge } from '../components/ui';
import ApplicationPrintButton from '../components/ApplicationPrintSheet';
import ApplicationWorkspaceModal from '../components/ApplicationWorkspaceModal';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import StudentInterviewCard from '../components/StudentInterviewCard';
import { DocumentDecisionRecord, DocumentRejectionReason, ProfileSnapshotList, RejectedDocumentReplacer, RequirementChecklist, StatusHistoryList, SupportingDocumentList } from '../components/ApplicationParts';
import { applyLiveVerificationsToSnapshot, buildProfileSnapshot, getApplicantPhotoDocument, getApplicationAttributeVerifications, getApplicationLiveAttributeVerifications, getApplicationReadiness, getReplacementOptions, getReplaceableRejectedDocuments, getResidencePhotoDocuments } from '../lib/applicationRequirements';
import { DOCUMENT_REPLACEMENT_STATUSES, applicationStatuses, getApplicationStatusGuidance, getApplicationStatusLabel, getDocumentTypeLabel } from '../lib/constants';
import { getApplicationProgress, isAdduInternalProgram } from '../lib/eligibility';
import { fmtDate, toPercent } from '../lib/formatters';
import { getFinancialDetailSections } from '../lib/financialDetails';
import { summarizeInterview } from '../lib/interview';

const statusTone = { Approved: 'success', Rejected: 'danger', Draft: 'neutral', Submitted: 'info', 'Under Review': 'info', 'For Verification': 'warning', 'For Endorsement': 'warning', Endorsed: 'warning', Interview: 'info', Recommended: 'info', 'Under deliberation': 'warning', Released: 'success' };

const sectionHeading = 'm-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted';

// The card's accent bar and progress fill follow where the application stands.
const statusAccent = {
  success: { bar: 'before:bg-emerald-500', fill: 'from-emerald-600 via-emerald-500 to-emerald-400' },
  danger: { bar: 'before:bg-rose-500', fill: 'from-rose-600 via-rose-500 to-rose-400' },
  warning: { bar: 'before:bg-amber-500', fill: 'from-amber-600 via-amber-500 to-amber-400' },
  info: { bar: 'before:bg-blue-500', fill: 'from-ateneo-strong via-ateneo to-ateneo-bright' },
  neutral: { bar: 'before:bg-slate-400', fill: 'from-slate-500 via-slate-400 to-slate-300' },
};

function ApplicationMetric({ icon: Icon, label, value, note, tone }) {
  return (
    <article className="page-metric relative overflow-hidden rounded-app border bg-app-card p-4 shadow-app backdrop-blur">
      <div className={`absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl ${tone}`} aria-hidden="true"><Icon size={18} /></div>
      <span className="pr-12 text-xs font-semibold">{label}</span>
      <strong className="!text-3xl">{value}</strong>
      <p className="text-xs">{note}</p>
    </article>
  );
}

export default function ApplicationsView({
  applications,
  documents,
  scholarships,
  profile,
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
  financialAnswersByApplication = {},
  financialSnapshotsByApplication = {},
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);

  const scholarshipById = useMemo(() => Object.fromEntries(scholarships.map((entry) => [entry.id, entry])), [scholarships]);
  const readinessFor = (entry) => getApplicationReadiness({ application: entry, scholarship: scholarshipById[entry.scholarshipId], documents, profile, financialAnswers: financialAnswersByApplication[entry.id] });

  const filtered = useMemo(() => applications.filter((entry) => {
    const matchesQuery = !query.trim() || entry.scholarshipTitle.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (status === 'all' || entry.status === status);
  }), [applications, query, status]);
  const selected = applications.find((entry) => entry.id === selectedId);
  // Only an AdDU internal draft opens the workspace; external entries are tracked.
  const workspaceApplication = applications.find((entry) => (
    entry.id === openApplicationId && entry.status === 'Draft' && isAdduInternalProgram(scholarshipById[entry.scholarshipId])
  ));

  const selectedReadiness = selected ? readinessFor(selected) : null;

  // What the student may read of an application's office-only financial details:
  // the answers they wrote and the financial profile frozen when they submitted
  // (their current profile while the application is still a Draft).
  const financialSectionsFor = (entry) => getFinancialDetailSections({
    financialProfile: financialSnapshotsByApplication[entry.id] || (entry.status === 'Draft' ? profile?.financialProfile : null),
    answers: financialAnswersByApplication[entry.id],
    family: entry.profileSnapshot?.family || profile?.familyDetails || {},
  });

  // The frozen snapshot with its badges read from the attached files now, so a
  // file the Admissions Office verified after submission stops reading Pending.
  const liveSnapshotFor = (entry) => (entry.profileSnapshot
    ? applyLiveVerificationsToSnapshot(entry.profileSnapshot, getApplicationLiveAttributeVerifications(entry, documents, { profile }))
    : null);

  // The printable application: the frozen snapshot once submitted, otherwise the
  // current profile exactly as a submission would freeze it.
  const printSheetFor = (entry, readiness) => ({
    application: entry,
    snapshot: liveSnapshotFor(entry) || buildProfileSnapshot(profile, getApplicationAttributeVerifications(entry, documents, profile)),
    financialSections: financialSectionsFor(entry),
    statement: entry.statement,
    applicantPhoto: getApplicantPhotoDocument(entry, documents),
    residencePhotos: getResidencePhotoDocuments(entry, documents),
  });

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

  // Summary tiles. Tracked-only entries have no workspace, so they stay out of the counts.
  const summary = applications.reduce((acc, entry) => {
    if (readinessFor(entry).route === 'external') return acc;
    if (entry.status === 'Draft') acc.drafts += 1;
    else if (entry.status === 'Approved' || entry.status === 'Released') acc.decided += 1;
    else if (entry.status !== 'Rejected') acc.inReview += 1;
    if (getReplaceableRejectedDocuments(entry, documents).length) acc.actionNeeded += 1;
    return acc;
  }, { drafts: 0, inReview: 0, actionNeeded: 0, decided: 0 });

  return <div className="blue-action-view grid gap-4">
    <section className="page-title-bar relative rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
      <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-blue-500/10 blur-2xl" aria-hidden="true" />
      <div className="page-title-copy relative">
        <span className="page-section-label">Application workspace</span>
        <h2>Track every application in one place</h2>
        <p className="mt-2 max-w-2xl text-sm text-app-muted">Attach the required documents, submit, and follow each step of the Standard Procedure.</p>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <ApplicationMetric icon={FileEdit} label="Drafts" value={summary.drafts} note="Ready to continue" tone="bg-slate-500/15 text-slate-700 dark:text-slate-300" />
      <ApplicationMetric icon={Hourglass} label="In review" value={summary.inReview} note="With the Admissions Office" tone="bg-blue-500/15 text-blue-700 dark:text-blue-300" />
      <ApplicationMetric icon={TriangleAlert} label="Action needed" value={summary.actionNeeded} note="Files to replace" tone="bg-rose-500/15 text-rose-700 dark:text-rose-300" />
      <ApplicationMetric icon={Award} label="Approved or released" value={summary.decided} note="Results are in" tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" />
    </section>

    <Card title="Your applications" className="application-list-card">
      <div className="grid gap-4 rounded-2xl border border-app-border bg-app-surface/60 p-3 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-4"><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Find an application</span><span className="relative block"><Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-app-muted" aria-hidden="true" /><input className="!pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search applications" aria-label="Search applications" /></span></label><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Application status</span><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter applications by status"><option value="all">All statuses</option>{applicationStatuses.map((item) => <option key={item} value={item}>{getApplicationStatusLabel(item)}</option>)}</select></label></div>
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
          const accent = statusAccent[isTracked ? 'neutral' : statusTone[entry.status] || 'info'] || statusAccent.info;
          const progress = isDraft ? Math.round((readiness.attachedCount / Math.max(readiness.requiredCount, 1)) * 100) : getApplicationProgress(entry.status);
          const nextStep = needsReplacement
            ? 'Action needed: replace the file that was reverted for resubmission so your application can continue.'
            : isDraft
              ? (readiness.requirements.some((item) => item.state === 'missing' || item.state === 'rejected') ? 'Next: attach the remaining required documents.' : 'Next: review your statement, certify, and submit.')
              : (isTracked ? entry.notes : getApplicationStatusGuidance(entry.status) || entry.notes);
          return <article key={entry.id} className={`application-result-card relative grid items-stretch gap-4 overflow-hidden rounded-2xl border border-app-border bg-app-surface p-5 pl-6 shadow-sm transition before:absolute before:inset-y-0 before:left-0 before:w-1.5 hover:-translate-y-0.5 hover:shadow-app ${accent.bar}`}>
            <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div className="min-w-0 w-full flex-1"><h3>{entry.scholarshipTitle}</h3><p>{scholarship?.category || 'Scholarship'} · Updated {fmtDate(entry.updatedAt)}</p></div><StatusBadge className="max-w-full shrink-0" tone={isTracked ? 'neutral' : statusTone[entry.status] || 'info'}>{isTracked ? 'Tracked' : getApplicationStatusLabel(entry.status)}</StatusBadge></div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-app-muted"><span>{isDraft ? 'Documents attached' : 'Progress'}</span><span>{toPercent(progress)}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-app-muted-surface" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label={`${entry.scholarshipTitle} progress`}><div className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ${accent.fill}`} style={{ width: `${progress}%` }} /></div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-app-muted">
              {isTracked
                ? <span className="rounded-full bg-app-muted-surface px-3 py-1">Tracked only — apply through the provider.</span>
                : <><span className="rounded-full bg-app-muted-surface px-3 py-1"><strong className="text-app-text">Documents</strong> {readiness.attachedCount} of {readiness.requiredCount} attached</span>{isDraft ? <span className="rounded-full bg-app-muted-surface px-3 py-1"><strong className="text-app-text">Statement</strong> {String(entry.statement || '').trim() ? 'Written' : 'Not yet'}</span> : null}</>}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-app-muted-surface px-3 py-1"><CalendarClock size={12} aria-hidden="true" /><strong className="text-app-text">Deadline</strong> {scholarship ? fmtDate(scholarship.deadline) : 'N/A'}</span>
            </div>
            {nextStep ? (
              needsReplacement
                ? <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-app-text"><CircleAlert size={16} className="mt-0.5 shrink-0 text-rose-500" aria-hidden="true" /><span className="min-w-0">{nextStep}</span></p>
                : <p className="m-0 text-sm text-app-muted">{nextStep}</p>
            ) : null}
            {entry.status === 'Interview' && entry.interview ? (
              <p className="m-0 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-app-text">Interview: {summarizeInterview(entry.interview)}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 border-t border-app-border/60 pt-3">
              {isDraft
                ? <Button variant="primary" type="button" className="gap-2" onClick={() => onOpenApplication(entry.id)}>Continue application<ArrowRight size={16} aria-hidden="true" /></Button>
                : <Button variant={needsReplacement ? 'primary' : 'secondary'} type="button" className="gap-2" onClick={() => setSelectedId(entry.id)}><Eye size={16} aria-hidden="true" />View details</Button>}
              {isTracked ? null : <ApplicationPrintButton label="Print" sheet={printSheetFor(entry, readiness)} />}
            </div>
          </article>;
        }) : <EmptyState title={applications.length ? 'No matching applications' : 'No applications yet'} description={applications.length ? 'Try a different search or status filter.' : 'Start an application from the Scholarship Explorer.'} />}
      </div>
    </Card>

    {selected && selectedReadiness && (
      <ModalShell
        title={selected.scholarshipTitle}
        onClose={() => setSelectedId(null)}
        className="application-detail-modal"
        header={(
          <div className="card-header mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 min-w-0 flex-1">{selected.scholarshipTitle}</h2>
            <div className="flex shrink-0 items-center gap-2">
              {selectedReadiness.route === 'external' ? null : <ApplicationPrintButton sheet={printSheetFor(selected, selectedReadiness)} />}
              <Button variant="secondary" type="button" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
        )}
      >
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
                      The Admissions Office reverted {replaceableRejected.length === 1 ? 'a document' : `${replaceableRejected.length} documents`} for resubmission on this application.
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
              {selected.interview ? <StudentInterviewCard application={selected} scholarshipTitle={selected.scholarshipTitle} /> : null}
              <Panel className="grid gap-2"><h3 className={sectionHeading}>Required documents</h3><RequirementChecklist requirements={selectedReadiness.requirements} onPreview={setPreview} renderAttachmentNote={renderAttachmentNote} /></Panel>
              <Panel className="grid gap-2"><h3 className={sectionHeading}>Supporting documents</h3><SupportingDocumentList documents={selectedReadiness.supportingDocuments} onPreview={setPreview} renderAttachmentNote={renderAttachmentNote} /></Panel>
              <Panel className="grid gap-2"><h3 className={sectionHeading}>Statement</h3><p className="m-0 whitespace-pre-line text-sm text-app-text">{selected.statement || 'No statement recorded.'}</p></Panel>
              <Panel className="grid gap-1"><h3 className={sectionHeading}>Profile snapshot</h3><ProfileSnapshotList snapshot={liveSnapshotFor(selected)} applicantPhoto={getApplicantPhotoDocument(selected, documents)} onPreviewPhoto={setPreview} extraSections={financialSectionsFor(selected)} /></Panel>
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
        financialAnswers={financialAnswersByApplication[workspaceApplication.id]}
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
