import { academicPrograms, isHierarchyProgram } from './academicPrograms';
import { pageViewKeys } from './constants';

// The app's local persistence key. It was renamed from the old
// `scholarpath-addu-demo-state` key when the seeded demo data and the demo
// fallback login were removed and Supabase became the required backend.
export const storageKey = 'scholarpath-addu-state';

// Read once so a device that still holds the old demo-state record carries over
// its user-chosen theme, notification preferences, and custom deadlines instead
// of losing them. Seeded demo records are intentionally dropped because
// Supabase is now the authoritative source for server-backed data.
const legacyStorageKey = 'scholarpath-addu-demo-state';

// Older stored sessions predate the SOP pipeline fields; normalize every
// application so staff views can rely on applicant context and stage records.
export const normalizeApplication = (entry = {}) => ({
  endorsement: null,
  interview: null,
  deliberation: null,
  release: null,
  ...entry,
  timeline: Array.isArray(entry.timeline) ? entry.timeline : [],
  attachedDocuments: Array.isArray(entry.attachedDocuments) ? entry.attachedDocuments : [],
});

// Older stored sessions predate the profile-attribute proof links and the
// attested values; default every document to empty ones so the vault and the
// verification helpers (src/lib/verification.js) can rely on the fields.
export const normalizeDocument = (entry = {}) => ({
  ...entry,
  linkedAttributes: Array.isArray(entry.linkedAttributes) ? entry.linkedAttributes : [],
  attestedValues: entry.attestedValues && typeof entry.attestedValues === 'object' && !Array.isArray(entry.attestedValues) ? entry.attestedValues : {},
});

// Only the user-owned, backend-independent slices are migrated from the legacy
// demo record. Everything that used to be seeded (applications, documents,
// notifications, announcements, and the demo user accounts) is discarded.
const migrateLegacyState = (legacy) => {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    return null;
  }

  const migrated = {};
  if (legacy.theme) migrated.theme = legacy.theme;
  if (legacy.notificationPreferences && typeof legacy.notificationPreferences === 'object') {
    migrated.notificationPreferences = legacy.notificationPreferences;
  }
  if (Array.isArray(legacy.customDeadlines)) migrated.customDeadlines = legacy.customDeadlines;

  return Object.keys(migrated).length ? migrated : null;
};

export const readStoredState = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) return JSON.parse(raw);

    const legacyRaw = window.localStorage.getItem(legacyStorageKey);
    if (!legacyRaw) return null;

    const migrated = migrateLegacyState(JSON.parse(legacyRaw));
    if (!migrated) return null;

    window.localStorage.setItem(storageKey, JSON.stringify(migrated));
    window.localStorage.removeItem(legacyStorageKey);
    return migrated;
  } catch {
    return null;
  }
};

