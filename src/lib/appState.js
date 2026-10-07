import { academicPrograms } from './academicPrograms';

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

// Older stored sessions predate the profile-attribute proof links; default
// every document to an empty list so the vault and the verification helpers
// (src/lib/verification.js) can rely on the field existing.
export const normalizeDocument = (entry = {}) => ({
  ...entry,
  linkedAttributes: Array.isArray(entry.linkedAttributes) ? entry.linkedAttributes : [],
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
  isAuthenticated: false,
  hasLoggedInBefore: false,
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
  notifications: [],
  announcements: [],
  customDeadlines: [],
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

  const migrateRole = (role) => role === 'osa_admin' ? 'admissions_office' : role;
  const viewerRole = migrateRole(stored.viewerRole);
  const savedRole = migrateRole(stored.savedRole);
  const activeView = stored.activeView === 'eligibility' ? 'explore' : (stored.activeView ?? defaults.activeView);
  const authUser = stored.authUser
    ? { ...stored.authUser, role: migrateRole(stored.authUser.role) }
    : defaults.authUser;

  return {
    ...defaults,
    ...stored,
    activeView,
    viewerRole: ['student', 'admissions_office', 'department_chair'].includes(viewerRole) ? viewerRole : defaults.viewerRole,
    theme: stored.theme ?? 'light',
    authUser,
    hasLoggedInBefore: stored.hasLoggedInBefore ?? defaults.hasLoggedInBefore,
    showFirstLoginWelcome: stored.showFirstLoginWelcome ?? defaults.showFirstLoginWelcome,
    rememberMe: stored.rememberMe ?? defaults.rememberMe,
    savedEmail: stored.savedEmail ?? defaults.savedEmail,
    savedRole: ['student', 'admissions_office', 'department_chair'].includes(savedRole) ? savedRole : defaults.savedRole,
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
    notifications: Array.isArray(stored.notifications) ? stored.notifications : defaults.notifications,
    announcements: Array.isArray(stored.announcements) ? stored.announcements : defaults.announcements,
    customDeadlines: Array.isArray(stored.customDeadlines) ? stored.customDeadlines : defaults.customDeadlines,
    academicPrograms: Array.isArray(stored.academicPrograms) && stored.academicPrograms.length ? stored.academicPrograms : defaults.academicPrograms,
    profileSkipped: stored.profileSkipped ?? defaults.profileSkipped,
  };
};
