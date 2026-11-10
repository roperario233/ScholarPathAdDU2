import { ArrowDown, ArrowUp, Award, CheckCircle2, ChevronDown, Gavel, Hourglass, ListOrdered, SendHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import AdminPageHeader, { AdminHeaderTile } from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { STAGE_BAR_TONES, STAGE_LABEL_TONES, StageIcon } from '../../components/ApplicationParts';
import MovedCaseNotice, { useMovedCase } from '../../components/MovedCaseNotice';
import ReasonModal from '../../components/ReasonModal';
import { StatCard, getCaseCardClass } from '../../components/pageParts';
import { Button, Card, EmptyState, ExportButton, ModalShell, Panel, StatusBadge } from '../../components/ui';
import { downloadApplicantSummary, getApplicantSummaryFileName, getApprovalQueue, getFinalCheckHints } from '../../lib/admissionsOffice';
import { getActorRoleLabel } from '../../lib/applicationRequirements';
import { getApplicationStatusLabel, isEarlyClosure } from '../../lib/constants';
import { REVIEW_ROLE_LABELS, buildProgramScopeIndex, getApplicationScope, getApproverRoleForApplication } from '../../lib/reviewScope';
import { getLatestPanelRecommendation } from '../../lib/interview';
import FinalCheckToggle from '../../components/FinalCheckToggle';
import { describeGrantAmount } from '../../lib/grantAmount';
import {
  OFFER_STATE_LABELS,
  formatAcademicYear,
  OFFER_STATE_TONES,
  getConfirmByDaysRemaining,
  getDefaultConfirmBy,
  getManilaToday,
  getOfferState,
  getResultsRounds,
  isValidConfirmBy,
  moveInOrder,
} from '../../lib/resultsRound';
import { fmtDate, plural } from '../../lib/formatters';

const EMPTY_LIST = [];
const RESULT_LIST_PAGE_SIZE = 50;

// What a released case came to, for the history list and its badges.
const coveredResult = (entry, offer) => {
  if (entry.status === 'Released') {
    const state = getOfferState(offer);
    return { label: state === 'confirmed' ? 'Accepted · confirmed' : 'Accepted', tone: 'success' };
  }
  if (entry.status === 'Waitlisted') return { label: 'Waitlisted', tone: 'warning' };
  if (entry.status === 'Declined') return { label: 'Declined', tone: 'neutral' };
  if (entry.status === 'Rejected') return { label: 'Not accepted', tone: 'neutral' };
  return { label: getApplicationStatusLabel(entry.status), tone: 'info' };
};

const RELEASE_KIND_LABELS = {
  offers: 'Accepted and waitlisted released',
  closing: 'Results closed · Not accepted letters sent',
  legacy: 'Results released',
};

// The four steps of a scholarship's results round, in the order the Admin works
// them. `getRoundStep()` names the current one.
const ROUND_STEPS = [
  { key: 'check', label: 'Final check' },
  { key: 'release', label: 'Release accepted & waitlisted' },
  { key: 'answers', label: 'Collect confirmations' },
  { key: 'close', label: 'Close results' },
];

const getRoundStep = (round, allChecked) => {
  if (round.approved.length && !allChecked) return 0;
  if (round.approved.length || round.heldWaitlist.length) return 1;
  if (!round.offersReleased) return 3;
  if (round.pendingOffers || round.lapsedOffers || (round.openSlots && round.nextWaitlisted)) return 2;
  return 3;
};

// The stage track of the review modal (SopStageTrack), for the four steps of a
// scholarship's results round: green bars for what is done, blue for the current
// step, a neutral bar for what is ahead. Below `sm` it collapses to the bars and a
// caption, like the review modal's.
function RoundStageTrack({ current }) {
  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-semibold text-app-muted sm:hidden">
        Results step {current + 1} of {ROUND_STEPS.length}
      </span>
      <ol className="m-0 grid min-w-0 list-none auto-cols-fr grid-flow-col gap-1 p-0 sm:gap-2.5" aria-label="Results round steps">
        {ROUND_STEPS.map((step, index) => {
          const tone = index < current ? 'done' : index === current ? 'current' : 'upcoming';
          return (
            <li key={step.key} aria-current={tone === 'current' ? 'step' : undefined} className="grid min-w-0 gap-1.5" title={step.label}>
              <span className={`h-1.5 rounded-full transition-colors duration-500 motion-reduce:transition-none ${STAGE_BAR_TONES[tone]}`} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:flex sm:min-w-0 sm:items-center sm:gap-1 text-[11px] leading-tight">
                <StageIcon tone={tone} />
                <span className={`min-w-0 sm:truncate ${STAGE_LABEL_TONES[tone]}`}>{step.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// The review modal's tab strip: one tab per outcome, with its count.
function OutcomeTabs({ tabs, active, onChange }) {
  const focusTab = (event, delta) => {
    const nodes = [...event.currentTarget.parentElement.querySelectorAll('[role="tab"]')];
    const next = nodes[(nodes.indexOf(event.currentTarget) + delta + nodes.length) % nodes.length];
    next?.focus();
    next?.click();
  };
  return (
    <div role="tablist" aria-label="Results by outcome" className="flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-app-border">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`results-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls="results-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') { event.preventDefault(); focusTab(event, 1); }
              if (event.key === 'ArrowLeft') { event.preventDefault(); focusTab(event, -1); }
            }}
            className={`-mb-px inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 lg:min-h-9 ${selected ? 'border-ateneo text-app-text dark:border-sky-400' : 'border-transparent text-app-muted hover:text-app-text'}`}
          >
            {tab.label}
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${tab.alert ? 'bg-amber-400/15 text-amber-700 dark:text-amber-200' : 'bg-app-surface text-app-muted'}`}>{tab.badge}</span>
          </button>
        );
      })}
    </div>
  );
}

// One applicant row, in the same surface tile the review modal uses for its facts.
// One fact about a round: the review modal's FactTile (label, value, note).
function RoundFact({ label, value, note = '', progress = null }) {
  return (
    <div className="grid content-start gap-0.5 rounded-[14px] border border-app-border bg-app-card p-3">
      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">{label}</span>
      <strong className="text-base text-app-text">{value}</strong>
      {note ? <span className="text-xs text-app-muted">{note}</span> : null}
      {progress ? <RoundProgress {...progress} /> : null}
    </div>
  );
}

function RoundProgress({ checked, total, title }) {
  if (!total) return null;
  const progress = Math.round((checked / total) * 100);
  return (
    <div className="mt-1 flex items-center gap-2" aria-label={`${checked} of ${total} final checks complete`}>
      <div
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-app-border"
        role="progressbar"
        aria-label={`Final checks for ${title}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={checked}
      >
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
      </div>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-app-muted">{progress}%</span>
    </div>
  );
}

const LIST_CLASS = 'm-0 grid list-none gap-2 p-0';
const ROW_CLASS = 'relative grid gap-3 overflow-hidden rounded-2xl border border-blue-200/70 bg-gradient-to-r from-white via-blue-50/60 to-sky-50/60 p-3.5 pl-5 shadow-sm transition hover:-translate-y-px hover:border-blue-300 hover:shadow-md before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-sky-300 dark:border-blue-300/15 dark:from-slate-900 dark:via-blue-950/30 dark:to-slate-900 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-4';
const ROW_ACTION_CLASS = 'flex min-w-0 flex-wrap items-start gap-2 lg:justify-end';
const NOTE_CLASS = 'm-0 text-sm text-app-muted';
const EMPTY_CLASS = 'm-0 rounded-[14px] border border-dashed border-app-border px-3 py-8 text-center text-sm text-app-muted';

function ApplicantHeading({ name, children }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <strong className="min-w-0 text-sm font-bold text-app-text [overflow-wrap:anywhere]">{name}</strong>
      {children}
    </div>
  );
}

function ApplicantDetails({ children }) {
  return <div className="flex min-w-0 flex-wrap gap-1.5 text-xs text-app-muted">{children}</div>;
}

function ConfirmByField({ id, value, onChange, label = 'Confirm by' }) {
  const daysRemaining = getConfirmByDaysRemaining(value);
  const countdown = daysRemaining === null
    ? null
    : daysRemaining === 0
      ? 'Due today'
      : daysRemaining < 0
        ? `Overdue by ${plural(Math.abs(daysRemaining), 'day')}`
        : `In ${plural(daysRemaining, 'day')}`;
  return (
    <label htmlFor={id} className="grid gap-1 text-xs font-semibold text-app-muted">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {countdown ? <span className="font-medium text-blue-700 dark:text-sky-300">{countdown}</span> : null}
      </span>
      <input
        id={id}
        type="date"
        className="!h-10 !py-0"
        min={getManilaToday()}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

// The Admissions Office Admin's last step (Consultation 2, #13, and the waitlist
// that followed). The school approves, waitlists, or does not accept each
// recommendation. The Admin then works each scholarship's round:
//   1. final check the approved cases and order the waitlist, then release the
//      accepted and waitlisted applicants together with a confirm-by date;
//   2. collect the answers, and offer each declined slot to the next waitlisted
//      applicant;
//   3. close the results once every offer is answered: the remaining waitlist
//      becomes Not accepted and every Not accepted applicant receives the general
//      letter (#8). Until then a student never reads "Not accepted".
export default function AdminResultsRelease({
  applications = [],
  documents = [],
  students = {},
  scholarships = [],
  role = 'admissions_admin',
  onChangeApplication,
  onRejectApplication,
  onWaitlistApplication,
  onApproveApplication,
  onReleaseResults,
  onReleaseScholarshipResults,
  onSaveWaitlistOrder,
  onOfferToWaitlisted,
  onRespondToOffer,
  onWithdrawFromWaitlist,
  onCloseResultsRound,
  scholarshipOffers = [],
  scholarshipOffersReady = true,
  waitlistRanks = [],
  resultsReleases = [],
  academicPrograms = [],
  interviewWorkspace = null,
  reviewComments = [],
  onAddComment,
  // Opens one scholarship's results workspace straight away (by scholarship id).
  initialOpenRoundId = null,
}) {
  const [openId, setOpenId] = useState(null);
  // The tab the review modal opens on: the case notes and the grant amount have
  // their own buttons on the final-check list, so the Admin need not hunt for them.
  const [openTab, setOpenTab] = useState(null);
  const openCase = (applicationId, tab = null) => {
    setOpenTab(tab);
    setOpenId(applicationId);
  };
  const closeCase = (result) => {
    setOpenId(null);
    setOpenTab(null);
    moved.handleClose(result);
  };
  const [checked, setChecked] = useState({});
  const [confirmByFor, setConfirmByFor] = useState({});
  const [releaseRequestIds, setReleaseRequestIds] = useState({});
  const [visibleCounts, setVisibleCounts] = useState({});
  const [busyKey, setBusyKey] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [expandedReleases, setExpandedReleases] = useState({});
  // Dialogs: offer a slot, record a decline or a withdrawal, close a round.
  const [offerTarget, setOfferTarget] = useState(null);
  const [offerConfirmBy, setOfferConfirmBy] = useState(getDefaultConfirmBy());
  const [offerError, setOfferError] = useState('');
  const [declineTarget, setDeclineTarget] = useState(null);
  const [withdrawTarget, setWithdrawTarget] = useState(null);
  const [closeTarget, setCloseTarget] = useState(null);
  const [closeError, setCloseError] = useState('');
  const visibleRowsFor = (scholarshipId, section, rows) => rows.slice(0, visibleCounts[`${scholarshipId}:${section}`] || RESULT_LIST_PAGE_SIZE);
  const showMoreRows = (scholarshipId, section, visibleLength, totalLength) => visibleLength < totalLength ? (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      onClick={() => setVisibleCounts((current) => ({
        ...current,
        [`${scholarshipId}:${section}`]: (current[`${scholarshipId}:${section}`] || RESULT_LIST_PAGE_SIZE) + RESULT_LIST_PAGE_SIZE,
      }))}
    >Show {Math.min(RESULT_LIST_PAGE_SIZE, totalLength - visibleLength)} more</Button>
  ) : null;
  // The scholarship whose results workspace is open in its own modal.
  const [openRoundId, setOpenRoundId] = useState(initialOpenRoundId);
  // The outcome tab chosen in that modal; until one is chosen it opens on the first
  // outcome that has applicants.
  const [roundTab, setRoundTab] = useState(null);
  const openRoundWorkspace = (round) => {
    setRoundTab(null);
    setOpenRoundId(round.scholarshipId);
  };

  const programIndex = useMemo(() => buildProgramScopeIndex(academicPrograms), [academicPrograms]);
  const approvalLevels = interviewWorkspace?.approvalLevels || [];
  const notesByApplication = useMemo(() => {
    const grouped = new Map();
    (interviewWorkspace?.notes || EMPTY_LIST).forEach((note) => {
      if (!grouped.has(note.applicationId)) grouped.set(note.applicationId, []);
      grouped.get(note.applicationId).push(note);
    });
    return grouped;
  }, [interviewWorkspace?.notes]);
  const recommendationByApplication = useMemo(() => new Map(
    [...notesByApplication].map(([applicationId, notes]) => [applicationId, getLatestPanelRecommendation(notes)]),
  ), [notesByApplication]);
  const recommendationOf = (entry) => recommendationByApplication.get(entry.id) || null;
  const awaitingSchool = useMemo(() => getApprovalQueue(applications), [applications]);
  const rounds = useMemo(() => getResultsRounds({
    applications,
    scholarships,
    resultsReleases,
    offers: scholarshipOffers,
    ranks: waitlistRanks,
    recommendationOf: (entry) => recommendationByApplication.get(entry.id) || null,
  }), [applications, scholarships, resultsReleases, scholarshipOffers, waitlistRanks, recommendationByApplication]);
  const openRound = rounds.find((round) => round.scholarshipId === openRoundId) || null;
  const approvedCount = rounds.reduce((total, round) => total + round.approved.length, 0);
  const waitlistedCount = rounds.reduce((total, round) => total + round.waitlist.length, 0);
  const unansweredCount = rounds.reduce((total, round) => total + round.pendingOffers + round.lapsedOffers, 0);
  const openSlotCount = rounds.reduce((total, round) => total + round.openSlots, 0);
  const finalList = useMemo(() => applications.filter((entry) => ['Approved', 'Waitlisted', 'Released', 'Declined'].includes(entry.status)), [applications]);
  const selected = applications.find((entry) => entry.id === openId);
  // After a stage move the case's row glows, or a notice says where it went.
  const moved = useMovedCase([
    ...awaitingSchool,
    ...rounds.flatMap((round) => [...round.approved, ...round.waitlist, ...round.offers.map((row) => row.application)]),
  ].map((entry) => entry.id));
  const releasedHistory = useMemo(() => [...resultsReleases].filter((release) => release.releasedBy).reverse(), [resultsReleases]);
  const visibleAwaitingSchool = visibleRowsFor('all', 'awaiting-school', awaitingSchool);
  const visibleReleasedHistory = visibleRowsFor('all', 'released-history', releasedHistory);
  const titleById = useMemo(() => Object.fromEntries(scholarships.map((entry) => [entry.id, entry.title])), [scholarships]);
  const grantAmounts = interviewWorkspace?.grantAmounts || EMPTY_LIST;
  const grantByApplication = useMemo(() => new Map(grantAmounts.map((entry) => [entry.applicationId, entry])), [grantAmounts]);
  const grantFor = (applicationId) => grantByApplication.get(applicationId) || null;
  // The final check needs the grant amount recorded first, so a case without one
  // can neither be ticked nor counted toward the release.
  const isFinalChecked = (applicationId) => Boolean(checked[applicationId]) && Boolean(grantFor(applicationId));
  const setFinalChecked = (applicationId, value) => setChecked((previous) => ({ ...previous, [applicationId]: value }));
  const rankByApplication = useMemo(() => new Map(waitlistRanks.map((entry) => [entry.applicationId, entry.rank])), [waitlistRanks]);
  const rankOf = (applicationId) => rankByApplication.get(applicationId) ?? null;
  const offerByApplication = useMemo(() => new Map(scholarshipOffers.map((entry) => [entry.applicationId, entry])), [scholarshipOffers]);
  const offerOf = (applicationId) => offerByApplication.get(applicationId) || null;

  // The review surface offers the Admin's override at Recommended and the final
  // check's Not accepted at Approved; every other move stays with the role map.
  const handleStatusChange = (applicationId, status, options) => (
    status === 'Approved'
      ? onApproveApplication?.(applicationId, options?.note)
      : onChangeApplication?.(applicationId, status, options)
  );

  const exportOptions = (source) => ({
    scopeOf: (entry) => getApplicationScope(entry, programIndex),
    recommendationOf,
    grantOf: (entry) => grantFor(entry.id),
    offerOf: (entry) => offerOf(entry.id),
    rankOf: (entry) => rankOf(entry.id),
    source: { exportedBy: getActorRoleLabel(role), ...source },
  });
  const allReleasedIds = useMemo(() => new Set(resultsReleases.flatMap((release) => release.applicationIds || [])), [resultsReleases]);

  const exportFinalList = () => downloadApplicantSummary(finalList, exportOptions({
    origin: 'Final check and release › Results by scholarship',
    contents: 'Every approved, waitlisted, accepted, and declined application, all scholarships. Approved and held waitlisted cases are still awaiting their scholarship’s release.',
    releasedIds: allReleasedIds,
  }), getApplicantSummaryFileName('final_check'));

  // One scholarship's round: exactly the rows its card lists.
  const exportRound = (round) => downloadApplicantSummary([
    ...round.approved,
    ...round.waitlist,
    ...round.offers.map((row) => row.application),
    ...round.notAcceptedHeld,
  ], exportOptions({
    origin: 'Final check and release › Results by scholarship',
    contents: `The current results round of ${round.title}: approved cases awaiting the final check, the waitlist in offer order, the offers and their answers, and the Not accepted cases still held until the results are closed.`,
    scholarship: round.title,
    releasedIds: allReleasedIds,
  }), getApplicantSummaryFileName(round.title, 'final_check'));

  const releaseApplications = (release) => {
    const ids = new Set(release.applicationIds || []);
    return applications.filter((entry) => ids.has(entry.id));
  };

  const exportRelease = (release, covered) => {
    const title = titleById[release.scholarshipId] || 'Scholarship';
    downloadApplicantSummary(covered, exportOptions({
      origin: 'Final check and release › Released results',
      contents: `Every application covered by the ${(RELEASE_KIND_LABELS[release.kind] || 'results release').toLowerCase()} on ${fmtDate(release.releasedAt)}.`,
      scholarship: title,
      releasedAt: release.releasedAt,
      releasedIds: release.applicationIds || [],
    }), getApplicantSummaryFileName(title, 'released'));
  };

  const run = async (key, action, success) => {
    setBusyKey(key);
    setFeedback(null);
    const result = await action();
    setBusyKey('');
    if (result?.error) {
      setFeedback({ tone: 'error', message: result.error });
      return result;
    }
    if (success) setFeedback({ tone: 'success', message: typeof success === 'function' ? success(result) : success });
    return result;
  };

  const confirmByOf = (scholarshipId) => confirmByFor[scholarshipId] ?? getDefaultConfirmBy();

  const releaseRound = (round) => {
    const missingGrant = round.approved.filter((entry) => !grantFor(entry.id));
    if (missingGrant.length) {
      setFeedback({ tone: 'error', message: `${round.title}: set the grant amount on ${plural(missingGrant.length, 'approved case')} before releasing.` });
      return;
    }
    const confirmBy = confirmByOf(round.scholarshipId);
    const requestKey = `${round.scholarshipId}:${confirmBy}`;
    const requestId = releaseRequestIds[requestKey] || crypto.randomUUID();
    setReleaseRequestIds((current) => ({ ...current, [requestKey]: requestId }));
    const expectedIds = round.approved.map((entry) => entry.id);
    run(`release-${round.scholarshipId}`, async () => {
      const result = await onReleaseScholarshipResults?.(round.scholarshipId, {
        confirmBy,
        requestId,
        waitlistOrder: round.waitlist.map((entry) => entry.id),
      });
      if (result?.error) return result;
      const releasedIds = new Set(result?.releasedApplicationIds || []);
      if (!expectedIds.every((id) => releasedIds.has(id))) {
        setReleaseRequestIds((current) => {
          const next = { ...current };
          delete next[requestKey];
          return next;
        });
        return { error: 'A previous release request completed for a different set of cases. The workspace was refreshed; review the remaining approved cases before retrying.' };
      }
      setReleaseRequestIds((current) => {
        const next = { ...current };
        delete next[requestKey];
        return next;
      });
      return result;
    }, () => `${round.title}: ${plural(round.approved.length, 'accepted applicant')} notified to confirm by ${fmtDate(confirmBy)}${round.heldWaitlist.length ? `, and ${plural(round.heldWaitlist.length, 'waitlisted applicant')} told they are on the waitlist` : ''}. The Not accepted letters wait until you close the results.`);
  };

  const moveWaitlisted = (round, applicationId, direction) => {
    const ids = moveInOrder(round.waitlist.map((entry) => entry.id), applicationId, direction);
    run(`order-${round.scholarshipId}`, () => onSaveWaitlistOrder?.(round.scholarshipId, ids));
  };

  const confirmOffer = async () => {
    if (!offerTarget) return;
    setOfferError('');
    setBusyKey(`offer-${offerTarget.id}`);
    const result = await onOfferToWaitlisted?.(offerTarget.id, offerConfirmBy);
    setBusyKey('');
    if (result?.error) {
      setOfferError(result.error);
      return;
    }
    setFeedback({ tone: 'success', message: `${offerTarget.studentName} was offered the slot and asked to confirm by ${fmtDate(offerConfirmBy)}.` });
    setOfferTarget(null);
  };

  const confirmClose = async () => {
    if (!closeTarget) return;
    setCloseError('');
    setBusyKey(`close-${closeTarget.scholarshipId}`);
    const result = await onCloseResultsRound?.(closeTarget.scholarshipId);
    setBusyKey('');
    if (result?.error) {
      setCloseError(result.error);
      return;
    }
    const release = result?.release;
    setFeedback({
      tone: 'success',
      message: release
        ? `${closeTarget.title}: results closed. ${release.acceptedCount} of ${release.applicantCount} applicant${release.applicantCount === 1 ? '' : 's'} accepted; ${plural((release.applicationIds || []).length, 'Not accepted applicant')} receive the general letter.`
        : `${closeTarget.title}: results closed.`,
    });
    setCloseTarget(null);
  };

  const roundView = (round) => {
    const allChecked = round.approved.every((entry) => isFinalChecked(entry.id));
    const checkedCount = round.approved.filter((entry) => isFinalChecked(entry.id)).length;
    const missingGrantCount = round.approved.filter((entry) => !grantFor(entry.id)).length;
    const step = getRoundStep(round, allChecked);
    const unanswered = round.pendingOffers + round.lapsedOffers;
    const acceptedCount = round.approved.length + round.offers.length;
    const nextStep = step === 0
      ? (missingGrantCount
        ? `Record the grant amount on ${plural(missingGrantCount, 'accepted case')}, then mark the final check on each one.`
        : `Mark the final check on ${plural(round.approved.length - checkedCount, 'accepted case')}.`)
      : step === 1
        ? `Release tells ${plural(acceptedCount, 'accepted applicant')} to confirm${round.heldWaitlist.length ? ` and ${plural(round.heldWaitlist.length, 'waitlisted applicant')} that they are on the waitlist` : ''}. Not accepted applicants are not told yet.`
        : step === 2
          ? (round.openSlots && round.nextWaitlisted
            ? `${plural(round.openSlots, 'slot')} open: offer it to ${round.nextWaitlisted.studentName}, the top of the waitlist.`
            : `Waiting for ${plural(unanswered, 'accepted applicant')} to confirm or decline.${round.lapsedOffers ? ` ${round.lapsedOffers} passed the confirm-by date: record their answer.` : ''}`)
          : (round.closeBlocker
            || `Close the results: ${round.waitlist.length ? `${plural(round.waitlist.length, 'waitlisted applicant')} become Not accepted, and ` : ''}${plural(round.notAcceptedHeld.length + round.waitlist.length, 'Not accepted applicant')} receive the general letter.`);
    const scholarship = scholarships.find((entry) => entry.id === round.scholarshipId) || null;
    const grantsSet = round.approved.filter((entry) => grantFor(entry.id)).length;
    const declinedOffers = round.offers.filter((row) => row.state === 'declined').length;
    const yearLabel = formatAcademicYear(round.academicYear);
    const deadlineLabel = scholarship?.deadline ? fmtDate(scholarship.deadline) : 'No deadline set';
    return {
      allChecked, checkedCount, step, unanswered, acceptedCount, nextStep, scholarship, grantsSet, declinedOffers, yearLabel, deadlineLabel,
    };
  };

  const renderApprovedRow = (entry) => {
    const grant = grantFor(entry.id);
    const hints = getFinalCheckHints(entry, applications);
    const flags = [
      ...hints.siblingsOnGrant.map((sibling) => `Possible sibling on a grant: ${sibling.studentName} (${sibling.scholarshipTitle}, same parent name).`),
      ...(hints.selfDeclaredSibling ? ['Declared a sibling already on AdDU financial aid.'] : []),
      ...hints.pendingCases.map((pending) => `Another open application: ${pending.scholarshipTitle} (${getApplicationStatusLabel(pending.status)}).`),
    ];
    return (
      <li key={entry.id} data-application-id={entry.id} className={ROW_CLASS}>
        <div className="grid min-w-0 gap-2">
          <ApplicantHeading name={entry.studentName}>
            <StatusBadge tone={flags.length ? 'warning' : 'success'} className="whitespace-nowrap">{flags.length ? 'Check before release' : 'No flags'}</StatusBadge>
          </ApplicantHeading>
          <ApplicantDetails>
            <span className="rounded-lg border border-blue-100 bg-white/70 px-2.5 py-1 font-medium text-slate-600 dark:border-blue-300/10 dark:bg-slate-950/25 dark:text-slate-300">{entry.studentProgram || 'Program on file'}</span>
            {grant ? <span className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-2.5 py-1 font-semibold text-emerald-800 dark:border-emerald-300/15 dark:bg-emerald-950/35 dark:text-emerald-200">Grant amount · {describeGrantAmount(grant)}</span> : null}
            {!grant ? <span className="rounded-lg border border-amber-300/70 bg-amber-50/90 px-2.5 py-1 font-semibold text-amber-800 dark:border-amber-300/20 dark:bg-amber-950/40 dark:text-amber-200">Grant amount not set</span> : null}
          </ApplicantDetails>
          {flags.length ? (
            <ul className="m-0 grid list-disc gap-1 rounded-xl border border-amber-300/50 bg-amber-50/70 py-2 pl-7 pr-3 text-xs leading-relaxed text-amber-800 dark:border-amber-300/15 dark:bg-amber-950/20 dark:text-amber-200">
              {flags.map((flag) => <li key={flag}>{flag}</li>)}
            </ul>
          ) : null}
        </div>
        <div className={ROW_ACTION_CLASS}>
          <FinalCheckToggle
            checked={isFinalChecked(entry.id)}
            grant={grant}
            showHint={false}
            className="w-[12.5rem] shrink-0"
            onChange={(value) => setFinalChecked(entry.id, value)}
          />
          <Button type="button" variant="secondary" onClick={() => openCase(entry.id, 'grant')}>Grant amount</Button>
          <Button type="button" variant="secondary" onClick={() => openCase(entry.id)}>Open case</Button>
        </div>
      </li>
    );
  };

  const renderWaitlist = (round) => {
    const ordering = busyKey === `order-${round.scholarshipId}`;
    const released = new Set(round.waitlist.filter((entry) => !round.heldWaitlist.includes(entry)).map((entry) => entry.id));
    const entries = visibleRowsFor(round.scholarshipId, 'waitlisted', round.waitlist);
    return (
      <ol className={LIST_CLASS}>
        {entries.map((entry, index) => {
          const recommendation = recommendationOf(entry);
          const grant = grantFor(entry.id);
          const isNext = round.nextWaitlisted?.id === entry.id;
          const isReleased = released.has(entry.id);
          return (
            <li key={entry.id} data-application-id={entry.id} className={ROW_CLASS}>
              <div className="flex min-w-0 items-start gap-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-sm font-extrabold tabular-nums shadow-sm ${index === 0 ? 'border-amber-300 bg-gradient-to-br from-amber-100 to-yellow-50 text-amber-900 dark:border-amber-300/20 dark:from-amber-950/70 dark:to-slate-900 dark:text-amber-200' : 'border-blue-200 bg-white/80 text-blue-800 dark:border-blue-300/15 dark:bg-slate-900 dark:text-sky-200'}`} aria-label={`Position ${index + 1}`}>{index + 1}</span>
                <div className="grid min-w-0 gap-2">
                  <ApplicantHeading name={entry.studentName}>
                    <StatusBadge tone={isReleased ? 'warning' : 'neutral'} className="whitespace-nowrap">{isReleased ? 'Told: waitlisted' : 'Not told yet'}</StatusBadge>
                  </ApplicantHeading>
                  <ApplicantDetails>
                    <span className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-2.5 py-1 font-semibold text-amber-900 dark:border-amber-300/15 dark:bg-amber-950/30 dark:text-amber-200"><Award className="mr-1 inline h-3.5 w-3.5 -translate-y-px" aria-hidden="true" />{recommendation?.label || 'No recommendation level'}</span>
                    <span className="rounded-lg border border-blue-100 bg-white/70 px-2.5 py-1 font-medium text-slate-600 dark:border-blue-300/10 dark:bg-slate-950/25 dark:text-slate-300">{entry.studentProgram || 'Program on file'}</span>
                    {grant ? <span className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-2.5 py-1 font-semibold text-emerald-800 dark:border-emerald-300/15 dark:bg-emerald-950/35 dark:text-emerald-200">Grant amount · {describeGrantAmount(grant)}</span> : null}
                  </ApplicantDetails>
                </div>
              </div>
              <div className={ROW_ACTION_CLASS}>
                {round.waitlist.length > 1 ? (
                  <>
                    <Button type="button" variant="secondary" className="!px-2.5" disabled={ordering || index === 0} aria-label={`Move ${entry.studentName} up`} onClick={() => moveWaitlisted(round, entry.id, -1)}><ArrowUp size={16} aria-hidden="true" /></Button>
                    <Button type="button" variant="secondary" className="!px-2.5" disabled={ordering || index === round.waitlist.length - 1} aria-label={`Move ${entry.studentName} down`} onClick={() => moveWaitlisted(round, entry.id, 1)}><ArrowDown size={16} aria-hidden="true" /></Button>
                  </>
                ) : null}
                <Button type="button" variant="secondary" onClick={() => openCase(entry.id, 'grant')}>Grant amount</Button>
                <Button type="button" variant="secondary" onClick={() => openCase(entry.id)}>Open case</Button>
                {isReleased ? (
                  <Button type="button" variant="secondary" onClick={() => setWithdrawTarget(entry)}>Record withdrawal…</Button>
                ) : null}
                {isNext ? (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!round.openSlots}
                    title={round.openSlots ? undefined : 'No slot is open: an accepted applicant must decline first.'}
                    onClick={() => { setOfferError(''); setOfferConfirmBy(getDefaultConfirmBy()); setOfferTarget(entry); }}
                  >Offer to next</Button>
                ) : null}
              </div>
            </li>
          );
        })}
        {entries.length < round.waitlist.length ? (
          <li className="list-none">{showMoreRows(round.scholarshipId, 'waitlisted', entries.length, round.waitlist.length)}</li>
        ) : null}
      </ol>
    );
  };

  const renderOffers = (round) => {
    const entries = visibleRowsFor(round.scholarshipId, 'offers', round.offers);
    return (
      <ul className={LIST_CLASS}>
      {entries.map(({ application: entry, offer, state }) => (
        <li key={entry.id} data-application-id={entry.id} className={ROW_CLASS}>
          <div className="grid min-w-0 gap-2">
            <ApplicantHeading name={entry.studentName}>
              <StatusBadge tone={OFFER_STATE_TONES[state]}>{OFFER_STATE_LABELS[state]}</StatusBadge>
            </ApplicantHeading>
            <ApplicantDetails>
              {offer.origin === 'promotion' ? <span className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-2.5 py-1 font-semibold text-amber-900 dark:border-amber-300/15 dark:bg-amber-950/30 dark:text-amber-200">Offered from waitlist</span> : null}
              <span className="rounded-lg border border-blue-100 bg-white/70 px-2.5 py-1 font-medium text-slate-600 dark:border-blue-300/10 dark:bg-slate-950/25 dark:text-slate-300">Confirm by {offer.confirmBy ? fmtDate(offer.confirmBy) : 'date not set'}</span>
              {offer.respondedAt ? <span className="rounded-lg border border-emerald-200/70 bg-emerald-50/70 px-2.5 py-1 text-emerald-800 dark:border-emerald-300/15 dark:bg-emerald-950/30 dark:text-emerald-200">Answered {fmtDate(offer.respondedAt)}{offer.respondedByRole === 'admissions_admin' ? ' · recorded by the office' : ''}</span> : null}
            </ApplicantDetails>
            {state === 'declined' && offer.declineReason ? <p className="m-0 rounded-xl border border-app-border bg-white/60 px-3 py-2 text-xs text-app-muted dark:bg-slate-950/20">Reason: {offer.declineReason}</p> : null}
          </div>
          <div className={ROW_ACTION_CLASS}>
            {state === 'pending' || state === 'lapsed' ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyKey === `respond-${entry.id}`}
                  onClick={() => run(`respond-${entry.id}`, () => onRespondToOffer?.(entry.id, 'confirmed'), `${entry.studentName}: confirmation recorded.`)}
                >Record confirmed</Button>
                <Button type="button" variant="secondary" onClick={() => setDeclineTarget(entry)}>Record declined…</Button>
              </>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => openCase(entry.id)}>Open case</Button>
          </div>
        </li>
      ))}
      {entries.length < round.offers.length ? (
        <li className="list-none">{showMoreRows(round.scholarshipId, 'offers', entries.length, round.offers.length)}</li>
      ) : null}
      </ul>
    );
  };

  // The Not accepted cases still held: named, so the Admin sees who receives the
  // general letter when the results are closed.
  const renderNotAccepted = (round) => {
    const entries = visibleRowsFor(round.scholarshipId, 'not-accepted', round.notAcceptedHeld);
    return (
      <ul className={LIST_CLASS}>
      {entries.map((entry) => (
        <li key={entry.id} data-application-id={entry.id} className={ROW_CLASS}>
          <div className="grid min-w-0 gap-2">
            <ApplicantHeading name={entry.studentName}>
              <StatusBadge tone="neutral" className="whitespace-nowrap">Not told yet</StatusBadge>
            </ApplicantHeading>
            <ApplicantDetails>
              <span className="rounded-lg border border-blue-100 bg-white/70 px-2.5 py-1 font-medium text-slate-600 dark:border-blue-300/10 dark:bg-slate-950/25 dark:text-slate-300">{entry.studentProgram || 'Program on file'}</span>
              <span className="rounded-lg border border-app-border bg-white/50 px-2.5 py-1 dark:bg-slate-950/20">{isEarlyClosure(entry) ? 'closed by the office before the interview' : 'not accepted by the school'}</span>
            </ApplicantDetails>
          </div>
          <div className={ROW_ACTION_CLASS}>
            <Button type="button" variant="secondary" onClick={() => openCase(entry.id, 'endorsement')}>Case notes</Button>
            <Button type="button" variant="secondary" onClick={() => openCase(entry.id)}>Open case</Button>
          </div>
        </li>
      ))}
      {entries.length < round.notAcceptedHeld.length ? (
        <li className="list-none">{showMoreRows(round.scholarshipId, 'not-accepted', entries.length, round.notAcceptedHeld.length)}</li>
      ) : null}
      </ul>
    );
  };

  return (
    <div className="grid content-start gap-5">
      <AdminPageHeader
        title="Final check and release"
        description="Check each approved case and order the waitlist, release the accepted and waitlisted applicants, then close the results once every offer is answered."
      >
        {approvedCount || unansweredCount || openSlotCount ? (
          <AdminHeaderTile
            icon={SendHorizontal}
            tone="warning"
            label="Results"
            title={approvedCount
              ? `${plural(approvedCount, 'approved case')} to check`
              : openSlotCount
                ? `${plural(openSlotCount, 'slot')} to offer`
                : `${plural(unansweredCount, 'offer')} awaiting an answer`}
            note={awaitingSchool.length ? `${plural(awaitingSchool.length, 'more case')} still with the schools.` : 'Work each scholarship from top to bottom.'}
          />
        ) : (
          <AdminHeaderTile
            icon={CheckCircle2}
            tone="success"
            label="Results"
            title="Nothing to release"
            note={awaitingSchool.length ? `${plural(awaitingSchool.length, 'case')} awaiting the school approval.` : 'No approved case is waiting.'}
          />
        )}
      </AdminPageHeader>

      <MovedCaseNotice notice={moved.notice} onDismiss={moved.dismiss} offListNote="It is no longer awaiting a decision, a release, or an answer here." />

      <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard icon={Gavel} tone="warning" label="Awaiting the school's approval" value={awaitingSchool.length} note="Decided by the configured level" />
        <StatCard icon={Award} tone="info" label="Approved — final check" value={approvedCount} note="Siblings on a grant, pending cases" />
        <StatCard icon={ListOrdered} tone="warning" label="Waitlisted" value={waitlistedCount} note={openSlotCount ? `${plural(openSlotCount, 'slot')} open` : 'Offered a slot when one opens'} />
        <StatCard icon={Hourglass} tone="info" label="Offers awaiting an answer" value={unansweredCount} note="Accepted applicants to confirm" />
      </section>

      {!scholarshipOffersReady ? (
        <p className="m-0 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100" role="note">
          The waitlist and offer confirmation are not available yet: apply the 20261061000000 migration to the Supabase project.
        </p>
      ) : null}

      {feedback ? (
        <p
          className={`m-0 rounded-[14px] border px-3 py-2 text-sm ${feedback.tone === 'error' ? 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200' : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >{feedback.message}</p>
      ) : null}

      <Card title="Results by scholarship" action={<ExportButton disabled={!finalList.length} onClick={exportFinalList} />}>
        <div className="grid gap-4">
          {rounds.length ? rounds.map((round) => {
            const view = roundView(round);
            return (
              <article key={round.scholarshipId} className={`${getCaseCardClass('info')} group isolate border-blue-300/60 bg-gradient-to-br from-blue-50/80 via-app-surface to-sky-50/50 p-4 pl-5 shadow-md hover:border-blue-400/70 hover:shadow-lg dark:from-blue-950/25 dark:via-app-surface dark:to-sky-950/10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch sm:gap-5 sm:p-5 sm:pl-6`}>
                <div className="pointer-events-none absolute -right-14 -top-16 -z-10 h-44 w-44 rounded-full bg-sky-400/10 blur-3xl transition duration-500 group-hover:bg-blue-400/20" aria-hidden="true" />
                <div className="grid min-w-0 gap-3.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-blue-300/50 bg-white/80 text-blue-800 shadow-sm dark:border-blue-300/20 dark:bg-blue-950/60 dark:text-sky-200" aria-hidden="true">
                      <Award className="h-5 w-5" />
                    </span>
                    <div className="grid min-w-0 flex-1 gap-1">
                      <h3 className="m-0 min-w-0 text-base font-bold leading-snug text-app-text [overflow-wrap:anywhere] sm:text-lg">{round.title}</h3>
                      <span className="text-xs font-medium text-app-muted">{round.applicantCount} {round.applicantCount === 1 ? 'applicant' : 'applicants'} in this results round</span>
                    </div>
                    <StatusBadge tone="neutral" className="whitespace-nowrap">Academic year {view.yearLabel}</StatusBadge>
                    <StatusBadge tone="info" className="whitespace-nowrap">Step {view.step + 1} of {ROUND_STEPS.length} · {ROUND_STEPS[view.step].label}</StatusBadge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <RoundFact
                      label="Applicants"
                      value={round.applicantCount}
                      note={round.stillOpenCount ? `${round.stillOpenCount} still with the office or school` : 'All decided'}
                    />
                    <RoundFact label="Application deadline" value={view.deadlineLabel} />
                    <RoundFact
                      label="Final check"
                      value={round.approved.length ? `${view.checkedCount} of ${round.approved.length} checked` : 'Done'}
                      note={round.approved.length ? `${view.grantsSet} of ${round.approved.length} grant amounts set` : 'Accepted applicants released'}
                      progress={round.approved.length ? { checked: view.checkedCount, total: round.approved.length, title: round.title } : null}
                    />
                    <RoundFact
                      label="Confirmations"
                      value={round.offers.length ? `${round.confirmedOffers} of ${round.offers.length} confirmed` : 'Not released yet'}
                      note={round.offers.length
                        ? `${view.unanswered} awaiting${view.declinedOffers ? ` · ${view.declinedOffers} declined` : ''}${round.lastReleasedAt ? ` · released ${fmtDate(round.lastReleasedAt)}` : ''}`
                        : 'Offers go out when you release'}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={view.acceptedCount ? 'success' : 'neutral'} className="whitespace-nowrap">{view.acceptedCount} accepted</StatusBadge>
                    <StatusBadge tone={round.waitlist.length ? 'warning' : 'neutral'} className="whitespace-nowrap">{round.waitlist.length} waitlisted{round.openSlots ? ` · ${plural(round.openSlots, 'slot')} open` : ''}</StatusBadge>
                    <StatusBadge tone="neutral" className="whitespace-nowrap">{round.notAcceptedHeld.length} not accepted</StatusBadge>
                  </div>
                  <p className="m-0 rounded-xl border border-blue-200/70 bg-white/60 px-3 py-2 text-sm leading-relaxed text-app-muted dark:border-blue-300/15 dark:bg-slate-950/20"><strong className="font-semibold text-app-text">Next:</strong> {view.nextStep}</p>
                </div>
                <div className="flex w-full flex-col gap-2 border-t border-blue-200/60 pt-3 sm:w-40 sm:shrink-0 sm:items-stretch sm:justify-center sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0 dark:border-blue-300/15">
                  <ExportButton
                    className="!min-h-10 w-full justify-center !rounded-xl !border-blue-200 !bg-white !px-3 !py-2 !text-sm !text-blue-950 hover:!border-blue-400 hover:!bg-blue-50 dark:!border-blue-200 dark:!bg-white dark:!text-blue-950 dark:hover:!bg-blue-50"
                    aria-label={`Export ${round.title} results to Excel`}
                    title={`Export ${round.title} results to Excel`}
                    onClick={() => exportRound(round)}
                  >Excel export</ExportButton>
                  <Button type="button" variant="primary" className="w-full" onClick={() => openRoundWorkspace(round)}>Open results</Button>
                </div>
              </article>
            );
          }) : <EmptyState title="Nothing to release yet" description="Approved and waitlisted applications appear here after the school's decision." />}
        </div>
      </Card>

      <Card title="Awaiting the school's approval" action={<StatusBadge tone={awaitingSchool.length ? 'info' : 'success'}>{awaitingSchool.length} with the schools</StatusBadge>}>
        <div className="grid max-h-[520px] gap-3 overflow-y-auto pb-14 pr-1 sm:pb-1">
          {awaitingSchool.length ? visibleAwaitingSchool.map((entry) => {
            const approver = getApproverRoleForApplication(entry, approvalLevels, programIndex);
            return (
              <article key={entry.id} data-application-id={entry.id} className={getCaseCardClass('warning')}>
                <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                  <div className="min-w-0 w-full"><h3 className="truncate">{entry.studentName}</h3><p className="text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p></div>
                  <StatusBadge tone="info">With the {REVIEW_ROLE_LABELS[approver] || 'Chairperson'}</StatusBadge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-2">
                  <span className="text-xs text-app-muted">{recommendationOf(entry)?.label || 'Recommended'} · the school approves, waitlists, or does not accept; you can override from the case.</span>
                  <Button type="button" variant="secondary" onClick={() => openCase(entry.id)}>Open case</Button>
                </div>
              </article>
            );
          }) : <EmptyState title="No recommendations with the schools" />}
        </div>
        {showMoreRows('all', 'awaiting-school', visibleAwaitingSchool.length, awaitingSchool.length)}
      </Card>

      {releasedHistory.length ? (
        <Card title="Released results">
          <ul className="m-0 grid gap-2 p-0">
            {visibleReleasedHistory.map((release) => {
              const title = titleById[release.scholarshipId] || 'Scholarship';
              const covered = releaseApplications(release);
              const visibleCovered = visibleRowsFor(release.id, 'coverage', covered);
              const open = Boolean(expandedReleases[release.id]);
              const panelId = `release-${release.id}`;
              const isOffers = release.kind === 'offers';
              return (
                <li key={release.id} className="overflow-hidden rounded-2xl border border-app-border bg-app-surface">
                  <button
                    type="button"
                    className="disclosure-action flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-0 bg-transparent px-3 py-2.5 text-left transition hover:bg-app-card/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setExpandedReleases((previous) => ({ ...previous, [release.id]: !previous[release.id] }))}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-app-border bg-app-card text-app-muted">
                      <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-app-text">{title}</span>
                      <span className="block text-xs text-app-muted">{RELEASE_KIND_LABELS[release.kind] || RELEASE_KIND_LABELS.legacy}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-app-muted">
                      {isOffers
                        ? <StatusBadge tone="info">{plural(covered.length || (release.applicationIds || []).length, 'applicant')}</StatusBadge>
                        : <StatusBadge tone="success">{release.acceptedCount} of {release.applicantCount} accepted</StatusBadge>}
                      <span>{fmtDate(release.releasedAt)}</span>
                    </span>
                  </button>
                  {open ? (
                    <div id={panelId} className="grid gap-2 border-t border-app-border bg-app-card/40 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="m-0 text-xs text-app-muted">
                          {covered.length ? `${plural(covered.length, 'application')} covered` : 'The covered applications are not loaded in this session.'}
                        </p>
                        <ExportButton disabled={!covered.length} onClick={() => exportRelease(release, covered)} />
                      </div>
                      {covered.length ? (
                        <ul className="m-0 grid max-h-[320px] list-none gap-1.5 overflow-y-auto p-0 pr-1">
                          {visibleCovered.map((entry) => {
                            const result = coveredResult(entry, offerOf(entry.id));
                            return (
                              <li key={entry.id} className="flex min-w-0 flex-col items-start gap-1 rounded-xl border border-app-border bg-app-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                <div className="min-w-0 [overflow-wrap:anywhere]">
                                  <strong className="block text-sm font-semibold">{entry.studentName}</strong>
                                  <span className="text-xs text-app-muted">{entry.studentProgram || 'Program on file'}</span>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                  <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
                                  <Button type="button" variant="secondary" onClick={() => openCase(entry.id)}>View case</Button>
                                </div>
                              </li>
                            );
                          })}
                          {visibleCovered.length < covered.length ? (
                            <li className="list-none">{showMoreRows(release.id, 'coverage', visibleCovered.length, covered.length)}</li>
                          ) : null}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
            {visibleReleasedHistory.length < releasedHistory.length ? (
              <li className="list-none">{showMoreRows('all', 'released-history', visibleReleasedHistory.length, releasedHistory.length)}</li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {openRound ? (() => {
        const round = openRound;
        const view = roundView(round);
        const progress = round.approved.length ? Math.round((view.checkedCount / round.approved.length) * 100) : 0;
        const releasing = busyKey === `release-${round.scholarshipId}`;
        const confirmBy = confirmByOf(round.scholarshipId);
        const approvedVisible = visibleRowsFor(round.scholarshipId, 'approved', round.approved);
        const releaseBlocked = !view.allChecked || (round.approved.length > 0 && !isValidConfirmBy(confirmBy));
        const { declinedOffers } = view;
        const activeTab = roundTab
          || (view.acceptedCount ? 'accepted' : round.waitlist.length ? 'waitlisted' : round.notAcceptedHeld.length ? 'notAccepted' : 'accepted');
        const tabs = [
          { key: 'accepted', label: 'Accepted', badge: view.acceptedCount },
          { key: 'waitlisted', label: 'Waitlisted', badge: round.waitlist.length, alert: Boolean(round.openSlots) },
          { key: 'notAccepted', label: 'Not accepted', badge: round.notAcceptedHeld.length },
        ];
        return (
          <ModalShell
            title={`${round.title} results`}
            onClose={() => setOpenRoundId(null)}
            className="application-detail-modal !h-[min(88vh,800px)] !w-[min(960px,100%)]"
            header={(
              <div className="card-header mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="grid min-w-0 flex-1 gap-1">
                  <h2 className="m-0">{round.title}</h2>
                  <p className="m-0 text-sm text-app-muted">
                    Academic year {view.yearLabel} · Application deadline {view.deadlineLabel} · {plural(round.applicantCount, 'applicant')}
                    {round.lastReleasedAt ? ` · Released ${fmtDate(round.lastReleasedAt)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ExportButton onClick={() => exportRound(round)} />
                  <Button variant="secondary" type="button" onClick={() => setOpenRoundId(null)}>Close</Button>
                </div>
              </div>
            )}
          >
            <div className="grid shrink-0 gap-3 pb-3">
              <RoundStageTrack current={view.step} />
              {feedback ? (
                <p
                  className={`m-0 rounded-[14px] border px-3 py-2 text-sm ${feedback.tone === 'error' ? 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200' : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'}`}
                  role={feedback.tone === 'error' ? 'alert' : 'status'}
                >{feedback.message}</p>
              ) : null}
            </div>
            <OutcomeTabs tabs={tabs} active={activeTab} onChange={setRoundTab} />
            <div className="application-detail-modal-body pt-4" role="tabpanel" id="results-panel" aria-labelledby={`results-tab-${activeTab}`}>
              <div className="grid content-start gap-3">
                {activeTab === 'accepted' ? (
                  <>
                    <p className={NOTE_CLASS}>
                      <strong className="font-semibold text-app-text">Student hears:</strong>{' '}
                      {round.offersReleased && !round.approved.length
                        ? 'Already told. Each accepted applicant confirms or declines by the date shown; a decline opens a slot for the waitlist.'
                        : 'When you release, they are asked to confirm or decline by the date you choose.'}
                      {round.offers.length ? ` ${round.confirmedOffers} confirmed · ${view.unanswered} awaiting${declinedOffers ? ` · ${declinedOffers} declined` : ''}.` : ''}
                    </p>
                    {view.acceptedCount ? (
                      <>
                        {round.approved.length ? (
                          <>
                            <ul className={LIST_CLASS}>{approvedVisible.map(renderApprovedRow)}</ul>
                            {showMoreRows(round.scholarshipId, 'approved', approvedVisible.length, round.approved.length)}
                          </>
                        ) : null}
                        {round.offers.length ? renderOffers(round) : null}
                      </>
                    ) : <p className={EMPTY_CLASS}>No accepted applicants in this round.</p>}
                  </>
                ) : null}
                {activeTab === 'waitlisted' ? (
                  <>
                    <p className={NOTE_CLASS}>
                      <strong className="font-semibold text-app-text">Student hears:</strong>{' '}
                      {round.heldWaitlist.length
                        ? 'When you release, together with the accepted applicants: that they are on the waitlist, never their position.'
                        : 'Already told they are on the waitlist. The top applicant is offered a slot when an accepted applicant declines.'}
                      {round.waitlist.length > 1 ? ' Reorder the list with the arrows; the order is the offer order.' : ''}
                    </p>
                    {round.waitlist.length ? renderWaitlist(round) : <p className={EMPTY_CLASS}>No waitlisted applicants in this round.</p>}
                  </>
                ) : null}
                {activeTab === 'notAccepted' ? (
                  <>
                    <p className={NOTE_CLASS}>
                      <strong className="font-semibold text-app-text">Student hears:</strong>{' '}
                      Only when you close the results: the general letter with the number of applicants and the number accepted, never a reason. Applicants still waitlisted then join this list.
                    </p>
                    {round.notAcceptedHeld.length ? renderNotAccepted(round) : <p className={EMPTY_CLASS}>No Not accepted applicants in this round.</p>}
                  </>
                ) : null}
              </div>
            </div>
            <footer className="shrink-0 pt-4">
              <Panel className="!overflow-hidden !border-blue-500/40 !p-0">
                <div className={`grid ${view.step <= 1 || view.step === 3 ? 'md:grid-cols-[minmax(0,1fr)_17rem]' : ''}`}>
                  <div className="grid content-start gap-3 p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="m-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted">Next step</h3>
                      <StatusBadge tone="info" className="whitespace-nowrap">Step {view.step + 1} of {ROUND_STEPS.length} · {ROUND_STEPS[view.step].label}</StatusBadge>
                    </div>
                    <p className="m-0 text-sm font-medium leading-relaxed text-app-text">{view.nextStep}</p>
                    {view.step <= 1 && round.approved.length ? (
                      <div className="flex items-center gap-2">
                        <div
                          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-app-border"
                          role="progressbar"
                          aria-label={`Final checks done for ${round.title}`}
                          aria-valuemin={0}
                          aria-valuemax={round.approved.length}
                          aria-valuenow={view.checkedCount}
                        >
                          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-app-text">{view.checkedCount} of {round.approved.length} checked</span>
                      </div>
                    ) : null}
                  </div>
                  {view.step <= 1 ? (
                    <div className="grid content-center gap-2 border-t border-blue-200/70 bg-blue-50/50 p-4 dark:border-blue-300/15 dark:bg-blue-950/20 md:border-l md:border-t-0 md:p-4">
                      {round.approved.length ? (
                        <ConfirmByField
                          id={`confirm-by-${round.scholarshipId}`}
                          value={confirmBy}
                          onChange={(value) => setConfirmByFor((previous) => ({ ...previous, [round.scholarshipId]: value }))}
                        />
                      ) : null}
                      <Button
                        type="button"
                        variant="primary"
                        className="w-full"
                        disabled={releaseBlocked || releasing}
                        onClick={() => releaseRound(round)}
                      ><SendHorizontal className="h-4 w-4" aria-hidden="true" />{releasing ? 'Releasing…' : 'Release accepted and waitlisted'}</Button>
                    </div>
                  ) : view.step === 3 ? (
                    <div className="grid content-center border-t border-blue-200/70 bg-blue-50/50 p-4 dark:border-blue-300/15 dark:bg-blue-950/20 md:border-l md:border-t-0">
                      <Button
                        type="button"
                        variant="primary"
                        className="w-full"
                        disabled={!round.canClose}
                        onClick={() => { setCloseError(''); setCloseTarget(round); }}
                      >Close results…</Button>
                    </div>
                  ) : null}
                </div>
              </Panel>
            </footer>
          </ModalShell>
        );
      })() : null}

      {offerTarget ? (
        <ModalShell title="Offer the open slot" onClose={() => setOfferTarget(null)} className="w-[min(520px,100%)]">
          <div className="grid gap-3 text-sm text-app-text">
            <p className="m-0">
              {offerTarget.studentName} is next on the waitlist. They are told a slot opened and asked to confirm or decline by the date below.
            </p>
            {grantFor(offerTarget.id) ? (
              <p className="m-0 text-app-muted">Grant amount: {describeGrantAmount(grantFor(offerTarget.id))}</p>
            ) : (
              <div className="grid gap-2 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-amber-800 dark:text-amber-100" role="note">
                <span>No grant amount is recorded for this applicant yet. Record it before offering the slot.</span>
                <Button type="button" variant="secondary" className="justify-self-start" onClick={() => { const id = offerTarget.id; setOfferTarget(null); openCase(id, 'grant'); }}>Record the grant amount</Button>
              </div>
            )}
            <ConfirmByField id="offer-confirm-by" value={offerConfirmBy} onChange={setOfferConfirmBy} />
            {offerError ? <span className="text-sm text-rose-600 dark:text-rose-300" role="alert">{offerError}</span> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={() => setOfferTarget(null)}>Cancel</Button>
              <Button
                type="button"
                variant="primary"
                disabled={!grantFor(offerTarget.id) || !isValidConfirmBy(offerConfirmBy) || busyKey === `offer-${offerTarget.id}`}
                onClick={confirmOffer}
              >{busyKey === `offer-${offerTarget.id}` ? 'Offering…' : 'Offer the slot'}</Button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {declineTarget ? (
        <ReasonModal
          title="Record a declined offer"
          label="What the applicant said (optional)"
          hint="Use this for an answer given by phone, email, or in person, or for an offer whose confirm-by date passed. The slot then opens for the next waitlisted applicant."
          confirmLabel="Record declined"
          optional
          onConfirm={async (note) => {
            const result = await onRespondToOffer?.(declineTarget.id, 'declined', note);
            if (result?.error) return result;
            setFeedback({ tone: 'success', message: `${declineTarget.studentName}: decline recorded. A slot is open for the next waitlisted applicant.` });
            setDeclineTarget(null);
            return result;
          }}
          onClose={() => setDeclineTarget(null)}
        />
      ) : null}

      {withdrawTarget ? (
        <ReasonModal
          title="Record a withdrawal from the waitlist"
          label="What the applicant said (optional)"
          hint="The applicant leaves the waitlist and is skipped when a slot opens."
          confirmLabel="Record withdrawal"
          optional
          onConfirm={async (note) => {
            const result = await onWithdrawFromWaitlist?.(withdrawTarget.id, note);
            if (result?.error) return result;
            setFeedback({ tone: 'success', message: `${withdrawTarget.studentName} left the waitlist.` });
            setWithdrawTarget(null);
            return result;
          }}
          onClose={() => setWithdrawTarget(null)}
        />
      ) : null}

      {closeTarget ? (
        <ModalShell title={`Close the results of ${closeTarget.title}`} onClose={() => setCloseTarget(null)} className="w-[min(560px,100%)]">
          <div className="grid gap-3 text-sm text-app-text">
            <ul className="m-0 grid gap-1.5 pl-5">
              <li>{plural(closeTarget.confirmedOffers, 'accepted applicant')} confirmed the award.</li>
              {closeTarget.waitlist.length ? <li>{plural(closeTarget.waitlist.length, 'waitlisted applicant')} become Not accepted.</li> : null}
              <li>{plural(closeTarget.notAcceptedHeld.length + closeTarget.waitlist.length, 'Not accepted applicant')} receive the general letter: the number of applicants and the number accepted, never a reason.</li>
              <li>Accepted applicants can no longer change their answer in the app; record any later withdrawal from the case.</li>
            </ul>
            {closeError ? <span className="text-sm text-rose-600 dark:text-rose-300" role="alert">{closeError}</span> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={() => setCloseTarget(null)}>Cancel</Button>
              <Button
                type="button"
                variant="primary"
                disabled={busyKey === `close-${closeTarget.scholarshipId}`}
                onClick={confirmClose}
              >{busyKey === `close-${closeTarget.scholarshipId}` ? 'Closing…' : 'Close results and send letters'}</Button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          students={students}
          role={role}
          initialTab={openTab}
          // The same final-check tick as the list, offered in the modal's footer
          // while the case is still Approved and awaiting its release.
          finalCheck={selected.status === 'Approved' ? {
            checked: isFinalChecked(selected.id),
            grant: grantFor(selected.id),
            onChange: (value) => setFinalChecked(selected.id, value),
          } : null}
          onClose={closeCase}
          onStatusChange={handleStatusChange}
          onRejectApplication={onRejectApplication}
          onWaitlistApplication={onWaitlistApplication}
          onRelease={onReleaseResults}
          interviewWorkspace={interviewWorkspace}
          reviewComments={reviewComments}
          onAddComment={onAddComment}
        />
      )}
    </div>
  );
}
