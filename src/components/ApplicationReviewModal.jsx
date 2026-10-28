import { useEffect, useRef, useState } from 'react';
import { Button, ModalShell, Panel, StatusBadge } from './ui';
import DocumentPreviewModal, { DocumentPreview, useDocumentPreviewUrl } from './DocumentPreviewModal';
import ReasonModal from './ReasonModal';
import VerifyDocumentModal from './VerifyDocumentModal';
import { DocumentVerificationItem, ProfileSnapshotList, RequirementStateBadge, SopStageTrack, StatusHistoryList } from './ApplicationParts';
import ApplicationPrintButton from './ApplicationPrintSheet';
import { FinancialDetailsNotice, useApplicationFinancialSections } from './ApplicationFinancialDetails';
import { isReviewerRole } from '../lib/reviewScope';
import EndorsementCasePanel from './EndorsementCasePanel';
import EndorsementDecisionModal from './EndorsementDecisionModal';
import InterviewPanel from './InterviewPanel';
import { AUTOMATIC_STAGE_STATUSES, CASE_OFFICER_JOINABLE_STATUSES, getApplicationStatusLabel, getDocumentRejectionReasons, getDocumentStatusLabel, getDocumentTypeLabel, getNextApplicationStatuses, getStageActionLabel, isAdmissionsHeadRole, isAdmissionsReviewerRole, sopStageIndex } from '../lib/constants';
import { ENDORSEMENT_BLOCKED_STATUSES, areApplicationDocumentsVisible, areEndorsementRecordsVisible, describeRequirementTypes, getActorRoleLabel, getApplicantPhotoDocument, getApplicationLiveAttributeVerifications, getApplicationReadiness, getDocumentVerificationReadiness, getLinkedDocuments, getResidencePhotoDocuments } from '../lib/applicationRequirements';
import { getApplicationComments } from '../lib/endorsement';
import { getCaseOfficers, getReviewStageTab, isCaseOfficer } from '../lib/admissionsOffice';
import { describeAttributeVerification, getAttributeVerificationLabel, getAttributeVerificationTone } from '../lib/verification';
import { fmtCurrency, fmtDate } from '../lib/formatters';
import { createInterviewDraft, getLatestPanelRecommendation, validateInterviewSchedule } from '../lib/interview';

