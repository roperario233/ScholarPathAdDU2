import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Award, CalendarClock, CheckCircle2, CircleAlert, FileEdit, Eye, Hourglass, Search, TriangleAlert, X } from 'lucide-react';
import { Card, EmptyState } from '../components/pageParts';
import { Button, ModalShell, Panel, StatusBadge } from '../components/ui';
import { SkeletonRegion, SkeletonText } from '../components/Skeleton';
import ApplicationPrintButton from '../components/ApplicationPrintSheet';
import ApplicationWorkspaceModal from '../components/ApplicationWorkspaceModal';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import StudentInterviewCard from '../components/StudentInterviewCard';
import ReasonModal from '../components/ReasonModal';
import { DocumentDecisionRecord, DocumentRejectionReason, ProfileSnapshotList, RejectedDocumentReplacer, RequirementChecklist, SopStageTrack, StatusHistoryList, SupportingDocumentList } from '../components/ApplicationParts';
import { spotlightRow } from '../components/MovedCaseNotice';
import { applyLiveVerificationsToSnapshot, buildProfileSnapshot, getApplicantPhotoDocument, getApplicationAttributeVerifications, getApplicationLiveAttributeVerifications, getApplicationReadiness, getReplacementOptions, getReplaceableRejectedDocuments, getResidencePhotoDocuments } from '../lib/applicationRequirements';
import { describeGrantAmount, getGrantAmountForApplication } from '../lib/grantAmount';
import { DOCUMENT_REPLACEMENT_STATUSES, getApplicationStatusGuidance, getDocumentTypeLabel, getStudentApplicationStatusLabel, studentApplicationStatuses } from '../lib/constants';
import { getApplicationProgress, isAdduInternalProgram } from '../lib/eligibility';
import { fmtDate, toPercent } from '../lib/formatters';
import { getFinancialDetailSections } from '../lib/financialDetails';
import { summarizeInterview } from '../lib/interview';
import { OFFER_DECLINE_REASONS, getOfferForApplication, getOfferState, isOfferRoundClosed } from '../lib/resultsRound';

// A closed outcome (Not accepted, Processed, Declined) reads neutral rather than
// red: the office asked that a student never be told they were "rejected".
const statusTone = { Approved: 'success', Rejected: 'neutral', Processed: 'neutral', Declined: 'neutral', Draft: 'neutral', Submitted: 'info', 'Under Review': 'info', 'For Verification': 'warning', 'For Endorsement': 'warning', Endorsed: 'warning', Interview: 'info', Recommended: 'info', 'Under deliberation': 'warning', Waitlisted: 'warning', Released: 'success' };

// Statuses that end the application for the student.
const CLOSED_STUDENT_STATUSES = ['Rejected', 'Processed', 'Declined'];

const sectionHeading = 'm-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted';

// The card's accent bar and progress fill follow where the application stands.
const statusAccent = {
  success: { bar: 'before:bg-emerald-500', fill: 'from-emerald-600 via-emerald-500 to-emerald-400' },
  danger: { bar: 'before:bg-rose-500', fill: 'from-rose-600 via-rose-500 to-rose-400' },
  warning: { bar: 'before:bg-amber-500', fill: 'from-amber-600 via-amber-500 to-amber-400' },
  info: { bar: 'before:bg-blue-500', fill: 'from-ateneo-strong via-ateneo to-ateneo-bright' },
  neutral: { bar: 'before:bg-slate-400', fill: 'from-slate-500 via-slate-400 to-slate-300' },
};

