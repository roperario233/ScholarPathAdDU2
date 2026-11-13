import { useEnsureCaseDetails } from '../lib/caseDetailsContext';
import { useEffect, useRef, useState } from 'react';
import { Award, CalendarClock, CheckCircle2, ClipboardCheck, FileText, GraduationCap, History as HistoryIcon, Info, LayoutGrid, MessageSquareText, TriangleAlert, UserRound, Users, Wallet } from 'lucide-react';
import { Button, ModalShell, Panel, StatusBadge } from './ui';
import DocumentPreviewModal, { DocumentPreview, useDocumentPreviewUrl } from './DocumentPreviewModal';
import ReasonModal from './ReasonModal';
import VerifyDocumentModal from './VerifyDocumentModal';
import { DocumentVerificationItem, ProfileSnapshotList, RequirementStateBadge, SopStageTrack, StatusHistoryList } from './ApplicationParts';
import ApplicationPrintButton from './ApplicationPrintSheet';
import { FinancialDetailsNotice, useApplicationFinancialSections } from './ApplicationFinancialDetails';
import { REVIEW_ROLE_LABELS, buildProgramScopeIndex, getApproverRoleForApplication, isReviewerRole } from '../lib/reviewScope';
import AdminOverrideNotice from './AdminOverrideNotice';
import EndorsementCasePanel from './EndorsementCasePanel';
import EndorsementDecisionModal from './EndorsementDecisionModal';
import InterviewPanel from './InterviewPanel';
import GrantAmountPanel from './GrantAmountPanel';
import FinalCheckToggle from './FinalCheckToggle';
import StageOutcomeCard, { StageMoveStrip } from './StageOutcomeCard';
import { describeGrantAmount, getGrantAmountForApplication, isGrantAmountEditableStage, isGrantAmountStage } from '../lib/grantAmount';
import { AUTOMATIC_STAGE_STATUSES, CASE_OFFICER_JOINABLE_STATUSES, RESULTS_LANE_STATUSES, getApplicationStatusLabel, getDocumentRejectionReasons, getDocumentStatusLabel, getDocumentTypeLabel, getNextApplicationStatuses, getStageActionLabel, isAdmissionsAdminRole, isAdminOverrideAction, isAdmissionsReviewerRole, sopStageIndex } from '../lib/constants';
import { ENDORSEMENT_BLOCKED_STATUSES, applyLiveVerificationsToSnapshot, areApplicationDocumentsVisible, areEndorsementRecordsVisible, describeRequirementTypes, getApplicantPhotoDocument, getApplicationLiveAttributeVerifications, getApplicationReadiness, getDocumentVerificationReadiness, getLinkedDocuments, getResidencePhotoDocuments } from '../lib/applicationRequirements';
import { getApplicationComments } from '../lib/endorsement';
import { getCaseOfficers, getReviewStageTab, isCaseOfficer } from '../lib/admissionsOffice';
import { describeAttributeVerification, getAttributeVerificationLabel, getAttributeVerificationTone } from '../lib/verification';
import { fmtCurrency, fmtDate } from '../lib/formatters';
import { createInterviewDraft, getLatestPanelRecommendation, validateInterviewSchedule } from '../lib/interview';
import { describeStageOutcome } from '../lib/stageOutcome';
import RequestDocumentsModal from './RequestDocumentsModal';
import { useDocumentRequests } from '../lib/documentRequestsContext';
import { DOCUMENT_REQUEST_STATUS_LABELS, canRequestDocuments, describeDocumentRequest, getDocumentRequestsForApplication, getRequestableRequirements } from '../lib/documentRequests';

const TERMINAL_STATUSES = ['Released', 'Rejected', 'Declined'];
// SOP step 5 onward: the Interview tab appears once the Office of Admissions &
// Aid has endorsed the application and stays readable afterwards.
const INTERVIEW_TAB_STATUSES = ['Endorsed', 'Interview', 'Recommended', 'Approved', 'Waitlisted', 'Released', 'Declined'];
const WIDE_QUERY = '(min-width: 1024px)';

const statusTone = (status) => {
  if (['Released', 'Approved'].includes(status)) return 'success';
  if (status === 'Rejected') return 'danger';
  if (status === 'Waitlisted') return 'warning';
  if (status === 'Declined') return 'neutral';
  return 'info';
};
const verificationTone = (status) => (status === 'Verified' ? 'success' : status === 'Rejected' ? 'danger' : 'warning');
const sectionHeading = 'm-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted';

// A glyph per tab, so the strip reads at a glance and a tab keeps its place when
// a stage adds or removes its neighbours.
const TAB_ICONS = {
  overview: LayoutGrid,
  profile: UserRound,
  documents: FileText,
  interview: CalendarClock,
  evaluation: ClipboardCheck,
  endorsement: MessageSquareText,
  grant: Award,
  history: HistoryIcon,
};

