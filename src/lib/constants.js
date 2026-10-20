export const coverageTypes = ['all', 'Full Tuition', 'Partial Tuition', 'Allowance'];
export const applicationStatuses = ['Draft', 'Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected'];

// Standard Procedure for Scholarship Applications stage sequence (SOP steps 3-8).
// Step 2 (Submission) maps to `Submitted`, step 3 (Document Verification) maps to
// `For Verification`, step 4 (Endorsement) maps to `Endorsed`, step 5 (Interview)
// maps to `Interview`, step 6 (Evaluation and Deliberation) maps to `Recommended`,
// step 7 (Recommendation and Approval) maps to `Approved`, and step 8 (Release of
// Results) maps to `Released`.
export const sopStages = ['Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'];

const nextStatusMap = {
  Draft: ['Submitted'],
  Submitted: ['Under Review', 'For Verification', 'Rejected'],
  'Under Review': ['For Verification', 'Rejected'],
  'For Verification': ['Endorsed', 'Rejected'],
  Endorsed: ['Interview', 'Rejected'],
  Interview: ['Recommended', 'Rejected'],
  Recommended: ['Approved', 'Rejected'],
  Approved: ['Released'],
  Released: [],
  Rejected: [],
};

const roleNextStatusMap = {
  admissions_office: {
    Submitted: ['Under Review', 'For Verification', 'Rejected'],
    'Under Review': ['For Verification', 'Rejected'],
    'For Verification': ['Rejected'],
    // SOP steps 5 and 6: the Admissions Office schedules the interview and
    // records the sub-committee recommendation (scheduleInterview and
    // recordDeliberation in App.jsx read this map through their status guard).
    Endorsed: ['Interview', 'Rejected'],
    Interview: ['Recommended', 'Rejected'],
    Recommended: ['Approved', 'Rejected'],
    Approved: ['Released'],
  },
  department_chair: {
    // A Chair may flag a live application for central validation...
    Submitted: ['For Verification'],
    'Under Review': ['For Verification'],
    // ...and endorse it once the Admissions Office has verified its documents.
    'For Verification': ['Endorsed'],
  },
};

export const getNextApplicationStatuses = (status, role) => {
  if (role === 'department_chair') return roleNextStatusMap.department_chair[status] || [];
  if (role === 'admissions_office') return roleNextStatusMap.admissions_office[status] || [];
  return nextStatusMap[status] || [];
};

// The verb a reviewer sees for each transition in the review modal's action
// bar. Authority still comes only from getNextApplicationStatuses; this maps a
// permitted target status to its button label.
const stageActionLabels = {
  Submitted: 'Submit',
  'Under Review': 'Mark under review',
  'For Verification': 'Continue to verification',
  Endorsed: 'Endorse',
  Interview: 'Schedule interview',
  Recommended: 'Recommend for approval',
  Approved: 'Approve',
  Released: 'Release results',
  Rejected: 'Reject…',
};

export const getStageActionLabel = (status, role) => {
  if (status === 'For Verification' && role === 'department_chair') return 'Flag for central validation';
  return stageActionLabels[status] || status;
};

// Student-facing next-step copy for the application workspace. The card and
// the detail modal show this instead of the static creation note, so a student
// always knows what the current stage means and whether they need to act.
const applicationStatusGuidance = {
  Draft: 'Continue your application by attaching the required documents, writing your statement, and certifying it.',
  Submitted: 'Your application is submitted and waiting for the Admissions Office to begin review. No action is needed right now.',
  'Under Review': 'The Admissions Office is reviewing your application and its attached documents. We will notify you if anything needs correction.',
  'For Verification': 'Your documents are with the Admissions Office for verification. You will be notified when each file is verified or if a replacement is needed.',
  Endorsed: 'Your application has been endorsed and is moving to the next evaluation stage.',
  Interview: 'An interview has been scheduled. Watch your notifications for the date and panel details.',
  Recommended: 'The School Scholarship Sub-committee has recommended your application for approval.',
  Approved: 'Your application has been approved and is awaiting release of results.',
  Released: 'Your results have been released. Open the application to review the recorded outcome.',
  Rejected: 'Your application did not proceed. The recorded reason is available in the status history.',
};

export const getApplicationStatusGuidance = (status) => applicationStatusGuidance[status] || '';

// The StatusBadge tone used wherever an application status is displayed in the
// Admissions Office workspace.
export const getStatusTone = (status) => {
  if (status === 'Rejected') return 'danger';
  if (['Released', 'Approved'].includes(status)) return 'success';
  if (['For Verification', 'Endorsed'].includes(status)) return 'warning';
  return 'info';
};

// Every persisted `activeView` the app can render. The Admissions Office
// workspace is split into one route per function; `admin` stays the landing
// overview so a session saved before the split still resolves.
export const pageViewKeys = [
  'dashboard',
  'explore',
  'applications',
  'vault',
  'calendar',
  'admin',
  'admin-review',
  'admin-catalog',
  'admin-release',
  'admin-announcements',
  'review',
  'profile',
  'settings',
];

// The Admissions Office review queue: everything that still needs an SOP action.
// Shared with the dashboard count so the dashboard and the Admissions Office
// review route can never show different numbers for the same data.
export const ADMISSIONS_REVIEW_EXCLUDED_STATUSES = ['Draft', 'Approved', 'Released', 'Rejected'];