// The accepted applicant's answer to the award, or the waitlisted applicant's
// way off the waitlist. A position on the waitlist is never shown.
function ResultResponsePanel({ application, offer, roundClosed, onConfirm, onDecline, onWithdraw }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (application.status === 'Waitlisted') {
    return (
      <Panel className="grid gap-2 !border-amber-400/40">
        <h3 className={sectionHeading}>Waitlist</h3>
        <p className="m-0 text-sm text-app-text">You may still be offered this scholarship if an accepted applicant declines. You will be notified if a slot opens for you.</p>
        {onWithdraw ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onWithdraw}>Withdraw from the waitlist…</Button>
          </div>
        ) : null}
      </Panel>
    );
  }
  if (application.status !== 'Released' || !offer) return null;
  const state = getOfferState(offer);
  const confirm = async () => {
    setBusy(true);
    setError('');
    const result = await onConfirm?.();
    setBusy(false);
    if (result?.error) setError(result.error);
  };
  return (
    <Panel className={`grid gap-2 ${state === 'confirmed' ? '!border-emerald-400/40' : '!border-blue-500/40'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionHeading}>Your award</h3>
        <StatusBadge tone={state === 'confirmed' ? 'success' : state === 'lapsed' ? 'warning' : 'info'}>
          {state === 'confirmed' ? 'Confirmed' : 'Awaiting your answer'}
        </StatusBadge>
      </div>
      {state === 'confirmed' ? (
        <p className="m-0 text-sm text-app-text">You confirmed this award{offer.respondedAt ? ` on ${fmtDate(offer.respondedAt)}` : ''}. The Admissions Office will advise you on the next steps.</p>
      ) : (
        <p className="m-0 text-sm text-app-text">
          {offer.origin === 'promotion' ? 'A slot opened and you were offered this scholarship from the waitlist. ' : 'You were accepted for this scholarship. '}
          {offer.confirmBy
            ? `Please confirm or decline by ${fmtDate(offer.confirmBy)}${state === 'lapsed' ? ' (the date has passed, so answer now or contact the Admissions Office)' : ''}.`
            : 'Please confirm or decline the award.'}
        </p>
      )}
      {roundClosed ? (
        <p className="m-0 text-xs text-app-muted">The results for this scholarship are closed. Contact the Admissions Office to change your answer.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {state !== 'confirmed' ? <Button type="button" variant="primary" disabled={busy} onClick={confirm}>{busy ? 'Saving…' : 'Confirm the award'}</Button> : null}
          <Button type="button" variant="secondary" disabled={busy} onClick={onDecline}>Decline the award…</Button>
        </div>
      )}
      {error ? <p className="m-0 text-sm text-rose-600 dark:text-rose-300" role="alert">{error}</p> : null}
    </Panel>
  );
}

function ApplicationMetric({ icon: Icon, label, value, note, tone }) {
  return (
    <article className="page-metric relative min-w-0 overflow-hidden rounded-app border bg-app-card p-3 shadow-app backdrop-blur sm:p-4">
      <div className={`absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg sm:right-4 sm:top-4 sm:h-10 sm:w-10 sm:rounded-xl ${tone}`} aria-hidden="true"><Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" /></div>
      <span className="pr-9 text-xs font-semibold sm:pr-12">{label}</span>
      <strong className="!text-2xl sm:!text-3xl">{value}</strong>
      <p className="text-[11px] leading-snug sm:text-xs">{note}</p>
    </article>
  );
}

// Shown the moment a submission is saved, in place of the workspace (which only
// renders a Draft): what was sent, where the application now stands, and what
// happens next. Closing it lands on the application's card, which glows.
function SubmittedConfirmation({ application, onClose }) {
  const sharedCount = Array.isArray(application.attachedDocuments) ? application.attachedDocuments.length : 0;
  return (
    <ModalShell
      title={application.scholarshipTitle}
      onClose={onClose}
      className="application-detail-modal !w-[min(640px,100%)]"
      header={(
        <div className="card-header mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 min-w-0 flex-1">{application.scholarshipTitle}</h2>
        </div>
      )}
    >
      <div className="stage-outcome-enter grid content-start gap-4" role="status" aria-live="polite">
        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4">
          <CheckCircle2 size={24} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <div className="grid min-w-0 gap-1">
            <h3 className="m-0 text-base font-bold text-app-text">Application submitted</h3>
            <p className="m-0 text-sm text-app-muted">
              Submitted {fmtDate(application.submittedAt || application.updatedAt)}. It is now locked for review.
            </p>
          </div>
        </div>
        <SopStageTrack status={application.status === 'Draft' ? 'Submitted' : application.status} />
        <Panel className="grid gap-2 text-sm">
          <h4 className={sectionHeading}>Sent to the Admissions Office</h4>
          <p className="m-0 text-app-text">
            {sharedCount} attached {sharedCount === 1 ? 'document' : 'documents'}, your statement, and your Application Form answers.
          </p>
        </Panel>
        <Panel className="grid gap-2 text-sm">
          <h4 className={sectionHeading}>What happens next</h4>
          <ol className="m-0 grid gap-1.5 pl-5 text-app-text">
            <li>The Admissions Office verifies your documents. If a file needs correcting, you are asked to replace it.</li>
            <li>An interviewer from your school schedules your interview.</li>
            <li>Your school decides. Results are released to every applicant at the same time.</li>
          </ol>
          <p className="m-0 text-xs text-app-muted">You are notified at each step, through the channels you chose in Settings.</p>
        </Panel>
        <div className="flex justify-end">
          <Button variant="primary" type="button" onClick={onClose}>Back to my applications</Button>
        </div>
      </div>
    </ModalShell>
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
  financialLoaded = true,
  // Recorded grant amounts. The database only returns a student's own row once a
  // results release covers the application, so a held result shows nothing here.
  grantAmounts = [],
  // Offers to the accepted applicants (scholarship_offers, the student's own rows)
  // and the releases, which say when a round was closed.
  scholarshipOffers = [],
  resultsReleases = [],
  onRespondToOffer,
  onWithdrawFromWaitlist,
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  // The application just submitted (its confirmation is open), the card to glow
  // once that confirmation closes, and the last reverted file replaced in the
  // details view (the Action needed panel disappears with the last one, so the
  // confirmation lives apart from it).
  const [submittedId, setSubmittedId] = useState(null);
  const [spotlightId, setSpotlightId] = useState(null);
  const [replacedNote, setReplacedNote] = useState(null);
  // The decline / withdraw dialogs ({ applicationId, kind }).
  const [responseDialog, setResponseDialog] = useState(null);
  const offerFor = (entry) => getOfferForApplication(scholarshipOffers, entry.id);
  // An accepted applicant still has to answer the offer.
  const awaitsAnswer = (entry) => {
    if (entry.status !== 'Released') return false;
    const offer = offerFor(entry);
    const state = getOfferState(offer);
    return Boolean(offer) && (state === 'pending' || state === 'lapsed') && !isOfferRoundClosed(offer, resultsReleases);
  };

  const scholarshipById = useMemo(() => Object.fromEntries(scholarships.map((entry) => [entry.id, entry])), [scholarships]);
  const readinessFor = (entry) => getApplicationReadiness({ application: entry, scholarship: scholarshipById[entry.scholarshipId], documents, profile, financialAnswers: financialAnswersByApplication[entry.id] });

  const filtered = useMemo(() => applications.filter((entry) => {
    const matchesQuery = !query.trim() || entry.scholarshipTitle.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (status === 'all' || entry.status === status);
  }), [applications, query, status]);
  // Only the statuses the student's own applications hold (plus the one chosen),
  // in pipeline order, so the filter never lists a word they cannot be shown.
  const filterStatuses = useMemo(() => {
    const present = new Set(applications.map((entry) => entry.status));
    if (status !== 'all') present.add(status);
    return studentApplicationStatuses.filter((item) => present.has(item));
  }, [applications, status]);
  const selected = applications.find((entry) => entry.id === selectedId);
  const submittedApplication = submittedId ? applications.find((entry) => entry.id === submittedId) : null;
  // Only an AdDU internal draft opens the workspace; external entries are tracked.
  const workspaceApplication = applications.find((entry) => (
    entry.id === openApplicationId && entry.status === 'Draft' && isAdduInternalProgram(scholarshipById[entry.scholarshipId])
  ));

  const selectedReadiness = selected ? readinessFor(selected) : null;
  const selectedGrantAmount = selected ? getGrantAmountForApplication(grantAmounts, selected.id) : null;

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
    // The application just submitted shows its confirmation instead of its
    // details (the workspace clears openApplicationId as it closes).
    if (!entry || entry.status === 'Draft' || entry.id === submittedId) return;
    setSelectedId(entry.id);
    onOpenApplication(null);
  }, [openApplicationId, applications, onOpenApplication, submittedId]);

  // The submitted application's card glows once its confirmation closes. The
  // effect waits for the list to render it (a Draft filter is widened first).
  useEffect(() => {
    if (!spotlightId) return undefined;
    const cleanup = spotlightRow(spotlightId, { onDone: () => setSpotlightId(null) });
    if (!cleanup) setSpotlightId(null);
    return cleanup || undefined;
  }, [spotlightId]);

  const closeSubmittedConfirmation = () => {
    // A Draft (or other) filter would hide the card that just became Submitted.
    if (status !== 'all' && status !== 'Submitted') setStatus('all');
    setSpotlightId(submittedId);
    setSubmittedId(null);
  };

  const closeDetails = () => {
    setSelectedId(null);
    setReplacedNote(null);
  };

  // A replacement makes its "Action needed" row disappear, so a confirmation
  // names the file that now stands in for the reverted one.
  const replaceDocument = async (applicationId, oldDocumentId, payload) => {
    const result = await onReplaceDocument(applicationId, oldDocumentId, payload);
    if (!result?.error) {
      const oldDoc = documents.find((doc) => doc.id === oldDocumentId);
      setReplacedNote({
        applicationId,
        oldTitle: oldDoc?.title || 'The reverted file',
        newDocumentId: result?.documentId || payload?.documentId || '',
      });
    }
    return result;
  };
  const replacedNewTitle = replacedNote?.newDocumentId
    ? documents.find((doc) => doc.id === replacedNote.newDocumentId)?.title || ''
    : '';

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
    else if (entry.status === 'Released') acc.decided += 1;
    else if (!CLOSED_STUDENT_STATUSES.includes(entry.status)) acc.inReview += 1;
    if (getReplaceableRejectedDocuments(entry, documents).length || awaitsAnswer(entry)) acc.actionNeeded += 1;
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

    <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
      <ApplicationMetric icon={FileEdit} label="Drafts" value={summary.drafts} note="Ready to continue" tone="bg-slate-500/15 text-slate-700 dark:text-slate-300" />
      <ApplicationMetric icon={Hourglass} label="In review" value={summary.inReview} note="With the Admissions Office" tone="bg-blue-500/15 text-blue-700 dark:text-blue-300" />
      <ApplicationMetric icon={TriangleAlert} label="Action needed" value={summary.actionNeeded} note="Files to replace or awards to confirm" tone="bg-rose-500/15 text-rose-700 dark:text-rose-300" />
      <ApplicationMetric icon={Award} label="Accepted" value={summary.decided} note="Results are in" tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" />
    </section>

    <Card title="Your applications" className="application-list-card">
      <div className="grid gap-4 rounded-2xl border border-app-border bg-app-surface/60 p-3 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-4"><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Find an application</span><span className="relative block"><Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-app-muted" aria-hidden="true" /><input className="!pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search applications" aria-label="Search applications" /></span></label><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Application status</span><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter applications by status"><option value="all">All statuses</option>{filterStatuses.map((item) => <option key={item} value={item}>{getStudentApplicationStatusLabel(item)}</option>)}</select></label></div>
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
          const needsAnswer = !isTracked && awaitsAnswer(entry);
          const offer = needsAnswer ? offerFor(entry) : null;
          const nextStep = needsReplacement
            ? 'Action needed: replace the file that was reverted for resubmission so your application can continue.'
            : needsAnswer
              ? `Action needed: confirm or decline your award${offer?.confirmBy ? ` by ${fmtDate(offer.confirmBy)}` : ''}.`
            : isDraft
              ? (readiness.requirements.some((item) => item.state === 'missing' || item.state === 'rejected') ? 'Next: attach the remaining required documents.' : 'Next: review your statement, certify, and submit.')
              : (isTracked ? entry.notes : getApplicationStatusGuidance(entry.status) || entry.notes);
          return <article key={entry.id} data-application-id={entry.id} className={`application-result-card relative grid items-stretch gap-4 overflow-hidden rounded-2xl border border-app-border bg-app-surface p-5 pl-6 shadow-sm transition before:absolute before:inset-y-0 before:left-0 before:w-1.5 hover:-translate-y-0.5 hover:shadow-app ${accent.bar}`}>
            <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div className="min-w-0 w-full flex-1"><h3>{entry.scholarshipTitle}</h3><p>{scholarship?.category || 'Scholarship'} · Updated {fmtDate(entry.updatedAt)}</p></div><StatusBadge className="max-w-full shrink-0" tone={isTracked ? 'neutral' : statusTone[entry.status] || 'info'}>{isTracked ? 'Tracked' : getStudentApplicationStatusLabel(entry.status)}</StatusBadge></div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-app-muted"><span>{isDraft ? 'Documents attached' : 'Progress'}</span><span>{toPercent(progress)}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-app-muted-surface" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label={`${entry.scholarshipTitle} progress`}><div className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ${accent.fill}`} style={{ width: `${progress}%` }} /></div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-app-muted">
              {isTracked
                ? <span className="rounded-full bg-app-muted-surface px-3 py-1">Tracked only — apply through the provider.</span>
                : <><span className="rounded-full bg-app-muted-surface px-3 py-1"><strong className="text-app-text">Documents</strong> {readiness.attachedCount} of {readiness.requiredCount} attached</span>{isDraft ? <span className="rounded-full bg-app-muted-surface px-3 py-1"><strong className="text-app-text">Statement</strong> {String(entry.statement || '').trim() ? 'Written' : 'Not yet'}</span> : null}{entry.openedByOfficeAt ? <span className="rounded-full bg-blue-500/10 px-3 py-1 font-semibold text-app-text">Opened by the Admissions Office</span> : null}</>}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-app-muted-surface px-3 py-1"><CalendarClock size={12} aria-hidden="true" /><strong className="text-app-text">Deadline</strong> {scholarship ? fmtDate(scholarship.deadline) : 'N/A'}</span>
            </div>
            {nextStep ? (
              needsAnswer
                ? <p className="m-0 flex items-start gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-app-text"><Award size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" /><span className="min-w-0">{nextStep}</span></p>
                : needsReplacement
                ? <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-app-text"><CircleAlert size={16} className="mt-0.5 shrink-0 text-rose-500" aria-hidden="true" /><span className="min-w-0">{nextStep}</span></p>
                : <p className="m-0 text-sm text-app-muted">{nextStep}</p>
            ) : null}
            {entry.status === 'Interview' && entry.interview ? (
              <p className="m-0 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-app-text">Interview: {summarizeInterview(entry.interview)}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 border-t border-app-border/60 pt-3">
              {isDraft
                ? <Button variant="primary" type="button" className="gap-2" onClick={() => onOpenApplication(entry.id)}>Continue application<ArrowRight size={16} aria-hidden="true" /></Button>
                : <Button variant={needsReplacement || needsAnswer ? 'primary' : 'secondary'} type="button" className="gap-2" onClick={() => setSelectedId(entry.id)}><Eye size={16} aria-hidden="true" />{needsAnswer ? 'Answer the offer' : 'View details'}</Button>}
              {isTracked ? null : <ApplicationPrintButton label="Print" sheet={printSheetFor(entry, readiness)} />}
            </div>
          </article>;
        }) : <EmptyState title={applications.length ? 'No matching applications' : 'No applications yet'} description={applications.length ? 'Try a different search or status filter.' : 'Start an application from the Scholarship Explorer.'} />}
      </div>
    </Card>

    {selected && selectedReadiness && (
      <ModalShell
        title={selected.scholarshipTitle}
        onClose={closeDetails}
        className="application-detail-modal"
        header={(
          <div className="card-header mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 min-w-0 flex-1">{selected.scholarshipTitle}</h2>
            <div className="flex shrink-0 items-center gap-2">
              {selectedReadiness.route === 'external' ? null : <ApplicationPrintButton sheet={printSheetFor(selected, selectedReadiness)} />}
              <Button variant="secondary" type="button" onClick={closeDetails}>Close</Button>
            </div>
          </div>
        )}
      >
        <div className="application-detail-modal-body grid content-start gap-4">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-app-muted"><span><strong>Status</strong> {selectedReadiness.route === 'external' ? 'Tracked' : getStudentApplicationStatusLabel(selected.status)}</span><span><strong>Submitted</strong> {selected.submittedAt ? fmtDate(selected.submittedAt) : 'Not yet'}</span>{selected.certifiedAt ? <span><strong>Certified</strong> {fmtDate(selected.certifiedAt)}</span> : null}</div>
          {selectedReadiness.route !== 'external' && getApplicationStatusGuidance(selected.status) ? (
            <p className="m-0 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-app-text">
              {getApplicationStatusGuidance(selected.status)}
            </p>
          ) : null}
          {selectedReadiness.route === 'external' ? <p className="m-0 text-sm text-app-muted">{selected.notes}</p> : (
            <>
              {replacedNote && replacedNote.applicationId === selected.id ? (
                <div className="stage-outcome-enter flex min-w-0 items-start justify-between gap-3 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-100" role="status">
                  <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <p className="m-0 min-w-0 flex-1">
                    Replaced “{replacedNote.oldTitle}”{replacedNewTitle ? ` with “${replacedNewTitle}”` : ''}. The new file is waiting for Admissions Office review{replaceableRejected.length ? '.' : ', and nothing else needs replacing.'}
                  </p>
                  <button
                    type="button"
                    className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-current transition hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                    onClick={() => setReplacedNote(null)}
                    aria-label="Dismiss replacement message"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : null}
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
                      onReplace={(oldDocumentId, payload) => replaceDocument(selected.id, oldDocumentId, payload)}
                    />
                  ))}
                </Panel>
              ) : null}
              <ResultResponsePanel
                application={selected}
                offer={offerFor(selected)}
                roundClosed={isOfferRoundClosed(offerFor(selected), resultsReleases)}
                onConfirm={onRespondToOffer ? () => onRespondToOffer(selected.id, 'confirmed') : undefined}
                onDecline={() => setResponseDialog({ applicationId: selected.id, kind: 'decline' })}
                onWithdraw={onWithdrawFromWaitlist ? () => setResponseDialog({ applicationId: selected.id, kind: 'withdraw' }) : undefined}
              />
              {selected.interview ? <StudentInterviewCard application={selected} scholarshipTitle={selected.scholarshipTitle} /> : null}
              {selectedGrantAmount ? (
                <Panel className="grid gap-2">
                  <h3 className={sectionHeading}>Grant amount</h3>
                  <strong className="text-base text-app-text">{describeGrantAmount(selectedGrantAmount)}</strong>
                  <p className="m-0 text-xs text-app-muted">A figure recorded for your grant. ScholarPath does not disburse funds; the Admissions Office will advise you on the next steps.</p>
                </Panel>
              ) : null}
              <Panel className="grid gap-2"><h3 className={sectionHeading}>Required documents</h3><RequirementChecklist requirements={selectedReadiness.requirements} onPreview={setPreview} renderAttachmentNote={renderAttachmentNote} /></Panel>
              <Panel className="grid gap-2"><h3 className={sectionHeading}>Supporting documents</h3><SupportingDocumentList documents={selectedReadiness.supportingDocuments} onPreview={setPreview} renderAttachmentNote={renderAttachmentNote} /></Panel>
              <Panel className="grid gap-2"><h3 className={sectionHeading}>Statement</h3><p className="m-0 whitespace-pre-line text-sm text-app-text">{selected.statement || 'No statement recorded.'}</p></Panel>
              <Panel className="grid gap-1"><h3 className={sectionHeading}>Profile snapshot</h3><ProfileSnapshotList snapshot={liveSnapshotFor(selected)} applicantPhoto={getApplicantPhotoDocument(selected, documents)} residencePhotos={getResidencePhotoDocuments(selected, documents)} onPreviewPhoto={setPreview} extraSections={financialSectionsFor(selected)} />{financialLoaded ? null : <SkeletonRegion label="Loading the financial details" className="pt-2"><SkeletonText lines={3} /></SkeletonRegion>}</Panel>
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

    {responseDialog ? (
      <ReasonModal
        title={responseDialog.kind === 'decline' ? 'Decline the award' : 'Withdraw from the waitlist'}
        label={responseDialog.kind === 'decline' ? 'Why are you declining?' : 'Why are you leaving the waitlist?'}
        hint={responseDialog.kind === 'decline'
          ? 'The Admissions Office offers your slot to the next applicant on the waitlist. You cannot undo this in ScholarPath.'
          : 'You will no longer be considered if a slot opens. You cannot undo this in ScholarPath.'}
        options={OFFER_DECLINE_REASONS}
        notesHint="Add details if you wish."
        confirmLabel={responseDialog.kind === 'decline' ? 'Decline the award' : 'Withdraw'}
        onConfirm={async (reason) => {
          const result = responseDialog.kind === 'decline'
            ? await onRespondToOffer?.(responseDialog.applicationId, 'declined', reason)
            : await onWithdrawFromWaitlist?.(responseDialog.applicationId, reason);
          if (result?.error) return result;
          setResponseDialog(null);
          return result;
        }}
        onClose={() => setResponseDialog(null)}
      />
    ) : null}

    {workspaceApplication && (
      <ApplicationWorkspaceModal
        key={workspaceApplication.id}
        application={workspaceApplication}
        scholarship={scholarshipById[workspaceApplication.scholarshipId]}
        documents={documents}
        profile={profile}
        financialAnswers={financialAnswersByApplication[workspaceApplication.id]}
        financialLoaded={financialLoaded}
        onAttach={onAttach}
        onDetach={onDetach}
        onUploadAndAttach={onUploadAndAttach}
        onSaveDraft={onSaveDraft}
        onSubmit={onSubmit}
        onSaveProfile={onSaveProfile}
        onOpenProfile={onOpenProfile}
        onClose={() => onOpenApplication(null)}
        onSubmitted={setSubmittedId}
      />
    )}
    {submittedApplication ? (
      <SubmittedConfirmation application={submittedApplication} onClose={closeSubmittedConfirmation} />
    ) : null}
    {preview ? <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} /> : null}
  </div>;
}
