import { useEffect, useMemo, useState } from 'react';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { createInitialState, demoUsers, readStoredState, storageKey } from './lib/demoState';
import { mergeNotifications } from './lib/notificationMerge';
import { evaluateApplicationGate, getAdduInternalPrograms, getDeadlineStatus, isInternalScholarship, rankScholarships, searchScholarships } from './lib/eligibility';
import { academicPrograms, getAcademicProgram } from './lib/academicPrograms';
import { getProfileDetails, getSupabaseSession, getUserProfile, resetPasswordForEmail, signInWithEmailPassword, signOutFromSupabase, signUpWithEmailPassword, updateAccountPassword, updateProfileFields, updateUserProfile } from './lib/auth';
import { hasSupabaseConfig } from './lib/supabaseClient';
import { ACCOUNT_FIELD_KEYS, PROFILE_DRAFT_KEYS, STAFF_EDITABLE_FIELD_KEYS, deriveYearStanding, getStandingRequirements, pickEligibilityAttributes, pickFields } from './lib/profile';
import { createSupabaseAnnouncement, createSupabaseApplication, createSupabaseCustomDeadline, createSupabaseDocument, deleteSupabaseCustomDeadline, deleteSupabaseDocument, loadSupabaseAcademicPrograms, loadSupabaseWorkspace, markSupabaseNotificationRead, notifySupabaseApplicationStatus, sendSupabaseTestEmail, sendSupabaseTestSms, submitSupabaseApplication, updateSupabaseApplicationStage, updateSupabaseApplicationStatus, updateSupabaseDocumentStatus, updateSupabaseNotificationPreferences, upsertSupabaseDepartmentReview } from './lib/supabaseData';
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

