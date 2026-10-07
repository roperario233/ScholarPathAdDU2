import { academicPrograms } from './academicPrograms';


const today = new Date();
const dateFromToday = (days) => {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export const demoUsers = {
  student: {
    id: 'user-student',
    role: 'student',
    fullName: 'Eriel John Espinosa',
    email: 'eriel@student.addu.edu.ph',
    phone: '+63 912 345 6789',
    department: 'BS Information Technology',
    degreeProgram: 'BS Information Technology',
    qpi: 2.86,
    householdIncome: 240000,
    citizenship: 'Filipino',
    isOnPrepaidPlan: false,
    hasSiblingOnAid: false,
    hasOtherActiveScholarship: false,
    hasActiveGovernmentGrant: false,
    academicStanding: 'good',
    applicantType: 'current',
    yearStanding: '2nd',
    yearLevel: 2,
    isHonorsGraduate: false,
    honorsRank: '',
    graduatingClassSize: '',
    hsStrand: '',
    hsAverage: '',
    sponsorTies: { gsisMemberDependent: false, afpDependent: false, usVeteranDependent: false },
    bio: 'Undergraduate student looking for scholarship matches and deadline alerts.',
  },
  admin: {
    id: 'user-admin',
    role: 'admissions_office',
    fullName: 'Admissions Office Administrator',
    email: 'admissions@addu.edu.ph',
    phone: '+63 917 000 0000',
    department: 'Office of Admissions',
    degreeProgram: 'Administration',
    qpi: null,
    householdIncome: null,
    hasActiveGovernmentGrant: false,
    bio: 'Coordinates scholarship application operations, document verification, announcements, and results.',
  },
  chair: {
    id: 'user-chair',
    role: 'department_chair',
    fullName: 'Department Chair',
    email: 'chair@addu.edu.ph',
    phone: '+63 918 000 0000',
    department: 'College of Computer Studies (CCS)',
    degreeProgram: 'BS Computer Science',
    qpi: null,
    householdIncome: null,
    hasActiveGovernmentGrant: false,
    bio: 'Reviews department-scoped applications, convenes the interview panel, and records recommendations.',
  },
};

// Demo applications are seeded across the Standard Procedure pipeline so the
// Admissions Office console and Department Chair review demonstrate the stage flow. Applicant
// context (name, program, department, QPI, income) is denormalized onto each
// application so staff work queues never have to resolve it again.
const studentProfileFields = {
  studentName: 'Eriel John Espinosa',
  studentProgram: 'BS Information Technology',
  studentDepartment: 'College of Computer Studies (CCS)',
  studentQpi: 2.86,
  studentHouseholdIncome: 240000,
};

// Older stored demo sessions predate the SOP pipeline fields; normalize every
// application so staff views can rely on applicant context and stage records.
export const normalizeApplication = (entry = {}) => ({
  ...studentProfileFields,
  endorsement: null,
  interview: null,
  deliberation: null,
  release: null,
  ...entry,
  timeline: Array.isArray(entry.timeline) ? entry.timeline : [],
  attachedDocuments: Array.isArray(entry.attachedDocuments) ? entry.attachedDocuments : [],
});

// Older stored demo sessions predate the profile-attribute proof links; default
// every document to an empty list so the vault and the verification helpers
// (src/lib/verification.js) can rely on the field existing.
export const normalizeDocument = (entry = {}) => ({
  ...entry,
  linkedAttributes: Array.isArray(entry.linkedAttributes) ? entry.linkedAttributes : [],
});

export const applications = [
  {
    id: 'app-001',
    studentId: 'user-student',
    scholarshipId: 'sch-012',
    scholarshipTitle: 'Grant-in-Aid (GIA)',
    status: 'Under Review',
    documentStatus: 'Verified',
    submittedAt: dateFromToday(-3),
    updatedAt: dateFromToday(-1),
    attachedDocuments: ['doc-001', 'doc-002'],
    notes: 'Awaiting Admissions Office document verification.',
    timeline: [
      { id: 'ev-001', stage: 'Submitted', note: 'Application submitted for review.', actor: 'Student', at: dateFromToday(-3) },
      { id: 'ev-002', stage: 'Under Review', note: 'Routed to the Admissions Office review queue.', actor: 'Admissions Office', at: dateFromToday(-1) },
    ],
    endorsement: null,
    interview: null,
    deliberation: null,
    release: null,
    ...studentProfileFields,
  },
  {
    id: 'app-002',
    studentId: 'user-student',
    scholarshipId: 'sch-048',
    scholarshipTitle: 'DOST-SEI Merit Scholarship Program',
    status: 'Draft',
    documentStatus: 'Pending',
    submittedAt: null,
    updatedAt: dateFromToday(-2),
    attachedDocuments: ['doc-001'],
    notes: 'Profile saved for later submission.',
    timeline: [],
    endorsement: null,
    interview: null,
    deliberation: null,
    release: null,
    ...studentProfileFields,
  },
  {
    id: 'app-003',
    studentId: 'user-student',
    scholarshipId: 'sch-012',
    scholarshipTitle: 'Grant-in-Aid (GIA)',
    status: 'For Verification',
    documentStatus: 'Pending',
    submittedAt: dateFromToday(-6),
    updatedAt: dateFromToday(-2),
    attachedDocuments: ['doc-002', 'doc-003'],
    notes: 'Income documents pending Admissions Office verification.',
    timeline: [
      { id: 'ev-003', stage: 'Submitted', note: 'Application submitted for review.', actor: 'Student', at: dateFromToday(-6) },
      { id: 'ev-004', stage: 'For Verification', note: 'Supporting documents queued for verification.', actor: 'Admissions Office', at: dateFromToday(-2) },
    ],
    endorsement: null,
    interview: null,
    deliberation: null,
    release: null,
    ...studentProfileFields,
  },
  {
    id: 'app-004',
    studentId: 'user-student',
    scholarshipId: 'sch-012',
    scholarshipTitle: 'Grant-in-Aid (GIA)',
    status: 'Endorsed',
    documentStatus: 'Verified',
    submittedAt: dateFromToday(-9),
    updatedAt: dateFromToday(-1),
    attachedDocuments: ['doc-001', 'doc-002'],
    notes: 'Endorsed by the College of Computer Studies for the interview stage.',
    timeline: [
      { id: 'ev-005', stage: 'For Verification', note: 'Documents verified by the Admissions Office.', actor: 'Admissions Office', at: dateFromToday(-4) },
      { id: 'ev-006', stage: 'Endorsed', note: 'Endorsed to the interview stage by the Department Chair.', actor: 'Department Chair', at: dateFromToday(-1) },
    ],
    endorsement: { reviewedBy: 'Department Chair', decision: 'Endorsed', note: 'Qualified based on verified income documents and active enrollment.', decidedAt: dateFromToday(-1) },
    interview: null,
    deliberation: null,
    release: null,
    ...studentProfileFields,
  },
  {
    id: 'app-005',
    studentId: 'user-student',
    scholarshipId: 'sch-012',
    scholarshipTitle: 'Grant-in-Aid (GIA)',
    status: 'Interview',
    documentStatus: 'Verified',
    submittedAt: dateFromToday(-9),
    updatedAt: dateFromToday(0),
    attachedDocuments: ['doc-001'],
    notes: 'Interview panel scheduled from the College of Computer Studies.',
    timeline: [
      { id: 'ev-007', stage: 'Endorsed', note: 'Endorsed to the interview stage.', actor: 'Department Chair', at: dateFromToday(-5) },
      { id: 'ev-008', stage: 'Interview', note: 'Interview scheduled with the CCS panel.', actor: 'Department Chair', at: dateFromToday(0) },
    ],
    endorsement: { reviewedBy: 'Department Chair', decision: 'Endorsed', note: 'Recommended for the next evaluation stage.', decidedAt: dateFromToday(-5) },
    interview: { scheduledAt: dateFromToday(3), panel: 'CCS Scholarship Panel', school: 'College of Computer Studies (CCS)', note: 'Bring the original income documents.', outcome: null },
    deliberation: null,
    release: null,
    ...studentProfileFields,
  },
  {
    id: 'app-006',
    studentId: 'user-student',
    scholarshipId: 'sch-012',
    scholarshipTitle: 'Grant-in-Aid (GIA)',
    status: 'Recommended',
    documentStatus: 'Verified',
    submittedAt: dateFromToday(-14),
    updatedAt: dateFromToday(-1),
    attachedDocuments: ['doc-001', 'doc-003'],
    notes: 'Endorsed by the School Scholarship Sub-committee for final approval.',
    timeline: [
      { id: 'ev-009', stage: 'Interview', note: 'Interview completed with the CCS panel.', actor: 'Department Chair', at: dateFromToday(-4) },
      { id: 'ev-010', stage: 'Recommended', note: 'School Scholarship Sub-committee deliberation recorded.', actor: 'Department Chair', at: dateFromToday(-1) },
    ],
    endorsement: { reviewedBy: 'Department Chair', decision: 'Endorsed', note: 'Recommended after interview.', decidedAt: dateFromToday(-4) },
    interview: { scheduledAt: dateFromToday(-4), panel: 'CCS Scholarship Panel', school: 'College of Computer Studies (CCS)', note: 'Interview completed.', outcome: 'Passed' },
    deliberation: { decidedBy: 'School Scholarship Sub-committee', decision: 'Recommended', note: 'Qualified for endorsement to the scholarship committee.', decidedAt: dateFromToday(-1) },
    release: null,
    ...studentProfileFields,
  },
  {
    id: 'app-007',
    studentId: 'user-student',
    scholarshipId: 'sch-012',
    scholarshipTitle: 'Grant-in-Aid (GIA)',
    status: 'Approved',
    documentStatus: 'Verified',
    submittedAt: dateFromToday(-20),
    updatedAt: dateFromToday(-1),
    attachedDocuments: ['doc-001', 'doc-002'],
    notes: 'Approved and queued for release through the Admissions Office.',
    timeline: [
      { id: 'ev-011', stage: 'Recommended', note: 'Recommended by the sub-committee.', actor: 'Department Chair', at: dateFromToday(-6) },
      { id: 'ev-012', stage: 'Approved', note: 'Approved by the School Scholarship Committee.', actor: 'School Scholarship Committee', at: dateFromToday(-1) },
    ],
    endorsement: { reviewedBy: 'Department Chair', decision: 'Endorsed', note: 'Recommended for approval.', decidedAt: dateFromToday(-6) },
    interview: { scheduledAt: dateFromToday(-8), panel: 'CCS Scholarship Panel', school: 'College of Computer Studies (CCS)', note: 'Interview completed.', outcome: 'Passed' },
    deliberation: { decidedBy: 'School Scholarship Sub-committee', decision: 'Recommended', note: 'Endorsed to the committee.', decidedAt: dateFromToday(-6) },
    release: null,
    ...studentProfileFields,
  },
];

export const documents = [
  {
    id: 'doc-001',
    ownerId: 'user-student',
    title: 'Academic Transcript',
    fileName: 'transcript.pdf',
    documentType: 'Transcript',
    verificationStatus: 'Verified',
    linkedAttributes: ['qpi', 'academicStanding'],
    sharedWith: ['Grant-in-Aid (GIA)', 'DOST-SEI Merit Scholarship Program'],
    uploadedAt: dateFromToday(-8),
  },
  {
    id: 'doc-002',
    ownerId: 'user-student',
    title: 'BIR-stamped ITR',
    fileName: 'itr.pdf',
    documentType: 'Income Proof',
    verificationStatus: 'Pending',
    linkedAttributes: ['householdIncome'],
    sharedWith: ['Grant-in-Aid (GIA)'],
    uploadedAt: dateFromToday(-4),
  },
  {
    id: 'doc-003',
    ownerId: 'user-student',
    title: 'Certificate of Enrollment',
    fileName: 'coe.pdf',
    documentType: 'Enrollment',
    verificationStatus: 'Verified',
    linkedAttributes: [],
    sharedWith: ['DOST-SEI Merit Scholarship Program'],
    uploadedAt: dateFromToday(-2),
  },
];

export const notifications = [
  {
    id: 'not-001',
    title: 'GIA deadline reminder',
    channel: 'SMS',
    body: 'Your Grant-in-Aid application is due soon. Upload any missing documents now.',
    status: 'Unread',
    createdAt: dateFromToday(-1),
  },
  {
    id: 'not-002',
    title: 'Application status update',
    channel: 'Email',
    body: 'Your Grant-in-Aid application was moved to Under Review by the Admissions Office.',
    status: 'Unread',
    createdAt: dateFromToday(-1),
  },
  {
    id: 'not-003',
    title: 'Document verified',
    channel: 'In-app',
    body: 'Your academic transcript has been verified and can be reused across applications.',
    status: 'Read',
    createdAt: dateFromToday(-5),
  },
];

export const announcements = [
  {
    id: 'ann-001',
    title: 'Scholarship Application Window Open',
    body: 'Students can now search, match, and submit scholarship applications from the centralized dashboard.',
    audience: 'Students',
    createdAt: dateFromToday(-2),
  },
  {
    id: 'ann-002',
    title: 'Document Review Queue Updated',
    body: 'Admin reviewers should clear pending proof-of-income documents before application finalization.',
    audience: 'Admissions Office',
    createdAt: dateFromToday(-1),
  },
];

// Department review records mirror chair decisions against specific applications.
// Department values are normalized to school-level names so they match
// profiles.department derived from the academic program taxonomy.
export const departmentReviews = [
  {
    id: 'rev-001',
    applicationId: 'app-004',
    reviewerId: 'user-chair',
    studentName: 'Eriel John Espinosa',
    department: 'College of Computer Studies (CCS)',
    qpi: 2.86,
    householdIncome: 240000,
    status: 'Endorsed',
    recommendation: 'Qualified for GIA based on verified income documents and active enrollment.',
  },
  {
    id: 'rev-002',
    applicationId: 'app-003',
    reviewerId: 'user-chair',
    studentName: 'Eriel John Espinosa',
    department: 'College of Computer Studies (CCS)',
    qpi: 2.86,
    householdIncome: 240000,
    status: 'Pending Documents',
    recommendation: 'Awaiting verified income documents before endorsement.',
  },
  {
    id: 'rev-003',
    applicationId: 'app-006',
    reviewerId: 'user-chair',
    studentName: 'Eriel John Espinosa',
    department: 'College of Computer Studies (CCS)',
    qpi: 2.86,
    householdIncome: 240000,
    status: 'Endorsed',
    recommendation: 'Endorsed to the School Scholarship Sub-committee after interview.',
  },
];

// ---------------------------------------------------------------------------
// Persisted demo-state hydration.
//
// Moved out of src/App.jsx so the localStorage merge rules can be unit tested.
// NOTE: an earlier version of createInitialState deleted the entire saved
// session whenever `stored.theme === 'dark'` ("force reset old dark theme"),
// which also destroyed customDeadlines and generated reminder notifications
// every reload for anyone using the dark theme. The stored theme is now
// preserved (see the theme requirement in agents.md) and the saved data is
// never discarded.
// ---------------------------------------------------------------------------
export const storageKey = 'scholarpath-addu-demo-state';

export const readStoredState = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
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
    qpi: 2.86,
    householdIncome: 240000,
    degreeProgram: 'BS Computer Science',
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
  applications,
  documents,
  notifications,
  announcements,
  customDeadlines: [],
  // Demo-mode My Profile edits keyed by account id, so a demo account keeps its
  // edited name, mobile number, and bio after signing out and back in.
  profileEdits: {},
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
    applications: Array.isArray(stored.applications) && stored.applications.length ? stored.applications.map(normalizeApplication) : defaults.applications,
    documents: Array.isArray(stored.documents) && stored.documents.length ? stored.documents.map(normalizeDocument) : defaults.documents,
    notifications: Array.isArray(stored.notifications) && stored.notifications.length ? stored.notifications : defaults.notifications,
    announcements: Array.isArray(stored.announcements) && stored.announcements.length ? stored.announcements : defaults.announcements,
    customDeadlines: Array.isArray(stored.customDeadlines) ? stored.customDeadlines : defaults.customDeadlines,
    profileEdits: stored.profileEdits && typeof stored.profileEdits === 'object' && !Array.isArray(stored.profileEdits)
      ? stored.profileEdits
      : defaults.profileEdits,
    academicPrograms: Array.isArray(stored.academicPrograms) && stored.academicPrograms.length ? stored.academicPrograms : defaults.academicPrograms,
    profileSkipped: stored.profileSkipped ?? defaults.profileSkipped,
  };
};