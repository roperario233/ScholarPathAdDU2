import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Award, Bell, CalendarClock, Check, CheckCircle2, CircleAlert, ClipboardList, FileEdit, FileText, Eye, History as HistoryIcon, Hourglass, Info, Paperclip, PenLine, ShieldCheck, TriangleAlert, UserRound, Users, X } from 'lucide-react';
import { Card, EmptyState, SummaryCards } from '../components/pageParts';
import { Button, ModalShell, Panel, StatusBadge } from '../components/ui';
import ListToolbar from '../components/ListToolbar';
import { SkeletonRegion, SkeletonText } from '../components/Skeleton';
import ApplicationPrintButton from '../components/ApplicationPrintSheet';
import ApplicationWorkspaceModal from '../components/ApplicationWorkspaceModal';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import StudentInterviewCard from '../components/StudentInterviewCard';
import ReasonModal from '../components/ReasonModal';
import DocumentRequestResponder from '../components/DocumentRequestResponder';
import { DocumentDecisionRecord, DocumentRejectionReason, ProfileSnapshotList, RejectedDocumentReplacer, RequirementChecklist, SopStageTrack, StatusHistoryList, SupportingDocumentList } from '../components/ApplicationParts';
import { spotlightRow } from '../components/MovedCaseNotice';
import { applyLiveVerificationsToSnapshot, buildProfileSnapshot, getApplicantPhotoDocument, getApplicationAttributeVerifications, getApplicationLiveAttributeVerifications, getApplicationReadiness, getReplacementOptions, getReplaceableRejectedDocuments, getResidencePhotoDocuments } from '../lib/applicationRequirements';
import { describeGrantAmount, getGrantAmountForApplication } from '../lib/grantAmount';
import { canRequestDocuments, getOpenDocumentRequests, getRequestFulfilmentOptions } from '../lib/documentRequests';
import { DOCUMENT_REPLACEMENT_STATUSES, getApplicationStatusGuidance, getApplicationStatusLabel, getDocumentTypeLabel, getStudentApplicationStatusLabel, sopStageIndex, sopStages, studentApplicationStatuses } from '../lib/constants';
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

// A detail-modal section title: the usual small-caps heading with a tinted icon.
function SectionHeading({ icon: Icon, children }) {
  return (
    <h3 className={`${sectionHeading} flex items-center gap-2`}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300" aria-hidden="true"><Icon size={14} /></span>
      {children}
    </h3>
  );
}

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
const NEXT_STEPS = [
  { icon: ShieldCheck, title: 'Document verification', text: 'The Admissions Office verifies your documents. If a file needs correcting, you are asked to replace it.' },
  { icon: Users, title: 'Interview', text: 'An interviewer from your school schedules your interview.' },
  { icon: Award, title: 'School decision', text: 'Your school decides. Results are released to every applicant at the same time.' },
];

