import { useEffect, useMemo, useState } from 'react';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { createInitialState, readStoredState, storageKey } from './lib/appState';
import { mergeNotifications } from './lib/notificationMerge';
import { evaluateApplicationGate, getAdduInternalPrograms, getDeadlineStatus, isInternalScholarship, rankScholarships, searchScholarships } from './lib/eligibility';
import { academicPrograms, getAcademicProgram } from './lib/academicPrograms';
import { getProfileDetails, getSupabaseSession, getUserProfile, resetPasswordForEmail, signInWithEmailPassword, signOutFromSupabase, signUpWithEmailPassword, updateAccountPassword, updateProfileFields, updateUserProfile } from './lib/auth';
import { ACCOUNT_FIELD_KEYS, PROFILE_DETAIL_KEYS, PROFILE_DRAFT_KEYS, STAFF_EDITABLE_FIELD_KEYS, deriveYearStanding, getDocumentTitle, getStandingRequirements, pickEligibilityAttributes, pickFields } from './lib/profile';
import { deriveAttributeVerifications } from './lib/verification';
import { DOCUMENT_MAX_BYTES } from './lib/documentStorage';
import { attachSupabaseApplicationDocument, createSupabaseAnnouncement, createSupabaseApplication, createSupabaseCustomDeadline, createSupabaseDocument, createSupabaseScholarship, deleteSupabaseCustomDeadline, deleteSupabaseDocument, detachSupabaseApplicationDocument, loadSupabaseAcademicPrograms, loadSupabaseWorkspace, markSupabaseNotificationRead, notifySupabaseApplicationStatus, sendSupabaseTestEmail, sendSupabaseTestSms, submitSupabaseApplication, updateSupabaseApplicationDraft, updateSupabaseApplicationStage, updateSupabaseApplicationStatus, updateSupabaseDocumentStatus, updateSupabaseNotificationPreferences, updateSupabaseScholarship, upsertSupabaseDepartmentReview } from './lib/supabaseData';
import { buildProfileSnapshot, getApplicationReadiness, getScholarshipRequirements, pickDefaultAttachments } from './lib/applicationRequirements';
import AcademicProfileModal from './components/AcademicProfileModal';
import { NotificationDropdown } from './components/pageParts';
import LoginScreenPage from './pages/LoginScreen';
import DashboardViewPage from './pages/DashboardView';
import ScholarshipExplorerPage from './pages/ScholarshipExplorer';
import ApplicationsViewPage from './pages/ApplicationsView';
import DocumentVaultViewPage from './pages/DocumentVaultView';
import AdminConsolePage from './pages/AdminConsole';
import DepartmentReviewViewPage from './pages/DepartmentReviewView';
import CalendarViewPage from './pages/CalendarView';
import SettingsViewPage from './pages/SettingsView';
import ProfileViewPage from './pages/ProfileView';
import logoImage from '../pictures/logo.png';

const roleLabels = {
  student: 'Student',
  admissions_office: 'Admissions Office Administrator',
  department_chair: 'Department Chair',
};

// The identity rows (sidebar panel and mobile header) should not repeat a staff
// member's name as its own role label, or echo a department whose words are
// already in the name. The central office's seeded name is literally
// "Admissions Office Administrator" and its department is "Office of
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

const normalizeRole = (role) => role === 'osa_admin' || role === 'admissions_office'
  ? 'admissions_office'
  : role === 'department_chair' ? 'department_chair' : 'student';

const landingViewForRole = (role) => normalizeRole(role) === 'admissions_office' ? 'admin' : normalizeRole(role) === 'department_chair' ? 'review' : 'dashboard';

const getInitials = (fullName = '') => fullName
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join('') || 'SP';

