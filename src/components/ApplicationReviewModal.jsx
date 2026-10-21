import { useEffect, useRef, useState } from 'react';
import { Button, ModalShell, Panel, StatusBadge } from './ui';
import DocumentPreviewModal, { DocumentPreview } from './DocumentPreviewModal';
import ReasonModal from './ReasonModal';
import VerifyDocumentModal from './VerifyDocumentModal';
import { DocumentVerificationItem, ProfileSnapshotList, RequirementStateBadge, SopStageTrack, StatusHistoryList } from './ApplicationParts';
import EndorsementCasePanel from './EndorsementCasePanel';
import EndorsementDecisionModal from './EndorsementDecisionModal';
import { AUTOMATIC_STAGE_STATUSES, getApplicationStatusLabel, getDocumentRejectionReasons, getDocumentTypeLabel, getNextApplicationStatuses, getStageActionLabel, isAdmissionsHeadRole, isAdmissionsReviewerRole, sopStageIndex } from '../lib/constants';
import { ENDORSEMENT_BLOCKED_STATUSES, areApplicationDocumentsVisible, areDocumentsReviewable, describeRequirementTypes, getApplicantPhotoDocument, getApplicationReadiness, getDocumentVerificationReadiness, getLinkedDocuments } from '../lib/applicationRequirements';
import { getAttributeVerificationLabel, getAttributeVerificationTone } from '../lib/verification';
import { fmtCurrency, fmtDate } from '../lib/formatters';

const TERMINAL_STATUSES = ['Released', 'Rejected'];
const WIDE_QUERY = '(min-width: 1024px)';

const statusTone = (status) => (['Released', 'Approved'].includes(status) ? 'success' : status === 'Rejected' ? 'danger' : 'info');
const verificationTone = (status) => (status === 'Verified' ? 'success' : status === 'Rejected' ? 'danger' : 'warning');
const sectionHeading = 'm-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted';

// The Documents tab previews inline only where the two panes sit side by side;
// on a phone the preview opens in its own modal instead.
function useIsWide() {
  const [isWide, setIsWide] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches
  ));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setIsWide(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return isWide;
}

