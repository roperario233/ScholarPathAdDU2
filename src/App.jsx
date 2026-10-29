import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { createFreshState, createInitialState, readStoredState, storageKey } from './lib/appState';
import { OFFICE_ENTRY_KINDS } from './lib/calendarMarks';
import { mergeNotifications } from './lib/notificationMerge';
import { filterLocalDeadlinesForOwner, findDeadlinesMissingFromServer, isFutureDeadline, isRealUserId } from './lib/deadlineSync';
import { evaluateApplicationGate, getAdduInternalPrograms, getDeadlineStatus, isAdduInternalProgram, rankScholarships, searchScholarships } from './lib/eligibility';
import { academicPrograms, getAcademicProgram, getAcademicProgramGroups } from './lib/academicPrograms';
import { APPLICATION_REJECTION_NOTICE, APPLICATION_REJECTION_REASON_PREFIX, DOCUMENT_REPLACEMENT_STATUSES, CASE_OFFICER_JOINABLE_STATUSES, countApplicationsToReview, getNextApplicationStatuses, isAdmissionsHeadRole, isAdmissionsReviewerRole, maskApplicationForStudent } from './lib/constants';
import { getProfileAvatar, getProfileDetails, getProfileReviewScope, getSupabaseSession, getUserProfile, resetPasswordForEmail, signInWithEmailPassword, signOutFromSupabase, signUpWithEmailPassword, subscribeToSupabaseAuth, updateAccountPassword, updateProfileAvatar, updateProfileFields, updateUserProfile, validateSupabaseSession } from './lib/auth';
import { getDocumentsAwaitingReview, getIntakePool, getReleaseQueue, isCaseOfficer } from './lib/admissionsOffice';
import { getUpcomingInterviews } from './lib/interviewRoster';
import { normalizeFinancialAnswers } from './lib/financialDetails';
import { ACCOUNT_FIELD_KEYS, PROFILE_DETAIL_KEYS, PROFILE_DRAFT_KEYS, STAFF_EDITABLE_FIELD_KEYS, VERIFIABLE_ATTRIBUTE_KEYS, deriveYearStanding, getApplicationProfileGate, getAttestedValue, getDocumentTitle, getProvenAttributes, getStandingRequirements, getVerifiableAttributeOption, isComparableAttribute, mergeProfileDetails, pickEligibilityAttributes, pickFields, requiresStudentNumber } from './lib/profile';
import { deriveAttributeVerifications, getNewlyOutdatedAttributes, getOutdatedAttributeAlerts } from './lib/verification';
import { DOCUMENT_MAX_BYTES } from './lib/documentStorage';
import { AVATAR_MAX_BYTES } from './lib/avatarStorage';
import { buildPhotoFileName, normalizeImageFile } from './lib/photoGuide';
import { buildCancelledInterview, buildInterviewRecord, getInterviewDateKey, getInterviewReminderKey, getLatestPanelRecommendation, INTERVIEW_RECOMMENDATION_LEVELS, isInterviewLive, isStructuredInterview, summarizeInterview, validateInterviewSchedule } from './lib/interview';
import { attachSupabaseApplicationDocument, createSupabaseAnnouncement, createSupabaseInterviewNote, invokeSupabaseInterviewEvent, notifySupabaseInterviewUpdate, replaceSupabaseInterviewPanel, saveSupabaseInterviewLocation, updateSupabaseApplicationStage, createSupabaseApplication, createSupabaseCustomDeadline, createSupabaseDocument, createSupabaseOfficeCalendarEntry, createSupabaseScholarship, deleteSupabaseCustomDeadline, deleteSupabaseAvatar, deleteSupabaseDocument, deleteSupabaseOfficeCalendarEntry, detachSupabaseApplicationDocument, getSupabaseAvatarUrl, joinSupabaseApplicationReview, leaveSupabaseApplicationReview, loadSupabaseAcademicPrograms, loadSupabaseApplicationCaseOfficers, loadSupabaseFinancialAnswers, loadSupabaseFinancialProfile, loadSupabaseWorkspace, markSupabaseNotificationRead, notifySupabaseApplicationStatus, notifySupabaseResultsRelease, recordSupabaseResultsRelease, saveSupabaseApprovalLevel, deleteSupabaseApprovalLevel, notifySupabaseDocumentVerification, replaceSupabaseApplicationDocument, saveSupabaseFinancialAnswers, saveSupabaseFinancialProfile, sendSupabaseTestEmail, sendSupabaseTestSms, submitSupabaseApplication, updateSupabaseApplicationDraft, updateSupabaseApplicationStatus, updateSupabaseDocumentStatus, updateSupabaseNotificationPreferences, updateSupabaseScholarship, uploadSupabaseAvatar, createSupabaseReviewComment } from './lib/supabaseData';
import { ENDORSEMENT_BLOCKED_STATUSES, buildProfileSnapshot, getApplicationAttributeVerifications, getApplicationReadiness, getScholarshipRequirements, isApplicationVerifiedForEndorsement, pickDefaultAttachments } from './lib/applicationRequirements';
import AcademicProfileModal from './components/AcademicProfileModal';
import ProfileAvatar from './components/ProfileAvatar';
import { SidebarNav, SidebarProfile, SidebarStats } from './components/SidebarParts';
import SessionTimeoutModal from './components/SessionTimeoutModal';
import { NotificationDropdown } from './components/pageParts';
import LoginScreenPage from './pages/LoginScreen';
import DashboardViewPage from './pages/DashboardView';
import ScholarshipExplorerPage from './pages/ScholarshipExplorer';
import ApplicationsViewPage from './pages/ApplicationsView';
import DocumentVaultViewPage from './pages/DocumentVaultView';
import DocumentUploadModal from './components/DocumentUploadModal';
import AdminOverviewPage from './pages/admin/AdminOverview';
import AdminIntakePoolPage from './pages/admin/AdminIntakePool';
import AdminReviewQueuePage from './pages/admin/AdminReviewQueue';
import AdminScholarshipCatalogPage from './pages/admin/AdminScholarshipCatalog';
import AdminResultsReleasePage from './pages/admin/AdminResultsRelease';
import AdminAnnouncementsPage from './pages/admin/AdminAnnouncements';
import AdminCalendarPage from './pages/admin/AdminCalendar';
import AdminInterviewsPage from './pages/admin/AdminInterviews';
import DepartmentReviewViewPage from './pages/DepartmentReviewView';
import DepartmentCalendarViewPage from './pages/DepartmentCalendarView';
import DepartmentInterviewsViewPage from './pages/DepartmentInterviewsView';
import CalendarViewPage from './pages/CalendarView';
import SettingsViewPage from './pages/SettingsView';
import ProfileViewPage from './pages/ProfileView';
import logoImage from '../pictures/logo.png';
import { clearPendingSessionStart, consumePendingSessionStart, getSessionTimeoutConfig, getSessionTiming, markSessionEnded, readSessionActivity, startSessionActivity, subscribeToSessionActivity, touchSessionActivity } from './lib/sessionTimeout';
import { buildProgramScopeIndex, getReviewPageLabel, getReviewerScope, getScopedQueue, isApproverForApplication, isInterviewerRole, isReviewerRole } from './lib/reviewScope';

const roleLabels = {
  student: 'Student',
  admissions_office: 'Admissions Office Staff',
  admissions_head: 'Admissions Office Head',
  // The academic reviewer ladder: Dean (school), Assistant Dean (cluster), and
  // Chairperson (department). The level configured for a school approves; any of
  // them in scope may also run an interview.
  dean: 'Dean',
  assistant_dean: 'Assistant Dean',
  department_chair: 'Chairperson',
  // A faculty interviewer scoped to one level; recommends only.
  interviewer: 'Interviewer',
};

// The Google Calendar integration state the review surfaces read. `configured`
// means "a Meet link can be generated right now", so a broken or expired
// authorization reads as not configured and the schedule form asks for a pasted
// link instead of failing at save. `code`/`reason` let the panel say what to fix
// (an expired token, a calendar the account cannot see) instead of echoing
// Google's wording.
const emptyInterviewCalendarState = {
  configured: false,
  checked: true,
  checking: false,
  reauthRequired: false,
  code: '',
  reason: '',
  calendarId: '',
  calendar: null,
};

const interviewCalendarState = (result) => ({
  ...emptyInterviewCalendarState,
  configured: result?.ok === true,
  reauthRequired: result?.code === 'reauth_required',
  code: result?.code || '',
  reason: result?.reason || '',
  calendarId: result?.calendarId || '',
  calendar: result?.calendar || null,
});

// Every role that can coordinate an interview needs the Google state: the two
// Admissions Office lanes, and (Consultation 2) any scoped reviewer — an
// interviewer, a Chairperson, an Assistant Dean, or a Dean — who may schedule the
// interview of an applicant in scope. Checking only the office lanes left a Dean's
// panel reading the integration as unavailable, so it could never generate a Meet
// link even though manage-interview-event accepts it.
const canUseInterviewCalendar = (role) => isAdmissionsReviewerRole(role) || isReviewerRole(role);

// The identity rows (sidebar panel and mobile header) should not repeat a staff
// member's name as its own role label, or echo a department whose words are
// already in the name. The central office's seeded name is literally
// "Admissions Office Staff" and its department is "Office of
// Admissions", which otherwise prints the same phrase three times. Parts whose
// significant words are all covered by the name are dropped.
const identityStopwords = new Set(['of', 'the', 'and', 'for']);
const identityWords = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter((word) => word && !identityStopwords.has(word));

const identitySubtitle = (name, ...parts) => {
  const nameWords = new Set(identityWords(name));
  const covered = (value) => {
    const words = identityWords(value);
    return words.length > 0 && words.every((word) => nameWords.has(word));
  };
  return parts
    .map((part) => String(part || '').trim())
    .filter((part) => part && !covered(part))
    .join(' · ');
};

// The Admissions Office is two lanes: `admissions_office` (Staff) prepares a
// case and `admissions_head` decides it. The retired `osa_admin` value and any
// unknown value resolve to the staff lane / student respectively.
const normalizeRole = (role) => {
  if (role === 'osa_admin') return 'admissions_office';
  return ['student', 'admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer'].includes(role) ? role : 'student';
};

// Both Admissions Office lanes land on the office Dashboard (the `admin` route).
// Every scoped reviewer (an interviewer, Chairperson, Assistant Dean, or Dean)
// lands on its review queue and a student on the student dashboard. There is no separate role dashboard beside these pages.
const landingViewForRole = (role) => (isAdmissionsReviewerRole(role)
  ? 'admin'
  : isReviewerRole(role) ? 'review' : 'dashboard');

// A student profile is complete enough for matching once the core academic
// fields and the onboarding eligibility essentials are all recorded. `profile`
// uses the snake_case `profiles` shape; `attributes` is the eligibility mirror.
const isIncompleteStudentProfile = (profile, attributes = {}) => {
  const standing = getStandingRequirements(attributes);
  return (
    !profile?.degree_program
    || !standing.yearStanding
    // The AdDU student number belongs to a current Ateneo student, so a transferee
    // and an incoming first-year are not asked for it.
    || (requiresStudentNumber(attributes) && !profile?.student_number)
    || profile?.household_income == null
    // An incoming first-year has no college QPI yet, so it is not required.
    || (standing.requiresQpi && profile?.qpi == null)
    || !attributes.academicStanding
    || !attributes.citizenship
  );
};