const prependInAppNotification = (previous, notification) => (
  previous.notificationPreferences?.inAppEnabled
    ? [notification, ...previous.notifications]
    : previous.notifications
);

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
        setProfileOnboarding({ id: user.id, fullName: profile?.full_name || user.user_metadata?.full_name || user.email || 'Signed in user', initialProgram: profile?.degree_program || '', initialStudentNumber: profile?.student_number || user.user_metadata?.student_id || '', initialYearStanding: deriveYearStanding(attributes), initialAcademicStanding: attributes.academicStanding || '', initialCitizenship: attributes.citizenship || '', initialPhone: profile?.phone || '', initialQpi: profile?.qpi ?? '', initialHsStrand: attributes.hsStrand || '', initialHsAverage: attributes.hsAverage ?? '', initialHouseholdIncome: profile?.household_income ?? '', initialHasActiveGovernmentGrant: profile?.has_active_government_grant ?? false });
      }
    };

    hydrateSession();

    return () => {
      active = false;
    };
  }, [isBooting]);

  const roleKeyMap = {
    student: 'student',
    admissions_office: 'admin',
    department_chair: 'chair',
  };

  const resolveAccount = (roleValue) => {
    const normalizedRole = normalizeRole(roleValue);
    return normalizedRole === 'admissions_office'
      ? demoUsers.admin
      : normalizedRole === 'department_chair'
        ? demoUsers.chair
        : demoUsers.student;
  };

  const currentProfile = {
    ...demoUsers[roleKeyMap[state.viewerRole] || 'student'],
    ...(state.authUser || {}),
    role: normalizeRole(state.authUser?.role || state.viewerRole),
  };

  const themeClass = state.theme === 'light' ? 'theme-light' : '';
  const studentMatchProfile = { ...demoUsers.student, ...state.profileDraft, ...(state.authUser || {}) };
  const currentIdentity = state.viewerRole === 'student'
    ? { ...currentProfile, ...state.profileDraft, ...(state.authUser || {}) }
    : currentProfile;
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

  const navigate = (view) => {
    updateState({ activeView: view });
    setIsMobileNavOpen(false);
  };

  const login = async (credentials) => {
    const selectedRole = credentials.role || 'student';
    const authResult = await signInWithEmailPassword({
      email: credentials.email,
      password: credentials.password,
    });

    if (authResult.success || authResult.fallback) {
      const profileResult = authResult.user?.id ? await getUserProfile(authResult.user.id) : { profile: null };
      const profile = profileResult.profile;
      const profileDetails = authResult.user?.id ? await getProfileDetails(authResult.user.id) : { bio: '', eligibilityAttributes: {} };
      const resolvedRole = normalizeRole(profile?.role || authResult.user?.user_metadata?.role || selectedRole);
      const account = resolveAccount(resolvedRole);
      const accountId = authResult.user?.id || account.id;
      updateState((previous) => ({
        ...previous,
        isAuthenticated: true,
        hasLoggedInBefore: true,
        showFirstLoginWelcome: !previous.hasLoggedInBefore,
        viewerRole: account.role,
        activeView: landingViewForRole(account.role),
        authUser: {
          id: accountId,
          email: credentials.email,
          role: account.role,
          fullName: profile?.full_name || authResult.user?.user_metadata?.full_name || account.fullName,
          department: profile?.department || account.department,
          degreeProgram: profile?.degree_program || '',
          studentNumber: profile?.student_number || authResult.user?.user_metadata?.student_id || '',
          qpi: profile?.qpi ?? '',
          householdIncome: profile?.household_income ?? '',
          ...(profile ? {
            phone: profile.phone || '',
            hasActiveGovernmentGrant: profile.has_active_government_grant ?? false,
            bio: profileDetails.bio,
          } : {}),
          // Demo accounts have no server profile, so restore their My Profile edits.
          ...(authResult.fallback ? previous.profileEdits?.[accountId] : {}),
        },
        rememberMe: credentials.rememberMe || false,
        savedEmail: credentials.rememberMe ? credentials.email : previous.savedEmail,
        savedRole: credentials.rememberMe ? account.role : previous.savedRole,
        profileDraft: {
          ...previous.profileDraft,
          ...profileDetails.eligibilityAttributes,
          ...(profile?.degree_program ? { degreeProgram: profile.degree_program } : {}),
        },
      }));
      const workspace = await loadSupabaseWorkspace({ role: account.role, userId: authResult.user?.id || account.id, department: profile?.department || account.department });
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
      if (authResult.user?.id && account.role === 'student' && isIncompleteStudentProfile(profile, profileDetails.eligibilityAttributes) && !readStoredState()?.profileSkipped) {
        const attributes = profileDetails.eligibilityAttributes || {};
        setProfileOnboarding({ id: authResult.user.id, fullName: profile?.full_name || authResult.user?.user_metadata?.full_name || account.fullName, initialProgram: profile?.degree_program || '', initialStudentNumber: profile?.student_number || authResult.user?.user_metadata?.student_id || '', initialYearStanding: deriveYearStanding(attributes), initialAcademicStanding: attributes.academicStanding || '', initialCitizenship: attributes.citizenship || '', initialPhone: profile?.phone || '', initialQpi: profile?.qpi ?? '', initialHsStrand: attributes.hsStrand || '', initialHsAverage: attributes.hsAverage ?? '', initialHouseholdIncome: profile?.household_income ?? '', initialHasActiveGovernmentGrant: profile?.has_active_government_grant ?? false });
      }

      return {
        success: true,
        fallback: authResult.fallback,
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
    } = profileValues;
    const eligibilityAttributes = { yearStanding, applicantType, yearLevel, academicStanding, citizenship, hsStrand, hsAverage };
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

  const applyToScholarship = (scholarship, qualificationProfile = studentMatchProfile) => {
    if (isInternalScholarship(scholarship)) {
      const gateResult = evaluateApplicationGate(qualificationProfile, scholarship);
      if (!gateResult.allowed) return gateResult;
    }

    const alreadyExists = state.applications.some((entry) => entry.scholarshipId === scholarship.id && entry.studentId === currentProfile.id);
    if (alreadyExists) return { allowed: false, reasons: ['You already have an application for this scholarship.'] };

    const eligibleDocs = studentDocuments.filter((doc) => doc.verificationStatus === 'Verified').map((doc) => doc.id);
    const nextApplication = {
      id: `app-${crypto.randomUUID()}`,
      studentId: currentProfile.id,
      scholarshipId: scholarship.id,
      scholarshipTitle: scholarship.title,
      status: 'Draft',
      documentStatus: eligibleDocs.length ? 'Verified' : 'Pending',
      submittedAt: null,
      updatedAt: new Date().toISOString().slice(0, 10),
      attachedDocuments: eligibleDocs,
      notes: 'Created from the scholarship explorer.',
    };

    if (isSupabaseWorkspaceLoaded) createSupabaseApplication({
      studentId: currentProfile.id,
      scholarshipId: scholarship.id,
      documentStatus: nextApplication.documentStatus,
      attachedDocuments: eligibleDocs,
      notes: nextApplication.notes,
    });

    setState((previous) => ({
      ...previous,
      applications: [nextApplication, ...previous.applications],
      notifications: prependInAppNotification(previous, {
        id: `not-${crypto.randomUUID()}`,
        title: `${scholarship.title} added to your tracker`,
        channel: 'In-app',
        body: `A new draft application was created and linked to your document vault.`,
        status: 'Unread',
        createdAt: new Date().toISOString().slice(0, 10),
      }),
      activeView: 'applications',
    }));
    return { allowed: true, reasons: [] };
  };

  const submitApplication = (applicationId) => {
    if (isSupabaseWorkspaceLoaded) {
      // Wait for the status write to land before emailing, so the Edge Function
      // reads the submitted status rather than the previous one.
      Promise.resolve(submitSupabaseApplication(applicationId))
        .then(() => notifySupabaseApplicationStatus(applicationId))
        .catch(() => undefined);
    }
    setState((previous) => ({
      ...previous,
      applications: previous.applications.map((entry) => entry.id === applicationId ? {
        ...entry,
        status: 'Submitted',
        submittedAt: entry.submittedAt ?? new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString().slice(0, 10),
      } : entry),
      notifications: prependInAppNotification(previous, {
        id: `not-${crypto.randomUUID()}`,
        title: 'Application submitted',
        channel: 'In-app',
        body: 'Your scholarship application has been submitted to the centralized tracker.',
        status: 'Unread',
        createdAt: new Date().toISOString().slice(0, 10),
      }),
    }));
  };

  const changeApplicationStatus = (applicationId, status, options = {}) => {
    if (isSupabaseWorkspaceLoaded) {
      // Chain rather than fire-and-forget so the Edge Function reads the new
      // status instead of the previous one.
      Promise.resolve(updateSupabaseApplicationStatus(applicationId, status))
        .then(() => notifySupabaseApplicationStatus(applicationId))
        .catch(() => undefined);
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
    setState((previous) => ({
      ...previous,
      applications: previous.applications.map((entry) => entry.id === applicationId ? {
        ...entry,
        status,
        updatedAt: new Date().toISOString().slice(0, 10),
        ...stageFields,
        timeline: [...(entry.timeline || []), stageEvent],
      } : entry),
      notifications: prependInAppNotification(previous, {
        id: `not-${crypto.randomUUID()}`,
        title: `Application moved to ${status}`,
        channel: 'In-app',
        body: `${actor} updated the application status to ${status} in the application workspace.`,
        status: 'Unread',
        createdAt: new Date().toISOString().slice(0, 10),
      }),
    }));
  };

  // SOP step 4 — the Department Chair endorses qualified applications to the
  // next stage (interview and other evaluation).
  const endorseApplication = (applicationId, note = '') => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application) return;
    const record = {
      reviewedBy: currentProfile.fullName || 'Department Chair',
      decision: 'Endorsed',
      note: note || 'Endorsed based on academic standing and verified documents.',
      decidedAt: new Date().toISOString().slice(0, 10),
    };
    if (isSupabaseWorkspaceLoaded) {
      updateSupabaseApplicationStage(applicationId, 'Endorsed', { endorsement: record });
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
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application) return;
    const record = {
      scheduledAt: scheduledAt || null,
      panel: panel || `${application.studentDepartment || 'Department'} Scholarship Panel`,
      school: application.studentDepartment || 'Applicant school',
      note,
      outcome: null,
    };
    if (isSupabaseWorkspaceLoaded) {
      updateSupabaseApplicationStage(applicationId, 'Interview', { interview: record });
    }
    changeApplicationStatus(applicationId, 'Interview', {
      note: `Interview scheduled for ${record.scheduledAt || 'an upcoming date'} with the ${record.panel}.`,
      interview: record,
    });
  };

  // SOP step 6 — evaluation and deliberation by the School Scholarship
  // Sub-committee, producing a recommendation.
  const recordDeliberation = (applicationId, decision, note = '') => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application) return;
    const nextStatus = decision === 'Approved' ? 'Approved' : decision === 'Rejected' ? 'Rejected' : 'Recommended';
    const record = {
      decidedBy: 'School Scholarship Sub-committee',
      decision: nextStatus === 'Recommended' ? 'Recommended' : nextStatus,
      note,
      decidedAt: new Date().toISOString().slice(0, 10),
    };
    if (isSupabaseWorkspaceLoaded) {
      updateSupabaseApplicationStage(applicationId, nextStatus, { deliberation: record });
    }
    changeApplicationStatus(applicationId, nextStatus, {
      note: note || `Sub-committee deliberation recorded as ${nextStatus}.`,
      deliberation: record,
    });
  };

  // SOP steps 7 and 8 — the scholarship committee approves and the result is
  // released to the applicant through the Admissions Office.
  const releaseApplicationResults = (applicationId) => {
    const application = state.applications.find((entry) => entry.id === applicationId);
    if (!application) return;
    const record = {
      releasedTo: 'Admissions Office',
      releasedAt: new Date().toISOString().slice(0, 10),
      reference: `OAA-${applicationId.slice(0, 8).toUpperCase()}`,
    };
    if (isSupabaseWorkspaceLoaded) {
      updateSupabaseApplicationStage(applicationId, 'Released', { release: record });
    }
    setState((previous) => ({
      ...previous,
      applications: previous.applications.map((entry) => entry.id === applicationId ? {
        ...entry,
        status: 'Released',
        release: record,
        updatedAt: new Date().toISOString().slice(0, 10),
        timeline: [...(entry.timeline || []), {
          id: `ev-${crypto.randomUUID()}`,
          stage: 'Released',
          note: `Result released to the applicant through the Admissions Office (${record.reference}).`,
          actor: 'Admissions Office',
          at: new Date().toISOString().slice(0, 10),
        }],
      } : entry),
      notifications: prependInAppNotification(previous, {
        id: `not-${crypto.randomUUID()}`,
        title: `${application.scholarshipTitle} result released`,
        channel: 'Email',
        body: 'The Admissions Office has released the result of your scholarship application.',
        status: 'Unread',
        createdAt: new Date().toISOString().slice(0, 10),
      }),
    }));
  };

  const changeDocumentStatus = (documentId, verificationStatus) => {
    if (isSupabaseWorkspaceLoaded) updateSupabaseDocumentStatus(documentId, verificationStatus);
    setState((previous) => ({
      ...previous,
      documents: previous.documents.map((entry) => entry.id === documentId ? {
        ...entry,
        verificationStatus,
      } : entry),
    }));
  };

  const deleteDocument = (documentId) => {
    const documentToDelete = state.documents.find((entry) => entry.id === documentId);
    if (!documentToDelete || !window.confirm(`Delete “${documentToDelete.title}” from your vault?`)) return;
    if (isSupabaseWorkspaceLoaded) deleteSupabaseDocument(documentId);
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

  const addDocument = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get('documentTitle') || '').trim();
    const fileField = formData.get('documentFile');
    const fileName = fileField instanceof File ? fileField.name.trim() : String(fileField || '').trim();
    const documentType = String(formData.get('documentType') || 'Supporting Document');

    if (!title || !fileName) return;

    const nextDocument = {
      id: `doc-${crypto.randomUUID()}`,
      ownerId: currentProfile.id,
      title,
      fileName,
      documentType,
      verificationStatus: 'Pending',
      sharedWith: [],
      uploadedAt: new Date().toISOString().slice(0, 10),
    };

    if (isSupabaseWorkspaceLoaded) createSupabaseDocument({ ownerId: currentProfile.id, title, fileName, documentType });

    setState((previous) => ({
      ...previous,
      documents: [nextDocument, ...previous.documents],
      notifications: prependInAppNotification(previous, {
        id: `not-${crypto.randomUUID()}`,
        title: `${title} uploaded to Document Vault`,
        channel: 'In-app',
        body: 'The file is now reusable across multiple scholarship applications.',
        status: 'Unread',
        createdAt: new Date().toISOString().slice(0, 10),
      }),
    }));

    event.currentTarget.reset();
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
    const userId = state.authUser?.id || currentProfile.id;

    const result = await updateProfileFields(userId, {
      ...accountFields,
      ...(hasEligibilityAttributes
        ? { eligibilityAttributes: { ...pickEligibilityAttributes(studentMatchProfile), ...eligibilityAttributes } }
        : {}),
    });
    if (!result.success) return result;

    updateState((previous) => ({
      authUser: { ...previous.authUser, ...accountFields },
      profileDraft: isStudent
        ? { ...previous.profileDraft, ...pickFields(accountFields, PROFILE_DRAFT_KEYS), ...eligibilityAttributes }
        : previous.profileDraft,
      profileEdits: result.fallback
        ? { ...previous.profileEdits, [userId]: { ...previous.profileEdits?.[userId], ...accountFields } }
        : previous.profileEdits,
    }));

    return {
      success: true,
      message: result.detailsSynced === false
        ? 'Saved. Some details are kept on this device until the server profile is updated.'
        : result.fallback ? 'Saved to this demo session.' : 'Profile saved.',
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

  const openAcademicProfile = () => {
    setProfileSaveError('');
    setProfileOnboarding({
      id: state.authUser?.id || currentIdentity.id,
      fullName: currentIdentity.fullName,
      initialProgram: currentIdentity.degreeProgram || '',
      initialStudentNumber: currentIdentity.studentNumber || '',
      initialYearStanding: deriveYearStanding(studentMatchProfile),
      initialAcademicStanding: studentMatchProfile.academicStanding || '',
      initialCitizenship: studentMatchProfile.citizenship || '',
      initialQpi: currentIdentity.qpi ?? '',
      initialHsStrand: studentMatchProfile.hsStrand || '',
      initialHsAverage: studentMatchProfile.hsAverage ?? '',
      initialHouseholdIncome: currentIdentity.householdIncome ?? '',
      initialPhone: currentIdentity.phone || '',
      initialHasActiveGovernmentGrant: currentIdentity.hasActiveGovernmentGrant ?? false,
    });
  };

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
                <span className="text-xs text-app-muted">{roleLabels[state.viewerRole]}</span>
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
          <aside className="fixed inset-y-0 right-0 z-50 w-[min(21rem,88vw)] overflow-y-auto border-l border-app-border bg-app-card p-5 shadow-2xl lg:hidden" aria-label="Page navigation">
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
              <p className="mt-1 text-sm text-app-muted">{roleLabels[state.viewerRole]} · {currentIdentity.department}</p>
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
              onOpenCalendar={() => navigate('calendar')}
              onOpenAdmin={() => navigate('admin')}
              onOpenReview={() => navigate('review')}
              hasIncompleteProfile={hasIncompleteStudentProfile}
              onCompleteProfile={openAcademicProfile}
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
            />
          )}

          {state.activeView === 'applications' && (
              <ApplicationsViewPage
              applications={studentApplications}
              documents={studentDocuments}
              scholarships={scholarshipCatalog}
              onSubmit={submitApplication}
            />
          )}

          {state.activeView === 'vault' && state.viewerRole === 'student' && (
            <DocumentVaultViewPage
              documents={studentDocuments}
              onUpload={addDocument}
              onDelete={deleteDocument}
            />
          )}

          {state.activeView === 'admin' && state.viewerRole === 'admissions_office' && (
            <AdminConsolePage
              applications={state.applications}
              documents={state.documents}
              announcements={state.announcements}
              notifications={visibleNotifications}
              onChangeApplication={changeApplicationStatus}
              onEndorseApplication={endorseApplication}
              onScheduleInterview={scheduleInterview}
              onRecordDeliberation={recordDeliberation}
              onReleaseResults={releaseApplicationResults}
              onChangeDocument={changeDocumentStatus}
              onCreateAnnouncement={addAnnouncement}
              onMarkRead={markNotificationRead}
            />
          )}

          {state.activeView === 'review' && state.viewerRole === 'department_chair' && (
            <DepartmentReviewViewPage
              profile={currentProfile}
              queue={departmentQueue}
              documents={state.documents}
              onChangeApplication={changeApplicationStatus}
              onEndorseApplication={endorseApplication}
              onScheduleInterview={scheduleInterview}
              onRecordDeliberation={recordDeliberation}
              onReleaseResults={releaseApplicationResults}
            />
          )}

          {state.activeView === 'profile' && (
            <ProfileViewPage
              profile={currentIdentity}
              role={state.viewerRole}
              roleLabel={roleLabels[state.viewerRole]}
              academicPrograms={activeAcademicPrograms}
              academicProgramCategories={activeAcademicProgramCategories}
              isAccountManaged={hasSupabaseConfig}
              onSaveProfile={saveProfile}
              onChangePassword={changeAccountPassword}
              onRequestPasswordReset={requestOwnPasswordReset}
              onOpenEligibility={() => navigate('explore')}
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