// The role-aware "applications to review" count shown on the dashboard.
//   - Student: their own live applications (not Rejected or Approved).
//   - Admissions Office: every application awaiting an SOP action (same filter
//     as the review queue route).
//   - Department Chair: applications from their department awaiting chair action.
export const countApplicationsToReview = (applications = [], { role, studentId, department } = {}) => {
  const list = Array.isArray(applications) ? applications : [];

  if (role === 'admissions_office') {
    return list.filter((entry) => !ADMISSIONS_REVIEW_EXCLUDED_STATUSES.includes(entry.status)).length;
  }

  if (role === 'department_chair') {
    return list.filter((entry) => (
      (entry.studentDepartment || '') === (department || '')
      && ['Submitted', 'Under Review', 'For Verification'].includes(entry.status)
    )).length;
  }

  return list.filter((entry) => (
    entry.studentId === studentId
    && entry.status !== 'Rejected'
    && entry.status !== 'Approved'
  )).length;
};

export const sopStageIndex = (status) => {
  const index = sopStages.indexOf(status);
  return index === -1 ? null : index;
};

export const departmentReviewStatuses = ['For Endorsement', 'Pending Documents', 'Endorsed', 'Returned'];

export const verificationStatuses = ['Pending', 'Verified', 'Rejected'];

// Statuses in which a student may replace a Rejected file on a submitted
// application. After For Verification every attached file is Verified, so a
// rejected file cannot exist there. Mirrors replace_rejected_application_document
// (20261021000000).
export const DOCUMENT_REPLACEMENT_STATUSES = ['Submitted', 'Under Review', 'For Verification'];

// Preset reasons the Admissions Office picks from when rejecting a Document
// Vault file. "Other" carries no preset text, so its note is required.
export const documentRejectionReasons = [
  { value: 'illegible', label: 'File is blurry, cropped, or unreadable' },
  { value: 'incomplete', label: 'Document is incomplete or missing pages' },
  { value: 'wrong-type', label: 'Wrong document type for this requirement' },
  { value: 'outdated', label: 'Document is expired or not for the current academic year' },
  { value: 'name-mismatch', label: 'Name on the document does not match the applicant' },
  { value: 'value-mismatch', label: 'Document does not support the value declared in the profile' },
  { value: 'not-certified', label: 'Not signed, stamped, or issued by the proper office' },
  { value: 'other', label: 'Other', requiresNotes: true },
];

// Profile-attribute verification states. An attribute is verified when the
// Admissions Office verifies a Document Vault file that declares it as proof
// (see src/lib/verification.js). The state is derived per attribute from the
// linked documents, so it is distinct from a document's own verificationStatus.
export const attributeVerificationStatuses = ['Unverified', 'Pending', 'Verified', 'Rejected', 'Outdated'];

// Standard Procedure submission types (step 2 required documents) plus the
// generic fallbacks. These are the types offered when a vault file is a general
// application document rather than proof for a profile attribute.
export const generalDocumentTypeOptions = [
  { value: 'Application Form', label: 'Application Form' },
  { value: 'Entrance Exam Result', label: 'Entrance Exam Result' },
  { value: 'HS Report Card', label: 'HS Report Card' },
  { value: 'Recommendation Letter', label: 'Recommendation' },
  { value: 'Income Proof', label: 'Income Doc' },
  { value: 'Photos of Residence', label: 'Photos of Residence' },
  { value: 'Good Moral Character', label: 'Good Moral Certificate' },
  { value: 'Certificate of Award', label: 'Certificate of Award' },
  { value: 'Transcript', label: 'Transcript' },
  { value: 'Enrollment', label: 'Enrollment' },
  { value: 'Clearance', label: 'Clearance' },
  { value: 'Government ID', label: 'Government ID' },
  { value: 'Supporting Document', label: 'Supporting Doc' },
];

// Additional document types that only serve as proof for a profile attribute
// (see `acceptedDocumentTypes` in src/lib/profile.js). Kept separate from the
// Standard Procedure submission types; a scholarship's required documents
// (src/lib/applicationRequirements.js) may accept either kind.
export const attributeProofDocumentTypeOptions = [
  { value: 'Grade Report', label: 'Grade Report' },
  { value: 'PSA Birth Certificate', label: 'PSA Birth Certificate' },
  { value: 'Passport', label: 'Passport' },
  { value: "Driver's License", label: "Driver's License" },
  { value: 'Philippine National ID', label: 'Philippine National ID' },
  { value: 'PWD ID', label: 'PWD ID' },
  { value: 'Medical Certificate', label: 'Medical Certificate' },
  { value: 'Certificate of Employment', label: 'Certificate of Employment' },
  { value: 'Payslip', label: 'Payslip' },
  { value: 'Certificate of Indigency', label: 'Certificate of Indigency' },
  { value: 'Certificate of Tribal Membership', label: 'Certificate of Tribal Membership' },
];

// Every document type the vault can store, so `getDocumentTypeLabel` can resolve
// any stored value (including a proof type) to its display label.
export const documentTypeOptions = [...generalDocumentTypeOptions, ...attributeProofDocumentTypeOptions];

export const getDocumentTypeLabel = (value) => (
  documentTypeOptions.find((option) => option.value === value)?.label || value
);