const dateKey = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const date = value instanceof Date ? value : new Date(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const reminderDateKey = (deadline, daysBefore) => {
  const reminderDate = new Date(`${deadline}T00:00:00`);
  reminderDate.setDate(reminderDate.getDate() - daysBefore);
  return dateKey(reminderDate);
};

const prependInAppNotification = (previous, notification) => {
  if (!previous.notificationPreferences?.inAppEnabled) return previous.notifications;
  // A notification carrying a stable sourceKey is only added once, so an event
  // that re-runs (or is replayed) never duplicates the same in-app row.
  const alreadyPresent = notification.sourceKey
    && (previous.notifications ?? []).some((entry) => entry?.sourceKey === notification.sourceKey);
  return alreadyPresent ? previous.notifications : [notification, ...previous.notifications];
};

// The in-app alert for a profile attribute whose Document Vault proof went
// stale, from getOutdatedAttributeAlerts() in src/lib/verification.js.
const buildOutdatedProofNotification = ({ key, reason, sourceKey }, ownerId = null) => {
  const label = getVerifiableAttributeOption(key)?.label || key;
  return {
    id: `not-${crypto.randomUUID()}`,
    sourceKey,
    // Stamped so a shared browser never keeps one user's alert for the next.
    ownerId,
    title: `${label} proof is outdated`,
    channel: 'In-app',
    // A submitted application is judged against its frozen snapshot, so the
    // alert concerns future applications only and says so.
    body: `${reason === 'year'
      ? `A new academic year has started, so your ${label} proof from the previous year no longer verifies this attribute. Upload a current proof in the Document Vault before your next application.`
      : `Your ${label} in your Application Form changed after its proof was uploaded, so the proof no longer verifies this attribute. Upload a new proof in the Document Vault before your next application.`} Applications you already submitted keep the values you declared when you submitted them.`,
    status: 'Unread',
    createdAt: new Date().toISOString().slice(0, 10),
  };
};

// Locally created deadlines live in localStorage while the same rows are also
// persisted to Supabase (so server-side reminders can email them). Merge by id
// so a hydrated session neither drops an unsynced local deadline nor duplicates
// one that already round-tripped through the database.
const mergeCustomDeadlines = (localDeadlines, serverDeadlines, ownerId) => {
  const local = filterLocalDeadlinesForOwner(localDeadlines, ownerId);
  const server = Array.isArray(serverDeadlines) ? serverDeadlines : [];
  const localIds = new Set(local.map((entry) => entry.id));
  return [...local, ...server.filter((entry) => !localIds.has(entry.id))];
};

// Device-level preferences survive an account switch and a sign-out. Every
// other slice is session-scoped and must not leak between users on a browser
// that has not signed the previous user out.
// Only the non-identifying device preferences carry across a sign-out; the
// "remember me" email/role belong to the previous user and reset with the rest.
const devicePreferencesOf = (state) => ({
  theme: state.theme,
  hasLoggedInBefore: state.hasLoggedInBefore,
});

// FORM 230-SCH financial details are sensitive and office-only, so they live in
// component state (never in the persisted localStorage record) and are cleared
// on sign-out. `profile` is the student's reusable financial profile and
// `answersByApplication` the per-application "Financial situation" answers.
const emptyFinancialState = { profile: null, answersByApplication: {}, snapshotsByApplication: {}, loaded: false, missing: false };

// Stamps the persisted state with the signed-in Supabase user. If the record
// still belongs to a different user (a shared browser where sign-out was
// skipped), the previous user's session-scoped slices are discarded first.
const adoptStateOwner = (previous, ownerId) => {
  if (!ownerId) return previous;
  return previous.ownerId && previous.ownerId !== ownerId
    ? { ...createFreshState(devicePreferencesOf(previous)), ownerId }
    : { ...previous, ownerId };
};

// After a successful workspace load, push reminders that exist only in this
// browser: ones created before server persistence existed, while offline, or in
// demo mode. Only ids missing from the server are sent, so this becomes a no-op
// once everything is synced, and the server can then email those reminders.
const backfillLocalDeadlines = async ({ localDeadlines, serverDeadlines, ownerId, today, onError }) => {
  if (!isRealUserId(ownerId)) return;

  const missing = findDeadlinesMissingFromServer(filterLocalDeadlinesForOwner(localDeadlines, ownerId), serverDeadlines)
    .filter((entry) => isFutureDeadline(entry.deadline, today));
  if (!missing.length) return;

  const results = await Promise.all(missing.map((entry) => createSupabaseCustomDeadline({
    id: entry.id,
    ownerId,
    title: entry.title,
    deadline: entry.deadline,
  })));

  const failed = results.filter((result) => result?.error);
  if (failed.length && typeof onError === 'function') {
    onError(`Could not sync ${failed.length} saved reminder${failed.length === 1 ? '' : 's'} to the server, so email reminders will not send for them.`);
  }
};

// Persists one student-created deadline so the scheduled reminder function can
// email the same 7-day / 3-day / 1-day reminders the client generates locally.
// The write is awaited and any failure is logged rather than thrown, so the
// calendar keeps working offline; the reconciliation effect in App() retries a
// deadline whose first write did not land.
const persistCustomDeadline = async (deadline, ownerId) => {
  try {
    const { error } = await createSupabaseCustomDeadline({
      id: deadline.id,
      ownerId,
      title: deadline.title,
      deadline: deadline.deadline,
    });
    if (error) {
      console.warn('[ScholarPath] Reminder saved locally but not synced for email delivery:', error.message || error);
    }
  } catch (error) {
    console.warn('[ScholarPath] Reminder saved locally but not synced for email delivery:', error?.message || error);
  }
};

function App() {
  const [state, setState] = useState(createInitialState);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  // theme: 'dark' | 'light' — persisted in state
  const [isBooting, setIsBooting] = useState(true);
  const [isSessionChecked, setIsSessionChecked] = useState(false);
  const [sessionTimeoutState, setSessionTimeoutState] = useState(null);
  const [sessionNotice, setSessionNotice] = useState('');
  const endingSessionRef = useRef(false);
  const absoluteWarningDismissedRef = useRef(false);
  const lastValidationAtRef = useRef(0);
  const lastActivityEventAtRef = useRef(0);
  const sessionTimeoutConfig = useMemo(() => getSessionTimeoutConfig(), []);
  const [profileOnboarding, setProfileOnboarding] = useState(null);
  const [profileSaveError, setProfileSaveError] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSupabaseWorkspaceLoaded, setIsSupabaseWorkspaceLoaded] = useState(false);
  const [financial, setFinancial] = useState(emptyFinancialState);
  // When a My Profile link ("Attach proof" or the document checklist) opens the
  // vault it carries the profile attribute and/or document type so the upload
  // form opens on them.
  const [vaultPreset, setVaultPreset] = useState({ attribute: '', documentType: '' });
  // The upload dialog My Profile opens from "Attach proof" and the document
  // checklist, so a proof is uploaded without leaving the Application Form.
  const [proofUpload, setProofUpload] = useState(null);
  // The My Profile section to open on, set when the Smart Eligibility Checker
  // links a failed reason to the section that edits it.
  const [profilePresetSection, setProfilePresetSection] = useState('');
  // The answer inside that section to highlight (a `data-field` key).
  const [profilePresetField, setProfilePresetField] = useState('');
  const [deadlineSync, setDeadlineSync] = useState(null);
  // The draft the application workspace opens on, set when a student starts an
  // application from the explorer or continues one from the dashboard.
  const [openApplicationId, setOpenApplicationId] = useState(null);
  // The Admissions Office catalog form is uncontrolled and lives on its own
  // route, so leaving that route discards the draft. The route reports its own
  // dirtiness (including required-document edits) for the navigation guard.
  const [isAdminCatalogDirty, setIsAdminCatalogDirty] = useState(false);
  // The signed avatar URL expires, so it is kept in memory only; the stored
  // avatarPath (profiles.avatar_path) is what rides along in app state.
  const [avatarPreview, setAvatarPreview] = useState({ path: '', url: '' });
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  // The state of the optional Google Calendar integration (manage-interview-event).
  // It is verified against Google, not just against the presence of the secrets,
  // so an expired refresh token or an unreachable calendar is visible before the
  // Admissions Office tries to schedule. Without a working integration an online
  // interview needs a pasted meeting link.
  const [interviewCalendar, setInterviewCalendar] = useState({ ...emptyInterviewCalendarState, checked: false, checking: true });

  const updateState = (updater) => setState((previous) => {
    const nextState = typeof updater === 'function' ? updater(previous) : updater;
    return {
      ...previous,
      ...nextState,
    };
  });

  const endSession = useCallback(async (reason = 'signed-out', ownerId = null, { skipSupabaseSignOut = false } = {}) => {
    if (endingSessionRef.current) return;
    endingSessionRef.current = true;
    clearPendingSessionStart();
    if (ownerId) markSessionEnded({ ownerId, reason });
    const notice = reason === 'idle'
      ? 'You were signed out after a period of inactivity. Sign in again to continue.'
      : reason === 'absolute'
        ? 'Your maximum session duration was reached. Sign in again to continue.'
        : reason === 'revoked'
          ? 'Your session could not be verified. Please sign in again.'
          : '';
    // Remove the authenticated UI immediately. Network sign-out can take time;
    // the local guard must not wait for token revocation to complete.
    setState((previous) => createFreshState(devicePreferencesOf(previous)));
    setProfileOnboarding(null);
    setIsSupabaseWorkspaceLoaded(false);
    setDeadlineSync(null);
    setAvatarPreview({ path: '', url: '' });
    setFinancial(emptyFinancialState);
    setSessionTimeoutState(null);
    setSessionNotice(notice);
    setIsSessionChecked(true);
    try {
      if (!skipSupabaseSignOut) await signOutFromSupabase();
    } catch {
      // Always clear the local authenticated shell even if revocation cannot
      // reach Supabase; RLS still rejects an expired or revoked server token.
    } finally {
      endingSessionRef.current = false;
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  // Load the student's office-only financial details once the workspace is up.
  const financialOwnerId = state.viewerRole === 'student' ? state.authUser?.id : null;
  useEffect(() => {
    if (!isSupabaseWorkspaceLoaded || !financialOwnerId) return undefined;
    let active = true;
    (async () => {
      const [profileResult, answersResult] = await Promise.all([
        loadSupabaseFinancialProfile(financialOwnerId),
        loadSupabaseFinancialAnswers(),
      ]);
      if (!active) return;
      setFinancial({
        profile: profileResult.success ? profileResult.details : null,
        answersByApplication: answersResult.success ? answersResult.answersByApplication : {},
        snapshotsByApplication: answersResult.success ? answersResult.snapshotsByApplication : {},
        loaded: true,
        missing: Boolean(profileResult.missing || answersResult.missing),
      });
    })();
    return () => { active = false; };
  }, [isSupabaseWorkspaceLoaded, financialOwnerId]);

  useEffect(() => {
    // Apply theme classes to the document root so body background updates and
    // Tailwind's `dark:` variants also work for portaled dialogs and pickers.
    const root = document.documentElement;
    root.classList.toggle('theme-light', state.theme === 'light');
    root.classList.toggle('dark', state.theme !== 'light');
  }, [state.theme]);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsBooting(false), 250);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isBooting || !isSessionChecked || !state.isAuthenticated) {
      return undefined;
    }

    const syncDeadlineReminders = () => {
      setState((previous) => {
        // A scheduled interview (SOP step 5) also gets the 1-day reminder, so
        // the early return waits for either source.
        const upcomingInterviews = previous.viewerRole === 'student'
          ? (previous.applications || []).filter((entry) => (
            entry.status === 'Interview' && isStructuredInterview(entry.interview) && entry.interview.state === 'scheduled'
          ))
          : [];
        if (!previous.notificationPreferences?.inAppEnabled || (!previous.customDeadlines?.length && !upcomingInterviews.length)) {
          return previous;
        }

        const today = dateKey(new Date());
        const reminderOptions = [
          { key: 'oneWeekBefore', daysBefore: 7 },
          { key: 'threeDaysBefore', daysBefore: 3 },
          { key: 'dayBefore', daysBefore: 1 },
        ];
        const existingReminderKeys = new Set(
          (previous.notifications ?? []).map((notification) => notification.sourceKey).filter(Boolean),
        );
        const dueReminders = [];

        (previous.customDeadlines || []).forEach((deadline) => {
          reminderOptions.forEach(({ key, daysBefore }) => {
            if (!previous.notificationPreferences.deadlineReminders?.[key]) {
              return;
            }

            const reminderDate = reminderDateKey(deadline.deadline, daysBefore);
            const sourceKey = `deadline-reminder-${deadline.id}-${daysBefore}`;
            if (reminderDate > today || today > deadline.deadline || existingReminderKeys.has(sourceKey)) {
              return;
            }

            dueReminders.push({
              id: `not-${crypto.randomUUID()}`,
              sourceKey,
              // Stamped so the reminder does not follow the browser to another user.
              ownerId: previous.ownerId ?? previous.authUser?.id ?? null,
              title: `Reminder: "${deadline.title}" due in ${daysBefore} day${daysBefore === 1 ? '' : 's'}`,
              channel: 'In-app',
              body: daysBefore === 1
                ? 'Your deadline is tomorrow. Make sure all required documents are ready.'
                : `You have ${daysBefore} days to prepare documents and materials for this deadline.`,
              status: 'Unread',
              createdAt: today,
            });
          });
        });

        if (previous.notificationPreferences.deadlineReminders?.dayBefore) {
          upcomingInterviews.forEach((entry) => {
            const interviewDate = getInterviewDateKey(entry.interview.startsAt);
            const sourceKey = getInterviewReminderKey(entry.id, entry.interview.revision);
            if (!interviewDate || reminderDateKey(interviewDate, 1) > today || today > interviewDate || existingReminderKeys.has(sourceKey)) {
              return;
            }
            dueReminders.push({
              id: `not-${crypto.randomUUID()}`,
              sourceKey,
              ownerId: previous.ownerId ?? previous.authUser?.id ?? null,
              title: `Reminder: your ${entry.scholarshipTitle || 'scholarship'} interview is tomorrow`,
              channel: 'In-app',
              body: summarizeInterview(entry.interview),
              status: 'Unread',
              createdAt: today,
            });
          });
        }

        return dueReminders.length
          ? { ...previous, notifications: [...dueReminders, ...(previous.notifications ?? [])] }
          : previous;
      });
    };

    syncDeadlineReminders();
    const interval = window.setInterval(syncDeadlineReminders, 60 * 60 * 1000);
    window.addEventListener('focus', syncDeadlineReminders);
    document.addEventListener('visibilitychange', syncDeadlineReminders);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', syncDeadlineReminders);
      document.removeEventListener('visibilitychange', syncDeadlineReminders);
    };
  }, [isBooting, isSessionChecked, state.isAuthenticated]);

  // The local deadline list is the source of truth for the calendar, but the
  // server-side reminder function can only email deadlines it can read from
  // `custom_deadlines`. Mirror the current list once the workspace is ready, and
  // again after every change, so a reminder created before the workspace finished
  // loading (or one whose first write failed) is still persisted and eligible for
  // email. The upsert is idempotent on the client-generated id.
  useEffect(() => {
    if (!isSupabaseWorkspaceLoaded || !canUseInterviewCalendar(state.viewerRole) || interviewCalendar.checked) {
      return undefined;
    }
    let active = true;
    // `status` only proves the secrets exist; `verify` refreshes the token and
    // reads the target calendar, so a revoked authorization or a calendar the
    // office account cannot see is caught here instead of at the moment an
    // interview is being scheduled. The state starts as `checking` while this
    // runs (see the initial value above), so the body never sets state directly.
    invokeSupabaseInterviewEvent({ action: 'verify' })
      .then((result) => {
        if (active) setInterviewCalendar(interviewCalendarState(result));
      })
      .catch(() => {
        if (active) setInterviewCalendar({ ...emptyInterviewCalendarState });
      });
    return () => { active = false; };
  }, [isSupabaseWorkspaceLoaded, state.viewerRole, interviewCalendar.checked]);

  useEffect(() => {
    if (!isSupabaseWorkspaceLoaded || !state.authUser?.id) {
      return;
    }

    state.customDeadlines.forEach((deadline) => {
      persistCustomDeadline(deadline, state.authUser.id);
    });
  }, [isSupabaseWorkspaceLoaded, state.authUser?.id, state.customDeadlines]);

  useEffect(() => {
    if (isBooting) {
      return undefined;
    }

    let active = true;

    const hydrateSession = async () => {
      let sessionOwnerId = null;
      try {
      const result = await getSupabaseSession();
      if (!active) return;
      if (!result.session) {
        consumePendingSessionStart();
        if (result.message) {
          await endSession('revoked', readStoredState()?.ownerId);
          return;
        }
        setState((previous) => createFreshState(devicePreferencesOf(previous)));
        return;
      }

      const cachedUser = result.session.user;
      const user = cachedUser;
      sessionOwnerId = user.id;
      let activity = readSessionActivity();
      const oauthStartedAt = consumePendingSessionStart();
      if (oauthStartedAt !== null) {
        activity = startSessionActivity({ ownerId: user.id, startedAt: oauthStartedAt, lastActivityAt: Date.now() });
        absoluteWarningDismissedRef.current = false;
        lastActivityEventAtRef.current = Date.now();
          if (!activity) {
            await endSession('revoked', user.id);
            return;
          }
      } else if (!activity || activity.ownerId !== user.id || activity.endedAt) {
        activity = null;
      }
      // Never restore an older pre-policy session without a verifiable start
      // timestamp. Requiring sign-in once is safer than inventing a session age.
      if (!activity || activity.ownerId !== user.id || activity.endedAt) {
        await endSession(activity?.endReason || 'revoked', user.id);
        return;
      }
      if (!Number.isFinite(activity.startedAt) || !Number.isFinite(activity.lastActivityAt)) {
        await endSession('revoked', user.id);
        return;
      }
      const timing = getSessionTiming({
        startedAt: activity.startedAt,
        lastActivityAt: activity.lastActivityAt,
        config: sessionTimeoutConfig,
      });
      if (timing.isExpired) {
        await endSession(timing.reason, user.id);
        return;
      }
      const validation = await validateSupabaseSession();
      if (!active) return;
      if (!validation.user || validation.user.id !== user.id) {
        await endSession('revoked', user.id);
        return;
      }
      lastValidationAtRef.current = Date.now();
      if (!active) return;
      const profileResult = await getUserProfile(user.id);
      if (!active) return;
      const profile = profileResult.profile;
      const profileDetails = await getProfileDetails(user.id);
      if (!active) return;
      const reviewScopeFields = await getProfileReviewScope(user.id);
      if (!active) return;
      const profileAvatar = await getProfileAvatar(user.id);
      if (!active) return;
      const userRole = normalizeRole(profile?.role || user.user_metadata?.role);
      updateState((previous) => {
        const base = adoptStateOwner(previous, user.id);
        return {
          ...base,
          isAuthenticated: true,
          sessionsStartedAt: activity.startedAt,
          lastSessionActivityAt: activity.lastActivityAt,
          viewerRole: userRole,
          activeView: landingViewForRole(userRole),
          authUser: {
            id: user.id,
            email: user.email,
            phone: profile?.phone || '',
            role: userRole,
            fullName: profile?.full_name || user.user_metadata?.full_name || user.email || 'Signed in user',
            department: profile?.department || '',
            degreeProgram: profile?.degree_program || '',
            studentNumber: profile?.student_number || user.user_metadata?.student_id || '',
            qpi: profile?.qpi ?? '',
            householdIncome: profile?.household_income ?? '',
            hasActiveGovernmentGrant: profile?.has_active_government_grant ?? false,
            bio: profileDetails.bio,
            avatarPath: profileAvatar.avatarPath || '',
            // The reviewer scope ladder (src/lib/reviewScope.js): a Dean owns a
            // school, an Assistant Dean a cluster, a Chairperson a department.
            ...reviewScopeFields,
          },
          profileDraft: {
            ...base.profileDraft,
            ...profileDetails.eligibilityAttributes,
            ...profileDetails.profileDetails,
            ...(profile?.degree_program ? { degreeProgram: profile.degree_program } : {}),
          },
        };
      });
      // Resolve a short-lived URL for the stored avatar; the persisted value is
      // only the object path, never an expiring URL.
      if (active) {
        if (profileAvatar.avatarPath) {
          const { url } = await getSupabaseAvatarUrl(profileAvatar.avatarPath);
          if (active) setAvatarPreview({ path: profileAvatar.avatarPath, url: url || '' });
        } else {
          setAvatarPreview({ path: '', url: '' });
        }
      }
      const workspace = await loadSupabaseWorkspace({ role: userRole, userId: user.id, department: profile?.department || '' });
      if (!active) return;
      if (active && workspace.success) {
        updateState((previous) => {
          const base = adoptStateOwner(previous, user.id);
          return {
            ...base,
            ...workspace,
            // The Supabase workspace is authoritative for server-backed notifications,
            // but locally generated deadline reminders only exist in localStorage.
            // Merge instead of replacing so hydrated sessions cannot wipe them, and
            // scope the merge to this user so a shared browser cannot carry over the
            // previous user's reminders.
            notifications: mergeNotifications(base.notifications, workspace.notifications, { ownerId: user.id }),
            customDeadlines: mergeCustomDeadlines(base.customDeadlines, workspace.customDeadlines, user.id),
          };
        });
        setIsSupabaseWorkspaceLoaded(true);
        // Push any reminder that only exists in this browser so it can be emailed.
        backfillLocalDeadlines({
          localDeadlines: readStoredState()?.customDeadlines,
          serverDeadlines: workspace.customDeadlines,
          ownerId: user.id,
          today: dateKey(new Date()),
          onError: (message) => setDeadlineSync({ tone: 'error', message }),
        });
      }
      if (active) {
        const academicProgramsResult = await loadSupabaseAcademicPrograms();
        if (!active) return;
        if (academicProgramsResult.success && academicProgramsResult.academicPrograms?.length) {
          updateState((previous) => ({ ...previous, academicPrograms: academicProgramsResult.academicPrograms }));
        }
      }
      if (active && userRole === 'student' && isIncompleteStudentProfile(profile, profileDetails.eligibilityAttributes)) {
        if (readStoredState()?.profileSkipped) return;
        const attributes = profileDetails.eligibilityAttributes || {};
        setProfileOnboarding({ id: user.id, fullName: profile?.full_name || user.user_metadata?.full_name || user.email || 'Signed in user', initialProgram: profile?.degree_program || '', initialProgramChoice2: attributes.programChoice2 || '', initialProgramChoice3: attributes.programChoice3 || '', initialStudentNumber: profile?.student_number || user.user_metadata?.student_id || '', initialYearStanding: deriveYearStanding(attributes), initialIsTransferee: attributes.isTransferee || '', initialAcademicStanding: attributes.academicStanding || '', initialCitizenship: attributes.citizenship || '', initialQpi: profile?.qpi ?? '', initialHsStrand: attributes.hsStrand || '', initialHsAverage: attributes.hsAverage ?? '', initialHouseholdIncome: profile?.household_income ?? '', initialHasActiveGovernmentGrant: profile?.has_active_government_grant ?? false });
      }
      } catch {
        if (active) await endSession('revoked', sessionOwnerId || readStoredState()?.ownerId);
      } finally {
        if (active) setIsSessionChecked(true);
      }
    };

    hydrateSession();

    return () => {
      active = false;
    };
  }, [endSession, isBooting, sessionTimeoutConfig]);

  useEffect(() => {
    if (!state.isAuthenticated || !state.authUser?.id) {
      return undefined;
    }

    const ownerId = state.authUser.id;
    const evaluateSession = () => {
      const activity = readSessionActivity();
      if (!activity || activity.ownerId !== ownerId || activity.endedAt) {
        endSession(activity?.endReason || 'revoked', ownerId);
        return;
      }
      const timing = getSessionTiming({
        startedAt: activity.startedAt,
        lastActivityAt: activity.lastActivityAt,
        config: sessionTimeoutConfig,
      });
      if (timing.isExpired) {
        endSession(timing.reason, ownerId);
        return;
      }
      if (timing.reason === 'absolute' && absoluteWarningDismissedRef.current) {
        setSessionTimeoutState(null);
      } else {
        const warningStartedAt = Date.now();
        setSessionTimeoutState((current) => {
          if (!timing.isWarning) return null;
          if (current?.reason === timing.reason && current?.expiresAt === timing.expiresAt) return current;
          return {
            reason: timing.reason,
            expiresAt: timing.expiresAt,
            warningMs: sessionTimeoutConfig.warningMs,
            warningStartedAt,
          };
        });
      }
    };

    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivityEventAtRef.current < sessionTimeoutConfig.activityThrottleMs) return;
      lastActivityEventAtRef.current = now;
      const current = readSessionActivity();
      if (!current || current.ownerId !== ownerId || current.endedAt) return;
      const timing = getSessionTiming({ startedAt: current.startedAt, lastActivityAt: current.lastActivityAt, config: sessionTimeoutConfig });
      if (timing.isExpired) {
        endSession(timing.reason, ownerId);
        return;
      }
      const touched = touchSessionActivity({ ownerId, throttleMs: sessionTimeoutConfig.activityThrottleMs });
      if (touched) {
        setState((previous) => previous.lastSessionActivityAt === touched.lastActivityAt
          ? previous
          : { ...previous, lastSessionActivityAt: touched.lastActivityAt });
      }
      evaluateSession();
    };

    const onReturn = async (forceValidation = false) => {
      evaluateSession();
      if (document.visibilityState === 'hidden') return;
      if (!forceValidation && Date.now() - lastValidationAtRef.current < sessionTimeoutConfig.revalidationIntervalMs) return;
      lastValidationAtRef.current = Date.now();
      const result = await validateSupabaseSession();
      if (!result.user || result.user.id !== ownerId) endSession('revoked', ownerId);
    };

    const onFocus = () => onReturn(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onReturn(true);
    };

    const onStorageActivity = (activity) => {
      if (activity?.ownerId !== ownerId || !activity) return;
      if (activity.endedAt) {
        // The initiating tab already revoked the Supabase session; this tab
        // only needs to clear its authenticated UI and local app state.
        endSession(activity.endReason || 'revoked', ownerId, { skipSupabaseSignOut: true });
        return;
      }
      setState((previous) => (activity.lastActivityAt > (previous.lastSessionActivityAt || 0)
        ? { ...previous, lastSessionActivityAt: activity.lastActivityAt }
        : previous));
      evaluateSession();
    };

    const initialEvaluation = window.setTimeout(evaluateSession, 0);
    const timer = window.setInterval(evaluateSession, sessionTimeoutConfig.checkIntervalMs);
    const revalidator = window.setInterval(onReturn, sessionTimeoutConfig.revalidationIntervalMs);
    const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, onActivity, { passive: true }));
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const unsubscribe = subscribeToSessionActivity(onStorageActivity);

    return () => {
      window.clearTimeout(initialEvaluation);
      window.clearInterval(timer);
      window.clearInterval(revalidator);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, onActivity));
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
    };
  }, [endSession, sessionTimeoutConfig, state.authUser?.id, state.isAuthenticated]);

  useEffect(() => subscribeToSupabaseAuth((event) => {
    const activity = readSessionActivity();
    if (event === 'SIGNED_OUT' && !endingSessionRef.current && state.isAuthenticated && !activity?.endedAt) {
      // Supabase auth listeners run under the auth lock; do not call signOut a
      // second time from inside this callback. This tab is already signed out.
      endSession('revoked', state.authUser?.id, { skipSupabaseSignOut: true });
    }
  }), [endSession, state.authUser?.id, state.isAuthenticated]);

  // Supabase is the required backend, so a signed-in session always carries a
  // real authUser. This empty scaffold only fills fields the profile row does
  // not yet have, so the authenticated shell never renders `undefined`.
  const emptyAccount = {
    id: null,
    role: 'student',
    fullName: '',
    email: '',
    phone: '',
    department: '',
    degreeProgram: '',
    studentNumber: '',
    qpi: '',
    householdIncome: '',
    hasActiveGovernmentGrant: false,
    bio: '',
    avatarPath: '',
  };

  const currentProfile = {
    ...emptyAccount,
    ...(state.authUser || {}),
    role: normalizeRole(state.authUser?.role || state.viewerRole),
  };

  const themeClass = state.theme === 'light' ? 'theme-light' : '';
  const studentMatchProfile = {
    ...state.profileDraft,
    ...(state.authUser || {}),
    ...(financial.profile ? { financialProfile: financial.profile } : {}),
  };
  const currentIdentity = state.viewerRole === 'student'
    ? { ...currentProfile, ...state.profileDraft, ...(state.authUser || {}), ...(financial.profile ? { financialProfile: financial.profile } : {}) }
    : currentProfile;
  // De-duplicated identity lines (see identitySubtitle): the role only (the
  // sidebar's role pill and the mobile header), and the department alone (the
  // sidebar's detail line), with anything already covered by the name removed.
  const identityRoleLine = identitySubtitle(currentIdentity.fullName, roleLabels[state.viewerRole]);
  const identityDetailLine = identitySubtitle(currentIdentity.fullName, currentIdentity.department);
  const activeAcademicPrograms = state.academicPrograms?.length ? state.academicPrograms : academicPrograms;
  // The picker groups programs by "School — Cluster" with the academic department
  // as each option's description, so all four levels are reachable from one list.
  const activeAcademicProgramGroups = getAcademicProgramGroups(activeAcademicPrograms);
  const scholarshipCatalog = isSupabaseWorkspaceLoaded && state.scholarships?.length
    ? getAdduInternalPrograms(state.scholarships)
    : [];

  const eligibleScholarships = useMemo(() => rankScholarships(studentMatchProfile, scholarshipCatalog), [studentMatchProfile, scholarshipCatalog]);
  const filteredScholarships = useMemo(
    () => searchScholarships(scholarshipCatalog, state.searchQuery, state.filters),
    [scholarshipCatalog, state.searchQuery, state.filters],
  );

  // A student's own applications. Results are released per scholarship in one
  // batch, so an Approved or Rejected outcome reads "Under deliberation" until a
  // release covers it (maskApplicationForStudent). Nothing is held while the
  // release migration is pending, because no release could ever unmask it.
  const studentApplications = useMemo(
    () => state.applications
      .filter((entry) => entry.studentId === currentProfile.id)
      .map((entry) => (state.viewerRole === 'student' && state.resultsReleasesReady
        ? maskApplicationForStudent(entry, state.resultsReleases)
        : entry)),
    [state.applications, currentProfile.id, state.viewerRole, state.resultsReleases, state.resultsReleasesReady],
  );

  const studentDocuments = useMemo(
    () => state.documents.filter((entry) => entry.ownerId === currentProfile.id),
    [state.documents, currentProfile.id],
  );
  // Each profile attribute's verification state is derived from the proof
  // documents the student linked in the vault (src/lib/verification.js). The
  // profile is passed so a proof whose attested value no longer matches the
  // declared one reads as Outdated.
  const attributeVerifications = useMemo(
    () => deriveAttributeVerifications(studentDocuments, VERIFIABLE_ATTRIBUTE_KEYS, { profile: studentMatchProfile }),
    // studentMatchProfile is rebuilt every render from these two slices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studentDocuments, state.profileDraft, state.authUser],
  );
  // Announce each attribute that turns Outdated in the notification center. It
  // waits for the workspace, which loads after the profile, so a half-hydrated
  // profile never reads as a changed value; the stable source key keeps one row
  // per stale state (prependInAppNotification also honors inAppEnabled).
  useEffect(() => {
    if (!isSupabaseWorkspaceLoaded || state.viewerRole !== 'student') return;
    const alerts = getOutdatedAttributeAlerts(studentDocuments, studentMatchProfile);
    if (!alerts.length) return;
    setState((previous) => {
      const notifications = alerts.reduce(
        (current, alert) => prependInAppNotification({ ...previous, notifications: current }, buildOutdatedProofNotification(alert, previous.ownerId ?? previous.authUser?.id ?? null)),
        previous.notifications,
      );
      return notifications === previous.notifications ? previous : { ...previous, notifications };
    });
    // attributeVerifications changes exactly when the documents or profile do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupabaseWorkspaceLoaded, state.viewerRole, attributeVerifications]);
  const visibleNotifications = state.notificationPreferences.inAppEnabled ? state.notifications : [];
  const unreadNotifications = useMemo(() => visibleNotifications.filter((entry) => entry.status === 'Unread'), [visibleNotifications]);
  const activeDeadlineCount = useMemo(
    () => scholarshipCatalog.filter((entry) => getDeadlineStatus(entry.deadline).tone !== 'danger').length,
    [scholarshipCatalog],
  );

  const stats = useMemo(() => ({
    totalPrograms: scholarshipCatalog.length,
    eligibleMatches: eligibleScholarships.length,
    // Role-aware so the dashboard agrees with the review queues: a student sees
    // their own live applications, an Admissions Office Staff account sees the
    // cases it joined plus the unclaimed intake pool, and a reviewer at any level of
    // the academic ladder sees the pending queue inside its own scope.
    openApplications: countApplicationsToReview(state.applications, {
      role: state.viewerRole,
      studentId: currentProfile.id,
      department: currentProfile.department,
      caseOfficers: state.caseOfficers,
      userId: currentProfile.id,
      reviewScope: getReviewerScope({ ...currentProfile, role: state.viewerRole }),
      programs: activeAcademicPrograms,
    }),
    unreadNotifications: unreadNotifications.length,
  }), [
    eligibleScholarships.length,
    scholarshipCatalog.length,
    state.applications,
    state.caseOfficers,
    state.viewerRole,
    currentProfile.id,
    currentProfile.department,
    unreadNotifications.length,
  ]);

  // The sidebar's quick-glance tiles follow the account's role. A student keeps the
  // catalog overview; each office lane and each reviewer sees its own workload, read
  // through the same selectors as the pages the numbers summarize.
  const sidebarStats = useMemo(() => {
    const role = state.viewerRole;
    const applications = state.applications || [];
    const unread = { key: 'unread', label: 'Unread alerts', value: unreadNotifications.length };
    if (isAdmissionsReviewerRole(role)) {
      const isHead = isAdmissionsHeadRole(role);
      return [
        { key: 'intake', label: 'Intake pool', value: getIntakePool(applications, state.caseOfficers).length },
        { key: 'verify', label: 'Files to verify', value: getDocumentsAwaitingReview(applications, state.documents).length },
        isHead
          ? { key: 'release', label: 'Final check', value: getReleaseQueue(applications).approved.length }
          : { key: 'interviews', label: 'Interviews', value: getUpcomingInterviews(applications).length },
      ];
    }
    if (isReviewerRole(role)) {
      const reviewerProfile = { ...currentProfile, role };
      const scoped = getScopedQueue(applications, reviewerProfile, activeAcademicPrograms);
      const programIndex = buildProgramScopeIndex(activeAcademicPrograms);
      const interviews = { key: 'interviews', label: 'Interviews', value: getUpcomingInterviews(scoped).length };
      if (isInterviewerRole(role)) {
        return [
          { key: 'schedule', label: 'To schedule', value: scoped.filter((entry) => entry.status === 'Endorsed').length },
          interviews,
          unread,
        ];
      }
      return [
        { key: 'cases', label: 'Cases in scope', value: scoped.filter((entry) => !['Draft', 'Released', 'Rejected'].includes(entry.status)).length },
        {
          key: 'approve',
          label: 'To approve',
          value: scoped.filter((entry) => entry.status === 'Recommended'
            && isApproverForApplication(entry, reviewerProfile, state.approvalLevels || [], programIndex)).length,
        },
        interviews,
      ];
    }
    return [
      { key: 'programs', label: 'Programs', value: scholarshipCatalog.length },
      { key: 'deadlines', label: 'Open deadlines', value: activeDeadlineCount },
      unread,
    ];
  }, [
    state.viewerRole,
    state.applications,
    state.caseOfficers,
    state.documents,
    state.approvalLevels,
    currentProfile,
    activeAcademicPrograms,
    scholarshipCatalog.length,
    activeDeadlineCount,
    unreadNotifications.length,
  ]);

  // Navigating to the vault clears any upload preset; the My Profile links pass
  // the attribute and/or document type so the upload form opens on them.
  const navigate = (view, options = {}) => {
    // Leaving the catalog route discards its uncontrolled form, so ask first.
    // Clicking the catalog link while already there keeps the draft and the flag.
    if (state.activeView === 'admin-catalog' && view !== 'admin-catalog') {
      if (isAdminCatalogDirty && !window.confirm('Discard your unsaved scholarship changes?')) return;
      setIsAdminCatalogDirty(false);
    }
    setVaultPreset(view === 'vault'
      ? { attribute: options.attribute || '', documentType: options.documentType || '' }
      : { attribute: '', documentType: '' });
    setProfilePresetSection(view === 'profile' ? (options.section || '') : '');
    setProfilePresetField(view === 'profile' ? (options.field || '') : '');
    setOpenApplicationId(view === 'applications' ? (options.applicationId || null) : null);
    updateState({ activeView: view });
    setIsMobileNavOpen(false);
  };

  const login = async (credentials) => {
    const selectedRole = credentials.role || 'student';
    const authResult = await signInWithEmailPassword({
      email: credentials.email,
      password: credentials.password,
    });

    if (authResult.success) {
      const sessionStartedAt = Date.now();
      const sessionActivity = authResult.user?.id
        ? startSessionActivity({ ownerId: authResult.user.id, startedAt: sessionStartedAt, lastActivityAt: sessionStartedAt })
        : null;
      if (!sessionActivity) {
      await signOutFromSupabase();
        return { success: false, message: 'Secure session storage is unavailable. Enable browser storage and sign in again.' };
      }
      setSessionNotice('');
      absoluteWarningDismissedRef.current = false;
      lastActivityEventAtRef.current = sessionStartedAt;
      setIsSessionChecked(true);
      lastValidationAtRef.current = sessionStartedAt;
      const profileResult = authResult.user?.id ? await getUserProfile(authResult.user.id) : { profile: null };
      const profile = profileResult.profile;
      const profileDetails = authResult.user?.id ? await getProfileDetails(authResult.user.id) : { bio: '', eligibilityAttributes: {} };
      const reviewScopeFields = authResult.user?.id ? await getProfileReviewScope(authResult.user.id) : {};
      const resolvedRole = normalizeRole(profile?.role || authResult.user?.user_metadata?.role || selectedRole);
      const accountId = authResult.user?.id;
      const displayName = profile?.full_name || authResult.user?.user_metadata?.full_name || authResult.user?.email || '';
      updateState((previous) => {
        const base = adoptStateOwner(previous, accountId);
        return {
          ...base,
          isAuthenticated: true,
          sessionsStartedAt: sessionStartedAt,
          lastSessionActivityAt: sessionStartedAt,
          hasLoggedInBefore: true,
          showFirstLoginWelcome: !base.hasLoggedInBefore,
          viewerRole: resolvedRole,
          activeView: landingViewForRole(resolvedRole),
          authUser: {
            id: accountId,
            email: credentials.email,
            role: resolvedRole,
            fullName: displayName,
            department: profile?.department || '',
            degreeProgram: profile?.degree_program || '',
            studentNumber: profile?.student_number || authResult.user?.user_metadata?.student_id || '',
            qpi: profile?.qpi ?? '',
            householdIncome: profile?.household_income ?? '',
            ...(profile ? {
              phone: profile.phone || '',
              hasActiveGovernmentGrant: profile.has_active_government_grant ?? false,
              bio: profileDetails.bio,
            } : {}),
            // The reviewer scope ladder (src/lib/reviewScope.js).
            ...reviewScopeFields,
          },
          rememberMe: credentials.rememberMe || false,
          savedEmail: credentials.rememberMe ? credentials.email : base.savedEmail,
          savedRole: credentials.rememberMe ? resolvedRole : base.savedRole,
          profileDraft: {
            ...base.profileDraft,
            ...profileDetails.eligibilityAttributes,
            ...profileDetails.profileDetails,
            ...(profile?.degree_program ? { degreeProgram: profile.degree_program } : {}),
          },
        };
      });
      const workspace = await loadSupabaseWorkspace({ role: resolvedRole, userId: accountId, department: profile?.department || '' });
      if (workspace.success) {
        updateState((previous) => {
          const base = adoptStateOwner(previous, accountId);
          return {
            ...base,
            ...workspace,
            notifications: mergeNotifications(base.notifications, workspace.notifications, { ownerId: accountId }),
            customDeadlines: mergeCustomDeadlines(base.customDeadlines, workspace.customDeadlines, accountId),
          };
        });
        setIsSupabaseWorkspaceLoaded(true);
        // Push any reminder that only exists in this browser so it can be emailed.
        backfillLocalDeadlines({
          localDeadlines: readStoredState()?.customDeadlines,
          serverDeadlines: workspace.customDeadlines,
          ownerId: authResult.user?.id,
          today: dateKey(new Date()),
          onError: (message) => setDeadlineSync({ tone: 'error', message }),
        });
      }
      const academicProgramsResult = await loadSupabaseAcademicPrograms();
      if (academicProgramsResult.success && academicProgramsResult.academicPrograms?.length) {
        updateState((previous) => ({ ...previous, academicPrograms: academicProgramsResult.academicPrograms }));
      }
      if (authResult.user?.id && resolvedRole === 'student' && isIncompleteStudentProfile(profile, profileDetails.eligibilityAttributes) && !readStoredState()?.profileSkipped) {
        const attributes = profileDetails.eligibilityAttributes || {};
        setProfileOnboarding({ id: authResult.user.id, fullName: displayName, initialProgram: profile?.degree_program || '', initialProgramChoice2: attributes.programChoice2 || '', initialProgramChoice3: attributes.programChoice3 || '', initialStudentNumber: profile?.student_number || authResult.user?.user_metadata?.student_id || '', initialYearStanding: deriveYearStanding(attributes), initialIsTransferee: attributes.isTransferee || '', initialAcademicStanding: attributes.academicStanding || '', initialCitizenship: attributes.citizenship || '', initialQpi: profile?.qpi ?? '', initialHsStrand: attributes.hsStrand || '', initialHsAverage: attributes.hsAverage ?? '', initialHouseholdIncome: profile?.household_income ?? '', initialHasActiveGovernmentGrant: profile?.has_active_government_grant ?? false });
      }

      return {
        success: true,
        fallback: false,
        message: authResult.message,
      };
    }

    return {
      success: false,
      fallback: false,
      message: authResult.message || 'Unable to sign in with that email and password.',
    };
  };

  const signup = async (credentials) => {
    const result = await signUpWithEmailPassword({
      email: credentials.email,
      password: credentials.password,
      fullName: credentials.fullName,
      role: credentials.role,
      studentId: credentials.studentId,
    });

    if (result.success) {
      return {
        success: true,
        message: result.message || 'Account created successfully.',
      };
    }

    return {
      success: false,
      message: result.message || 'Unable to create your account right now.',
    };
  };

  const requestPasswordReset = async (credentials) => {
    const result = await resetPasswordForEmail({ email: credentials.email });

    if (result.success) {
      return {
        success: true,
        message: result.message || 'Password reset link sent.',
      };
    }

    return {
      success: false,
      message: result.message || 'Unable to send a reset link right now.',
    };
  };

  const logout = async () => {
    await endSession('signed-out', state.authUser?.id || state.ownerId);
  };

  const continueSession = () => {
    const ownerId = state.authUser?.id;
    if (!ownerId) return;
    if (sessionTimeoutState?.reason === 'absolute') {
      absoluteWarningDismissedRef.current = true;
      setSessionTimeoutState(null);
      return;
    }
    const touched = touchSessionActivity({ ownerId, now: Date.now(), throttleMs: 0 });
    if (touched) {
      updateState((previous) => ({ ...previous, lastSessionActivityAt: touched.lastActivityAt }));
      setSessionTimeoutState(null);
    }
  };

  const saveAcademicProfile = async (profileValues) => {
    if (!profileValues?.degreeProgram) {
      updateState({ profileSkipped: true });
      setProfileOnboarding(null);
      setProfileSaveError('');
      return;
    }

    const program = activeAcademicPrograms.find((entry) => entry.value === profileValues.degreeProgram) || getAcademicProgram(profileValues.degreeProgram);
    if (!program) {
      setProfileSaveError('Choose a degree program from the list.');
      return;
    }

    setIsSavingProfile(true);
    setProfileSaveError('');
    const {
      studentNumber,
      householdIncome,
      qpi,
      hasActiveGovernmentGrant,
      yearStanding,
      applicantType,
      yearLevel,
      academicStanding,
      citizenship,
      isTransferee,
      hsStrand,
      hsAverage,
      programChoice2,
      programChoice3,
    } = profileValues;
    // An incoming first-year ranks a 2nd and 3rd program choice and a transferee
    // records the applicant status; both are eligibility attributes, so the local
    // draft and the server mirror agree.
    const eligibilityAttributes = { yearStanding, applicantType, yearLevel, academicStanding, citizenship, isTransferee, hsStrand, hsAverage, programChoice2, programChoice3 };
    // Incoming first-years have no college QPI or AdDU student number yet, so
    // store nulls instead of empty strings.
    const resolvedQpi = qpi === '' || qpi == null ? null : qpi;
    const resolvedStudentNumber = studentNumber || null;

    const result = await updateUserProfile(profileOnboarding.id, {
      degreeProgram: program.value,
      // `profiles.department` stores the SCHOOL, not the academic department: it is
      // the label the reviewer scope ladder and the identity line read.
      department: program.school,
      studentNumber: resolvedStudentNumber,
      householdIncome,
      qpi: resolvedQpi,
      hasActiveGovernmentGrant,
    });

    if (!result.success) {
      setProfileSaveError(result.message || 'Unable to save your academic profile.');
      setIsSavingProfile(false);
      return;
    }

    // The onboarding essentials also feed the Smart Eligibility Checker, so mirror
    // them into eligibility_attributes the way My Profile does. A project with the
    // details migration pending simply keeps them on this device.
    await updateProfileFields(profileOnboarding.id, {
      eligibilityAttributes: { ...pickEligibilityAttributes(studentMatchProfile), ...eligibilityAttributes },
    });

    updateState((previous) => ({
      authUser: { ...previous.authUser, department: program.school, degreeProgram: program.value, studentNumber: resolvedStudentNumber, householdIncome, qpi: resolvedQpi, hasActiveGovernmentGrant },
      profileDraft: { ...previous.profileDraft, degreeProgram: program.value, householdIncome, qpi: resolvedQpi, hasActiveGovernmentGrant, ...eligibilityAttributes },
      profileSkipped: false,
    }));
    setProfileOnboarding(null);
    setIsSavingProfile(false);
  };

  // Starting an application creates a Draft and opens the application
  // workspace on it. An AdDU internal entry asks for its required documents
  // (src/lib/applicationRequirements.js) and pre-attaches matching vault files the
  // student already uploaded; an external or government-linked entry is tracked
  // only, because the student applies through the provider.
  const applyToScholarship = async (scholarship, qualificationProfile = studentMatchProfile) => {
    // Only the three in-scope AdDU tracks can be applied to; any other internal
    // catalog entry is tracked only, exactly like an external program.
    const isInternal = isAdduInternalProgram(scholarship);
    if (isInternal) {
      // Profile first: the "Needed to apply" answers must be complete before an
      // application exists, because they decide the required documents and are
      // frozen into the submission. The database repeats this on insert.
      const profileGate = getApplicationProfileGate(qualificationProfile);
      if (!profileGate.allowed) return { ...profileGate, profileItems: profileGate.missing };
      const gateResult = evaluateApplicationGate(qualificationProfile, scholarship);
      if (!gateResult.allowed) return gateResult;
    }

    const existing = state.applications.find((entry) => entry.scholarshipId === scholarship.id && entry.studentId === currentProfile.id);
    if (existing) {
      navigate('applications', { applicationId: existing.status === 'Draft' && isInternal ? existing.id : null });
      return { allowed: false, reasons: ['You already have an application for this scholarship.'] };
    }
    if (!isSupabaseWorkspaceLoaded) return { allowed: false, reasons: ['Supabase is not configured, so the application could not be created.'] };

    const requirements = getScholarshipRequirements(scholarship, qualificationProfile);
    const attachedDocuments = isInternal ? pickDefaultAttachments(requirements, studentDocuments, { profile: qualificationProfile }) : [];
    const nextApplication = {
      id: crypto.randomUUID(),
      studentId: currentProfile.id,
      scholarshipId: scholarship.id,
      scholarshipTitle: scholarship.title,
      status: 'Draft',
      documentStatus: 'Pending',
      submittedAt: null,
      updatedAt: new Date().toISOString().slice(0, 10),
      attachedDocuments,
      notes: isInternal
        ? 'Created from the scholarship explorer.'
        : 'Tracked from the scholarship explorer. Apply through the provider.',
      // The default statement/essay from My Profile is the starting statement.
      statement: isInternal ? String(state.profileDraft?.essay || '') : '',
      profileSnapshot: null,
      certifiedAt: null,
      timeline: [],
    };

    const result = await createSupabaseApplication({
      id: nextApplication.id,
      studentId: currentProfile.id,
      scholarshipId: scholarship.id,
      documentStatus: nextApplication.documentStatus,
      attachedDocuments,
      notes: nextApplication.notes,
      statement: nextApplication.statement,
    });
    if (result.error && !result.data) {
      return { allowed: false, reasons: [result.error.message || 'The application could not be created.'] };
    }
    // The row exists but a document link failed; keep the draft and let the
    // student attach the files again from the workspace.
    if (result.error) nextApplication.attachedDocuments = [];

    setState((previous) => ({
      ...previous,
      applications: [nextApplication, ...previous.applications],
      notifications: prependInAppNotification(previous, {
        id: `not-${crypto.randomUUID()}`,
        title: isInternal ? `${scholarship.title} application started` : `${scholarship.title} added to your tracker`,
        channel: 'In-app',
        body: isInternal
          ? `Attach the ${requirements.length} required documents from your Document Vault, then review and submit your application.`
          : 'This program is tracked only. Apply through the provider and keep its deadline on your calendar.',
        status: 'Unread',
        createdAt: new Date().toISOString().slice(0, 10),
      }),
    }));
    navigate('applications', { applicationId: isInternal ? nextApplication.id : null });
    return { allowed: true, reasons: [] };
  };

  const findOwnDraft = (applicationId) => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application || application.studentId !== currentProfile.id || application.status !== 'Draft') return null;
    return application;
  };

  // `touch: false` keeps `updatedAt` faithful when the server row is not being
  // written (a rejected-file replacement swaps only the link, 20261021000000).
  const setApplicationAttachments = (applicationId, update, { touch = true } = {}) => setState((previous) => ({
    ...previous,
    applications: previous.applications.map((entry) => entry.id === applicationId ? {
      ...entry,
      attachedDocuments: update(entry.attachedDocuments || []),
      ...(touch ? { updatedAt: new Date().toISOString().slice(0, 10) } : {}),
    } : entry),
  }));

  // Attaching links an existing vault file; the same file can back several
  // applications (Document Vault reuse). Links are Draft-only on the server.
  const attachDocumentToApplication = async (applicationId, documentId) => {
    const application = findOwnDraft(applicationId);
    if (!application || !studentDocuments.some((doc) => doc.id === documentId)) return { error: 'This document cannot be attached.' };
    if ((application.attachedDocuments || []).includes(documentId)) return { ok: true };
    const result = await attachSupabaseApplicationDocument(applicationId, documentId);
    if (result.error) return { error: result.error.message || 'The document could not be attached.' };
    setApplicationAttachments(applicationId, (ids) => (ids.includes(documentId) ? ids : [...ids, documentId]));
    return { ok: true };
  };

  const detachDocumentFromApplication = async (applicationId, documentId) => {
    if (!findOwnDraft(applicationId)) return { error: 'Only a draft application can change its documents.' };
    const result = await detachSupabaseApplicationDocument(applicationId, documentId);
    if (result.error) return { error: result.error.message || 'The document could not be removed.' };
    setApplicationAttachments(applicationId, (ids) => ids.filter((id) => id !== documentId));
    return { ok: true };
  };

  // Uploading from the application workspace still lands the file in the
  // Document Vault first, so it stays reusable for later applications.
  const uploadAndAttachDocument = async (applicationId, { file, documentType }) => {
    if (!findOwnDraft(applicationId)) return { error: 'Only a draft application can change its documents.' };
    const upload = await uploadVaultDocument({ file, documentType });
    if (upload.error) return upload;
    const result = await attachSupabaseApplicationDocument(applicationId, upload.document.id);
    if (result.error) return { error: `${upload.document.title} was saved to your Document Vault but could not be attached. Choose it from the vault to try again.` };
    setApplicationAttachments(applicationId, (ids) => [...ids, upload.document.id]);
    return { ok: true };
  };

  // The per-application "Financial situation" answers are office-only and live in
  // application_financial_details, not on the application row.
  const persistFinancialAnswers = async (applicationId, rawAnswers) => {
    const answers = normalizeFinancialAnswers(rawAnswers || {});
    const result = await saveSupabaseFinancialAnswers({ applicationId, studentId: state.authUser?.id || currentProfile.id, answers });
    if (!result.success) {
      return {
        error: result.missing
          ? 'The financial situation answers need the latest database migration (20261036000000).'
          : (result.error?.message || 'The financial situation answers could not be saved.'),
      };
    }
    setFinancial((previous) => ({ ...previous, answersByApplication: { ...previous.answersByApplication, [applicationId]: result.answers } }));
    return { ok: true, answers: result.answers };
  };

  const saveApplicationDraft = async (applicationId, { statement, financialAnswers }) => {
    if (!findOwnDraft(applicationId)) return { error: 'Only a draft application can be edited.' };
    if (financialAnswers) {
      const saved = await persistFinancialAnswers(applicationId, financialAnswers);
      if (saved.error) return saved;
    }
    const result = await updateSupabaseApplicationDraft(applicationId, { statement });
    if (result.error) return { error: result.error.message || 'The draft could not be saved.' };
    setState((previous) => ({
      ...previous,
      applications: previous.applications.map((entry) => entry.id === applicationId ? { ...entry, statement, updatedAt: new Date().toISOString().slice(0, 10) } : entry),
    }));
    return { ok: true };
  };

  // Submission is gated on the same readiness check the workspace shows, then
  // persisted together with the frozen profile snapshot and certification. The
  // server repeats the gate (enforce_student_application_update), so the local
  // row changes only after the write succeeds.
  const submitApplication = async (applicationId, { statement, certified, financialAnswers } = {}) => {
    const draft = findOwnDraft(applicationId);
    if (!draft) return { error: 'Only a draft application can be submitted.' };
    const application = { ...draft, statement: statement ?? draft.statement };
    const scholarship = scholarshipCatalog.find((entry) => entry.id === application.scholarshipId);
    const answers = normalizeFinancialAnswers(financialAnswers ?? financial.answersByApplication[applicationId] ?? {});
    const readiness = getApplicationReadiness({ application, scholarship, documents: studentDocuments, profile: studentMatchProfile, financialAnswers: answers, certified });
    if (readiness.route !== 'internal') return { error: 'This program is tracked only. Apply through the provider.' };
    if (!readiness.ready) return { error: readiness.blockers[0], blockers: readiness.blockers };
    // The database requires the answers on file before it accepts the submission.
    const savedAnswers = await persistFinancialAnswers(applicationId, answers);
    if (savedAnswers.error) return savedAnswers;

    const submittedAt = new Date().toISOString();
    const supportingCount = readiness.supportingDocuments.length;
    const submitEvent = {
      id: `ev-${crypto.randomUUID()}`,
      stage: 'Submitted',
      note: `Student certified and submitted the application with ${readiness.attachedCount} of ${readiness.requiredCount} required documents attached${supportingCount ? ` and ${supportingCount} supporting ${supportingCount === 1 ? 'document' : 'documents'}` : ''}.`,
      actor: 'Student',
      at: submittedAt.slice(0, 10),
    };
    // The badges come from the files this application attaches, so a Verified
    // badge always rests on a file the reviewers receive.
    const profileSnapshot = buildProfileSnapshot(
      studentMatchProfile,
      getApplicationAttributeVerifications(application, studentDocuments, studentMatchProfile),
      submittedAt,
    );
    const timeline = [...(application.timeline || []), submitEvent];
    const result = await submitSupabaseApplication(applicationId, {
      timeline,
      statement: application.statement,
      profileSnapshot,
      certifiedAt: submittedAt,
    });
    if (result?.error) return { error: result.error.message || 'The application could not be submitted.' };
    // The database trigger is the primary sender; this browser call is a retry
    // that covers a tab closing between the status write and the trigger. It
    // sends only the idempotent channels — the trigger owns SMS (see
    // supabase/functions/notify-application-status/index.ts).
    notifySupabaseApplicationStatus(applicationId).catch(() => undefined);

    setState((previous) => ({
      ...previous,
      applications: previous.applications.map((entry) => entry.id === applicationId ? {
        ...entry,
        status: 'Submitted',
        statement: application.statement,
        profileSnapshot,
        certifiedAt: submittedAt,
        submittedAt: entry.submittedAt ?? submittedAt.slice(0, 10),
        updatedAt: submittedAt.slice(0, 10),
        timeline,
      } : entry),
    }));
    return { ok: true };
  };

  // Every reviewer stage transition goes through this one function. It awaits
  // the Supabase write before touching local state so a failed write can never
  // leave the queue showing a stage the database never recorded, and it returns
  // { ok } / { error } so the review surface can report the outcome.
  // `options.baseApplication` lets a caller that already wrote a stage payload
  // (the interview waiver cancels the schedule first) thread the fresh row in, so
  // this write does not overwrite the timeline with a stale copy.
  const changeApplicationStatus = async (applicationId, status, options = {}) => {
    const application = options.baseApplication
      || state.applications.find((entry) => entry.id === applicationId);
    if (!application) return { error: 'The application could not be found.' };
    // Manuscript 3.3.3: forward stages require every attached Document Vault
    // file to be Verified. The reviewer UI disables these actions and the
    // database trigger repeats the rule, so this guard only stops a stale
    // client from optimistically advancing an application it should not.
    if (ENDORSEMENT_BLOCKED_STATUSES.includes(status)
      && !isApplicationVerifiedForEndorsement(application, state.documents)) {
      return { error: 'Every attached document must be Verified before this stage.' };
    }
    // Stage authority lives once in getNextApplicationStatuses
    // (src/lib/constants.js), so this guard and the role maps cannot drift apart.
    if (state.viewerRole !== 'student') {
      const allowedStatuses = getNextApplicationStatuses(application.status, state.viewerRole, stageContextFor(application));
      if (!allowedStatuses.includes(status)) {
        return { error: 'Your role cannot move this application to that stage.' };
      }
    }
    const actor = roleLabels[state.viewerRole] || 'Admissions Office';
    const defaultNote = status === 'For Verification'
      ? 'Continued to document verification. Attached files are queued for Admissions Office review.'
      : status === 'Endorsed'
        ? "Documents verified. Forwarded to the interviewers of the applicant's school."
        : status === 'Under Review'
          ? `${actor} opened this application for review. Attached documents are reviewed at the verification stage.`
          : status === 'Approved'
            ? `Recommendation approved by the ${actor}.`
            : `Application moved to ${status}.`;
    const stageEvent = {
      id: `ev-${crypto.randomUUID()}`,
      stage: status,
      note: options?.note || defaultNote,
      actor,
      at: new Date().toISOString().slice(0, 10),
    };
    const { note: _note, baseApplication: _baseApplication, ...stageFields } = options || {};
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the stage change could not be saved.' };
    }
    const result = await updateSupabaseApplicationStatus(
      applicationId,
      status,
      [...(application.timeline || []), stageEvent],
      stageFields,
    );
    if (result?.error) {
      return {
        error: result.error.message
          || 'The application status could not be saved. Confirm Supabase is configured and apply pending migrations.',
      };
    }
    setState((previous) => ({
      ...previous,
      applications: previous.applications.map((entry) => entry.id === applicationId ? {
        ...entry,
        status,
        updatedAt: new Date().toISOString().slice(0, 10),
        ...stageFields,
        timeline: [...(entry.timeline || []), stageEvent],
      } : entry),
    }));
    // A rejection ends the interview. Delete the Google Calendar event so the
    // applicant and the panel stop receiving a live invitation (and its Meet
    // link) for a closed case. The ledger in interview_calendar_events keeps the
    // event id if this call fails, so it can still be repaired.
    if (status === 'Rejected'
      && application.status === 'Interview'
      && application.interview?.calendar?.eventId
      && (isAdmissionsHeadRole(state.viewerRole) || isReviewerRole(state.viewerRole))) {
      invokeSupabaseInterviewEvent({
        action: 'cancel',
        applicationId,
        eventId: application.interview.calendar.eventId,
      }).catch(() => undefined);
    }
    // The database trigger (20261014000003) is the primary sender; this is the
    // retry for a tab that closed first and only sends the idempotent in-app and
    // email channels. The trigger owns the SMS channel.
    notifySupabaseApplicationStatus(applicationId).catch(() => undefined);
    return { ok: true };
  };

  // An application rejection is recorded in two places on purpose. FORM 230-SCH
  // affidavit clause 6 keeps the deliberations and their minutes confidential, so
  // the reason a reviewer types is filed in the staff-only internal notes
  // (application_review_comments, which has no student policy), and the student
  // receives the fixed APPLICATION_REJECTION_NOTICE through the timeline — and
  // therefore through application_status_log.reason, which the trigger derives
  // from it. The note is written first: a rejection must never land without a
  // recorded reason, and a failed note leaves the stage untouched.
  const rejectApplication = async (applicationId, reason = '') => {
    if (state.viewerRole === 'student') {
      return { error: 'Only a reviewer can reject an application.' };
    }
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application) return { error: 'The application could not be found.' };
    if (!getNextApplicationStatuses(application.status, state.viewerRole, stageContextFor(application)).includes('Rejected')) {
      return { error: 'Your role cannot reject this application at this stage.' };
    }
    const trimmed = String(reason || '').trim();
    if (!trimmed) return { error: 'Record the reason for the rejection.' };
    const maxReasonLength = 2000 - APPLICATION_REJECTION_REASON_PREFIX.length;
    if (trimmed.length > maxReasonLength) {
      return { error: `Keep the reason to ${maxReasonLength.toLocaleString()} characters or fewer.` };
    }
    const note = await addReviewComment(applicationId, `${APPLICATION_REJECTION_REASON_PREFIX}${trimmed}`);
    if (note?.error) return { error: note.error };
    return changeApplicationStatus(applicationId, 'Rejected', { note: APPLICATION_REJECTION_NOTICE });
  };

  // Case officers. Opening an Admissions Office application joins the officer to
  // the case (application_case_officers): the roster is how the shared intake pool
  // knows what has been picked up, and a second officer joining the same case is
  // expected, not a conflict. Joining is the one place the review starts
  // (Submitted -> Under Review), so the student notification fires from here.
  const joinCaseReview = async (applicationId) => {
    // Staff keep a read-only view: opening a case records nothing and starts no
    // review. The Head opens a case into review.
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      return { ok: true, joined: false };
    }
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application) return { error: 'The application could not be found.' };
    if (!CASE_OFFICER_JOINABLE_STATUSES.includes(application.status)) return { ok: true, joined: false };
    if (isCaseOfficer(state.caseOfficers, applicationId, currentProfile.id)) return { ok: true, joined: false };
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the case officer could not be recorded.' };
    }
    const result = await joinSupabaseApplicationReview(applicationId);
    if (result?.error) {
      return {
        error: result.error.message
          || 'The case officer could not be recorded. Apply the pending migration and try again.',
      };
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    const status = row?.status || application.status;
    const now = new Date().toISOString();
    const joinedOfficer = {
      id: `co-${crypto.randomUUID()}`,
      applicationId,
      officerId: currentProfile.id,
      officerName: currentProfile.fullName || 'Admissions Office reviewer',
      officerRole: state.viewerRole,
      joinedAt: now,
      leftAt: null,
      leftReason: '',
    };
    setState((previous) => ({
      ...previous,
      applications: previous.applications.map((entry) => (entry.id === applicationId ? {
        ...entry,
        status,
        updatedAt: status === entry.status ? entry.updatedAt : now.slice(0, 10),
        timeline: Array.isArray(row?.timeline) ? row.timeline : entry.timeline,
      } : entry)),
      caseOfficers: isCaseOfficer(previous.caseOfficers, applicationId, currentProfile.id)
        ? previous.caseOfficers
        : [...previous.caseOfficers, joinedOfficer],
    }));
    // The database trigger is the primary sender; this browser call is the retry
    // for a tab that closed between the status write and the trigger.
    if (status !== application.status) notifySupabaseApplicationStatus(applicationId).catch(() => undefined);
    // Reconcile with the server so an officer who joined the same case shows up in
    // the roster here too.
    loadSupabaseApplicationCaseOfficers().then((refreshed) => {
      if (!refreshed) return;
      setState((previous) => ({
        ...previous,
        caseOfficers: refreshed.error ? previous.caseOfficers : (refreshed.caseOfficers || []),
        caseOfficersReady: !refreshed.error,
      }));
    }).catch(() => undefined);
    return { ok: true, joined: true, status };
  };

  // Leaving a case is self-service: the officer records why, and the application
  // keeps its status (a reverse move to Submitted is not in the SOP map). If the
  // last officer leaves, the case returns to the intake pool's unclaimed view.
  const leaveCaseReview = async (applicationId, reason) => {
    if (!isAdmissionsReviewerRole(state.viewerRole)) {
      return { error: 'Only the Admissions Office can leave a case.' };
    }
    const trimmed = String(reason || '').trim();
    if (!trimmed) return { error: 'A reason is required before leaving a case.' };
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so leaving the case could not be saved.' };
    }
    const result = await leaveSupabaseApplicationReview(applicationId, trimmed);
    if (result?.error) {
      return {
        error: result.error.message
          || 'The case could not be left. Apply the pending migration and try again.',
      };
    }
    const leftAt = new Date().toISOString();
    setState((previous) => ({
      ...previous,
      caseOfficers: previous.caseOfficers.map((entry) => (
        entry.applicationId === applicationId && entry.officerId === currentProfile.id && !entry.leftAt
          ? { ...entry, leftAt, leftReason: trimmed }
          : entry
      )),
    }));
    return { ok: true };
  };


  // The Head forwards a verified case to the interviewers of the applicant's
  // school (the former SOP step-4 endorsement, now part of verification). A legacy
  // row still waiting at For Endorsement leaves that stage the same way.
  const endorseApplication = async (applicationId, note = '') => {
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      return { error: 'Only the Admissions Office Head can forward an application to interview.' };
    }
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application || !['For Verification', 'For Endorsement'].includes(application.status)) {
      return { error: 'This application is not awaiting the forward to interview.' };
    }
    // Manuscript 3.3.3: never record an endorsement for an application whose
    // attached documents are not all Verified. The status write refuses that
    // change too, so checking first keeps the client from a stale attempt.
    if (!isApplicationVerifiedForEndorsement(application, state.documents)) {
      return { error: 'Every attached document must be Verified before endorsement.' };
    }
    const record = {
      reviewedBy: currentProfile.fullName || 'Admissions Office Head',
      decision: 'Endorsed',
      note: note || "Documents verified. Forwarded to the interviewers of the applicant's school.",
      decidedAt: new Date().toISOString().slice(0, 10),
    };
    return changeApplicationStatus(applicationId, 'Endorsed', {
      note: record.note,
      endorsement: record,
    });
  };
  // The internal endorsement thread. The database RLS policies are the authority;
  // this guard keeps a student session (or a Chair outside its department) from
  // attempting a write the server would reject anyway.
  const addReviewComment = async (applicationId, body) => {
    if (state.viewerRole === 'student') {
      return { error: 'Only reviewers can add an internal note.' };
    }
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application) return { error: 'The application could not be found.' };
    if (isReviewerRole(state.viewerRole)
      && !getScopedQueue([application], { ...currentProfile, role: state.viewerRole }, activeAcademicPrograms).length) {
      return { error: 'Your review scope does not include this application.' };
    }
    const trimmed = String(body || '').trim();
    if (!trimmed) return { error: 'Write a note before adding it to the case file.' };
    if (trimmed.length > 2000) return { error: 'Keep the note to 2,000 characters or fewer.' };
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the note could not be saved.' };
    }
    const result = await createSupabaseReviewComment({
      applicationId,
      authorId: currentProfile.id,
      authorRole: state.viewerRole,
      authorName: currentProfile.fullName || 'Reviewer',
      body: trimmed,
    });
    if (result?.error) {
      return { error: result.error.message || 'The note could not be saved. Confirm the review-comment migration is applied.' };
    }
    if (result.data) {
      setState((previous) => ({
        ...previous,
        reviewComments: [...(previous.reviewComments || []), result.data],
      }));
    }
    return { ok: true };
  };

  // SOP step 5 — Interview of applicants. The Admissions Office (Staff and
  // Head) coordinates the interview: mode, location, time, meeting link,
  // reschedules, and the Endorsed → Interview → Recommended moves. SOP 5a draws
  // the panel from the school where the applicant's program belongs, so the
  // panel is the applicant's Department Chair(s) plus typed faculty guests, and a
  // Chair on the panel records the outcome and the private evaluation notes.
  // The database repeats every rule (20261029000000_overhaul_interview_stage.sql).
  const staffNameById = Object.fromEntries((state.staffDirectory || []).map((entry) => [entry.userId, entry.fullName]));
  const isPanelistOn = (applicationId) => (state.interviewPanelists || []).some((row) => (
    row.applicationId === applicationId && !row.removedAt && row.profileId && row.profileId === currentProfile.id
  ));
  // Consultation 2: an interviewer schedules its own interviews, and a ladder
  // account in scope may run the interview itself in a small program. The Head
  // keeps the office override; Staff only read.
  const reviewerProfile = { ...currentProfile, role: state.viewerRole };
  const isInViewerScope = (application) => (
    isReviewerRole(state.viewerRole)
    && getScopedQueue([application], reviewerProfile, activeAcademicPrograms).length > 0
  );
  const canCoordinateInterview = (application) => Boolean(application)
    && (isAdmissionsHeadRole(state.viewerRole) || isInViewerScope(application));
  // The case facts a scoped reviewer's stage moves depend on (constants.js
  // getNextApplicationStatuses): only a panel member recommends, and only the
  // level configured for the applicant's school approves.
  const programScopeIndex = buildProgramScopeIndex(activeAcademicPrograms);
  const stageContextFor = (application) => ({
    isPanelist: Boolean(application) && isPanelistOn(application.id),
    isApprover: Boolean(application)
      && isApproverForApplication(application, reviewerProfile, state.approvalLevels || [], programScopeIndex),
  });
  const activeLocationIds = (state.interviewLocations || []).filter((entry) => entry.isActive).map((entry) => entry.id);

  // Saves the panel first, so the calendar invitation and the database-triggered
  // panel notification both read the new members, then creates or updates the
  // Google Calendar event when the integration is configured.
  const prepareInterviewSchedule = async (application, draft, { previous = null, reason = '' } = {}) => {
    const wantsAutoMeeting = interviewCalendar.configured && draft.mode === 'online' && !String(draft.meetingUrl || '').trim();
    const errors = validateInterviewSchedule(draft, { autoMeeting: wantsAutoMeeting, activeLocationIds });
    if (Object.keys(errors).length) {
      return { error: Object.values(errors)[0], errors };
    }
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the interview could not be saved.' };
    }
    const panelResult = await replaceSupabaseInterviewPanel(application.id, draft.panel, staffNameById);
    if (panelResult.error) {
      return { error: panelResult.error.message || 'The interview panel could not be saved. Confirm the interview migration is applied.' };
    }
    setState((current) => ({
      ...current,
      interviewPanelists: [
        ...(current.interviewPanelists || []).filter((row) => row.applicationId !== application.id),
        ...(panelResult.data || []),
      ],
    }));

    const location = (state.interviewLocations || []).find((entry) => entry.id === draft.locationId) || null;
    let record = buildInterviewRecord({
      draft,
      previous,
      location,
      school: application.studentSchool || '',
      actorId: currentProfile.id,
      reason,
    });
    let createdEventId = null;
    if (interviewCalendar.configured) {
      const existingEventId = isStructuredInterview(previous) ? previous.calendar?.eventId : null;
      const eventResult = await invokeSupabaseInterviewEvent({
        action: existingEventId ? 'update' : 'create',
        applicationId: application.id,
        eventId: existingEventId || undefined,
        schedule: {
          mode: record.mode,
          startsAt: record.startsAt,
          durationMinutes: record.durationMinutes,
          locationLabel: record.locationLabel,
          meetingUrl: record.meetingUrl,
          instructions: record.instructions,
        },
      });
      if (eventResult?.configured && eventResult?.eventId) {
        createdEventId = existingEventId ? null : eventResult.eventId;
        record = {
          ...record,
          meetingUrl: record.mode === 'online' ? (record.meetingUrl || eventResult.meetingUrl || '') : '',
          calendar: {
            provider: 'google',
            eventId: eventResult.eventId,
            htmlLink: eventResult.htmlLink || '',
            removedAt: null,
          },
        };
      } else if (wantsAutoMeeting) {
        return { error: `The Google Meet link could not be generated (${eventResult?.reason || eventResult?.error || 'calendar service unavailable'}). Paste a meeting link instead.` };
      }
    }
    return { record, createdEventId };
  };

  const writeInterviewRecord = async (application, record, note) => {
    const stageEvent = {
      id: `ev-${crypto.randomUUID()}`,
      stage: 'Interview',
      note,
      actor: roleLabels[state.viewerRole] || 'Admissions Office',
      at: new Date().toISOString().slice(0, 10),
    };
    const timeline = [...(application.timeline || []), stageEvent];
    const result = await updateSupabaseApplicationStage(application.id, 'Interview', { interview: record, timeline });
    if (result?.error) {
      return { error: result.error.message || 'The interview could not be saved.' };
    }
    setState((previous) => ({
      ...previous,
      applications: previous.applications.map((entry) => (entry.id === application.id
        ? { ...entry, interview: record, timeline, updatedAt: new Date().toISOString().slice(0, 10) }
        : entry)),
    }));
    // The database trigger (20261029000001) is the primary sender; this is the
    // idempotent retry for the in-app and email channels.
    notifySupabaseInterviewUpdate(application.id).catch(() => undefined);
    // The written row is returned so a caller that follows with a stage change can
    // carry this timeline forward instead of rewriting the pre-cancel copy.
    return { ok: true, record, timeline, application: { ...application, interview: record, timeline } };
  };

  const scheduleInterview = async (applicationId, draft) => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!canCoordinateInterview(application)) {
      return { error: 'Only an interviewer whose scope covers this applicant, or the Admissions Office Head, can schedule this interview.' };
    }
    if (!application || application.status !== 'Endorsed') {
      return { error: 'This application is not awaiting an interview.' };
    }
    // The reviewer who schedules the interview sits on its panel, so they can
    // record the recommendation afterwards. They lead it unless a lead is named.
    const panel = Array.isArray(draft?.panel) ? draft.panel : [];
    const scheduledDraft = isReviewerRole(state.viewerRole) && !panel.some((member) => member.profileId === currentProfile.id)
      ? { ...draft, panel: [{ profileId: currentProfile.id, guestName: '', guestEmail: '', isLead: !panel.some((member) => member.isLead) }, ...panel] }
      : draft;
    const prepared = await prepareInterviewSchedule(application, scheduledDraft);
    if (prepared.error) return prepared;
    const result = await changeApplicationStatus(applicationId, 'Interview', {
      note: `Interview scheduled: ${summarizeInterview(prepared.record)}.`,
      interview: prepared.record,
    });
    if (result?.error) {
      if (prepared.createdEventId) {
        invokeSupabaseInterviewEvent({ action: 'cancel', applicationId, eventId: prepared.createdEventId }).catch(() => undefined);
      }
      return result;
    }
    notifySupabaseInterviewUpdate(applicationId).catch(() => undefined);
    return { ok: true };
  };

  const rescheduleInterview = async (applicationId, draft, reason = '') => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!canCoordinateInterview(application)) {
      return { error: 'Only an interviewer whose scope covers this applicant, or the Admissions Office Head, can reschedule this interview.' };
    }
    if (!application || application.status !== 'Interview' || !isStructuredInterview(application.interview)) {
      return { error: 'This interview cannot be rescheduled.' };
    }
    if (application.interview.state === 'completed') {
      return { error: 'The panel has already recorded this interview as attended.' };
    }
    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) return { error: 'Record why the interview is being rescheduled.' };
    const prepared = await prepareInterviewSchedule(application, draft, { previous: application.interview, reason: trimmedReason });
    if (prepared.error) return prepared;
    return writeInterviewRecord(application, prepared.record, `Interview rescheduled (${trimmedReason}): ${summarizeInterview(prepared.record)}.`);
  };

  // Removes the provider event and records the cancellation. Deleting first means
  // the Edge Function still sees the id it has to remove, and a failed delete
  // leaves `calendar.removedAt` null so the tab can offer a repair — instead of
  // silently orphaning an event that keeps its invitation and Meet link while the
  // next schedule creates a second one. Shared by the explicit Cancel action and
  // the interview waiver that precedes a recommendation; `note` lets the waiver
  // record its own timeline wording.
  const cancelInterviewRecord = async (application, reason, note = '') => {
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the interview could not be saved.' };
    }
    const calendar = application.interview?.calendar || null;
    const eventId = String(calendar?.eventId || '').trim();
    let removedAt = null;
    let removalError = '';
    if (eventId) {
      const removal = await invokeSupabaseInterviewEvent({
        action: 'cancel',
        applicationId: application.id,
        eventId,
      }).catch(() => null);
      if (removal?.ok) removedAt = new Date().toISOString();
      else removalError = removal?.reason || removal?.error || 'The Google Calendar event could not be removed.';
    }
    const record = {
      ...buildCancelledInterview({ previous: application.interview, actorId: currentProfile.id, reason }),
      calendar: eventId
        ? { provider: calendar?.provider || 'google', eventId, htmlLink: calendar?.htmlLink || '', removedAt }
        : null,
    };
    const result = await writeInterviewRecord(application, record, note || `Interview cancelled: ${reason}.`);
    if (result.error) return result;
    return {
      ...result,
      warning: eventId && !removedAt ? `${removalError} Use Repair calendar event to remove it.` : '',
    };
  };

  const cancelInterview = async (applicationId, reason = '') => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!canCoordinateInterview(application)) {
      return { error: 'Only an interviewer whose scope covers this applicant, or the Admissions Office Head, can cancel this interview.' };
    }
    if (!application || application.status !== 'Interview' || !isStructuredInterview(application.interview)
      || !['scheduled', 'no_show'].includes(application.interview.state)) {
      return { error: 'This interview cannot be cancelled.' };
    }
    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) return { error: 'Record why the interview is being cancelled.' };
    const result = await cancelInterviewRecord(application, trimmedReason);
    if (result.error) return result;
    return result.warning ? { ok: true, warning: result.warning } : { ok: true };
  };

  // Repairs Google from the saved record: creates the event the database expects
  // when a create was lost, updates it when Google drifted, or deletes the event
  // of a cancelled interview whose delete never landed. The Edge Function never
  // writes the application row, so the repaired calendar link is saved here
  // through the normal stage write.
  const resyncInterviewCalendar = async (applicationId) => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!canCoordinateInterview(application)) {
      return { error: 'Only the interviewer of this applicant or the Admissions Office Head can repair a calendar event.' };
    }
    if (!application || !isStructuredInterview(application.interview)) {
      return { error: 'This application has no interview schedule to repair.' };
    }
    if (!interviewCalendar.configured) {
      return { error: interviewCalendar.reason || 'The Google Calendar integration is not available.' };
    }
    const result = await invokeSupabaseInterviewEvent({ action: 'sync', applicationId }).catch(() => null);
    if (!result?.ok) {
      return { error: result?.reason || 'The calendar event could not be repaired.' };
    }
    if (result.repaired === 'deleted' || result.calendar === null) {
      // A cancelled interview's event is gone: stamp the record so the tab stops
      // offering a repair for it.
      if (result.repaired === 'deleted' && application.interview.calendar) {
        const stamped = {
          ...application.interview,
          calendar: {
            ...application.interview.calendar,
            provider: 'google',
            removedAt: new Date().toISOString(),
          },
        };
        const written = await writeInterviewRecord(application, stamped, 'Calendar event removed after the interview was cancelled.');
        if (written.error) return written;
      }
      const removedCount = Number(result.removed) || 0;
      return {
        ok: true,
        message: result.repaired === 'deleted'
          ? `Removed ${removedCount || 1} calendar event${(removedCount || 1) === 1 ? '' : 's'} for the cancelled interview.`
          : 'Nothing needed repairing.',
      };
    }
    const record = {
      ...application.interview,
      meetingUrl: application.interview.mode === 'online'
        ? (application.interview.meetingUrl || result.meetingUrl || '')
        : '',
      calendar: { ...(result.calendar || {}), removedAt: null },
    };
    const written = await writeInterviewRecord(application, record, `Calendar event ${result.repaired}: ${summarizeInterview(record)}.`);
    if (written.error) return written;
    const swept = Number(result.removed) > 0
      ? ` Removed ${result.removed} duplicate event${Number(result.removed) === 1 ? '' : 's'}.`
      : '';
    const label = result.repaired === 'relinked' ? 'repaired with a new Meet link' : result.repaired;
    return { ok: true, message: `The calendar event was ${label}.${swept}` };
  };

  const addInterviewNote = async (applicationId, { body, recommendationLevel = null, rating = null } = {}) => {
    const allowed = isAdmissionsHeadRole(state.viewerRole)
      || (isReviewerRole(state.viewerRole) && isPanelistOn(applicationId));
    if (!allowed) return { error: 'Only the interview panel or the Admissions Office Head can add an evaluation note.' };
    const trimmed = String(body || '').trim();
    if (!trimmed) return { error: 'Write the evaluation note first.' };
    if (trimmed.length > 2000) return { error: 'Keep the note to 2,000 characters or fewer.' };
    // The level is the panel's recommendation (SOP step 6 input). A note may hold
    // observations only, so it is optional; an unknown value is refused rather
    // than written, and the database repeats the same list.
    const level = recommendationLevel ? String(recommendationLevel) : '';
    if (level && !INTERVIEW_RECOMMENDATION_LEVELS.some((entry) => entry.value === level)) {
      return { error: 'Choose one of the listed recommendation levels.' };
    }
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the note could not be saved.' };
    }
    const result = await createSupabaseInterviewNote({
      applicationId,
      authorId: currentProfile.id,
      authorRole: state.viewerRole,
      authorName: currentProfile.fullName || 'Reviewer',
      recommendationLevel: level || null,
      rating: rating ? Number(rating) : null,
      body: trimmed,
    });
    if (result.error) {
      return { error: result.error.message || 'The note could not be saved. Confirm the interview migration is applied.' };
    }
    if (result.data) {
      setState((previous) => ({ ...previous, interviewNotes: [...(previous.interviewNotes || []), result.data] }));
    }
    return { ok: true };
  };

  // Venues for on-site interviews are managed by the Admissions Office Head.
  const saveInterviewLocation = async (location) => {
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      return { error: 'Only the Admissions Office Head can manage interview locations.' };
    }
    if (!String(location?.name || '').trim()) return { error: 'Enter the location name.' };
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the location could not be saved.' };
    }
    const result = await saveSupabaseInterviewLocation(location);
    if (result.error || !result.data) {
      return { error: result.error?.message || 'The location could not be saved. Confirm the interview migration is applied.' };
    }
    setState((previous) => {
      const others = (previous.interviewLocations || []).filter((entry) => entry.id !== result.data.id);
      return {
        ...previous,
        interviewLocations: [...others, result.data].sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
    return { ok: true, location: result.data };
  };

  // One bundle of interview data and actions for the review surfaces.
  const interviewWorkspace = {
    viewerId: currentProfile.id,
    staffDirectory: state.staffDirectory || [],
    // The panel picker resolves the applicant's school, cluster, and department from
    // the program through this taxonomy (SOP 5a), so a reviewer at any level of the
    // ladder whose scope covers the applicant can be suggested.
    academicPrograms: activeAcademicPrograms,
    locations: state.interviewLocations || [],
    panelists: state.interviewPanelists || [],
    notes: state.interviewNotes || [],
    applications: state.applications,
    calendarConfigured: interviewCalendar.configured,
    calendarChecked: interviewCalendar.checked,
    calendarChecking: interviewCalendar.checking,
    calendarReauthRequired: interviewCalendar.reauthRequired,
    calendarReason: interviewCalendar.reason,
    calendarSummary: interviewCalendar.calendar?.summary || '',
    calendarAccessRole: interviewCalendar.calendar?.accessRole || '',
    onRepairCalendar: resyncInterviewCalendar,
    onSchedule: scheduleInterview,
    onReschedule: rescheduleInterview,
    onCancel: cancelInterview,
    onAddNote: addInterviewNote,
    onSaveLocation: isAdmissionsHeadRole(state.viewerRole) ? saveInterviewLocation : undefined,
    // Who may schedule this applicant's interview (an interviewer or ladder
    // account in scope, or the Head), and the case facts the action bar reads.
    canCoordinate: canCoordinateInterview,
    stageContextFor,
    approvalLevels: state.approvalLevels || [],
  };

  // SOP step 6 — evaluation and deliberation by the School Scholarship
  // Sub-committee, producing a recommendation.
  //
  // Attendance is not tracked, so the recommendation itself is what ends the
  // interview stage. A schedule that is still live is closed first: cancelling
  // keeps the application at `Interview`, so the interview trigger notifies the
  // applicant and the panel about the cancellation, and the status write that
  // follows then tells the applicant the recommendation was recorded. No live
  // invitation can outlive the stage, which is what the database trigger
  // (enforce_interview_closed_before_recommendation) still refuses.
  const recordDeliberation = async (applicationId, decision, note = '') => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application || application.status !== 'Interview') {
      return { error: 'This application is not awaiting a recommendation.' };
    }
    if (!getNextApplicationStatuses(application.status, state.viewerRole, stageContextFor(application)).includes('Recommended')) {
      return { error: 'Only a member of this interview panel, or the Admissions Office Head, can record the recommendation.' };
    }
    // An interviewer's recommendation carries one of the five recommendation
    // levels (Consultation 2, #7), recorded with an evaluation note first.
    const panelRecommendation = getLatestPanelRecommendation(
      (state.interviewNotes || []).filter((entry) => entry.applicationId === applicationId),
    );
    if (!isAdmissionsHeadRole(state.viewerRole) && !panelRecommendation) {
      return { error: 'Record a recommendation level with an evaluation note in the Interview tab first.' };
    }
    let base = application;
    let closeWarning = '';
    if (decision !== 'Rejected' && isInterviewLive(application.interview)) {
      const closed = await cancelInterviewRecord(
        application,
        'The recommendation was recorded, closing the interview stage.',
        'Interview schedule closed when the recommendation was recorded.',
      );
      if (closed.error) return closed;
      base = closed.application;
      closeWarning = closed.warning || '';
    }
    const nextStatus = decision === 'Approved' ? 'Approved' : decision === 'Rejected' ? 'Rejected' : 'Recommended';
    const actorLabel = roleLabels[state.viewerRole] || 'Reviewer';
    const record = {
      decidedBy: isAdmissionsHeadRole(state.viewerRole)
        ? 'School Scholarship Sub-committee'
        : `${currentProfile.fullName || actorLabel} (${actorLabel})`,
      decision: nextStatus === 'Recommended' ? 'Recommended' : nextStatus,
      recommendationLevel: panelRecommendation?.level || null,
      note,
      decidedAt: new Date().toISOString().slice(0, 10),
    };
    const result = await changeApplicationStatus(applicationId, nextStatus, {
      note: note || (panelRecommendation
        ? `Interview recommendation recorded: ${panelRecommendation.label}.`
        : `Recommendation recorded as ${nextStatus}.`),
      deliberation: record,
      baseApplication: base,
    });
    if (result?.error) return result;
    return closeWarning ? { ...result, warning: closeWarning } : result;
  };

  // SOP step 7 — the school's approving level (approval_levels: a Dean, an
  // Assistant Dean, or a Chairperson, defaulting to the Chairperson) approves the
  // interviewer's recommendation. The Head keeps an override.
  const approveApplication = (applicationId, note = '') => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application || application.status !== 'Recommended') {
      return Promise.resolve({ error: 'This application is not awaiting approval.' });
    }
    if (!getNextApplicationStatuses(application.status, state.viewerRole, stageContextFor(application)).includes('Approved')) {
      return Promise.resolve({ error: "Only the approving level for the applicant's school can approve this recommendation." });
    }
    const actorLabel = roleLabels[state.viewerRole] || 'reviewer';
    return changeApplicationStatus(applicationId, 'Approved', {
      note: note || `Recommendation approved by the ${actorLabel}.`,
    });
  };

  // SOP step 8 — the Head releases the approved result to the applicant.
  const releaseApplicationResults = (applicationId) => {
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      return Promise.resolve({ error: 'Only the Admissions Office Head can release results.' });
    }
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application || application.status !== 'Approved') {
      return Promise.resolve({ error: 'This application is not awaiting release.' });
    }
    const record = {
      releasedTo: 'Admissions Office',
      releasedAt: new Date().toISOString().slice(0, 10),
      reference: `OAA-${applicationId.slice(0, 8).toUpperCase()}`,
    };
    // Routed through changeApplicationStatus so the release honours the same
    // document-verification guard, timeline, and persistence path as every other
    // stage — instead of writing status, stage payload, and local state directly.
    return changeApplicationStatus(applicationId, 'Released', {
      note: `Result released to the applicant through the Admissions Office (${record.reference}).`,
      release: record,
    });
  };

  // Results reach every applicant of a scholarship at the same time (Consultation
  // 2, #8 and #13). After the Head's final check, the remaining approved cases
  // are released one by one (each Released notice goes out as usual), then the
  // release is recorded with the number of applicants and the number accepted.
  // Recording it unmasks the held Rejected results and sends their general
  // letter: the results_releases insert trigger is the primary sender and this
  // browser call the retry.
  const releaseScholarshipResults = async (scholarshipId) => {
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      return { error: 'Only the Admissions Office Head can release results.' };
    }
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the results could not be released.' };
    }
    const approved = state.applications.filter((entry) => entry.scholarshipId === scholarshipId && entry.status === 'Approved');
    for (const entry of approved) {
      const result = await releaseApplicationResults(entry.id);
      if (result?.error) return { error: `${entry.studentName || 'An applicant'}: ${result.error}` };
    }
    const recorded = await recordSupabaseResultsRelease(scholarshipId);
    if (recorded.error || !recorded.data) {
      return { error: recorded.error?.message || 'The results release could not be recorded. Confirm the release migration is applied.' };
    }
    setState((previous) => ({
      ...previous,
      resultsReleases: [...(previous.resultsReleases || []), recorded.data],
    }));
    notifySupabaseResultsRelease(recorded.data.id).catch(() => undefined);
    return { ok: true, release: recorded.data };
  };

  // SOP step 7 routing: which ladder level approves for a school or cluster.
  // Managed by the Head; an unset scope defaults to the Chairperson.
  const saveApprovalLevel = async (level) => {
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      return { error: 'Only the Admissions Office Head can change the approving levels.' };
    }
    const school = String(level?.school || '').trim();
    const cluster = String(level?.cluster || '').trim();
    if (!school) return { error: 'Choose the school.' };
    if (!['dean', 'assistant_dean', 'department_chair'].includes(level?.approverRole)) {
      return { error: 'Choose who approves: the Dean, the Assistant Dean, or the Chairperson.' };
    }
    if (level.approverRole === 'assistant_dean' && !cluster) {
      return { error: 'An Assistant Dean owns a cluster, so choose the cluster too.' };
    }
    const duplicate = (state.approvalLevels || []).find((entry) => (
      entry.id !== level.id && entry.school === school && (entry.cluster || '') === cluster
    ));
    if (duplicate) return { error: 'That school or cluster already has an approving level. Edit it instead.' };
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the approving level could not be saved.' };
    }
    const result = await saveSupabaseApprovalLevel({ id: level.id, school, cluster, approverRole: level.approverRole });
    if (result.error || !result.data) {
      return { error: result.error?.message || 'The approving level could not be saved. Confirm the routing migration is applied.' };
    }
    setState((previous) => ({
      ...previous,
      approvalLevels: [
        ...(previous.approvalLevels || []).filter((entry) => entry.id !== result.data.id),
        result.data,
      ].sort((left, right) => `${left.school}${left.cluster}`.localeCompare(`${right.school}${right.cluster}`)),
    }));
    return { ok: true };
  };

  const deleteApprovalLevel = async (levelId) => {
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      return { error: 'Only the Admissions Office Head can change the approving levels.' };
    }
    if (!isSupabaseWorkspaceLoaded) {
      return { error: 'Supabase is not configured, so the approving level could not be removed.' };
    }
    const result = await deleteSupabaseApprovalLevel(levelId);
    if (result?.error) return { error: result.error.message || 'The approving level could not be removed.' };
    setState((previous) => ({
      ...previous,
      approvalLevels: (previous.approvalLevels || []).filter((entry) => entry.id !== levelId),
    }));
    return { ok: true };
  };

  // The Admissions Office verifies a vault document, or reverts it for
  // resubmission, here. Because an attribute's state is derived from its linked
  // proof documents (src/lib/verification.js), verifying the file also verifies
  // the attributes it proves. A resubmission note is required (ReasonModal in
  // ApplicationReviewModal); the database enforces the same rule and the stored
  // value stays `Rejected`. Verification is confirmed first (VerifyDocumentModal)
  // because the review is attributed to the signed-in account: the trigger stamps
  // reviewed_by, reviewed_by_role, and verification_decided_at, and a reset to
  // Pending clears them. The student is notified server-side by
  // notify-document-verification, which the database trigger calls; the browser
  // call below is a retry for the idempotent channels.
  const changeDocumentStatus = async (documentId, verificationStatus, rejectionReason = '') => {
    // Reviewing a vault file belongs to the Admissions Office Head (Consultation
    // 2): Staff and the interviewers read the files but never decide them.
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      const message = 'Only the Admissions Office Head can verify a document or revert it for resubmission.';
      window.alert(message);
      return { error: message };
    }
    const reason = verificationStatus === 'Rejected' ? String(rejectionReason || '').trim() : '';
    if (verificationStatus === 'Rejected' && !reason) return { error: 'A note is required to revert a document for resubmission.' };
    const decidedAt = new Date().toISOString();
    if (isSupabaseWorkspaceLoaded) {
      const result = await updateSupabaseDocumentStatus(documentId, verificationStatus, reason);
      if (result.error) {
        const message = result.error.message || 'The document status could not be saved. Confirm Supabase is configured and apply pending migrations.';
        window.alert(message);
        return { error: message };
      }
      if (['Verified', 'Rejected'].includes(verificationStatus)) {
        notifySupabaseDocumentVerification(documentId).catch(() => undefined);
      }
    }
    setState((previous) => ({
      ...previous,
      documents: previous.documents.map((entry) => entry.id === documentId ? {
        ...entry,
        verificationStatus,
        rejectionReason: reason,
        // Mirrors the database trigger: a decision records its date and the
        // reviewing account; a reset to Pending carries no decision.
        decidedAt: verificationStatus === 'Pending' ? null : decidedAt,
        reviewedBy: verificationStatus === 'Pending' ? null : (previous.authUser?.id || null),
        reviewedByRole: verificationStatus === 'Pending' ? null : state.viewerRole,
        reviewedByName: verificationStatus === 'Pending' ? null : (previous.authUser?.fullName || null),
      } : entry),
    }));
    return { ok: true };
  };

  // A file reverted for resubmission on a submitted, pre-endorsement application
  // can be swapped for another vault file or a new upload (which lands in the
  // vault first, as in the workspace). The status does not change; the new file
  // arrives Pending for the Admissions Office. The server repeats every check
  // (replace_rejected_application_document).
  const replaceRejectedDocument = async (applicationId, oldDocumentId, { documentId = '', file = null, documentType = '' } = {}) => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    const oldDocument = studentDocuments.find((doc) => doc.id === oldDocumentId);
    if (!application || application.studentId !== currentProfile.id || !DOCUMENT_REPLACEMENT_STATUSES.includes(application.status)) {
      return { error: 'Documents can be replaced only before the application is endorsed.' };
    }
    if (!oldDocument || oldDocument.verificationStatus !== 'Rejected' || !(application.attachedDocuments || []).includes(oldDocumentId)) {
      return { error: 'Only a file reverted for resubmission and attached to this application can be replaced.' };
    }
    let replacementId = documentId;
    if (file) {
      const upload = await uploadVaultDocument({ file, documentType });
      if (upload.error) return upload;
      replacementId = upload.document.id;
    }
    if (!replacementId) return { error: 'Choose a replacement file.' };
    const result = await replaceSupabaseApplicationDocument(applicationId, oldDocumentId, replacementId);
    if (result.error) {
      return { error: file
        ? `The file was saved to your Document Vault but could not replace the reverted one: ${result.error.message || 'please try again.'}`
        : result.error.message || 'The document could not be replaced.' };
    }
    setApplicationAttachments(applicationId, (ids) => [...ids.filter((id) => id !== oldDocumentId && id !== replacementId), replacementId], { touch: false });
    return { ok: true };
  };

  const deleteDocument = async (documentId) => {
    const documentToDelete = state.documents.find((entry) => entry.id === documentId);
    if (!documentToDelete) return;
    // A submitted application's reviewers rely on its attached files, so only
    // files used by drafts (or by nothing) can be deleted.
    const lockedBy = state.applications.find((entry) => entry.status !== 'Draft' && (entry.attachedDocuments || []).includes(documentId));
    if (lockedBy) {
      window.alert(`“${documentToDelete.title}” is attached to your submitted ${lockedBy.scholarshipTitle} application, so it cannot be deleted.`);
      return;
    }
    if (!window.confirm(`Delete “${documentToDelete.title}” from your vault?`)) return;
    if (isSupabaseWorkspaceLoaded) {
      const result = await deleteSupabaseDocument(documentId, documentToDelete.storagePath);
      if (result?.error) {
        window.alert(result.error.message || 'The document could not be deleted.');
        return;
      }
    }
    setState((previous) => ({
      ...previous,
      documents: previous.documents.filter((entry) => entry.id !== documentId),
      applications: previous.applications.map((entry) => ({
        ...entry,
        attachedDocuments: (entry.attachedDocuments || []).filter((id) => id !== documentId),
        documentStatus: (entry.attachedDocuments || []).filter((id) => id !== documentId).length ? entry.documentStatus : 'Pending',
      })),
    }));
  };

  // Uploads one file into the Document Vault. Used by the vault's own form and
  // by the application workspace, which attaches the new file afterwards.
  const uploadVaultDocument = async ({ file, documentType: rawDocumentType, attributeKey: rawAttributeKey = '' }) => {
    if (!(file instanceof File) || !file.name.trim()) return { error: 'Choose a file to upload.' };
    if (file.size > DOCUMENT_MAX_BYTES) return { error: 'Files must be 10 MB or smaller.' };
    if (!isSupabaseWorkspaceLoaded) return { error: 'Supabase is not configured, so the document could not be uploaded.' };

    const fileName = file.name.trim();
    const documentType = String(rawDocumentType || 'Supporting Document');
    // The vault derives the title from the attribute the file proves and its
    // document type, so there is no free-text title. Every path links the answers
    // the type proves for the student's standing (getProvenAttributes), so a file
    // uploaded from the application workspace verifies the same answers as one
    // uploaded in the vault.
    const attributeKey = String(rawAttributeKey || '').trim();
    const linkedAttributes = [...new Set([
      ...(attributeKey ? [attributeKey] : []),
      ...getProvenAttributes(documentType, studentMatchProfile),
    ])];
    // The declared value each linked attribute had at upload, so the proof reads
    // as Outdated once the student changes that value (src/lib/verification.js).
    // An answer a proof cannot be compared against (the family lists) records no
    // attested value, so the file stays current until a decision reverts it.
    const attestedValues = Object.fromEntries(linkedAttributes
      .filter((key) => isComparableAttribute(key))
      .map((key) => [key, getAttestedValue(key, studentMatchProfile)]));
    // A real uuid so the row, the storage path, and application_documents links
    // all share the same identifier.
    const id = crypto.randomUUID();
    const uploadedAt = new Date().toISOString().slice(0, 10);
    const baseTitle = getDocumentTitle({ documentType });
    // Two general documents can share a type, so disambiguate with the date.
    const title = studentDocuments.some((doc) => doc.title === baseTitle) ? `${baseTitle} (${uploadedAt})` : baseTitle;

    // The file uploads to Supabase Storage first; the document joins the vault
    // list only once the row records its storage_path, so the list never shows a
    // file that is still uploading or failed.
    const nextDocument = {
      id,
      ownerId: currentProfile.id,
      title,
      fileName,
      documentType,
      verificationStatus: 'Pending',
      linkedAttributes,
      attestedValues,
      sharedWith: [],
      uploadedAt,
      storagePath: null,
    };
    let result;
    try {
      result = await createSupabaseDocument({ id, ownerId: currentProfile.id, title, fileName, documentType, linkedAttributes, attestedValues, file });
    } catch (error) {
      return { error: error?.message || 'The document could not be uploaded.' };
    }
    if (result.error) return { error: result.error.message || 'The document could not be uploaded.' };

    setState((previous) => ({
      ...previous,
      documents: [{ ...nextDocument, storagePath: result.data?.storage_path ?? null }, ...previous.documents],
      notifications: prependInAppNotification(previous, {
        id: `not-${crypto.randomUUID()}`,
        title: `${title} uploaded to Document Vault`,
        channel: 'In-app',
        body: 'The file is now reusable across multiple scholarship applications.',
        status: 'Unread',
        createdAt: new Date().toISOString().slice(0, 10),
      }),
    }));

    return { ok: true, document: { ...nextDocument, storagePath: result.data?.storage_path ?? null } };
  };

  // The vault upload form holds its chosen file (including a camera capture) and
  // passes it here, so a photo never has to round-trip through FormData.
  const addDocument = async ({ file, documentType, attributeKey = '' } = {}) => (
    uploadVaultDocument({ file, documentType, attributeKey })
  );

  const addAnnouncement = (event) => {
    event.preventDefault();
    if (!isAdmissionsHeadRole(state.viewerRole)) return;
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get('announcementTitle') || '').trim();
    const body = String(formData.get('announcementBody') || '').trim();
    if (!title || !body) return;

    if (isSupabaseWorkspaceLoaded) createSupabaseAnnouncement({ title, body, audience: String(formData.get('announcementAudience') || 'Students'), createdBy: state.authUser?.id });

    setState((previous) => ({
      ...previous,
      announcements: [
        {
          id: `ann-${crypto.randomUUID()}`,
          title,
          body,
          audience: String(formData.get('announcementAudience') || 'Students'),
          createdAt: new Date().toISOString().slice(0, 10),
        },
        ...previous.announcements,
      ],
    }));

    event.currentTarget.reset();
  };

  // Office planning entries on the office calendar (verification windows, release
  // target dates, internal meetings). They are dates only: they do not create
  // notifications or deliveries. The Head publishes and removes them; both office
  // lanes and Department Chairs read them, and a student session never loads the
  // slice, so there is nothing to filter on the student side.
  const addOfficeCalendarEntry = async ({ title, entryDate, kind, notes } = {}) => {
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      return { ok: false, error: 'Only the Admissions Office Head can add office calendar entries.' };
    }
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle || !entryDate) {
      return { ok: false, error: 'A title and a date are required.' };
    }
    if (!isSupabaseWorkspaceLoaded) {
      return { ok: false, error: 'Supabase is not configured, so the entry could not be saved.' };
    }
    const entry = {
      id: `office-${crypto.randomUUID()}`,
      title: cleanTitle,
      entryDate: String(entryDate),
      kind: OFFICE_ENTRY_KINDS.includes(kind) ? kind : 'office',
      notes: String(notes || '').trim(),
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setState((previous) => ({
      ...previous,
      officeCalendarEntries: [...(previous.officeCalendarEntries || []), entry],
    }));
    const { error } = await createSupabaseOfficeCalendarEntry({ ...entry, createdBy: state.authUser?.id });
    if (error) {
      // Drop the optimistic row so the calendar never shows an entry the database
      // refused (for example when the caller is not the Head lane).
      setState((previous) => ({
        ...previous,
        officeCalendarEntries: (previous.officeCalendarEntries || []).filter((item) => item.id !== entry.id),
      }));
      return { ok: false, error: error.message || 'The entry could not be saved.' };
    }
    return { ok: true, entry };
  };

  const deleteOfficeCalendarEntry = async (entryId) => {
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      return { ok: false, error: 'Only the Admissions Office Head can remove office calendar entries.' };
    }
    const previousEntry = (state.officeCalendarEntries || []).find((item) => item.id === entryId);
    if (!previousEntry) {
      return { ok: false, error: 'That entry is no longer on the calendar.' };
    }
    setState((previous) => ({
      ...previous,
      officeCalendarEntries: (previous.officeCalendarEntries || []).filter((item) => item.id !== entryId),
    }));
    const { error } = await deleteSupabaseOfficeCalendarEntry(entryId);
    if (error) {
      setState((previous) => ({
        ...previous,
        officeCalendarEntries: [...(previous.officeCalendarEntries || []), previousEntry],
      }));
      return { ok: false, error: error.message || 'The entry could not be removed.' };
    }
    return { ok: true };
  };

  const saveScholarship = async (scholarship) => {
    if (!isAdmissionsHeadRole(state.viewerRole)) {
      window.alert('Only the Admissions Office Head can publish catalog entries.');
      return false;
    }
    if (!isAdduInternalProgram(scholarship)) {
      window.alert('Only the three Appendix A tracks can be published: Grant-in-Aid (GIA), the Jubilee Scholarship Fund, and the Working Scholar Program (WSP).');
      return false;
    }
    if (!scholarship?.title || !scholarship?.coverage || !['general-pool', 'honors', 'work-study'].includes(scholarship.ruleFamily)) return;
    if (!isSupabaseWorkspaceLoaded) {
      window.alert('Supabase is not configured, so the scholarship could not be saved.');
      return;
    }
    const result = scholarship.id
      ? await updateSupabaseScholarship(scholarship.id, scholarship)
      : await createSupabaseScholarship(scholarship);
    if (result.error || !result.data) {
      window.alert(result.error?.message || 'The scholarship could not be saved. Confirm Supabase is configured and apply pending migrations.');
      return;
    }

    const saved = result.data;
    setState((previous) => ({
      ...previous,
      scholarships: [saved, ...(previous.scholarships || []).filter((entry) => entry.id !== saved.id)],
    }));
    return true;
  };

  const markNotificationRead = (notificationId) => {
    if (isSupabaseWorkspaceLoaded) markSupabaseNotificationRead(notificationId);
    setState((previous) => ({
      ...previous,
      notifications: previous.notifications.map((entry) => entry.id === notificationId ? { ...entry, status: 'Read' } : entry),
    }));
  };

  const addCustomDeadline = async (title, deadline) => {
    const deadlineDate = new Date(deadline);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (!title.trim() || Number.isNaN(deadlineDate.getTime()) || deadlineDate < startOfToday) {
      return;
    }

    const ownerId = state.authUser?.id || currentProfile.id;

    const newDeadline = {
      id: `custom-${crypto.randomUUID()}`,
      title,
      deadline: deadline,
      createdAt: new Date().toISOString().slice(0, 10),
      // Stamped so the reminder cannot be backfilled into another user's
      // account on a shared browser.
      ownerId: isRealUserId(ownerId) ? ownerId : null,
    };

    // The calendar updates immediately. The server save is reported separately,
    // because only a row in `custom_deadlines` can be emailed by the scheduled
    // reminder function.
    setState((previous) => ({
      ...previous,
      customDeadlines: [newDeadline, ...previous.customDeadlines],
    }));


    if (!isSupabaseWorkspaceLoaded || !isRealUserId(ownerId)) {
      setDeadlineSync({
        tone: 'warning',
        message: 'Reminder saved on this device only. Sign in with Supabase to enable email reminders.',
      });
      return;
    }

    const { error } = await createSupabaseCustomDeadline({
      id: newDeadline.id,
      ownerId,
      title: newDeadline.title,
      deadline: newDeadline.deadline,
    });

    setDeadlineSync(error
      ? {
        tone: 'error',
        message: `Reminder added here, but the server rejected it (${error.message || 'unknown error'}). Email reminders will not send for this deadline.`,
      }
      : {
        tone: 'success',
        message: 'Reminder saved. Email reminders are enabled for this deadline.',
      });
  };

  const deleteCustomDeadline = async (deadlineId) => {
    setState((previous) => ({
      ...previous,
      customDeadlines: previous.customDeadlines.filter((d) => d.id !== deadlineId),
    }));

    if (!isSupabaseWorkspaceLoaded) return;

    const { error } = await deleteSupabaseCustomDeadline(deadlineId);
    if (error) {
      setDeadlineSync({
        tone: 'error',
        message: `Reminder removed here, but the server could not delete it (${error.message || 'unknown error'}), so it may still send reminders.`,
      });
    }
  };

  // Saves one My Profile section. Students may edit academic and eligibility
  // fields; staff may edit only their name, mobile number, and bio, so a
  // Department Chair can never re-scope their own department from this page.
  // Household finances are office-only (student_financial_profiles), so they are
  // saved apart from saveProfile and never reach profile_details or localStorage.
  const saveFinancialProfile = async (patch) => {
    if (state.viewerRole !== 'student') return { success: false, message: 'Only students keep household finances.' };
    const userId = state.authUser?.id || currentProfile.id;
    const result = await saveSupabaseFinancialProfile(userId, patch.financialProfile);
    if (!result.success) {
      return {
        success: false,
        message: result.missing
          ? 'Household finances need the latest database migration (20261036000000).'
          : (result.error?.message || 'Unable to save your household finances.'),
      };
    }
    setFinancial((previous) => ({ ...previous, profile: result.details, loaded: true }));
    return { success: true, message: 'Household finances saved.' };
  };

  const saveProfile = async (patch) => {
    const isStudent = state.viewerRole === 'student';
    const accountFields = pickFields(patch, isStudent ? ACCOUNT_FIELD_KEYS : STAFF_EDITABLE_FIELD_KEYS);
    if (isStudent && accountFields.degreeProgram) {
      const selectedProgram = activeAcademicPrograms.find((program) => program.value === accountFields.degreeProgram) || getAcademicProgram(accountFields.degreeProgram);
      // `profiles.department` is the SCHOOL the program belongs to; the academic
      // department is the narrower level the reviewer scope ladder resolves.
      accountFields.department = selectedProgram.school;
    }
    const eligibilityAttributes = isStudent ? pickEligibilityAttributes(patch) : {};
    const hasEligibilityAttributes = Object.keys(eligibilityAttributes).length > 0;
    // Descriptive fields (religion, civil status, address, family details) are
    // stored separately from the eligibility attributes and never feed the
    // Smart Eligibility Checker.
    const profileDetails = isStudent ? pickFields(patch, PROFILE_DETAIL_KEYS) : {};
    const hasProfileDetails = Object.keys(profileDetails).length > 0;
    const userId = state.authUser?.id || currentProfile.id;

    const result = await updateProfileFields(userId, {
      ...accountFields,
      ...(hasEligibilityAttributes
        ? { eligibilityAttributes: { ...pickEligibilityAttributes(studentMatchProfile), ...eligibilityAttributes } }
        : {}),
      ...(hasProfileDetails ? { profileDetails: mergeProfileDetails(studentMatchProfile, profileDetails) } : {}),
    });
    if (!result.success) return result;

    updateState((previous) => ({
      authUser: { ...previous.authUser, ...accountFields },
      profileDraft: isStudent
        ? { ...previous.profileDraft, ...pickFields(accountFields, PROFILE_DRAFT_KEYS), ...eligibilityAttributes, ...profileDetails }
        : previous.profileDraft,
    }));

    return {
      success: true,
      message: result.detailsSynced === false
        ? 'Saved. Some details are kept on this device until the server profile is updated.'
        : 'Profile saved.',
    };
  };

  // Profile photo: normalize to a square JPEG, upload it to the private avatars
  // bucket, record its path on the profile, then remove the previous object. The
  // signed URL is memory-only and falls back to the initials avatar on error.
  const saveProfileAvatar = async (file) => {
    if (!(file instanceof File)) return { success: false, message: 'Choose a photo to use.' };
    if (!isSupabaseWorkspaceLoaded) return { success: false, message: 'Supabase is not configured, so your profile photo could not be saved.' };
    const userId = state.authUser?.id || currentProfile.id;
    if (!userId) return { success: false, message: 'Sign in again to change your profile photo.' };

    setIsSavingAvatar(true);
    try {
      const normalized = await normalizeImageFile(file, {
        mode: 'portrait',
        fileName: buildPhotoFileName({ prefix: 'profile-photo' }),
      });
      if (normalized.size > AVATAR_MAX_BYTES) return { success: false, message: 'Choose a photo smaller than 5 MB.' };

      const previousPath = state.authUser?.avatarPath || '';
      const upload = await uploadSupabaseAvatar({ ownerId: userId, file: normalized });
      if (upload.error || !upload.path) {
        return { success: false, message: upload.error?.message || 'Your photo could not be uploaded.' };
      }
      const saved = await updateProfileAvatar(userId, upload.path);
      if (!saved.success) {
        // The row still points at the old photo (or none), so do not leave the
        // new object orphaned in the bucket.
        await deleteSupabaseAvatar(upload.path);
        return { success: false, message: saved.message || 'Your photo could not be saved.' };
      }
      if (previousPath && previousPath !== upload.path) await deleteSupabaseAvatar(previousPath);

      const { url } = await getSupabaseAvatarUrl(upload.path);
      setAvatarPreview({ path: upload.path, url: url || '' });
      updateState((previous) => ({ authUser: { ...previous.authUser, avatarPath: upload.path } }));
      return {
        success: true,
        message: saved.synced === false
          ? 'Saved. Your photo is stored, but the server profile is missing the avatar column (apply the pending migration).'
          : 'Profile photo updated.',
      };
    } catch (error) {
      return { success: false, message: error?.message || 'Your photo could not be saved.' };
    } finally {
      setIsSavingAvatar(false);
    }
  };

  const removeProfileAvatar = async () => {
    const userId = state.authUser?.id || currentProfile.id;
    const previousPath = state.authUser?.avatarPath || '';
    if (!userId) return { success: false, message: 'Sign in again to change your profile photo.' };
    if (!previousPath) return { success: true, message: 'No profile photo to remove.' };

    setIsSavingAvatar(true);
    try {
      const saved = await updateProfileAvatar(userId, null);
      if (!saved.success) return { success: false, message: saved.message || 'Your profile photo could not be removed.' };
      await deleteSupabaseAvatar(previousPath);
      setAvatarPreview({ path: '', url: '' });
      updateState((previous) => ({ authUser: { ...previous.authUser, avatarPath: '' } }));
      return { success: true, message: 'Profile photo removed.' };
    } catch (error) {
      return { success: false, message: error?.message || 'Your profile photo could not be removed.' };
    } finally {
      setIsSavingAvatar(false);
    }
  };

  const changeAccountPassword = (password) => updateAccountPassword({ password });
  const requestOwnPasswordReset = () => requestPasswordReset({ email: currentIdentity.email || '' });

  // Department queue is derived from applications joined to the student's
  // school-level department, so it stays consistent with profiles.department
  // from the academic program taxonomy rather than a separately seeded table.
  // One scoped queue for every reviewer level: a Dean sees its school, an Assistant
  // Dean its cluster, and a Chairperson its department and the programs under it. A
  // Chairperson an operator has not scoped yet keeps the old school-wide read.
  const departmentQueue = getScopedQueue(state.applications, { ...currentProfile, role: state.viewerRole }, activeAcademicPrograms)
    .filter((entry) => entry.status !== 'Draft');

  // The Admissions Office workspace is split into one route per function. Both
  // lanes read the Dashboard and the review queue; only the Head manages the
  // catalog, announcements, and the approval/release decisions.
  const isAdmissionsHead = isAdmissionsHeadRole(state.viewerRole);
  const admissionsWorkspaceItems = isAdmissionsReviewerRole(state.viewerRole)
    ? [
      { view: 'admin', label: 'Dashboard', visible: true },
      { view: 'admin-intake', label: 'Intake pool', visible: true },
      // Staff keep a read-only office view; the personal review queue is the
      // Head's, because only the Head opens a case into review.
      { view: 'admin-review', label: 'Review queue', visible: isAdmissionsHead },
      { view: 'admin-interviews', label: 'Interviews', visible: true },
      { view: 'admin-calendar', label: 'Calendar', visible: true },
      { view: 'admin-release', label: 'Final check and release', visible: isAdmissionsHead },
      { view: 'admin-catalog', label: 'Scholarship catalog', visible: isAdmissionsHead },
      { view: 'admin-announcements', label: 'Announcements', visible: isAdmissionsHead },
    ]
    : [];

  // A student's My Profile is their scholarship application form (FORM 230-SCH),
  // so it is named and placed as the first thing to complete, right after the
  // Dashboard. Staff keep "My Profile" at the end of their list.
  const profilePageLabel = state.viewerRole === 'student' ? 'Application Form' : 'My Profile';

  // Dashboard belongs to the student only: each staff, head, and Chair role has
  // its own landing workspace (the office Dashboard, or Department Review).
  const navigationItems = [
    { view: 'dashboard', label: 'Dashboard', visible: state.viewerRole === 'student' },
    { view: 'profile', label: profilePageLabel, visible: state.viewerRole === 'student' },
    { view: 'explore', label: 'Scholarships', visible: state.viewerRole === 'student' },
    { view: 'applications', label: 'Applications', visible: state.viewerRole === 'student' },
    { view: 'vault', label: 'Document Vault', visible: state.viewerRole === 'student' },
    { view: 'calendar', label: 'Calendar', visible: state.viewerRole === 'student' },
    ...admissionsWorkspaceItems,
    { view: 'review', label: getReviewPageLabel(state.viewerRole), visible: isReviewerRole(state.viewerRole) },
    { view: 'chair-interviews', label: 'Interviews', visible: isReviewerRole(state.viewerRole) },
    { view: 'chair-calendar', label: 'Calendar', visible: isReviewerRole(state.viewerRole) },
    { view: 'profile', label: profilePageLabel, visible: state.viewerRole !== 'student' },
    { view: 'settings', label: 'Settings', visible: true },
  ].filter((item) => item.visible);

  const renderNavigation = (className = '') => (
    <SidebarNav items={navigationItems} activeView={state.activeView} onNavigate={navigate} className={className} />
  );

  if (isBooting || !isSessionChecked) {
    return (
      <div className="grid min-h-screen place-items-center bg-app-bg p-5 text-app-text">
        <div className="w-full max-w-3xl rounded-app border border-app-border bg-app-card p-6 shadow-app backdrop-blur sm:p-8">
          <span className="inline-flex items-center rounded-full border border-app-border bg-app-surface px-3 py-1 text-xs font-semibold text-app-text">ScholarPath AdDU</span>
          <h1 className="mt-4 text-2xl font-bold">Preparing your scholarship workspace</h1>
          <p className="mt-2 text-app-muted">Preparing your scholarship workspace…</p>
          <div className="mt-6 grid gap-3">
            <div className="h-[92px] animate-pulse rounded-[18px] bg-app-surface" />
            <div className="h-[92px] animate-pulse rounded-[18px] bg-app-surface" />
            <div className="h-[92px] animate-pulse rounded-[18px] bg-app-surface" />
          </div>
        </div>
      </div>
    );
  }

  if (!state.isAuthenticated) {
    return (
      <LoginScreenPage
        onLogin={login}
        onSignUp={signup}
        onForgotPassword={requestPasswordReset}
        rememberedEmail={state.savedEmail}
        isRemembered={state.rememberMe}
        theme={state.theme}
        onToggleTheme={() => updateState((prev) => ({ theme: prev.theme === 'light' ? 'dark' : 'light' }))}
        sessionNotice={sessionNotice}
      />
    );
  }

  return (
    <div className={`min-h-screen max-w-[100vw] overflow-x-clip bg-app-bg p-3 text-app-text sm:p-5 ${themeClass}`}>
      {sessionTimeoutState && (
        <SessionTimeoutModal
          reason={sessionTimeoutState.reason}
          expiresAt={sessionTimeoutState.expiresAt}
          warningMs={sessionTimeoutState.warningMs}
          warningStartedAt={sessionTimeoutState.warningStartedAt}
          onStaySignedIn={continueSession}
          onSignOut={logout}
        />
      )}
      {profileOnboarding && (
        <AcademicProfileModal
          fullName={profileOnboarding.fullName}
          initialProgram={profileOnboarding.initialProgram}
          initialProgramChoice2={profileOnboarding.initialProgramChoice2}
          initialProgramChoice3={profileOnboarding.initialProgramChoice3}
          initialStudentNumber={profileOnboarding.initialStudentNumber}
          initialYearStanding={profileOnboarding.initialYearStanding}
          initialIsTransferee={profileOnboarding.initialIsTransferee}
          initialAcademicStanding={profileOnboarding.initialAcademicStanding}
          initialCitizenship={profileOnboarding.initialCitizenship}
          initialHsStrand={profileOnboarding.initialHsStrand}
          initialHsAverage={profileOnboarding.initialHsAverage}
          initialHouseholdIncome={profileOnboarding.initialHouseholdIncome}
          initialQpi={profileOnboarding.initialQpi}
          initialHasActiveGovernmentGrant={profileOnboarding.initialHasActiveGovernmentGrant}
          academicPrograms={activeAcademicPrograms}
          academicProgramGroups={activeAcademicProgramGroups}
          onSave={saveAcademicProfile}
          isSaving={isSavingProfile}
          errorMessage={profileSaveError}
        />
      )}
      {/* A solid bar that bleeds past the page padding to the screen edges. On a
          phone the title stacks as a two-line lockup and the buttons compact so the
          bigger logo and title still sit beside the avatar, bell, menu, and logout. */}
      <header className="app-header relative -mx-3 -mt-3 mb-5 flex min-w-0 items-center justify-between gap-2 border-b border-app-border bg-[color:var(--header-bg)] px-3 py-2 shadow-card sm:-mx-5 sm:-mt-5 sm:gap-4 sm:px-5 sm:py-3">
        <div className="min-w-0 flex-1">
          <div className="flex max-w-full items-center gap-2 sm:gap-3">
            <img src={logoImage} alt="Ateneo de Davao University logo" className="h-11 w-11 shrink-0 rounded-full border border-app-border bg-white/10 object-contain p-0.5 shadow-card min-[400px]:h-12 min-[400px]:w-12 sm:h-14 sm:w-14 lg:h-16 lg:w-16" />
            <div className="min-w-0 font-display text-base/[0.95] font-bold tracking-wide text-app-text min-[375px]:text-lg/[0.95] min-[390px]:text-xl/[0.95] min-[400px]:text-2xl/[0.95] sm:text-3xl/none lg:text-4xl/none">
              <span className="block truncate sm:inline">ScholarPath</span>{' '}
              <span className="block truncate text-blue-700 dark:text-sky-300 sm:inline">AdDU</span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5 sm:gap-3">
          {state.authUser && (
            <button
              type="button"
              className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-full focus:outline-none focus:ring-4 focus:ring-blue-500/20 sm:hidden"
              title={`${state.authUser.fullName} · ${roleLabels[state.viewerRole]}`}
              aria-label={`Open ${profilePageLabel}`}
              onClick={() => navigate('profile')}
            >
              <ProfileAvatar src={avatarPreview.url} name={state.authUser.fullName} size="sm" />
              <span className="hidden min-w-0 max-w-[12rem] leading-tight sm:grid">
                <strong className="truncate">{state.authUser.fullName}</strong>
                {identityRoleLine && <span className="text-xs text-app-muted">{identityRoleLine}</span>}
              </span>
            </button>
          )}
          <NotificationDropdown
            notifications={visibleNotifications}
            announcements={state.announcements}
            onMarkRead={markNotificationRead}
          />
          <button
            type="button"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-app-border bg-app-surface text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 sm:min-h-11 sm:min-w-11 lg:hidden"
            onClick={() => setIsMobileNavOpen((open) => !open)}
            aria-label={isMobileNavOpen ? 'Close page navigation' : 'Open page navigation'}
            aria-expanded={isMobileNavOpen}
          >
            {isMobileNavOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          </button>
          <button className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-2 py-2 text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 sm:min-h-11 sm:min-w-11 sm:px-3" onClick={logout} aria-label="Logout" title="Logout">
            <LogOut size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {isMobileNavOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px] lg:hidden"
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Close page navigation"
          />
          <aside className="app-scroll fixed inset-y-0 right-0 z-50 w-[min(21rem,88vw)] overflow-y-auto border-l border-app-border bg-app-card p-5 shadow-2xl lg:hidden" aria-label="Page navigation">
            <div className="mb-5 flex justify-end">
              <button type="button" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-app-border bg-app-surface text-app-text" onClick={() => setIsMobileNavOpen(false)} aria-label="Close page navigation"><X size={18} /></button>
            </div>
            {renderNavigation()}
          </aside>
        </>
      )}

      <button
        type="button"
        className="fixed bottom-4 left-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-app-border bg-app-surface text-app-text shadow-card transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 sm:bottom-5 sm:left-5"
        onClick={() => updateState((prev) => ({ theme: prev.theme === 'light' ? 'dark' : 'light' }))}
        aria-label={state.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        title={state.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      >
        <span className="theme-toggle-icon" aria-hidden="true">
          {state.theme === 'light' ? <Moon className="icon-moon" size={20} /> : <Sun className="icon-sun" size={20} />}
        </span>
      </button>

      <main className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Floats beside long pages from `lg`. It never scrolls on its own: when it is
            taller than the window its top (the page links) stays in view and the
            summary boxes below come into view at the bottom of the page. */}
        <aside className="sticky top-5 hidden h-fit rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur lg:block">
          <SidebarProfile avatarUrl={avatarPreview.url} name={currentIdentity.fullName} roleLine={identityRoleLine} detailLine={identityDetailLine} />

          {renderNavigation('my-4')}

          <div className="border-t border-app-border pt-4">
            <SidebarStats items={sidebarStats} />
          </div>
        </aside>

        <section className="blue-action-view grid min-w-0 gap-5">
          {state.viewerRole === 'student' && state.activeView === 'dashboard' && (
            <DashboardViewPage
              profile={currentIdentity}
              isFirstLogin={state.showFirstLoginWelcome}
              scholarships={scholarshipCatalog}
              onOpenExplorer={() => navigate('explore')}
            />
          )}

          {state.activeView === 'explore' && (
            <ScholarshipExplorerPage
              profile={currentIdentity}
              scholarships={filteredScholarships}
              searchQuery={state.searchQuery}
              filters={state.filters}
              onSearchChange={(value) => updateState({ searchQuery: value })}
              onFilterChange={(patch) => updateState((previous) => ({ filters: { ...previous.filters, ...patch } }))}
              onApply={applyToScholarship}
              onOpenProfileSection={(section, field) => navigate('profile', { section, field })}
            />
          )}

          {state.activeView === 'applications' && (
            <ApplicationsViewPage
              applications={studentApplications}
              documents={studentDocuments}
              scholarships={state.scholarships || []}
              profile={studentMatchProfile}
              openApplicationId={openApplicationId}
              onOpenApplication={setOpenApplicationId}
              onAttach={attachDocumentToApplication}
              onDetach={detachDocumentFromApplication}
              onUploadAndAttach={uploadAndAttachDocument}
              onReplaceDocument={replaceRejectedDocument}
              onSaveDraft={saveApplicationDraft}
              onSubmit={submitApplication}
              financialAnswersByApplication={financial.answersByApplication}
              financialSnapshotsByApplication={financial.snapshotsByApplication}
              onSaveProfile={saveProfile}
              onOpenProfile={() => navigate('profile')}
            />
          )}

          {state.activeView === 'vault' && state.viewerRole === 'student' && (
            <DocumentVaultViewPage
              documents={studentDocuments}
              applications={studentApplications}
              profile={studentMatchProfile}
              onUpload={addDocument}
              onDelete={deleteDocument}
              onResolveDocument={(applicationId) => navigate('applications', { applicationId })}
              presetAttribute={vaultPreset.attribute}
              presetDocumentType={vaultPreset.documentType}
            />
          )}

          {isAdmissionsReviewerRole(state.viewerRole) && state.activeView === 'admin' && (
            <AdminOverviewPage
              applications={state.applications}
              caseOfficers={state.caseOfficers || []}
              currentUserId={currentProfile.id}
              documents={state.documents}
              role={state.viewerRole}
              onOpenWorkspace={(view) => navigate(view)}
            />
          )}

          {isAdmissionsReviewerRole(state.viewerRole) && state.activeView === 'admin-intake' && (
            <AdminIntakePoolPage
              applications={state.applications}
              caseOfficers={state.caseOfficers || []}
              caseOfficersReady={state.caseOfficersReady !== false}
              students={state.students}
              documents={state.documents}
              scholarships={state.scholarships || []}
              role={state.viewerRole}
              currentUserId={currentProfile.id}
              reviewerName={state.authUser?.fullName || ''}
              onPickUpApplication={joinCaseReview}
              onChangeApplication={changeApplicationStatus}
              onRejectApplication={rejectApplication}
              onEndorseApplication={endorseApplication}
              interviewWorkspace={interviewWorkspace}
              onRecordDeliberation={recordDeliberation}
              onReleaseResults={releaseApplicationResults}
              onChangeDocument={changeDocumentStatus}
              reviewComments={state.reviewComments || []}
              onAddComment={addReviewComment}
              onJoinCase={joinCaseReview}
              onLeaveCase={leaveCaseReview}
            />
          )}


          {isAdmissionsReviewerRole(state.viewerRole) && state.activeView === 'admin-review' && (
            <AdminReviewQueuePage
              applications={state.applications}
              caseOfficers={state.caseOfficers || []}
              caseOfficersReady={state.caseOfficersReady !== false}
              currentUserId={currentProfile.id}
              onOpenWorkspace={(view) => navigate(view)}
              onJoinCase={joinCaseReview}
              onLeaveCase={leaveCaseReview}
              students={state.students}
              documents={state.documents}
              scholarships={state.scholarships || []}
              role={state.viewerRole}
              reviewerName={state.authUser?.fullName || ''}
              onChangeApplication={changeApplicationStatus}
              onRejectApplication={rejectApplication}
              onEndorseApplication={endorseApplication}
              interviewWorkspace={interviewWorkspace}
              onRecordDeliberation={recordDeliberation}
              onReleaseResults={releaseApplicationResults}
              onChangeDocument={changeDocumentStatus}
              reviewComments={state.reviewComments || []}
              onAddComment={addReviewComment}
            />
          )}

          {isAdmissionsReviewerRole(state.viewerRole) && state.activeView === 'admin-calendar' && (
            <AdminCalendarPage
              applications={state.applications}
              students={state.students}
              caseOfficers={state.caseOfficers || []}
              currentUserId={currentProfile.id}
              onJoinCase={joinCaseReview}
              onLeaveCase={leaveCaseReview}

              documents={state.documents}
              scholarships={state.scholarships || []}
              role={state.viewerRole}
              reviewerName={state.authUser?.fullName || ''}
              interviewWorkspace={interviewWorkspace}
              reviewComments={state.reviewComments || []}
              onAddComment={addReviewComment}
              onChangeApplication={changeApplicationStatus}
              onRejectApplication={rejectApplication}
              onEndorseApplication={endorseApplication}
              onRecordDeliberation={recordDeliberation}
              onReleaseResults={releaseApplicationResults}
              onChangeDocument={changeDocumentStatus}
              officeCalendarEntries={state.officeCalendarEntries || []}
              onAddOfficeEntry={isAdmissionsHeadRole(state.viewerRole) ? addOfficeCalendarEntry : undefined}
              onDeleteOfficeEntry={isAdmissionsHeadRole(state.viewerRole) ? deleteOfficeCalendarEntry : undefined}
            />
          )}

          {isAdmissionsReviewerRole(state.viewerRole) && state.activeView === 'admin-interviews' && (
            <AdminInterviewsPage
              applications={state.applications}
              students={state.students}
              caseOfficers={state.caseOfficers || []}
              currentUserId={currentProfile.id}
              onJoinCase={joinCaseReview}
              onLeaveCase={leaveCaseReview}

              documents={state.documents}
              scholarships={state.scholarships || []}
              role={state.viewerRole}
              reviewerName={state.authUser?.fullName || ''}
              interviewWorkspace={interviewWorkspace}
              reviewComments={state.reviewComments || []}
              onAddComment={addReviewComment}
              onChangeApplication={changeApplicationStatus}
              onRejectApplication={rejectApplication}
              onEndorseApplication={endorseApplication}
              onRecordDeliberation={recordDeliberation}
              onReleaseResults={releaseApplicationResults}
              onChangeDocument={changeDocumentStatus}
            />
          )}

          {isAdmissionsHead && state.activeView === 'admin-catalog' && (
            <AdminScholarshipCatalogPage
              scholarships={state.scholarships || []}
              onSaveScholarship={saveScholarship}
              onDirtyChange={setIsAdminCatalogDirty}
              approvalLevels={state.approvalLevels || []}
              academicPrograms={activeAcademicPrograms}
              onSaveApprovalLevel={saveApprovalLevel}
              onDeleteApprovalLevel={deleteApprovalLevel}
            />
          )}

          {isAdmissionsHead && state.activeView === 'admin-release' && (
            <AdminResultsReleasePage
              applications={state.applications}
              documents={state.documents}
              students={state.students}
              scholarships={state.scholarships || []}
              onChangeApplication={changeApplicationStatus}
              onRejectApplication={rejectApplication}
              onApproveApplication={approveApplication}
              onReleaseResults={releaseApplicationResults}
              onReleaseScholarshipResults={releaseScholarshipResults}
              resultsReleases={state.resultsReleases || []}
              academicPrograms={activeAcademicPrograms}
              interviewWorkspace={interviewWorkspace}
            />
          )}

          {isAdmissionsHead && state.activeView === 'admin-announcements' && (
            <AdminAnnouncementsPage
              announcements={state.announcements}
              onCreateAnnouncement={addAnnouncement}
            />
          )}

          {state.activeView === 'review' && isReviewerRole(state.viewerRole) && (
            <DepartmentReviewViewPage
              profile={currentProfile}
              queue={departmentQueue}
              documents={state.documents}
              scholarships={state.scholarships || []}
              reviewComments={state.reviewComments || []}
              onChangeApplication={changeApplicationStatus}
              onRejectApplication={rejectApplication}
              onApproveApplication={approveApplication}
              onRecordDeliberation={recordDeliberation}
              onAddComment={addReviewComment}
              interviewWorkspace={interviewWorkspace}
            />
          )}

          {isReviewerRole(state.viewerRole) && state.activeView === 'chair-calendar' && (
            <DepartmentCalendarViewPage
              profile={currentProfile}
              queue={departmentQueue}
              documents={state.documents}
              scholarships={state.scholarships || []}
              reviewComments={state.reviewComments || []}
              onChangeApplication={changeApplicationStatus}
              onRejectApplication={rejectApplication}
              onApproveApplication={approveApplication}
              onRecordDeliberation={recordDeliberation}
              onAddComment={addReviewComment}
              interviewWorkspace={interviewWorkspace}
              officeCalendarEntries={state.officeCalendarEntries || []}
            />
          )}

          {isReviewerRole(state.viewerRole) && state.activeView === 'chair-interviews' && (
            <DepartmentInterviewsViewPage
              profile={currentProfile}
              queue={departmentQueue}
              documents={state.documents}
              scholarships={state.scholarships || []}
              reviewComments={state.reviewComments || []}
              onChangeApplication={changeApplicationStatus}
              onRejectApplication={rejectApplication}
              onApproveApplication={approveApplication}
              onRecordDeliberation={recordDeliberation}
              onAddComment={addReviewComment}
              interviewWorkspace={interviewWorkspace}
            />
          )}

          {state.activeView === 'profile' && (
            <ProfileViewPage
              profile={currentIdentity}
              role={state.viewerRole}
              roleLabel={roleLabels[state.viewerRole]}
              academicPrograms={activeAcademicPrograms}
              academicProgramGroups={activeAcademicProgramGroups}
              initialSection={profilePresetSection}
              initialField={profilePresetField}
              onSaveProfile={saveProfile}
              onSaveFinancialProfile={saveFinancialProfile}
              financialMissing={financial.missing}
              avatar={{ url: avatarPreview.url, path: state.authUser?.avatarPath || '', isSaving: isSavingAvatar }}
              onChangeAvatar={saveProfileAvatar}
              onRemoveAvatar={removeProfileAvatar}
              onChangePassword={changeAccountPassword}
              onRequestPasswordReset={requestOwnPasswordReset}
              attributeVerifications={attributeVerifications}
              scholarships={scholarshipCatalog}
              documents={studentDocuments}
              // A Pending proof is already uploaded, so "View proof" opens the vault
              // to see it; every other state uploads a file in the dialog.
              onAttachProof={(attributeKey) => (attributeVerifications[attributeKey] === 'Pending'
                ? navigate('vault', { attribute: attributeKey })
                : setProofUpload({ attribute: attributeKey, documentType: '' }))}
              onUploadDocument={(preset) => setProofUpload({ attribute: preset?.attribute || '', documentType: preset?.documentType || '' })}
              onFindScholarship={() => navigate('explore')}
              previewProofImpact={state.viewerRole === 'student'
                ? (patch) => getNewlyOutdatedAttributes(studentDocuments, studentMatchProfile, patch)
                : undefined}
              previewVerifications={state.viewerRole === 'student'
                ? (patch) => deriveAttributeVerifications(studentDocuments, VERIFIABLE_ATTRIBUTE_KEYS, { profile: { ...studentMatchProfile, ...patch } })
                : undefined}
            />
          )}

          {state.activeView === 'profile' && proofUpload && state.viewerRole === 'student' && (
            <DocumentUploadModal
              profile={studentMatchProfile}
              presetAttribute={proofUpload.attribute}
              presetDocumentType={proofUpload.documentType}
              onUpload={addDocument}
              onClose={() => setProofUpload(null)}
            />
          )}

          {state.activeView === 'settings' && (
            <SettingsViewPage
              profilePageLabel={profilePageLabel}
              notificationPreferences={state.notificationPreferences}
              sessionTimeoutConfig={sessionTimeoutConfig}
              isEmailDeliveryAvailable={isSupabaseWorkspaceLoaded}
              onUpdatePreferences={(prefs) => {
                updateState({ notificationPreferences: prefs });
                // Mirror the settings to Supabase so the scheduled reminder
                // function can honor the same channel choices.
                if (isSupabaseWorkspaceLoaded && state.authUser?.id) {
                  updateSupabaseNotificationPreferences(state.authUser.id, prefs);
                }
              }}
              onSendTestEmail={isSupabaseWorkspaceLoaded ? sendSupabaseTestEmail : null}
              onSendTestSms={isSupabaseWorkspaceLoaded ? sendSupabaseTestSms : null}
              mobileNumber={currentIdentity.phone || ''}
            />
          )}

          {state.activeView === 'calendar' && (
            <CalendarViewPage
              scholarships={scholarshipCatalog}
              customDeadlines={state.customDeadlines}
              interviews={state.viewerRole === 'student' ? studentApplications : []}
              onAddCustomDeadline={addCustomDeadline}
              onDeleteCustomDeadline={deleteCustomDeadline}
              syncFeedback={deadlineSync}
              onDismissSyncFeedback={() => setDeadlineSync(null)}
            />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