function ReviewTabs({ tabs, active, onChange }) {
  const refs = useRef({});
  const focusTab = (index) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onChange(tab.key);
    refs.current[tab.key]?.focus();
  };
  return (
    <div role="tablist" aria-label="Application review sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-app-border">
      {tabs.map((tab, index) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(node) => { refs.current[tab.key] = node; }}
            type="button"
            role="tab"
            id={`review-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={`review-panel-${tab.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') { event.preventDefault(); focusTab(index + 1); }
              if (event.key === 'ArrowLeft') { event.preventDefault(); focusTab(index - 1); }
              if (event.key === 'Home') { event.preventDefault(); focusTab(0); }
              if (event.key === 'End') { event.preventDefault(); focusTab(tabs.length - 1); }
            }}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 ${selected ? 'border-ateneo text-app-text dark:border-sky-400' : 'border-transparent text-app-muted hover:text-app-text'}`}
          >
            {tab.label}
            {tab.badge != null ? (
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${tab.alert ? 'bg-amber-400/15 text-amber-700 dark:text-amber-200' : 'bg-app-surface text-app-muted'}`}>{tab.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// One reviewed fact on the Overview: the value frozen at submission, its
// Document Vault verification badge, and the current profile value when it has
// changed since.
function FactTile({ label, value, verification, currentValue }) {
  return (
    <div className="grid content-start gap-1 rounded-[14px] border border-app-border bg-app-surface p-3">
      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">{label}</span>
      <strong className="text-base text-app-text">{value || 'Not encoded'}</strong>
      {verification ? <StatusBadge tone={getAttributeVerificationTone(verification)}>{getAttributeVerificationLabel(verification)}</StatusBadge> : null}
      {currentValue ? <span className="text-xs text-amber-700 dark:text-amber-200">Profile now: {currentValue}</span> : null}
    </div>
  );
}

function DocumentRow({ doc, selected, onSelect }) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(doc)}
        className={`flex w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 ${selected ? 'border-ateneo/60 bg-ateneo/10 dark:border-sky-400/60' : 'border-app-border bg-app-card hover:border-blue-500/40'}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-app-text">{doc.title}</span>
          <span className="block truncate text-xs text-app-muted">{getDocumentTypeLabel(doc.documentType)}</span>
        </span>
        <StatusBadge tone={verificationTone(doc.verificationStatus)} className="shrink-0">{doc.verificationStatus}</StatusBadge>
      </button>
    </li>
  );
}

// Shared SOP review surface for the Admissions Office and Department Chairs:
// a fixed header, tabbed content, and one action bar holding every stage
// transition the reviewer's role may take.
export default function ApplicationReviewModal({
  application,
  scholarship,
  documents,
  students = {},
  role,
  reviewerName = '',
  initialTab = null,
  onClose,
  onStatusChange,
  onEndorse,
  onScheduleInterview,
  onRecordDeliberation,
  onRelease,
  onChangeDocument,
  reviewComments = [],
  onAddComment,
}) {
  // Both Admissions Office lanes can run the preparation stages; the Head is a
  // superset and also decides approval and release. Department Chairs keep their
  // endorsement-only lane.
  const isAdmissionsHead = isAdmissionsHeadRole(role);
  const isAdmissionsReviewer = isAdmissionsReviewerRole(role);
  const isWide = useIsWide();
  const previewPaneRef = useRef(null);
  const nextStatuses = getNextApplicationStatuses(application.status, role);
  const linkedDocuments = getLinkedDocuments(application, documents);
  // The 2x2 ID photo heads the snapshot view, so a reviewer can put a face to
  // the application without opening the Documents tab.
  const applicantPhoto = getApplicantPhotoDocument(application, documents);
  const statusLog = Array.isArray(application.statusLog) ? application.statusLog : [];
  // Manuscript 3.3.3: an application whose attached files are still Pending or
  // Rejected cannot be endorsed or advance to any later SOP stage. The database
  // enforces the same rule, so the UI disables the forward actions first and
  // explains why.
  const { outstanding: outstandingDocuments, verified: verifiedDocuments, total: totalDocuments } = getDocumentVerificationReadiness(application, documents);
  const blockedByDocuments = outstandingDocuments > 0;
  // SOP step 3 gates the Document Vault review: an application's attached files
  // stay out of reach until it reaches the verification stage, and a rejected
  // application keeps them readable for its recorded decision.
  const documentsUnlocked = areApplicationDocumentsVisible(application.status);
  // The endorsement tab appears from the document-verification stage on, which
  // is also where the hand-off becomes available. It stays visible afterwards so
  // the recorded decision and its discussion remain readable.
  const endorsementUnlocked = areDocumentsReviewable(application.status);
  const documentBlockReason = `${outstandingDocuments} document${outstandingDocuments === 1 ? '' : 's'} still need${outstandingDocuments === 1 ? 's' : ''} verification`;
  // The scholarship's own requirement list, scoped to the standing the student
  // declared at submit time (the frozen profile snapshot).
  const { requirements, supportingDocuments = [] } = getApplicationReadiness({
    application,
    scholarship,
    documents,
    profile: { yearStanding: application.profileSnapshot?.yearStanding || '' },
  });
  // Every linked file must be reviewable, so a file that matches no requirement
  // (for example on a tracked-only program) still lists with the extras.
  const listedIds = new Set([
    ...requirements.flatMap((requirement) => requirement.attached.map((doc) => doc.id)),
    ...supportingDocuments.map((doc) => doc.id),
  ]);
  const otherDocuments = [...supportingDocuments, ...linkedDocuments.filter((doc) => !listedIds.has(doc.id))];

  const [activeTab, setActiveTab] = useState(() => {
    if (initialTab === 'documents' && !documentsUnlocked) return 'overview';
    if (initialTab) return initialTab;
    return isAdmissionsReviewer && documentsUnlocked && blockedByDocuments ? 'documents' : 'overview';
  });
  const [selectedDocId, setSelectedDocId] = useState(() => (
    (linkedDocuments.find((doc) => doc.verificationStatus !== 'Verified') || linkedDocuments[0])?.id || null
  ));
  const [interviewDate, setInterviewDate] = useState(application.interview?.scheduledAt || '');
  const [interviewPanel, setInterviewPanel] = useState(application.interview?.panel || '');
  const [deliberationNote, setDeliberationNote] = useState('');
  const [previewDoc, setPreviewDoc] = useState(null);
  const [rejectReasonOpen, setRejectReasonOpen] = useState(false);
  const [documentRejectTarget, setDocumentRejectTarget] = useState(null);
  // Verification is attributed to the signed-in Admissions Office account and
  // dated by the database, so it is confirmed before it is written.
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [actionError, setActionError] = useState('');
  // The Endorsement tab records the stage decision with a recommendation note;
  // the dialog never writes status directly.
  const [endorsementDecision, setEndorsementDecision] = useState(null);
  const [endorsementBusy, setEndorsementBusy] = useState(false);
  const [endorsementError, setEndorsementError] = useState('');
  const [endorsementFeedback, setEndorsementFeedback] = useState('');
  // Re-read from `documents` every render so a Verified/Rejected decision shows
  // in the pane immediately.
  const selectedDoc = linkedDocuments.find((doc) => doc.id === selectedDocId) || linkedDocuments[0] || null;

  // A document rejection must carry a recorded reason, so it opens the reason
  // dialog; a verification is attributed to the reviewer, so it opens the
  // confirmation dialog. A reset to Pending is a quiet correction and applies
  // directly.
  const changeDocument = (documentId, status) => {
    const target = linkedDocuments.find((doc) => doc.id === documentId) || null;
    if (status === 'Rejected') {
      setDocumentRejectTarget(target);
      return;
    }
    if (status === 'Verified') {
      setVerifyError('');
      setVerifyTarget(target);
      return;
    }
    onChangeDocument?.(documentId, status);
  };

  const confirmVerification = async () => {
    if (!verifyTarget) return;
    setVerifyBusy(true);
    setVerifyError('');
    const result = await onChangeDocument?.(verifyTarget.id, 'Verified');
    setVerifyBusy(false);
    if (result?.error) {
      setVerifyError(result.error);
      return;
    }
    setVerifyTarget(null);
  };

  const selectDocument = (doc) => {
    setSelectedDocId(doc.id);
    if (!isWide) previewPaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // The Endorsement tab records the same stage transition as the action bar, but
  // captures a recommendation note. The write still goes through
  // changeApplicationStatus in App.jsx, so role authority and the
  // document-verification gate are unchanged.
  const submitEndorsementDecision = async ({ note }) => {
    if (!endorsementDecision) return;
    setEndorsementBusy(true);
    setEndorsementError('');
    const result = endorsementDecision.mode === 'handoff'
      ? await onStatusChange?.(application.id, 'For Endorsement', { note })
      : await onEndorse?.(application.id, note);
    setEndorsementBusy(false);
    if (result?.error) {
      setEndorsementError(result.error);
      return;
    }
    setEndorsementFeedback(endorsementDecision.mode === 'handoff'
      ? 'Application sent to endorsement. The Department Chair now has it in the endorsement queue, and the hand-off record below keeps the note you added.'
      : 'The endorsement decision was recorded.');
    setEndorsementDecision(null);
    // Stay on the Endorsement tab either way: the recorded hand-off or decision
    // is the confirmation, and closing the review surface would hide it.
    setActiveTab('endorsement');
  };

  // Overview facts: the snapshot values the student certified, compared with
  // the profile values the review directory loads now.
  const snapshot = application.profileSnapshot || null;
  const academic = snapshot?.academic || null;
  const isQpi = !academic || academic.credential === 'qpi';
  const currentQpi = application.studentQpi != null && application.studentQpi !== '' ? Number(application.studentQpi).toFixed(2) : '';
  const snapshotAcademic = academic?.value == null || academic.value === '' ? '' : (isQpi ? Number(academic.value).toFixed(2) : String(academic.value));
  const currentIncome = application.studentHouseholdIncome != null && application.studentHouseholdIncome !== '' ? Number(application.studentHouseholdIncome) : null;
  const snapshotIncome = snapshot?.householdIncome?.value ?? null;
  const academicFact = snapshot
    ? { label: academic?.label || 'Academic record', value: snapshotAcademic, verification: academic?.verification, currentValue: isQpi && currentQpi && snapshotAcademic && currentQpi !== snapshotAcademic ? currentQpi : '' }
    : { label: 'QPI', value: currentQpi };
  const incomeFact = snapshot
    ? { label: 'Household income', value: snapshotIncome == null ? '' : fmtCurrency(snapshotIncome), verification: snapshot.householdIncome?.verification, currentValue: currentIncome != null && snapshotIncome != null && currentIncome !== Number(snapshotIncome) ? fmtCurrency(currentIncome) : '' }
    : { label: 'Household income', value: currentIncome == null ? '' : fmtCurrency(currentIncome) };

  const stageRecords = [
    application.endorsement && {
      key: 'endorsement',
      title: 'Endorsement · SOP step 4',
      lines: [application.endorsement.note, `By ${application.endorsement.reviewedBy} · ${fmtDate(application.endorsement.decidedAt)}`],
    },
    application.interview && {
      key: 'interview',
      title: 'Interview · SOP step 5',
      lines: [
        `${application.interview.panel} · ${application.interview.school}`,
        application.interview.scheduledAt ? `Scheduled ${fmtDate(application.interview.scheduledAt)}` : 'Schedule pending',
        application.interview.outcome ? `Outcome: ${application.interview.outcome}` : '',
      ],
    },
    application.deliberation && {
      key: 'deliberation',
      title: 'Deliberation · SOP step 6',
      lines: [[application.deliberation.decision, application.deliberation.note].filter(Boolean).join(' · '), `By ${application.deliberation.decidedBy} · ${fmtDate(application.deliberation.decidedAt)}`],
    },
    application.release && {
      key: 'release',
      title: 'Release of results · SOP step 8',
      lines: [`Released to ${application.release.releasedTo} · Reference ${application.release.reference}`, fmtDate(application.release.releasedAt)],
    },
  ].filter(Boolean);

  const tabs = [
    { key: 'overview', label: 'Overview' },
    // The frozen profile snapshot sits beside the overview so a reviewer reads
    // the applicant's self-reported answers before the attached proofs.
    { key: 'profile', label: 'Profile snapshot' },
    // The Documents tab appears only once the application reaches the SOP
    // verification stage; before that the gate is explained in the action bar
    // rather than by a tab that cannot be opened.
    ...(documentsUnlocked ? [{
      key: 'documents',
      label: 'Documents',
      badge: isAdmissionsReviewer && blockedByDocuments ? `${outstandingDocuments} to verify` : linkedDocuments.length,
      alert: isAdmissionsReviewer && blockedByDocuments,
    }] : []),
    // SOP step 4 in one place: the hand-off/decision record, the internal
    // thread, and the decision action. It appears from the
    // document-verification stage on and stays readable afterwards.
    ...(endorsementUnlocked ? [{
      key: 'endorsement',
      label: 'Endorsement',
      badge: application.status === 'For Endorsement' ? 'Decision due' : null,
      alert: application.status === 'For Endorsement',
    }] : []),
    { key: 'history', label: 'History', badge: statusLog.length || (application.timeline || []).length || null },
  ];
  // A selection pointing at a tab that is not shown (for example right after a
  // status write) falls back to the overview instead of an empty panel.
  const visibleActiveTab = tabs.some((tab) => tab.key === activeTab) ? activeTab : 'overview';

  // Action bar: one button per transition the role may take, read once from
  // getNextApplicationStatuses. Rejection sits apart on the left; when several
  // forward moves are allowed, the furthest one is the primary action. Moves the
  // surface performs itself (opening an application starts its review) never
  // render as buttons.
  const forwardStatuses = nextStatuses.filter((status) => (
    status !== 'Rejected' && !AUTOMATIC_STAGE_STATUSES.includes(status)
  ));
  const canReject = nextStatuses.includes('Rejected');
  const showInterviewFields = isAdmissionsReviewer && nextStatuses.includes('Interview');
  const showDeliberationField = isAdmissionsReviewer && nextStatuses.includes('Recommended');
  const hasBlockedForward = blockedByDocuments && forwardStatuses.some((status) => ENDORSEMENT_BLOCKED_STATUSES.includes(status));
  // Both Admissions Office lanes finish verification and hand the application to
  // the Department Chair, so at this point the forward action is that hand-off.
  const readyForEndorsement = isAdmissionsReviewer
    && application.status === 'For Verification'
    && totalDocuments > 0
    && !blockedByDocuments;
  // Why the Documents tab is not shown yet, phrased for the role that is reading
  // it. It appears with the action guidance at the verification gate.
  const lockedDocumentsMessage = !isAdmissionsReviewer
    ? 'Supporting documents become available once the Admissions Office continues this application to verification. You can still flag it for central validation from the action bar.'
    : linkedDocuments.length
      ? `Supporting documents are reviewed at Standard Procedure step 3. Continue this application to verification to review its ${linkedDocuments.length} attached file${linkedDocuments.length === 1 ? '' : 's'}${requirements.length ? ` against ${requirements.length} required submission${requirements.length === 1 ? '' : 's'}` : ''}.`
      : 'This application has no attached files. Continue it to verification to begin the document stage.';
  const blockReasonFor = (status) => {
    if (blockedByDocuments && ENDORSEMENT_BLOCKED_STATUSES.includes(status)) return documentBlockReason;
    if (status === 'Interview' && !interviewDate) return 'Enter the interview date first';
    return '';
  };
  const runAction = async (status) => {
    if (status === 'Rejected') {
      // A rejection must carry a recorded reason, so it opens the reason dialog.
      setRejectReasonOpen(true);
      return;
    }
    // The hand-off to the Department Chair records an optional note, so the
    // action bar and the Endorsement tab open the same decision dialog. The
    // review surface stays open afterwards instead of closing on the reviewer
    // before they can read the recorded hand-off.
    if (status === 'For Endorsement' && isAdmissionsReviewer) {
      setEndorsementError('');
      setEndorsementDecision({ mode: 'handoff' });
      return;
    }
    setActionError('');
    // The transition writes the stage and its timeline note. "For Verification"
    // routes the attached files into the Admissions Office document queue, so
    // the note says that explicitly for the reviewer and the student's history.
    const options = status === 'For Verification'
      ? {
        note: role === 'department_chair'
          ? 'Flagged for central document validation.'
          : 'Continued to document verification. Attached files are queued for Admissions Office review.',
      }
      : undefined;
    let result;
    if (status === 'Endorsed') {
      result = await onEndorse?.(application.id);
    } else if (status === 'Interview') {
      result = await onScheduleInterview?.(application.id, { scheduledAt: interviewDate, panel: interviewPanel });
    } else if (status === 'Recommended') {
      result = await onRecordDeliberation?.(application.id, 'Recommended', deliberationNote);
    } else if (status === 'Released') {
      result = await onRelease?.(application.id);
    } else {
      result = await onStatusChange(application.id, status, options);
    }
    if (result?.error) {
      setActionError(result.error);
      return;
    }
    if (status === 'For Verification' && isAdmissionsReviewer) {
      // The document queue opens in place: closing the modal would hide the work
      // the review just queued.
      setActiveTab('documents');
      return;
    }
    onClose();
  };
  const idleMessage = TERMINAL_STATUSES.includes(application.status)
    ? 'This application has reached a terminal stage.'
    : application.status === 'For Endorsement' && isAdmissionsReviewer
      ? 'This application is with the Department Chair for endorsement. The hand-off record stays available in the Endorsement tab and the status history.'
      : isAdmissionsHead
        ? 'No stage action is available at this stage.'
        : role === 'department_chair'
          ? 'The next action at this stage belongs to the Admissions Office.'
          : 'No stage action is available to your role at this stage.';

  return (
    <>
    <ModalShell title={application.scholarshipTitle} onClose={onClose} className="application-review-modal">
      <header className="grid shrink-0 gap-3 pb-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="m-0 text-base font-semibold">{application.studentName}</h3>
            <p className="m-0 mt-1 text-sm text-app-muted">{application.studentProgram || 'Program on file'} · {application.studentDepartment || 'Department on file'}</p>
          </div>
          <StatusBadge tone={statusTone(application.status)}>{getApplicationStatusLabel(application.status)}</StatusBadge>
        </div>
        {sopStageIndex(application.status) != null ? <SopStageTrack status={application.status} /> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-app-muted">
          <span>Submitted {application.submittedAt ? fmtDate(application.submittedAt) : 'not yet'}</span>
          <span>Certified {application.certifiedAt ? fmtDate(application.certifiedAt) : 'not yet'}</span>
          {totalDocuments ? (
            documentsUnlocked ? (
              <StatusBadge tone={blockedByDocuments ? 'warning' : 'success'}>{verifiedDocuments}/{totalDocuments} documents verified</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">{totalDocuments} document{totalDocuments === 1 ? '' : 's'} attached · reviewed at verification</StatusBadge>
            )
          ) : <StatusBadge tone="neutral">No documents attached</StatusBadge>}
        </div>
      </header>

      <ReviewTabs tabs={tabs} active={visibleActiveTab} onChange={setActiveTab} />

      <div
        className="application-review-modal-body pt-4"
        role="tabpanel"
        id={`review-panel-${visibleActiveTab}`}
        aria-labelledby={`review-tab-${visibleActiveTab}`}
      >
        {visibleActiveTab === 'overview' && (
          <div className="grid content-start gap-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <FactTile {...academicFact} />
              <FactTile {...incomeFact} />
              <FactTile label="Year standing" value={snapshot?.yearStandingLabel || ''} />
              <FactTile label="Document status" value={totalDocuments ? `${verifiedDocuments} of ${totalDocuments} verified` : 'None attached'} />
            </div>
            {snapshot ? <p className="m-0 text-xs text-app-muted">Values are self-reported at submission; a badge reflects Document Vault proof reviewed by the Admissions Office. “Profile now” marks a value the student changed after submitting.</p> : null}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Panel className="grid content-start gap-2">
                <h4 className={sectionHeading}>Application statement</h4>
                <p className="m-0 whitespace-pre-line text-sm text-app-text">{application.statement || 'No statement recorded.'}</p>
              </Panel>
              <Panel className="grid content-start gap-3">
                <h4 className={sectionHeading}>Stage records</h4>
                {stageRecords.length ? (
                  <ul className="m-0 grid gap-3 p-0">
                    {stageRecords.map((record) => (
                      <li key={record.key} className="grid gap-1 border-b border-app-border/60 pb-3 last:border-b-0 last:pb-0">
                        <strong className="text-sm text-app-text">{record.title}</strong>
                        {record.lines.filter(Boolean).map((line) => <span key={line} className="text-sm text-app-muted">{line}</span>)}
                      </li>
                    ))}
                  </ul>
                ) : <p className="m-0 text-sm text-app-muted">No endorsement, interview, deliberation, or release has been recorded yet.</p>}
              </Panel>
            </div>
          </div>
        )}

        {visibleActiveTab === 'documents' && (
          linkedDocuments.length || requirements.length ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div className="grid content-start gap-4">
                {requirements.length ? (
                  <section className="grid gap-2">
                    <h4 className={sectionHeading}>Required submissions</h4>
                    <ul className="m-0 grid gap-3 p-0">
                      {requirements.map((requirement) => (
                        <li key={requirement.id} className="grid gap-2 rounded-[14px] border border-app-border bg-app-surface p-3">
                          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 text-sm font-semibold text-app-text">{requirement.label}</span>
                            <RequirementStateBadge state={requirement.state} />
                          </div>
                          {requirement.attached.length ? (
                            <ul className="m-0 grid gap-2 p-0">
                              {requirement.attached.map((doc) => (
                                <DocumentRow key={doc.id} doc={doc} selected={selectedDoc?.id === doc.id} onSelect={selectDocument} />
                              ))}
                            </ul>
                          ) : <span className="text-xs text-app-muted">Accepts {describeRequirementTypes(requirement)}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <section className="grid gap-2">
                  <h4 className={sectionHeading}>{requirements.length ? 'Supporting documents' : 'Attached documents'}</h4>
                  {otherDocuments.length ? (
                    <ul className="m-0 grid gap-2 p-0">
                      {otherDocuments.map((doc) => (
                        <DocumentRow key={doc.id} doc={doc} selected={selectedDoc?.id === doc.id} onSelect={selectDocument} />
                      ))}
                    </ul>
                  ) : <p className="m-0 text-sm text-app-muted">{requirements.length ? 'No supporting documents attached.' : 'No documents attached yet.'}</p>}
                </section>
              </div>

              <div ref={previewPaneRef} className="scroll-mt-4">
                {selectedDoc ? (
                  <Panel className="grid content-start gap-3 lg:sticky lg:top-0">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <h4 className={sectionHeading}>Document verification</h4>
                      {!isAdmissionsReviewer ? <span className="text-xs text-app-muted">Read-only · verified by the Admissions Office</span> : null}
                    </div>
                    <DocumentVerificationItem
                      as="div"
                      doc={selectedDoc}
                      application={application}
                      owner={students[selectedDoc.ownerId] || null}
                      onPreview={isWide ? undefined : setPreviewDoc}
                      onChangeDocument={isAdmissionsReviewer && onChangeDocument ? changeDocument : undefined}
                    />
                    {isWide ? (
                      <DocumentPreview
                        key={selectedDoc.id}
                        doc={selectedDoc}
                        frameClassName="h-[min(56vh,540px)]"
                        imageClassName="max-h-[min(56vh,540px)]"
                      />
                    ) : null}
                  </Panel>
                ) : (
                  <Panel><p className="m-0 text-sm text-app-muted">No document attached yet. A required submission stays Not attached until the student attaches a Document Vault file.</p></Panel>
                )}
              </div>
            </div>
          ) : <p className="m-0 text-sm text-app-muted">No documents attached yet.</p>
        )}

        {visibleActiveTab === 'profile' && (
          <Panel className="grid gap-1">
            <h4 className={`${sectionHeading} mb-1`}>Profile at submission</h4>
            <ProfileSnapshotList snapshot={application.profileSnapshot} applicantPhoto={applicantPhoto} onPreviewPhoto={setPreviewDoc} />
          </Panel>
        )}

        {visibleActiveTab === 'history' && (
          <Panel className="grid gap-2">
            <h4 className={sectionHeading}>Status history</h4>
            <StatusHistoryList
              statusLog={statusLog}
              timeline={application.timeline}
              showActorName={isAdmissionsReviewer || role === 'department_chair'}
            />
          </Panel>
        )}

        {visibleActiveTab === 'endorsement' && (
          <div className="grid gap-3">
            {endorsementFeedback ? (
              <p className="m-0 rounded-[14px] border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-200" role="status">
                {endorsementFeedback}
              </p>
            ) : null}
            <EndorsementCasePanel
              application={application}
              documents={documents}
              comments={reviewComments}
              role={role}
              onAddComment={onAddComment}
              onRequestDecision={() => {
                setEndorsementError('');
                setEndorsementDecision({ mode: role === 'department_chair' ? 'endorse' : 'handoff' });
              }}
            />
          </div>
        )}
      </div>

      <footer className="application-review-actions grid shrink-0 gap-3 border-t border-app-border pt-4">
        {!documentsUnlocked ? (
          <p className="m-0 rounded-[14px] border border-app-border bg-app-surface px-3 py-2 text-sm text-app-muted">
            {lockedDocumentsMessage}
          </p>
        ) : null}

        {hasBlockedForward ? (
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200" role="status">
            <span>{documentBlockReason} before this application can be endorsed or advance to a later stage.</span>
            {visibleActiveTab !== 'documents' ? (
              <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setActiveTab('documents')}>Review documents</button>
            ) : null}
          </p>
        ) : null}

        {readyForEndorsement ? (
          <p className="m-0 rounded-[14px] border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-200" role="status">
            All attached documents are verified. Send the application to endorsement when you are ready to hand it to the Department Chair; the hand-off note is recorded in the Endorsement tab and the status history.
          </p>
        ) : null}

        {showInterviewFields ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-app-text">
              <span className="font-semibold">Interview date</span>
              <input type="date" value={interviewDate} onChange={(event) => setInterviewDate(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm text-app-text">
              <span className="font-semibold">Panel / school</span>
              <input value={interviewPanel} onChange={(event) => setInterviewPanel(event.target.value)} placeholder={`${application.studentDepartment || 'Applicant school'} Scholarship Panel`} />
            </label>
          </div>
        ) : null}

        {showDeliberationField ? (
          <label className="grid gap-1 text-sm text-app-text">
            <span className="font-semibold">Sub-committee note</span>
            <textarea rows="2" value={deliberationNote} onChange={(event) => setDeliberationNote(event.target.value)} placeholder="Record the School Scholarship Sub-committee deliberation." />
          </label>
        ) : null}

        {actionError ? (
          <p className="m-0 rounded-[14px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200" role="alert">
            {actionError}
          </p>
        ) : null}

        {nextStatuses.length ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {canReject ? <Button type="button" variant="danger" onClick={() => runAction('Rejected')}>{getStageActionLabel('Rejected', role)}</Button> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {forwardStatuses.map((status, index) => {
                const reason = blockReasonFor(status);
                return (
                  <Button
                    key={status}
                    type="button"
                    variant={index === forwardStatuses.length - 1 ? 'primary' : 'secondary'}
                    disabled={Boolean(reason)}
                    title={reason || undefined}
                    onClick={() => runAction(status)}
                  >{getStageActionLabel(status, role)}</Button>
                );
              })}
            </div>
          </div>
        ) : <p className="m-0 text-sm text-app-muted">{idleMessage}</p>}
      </footer>
    </ModalShell>
    {endorsementDecision ? (
      <EndorsementDecisionModal
        application={application}
        mode={endorsementDecision.mode}
        onConfirm={submitEndorsementDecision}
        onClose={() => { setEndorsementDecision(null); setEndorsementError(''); }}
        busy={endorsementBusy}
        error={endorsementError}
      />
    ) : null}
    {rejectReasonOpen ? (
      <ReasonModal
        title="Reject application"
        label="Reason for rejection"
        hint="Record why this application is being rejected. The applicant sees this reason."
        confirmLabel="Reject application"
        onConfirm={(note) => {
          onStatusChange(application.id, 'Rejected', { note });
          setRejectReasonOpen(false);
          onClose();
        }}
        onClose={() => setRejectReasonOpen(false)}
      />
    ) : null}
    {documentRejectTarget ? (
      <ReasonModal
        title="Reject document"
        label="Reason for rejection"
        hint={`The student sees this reason for “${documentRejectTarget.title}” so they can upload a correct replacement.`}
        options={getDocumentRejectionReasons(documentRejectTarget.documentType)}
        notesHint="Add details, such as which page or value needs correcting."
        confirmLabel="Reject document"
        onConfirm={(reason) => {
          onChangeDocument?.(documentRejectTarget.id, 'Rejected', reason);
          setDocumentRejectTarget(null);
        }}
        onClose={() => setDocumentRejectTarget(null)}
      />
    ) : null}
    {previewDoc ?<DocumentPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} /> : null}
    {verifyTarget ? (
      <VerifyDocumentModal
        doc={verifyTarget}
        application={application}
        reviewerName={reviewerName}
        reviewerRole={role}
        busy={verifyBusy}
        error={verifyError}
        onConfirm={confirmVerification}
        onClose={() => {
          if (verifyBusy) return;
          setVerifyTarget(null);
          setVerifyError('');
        }}
      />
    ) : null}
    </>
  );
}