// Initials in a soft gradient disc: the applicant's face is a file, not a profile
// photo (which staff never read), so the header carries their initials instead.
function Initials({ name }) {
  const letters = String(name || '?').split(/[\s,]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  return (
    <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-ateneo-bright to-ateneo-strong text-base font-bold text-white shadow-md shadow-blue-900/20">
      {letters}
    </span>
  );
}

// A panel heading with a tinted icon, in the small-caps style the modal already uses.
function SectionTitle({ icon: Icon, children }) {
  return (
    <h4 className={`${sectionHeading} flex items-center gap-2`}>
      {Icon ? <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300"><Icon size={14} /></span> : null}
      {children}
    </h4>
  );
}

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
        const TabIcon = TAB_ICONS[tab.key];
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
            className={`-mb-px inline-flex min-h-10 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-t-lg border-b-2 px-3 text-sm font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 lg:min-h-10 ${selected ? 'border-ateneo bg-blue-500/10 text-app-text dark:border-sky-400' : 'border-transparent text-app-muted hover:bg-blue-500/5 hover:text-app-text'}`}
          >
            {TabIcon ? <TabIcon size={15} aria-hidden="true" className={`shrink-0 transition-colors duration-200 ${selected ? 'text-ateneo dark:text-sky-300' : 'text-app-muted'}`} /> : null}
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
function FactTile({ label, value, verification, currentValue, icon: Icon = null, progress = null }) {
  return (
    <div className="grid content-start gap-1.5 rounded-2xl border border-app-border bg-app-surface p-4 transition-shadow duration-200 hover:shadow-card">
      <div className="flex items-center gap-2">
        {Icon ? <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300"><Icon size={15} /></span> : null}
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">{label}</span>
      </div>
      <strong className="text-lg leading-snug text-app-text">{value || 'Not encoded'}</strong>
      {progress != null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-app-border" aria-hidden="true">
          <div className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${progress >= 1 ? 'bg-emerald-500' : 'bg-gradient-to-r from-ateneo-strong via-ateneo to-ateneo-bright'}`} style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      {verification ? <StatusBadge tone={getAttributeVerificationTone(verification)} title={describeAttributeVerification(getAttributeVerificationLabel(verification))}>{getAttributeVerificationLabel(verification)}</StatusBadge> : null}
      {currentValue ? <span className="text-xs text-amber-700 dark:text-amber-200">Profile now: {currentValue}</span> : null}
    </div>
  );
}

// The left edge of a requirement or file row says where it stands before it is read.
const DOCUMENT_EDGE_TONES = {
  Verified: 'border-l-emerald-500',
  Rejected: 'border-l-rose-500',
  Pending: 'border-l-amber-400',
};

function DocumentRow({ doc, selected, onSelect }) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(doc)}
        className={`flex w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-l-4 px-3 py-2 text-left transition-colors duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 ${DOCUMENT_EDGE_TONES[doc.verificationStatus] || 'border-l-app-border'} ${selected ? 'border-ateneo/60 bg-ateneo/10 dark:border-sky-400/60' : 'border-app-border bg-app-card hover:bg-blue-500/5'}`}
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
  // The approving level's third outcome (Consultation 2 follow-up): the optional
  // note is staff-only, like a rejection reason (App.jsx waitlistApplication).
  onWaitlistApplication,
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
  // The Admin's final-check tick for an approved case (Final check and release):
  // `{ checked, grant, onChange }`. Shown in the footer so it sits beside the
  // stage actions; without it the footer is unchanged.
  finalCheck = null,
}) {
  // A staff session loads each case's history after the first screen; opening a case
  // fetches its own immediately instead of waiting for the full read.
  useEnsureCaseDetails(application?.id);
  // Since Consultation 2 the Admin verifies the files, forwards the case to the
  // interviewers of its scope, and does the final check and release; Staff read
  // the office workspace without acting. A scoped reviewer (an interviewer or a
  // ladder account) schedules and recommends, and the school's approving level
  // approves; getNextApplicationStatuses decides each move from the case facts.
  const isAdmissionsAdmin = isAdmissionsAdminRole(role);
  const isAdmissionsReviewer = isAdmissionsReviewerRole(role);
  const stageContext = interviewWorkspace?.stageContextFor?.(application) || {};
  // Who may schedule this applicant's interview: an interviewer or ladder
  // account in scope, or the Admin (App.jsx canCoordinateInterview). Without the
  // workspace's answer only the Admin coordinates.
  const canCoordinateInterview = interviewWorkspace?.canCoordinate
    ? Boolean(interviewWorkspace.canCoordinate(application))
    : isAdmissionsAdmin;
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
    if (!isAdmissionsAdmin || !onJoinCase) return;
    if (!CASE_OFFICER_JOINABLE_STATUSES.includes(application.status)) return;
    if (isCaseOfficer(caseOfficers, application.id, currentUserId)) return;
    if (joinAttemptedRef.current) return;
    joinAttemptedRef.current = true;
    Promise.resolve(onJoinCase(application.id)).catch(() => undefined);
  }, [application.id, application.status, caseOfficers, currentUserId, isAdmissionsAdmin, onJoinCase]);

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
  const { requests: allDocumentRequests, ready: documentRequestsReady, onRequest: onRequestDocuments, onCancel: onCancelDocumentRequest } = useDocumentRequests();
  const { outstanding: outstandingDocuments, verified: verifiedDocuments, total: totalDocuments, openRequests: openRequestCount } = getDocumentVerificationReadiness(application, documents, allDocumentRequests);
  const blockedByDocuments = outstandingDocuments > 0;
  // An additional-documents request the Admin raised holds the case at
  // verification until the student answers it or the Admin cancels it
  // (enforce_document_verification_before_progress repeats the rule).
  const blockedByRequests = openRequestCount > 0;
  const documentRequests = getDocumentRequestsForApplication(allDocumentRequests, application.id);
  const canRequestMore = isAdmissionsAdmin && Boolean(onRequestDocuments)
    && documentRequestsReady && canRequestDocuments(application.status);
  const requestBlockReason = `${openRequestCount} document request${openRequestCount === 1 ? ' is' : 's are'} still waiting for the student`;
  // SOP step 3 gates the Document Vault review: an application's attached files
  // stay out of reach until it reaches the verification stage, and a rejected
  // application keeps them readable for its recorded decision.
  const documentsUnlocked = areApplicationDocumentsVisible(application.status);
  // Since Consultation 2 only the Admin verifies files, so the Documents tab is
  // hidden from every other role (Staff, interviewers, and the reviewer ladder).
  const documentsTabVisible = documentsUnlocked && isAdmissionsAdmin;
  // SOP step 4 starts when the Admissions Office hands the case to the Admin for
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
  // The evaluation notes were part of the Interview tab; they now have their own
  // tab, available to the same roles under the same stage gate.
  const applicationNotes = (interviewWorkspace?.notes || []).filter((note) => note.applicationId === application.id);
  const evaluationTabVisible = interviewUnlocked && (isAdmissionsReviewer || isReviewerRole(role));
  const recommendationDue = application.status === 'Interview'
    && Boolean(stageContext.isPanelist)
    && !latestPanelRecommendation;
  // The recorded grant amount: the school's approving level or the Admissions
  // Office Admin sets it while the case is Recommended or Approved, and Staff read
  // it. Any other reviewer never sees the tab.
  const grantRecord = getGrantAmountForApplication(interviewWorkspace?.grantAmounts, application.id);
  const canEditGrantAmount = (isAdmissionsAdmin || Boolean(stageContext.isApprover))
    && Boolean(interviewWorkspace?.onSaveGrantAmount)
    && isGrantAmountEditableStage(application.status, { isAdmin: isAdmissionsAdmin });
  const grantTabVisible = Boolean(interviewWorkspace)
    && isGrantAmountStage(application.status)
    && (isAdmissionsReviewer || Boolean(stageContext.isApprover));
  const finalCheckToggle = finalCheck && isAdmissionsAdmin ? (
    <FinalCheckToggle checked={finalCheck.checked} grant={finalCheck.grant} onChange={finalCheck.onChange} showHint={false} />
  ) : null;
  const [interviewDraft, setInterviewDraft] = useState(() => createInterviewDraft(application, applicationPanelists));
  const [interviewShowErrors, setInterviewShowErrors] = useState(false);
  const interviewErrors = validateInterviewSchedule(interviewDraft, {
    autoMeeting: Boolean(interviewWorkspace?.calendarConfigured) && interviewDraft.mode === 'online' && !String(interviewDraft.meetingUrl || '').trim(),
    activeLocationIds: (interviewWorkspace?.locations || []).filter((entry) => entry.isActive).map((entry) => entry.id),
  });

  const [activeTab, setActiveTab] = useState(() => {
    if (initialTab === 'documents' && !documentsTabVisible) return 'overview';
    if (initialTab === 'evaluation' && !evaluationTabVisible) return 'overview';
    if (initialTab) return initialTab;
    // Open on the stage the application is in, so the reviewer lands on the work
    // that stage needs: the files at For Verification, the endorsement record at
    // For Endorsement, the schedule from Endorsed on.
    const stageTab = getReviewStageTab(application.status);
    if (stageTab === 'documents' && documentsTabVisible) return 'documents';
    if (stageTab === 'endorsement' && endorsementUnlocked) return 'endorsement';
    if (stageTab === 'interview' && interviewUnlocked) return 'interview';
    return documentsTabVisible && blockedByDocuments ? 'documents' : 'overview';
  });
  const [selectedDocId, setSelectedDocId] = useState(() => (
    (linkedDocuments.find((doc) => doc.verificationStatus !== 'Verified') || linkedDocuments[0])?.id || null
  ));
  const [actionBusy, setActionBusy] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [rejectReasonOpen, setRejectReasonOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [documentRejectTarget, setDocumentRejectTarget] = useState(null);
  // Additional-document requests: the dialog (optionally preset to one requirement)
  // and the request whose cancellation is being recorded.
  const [requestDialog, setRequestDialog] = useState(null);
  const [cancelRequestTarget, setCancelRequestTarget] = useState(null);
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
  // The last stage move this surface recorded ({ fromStatus, toStatus, warning }).
  // Its card replaces the tab panel until the reviewer moves on, and the list the
  // modal closes onto reads it to say where the case went.
  const [stageMove, setStageMove] = useState(null);
  const [showStageMove, setShowStageMove] = useState(false);
  const recordStageMove = (toStatus, warning = '') => {
    setActionError('');
    setStageMove({ fromStatus: application.status, toStatus, warning: warning || '' });
    setShowStageMove(true);
    // A move whose next work sits in this modal (the files at verification, the
    // schedule from For Interview on) lands on that tab, with a one-line strip
    // saying why. A move that hands the case on shows the outcome card instead.
    const stageTab = getReviewStageTab(toStatus);
    if (stageTab !== 'overview') setActiveTab(stageTab);
  };
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
    setActionError('');
    Promise.resolve(onChangeDocument?.(documentId, status))
      .then((result) => { if (result?.error) setActionError(result.error); })
      .catch(() => undefined);
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
      const toStatus = endorsementDecision.mode === 'handoff' ? 'For Endorsement' : 'Endorsed';
      setEndorsementDecision(null);
      // The outcome card says where the case went; the review surface stays open.
      recordStageMove(toStatus);
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
    ...(documentsTabVisible ? [{
      key: 'documents',
      label: 'Documents',
      badge: blockedByDocuments ? `${outstandingDocuments} to verify` : blockedByRequests ? `${openRequestCount} requested` : linkedDocuments.length,
      alert: blockedByDocuments || blockedByRequests,
    }] : []),
    // SOP step 5: the schedule, the panel from the applicant's school, and the
    // private evaluation notes.
    ...(interviewUnlocked ? [{
      key: 'interview',
      label: 'Interview',
      // An interviewer's scheduling is due work; for the Admin it is the
      // interviewer's step, so the tab says so instead of raising an alert.
      badge: canCoordinateInterview && application.status === 'Endorsed'
        ? (isAdmissionsAdmin ? 'Interviewer schedules' : 'Schedule due')
        : null,
      alert: canCoordinateInterview && application.status === 'Endorsed' && !isAdmissionsAdmin,
    }] : []),
    // SOP step 5-6: the panel's evaluation notes and recommendation level. It is
    // its own tab so the Interview tab stays about the schedule and the panel.
    ...(evaluationTabVisible ? [{
      key: 'evaluation',
      label: 'Evaluation',
      badge: recommendationDue ? 'Recommendation due' : (applicationNotes.length || null),
      alert: recommendationDue,
    }] : []),
    // The forwarding record and the internal thread. It is visible from the first
    // stage, so the office can leave a note on a case at any point, and it stays
    // readable afterwards.
    {
      key: 'endorsement',
      label: 'Case notes',
      badge: application.status === 'For Endorsement' ? 'Decision due' : (caseNotes.length || null),
      alert: application.status === 'For Endorsement',
    },
    // The approving level's recorded grant figure (Recommended, Approved, Released).
    ...(grantTabVisible ? [{
      key: 'grant',
      label: 'Grant amount',
      badge: canEditGrantAmount && !grantRecord ? 'To set' : null,
      alert: canEditGrantAmount && !grantRecord,
    }] : []),
    { key: 'history', label: 'History', badge: statusLog.length || (application.timeline || []).length || null },
  ];
  // A selection pointing at a tab that is not shown (for example right after a
  // status write) falls back to the overview instead of an empty panel.
  const visibleActiveTab = tabs.some((tab) => tab.key === activeTab) ? activeTab : 'overview';
  // The recorded move, described against the application as it is now (so a new
  // interview record or stage is read after the write). The card only offers a
  // tab this reviewer can open.
  const stageOutcome = (() => {
    if (!stageMove) return null;
    const described = describeStageOutcome({
      application,
      fromStatus: stageMove.fromStatus,
      toStatus: stageMove.toStatus,
      approverRole: stageMove.toStatus === 'Recommended' && interviewWorkspace
        ? getApproverRoleForApplication(
          application,
          interviewWorkspace.approvalLevels || [],
          buildProgramScopeIndex(interviewWorkspace.academicPrograms || []),
        )
        : '',
      totalFiles: totalDocuments,
      warning: stageMove.warning,
    });
    if (!described) return null;
    return tabs.some((tab) => tab.key === described.goTab) ? described : { ...described, goTab: null };
  })();
  // The move continues in this modal when its stage tab is the one on screen: the
  // tab itself is the result, so only a strip explains the change. Otherwise the
  // case has left this reviewer's hands and the outcome card says where it went.
  const movedInPlace = showStageMove && Boolean(stageOutcome?.goTab) && stageOutcome.goTab === visibleActiveTab;
  const showingOutcome = showStageMove && Boolean(stageOutcome) && !movedInPlace;
  const panelTab = showingOutcome ? null : visibleActiveTab;
  // Every way out of the modal (Done, Close, Escape, the backdrop) tells the page
  // what moved, so the list can point at the case or say where it went.
  const closeReview = () => onClose?.(stageOutcome ? { outcome: stageOutcome } : undefined);
  const selectTab = (key) => {
    setShowStageMove(false);
    setActiveTab(key);
  };

  // Action bar: one button per transition the role may take, read once from
  // getNextApplicationStatuses. Rejection sits apart on the left; when several
  // forward moves are allowed, the furthest one is the primary action. Moves the
  // surface performs itself (opening an application starts its review) never
  // render as buttons.
  // Results are released per scholarship from the Admin's final-check lane, so a
  // single case never releases on its own (Consultation 2, #8 and #13).
  // The offers, promotions, and recorded declines belong to that lane too
  // (RESULTS_LANE_STATUSES), and the waitlist sits beside Not accepted on the left.
  const forwardStatuses = nextStatuses.filter((status) => (
    status !== 'Rejected' && status !== 'Waitlisted' && !RESULTS_LANE_STATUSES.includes(status)
    && !AUTOMATIC_STAGE_STATUSES.includes(status)
    && (status !== 'Interview' || canCoordinateInterview)
  ));
  const canReject = nextStatuses.includes('Rejected');
  const canWaitlist = nextStatuses.includes('Waitlisted') && application.status === 'Recommended';
  // A sibling on AdDU financial aid no longer blocks the application; it is the
  // approver's cue to consider the waitlist instead.
  const declaredSiblingOnAid = Boolean(application.profileSnapshot?.eligibility?.hasSiblingOnAid);
  // The recommendation belongs to the panel and the approval to the school's
  // approving level (Consultation 2); the Admin's version of either move is an
  // override, so the footer says who the move normally belongs to. Scheduling is
  // flagged in the Interview tab.
  const adminOverrideNote = (() => {
    if (!isAdmissionsAdmin) return '';
    if (forwardStatuses.includes('Recommended')) return 'The interview panel records the recommendation.';
    if (forwardStatuses.includes('Approved')) {
      const approver = interviewWorkspace
        ? getApproverRoleForApplication(
          application,
          interviewWorkspace.approvalLevels || [],
          buildProgramScopeIndex(interviewWorkspace.academicPrograms || []),
        )
        : '';
      return approver
        ? `The school's ${REVIEW_ROLE_LABELS[approver] || 'approving level'} decides this recommendation.`
        : 'The school’s approving level decides this recommendation.';
    }
    return '';
  })();
  const showDeliberationField = nextStatuses.includes('Recommended');
  // Every recommendation, the Admin's override included, carries one of the five
  // recommendation levels (Consultation 2, #7), recorded with an evaluation note
  // in the Evaluation tab.
  const needsRecommendationLevel = !latestPanelRecommendation;
  // Why the Documents tab is not shown yet, phrased for the role that is reading
  // it. It appears with the action guidance at the verification gate.
  const lockedDocumentsMessage = !isAdmissionsAdmin
    ? 'Documents become available at verification.'
    : linkedDocuments.length
      ? `Continue to verification to review its ${linkedDocuments.length} attached file${linkedDocuments.length === 1 ? '' : 's'}${requirements.length ? ` against ${requirements.length} required submission${requirements.length === 1 ? '' : 's'}` : ''}.`
      : 'No files attached. Continue to verification to begin document review.';
  const blockReasonFor = (status) => {
    if (blockedByDocuments && ENDORSEMENT_BLOCKED_STATUSES.includes(status)) return documentBlockReason;
    if (blockedByRequests && ENDORSEMENT_BLOCKED_STATUSES.includes(status)) return requestBlockReason;
    if (status === 'Recommended' && needsRecommendationLevel) return 'Record a recommendation level in the Evaluation tab';
    return '';
  };
  const runAction = async (status) => {
    if (status === 'Rejected') {
      // A rejection must carry a recorded reason. The reason stays with the
      // office (internal notes); the student receives the general notice.
      setRejectReasonOpen(true);
      return;
    }
    if (status === 'Waitlisted') {
      setWaitlistOpen(true);
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
        result = await onRecordDeliberation?.(application.id, 'Recommended');
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
    // Every move stays on screen with its outcome card (what changed, who holds
    // the case now, what happens next) instead of closing the modal or jumping to
    // another tab. The card offers the stage's tab, and Done closes onto the list.
    // A calendar warning from closing the interview is reported there too.
    recordStageMove(status, result?.warning);
  };
  // A pointer for the Overview: the one thing this reviewer can do next from here,
  // with a link to the tab that holds it. It only restates facts the footer and the
  // tabs already carry (document gate, due recommendation, due scheduling, the
  // approver's grant figure); it never grants or hides an action.
  const nextUp = (() => {
    if (stageMove && showStageMove) return null;
    if (documentsTabVisible && blockedByDocuments && application.status === 'For Verification') {
      return { tone: 'warning', title: documentBlockReason, detail: 'Verify or revert each attached file before the case can go to interview.', tab: 'documents', action: 'Open documents' };
    }
    if (documentsTabVisible && blockedByRequests && application.status === 'For Verification') {
      return { tone: 'warning', title: requestBlockReason, detail: 'Verify the new files when the student adds them, or cancel the request, before the case can go to interview.', tab: 'documents', action: 'Open documents' };
    }
    if (recommendationDue && evaluationTabVisible) {
      return { tone: 'warning', title: 'Your recommendation is due', detail: 'Add an evaluation note and choose a recommendation level before the case can move on.', tab: 'evaluation', action: 'Open evaluation' };
    }
    if (application.status === 'Endorsed' && canCoordinateInterview && !isAdmissionsAdmin && interviewUnlocked) {
      return { tone: 'warning', title: 'Schedule the interview', detail: 'Choose the date, mode, and panel in the Interview tab, then confirm with Schedule interview.', tab: 'interview', action: 'Open interview' };
    }
    if (grantTabVisible && canEditGrantAmount && !grantRecord) {
      return { tone: 'warning', title: 'No grant amount recorded yet', detail: 'Record a coverage percent, an amount per semester, or both.', tab: 'grant', action: 'Open grant amount' };
    }
    return null;
  })();
  const idleMessage = TERMINAL_STATUSES.includes(application.status)
    ? 'This application has reached a terminal stage.'
    : isAdmissionsAdmin
      ? (application.status === 'Recommended'
        ? "Awaiting the approval of the applicant's school."
        : application.status === 'Approved'
          ? 'Release this result with its scholarship from Final check and release.'
          : application.status === 'Waitlisted'
            ? 'On the waitlist. Offer a slot or close the waitlist from Final check and release.'
            : 'No stage action is available at this stage.')
      : !isReviewerRole(role)
        ? 'Admissions Office Staff have a read-only view of applications.'
        : ['Submitted', 'Under Review', 'For Verification', 'For Endorsement'].includes(application.status)
          ? 'The Admissions Office Admin verifies the documents before the interview.'
          : application.status === 'Interview'
            ? 'Only a member of this interview panel records the recommendation.'
            : application.status === 'Recommended'
              ? "The approving level for the applicant's school decides this recommendation."
              : application.status === 'Approved'
                ? 'Approved. The Admissions Office Admin does the final check and releases the results.'
                : application.status === 'Waitlisted'
                  ? 'Waitlisted. The Admissions Office Admin orders the waitlist and offers any slot that opens.'
                  : 'No stage action is available to your role at this stage.';

  return (
    <>
    <ModalShell
      title={`${application.scholarshipTitle} - Application`}
      onClose={closeReview}
      className="application-review-modal"
      header={(
        <div className="card-header mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 min-w-0 flex-1">{application.scholarshipTitle} - Application</h2>
          <div className="shrink-0"><Button variant="secondary" type="button" onClick={closeReview}>Close</Button></div>
        </div>
      )}
    >
      <header className="mb-3 grid shrink-0 gap-3 rounded-2xl border border-app-border bg-gradient-to-br from-blue-500/10 via-app-surface to-app-surface p-4">
        <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 w-full items-center gap-3 sm:w-auto sm:flex-1">
            <Initials name={application.studentName} />
            <div className="min-w-0">
              <h3 className="m-0 text-lg font-semibold leading-tight [overflow-wrap:anywhere]">{application.studentName}</h3>
              <p className="m-0 mt-0.5 text-sm text-app-muted">{application.studentProgram || 'Program on file'} · {application.studentSchool || 'School on file'}</p>
            </div>
          </div>
          <StatusBadge tone={statusTone(application.status)} className="shrink-0 whitespace-nowrap !px-3.5 !py-1 !text-sm">{getApplicationStatusLabel(application.status)}</StatusBadge>
        </div>
        {sopStageIndex(application.status) != null ? <SopStageTrack status={application.status} /> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-app-muted">
          <span className="inline-flex items-center gap-1.5"><CalendarClock size={13} aria-hidden="true" />Submitted {application.submittedAt ? fmtDate(application.submittedAt) : 'not yet'}</span>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} aria-hidden="true" />Certified {application.certifiedAt ? fmtDate(application.certifiedAt) : 'not yet'}</span>
          {totalDocuments ? (
            documentsUnlocked ? (
              <StatusBadge tone={blockedByDocuments ? 'warning' : 'success'}>{verifiedDocuments}/{totalDocuments} documents verified</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">{totalDocuments} document{totalDocuments === 1 ? '' : 's'} attached · reviewed at verification</StatusBadge>
            )
          ) : <StatusBadge tone="neutral">No documents attached</StatusBadge>}
          {isAdmissionsAdmin ? (
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

      <ReviewTabs tabs={tabs} active={visibleActiveTab} onChange={selectTab} />

      <div
        // Keyed by tab, so a new tab eases in from the top of its panel; the
        // interview and evaluation tabs share one key because they are one
        // component, and a note being typed must survive a glance at the schedule.
        key={panelTab === 'evaluation' ? 'interview' : (panelTab || 'outcome')}
        className={`application-review-modal-body profile-section-enter pt-4${panelTab === 'documents' ? ' application-review-modal-body--split' : ''}`}
        role="tabpanel"
        id={`review-panel-${visibleActiveTab}`}
        aria-labelledby={`review-tab-${visibleActiveTab}`}
      >
        {showingOutcome ? (
          <StageOutcomeCard outcome={stageOutcome} onDone={closeReview} />
        ) : null}
        {movedInPlace ? (
          <StageMoveStrip outcome={stageOutcome} onDismiss={() => setShowStageMove(false)} />
        ) : null}

        {panelTab === 'overview' && (
          <div className="grid content-start gap-4">
            {application.openedByOfficeAt ? (
              <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-800 dark:text-amber-100" role="note">
                Opened by the Admissions Office on {fmtDate(application.openedByOfficeAt)} as an eligibility exception:
                the qualification rules were waived for this application. The recorded reason is in the internal notes.
              </div>
            ) : null}
            {nextUp ? (
              <div className={`flex min-w-0 flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${nextUp.tone === 'warning' ? 'border-amber-400/40 bg-amber-400/10' : 'border-blue-500/30 bg-blue-500/10'}`} role="note">
                <div className="flex min-w-0 items-start gap-3">
                  {nextUp.tone === 'warning'
                    ? <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-200" />
                    : <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-blue-700 dark:text-blue-300" />}
                  <div className="grid min-w-0 gap-0.5">
                    <strong className="text-sm text-app-text">{nextUp.title}</strong>
                    <span className="text-sm text-app-muted">{nextUp.detail}</span>
                  </div>
                </div>
                {nextUp.tab ? <Button type="button" variant="secondary" className="shrink-0" onClick={() => selectTab(nextUp.tab)}>{nextUp.action}</Button> : null}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <FactTile icon={GraduationCap} {...academicFact} />
              <FactTile icon={Wallet} {...incomeFact} />
              <FactTile icon={Users} label="Year standing" value={snapshot?.yearStandingLabel || ''} />
              <FactTile icon={FileText} label="Document status" value={totalDocuments ? `${verifiedDocuments} of ${totalDocuments} verified` : 'None attached'} progress={totalDocuments && documentsUnlocked ? verifiedDocuments / totalDocuments : null} />
            </div>
            {snapshot ? <p className="m-0 text-xs text-app-muted">Self-reported at submission. Badges show the Document Vault proof attached now, including the latest review decision; “Profile now” marks a value changed since.</p> : null}
            <Panel className="grid content-start gap-3">
              <SectionTitle icon={MessageSquareText}>Application statement/essay</SectionTitle>
              <p className="m-0 whitespace-pre-line border-l-4 border-blue-500/30 pl-4 text-sm leading-relaxed text-app-text">{application.statement || 'No statement recorded.'}</p>
            </Panel>
          </div>
        )}

        {panelTab === 'documents' && (
          linkedDocuments.length || requirements.length ? (
            <div className="application-review-documents">
              <div className="application-review-documents-pane">
                {totalDocuments ? (
                  <div className={`grid gap-2 rounded-2xl border p-3 ${blockedByDocuments ? 'border-app-border bg-app-surface' : 'border-emerald-400/40 bg-emerald-500/10'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <strong className="text-sm text-app-text">{blockedByDocuments ? `${verifiedDocuments} of ${totalDocuments} files verified` : `All ${totalDocuments} files verified`}</strong>
                      <span className="text-xs text-app-muted">{blockedByDocuments ? `${outstandingDocuments} still to decide` : blockedByRequests ? 'Waiting for requested documents' : 'Ready to forward'}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-app-border" role="progressbar" aria-valuemin={0} aria-valuemax={totalDocuments} aria-valuenow={verifiedDocuments} aria-label="Files verified">
                      <div className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${blockedByDocuments ? 'bg-gradient-to-r from-ateneo-strong via-ateneo to-ateneo-bright' : 'bg-emerald-500'}`} style={{ width: `${Math.round((verifiedDocuments / totalDocuments) * 100)}%` }} />
                    </div>
                  </div>
                ) : null}
                {canRequestMore ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-app-muted">Need more from the student? Ask for extra files or another document.</span>
                    <Button type="button" className="!min-h-8 !px-3 !py-1 !text-xs" onClick={() => setRequestDialog({})}>Request more documents</Button>
                  </div>
                ) : null}
                {requirements.length ? (
                  <section className="grid gap-2">
                    <SectionTitle icon={ClipboardCheck}>Required submissions</SectionTitle>
                    <ul className="m-0 grid gap-3 p-0">
                      {requirements.map((requirement) => (
                        <li key={requirement.id} className={`grid gap-2 rounded-2xl border border-app-border bg-app-surface p-3 ${canRequestMore && getRequestableRequirements([requirement]).length ? 'pb-2' : ''}`}>
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
                          {canRequestMore && getRequestableRequirements([requirement]).length ? (
                            <button
                              type="button"
                              className="proof-action justify-self-start !min-h-0 !py-0.5 text-xs"
                              onClick={() => setRequestDialog({ kind: 'more_files', requirementId: requirement.id })}
                            >
                              Request more files
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {documentRequests.length ? (
                  <section className="grid gap-2" aria-label="Requested from the student">
                    <SectionTitle icon={MessageSquareText}>Requested from the student</SectionTitle>
                    <ul className="m-0 grid gap-2 p-0">
                      {documentRequests.map((request) => {
                        const description = describeDocumentRequest(request);
                        const tone = request.status === 'Open' ? 'warning' : request.status === 'Fulfilled' ? 'success' : 'neutral';
                        return (
                          <li key={request.id} className="grid gap-1.5 rounded-2xl border border-app-border bg-app-surface p-3">
                            <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                              <span className="min-w-0 text-sm font-semibold text-app-text [overflow-wrap:anywhere]">{description.title}</span>
                              <StatusBadge tone={tone}>{DOCUMENT_REQUEST_STATUS_LABELS[request.status] || request.status}</StatusBadge>
                            </div>
                            <span className="text-xs text-app-muted">
                              {[description.summary, description.types, request.createdAt ? `Requested ${fmtDate(request.createdAt)}` : ''].filter(Boolean).join(' · ')}
                            </span>
                            <p className="m-0 whitespace-pre-line text-sm text-app-text [overflow-wrap:anywhere]">{request.note}</p>
                            {request.status === 'Cancelled' && request.cancelReason ? (
                              <span className="text-xs text-app-muted">{`Cancelled: ${request.cancelReason}`}</span>
                            ) : null}
                            {request.status === 'Open' && isAdmissionsAdmin && onCancelDocumentRequest ? (
                              <button type="button" className="proof-action justify-self-start !min-h-0 !py-1 text-xs" onClick={() => setCancelRequestTarget(request)}>Cancel request</button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}
                <section className="grid gap-2">
                  <SectionTitle icon={FileText}>{requirements.length ? 'Supporting documents' : 'Attached documents'}</SectionTitle>
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
                      <SectionTitle icon={CheckCircle2}>Document verification</SectionTitle>
                      {!isAdmissionsAdmin ? <span className="text-xs text-app-muted">Read-only · verified by the Admissions Office Admin</span> : null}
                    </div>
                    <DocumentVerificationItem
                      as="div"
                      doc={selectedDoc}
                      application={application}
                      owner={students[selectedDoc.ownerId] || null}
                      onPreview={isWide ? undefined : setPreviewDoc}
                      onChangeDocument={isAdmissionsAdmin && onChangeDocument ? changeDocument : undefined}
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

        {panelTab === 'profile' && (
          <Panel className="grid gap-1">
            <SectionTitle icon={UserRound}>Profile at submission</SectionTitle>
            <p className="m-0 mb-2 text-xs text-app-muted">The certified record. These badges are the ones the student saw then; the Overview shows the current review decisions.</p>
            <ProfileSnapshotList snapshot={applyLiveVerificationsToSnapshot(application.profileSnapshot, liveVerifications)} applicantPhoto={applicantPhoto} residencePhotos={getResidencePhotoDocuments(application, documents)} onPreviewPhoto={setPreviewDoc} extraSections={financialDetails.sections} />
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

        {panelTab === 'grant' && (
          <GrantAmountPanel
            key={application.id}
            applicationId={application.id}
            record={grantRecord}
            canEdit={canEditGrantAmount}
            status={application.status}
            onSave={interviewWorkspace?.onSaveGrantAmount}
          />
        )}

        {panelTab === 'history' && (
          <div className="grid gap-3">
            {isAdmissionsReviewer ? (
              <Panel className="grid content-start gap-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <SectionTitle icon={Users}>Case officers</SectionTitle>
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
                      <li key={officer.id} className="flex min-w-0 flex-wrap items-center gap-3 border-b border-app-border/60 pb-2 last:border-b-0 last:pb-0">
                        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-500/15 text-xs font-bold text-blue-800 dark:text-blue-200">
                          {String(officer.officerName || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'}
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-semibold text-app-text">{officer.officerName}</span>
                        <span className="text-xs text-app-muted">
                          {officer.officerRole === 'admissions_admin' ? 'Admissions Office Admin' : 'Admissions Office Staff'}
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
              <SectionTitle icon={HistoryIcon}>Status history</SectionTitle>
              <StatusHistoryList
                statusLog={statusLog}
                timeline={application.timeline}
                showActorName={isAdmissionsReviewer || isReviewerRole(role)}
              />
            </Panel>
          </div>
        )}

        {(panelTab === 'interview' || panelTab === 'evaluation') && interviewWorkspace && (
          <InterviewPanel
            view={panelTab}
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

        {panelTab === 'endorsement' && (
          <div className="grid gap-3">
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

      <footer className="application-review-actions mt-1 grid shrink-0 gap-3 rounded-2xl border border-app-border bg-app-surface p-3 shadow-[0_-8px_24px_-16px_rgba(0,20,80,0.35)] sm:p-4">
        {!documentsUnlocked && isAdmissionsAdmin ? (
          <p className="m-0 flex items-start gap-2 rounded-[14px] border border-app-border bg-app-card px-3 py-2 text-sm text-app-muted">
            <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="min-w-0">{lockedDocumentsMessage}</span>
          </p>
        ) : null}

        {showDeliberationField ? (
          <div className="grid gap-1">
            {latestPanelRecommendation ? (
              <p className="m-0 text-xs text-app-muted">
                {`Panel recommendation: ${[
                  latestPanelRecommendation.label,
                  latestPanelRecommendation.authorName,
                  latestPanelRecommendation.createdAt ? fmtDate(latestPanelRecommendation.createdAt) : '',
                ].filter(Boolean).join(' · ')}`}
              </p>
            ) : (
              <p className="m-0 flex items-start gap-2 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100" role="note">
                <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span className="min-w-0">No panel recommendation recorded yet, so Recommend for approval is unavailable. In the Evaluation tab, add an evaluation note and choose a recommendation level.</span>
              </p>
            )}
          </div>
        ) : null}

        {finalCheckToggle ? (
          <div className="grid gap-1">
            {finalCheck.grant ? (
              <p className="m-0 text-xs text-app-muted">
                {`Grant amount: ${describeGrantAmount(finalCheck.grant)}`}
              </p>
            ) : (
              <p className="m-0 flex items-start gap-2 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100" role="note">
                <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span className="min-w-0">No grant amount recorded yet, so the final check is unavailable. In the Grant amount tab, enter a coverage percent, an amount per semester, or both.</span>
              </p>
            )}
          </div>
        ) : null}

        {actionError ? (
          <p className="m-0 flex items-start gap-2 rounded-[14px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200" role="alert">
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="min-w-0">{actionError}</span>
          </p>
        ) : null}

        {adminOverrideNote ? <AdminOverrideNotice>{adminOverrideNote}</AdminOverrideNotice> : null}

        {canWaitlist && declaredSiblingOnAid ? (
          <p className="m-0 flex items-start gap-2 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100" role="note">
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="min-w-0">The applicant declared a sibling on AdDU financial aid. Consider placing this application on the waitlist.</span>
          </p>
        ) : null}

        {nextStatuses.length ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {canReject ? <Button className="max-w-full" type="button" variant="danger" disabled={actionBusy} onClick={() => runAction('Rejected')}>{getStageActionLabel('Rejected', role)}</Button> : null}
              {canWaitlist ? (
                <Button
                  className="max-w-full"
                  type="button"
                  disabled={actionBusy || Boolean(blockReasonFor('Waitlisted'))}
                  title={blockReasonFor('Waitlisted') || undefined}
                  onClick={() => runAction('Waitlisted')}
                >
                  {getStageActionLabel('Waitlisted', role)}
                </Button>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              {finalCheckToggle}
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
                // The Admin's scheduling is a step-in, not the intended flow, so it
                // never takes the primary treatment and explains itself on hover.
                const isOverride = isAdminOverrideAction(status, role);
                return (
                  <Button
                    key={status}
                    type="button"
                    variant={index === forwardStatuses.length - 1 && !isOverride ? 'primary' : 'secondary'}
                    disabled={Boolean(reason) || actionBusy}
                    title={reason || (isOverride ? 'Not the intended flow: use only to step in for the interviewers or the school.' : undefined)}
                    aria-describedby={reason ? `review-block-${status}` : undefined}
                    onClick={() => runAction(status)}
                  >
                    {actionBusy && status === 'Interview' ? 'Scheduling…' : getStageActionLabel(status, role)}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-app-muted">{idleMessage}</p>
            {finalCheckToggle}
          </div>
        )}
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
        title="Mark as not accepted"
        label="Reason (staff only)"
        hint="Recorded in the internal notes for the office. The applicant only receives the general letter when the scholarship's results are closed."
        confirmLabel="Mark not accepted"
        onConfirm={async (note) => {
          const result = onRejectApplication
            ? await onRejectApplication(application.id, note)
            : { error: 'Rejection is not available on this page.' };
          if (result?.error) return result;
          setRejectReasonOpen(false);
          recordStageMove('Rejected');
          return result;
        }}
        onClose={() => setRejectReasonOpen(false)}
      />
    ) : null}
    {waitlistOpen ? (
      <ReasonModal
        title="Place on the waitlist"
        label="Note for the office (staff only)"
        hint="Recorded in the internal notes. The applicant is told only that they are on the waitlist, and never their position."
        confirmLabel="Waitlist"
        confirmVariant="primary"
        optional
        onConfirm={async (note) => {
          const result = onWaitlistApplication
            ? await onWaitlistApplication(application.id, note)
            : { error: 'The waitlist is not available on this page.' };
          if (result?.error) return result;
          setWaitlistOpen(false);
          recordStageMove('Waitlisted');
          return result;
        }}
        onClose={() => setWaitlistOpen(false)}
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
        onConfirm={async (reason) => {
          // Awaited so a failed write is reported in the dialog instead of closing
          // on it.
          const result = await onChangeDocument?.(documentRejectTarget.id, 'Rejected', reason);
          if (result?.error) return result;
          setDocumentRejectTarget(null);
          return result;
        }}
        onClose={() => setDocumentRejectTarget(null)}
      />
    ) : null}
    {requestDialog ? (
      <RequestDocumentsModal
        requirements={requirements}
        initialKind={requestDialog.kind || ''}
        initialRequirementId={requestDialog.requirementId || ''}
        onConfirm={(payload) => onRequestDocuments?.(application.id, payload)}
        onClose={() => setRequestDialog(null)}
      />
    ) : null}
    {cancelRequestTarget ? (
      <ReasonModal
        title="Cancel document request"
        label="Why is this request being cancelled?"
        hint={`Recorded with the request. “${cancelRequestTarget.label}” stops holding the case at verification.`}
        confirmLabel="Cancel request"
        onConfirm={async (reason) => {
          const result = await onCancelDocumentRequest?.(cancelRequestTarget.id, reason);
          if (result?.error) return result;
          setCancelRequestTarget(null);
          return result;
        }}
        onClose={() => setCancelRequestTarget(null)}
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