// A student profile is complete enough for matching once the core academic
// fields and the onboarding eligibility essentials are all recorded. `profile`
// uses the snake_case `profiles` shape; `attributes` is the eligibility mirror.
const isIncompleteStudentProfile = (profile, attributes = {}) => {
  const standing = getStandingRequirements(attributes);
  return (
    !profile?.degree_program
    || !standing.yearStanding
    || (standing.requiresStudentNumber && !profile?.student_number)
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

// Locally created deadlines live in localStorage while the same rows are also
// persisted to Supabase (so server-side reminders can email them). Merge by id
// so a hydrated session neither drops an unsynced local deadline nor duplicates
// one that already round-tripped through the database.
const mergeCustomDeadlines = (localDeadlines, serverDeadlines) => {
  const local = Array.isArray(localDeadlines) ? localDeadlines : [];
  const server = Array.isArray(serverDeadlines) ? serverDeadlines : [];
  const localIds = new Set(local.map((entry) => entry.id));
  return [...local, ...server.filter((entry) => !localIds.has(entry.id))];
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
  const [profileOnboarding, setProfileOnboarding] = useState(null);
  const [profileSaveError, setProfileSaveError] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSupabaseWorkspaceLoaded, setIsSupabaseWorkspaceLoaded] = useState(false);
  // When the My Profile "Attach proof" link opens the vault it carries the
  // profile attribute so the upload form opens on the accepted document types.
  const [vaultPresetAttribute, setVaultPresetAttribute] = useState('');
  // The My Profile section to open on, set when the Smart Eligibility Checker
  // links a failed reason to the section that edits it.
  const [profilePresetSection, setProfilePresetSection] = useState('');
  // The draft the application workspace opens on, set when a student starts an
  // application from the explorer or continues one from the dashboard.
  const [openApplicationId, setOpenApplicationId] = useState(null);

  const updateState = (updater) => setState((previous) => {
    const nextState = typeof updater === 'function' ? updater(previous) : updater;
    return {
      ...previous,
      ...nextState,
    };
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    // Apply theme class to document root so body background updates
    if (state.theme === 'light') {
      document.documentElement.classList.add('theme-light');
    } else {
      document.documentElement.classList.remove('theme-light');
    }
  }, [state.theme]);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsBooting(false), 250);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isBooting) {
      return undefined;
    }

    const syncDeadlineReminders = () => {
      setState((previous) => {
        if (!previous.notificationPreferences?.inAppEnabled || !previous.customDeadlines?.length) {
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

        previous.customDeadlines.forEach((deadline) => {
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
  }, [isBooting]);

  // The local deadline list is the source of truth for the calendar, but the
  // server-side reminder function can only email deadlines it can read from
  // `custom_deadlines`. Mirror the current list once the workspace is ready, and
  // again after every change, so a reminder created before the workspace finished
  // loading (or one whose first write failed) is still persisted and eligible for
  // email. The upsert is idempotent on the client-generated id.
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
      const result = await getSupabaseSession();
      if (!active || !result.session) {
        return;
      }

      const user = result.session.user;
      const profileResult = await getUserProfile(user.id);
      const profile = profileResult.profile;
      const profileDetails = await getProfileDetails(user.id);
      const userRole = normalizeRole(profile?.role || user.user_metadata?.role);
      updateState((previous) => ({
        ...previous,
        isAuthenticated: true,
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
        },
        profileDraft: {
          ...previous.profileDraft,
          ...profileDetails.eligibilityAttributes,
          ...profileDetails.profileDetails,
          ...(profile?.degree_program ? { degreeProgram: profile.degree_program } : {}),
        },
      }));
      const workspace = await loadSupabaseWorkspace({ role: userRole, userId: user.id, department: profile?.department || '' });
      if (active && workspace.success) {
        updateState((previous) => ({
          ...previous,
          ...workspace,
          // The Supabase workspace is authoritative for server-backed notifications,
          // but locally generated deadline reminders only exist in localStorage.
          // Merge instead of replacing so hydrated sessions cannot wipe them.
          notifications: mergeNotifications(previous.notifications, workspace.notifications),
          customDeadlines: mergeCustomDeadlines(previous.customDeadlines, workspace.customDeadlines),
        }));
        setIsSupabaseWorkspaceLoaded(true);
      }
      if (active) {
        const academicProgramsResult = await loadSupabaseAcademicPrograms();
        if (academicProgramsResult.success && academicProgramsResult.academicPrograms?.length) {
          updateState((previous) => ({ ...previous, academicPrograms: academicProgramsResult.academicPrograms }));
        }
      }
      if (userRole === 'student' && isIncompleteStudentProfile(profile, profileDetails.eligibilityAttributes)) {
        if (readStoredState()?.profileSkipped) return;
        const attributes = profileDetails.eligibilityAttributes || {};
        setProfileOnboarding({ id: user.id, fullName: profile?.full_name || user.user_metadata?.full_name || user.email || 'Signed in user', initialProgram: profile?.degree_program || '', initialProgramChoice2: attributes.programChoice2 || '', initialProgramChoice3: attributes.programChoice3 || '', initialStudentNumber: profile?.student_number || user.user_metadata?.student_id || '', initialYearStanding: deriveYearStanding(attributes), initialAcademicStanding: attributes.academicStanding || '', initialCitizenship: attributes.citizenship || '', initialPhone: profile?.phone || '', initialQpi: profile?.qpi ?? '', initialHsStrand: attributes.hsStrand || '', initialHsAverage: attributes.hsAverage ?? '', initialHouseholdIncome: profile?.household_income ?? '', initialHasActiveGovernmentGrant: profile?.has_active_government_grant ?? false });
      }
    };

    hydrateSession();

    return () => {
      active = false;
    };
  }, [isBooting]);

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
  };

  const currentProfile = {
    ...emptyAccount,
    ...(state.authUser || {}),
    role: normalizeRole(state.authUser?.role || state.viewerRole),
  };

  const themeClass = state.theme === 'light' ? 'theme-light' : '';
  const studentMatchProfile = { ...state.profileDraft, ...(state.authUser || {}) };
  const currentIdentity = state.viewerRole === 'student'
    ? { ...currentProfile, ...state.profileDraft, ...(state.authUser || {}) }
    : currentProfile;
  // De-duplicated identity lines (see identitySubtitle): the role only, and the
  // role plus department, with anything already covered by the name removed.
  const identityRoleLine = identitySubtitle(currentIdentity.fullName, roleLabels[state.viewerRole]);
  const identityDetailLine = identitySubtitle(currentIdentity.fullName, roleLabels[state.viewerRole], currentIdentity.department);
  const activeAcademicPrograms = state.academicPrograms?.length ? state.academicPrograms : academicPrograms;
  const activeAcademicProgramCategories = [...new Set(activeAcademicPrograms.map((program) => program.category))];
  const scholarshipCatalog = isSupabaseWorkspaceLoaded && state.scholarships?.length
    ? getAdduInternalPrograms(state.scholarships)
    : [];

  const eligibleScholarships = useMemo(() => rankScholarships(studentMatchProfile, scholarshipCatalog), [studentMatchProfile, scholarshipCatalog]);
  const filteredScholarships = useMemo(
    () => searchScholarships(scholarshipCatalog, state.searchQuery, state.filters),
    [scholarshipCatalog, state.searchQuery, state.filters],
  );

  const studentApplications = useMemo(
    () => state.applications.filter((entry) => entry.studentId === currentProfile.id),
    [state.applications, currentProfile.id],
  );

  const studentDocuments = useMemo(
    () => state.documents.filter((entry) => entry.ownerId === currentProfile.id),
    [state.documents, currentProfile.id],
  );
  // Each profile attribute's verification state is derived from the proof
  // documents the student linked in the vault (src/lib/verification.js).
  const attributeVerifications = useMemo(() => deriveAttributeVerifications(studentDocuments), [studentDocuments]);
  const visibleNotifications = state.notificationPreferences.inAppEnabled ? state.notifications : [];
  const unreadNotifications = useMemo(() => visibleNotifications.filter((entry) => entry.status === 'Unread'), [visibleNotifications]);
  const activeDeadlineCount = useMemo(
    () => scholarshipCatalog.filter((entry) => getDeadlineStatus(entry.deadline).tone !== 'danger').length,
    [scholarshipCatalog],
  );

  const stats = useMemo(() => ({
    totalPrograms: scholarshipCatalog.length,
    eligibleMatches: eligibleScholarships.length,
    openApplications: studentApplications.filter((entry) => entry.status !== 'Rejected' && entry.status !== 'Approved').length,
    unreadNotifications: unreadNotifications.length,
  }), [eligibleScholarships.length, scholarshipCatalog.length, studentApplications, unreadNotifications.length]);

  // Navigating to the vault clears any attribute preset; the My Profile
  // "Attach proof" link passes the attribute so the upload form opens on it.
  const navigate = (view, options = {}) => {
    setVaultPresetAttribute(view === 'vault' ? (options.attribute || '') : '');
    setProfilePresetSection(view === 'profile' ? (options.section || '') : '');
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
      const profileResult = authResult.user?.id ? await getUserProfile(authResult.user.id) : { profile: null };
      const profile = profileResult.profile;
      const profileDetails = authResult.user?.id ? await getProfileDetails(authResult.user.id) : { bio: '', eligibilityAttributes: {} };
      const resolvedRole = normalizeRole(profile?.role || authResult.user?.user_metadata?.role || selectedRole);
      const accountId = authResult.user?.id;
      const displayName = profile?.full_name || authResult.user?.user_metadata?.full_name || authResult.user?.email || '';
      updateState((previous) => ({
        ...previous,
        isAuthenticated: true,
        hasLoggedInBefore: true,
        showFirstLoginWelcome: !previous.hasLoggedInBefore,
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
        },
        rememberMe: credentials.rememberMe || false,
        savedEmail: credentials.rememberMe ? credentials.email : previous.savedEmail,
        savedRole: credentials.rememberMe ? resolvedRole : previous.savedRole,
        profileDraft: {
          ...previous.profileDraft,
          ...profileDetails.eligibilityAttributes,
          ...profileDetails.profileDetails,
          ...(profile?.degree_program ? { degreeProgram: profile.degree_program } : {}),
        },
      }));
      const workspace = await loadSupabaseWorkspace({ role: resolvedRole, userId: accountId, department: profile?.department || '' });
      if (workspace.success) {
        updateState((previous) => ({
          ...previous,
          ...workspace,
          notifications: mergeNotifications(previous.notifications, workspace.notifications),
          customDeadlines: mergeCustomDeadlines(previous.customDeadlines, workspace.customDeadlines),
        }));
        setIsSupabaseWorkspaceLoaded(true);
      }
      const academicProgramsResult = await loadSupabaseAcademicPrograms();
      if (academicProgramsResult.success && academicProgramsResult.academicPrograms?.length) {
        updateState((previous) => ({ ...previous, academicPrograms: academicProgramsResult.academicPrograms }));
      }
      if (authResult.user?.id && resolvedRole === 'student' && isIncompleteStudentProfile(profile, profileDetails.eligibilityAttributes) && !readStoredState()?.profileSkipped) {
        const attributes = profileDetails.eligibilityAttributes || {};
        setProfileOnboarding({ id: authResult.user.id, fullName: displayName, initialProgram: profile?.degree_program || '', initialProgramChoice2: attributes.programChoice2 || '', initialProgramChoice3: attributes.programChoice3 || '', initialStudentNumber: profile?.student_number || authResult.user?.user_metadata?.student_id || '', initialYearStanding: deriveYearStanding(attributes), initialAcademicStanding: attributes.academicStanding || '', initialCitizenship: attributes.citizenship || '', initialPhone: profile?.phone || '', initialQpi: profile?.qpi ?? '', initialHsStrand: attributes.hsStrand || '', initialHsAverage: attributes.hsAverage ?? '', initialHouseholdIncome: profile?.household_income ?? '', initialHasActiveGovernmentGrant: profile?.has_active_government_grant ?? false });
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
    await signOutFromSupabase();
    updateState((previous) => ({
      ...previous,
      isAuthenticated: false,
      showFirstLoginWelcome: false,
      authUser: null,
      viewerRole: 'student',
      activeView: 'dashboard',
    }));
    setProfileOnboarding(null);
    setIsSupabaseWorkspaceLoaded(false);
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
      phone,
      yearStanding,
      applicantType,
      yearLevel,
      academicStanding,
      citizenship,
      hsStrand,
      hsAverage,
      programChoice2,
      programChoice3,
    } = profileValues;
    // An incoming first-year ranks a 2nd and 3rd program choice; they are
    // eligibility attributes, so the local draft and the server mirror agree.
    const eligibilityAttributes = { yearStanding, applicantType, yearLevel, academicStanding, citizenship, hsStrand, hsAverage, programChoice2, programChoice3 };
    // Incoming first-years have no college QPI or AdDU student number yet, so
    // store nulls instead of empty strings.
    const resolvedQpi = qpi === '' || qpi == null ? null : qpi;
    const resolvedStudentNumber = studentNumber || null;

    const result = await updateUserProfile(profileOnboarding.id, {
      degreeProgram: program.value,
      department: program.department,
      studentNumber: resolvedStudentNumber,
      householdIncome,
      qpi: resolvedQpi,
      hasActiveGovernmentGrant,
      phone,
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
      authUser: { ...previous.authUser, department: program.department, degreeProgram: program.value, studentNumber: resolvedStudentNumber, householdIncome, qpi: resolvedQpi, hasActiveGovernmentGrant, phone },
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
    const isInternal = isInternalScholarship(scholarship);
    if (isInternal) {
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
    const attachedDocuments = isInternal ? pickDefaultAttachments(requirements, studentDocuments) : [];
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
      // The scholarship essay from My Profile is the starting statement.
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

  const setApplicationAttachments = (applicationId, update) => setState((previous) => ({
    ...previous,
    applications: previous.applications.map((entry) => entry.id === applicationId ? {
      ...entry,
      attachedDocuments: update(entry.attachedDocuments || []),
      updatedAt: new Date().toISOString().slice(0, 10),
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

  const saveApplicationDraft = async (applicationId, { statement }) => {
    if (!findOwnDraft(applicationId)) return { error: 'Only a draft application can be edited.' };
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
  const submitApplication = async (applicationId, { statement, certified } = {}) => {
    const draft = findOwnDraft(applicationId);
    if (!draft) return { error: 'Only a draft application can be submitted.' };
    const application = { ...draft, statement: statement ?? draft.statement };
    const scholarship = scholarshipCatalog.find((entry) => entry.id === application.scholarshipId);
    const readiness = getApplicationReadiness({ application, scholarship, documents: studentDocuments, profile: studentMatchProfile, certified });
    if (readiness.route !== 'internal') return { error: 'This program is tracked only. Apply through the provider.' };
    if (!readiness.ready) return { error: readiness.blockers[0], blockers: readiness.blockers };

    const submittedAt = new Date().toISOString();
    const submitEvent = {
      id: `ev-${crypto.randomUUID()}`,
      stage: 'Submitted',
      note: `Student certified and submitted the application with ${readiness.attachedCount} of ${readiness.requiredCount} required documents attached.`,
      actor: 'Student',
      at: submittedAt.slice(0, 10),
    };
    const profileSnapshot = buildProfileSnapshot(studentMatchProfile, attributeVerifications, submittedAt);
    const timeline = [...(application.timeline || []), submitEvent];
    const result = await submitSupabaseApplication(applicationId, {
      timeline,
      statement: application.statement,
      profileSnapshot,
      certifiedAt: submittedAt,
    });
    if (result?.error) return { error: result.error.message || 'The application could not be submitted.' };
    // Send the status alert only after the submission is persisted.
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

  const changeApplicationStatus = (applicationId, status, options = {}) => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application) return;
    if (state.viewerRole === 'department_chair') {
      const allowedChairTransition = status === 'Endorsed'
        ? application.status === 'For Verification'
        : status === 'For Verification' && ['Submitted', 'Under Review'].includes(application.status);
      if (!allowedChairTransition) return;
    } else if (state.viewerRole === 'admissions_office') {
      const allowedStatuses = {
        Submitted: ['Under Review', 'For Verification', 'Rejected'],
        'Under Review': ['For Verification', 'Rejected'],
        'For Verification': ['Rejected'],
        Endorsed: ['Rejected'],
        Interview: ['Rejected'],
        Recommended: ['Approved', 'Rejected'],
        Approved: ['Released'],
      };
      if (!allowedStatuses[application.status]?.includes(status)) return;
    }
    const actor = state.viewerRole === 'department_chair' ? 'Department Chair' : 'Admissions Office';
    const stageEvent = {
      id: `ev-${crypto.randomUUID()}`,
      stage: status,
      note: options?.note || `Application moved to ${status}.`,
      actor,
      at: new Date().toISOString().slice(0, 10),
    };
    const { note: _note, ...stageFields } = options || {};
    if (isSupabaseWorkspaceLoaded) {
      // Chain rather than fire-and-forget so the Edge Function reads the new
      // status after its status, SOP payload, and timeline are persisted.
      Promise.resolve(updateSupabaseApplicationStatus(
        applicationId,
        status,
        [...(application.timeline || []), stageEvent],
        stageFields,
      )).then((result) => {
        if (!result?.error) return notifySupabaseApplicationStatus(applicationId);
        return undefined;
      }).catch(() => undefined);
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
  };

  // A Department Chair flags submitted applications for central validation by
  // moving them to For Verification and recording the reason in the timeline.
  const flagApplicationForValidation = (applicationId) => {
    changeApplicationStatus(applicationId, 'For Verification', {
      note: 'Flagged for central document validation.',
    });
  };

  // SOP step 4 — the Department Chair endorses qualified applications to the
  // next stage (interview and other evaluation).
  const endorseApplication = (applicationId, note = '') => {
    if (state.viewerRole !== 'department_chair') return;
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application || application.status !== 'For Verification') return;
    const record = {
      reviewedBy: currentProfile.fullName || 'Department Chair',
      decision: 'Endorsed',
      note: note || 'Endorsed based on academic standing and verified documents.',
      decidedAt: new Date().toISOString().slice(0, 10),
    };
    if (isSupabaseWorkspaceLoaded) {
      upsertSupabaseDepartmentReview({
        applicationId,
        reviewerId: currentProfile.id,
        studentName: application.studentName,
        department: currentProfile.department,
        qpi: application.studentQpi,
        householdIncome: application.studentHouseholdIncome,
        status: 'Endorsed',
        recommendation: record.note,
      });
    }
    changeApplicationStatus(applicationId, 'Endorsed', {
      note: record.note,
      endorsement: record,
    });
  };

  // SOP step 5 — interview scheduling; the interviewing panel comes from the
  // school where the applicant's program belongs.
  const scheduleInterview = (applicationId, { scheduledAt, panel, note = '' } = {}) => {
    if (state.viewerRole !== 'admissions_office') return;
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application || application.status !== 'Endorsed') return;
    const record = {
      scheduledAt: scheduledAt || null,
      panel: panel || `${application.studentDepartment || 'Department'} Scholarship Panel`,
      school: application.studentDepartment || 'Applicant school',
      note,
      outcome: null,
    };
    changeApplicationStatus(applicationId, 'Interview', {
      note: `Interview scheduled for ${record.scheduledAt || 'an upcoming date'} with the ${record.panel}.`,
      interview: record,
    });
  };

  // SOP step 6 — evaluation and deliberation by the School Scholarship
  // Sub-committee, producing a recommendation.
  const recordDeliberation = (applicationId, decision, note = '') => {
    if (state.viewerRole !== 'admissions_office') return;
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application || application.status !== 'Interview') return;
    const nextStatus = decision === 'Approved' ? 'Approved' : decision === 'Rejected' ? 'Rejected' : 'Recommended';
    const record = {
      decidedBy: 'School Scholarship Sub-committee',
      decision: nextStatus === 'Recommended' ? 'Recommended' : nextStatus,
      note,
      decidedAt: new Date().toISOString().slice(0, 10),
    };
    changeApplicationStatus(applicationId, nextStatus, {
      note: note || `Sub-committee deliberation recorded as ${nextStatus}.`,
      deliberation: record,
    });
  };

  // SOP steps 7 and 8 — the scholarship committee approves and the result is
  // released to the applicant through the Admissions Office.
  const releaseApplicationResults = (applicationId) => {
    if (state.viewerRole !== 'admissions_office') return;
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application || application.status !== 'Approved') return;
    const record = {
      releasedTo: 'Admissions Office',
      releasedAt: new Date().toISOString().slice(0, 10),
      reference: `OAA-${applicationId.slice(0, 8).toUpperCase()}`,
    };
    const stageEvent = {
      id: `ev-${crypto.randomUUID()}`,
      stage: 'Released',
      note: `Result released to the applicant through the Admissions Office (${record.reference}).`,
      actor: 'Admissions Office',
      at: new Date().toISOString().slice(0, 10),
    };
    if (isSupabaseWorkspaceLoaded) {
      Promise.resolve(updateSupabaseApplicationStage(applicationId, 'Released', {
        release: record,
        timeline: [...(application.timeline || []), stageEvent],
      })).then((result) => {
        if (!result?.error) return notifySupabaseApplicationStatus(applicationId);
        return undefined;
      }).catch(() => undefined);
    }
    setState((previous) => ({
      ...previous,
      applications: previous.applications.map((entry) => entry.id === applicationId ? {
        ...entry,
        status: 'Released',
        release: record,
        updatedAt: new Date().toISOString().slice(0, 10),
        timeline: [...(entry.timeline || []), stageEvent],
      } : entry),
    }));
  };

  // The Admissions Office verifies or rejects a vault document here. Because an
  // attribute's state is derived from its linked proof documents
  // (src/lib/verification.js), verifying the file also verifies the attributes it
  // proves. A verified or rejected decision notifies the owner, deduped by a
  // stable source key.
  const changeDocumentStatus = (documentId, verificationStatus) => {
    const document = state.documents.find((entry) => entry.id === documentId);
    if (isSupabaseWorkspaceLoaded) updateSupabaseDocumentStatus(documentId, verificationStatus);
    setState((previous) => ({
      ...previous,
      documents: previous.documents.map((entry) => entry.id === documentId ? {
        ...entry,
        verificationStatus,
      } : entry),
      notifications: document && ['Verified', 'Rejected'].includes(verificationStatus)
        ? prependInAppNotification(previous, {
            id: `not-${crypto.randomUUID()}`,
            sourceKey: `document-verification-${documentId}-${verificationStatus}`,
            title: verificationStatus === 'Verified' ? `${document.title} verified` : `${document.title} needs attention`,
            channel: 'In-app',
            body: verificationStatus === 'Verified'
              ? `The Admissions Office verified “${document.title}”. Any profile attributes it proves are now verified.`
              : `The Admissions Office could not verify “${document.title}”. Upload a replacement to complete verification.`,
            status: 'Unread',
            createdAt: new Date().toISOString().slice(0, 10),
          })
        : previous.notifications,
    }));
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
    // document type, so there is no free-text title. A blank attribute means a
    // general application document with no profile-attribute link.
    const attributeKey = String(rawAttributeKey || '').trim();
    const linkedAttributes = attributeKey ? [attributeKey] : [];
    // A real uuid so the row, the storage path, and application_documents links
    // all share the same identifier.
    const id = crypto.randomUUID();
    const uploadedAt = new Date().toISOString().slice(0, 10);
    const baseTitle = getDocumentTitle({ attributeKey, documentType });
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
      sharedWith: [],
      uploadedAt,
      storagePath: null,
    };
    let result;
    try {
      result = await createSupabaseDocument({ id, ownerId: currentProfile.id, title, fileName, documentType, linkedAttributes, file });
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

  const addDocument = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const result = await uploadVaultDocument({
      file: formData.get('documentFile'),
      documentType: formData.get('documentType'),
      attributeKey: formData.get('documentAttribute'),
    });
    if (result.error) return result;
    form.reset();
    return { ok: true };
  };

  const addAnnouncement = (event) => {
    event.preventDefault();
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

  const saveScholarship = async (scholarship) => {
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

  const addCustomDeadline = (title, deadline) => {
    const deadlineDate = new Date(deadline);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (!title.trim() || Number.isNaN(deadlineDate.getTime()) || deadlineDate < startOfToday) {
      return;
    }

    const newDeadline = {
      id: `custom-${crypto.randomUUID()}`,
      title,
      deadline: deadline,
      createdAt: new Date().toISOString().slice(0, 10),
    };

    if (isSupabaseWorkspaceLoaded && currentProfile.id) {
      // Persisting the deadline lets the scheduled reminder function email the
      // same 7-day / 3-day / 1-day reminders the client generates locally. A
      // failure is logged and retried by the reconciliation effect below.
      persistCustomDeadline(newDeadline, currentProfile.id);
    }

    setState((previous) => {
      const updatedState = {
        ...previous,
        customDeadlines: [newDeadline, ...previous.customDeadlines],
      };

      return updatedState;
    });
  };

  const deleteCustomDeadline = (deadlineId) => {
    if (isSupabaseWorkspaceLoaded) deleteSupabaseCustomDeadline(deadlineId);
    setState((previous) => ({
      ...previous,
      customDeadlines: previous.customDeadlines.filter((d) => d.id !== deadlineId),
    }));
  };

  // Saves one My Profile section. Students may edit academic and eligibility
  // fields; staff may edit only their name, mobile number, and bio, so a
  // Department Chair can never re-scope their own department from this page.
  const saveProfile = async (patch) => {
    const isStudent = state.viewerRole === 'student';
    const accountFields = pickFields(patch, isStudent ? ACCOUNT_FIELD_KEYS : STAFF_EDITABLE_FIELD_KEYS);
    if (isStudent && accountFields.degreeProgram) {
      const selectedProgram = activeAcademicPrograms.find((program) => program.value === accountFields.degreeProgram) || getAcademicProgram(accountFields.degreeProgram);
      accountFields.department = selectedProgram.department;
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
      ...(hasProfileDetails ? { profileDetails } : {}),
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

  const changeAccountPassword = (password) => updateAccountPassword({ password });
  const requestOwnPasswordReset = () => requestPasswordReset({ email: currentIdentity.email || '' });

  const eligiblePreview = eligibleScholarships.slice(0, 6);
  // Department queue is derived from applications joined to the student's
  // school-level department, so it stays consistent with profiles.department
  // from the academic program taxonomy rather than a separately seeded table.
  const departmentQueue = state.applications.filter((entry) => (
    (entry.studentDepartment || '') === currentProfile.department
    && entry.status !== 'Draft'
  ));
  const studentStanding = getStandingRequirements(studentMatchProfile);
  const hasIncompleteStudentProfile = state.viewerRole === 'student' && (
    !currentIdentity.degreeProgram
    || !studentStanding.yearStanding
    || (studentStanding.requiresStudentNumber && !currentIdentity.studentNumber)
    || currentIdentity.householdIncome == null
    || currentIdentity.householdIncome === ''
    // An incoming first-year is matched on senior high school standing, not QPI.
    || (studentStanding.requiresQpi && (currentIdentity.qpi == null || currentIdentity.qpi === ''))
    || !studentMatchProfile.academicStanding
    || !studentMatchProfile.citizenship
  );

  const navigationItems = [
    { view: 'dashboard', label: 'Dashboard', visible: true },
    { view: 'explore', label: 'Scholarships', visible: state.viewerRole === 'student' },
    { view: 'applications', label: 'Applications', visible: state.viewerRole === 'student' },
    { view: 'vault', label: 'Document Vault', visible: state.viewerRole === 'student' },
    { view: 'calendar', label: 'Calendar', visible: state.viewerRole === 'student' },
    { view: 'admin', label: 'Admissions Office', visible: state.viewerRole === 'admissions_office' },
    { view: 'review', label: 'Department Review', visible: state.viewerRole === 'department_chair' },
    { view: 'profile', label: 'My Profile', visible: true },
    { view: 'settings', label: 'Settings', visible: true },
  ].filter((item) => item.visible);

  const renderNavigation = (className = '') => (
    <nav className={`grid gap-2 ${className}`} aria-label="Page navigation">
      {navigationItems.map((item) => (
        <button
          key={item.view}
          type="button"
          className={`min-h-11 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition hover:-translate-y-px hover:bg-app-surface focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${state.activeView === item.view ? 'bg-gradient-to-br from-blue-500/95 to-sky-400/70 text-white shadow-sm' : 'bg-app-surface text-app-text'}`}
          onClick={() => navigate(item.view)}
          aria-current={state.activeView === item.view ? 'page' : undefined}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );

  if (isBooting) {
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
      />
    );
  }

  return (
    <div className={`min-h-screen max-w-[100vw] overflow-x-hidden bg-app-bg p-3 text-app-text sm:p-5 ${themeClass}`}>
      {profileOnboarding && (
        <AcademicProfileModal
          fullName={profileOnboarding.fullName}
          initialProgram={profileOnboarding.initialProgram}
          initialProgramChoice2={profileOnboarding.initialProgramChoice2}
          initialProgramChoice3={profileOnboarding.initialProgramChoice3}
          initialStudentNumber={profileOnboarding.initialStudentNumber}
          initialYearStanding={profileOnboarding.initialYearStanding}
          initialAcademicStanding={profileOnboarding.initialAcademicStanding}
          initialCitizenship={profileOnboarding.initialCitizenship}
          initialHsStrand={profileOnboarding.initialHsStrand}
          initialHsAverage={profileOnboarding.initialHsAverage}
          initialPhone={profileOnboarding.initialPhone}
          initialHouseholdIncome={profileOnboarding.initialHouseholdIncome}
          initialQpi={profileOnboarding.initialQpi}
          initialHasActiveGovernmentGrant={profileOnboarding.initialHasActiveGovernmentGrant}
          academicPrograms={activeAcademicPrograms}
          academicProgramCategories={activeAcademicProgramCategories}
          attributeVerifications={attributeVerifications}
          onSave={saveAcademicProfile}
          isSaving={isSavingProfile}
          errorMessage={profileSaveError}
        />
      )}
      <header className="app-header mb-5 flex min-w-0 items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="inline-flex max-w-full items-center gap-2">
            <img src={logoImage} alt="Ateneo de Davao University logo" className="h-11 w-11 shrink-0 rounded-full border border-white/20 bg-white/10 object-contain p-0.5 sm:h-14 sm:w-14" />
            <div className="truncate text-lg font-extrabold tracking-wide sm:text-xl">ScholarPath AdDU</div>
          </div>
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-end gap-2 sm:gap-3">
          {state.authUser && (
            <button
              type="button"
              className="mr-1 inline-flex min-h-11 min-w-0 items-center gap-2 rounded-full focus:outline-none focus:ring-4 focus:ring-blue-500/20 sm:hidden"
              title={`${state.authUser.fullName} · ${roleLabels[state.viewerRole]}`}
              aria-label="Open My Profile"
              onClick={() => navigate('profile')}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-ateneo to-sky-400 text-xs font-extrabold text-white" aria-hidden="true">{getInitials(state.authUser.fullName)}</span>
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
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-app-border bg-app-surface text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 lg:hidden"
            onClick={() => setIsMobileNavOpen((open) => !open)}
            aria-label={isMobileNavOpen ? 'Close page navigation' : 'Open page navigation'}
            aria-expanded={isMobileNavOpen}
          >
            {isMobileNavOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          </button>
          <button className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-app-border bg-app-surface px-3 py-2 text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20" onClick={logout} aria-label="Logout" title="Logout">
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
        <aside className="sticky top-5 hidden h-fit rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur lg:block">
          <div className="flex items-center gap-4 border-b border-app-border pb-4">
            <div className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-[18px] bg-gradient-to-br from-blue-500/90 to-sky-500/50 text-lg font-extrabold text-white">{currentIdentity.fullName.slice(0, 1)}</div>
            <div className="min-w-0">
              <h2 className="m-0 text-base font-semibold text-app-text">{currentIdentity.fullName}</h2>
              {identityDetailLine && <p className="mt-1 text-sm text-app-muted">{identityDetailLine}</p>}
            </div>
          </div>

          {renderNavigation('my-4')}

          <div className="mt-4 grid gap-2">
            <div className="flex items-center justify-between gap-3 rounded-[18px] bg-app-surface p-3">
              <span className="text-xs text-app-muted">Programs</span>
              <strong className="text-lg text-app-text">{stats.totalPrograms}</strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[18px] bg-app-surface p-3">
              <span className="text-xs text-app-muted">Open deadlines</span>
              <strong className="text-lg text-app-text">{activeDeadlineCount}</strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[18px] bg-app-surface p-3">
              <span className="text-xs text-app-muted">Unread alerts</span>
              <strong className="text-lg text-app-text">{stats.unreadNotifications}</strong>
            </div>
          </div>
        </aside>

        <section className="blue-action-view grid min-w-0 gap-5">
          {state.activeView === 'dashboard' && (
            <DashboardViewPage
              profile={currentIdentity}
              isFirstLogin={state.showFirstLoginWelcome}
              stats={stats}
              applications={studentApplications}
              scholarships={scholarshipCatalog}
              customDeadlines={state.customDeadlines}
              eligibleScholarships={eligiblePreview}
              notifications={visibleNotifications}
              announcements={state.announcements}
              onOpenExplorer={() => navigate('explore')}
              onOpenEligibility={() => navigate('explore')}
              onTrackScholarship={applyToScholarship}
              onMarkRead={markNotificationRead}
              onShowApplications={() => navigate('applications')}
              onContinueApplication={(applicationId) => navigate('applications', { applicationId })}
              onOpenCalendar={() => navigate('calendar')}
              onOpenAdmin={() => navigate('admin')}
              onOpenReview={() => navigate('review')}
              hasIncompleteProfile={hasIncompleteStudentProfile}
              onCompleteProfile={() => navigate('profile')}
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
              onOpenProfileSection={(section) => navigate('profile', { section })}
            />
          )}

          {state.activeView === 'applications' && (
            <ApplicationsViewPage
              applications={studentApplications}
              documents={studentDocuments}
              scholarships={state.scholarships || []}
              profile={studentMatchProfile}
              attributeVerifications={attributeVerifications}
              openApplicationId={openApplicationId}
              onOpenApplication={setOpenApplicationId}
              onAttach={attachDocumentToApplication}
              onDetach={detachDocumentFromApplication}
              onUploadAndAttach={uploadAndAttachDocument}
              onSaveDraft={saveApplicationDraft}
              onSubmit={submitApplication}
              onOpenProfile={() => navigate('profile')}
            />
          )}

          {state.activeView === 'vault' && state.viewerRole === 'student' && (
            <DocumentVaultViewPage
              documents={studentDocuments}
              applications={studentApplications}
              onUpload={addDocument}
              onDelete={deleteDocument}
              presetAttribute={vaultPresetAttribute}
            />
          )}

          {state.activeView === 'admin' && state.viewerRole === 'admissions_office' && (
            <AdminConsolePage
              applications={state.applications}
              students={state.students}
              documents={state.documents}
              scholarships={state.scholarships || []}
              announcements={state.announcements}
              onChangeApplication={changeApplicationStatus}
              onEndorseApplication={endorseApplication}
              onScheduleInterview={scheduleInterview}
              onRecordDeliberation={recordDeliberation}
              onReleaseResults={releaseApplicationResults}
              onChangeDocument={changeDocumentStatus}
              onCreateAnnouncement={addAnnouncement}
              onSaveScholarship={saveScholarship}
            />
          )}

          {state.activeView === 'review' && state.viewerRole === 'department_chair' && (
            <DepartmentReviewViewPage
              profile={currentProfile}
              queue={departmentQueue}
              documents={state.documents}
              scholarships={state.scholarships || []}
              onChangeApplication={changeApplicationStatus}
              onEndorseApplication={endorseApplication}
              onFlagForValidation={flagApplicationForValidation}
            />
          )}

          {state.activeView === 'profile' && (
            <ProfileViewPage
              profile={currentIdentity}
              role={state.viewerRole}
              roleLabel={roleLabels[state.viewerRole]}
              academicPrograms={activeAcademicPrograms}
              academicProgramCategories={activeAcademicProgramCategories}
              initialSection={profilePresetSection}
              onSaveProfile={saveProfile}
              onChangePassword={changeAccountPassword}
              onRequestPasswordReset={requestOwnPasswordReset}
              attributeVerifications={attributeVerifications}
              onAttachProof={(attributeKey) => navigate('vault', { attribute: attributeKey })}
            />
          )}

          {state.activeView === 'settings' && (
            <SettingsViewPage
              notificationPreferences={state.notificationPreferences}
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
              onAddCustomDeadline={addCustomDeadline}
              onDeleteCustomDeadline={deleteCustomDeadline}
            />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