const createDefaultState = () => ({
  // The Supabase auth id the persisted state belongs to. It guards the single
  // localStorage record against leaking one user's data (notifications,
  // reminders, applications, profile draft) to the next user on a shared
  // browser: a mismatch discards the session-scoped slices, and logout clears
  // them outright.
  ownerId: null,
  // Owner-scoped timestamps persist the absolute session lifetime across page
  // reloads. Activity mirrors live in sessionTimeout.js and are validated by id.
  sessionsStartedAt: null,
  lastSessionActivityAt: null,
  isAuthenticated: false,
  hasLoggedInBefore: false,
  studentSupportHintSeen: false,
  showFirstLoginWelcome: false,
  authUser: null,
  rememberMe: false,
  savedEmail: null,
  savedRole: 'student',
  viewerRole: 'student',
  activeView: 'dashboard',
  searchQuery: '',
  filters: {
    category: 'all',
    coverage: 'all',
    deadline: 'all',
    activeOnly: true,
  },
  profileDraft: {
    qpi: '',
    householdIncome: '',
    degreeProgram: '',
    hasActiveGovernmentGrant: false,
  },
  notificationPreferences: {
    smsEnabled: true,
    emailEnabled: true,
    inAppEnabled: true,
    deadlineReminders: {
      oneWeekBefore: true,
      threeDaysBefore: true,
      dayBefore: true,
    },
  },
  // Server-backed domains start empty. Supabase is required, so
  // loadSupabaseWorkspace fills these once a session is hydrated.
  applications: [],
  documents: [],
  students: {},
  notifications: [],
  announcements: [],
  // The internal endorsement thread. Staff-only rows; a student session always
  // keeps this empty.
  reviewComments: [],
  // The Admissions Office case-officer roster: which office accounts have opened
  // which application. Staff-only, so a student or Department Chair session always
  // keeps this empty. `caseOfficersReady` turns false when the roster migration is
  // not applied yet, so the workspace can say so.
  caseOfficers: [],
  caseOfficersReady: true,
  // SOP step 5 interview data (staff only): the visible staff accounts for the
  // panel picker, the Head-managed venues, the active panel members, and the
  // private evaluation notes. A student session always keeps these empty.
  staffDirectory: [],
  interviewLocations: [],
  interviewPanelists: [],
  interviewNotes: [],
  customDeadlines: [],
  // Office planning entries on the Admissions Office calendar. Staff-only, so a
  // student session always keeps this empty.
  officeCalendarEntries: [],
  // SOP step 7 routing (which ladder level approves for a school or cluster),
  // read by staff sessions only.
  approvalLevels: [],
  // The scholarship results the Head has released. A student's Approved or
  // Rejected result reads "Under deliberation" until a release covers it;
  // `resultsReleasesReady` is false while the release migration is pending, so
  // nothing is held that the project could not release.
  resultsReleases: [],
  resultsReleasesReady: false,
  profileSkipped: false,
  theme: 'light',
  academicPrograms,
});