const TERMINAL_STATUSES = ['Released', 'Rejected'];
// SOP step 5 onward: the Interview tab appears once the Office of Admissions &
// Aid has endorsed the application and stays readable afterwards.
const INTERVIEW_TAB_STATUSES = ['Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'];
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
  const tabListRef = useRef(null);
  useEffect(() => {
    const activeTab = refs.current[active];
    const tabList = tabListRef.current;
    if (!activeTab || !tabList) return;
    const tabBounds = activeTab.getBoundingClientRect();
    const listBounds = tabList.getBoundingClientRect();
    if (tabBounds.left < listBounds.left) tabList.scrollLeft -= listBounds.left - tabBounds.left;
    else if (tabBounds.right > listBounds.right) tabList.scrollLeft += tabBounds.right - listBounds.right;
  }, [active]);
  const focusTab = (index) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onChange(tab.key);
    refs.current[tab.key]?.focus();
  };
  return (
    // overflow-y-hidden keeps the horizontal scroller from promoting overflow-y
    // to auto: with the tabs' -mb-px alignment shift that produced a stray
    // vertical scrollbar on the tab strip.
    <div ref={tabListRef} role="tablist" aria-label="Application review sections" className="flex shrink-0 snap-x snap-proximity gap-1 overflow-x-auto overflow-y-hidden scroll-px-2 border-b border-app-border">
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
            className={`-mb-px inline-flex min-h-10 shrink-0 snap-start items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 lg:min-h-9 ${selected ? 'border-ateneo text-app-text dark:border-sky-400' : 'border-transparent text-app-muted hover:text-app-text'}`}
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
      {verification ? <StatusBadge tone={getAttributeVerificationTone(verification)} title={describeAttributeVerification(getAttributeVerificationLabel(verification))}>{getAttributeVerificationLabel(verification)}</StatusBadge> : null}
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
        <StatusBadge tone={verificationTone(doc.verificationStatus)} className="shrink-0">{getDocumentStatusLabel(doc.verificationStatus)}</StatusBadge>
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
  // An application rejection records its reason in the staff-only internal notes
  // and sends the student the fixed notice (App.jsx rejectApplication). Without
  // it the reject action refuses rather than writing a reason the student can
  // read.
  onRejectApplication,
  onEndorse,
  // SOP step 5 data and actions (App.jsx interviewWorkspace). Without it the
  // Interview tab is not shown.
  interviewWorkspace = null,
  onRecordDeliberation,
  onRelease,
  onChangeDocument,
  reviewComments = [],
  onAddComment,
  // The Admissions Office case-officer roster. Opening a case joins the officer to
  // it, so a second officer opening the same application is expected rather than a
  // conflict, and any officer can leave with a recorded reason.
  caseOfficers = [],
  currentUserId = '',
  onJoinCase,
  onLeaveCase,
}) {
  // Since Consultation 2 the Head verifies the files, forwards the case to the
  // interviewers of its scope, and does the final check and release; Staff read
  // the office workspace without acting. A scoped reviewer (an interviewer or a
  // ladder account) schedules and recommends, and the school's approving level
  // approves; getNextApplicationStatuses decides each move from the case facts.
  const isAdmissionsHead = isAdmissionsHeadRole(role);
  const isAdmissionsReviewer = isAdmissionsReviewerRole(role);
  const stageContext = interviewWorkspace?.stageContextFor?.(application) || {};
  // Who may schedule this applicant's interview: an interviewer or ladder
  // account in scope, or the Head (App.jsx canCoordinateInterview). Without the
  // workspace's answer only the Head coordinates.
  const canCoordinateInterview = interviewWorkspace?.canCoordinate
    ? Boolean(interviewWorkspace.canCoordinate(application))
    : isAdmissionsHead;
  const isWide = useIsWide();
  // Case officers. Opening an application is what adds the officer to it, so the
  // effect below runs once per open unless the signed-in account is already on the
  // roster. A failed join stays silent: reading the case must never be blocked by
  // it, and the next open retries.
  const caseOfficersOnApplication = getCaseOfficers(caseOfficers, application.id);
  const currentOfficer = currentUserId
    ? caseOfficersOnApplication.find((entry) => entry.officerId === currentUserId)
    : null;
  const isOnCase = Boolean(currentOfficer);
  const currentOfficerName = currentOfficer?.officerName || 'Signed-in officer';
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const joinAttemptedRef = useRef(false);
  useEffect(() => {
    if (!isAdmissionsHead || !onJoinCase) return;
    if (!CASE_OFFICER_JOINABLE_STATUSES.includes(application.status)) return;
    if (isCaseOfficer(caseOfficers, application.id, currentUserId)) return;
    if (joinAttemptedRef.current) return;
    joinAttemptedRef.current = true;
    Promise.resolve(onJoinCase(application.id)).catch(() => undefined);
  }, [application.id, application.status, caseOfficers, currentUserId, isAdmissionsHead, onJoinCase]);

  const previewPaneRef = useRef(null);
  const nextStatuses = getNextApplicationStatuses(application.status, role, stageContext);
  const linkedDocuments = getLinkedDocuments(application, documents);
  // The 2x2 ID photo heads the snapshot view, so a reviewer can put a face to
  // the application without opening the Documents tab.
  const applicantPhoto = getApplicantPhotoDocument(application, documents);
  // Household finances and the financial situation are office-only (RLS): the
  // Admissions Office reads them here, a Department Chair never does.
  const financialDetails = useApplicationFinancialSections(application, isAdmissionsReviewer);
  const statusLog = Array.isArray(application.statusLog) ? application.statusLog : [];
  // The staff-only internal notes for this case (application_review_comments).
  // A rejection reason is recorded here rather than in the student-readable
  // timeline, and the History tab reads it back when the Endorsement tab (whose
  // thread owns this table) is not open yet.
  const caseNotes = getApplicationComments(reviewComments, application.id);
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
  // SOP step 4 starts when the Admissions Office hands the case to the Head for
  // the endorsement decision, so the Endorsement tab stays hidden while the case
  // is still being verified. It stays visible afterwards so the recorded
  // hand-off, decision, and discussion remain readable.
  const endorsementUnlocked = areEndorsementRecordsVisible(application.status);
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

  // SOP step 5. The Admissions Office coordinates the interview; SOP 5a draws
  // the panel from the applicant's school. The schedule draft lives here because
  // the action bar's "Schedule interview" button confirms it.
  const applicationPanelists = (interviewWorkspace?.panelists || []).filter((row) => (
    row.applicationId === application.id && !row.removedAt
  ));
  // SOP step 6 reads the panel's latest recommendation level (the interview notes
  // carry it instead of a 1-5 rating), so the deliberation action states it.
  const latestPanelRecommendation = getLatestPanelRecommendation(
    (interviewWorkspace?.notes || []).filter((note) => note.applicationId === application.id),
  );
  const interviewUnlocked = Boolean(interviewWorkspace) && (
    INTERVIEW_TAB_STATUSES.includes(application.status)
    || (application.status === 'Rejected' && Boolean(application.interview))
  );
  const [interviewDraft, setInterviewDraft] = useState(() => createInterviewDraft(application, applicationPanelists));
  const [interviewShowErrors, setInterviewShowErrors] = useState(false);
  const interviewErrors = validateInterviewSchedule(interviewDraft, {
    autoMeeting: Boolean(interviewWorkspace?.calendarConfigured) && interviewDraft.mode === 'online' && !String(interviewDraft.meetingUrl || '').trim(),
    activeLocationIds: (interviewWorkspace?.locations || []).filter((entry) => entry.isActive).map((entry) => entry.id),
  });

  const [activeTab, setActiveTab] = useState(() => {
    if (initialTab === 'documents' && !documentsUnlocked) return 'overview';
    if (initialTab === 'endorsement' && !endorsementUnlocked) return 'overview';
    if (initialTab) return initialTab;
    // Open on the stage the application is in, so the reviewer lands on the work
    // that stage needs: the files at For Verification, the endorsement record at
    // For Endorsement, the schedule from Endorsed on.
    const stageTab = getReviewStageTab(application.status);
    if (stageTab === 'documents' && documentsUnlocked) return 'documents';
    if (stageTab === 'endorsement' && endorsementUnlocked) return 'endorsement';
    if (stageTab === 'interview' && interviewUnlocked) return 'interview';
    return isAdmissionsHead && documentsUnlocked && blockedByDocuments ? 'documents' : 'overview';
  });
  const [selectedDocId, setSelectedDocId] = useState(() => (
    (linkedDocuments.find((doc) => doc.verificationStatus !== 'Verified') || linkedDocuments[0])?.id || null
  ));
  const [deliberationNote, setDeliberationNote] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
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
  // One signed URL per selected file: the verification actions' "Open in a new
  // tab" link and the inline preview share it. Narrow screens keep the preview in
  // its own modal (which fetches its own URL), so no request is made here.
  const { url: previewUrl, error: previewError } = useDocumentPreviewUrl(
    isWide ? selectedDoc : null,
    isWide && Boolean(selectedDoc),
  );

  // Reverting a document for resubmission must carry a recorded note, so it
  // opens the reason dialog; a verification is attributed to the reviewer, so it
  // opens the confirmation dialog. A reset to Pending is a quiet correction and
  // applies directly.
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
    try {
      const result = endorsementDecision.mode === 'handoff'
        ? await onStatusChange?.(application.id, 'For Endorsement', { note })
        : await onEndorse?.(application.id, note);
      if (result?.error) {
        setEndorsementError(result.error);
        return;
      }
      setEndorsementFeedback(endorsementDecision.mode === 'handoff'
        ? 'Sent for endorsement. The Admissions Office Head records the decision next.'
        : "Forwarded to interview. The interviewers of the applicant's school schedule it next.");
      setEndorsementDecision(null);
      // Stay on the Endorsement tab either way: the recorded hand-off or decision
      // is the confirmation, and closing the review surface would hide it.
      setActiveTab('endorsement');
    } catch (error) {
      // A rejected write must never leave the dialog stuck on "Saving…".
      setEndorsementError(error?.message || 'The decision could not be recorded. Please try again.');
    } finally {
      setEndorsementBusy(false);
    }
  };

  // Overview facts: the snapshot values the student certified, compared with
  // the profile values the review directory loads now.
  const snapshot = application.profileSnapshot || null;
  const academic = snapshot?.academic || null;
  // The badges are read from the files the application attaches now, so a file
  // the Admissions Office verified at the verification stage stops reading
  // Unverified from the snapshot frozen before that decision. The frozen badge
  // stays the fallback for a linked file this reviewer session could not load.
  const liveVerifications = snapshot ? getApplicationLiveAttributeVerifications(application, documents) : null;
  const verificationBadge = (key, frozenBadge) => liveVerifications?.[key] || frozenBadge;
  const isQpi = !academic || academic.credential === 'qpi';
  const currentQpi = application.studentQpi != null && application.studentQpi !== '' ? Number(application.studentQpi).toFixed(2) : '';
  const snapshotAcademic = academic?.value == null || academic.value === '' ? '' : (isQpi ? Number(academic.value).toFixed(2) : String(academic.value));
  const currentIncome = application.studentHouseholdIncome != null && application.studentHouseholdIncome !== '' ? Number(application.studentHouseholdIncome) : null;
  const snapshotIncome = snapshot?.householdIncome?.value ?? null;
  const academicFact = snapshot
    ? { label: academic?.label || 'Academic record', value: snapshotAcademic, verification: verificationBadge(academic?.credential || 'qpi', academic?.verification), currentValue: isQpi && currentQpi && snapshotAcademic && currentQpi !== snapshotAcademic ? currentQpi : '' }
    : { label: 'QPI', value: currentQpi };
  const incomeFact = snapshot
    ? { label: 'Household income', value: snapshotIncome == null ? '' : fmtCurrency(snapshotIncome), verification: verificationBadge('householdIncome', snapshot.householdIncome?.verification), currentValue: currentIncome != null && snapshotIncome != null && currentIncome !== Number(snapshotIncome) ? fmtCurrency(currentIncome) : '' }
    : { label: 'Household income', value: currentIncome == null ? '' : fmtCurrency(currentIncome) };

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
      badge: isAdmissionsHead && blockedByDocuments ? `${outstandingDocuments} to verify` : linkedDocuments.length,
      alert: isAdmissionsHead && blockedByDocuments,
    }] : []),
    // SOP step 4 in one place: the hand-off/decision record, the internal
    // thread, and the decision action. It appears once the application has
    // reached the endorsement stage and stays readable afterwards.
    ...(endorsementUnlocked ? [{
      key: 'endorsement',
      // The forwarding record and the internal thread.
      label: 'Case notes',
      badge: application.status === 'For Endorsement' ? 'Decision due' : null,
      alert: application.status === 'For Endorsement',
    }] : []),
    // SOP step 5: the schedule, the panel from the applicant's school, and the
    // private evaluation notes.
    ...(interviewUnlocked ? [{
      key: 'interview',
      label: 'Interview',
      badge: canCoordinateInterview && application.status === 'Endorsed' ? 'Schedule due' : null,
      alert: canCoordinateInterview && application.status === 'Endorsed',
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
  // Results are released per scholarship from the Head's final-check lane, so a
  // single case never releases on its own (Consultation 2, #8 and #13).
  const forwardStatuses = nextStatuses.filter((status) => (
    status !== 'Rejected' && status !== 'Released' && !AUTOMATIC_STAGE_STATUSES.includes(status)
    && (status !== 'Interview' || canCoordinateInterview)
  ));
  const canReject = nextStatuses.includes('Rejected');
  const showDeliberationField = nextStatuses.includes('Recommended');
  // An interviewer's recommendation carries one of the five recommendation levels
  // (Consultation 2, #7), recorded with an evaluation note in the Interview tab.
  const needsRecommendationLevel = !isAdmissionsHead && !latestPanelRecommendation;
  // Why the Documents tab is not shown yet, phrased for the role that is reading
  // it. It appears with the action guidance at the verification gate.
  const lockedDocumentsMessage = !isAdmissionsHead
    ? 'Documents become available at verification.'
    : linkedDocuments.length
      ? `Continue to verification to review its ${linkedDocuments.length} attached file${linkedDocuments.length === 1 ? '' : 's'}${requirements.length ? ` against ${requirements.length} required submission${requirements.length === 1 ? '' : 's'}` : ''}.`
      : 'No files attached. Continue to verification to begin document review.';
  const blockReasonFor = (status) => {
    if (blockedByDocuments && ENDORSEMENT_BLOCKED_STATUSES.includes(status)) return documentBlockReason;
    if (status === 'Recommended' && needsRecommendationLevel) return 'Record a recommendation level in the Interview tab';
    return '';
  };
  const runAction = async (status) => {
    if (status === 'Rejected') {
      // A rejection must carry a recorded reason. The reason stays with the
      // office (internal notes); the student receives the general notice.
      setRejectReasonOpen(true);
      return;
    }
    // The hand-off for endorsement records an optional note, so the action bar
    // opens the decision dialog. The review surface stays open afterwards instead
    // of closing on the reviewer before they can read the recorded hand-off.
    if (status === 'For Endorsement' && isAdmissionsReviewer) {
      setEndorsementError('');
      setEndorsementDecision({ mode: 'handoff' });
      return;
    }
    // Endorsing records the department's recommendation note, so the Chair's
    // single action bar button opens the decision dialog instead of writing
    // straight from the button with no note.
    if (status === 'Endorsed') {
      setEndorsementError('');
      setEndorsementDecision({ mode: 'endorse' });
      return;
    }
    // The recommendation ends the interview stage. App.jsx closes a live
    // schedule before the stage moves; no attendance decision is recorded.
    setActionError('');
    // The transition writes the stage and its timeline note. "For Verification"
    // routes the attached files into the Admissions Office document queue, so
    // the note says that explicitly for the reviewer and the student's history.
    const options = status === 'For Verification'
      ? {
        note: 'Continued to document verification. Attached files are queued for Admissions Office review.',
      }
      : undefined;
    // Scheduling confirms the Interview tab's draft. An incomplete draft opens
    // the tab with its field errors instead of writing anything.
    if (status === 'Interview') {
      if (!interviewWorkspace?.onSchedule) {
        setActionError('Interview scheduling is not available on this page.');
        return;
      }
      if (Object.keys(interviewErrors).length) {
        setInterviewShowErrors(true);
        setActiveTab('interview');
        setActionError(`Complete the interview schedule in the Interview tab: ${Object.values(interviewErrors)[0]}`);
        return;
      }
    }
    let result;
    setActionBusy(true);
    try {
      if (status === 'Interview') {
        result = await interviewWorkspace.onSchedule(application.id, interviewDraft);
      } else if (status === 'Recommended') {
        result = await onRecordDeliberation?.(application.id, 'Recommended', deliberationNote);
      } else if (status === 'Released') {
        result = await onRelease?.(application.id);
      } else {
        result = await onStatusChange(application.id, status, options);
      }
    } finally {
      setActionBusy(false);
    }
    if (result?.error) {
      if (status === 'Interview') {
        if (result.errors) setInterviewShowErrors(true);
        setActiveTab('interview');
      }
      setActionError(result.error);
      return;
    }
    if (status === 'Interview') {
      // The recorded schedule is the confirmation; keep it on screen.
      setActiveTab('interview');
      return;
    }
    if (status === 'For Verification' && isAdmissionsHead) {
      // The document queue opens in place: closing the modal would hide the work
      // the review just queued.
      setActiveTab('documents');
      return;
    }
    onClose();
  };
  const idleMessage = TERMINAL_STATUSES.includes(application.status)
    ? 'This application has reached a terminal stage.'
    : isAdmissionsHead
      ? (application.status === 'Recommended'
        ? "Awaiting the approval of the applicant's school."
        : application.status === 'Approved'
          ? 'Release this result with its scholarship from Final check and release.'
          : 'No stage action is available at this stage.')
      : !isReviewerRole(role)
        ? 'Admissions Office Staff have a read-only view of applications.'
        : ['Submitted', 'Under Review', 'For Verification', 'For Endorsement'].includes(application.status)
          ? 'The Admissions Office Head verifies the documents before the interview.'
          : application.status === 'Interview'
            ? 'Only a member of this interview panel records the recommendation.'
            : application.status === 'Recommended'
              ? "The approving level for the applicant's school decides this recommendation."
              : application.status === 'Approved'
                ? 'Approved. The Admissions Office Head does the final check and releases the results.'
                : 'No stage action is available to your role at this stage.';

  return (
    <>
    <ModalShell title={application.scholarshipTitle} onClose={onClose} className="application-review-modal">
      <header className="grid shrink-0 gap-2 pb-2">
        <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
          <div className="min-w-0 w-full">
            <h3 className="m-0 text-base font-semibold">{application.studentName}</h3>
            <p className="m-0 mt-1 text-sm text-app-muted">{application.studentProgram || 'Program on file'} · {application.studentSchool || 'School on file'}</p>
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
          {isAdmissionsHead ? (
            <StatusBadge tone={caseOfficersOnApplication.length ? 'info' : 'neutral'}>
              {caseOfficersOnApplication.length === 0
                ? 'No case officers yet'
                : isOnCase
                  ? `${currentOfficerName}${caseOfficersOnApplication.length > 1 ? ` + ${caseOfficersOnApplication.length - 1}` : ''} on this case`
                  : `${caseOfficersOnApplication.length} case officer${caseOfficersOnApplication.length === 1 ? '' : 's'}`}
            </StatusBadge>
          ) : null}

        </div>
      </header>

      <ReviewTabs tabs={tabs} active={visibleActiveTab} onChange={setActiveTab} />

      <div
        className={`application-review-modal-body pt-4${visibleActiveTab === 'documents' ? ' application-review-modal-body--split' : ''}`}
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
            {snapshot ? <p className="m-0 text-xs text-app-muted">Self-reported at submission. Badges show the Document Vault proof attached now, including the latest review decision; “Profile now” marks a value changed since.</p> : null}
            <Panel className="grid content-start gap-2">
              <h4 className={sectionHeading}>Application statement/essay</h4>
              <p className="m-0 whitespace-pre-line text-sm text-app-text">{application.statement || 'No statement recorded.'}</p>
            </Panel>
          </div>
        )}

        {visibleActiveTab === 'documents' && (
          linkedDocuments.length || requirements.length ? (
            <div className="application-review-documents">
              <div className="application-review-documents-pane">
                {requirements.length ? (
                  <section className="grid gap-2">
                    <h4 className={sectionHeading}>Required submissions</h4>
                    <ul className="m-0 grid gap-3 p-0">
                      {requirements.map((requirement) => (
                        <li key={requirement.id} className="grid gap-2 rounded-[14px] border border-app-border bg-app-surface p-3">
                          <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                            <span className="min-w-0 text-sm font-semibold text-app-text">{requirement.label}</span>
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

              <div ref={previewPaneRef} className="application-review-documents-pane scroll-mt-4">
                {selectedDoc ? (
                  <Panel className="grid content-start gap-3">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <h4 className={sectionHeading}>Document verification</h4>
                      {!isAdmissionsHead ? <span className="text-xs text-app-muted">Read-only · verified by the Admissions Office Head</span> : null}
                    </div>
                    <DocumentVerificationItem
                      as="div"
                      doc={selectedDoc}
                      application={application}
                      owner={students[selectedDoc.ownerId] || null}
                      onPreview={isWide ? undefined : setPreviewDoc}
                      onChangeDocument={isAdmissionsHead && onChangeDocument ? changeDocument : undefined}
                      openUrl={isWide ? previewUrl : ''}
                    />
                    {isWide ? (
                      <DocumentPreview
                        key={selectedDoc.id}
                        doc={selectedDoc}
                        url={previewUrl}
                        error={previewError}
                        showOpenLink={false}
                        frameClassName="h-[min(56vh,540px)]"
                        imageClassName="max-h-[min(56vh,540px)]"
                      />
                    ) : null}
                  </Panel>
                ) : (
                  <Panel><p className="m-0 text-sm text-app-muted">No file attached yet. It stays Not attached until the student adds a vault file.</p></Panel>
                )}
              </div>
            </div>
          ) : <p className="m-0 text-sm text-app-muted">No documents attached yet.</p>
        )}

        {visibleActiveTab === 'profile' && (
          <Panel className="grid gap-1">
            <h4 className={`${sectionHeading} mb-1`}>Profile at submission</h4>
            <p className="m-0 mb-2 text-xs text-app-muted">The certified record. These badges are the ones the student saw then; the Overview shows the current review decisions.</p>
            <ProfileSnapshotList snapshot={application.profileSnapshot} applicantPhoto={applicantPhoto} onPreviewPhoto={setPreviewDoc} extraSections={financialDetails.sections} />
            <FinancialDetailsNotice status={financialDetails.status} />
            <div className="pt-2">
              <ApplicationPrintButton
                label="Print case"
                sheet={{
                  application,
                  snapshot: application.profileSnapshot,
                  financialSections: financialDetails.sections,
                  statement: application.statement,
                  applicantPhoto,
                  residencePhotos: getResidencePhotoDocuments(application, documents),
                  audience: isAdmissionsReviewer ? 'office' : 'chair',
                }}
              />
            </div>
          </Panel>
        )}

        {visibleActiveTab === 'history' && (
          <div className="grid gap-3">
            {/* The recorded rejection reason is staff-only, and the Endorsement
                tab's thread only exists from For Endorsement on. A case rejected
                before that hand-off is still readable here, where the office
                looks for the decision's justification. */}
            {!endorsementUnlocked && caseNotes.length ? (
              <Panel className="grid gap-2">
                <h4 className={sectionHeading}>Internal notes</h4>
                <p className="m-0 text-xs text-app-muted">Visible to reviewers only, never to the student.</p>
                <ul className="m-0 grid gap-2 p-0">
                  {caseNotes.map((comment) => (
                    <li key={comment.id} className="grid gap-1 rounded-[14px] border border-app-border bg-app-surface p-3">
                      <span className="text-xs text-app-muted">
                        <strong className="text-app-text">{comment.authorName || 'Reviewer'}</strong>
                        {' · '}{getActorRoleLabel(comment.authorRole) || 'Staff'}
                        {' · '}{fmtDate(comment.createdAt)}
                      </span>
                      <p className="m-0 whitespace-pre-line text-sm text-app-text">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
            {isAdmissionsReviewer ? (
              <Panel className="grid content-start gap-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <h4 className={sectionHeading}>Case officers</h4>
                  {isOnCase && onLeaveCase ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setLeaveError('');
                        setLeaveOpen(true);
                      }}
                    >
                      Leave case
                    </Button>
                  ) : null}
                </div>
                {caseOfficersOnApplication.length ? (
                  <ul className="m-0 grid gap-2 p-0">
                    {caseOfficersOnApplication.map((officer) => (
                      <li key={officer.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-app-border/60 pb-2 last:border-b-0 last:pb-0">
                        <span className="min-w-0 text-sm font-semibold text-app-text">{officer.officerName}</span>
                        <span className="text-xs text-app-muted">
                          {officer.officerRole === 'admissions_head' ? 'Admissions Office Head' : 'Admissions Office Staff'}
                          {officer.joinedAt ? ` · joined ${fmtDate(officer.joinedAt)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="m-0 text-sm text-app-muted">No officer has opened this case yet.</p>}
                {leaveError ? <span className="text-sm text-rose-300" role="alert">{leaveError}</span> : null}
              </Panel>
            ) : null}
            <Panel className="grid gap-2">
              <h4 className={sectionHeading}>Status history</h4>
              <StatusHistoryList
                statusLog={statusLog}
                timeline={application.timeline}
                showActorName={isAdmissionsReviewer || isReviewerRole(role)}
              />
            </Panel>
          </div>
        )}

        {visibleActiveTab === 'interview' && interviewWorkspace && (
          <InterviewPanel
            application={application}
            role={role}
            scholarshipTitle={application.scholarshipTitle || scholarship?.title || ''}
            workspace={interviewWorkspace}
            draft={interviewDraft}
            onDraftChange={setInterviewDraft}
            onResetDraft={() => {
              setInterviewDraft(createInterviewDraft(application, applicationPanelists));
              setInterviewShowErrors(false);
            }}
            errors={interviewErrors}
            showErrors={interviewShowErrors}
            onShowErrors={() => setInterviewShowErrors(true)}
          />
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

        {showDeliberationField ? (
          <div className="grid gap-1">
            <label className="grid gap-1 text-sm text-app-text">
              <span className="font-semibold">{isAdmissionsHead ? 'Sub-committee note' : 'Recommendation note'}</span>
              <textarea rows="2" value={deliberationNote} onChange={(event) => setDeliberationNote(event.target.value)} placeholder={isAdmissionsHead ? 'Record the sub-committee deliberation.' : 'What the approver should know about this recommendation.'} />
            </label>
            <p className="m-0 text-xs text-app-muted">
              {latestPanelRecommendation
                ? `Panel recommendation: ${[
                  latestPanelRecommendation.label,
                  latestPanelRecommendation.authorName,
                  latestPanelRecommendation.createdAt ? fmtDate(latestPanelRecommendation.createdAt) : '',
                ].filter(Boolean).join(' · ')}`
                : 'No panel recommendation recorded yet. The Interview tab records it with the panel’s evaluation note.'}
            </p>
          </div>
        ) : null}

        {actionError ? (
          <p className="m-0 rounded-[14px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200" role="alert">
            {actionError}
          </p>
        ) : null}

        {nextStatuses.length ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {canReject ? <Button className="max-w-full" type="button" variant="danger" disabled={actionBusy} onClick={() => runAction('Rejected')}>{getStageActionLabel('Rejected', role)}</Button> : null}
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              {/* The footer carries no visible stage notice: the header badge, the
                  Documents tab badge, and each disabled button's title report the
                  gate on screen. This hidden text keeps the reason available to
                  assistive tech, where a dimmed button alone says nothing. */}
              {forwardStatuses.map((status) => {
                const reason = blockReasonFor(status);
                if (!reason) return null;
                return (
                  <span key={`block-${status}`} id={`review-block-${status}`} className="sr-only">
                    {`${reason} first.`}
                  </span>
                );
              })}
              {forwardStatuses.map((status, index) => {
                const reason = blockReasonFor(status);
                return (
                  <Button
                    key={status}
                    type="button"
                    variant={index === forwardStatuses.length - 1 ? 'primary' : 'secondary'}
                    disabled={Boolean(reason) || actionBusy}
                    title={reason || undefined}
                    aria-describedby={reason ? `review-block-${status}` : undefined}
                    onClick={() => runAction(status)}
                  >
                    {actionBusy && status === 'Interview' ? 'Scheduling…' : getStageActionLabel(status, role)}
                  </Button>
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
        label="Reason for rejection (staff only)"
        hint="Recorded in the internal notes for the office. The applicant only sees a general notice that the application was not accepted."
        confirmLabel="Reject application"
        onConfirm={async (note) => {
          const result = onRejectApplication
            ? await onRejectApplication(application.id, note)
            : { error: 'Rejection is not available on this page.' };
          if (result?.error) return result;
          setRejectReasonOpen(false);
          onClose();
          return result;
        }}
        onClose={() => setRejectReasonOpen(false)}
      />
    ) : null}
    {documentRejectTarget ? (
      <ReasonModal
        title="Revert document for resubmission"
        label="What the student must correct"
        hint={`The student sees this note for “${documentRejectTarget.title}” so they can upload a correct replacement. The recorded decision stays Rejected.`}
        options={getDocumentRejectionReasons(documentRejectTarget.documentType)}
        notesHint="Add details, such as which page or value needs correcting."
        confirmLabel="Revert for resubmission"
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

    {leaveOpen ? (
      <ReasonModal
        title="Leave this case"
        label="Reason"
        hint="Recorded on the case-officer roster. Leaving does not change the application status; the case stays in the office's open work."
        confirmLabel="Leave case"
        onConfirm={async (reason) => {
          const result = await onLeaveCase?.(application.id, reason);
          if (result?.error) {
            setLeaveError(result.error);
            return;
          }
          setLeaveOpen(false);
        }}
        onClose={() => setLeaveOpen(false)}
      />
    ) : null}
    </>
  );
}