function SubmittedConfirmation({ application, onClose }) {
  const stageIndex = Math.max(0, sopStageIndex(application.status === 'Draft' ? 'Submitted' : application.status) ?? 0);
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
      <div className="application-detail-modal-body grid content-start gap-4 !pr-0 ![scrollbar-gutter:auto]" role="status" aria-live="polite">
        <div className="relative overflow-hidden rounded-2xl border border-emerald-400/40 bg-gradient-to-b from-emerald-500/15 via-emerald-500/5 to-transparent px-4 py-6 text-center">
          <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-36 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-emerald-400/30 blur-3xl" />
          <div className="relative mx-auto grid h-16 w-16 place-items-center">
            <span aria-hidden="true" className="submitted-ring absolute inset-0 rounded-full bg-emerald-400/40" />
            <span className="submitted-badge relative grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-600/30 ring-4 ring-emerald-400/20">
              <Check size={30} strokeWidth={3} aria-hidden="true" />
            </span>
          </div>
          <h3 className="submitted-rise relative m-0 mt-4 text-xl font-bold text-app-text" style={{ '--rise-delay': '120ms' }}>Application submitted</h3>
          <p className="submitted-rise relative m-0 mt-1 text-sm text-app-muted" style={{ '--rise-delay': '180ms' }}>
            Submitted {fmtDate(application.submittedAt || application.updatedAt)}. It is now locked for review.
          </p>
        </div>

        <section className="submitted-rise grid gap-2" style={{ '--rise-delay': '240ms' }} aria-labelledby="submitted-sent-heading">
          <h4 id="submitted-sent-heading" className={sectionHeading}>Sent to the Admissions Office</h4>
          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
            {[
              { icon: FileText, value: sharedCount, label: sharedCount === 1 ? 'Document' : 'Documents' },
              { icon: PenLine, value: <Check size={18} strokeWidth={3} aria-hidden="true" />, label: 'Statement' },
              { icon: ClipboardList, value: <Check size={18} strokeWidth={3} aria-hidden="true" />, label: 'Form answers' },
            ].map(({ icon: Icon, value, label }) => (
              <li key={label} className="grid min-w-0 justify-items-center gap-1 rounded-2xl border border-app-border bg-app-surface px-2 py-3 text-center">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300" aria-hidden="true"><Icon size={18} /></span>
                <strong className="flex h-6 items-center text-lg leading-none text-app-text">{value}</strong>
                <span className="text-xs font-medium text-app-muted [overflow-wrap:anywhere]">{label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="submitted-rise grid gap-2" style={{ '--rise-delay': '300ms' }}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h4 className={sectionHeading}>Where it stands</h4>
            <span className="text-xs font-semibold text-app-text">
              Stage {stageIndex + 1} of {sopStages.length} · {getApplicationStatusLabel(sopStages[stageIndex])}
            </span>
          </div>
          <ol className="m-0 grid list-none auto-cols-fr grid-flow-col gap-1 p-0" aria-label="Standard Procedure stage track">
            {sopStages.map((stage, index) => (
              <li
                key={stage}
                title={getApplicationStatusLabel(stage)}
                aria-current={index === stageIndex ? 'step' : undefined}
                className={`h-2 rounded-full ${index < stageIndex ? 'bg-emerald-500' : index === stageIndex ? 'bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.65)] dark:bg-sky-400' : 'bg-app-border'}`}
              >
                <span className="sr-only">{getApplicationStatusLabel(stage)}</span>
              </li>
            ))}
          </ol>
        </section>

        <Panel className="submitted-rise grid gap-3 text-sm" style={{ '--rise-delay': '360ms' }}>
          <h4 className={sectionHeading}>What happens next</h4>
          <ol className="m-0 grid list-none gap-0 p-0">
            {NEXT_STEPS.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="relative flex min-w-0 gap-3 pb-4 last:pb-0">
                {index < NEXT_STEPS.length - 1 ? <span aria-hidden="true" className="absolute left-4 top-9 bottom-1 w-px -translate-x-1/2 bg-app-border" /> : null}
                <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300" aria-hidden="true"><Icon size={15} /></span>
                <div className="grid min-w-0 gap-0.5">
                  <strong className="text-sm text-app-text">{title}</strong>
                  <p className="m-0 text-app-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="m-0 flex items-start gap-2 rounded-xl bg-app-surface px-3 py-2 text-xs text-app-muted">
            <Bell size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="min-w-0">You are notified at each step, through the channels you chose in Settings.</span>
          </p>
        </Panel>

        <div className="flex">
          <Button className="w-full sm:ml-auto sm:w-auto" variant="primary" type="button" onClick={onClose}>Back to my applications</Button>
        </div>
      </div>
    </ModalShell>
  );
}

const APPLICATION_SORTS = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Scholarship A–Z' },
  { value: 'stage', label: 'Furthest along first' },
];

const applicationTime = (entry) => {
  const time = Date.parse(entry?.updatedAt || entry?.submittedAt || '');
  return Number.isFinite(time) ? time : 0;
};

const APPLICATION_SORTERS = {
  recent: (left, right) => applicationTime(right) - applicationTime(left),
  oldest: (left, right) => applicationTime(left) - applicationTime(right),
  name: (left, right) => String(left.scholarshipTitle || '').localeCompare(String(right.scholarshipTitle || ''), undefined, { sensitivity: 'base' }),
  stage: (left, right) => (getApplicationProgress(right.status) - getApplicationProgress(left.status)) || (applicationTime(right) - applicationTime(left)),
};

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
  // Additional documents the Admissions Office asked for while the application is at
  // document verification (application_document_requests, the student's own rows),
  // and the answer that links the chosen files.
  documentRequests = [],
  onFulfillDocumentRequest,
  // Opens the privacy documents over the workspace instead of navigating away from a
  // half-finished draft.
  onOpenPrivacyDocument = null,
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('recent');
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  // The application just submitted (its confirmation is open), the card to glow
  // once that confirmation closes, and the last reverted file replaced in the
  // details view (the Action needed panel disappears with the last one, so the
  // confirmation lives apart from it).
  const [submittedId, setSubmittedId] = useState(null);
  const [spotlightId, setSpotlightId] = useState(null);
  const [replacedNote, setReplacedNote] = useState(null);
  // The last request answered in the details view (its panel disappears with it).
  const [requestNote, setRequestNote] = useState(null);
  // The decline / withdraw dialogs ({ applicationId, kind }).
  const [responseDialog, setResponseDialog] = useState(null);
  const offerFor = (entry) => getOfferForApplication(scholarshipOffers, entry.id);
  // The Admin's open requests for one application; they exist only at verification.
  const openRequestsFor = (entry) => (
    onFulfillDocumentRequest && canRequestDocuments(entry.status) ? getOpenDocumentRequests(documentRequests, entry.id) : []
  );
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
  }).sort(APPLICATION_SORTERS[sort] || APPLICATION_SORTERS.recent), [applications, query, status, sort]);
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
    // The declared household income travels with the frozen snapshot; a Draft reads
    // the live profile answer.
    householdIncome: entry.profileSnapshot?.householdIncome ?? (entry.status === 'Draft' ? profile?.householdIncome : undefined),
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
    setRequestNote(null);
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
  const selectedOpenRequests = selected ? openRequestsFor(selected) : [];
  const answerRequest = async (requestId, payload) => {
    const request = selectedOpenRequests.find((entry) => entry.id === requestId);
    const result = await onFulfillDocumentRequest(requestId, payload);
    if (!result?.error && request) setRequestNote({ applicationId: request.applicationId, label: request.label, count: result.count || 0 });
    return result;
  };
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
    if (getReplaceableRejectedDocuments(entry, documents).length || awaitsAnswer(entry) || openRequestsFor(entry).length) acc.actionNeeded += 1;
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

    <SummaryCards label="Application totals">
      <ApplicationMetric icon={FileEdit} label="Drafts" value={summary.drafts} note="Ready to continue" tone="bg-slate-500/15 text-slate-700 dark:text-slate-300" />
      <ApplicationMetric icon={Hourglass} label="In review" value={summary.inReview} note="With the Admissions Office" tone="bg-blue-500/15 text-blue-700 dark:text-blue-300" />
      <ApplicationMetric icon={TriangleAlert} label="Action needed" value={summary.actionNeeded} note="Files to replace or awards to confirm" tone="bg-rose-500/15 text-rose-700 dark:text-rose-300" />
      <ApplicationMetric icon={Award} label="Accepted" value={summary.decided} note="Results are in" tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" />
    </SummaryCards>

    <Card title="Your applications" className="application-list-card">
      <ListToolbar
        name="application-status"
        legend="Filter applications by status"
        chips={[
          { value: 'all', label: 'All applications', count: applications.length },
          ...filterStatuses.map((item) => ({
            value: item,
            label: getStudentApplicationStatusLabel(item),
            count: applications.filter((entry) => entry.status === item).length,
          })),
        ]}
        status={status}
        onStatusChange={setStatus}
        query={query}
        onQueryChange={setQuery}
        searchLabel="Search applications"
        searchPlaceholder="Search applications"
        sorts={APPLICATION_SORTS}
        sort={sort}
        onSortChange={setSort}
        onReset={query || status !== 'all' || sort !== 'recent' ? () => { setQuery(''); setStatus('all'); setSort('recent'); } : null}
      />
      <div className="mt-5 flex items-center justify-between gap-3 border-b border-app-border/70 px-1 pb-3"><p className="m-0 text-sm font-semibold text-app-text">{filtered.length} {filtered.length === 1 ? 'application' : 'applications'} found</p><span className="text-xs text-app-muted">Attach the required documents, then submit</span></div>
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
          const openRequestCount = isTracked ? 0 : openRequestsFor(entry).length;
          const offer = needsAnswer ? offerFor(entry) : null;
          const nextStep = needsReplacement
            ? 'Action needed: replace the file that was reverted for resubmission so your application can continue.'
            : openRequestCount
              ? `Action needed: the Admissions Office asked for ${openRequestCount === 1 ? 'additional documents' : `${openRequestCount} sets of additional documents`}. Open your application to send them.`
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
                : needsReplacement || openRequestCount
                ? <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-app-text"><CircleAlert size={16} className="mt-0.5 shrink-0 text-rose-500" aria-hidden="true" /><span className="min-w-0">{nextStep}</span></p>
                : <p className="m-0 text-sm text-app-muted">{nextStep}</p>
            ) : null}
            {entry.status === 'Interview' && entry.interview ? (
              <p className="m-0 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-app-text">Interview: {summarizeInterview(entry.interview)}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 border-t border-app-border/60 pt-3">
              {isDraft
                ? <Button variant="primary" type="button" className="gap-2" onClick={() => onOpenApplication(entry.id)}>Continue application<ArrowRight size={16} aria-hidden="true" /></Button>
                : <Button variant={needsReplacement || needsAnswer || openRequestCount ? 'primary' : 'secondary'} type="button" className="gap-2" onClick={() => setSelectedId(entry.id)}><Eye size={16} aria-hidden="true" />{needsAnswer ? 'Answer the offer' : 'View details'}</Button>}
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
          <div className="grid gap-3 rounded-2xl border border-app-border bg-app-surface p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-app-muted">
              <StatusBadge tone={selectedReadiness.route === 'external' ? 'neutral' : statusTone[selected.status] || 'neutral'} className="!px-3.5 !py-1 !text-sm">
                {selectedReadiness.route === 'external' ? 'Tracked' : getStudentApplicationStatusLabel(selected.status)}
              </StatusBadge>
              <span className="inline-flex items-center gap-1.5"><CalendarClock size={14} aria-hidden="true" /><strong className="font-semibold text-app-text">Submitted</strong> {selected.submittedAt ? fmtDate(selected.submittedAt) : 'Not yet'}</span>
              {selected.certifiedAt ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} aria-hidden="true" /><strong className="font-semibold text-app-text">Certified</strong> {fmtDate(selected.certifiedAt)}</span> : null}
            </div>
            {selectedReadiness.route !== 'external' && sopStageIndex(selected.status) != null ? <SopStageTrack status={selected.status} /> : null}
          </div>
          {selectedReadiness.route !== 'external' && getApplicationStatusGuidance(selected.status) ? (
            <p className="m-0 flex items-start gap-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-sm text-app-text">
              <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-300" />
              <span className="min-w-0">{getApplicationStatusGuidance(selected.status)}</span>
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
              {requestNote && requestNote.applicationId === selected.id ? (
                <div className="stage-outcome-enter flex min-w-0 items-start justify-between gap-3 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-100" role="status">
                  <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <p className="m-0 min-w-0 flex-1">
                    Sent {requestNote.count} file{requestNote.count === 1 ? '' : 's'} for “{requestNote.label}”. {selectedOpenRequests.length ? 'Another request is still waiting for you.' : 'They are waiting for Admissions Office verification.'}
                  </p>
                  <button
                    type="button"
                    className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-current transition hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                    onClick={() => setRequestNote(null)}
                    aria-label="Dismiss sent documents message"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : null}
              {selectedOpenRequests.length ? (
                <Panel className="grid gap-3 !border-amber-400/40">
                  <div className="grid gap-1">
                    <h3 className="m-0 text-sm font-bold uppercase tracking-[0.1em] text-amber-700 dark:text-amber-300">Documents requested</h3>
                    <p className="m-0 text-sm text-app-text">
                      The Admissions Office asked for {selectedOpenRequests.length === 1 ? 'more documents' : 'more documents in several parts'} while it verifies your application. Send {selectedOpenRequests.length === 1 ? 'them' : 'each part'} so the review can continue.
                    </p>
                  </div>
                  {selectedOpenRequests.map((request) => (
                    <DocumentRequestResponder
                      key={request.id}
                      request={request}
                      candidates={getRequestFulfilmentOptions({ application: selected, request, documents })}
                      onFulfill={answerRequest}
                    />
                  ))}
                </Panel>
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
                  <SectionHeading icon={Award}>Grant amount</SectionHeading>
                  <strong className="text-base text-app-text">{describeGrantAmount(selectedGrantAmount)}</strong>
                  <p className="m-0 text-xs text-app-muted">A figure recorded for your grant. ScholarPath does not disburse funds; the Admissions Office will advise you on the next steps.</p>
                </Panel>
              ) : null}
              <Panel className="grid gap-2"><SectionHeading icon={FileText}>Required documents</SectionHeading><RequirementChecklist requirements={selectedReadiness.requirements} onPreview={setPreview} renderAttachmentNote={renderAttachmentNote} /></Panel>
              <Panel className="grid gap-2"><SectionHeading icon={Paperclip}>Supporting documents</SectionHeading><SupportingDocumentList documents={selectedReadiness.supportingDocuments} onPreview={setPreview} renderAttachmentNote={renderAttachmentNote} /></Panel>
              <Panel className="grid gap-2"><SectionHeading icon={PenLine}>Statement</SectionHeading><p className="m-0 whitespace-pre-line text-sm text-app-text">{selected.statement || 'No statement recorded.'}</p></Panel>
              <Panel className="grid gap-1"><SectionHeading icon={UserRound}>Profile snapshot</SectionHeading><ProfileSnapshotList snapshot={liveSnapshotFor(selected)} applicantPhoto={getApplicantPhotoDocument(selected, documents)} residencePhotos={getResidencePhotoDocuments(selected, documents)} onPreviewPhoto={setPreview} extraSections={financialSectionsFor(selected)} />{financialLoaded ? null : <SkeletonRegion label="Loading the financial details" className="pt-2"><SkeletonText lines={3} /></SkeletonRegion>}</Panel>
              <Panel className="grid gap-2">
                <SectionHeading icon={HistoryIcon}>Status history</SectionHeading>
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
        onOpenPrivacyDocument={onOpenPrivacyDocument}
      />
    )}
    {submittedApplication ? (
      <SubmittedConfirmation application={submittedApplication} onClose={closeSubmittedConfirmation} />
    ) : null}
    {preview ? <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} /> : null}
  </div>;
}