export const createInitialState = () => {
  const stored = readStoredState();
  const defaults = createDefaultState();

  if (!stored) {
    return defaults;
  }

  // Session state key. `admissions_head` is the approval lane; the legacy
  // combined `admissions_office` value is the staff lane, so a saved session
  // keeps working after the split.
  const ROLE_KEYS = ['student', 'admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer'];
  const migrateRole = (role) => role === 'osa_admin' ? 'admissions_office' : role;
  const viewerRole = migrateRole(stored.viewerRole);
  const savedRole = migrateRole(stored.savedRole);
  // A retired or unknown view key would render an empty page, so the stored
  // value is validated against the routes the app can actually render.
  // The Endorsement route was retired at Consultation 2 (the Head now forwards a
  // verified case to interview), so a session saved on it lands on the office
  // Dashboard instead.
  const activeView = stored.activeView === 'eligibility'
    ? 'explore'
    : stored.activeView === 'admin-endorsement'
      ? 'admin'
    : (pageViewKeys.includes(stored.activeView) ? stored.activeView : defaults.activeView);
  const authUser = stored.authUser
    ? { ...stored.authUser, role: migrateRole(stored.authUser.role) }
    : defaults.authUser;

  return {
    ...defaults,
    ...stored,
    activeView,
    viewerRole: ROLE_KEYS.includes(viewerRole) ? viewerRole : defaults.viewerRole,
    theme: stored.theme ?? 'light',
    authUser,
    hasLoggedInBefore: stored.hasLoggedInBefore ?? defaults.hasLoggedInBefore,
    studentSupportHintSeen: stored.studentSupportHintSeen ?? defaults.studentSupportHintSeen,
    showFirstLoginWelcome: stored.showFirstLoginWelcome ?? defaults.showFirstLoginWelcome,
    rememberMe: stored.rememberMe ?? defaults.rememberMe,
    savedEmail: stored.savedEmail ?? defaults.savedEmail,
    savedRole: ROLE_KEYS.includes(savedRole) ? savedRole : defaults.savedRole,
    filters: {
      ...defaults.filters,
      ...(stored.filters ?? {}),
    },
    profileDraft: {
      ...defaults.profileDraft,
      ...(stored.profileDraft ?? {}),
    },
    notificationPreferences: {
      ...defaults.notificationPreferences,
      ...(stored.notificationPreferences ?? {}),
      deadlineReminders: {
        ...defaults.notificationPreferences.deadlineReminders,
        ...(stored.notificationPreferences?.deadlineReminders ?? {}),
      },
    },
    applications: Array.isArray(stored.applications) ? stored.applications.map(normalizeApplication) : defaults.applications,
    documents: Array.isArray(stored.documents) ? stored.documents.map(normalizeDocument) : defaults.documents,
    students: stored.students && typeof stored.students === 'object' && !Array.isArray(stored.students) ? stored.students : defaults.students,
    notifications: Array.isArray(stored.notifications) ? stored.notifications : defaults.notifications,
    announcements: Array.isArray(stored.announcements) ? stored.announcements : defaults.announcements,
    reviewComments: Array.isArray(stored.reviewComments) ? stored.reviewComments : defaults.reviewComments,
    caseOfficers: Array.isArray(stored.caseOfficers) ? stored.caseOfficers : defaults.caseOfficers,
    caseOfficersReady: stored.caseOfficersReady === false ? false : defaults.caseOfficersReady,
    staffDirectory: Array.isArray(stored.staffDirectory) ? stored.staffDirectory : defaults.staffDirectory,
    interviewLocations: Array.isArray(stored.interviewLocations) ? stored.interviewLocations : defaults.interviewLocations,
    interviewPanelists: Array.isArray(stored.interviewPanelists) ? stored.interviewPanelists : defaults.interviewPanelists,
    interviewNotes: Array.isArray(stored.interviewNotes) ? stored.interviewNotes : defaults.interviewNotes,
    customDeadlines: Array.isArray(stored.customDeadlines) ? stored.customDeadlines : defaults.customDeadlines,
    officeCalendarEntries: Array.isArray(stored.officeCalendarEntries) ? stored.officeCalendarEntries : defaults.officeCalendarEntries,
    approvalLevels: Array.isArray(stored.approvalLevels) ? stored.approvalLevels : defaults.approvalLevels,
    resultsReleases: Array.isArray(stored.resultsReleases) ? stored.resultsReleases : defaults.resultsReleases,
    resultsReleasesReady: stored.resultsReleasesReady === true,
    // A cached catalog written before the four-level hierarchy existed carries the
    // retired `College of …` school names and no department, so it is discarded
    // rather than used for the pre-load paint.
    academicPrograms: Array.isArray(stored.academicPrograms)
      && stored.academicPrograms.length
      && stored.academicPrograms.every(isHierarchyProgram)
      ? stored.academicPrograms
      : defaults.academicPrograms,
    profileSkipped: stored.profileSkipped ?? defaults.profileSkipped,
    ownerId: typeof stored.ownerId === 'string' && stored.ownerId ? stored.ownerId : defaults.ownerId,
    sessionsStartedAt: stored.sessionsStartedAt ?? null,
    lastSessionActivityAt: stored.lastSessionActivityAt ?? null,
  };
};

// The device-level preferences that are not tied to a signed-in user. They are
// the only slices kept across a sign-out so a shared browser does not carry the
// previous user's data (notifications, reminders, applications, profile draft)
// into the next session.
//
// Only non-identifying values belong here. The "remember me" email and role are
// the previous user's data, so they reset with the rest of the session instead
// of staying prefilled on a shared testing machine (RA 10173).
export const DEVICE_PREFERENCE_KEYS = ['theme', 'hasLoggedInBefore', 'studentSupportHintSeen'];

// A fresh state for sign-out: every session-scoped slice resets to its default
// (including `ownerId`), while the caller's device preferences carry over.
export const createFreshState = (devicePreferences = {}) => {
  const defaults = createDefaultState();
  const kept = {};
  DEVICE_PREFERENCE_KEYS.forEach((key) => {
    if (devicePreferences[key] !== undefined) kept[key] = devicePreferences[key];
  });
  return { ...defaults, ...kept, ownerId: null, sessionsStartedAt: null, lastSessionActivityAt: null };
};
