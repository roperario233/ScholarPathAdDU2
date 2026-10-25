export const coverageTypes = ['all', 'Full Tuition', 'Partial Tuition', 'Allowance'];
export const applicationStatuses = ['Draft', 'Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected'];

// Standard Procedure for Scholarship Applications stage sequence (SOP steps 3-8).
// Step 2 (Submission) maps to `Submitted`, step 3 (Document Verification) maps to
// `For Verification`, the Admissions Office's hand-off to the Department Chair is
// `For Endorsement`, step 4 (Endorsement) maps to `Endorsed`, step 5 (Interview)
// maps to `Interview`, step 6 (Evaluation and Deliberation) maps to `Recommended`,
// step 7 (Recommendation and Approval) maps to `Approved`, and step 8 (Release of
// Results) maps to `Released`.
export const sopStages = ['Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'];

const nextStatusMap = {
  Draft: ['Submitted'],
  Submitted: ['Under Review', 'For Verification', 'Rejected'],
  'Under Review': ['For Verification', 'Rejected'],
  'For Verification': ['For Endorsement', 'Rejected'],
  'For Endorsement': ['Endorsed', 'Rejected'],
  Endorsed: ['Interview', 'Rejected'],
  Interview: ['Recommended', 'Rejected'],
  Recommended: ['Approved', 'Rejected'],
  Approved: ['Released'],
  Released: [],
  Rejected: [],
};

// The Admissions Office is two lanes with one accountability boundary. Staff
// prepare a case (intake, document verification, the hand-off to the Department
// Chair, the interview schedule, and the sub-committee recommendation); the Head
// decides it (approval and release) and owns the office's policy surfaces.
// Stage authority is still this one map: App.jsx's changeApplicationStatus guard,
// the review modal's action bar, and the database trigger all read it.
export const ADMISSIONS_OFFICE_ROLES = ['admissions_office', 'admissions_head'];

// The decisions the Head owns: SOP step 7 (approval) and step 8 (release).
export const ADMISSIONS_APPROVAL_STATUSES = ['Recommended', 'Approved'];

export const isAdmissionsStaffRole = (role) => role === 'admissions_office';
export const isAdmissionsHeadRole = (role) => role === 'admissions_head';
export const isAdmissionsReviewerRole = (role) => ADMISSIONS_OFFICE_ROLES.includes(role);

const roleNextStatusMap = {
  admissions_office: {
    Submitted: ['Under Review', 'For Verification', 'Rejected'],
    'Under Review': ['For Verification', 'Rejected'],
    // The Admissions Office Staff finish document verification and hand the
    // application to the Department Chair for endorsement (SOP step 4).
    'For Verification': ['For Endorsement', 'Rejected'],
    // SOP steps 5 and 6: staff coordinate the interview (its panel comes from
    // the applicant's school, SOP 5a) and record the sub-committee
    // recommendation (scheduleInterview and recordDeliberation in App.jsx read
    // this map through their status guard). Approval and release are not staff
    // decisions. A Chair on the interview panel records attendance and notes
    // without any status move, so the Chair map below is unchanged.
    Endorsed: ['Interview', 'Rejected'],
    Interview: ['Recommended', 'Rejected'],
  },
  admissions_head: {
    // The Head is a superset of the Staff lane: they can run every preparation
    // stage and also decide approval (SOP step 7) and release (step 8). Staff
    // remain limited to the preparation stages.
    Submitted: ['Under Review', 'For Verification', 'Rejected'],
    'Under Review': ['For Verification', 'Rejected'],
    'For Verification': ['For Endorsement', 'Rejected'],
    Endorsed: ['Interview', 'Rejected'],
    Interview: ['Recommended', 'Rejected'],
    Recommended: ['Approved', 'Rejected'],
    Approved: ['Released'],
  },
  department_chair: {
    // A Chair may flag a live application for central validation...
    Submitted: ['For Verification'],
    'Under Review': ['For Verification'],
    // ...and endorses it once the Admissions Office has sent it to endorsement.
    'For Endorsement': ['Endorsed'],
  },
};

export const getNextApplicationStatuses = (status, role) => {
  if (role === 'department_chair') return roleNextStatusMap.department_chair[status] || [];
  if (isAdmissionsReviewerRole(role)) return roleNextStatusMap[role][status] || [];
  return nextStatusMap[status] || [];
};

// Transitions the review surface performs itself instead of offering as a
// button: opening an application starts its review, so "Under Review" is never
// rendered in the action bar. The role maps above still permit the move because
// changeApplicationStatus (App.jsx) reads them as the guard for that write, and
// a Submitted application can still continue straight to verification if the
// automatic write did not land.
export const AUTOMATIC_STAGE_STATUSES = ['Under Review'];

// The labels every surface shows for a stored application status. Kept in the
// shared Edge Function module so the emails and SMS use the same words as the
// app (for example `Endorsed` is shown as "Endorsement").
export { getApplicationStatusLabel } from '../../supabase/functions/_shared/applicationStatus.js';

// The verb a reviewer sees for each transition in the review modal's action
// bar. Authority still comes only from getNextApplicationStatuses; this maps a
// permitted target status to its button label.
const stageActionLabels = {
  Submitted: 'Submit',
  'Under Review': 'Mark under review',
  'For Verification': 'Continue to verification',
  'For Endorsement': 'Send to endorsement',
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
  'Under Review': 'The Admissions Office has opened your application for review. We will notify you if anything needs correction.',
  'For Verification': 'Your documents are with the Admissions Office for verification. You will be notified when each file is verified or if a replacement is needed.',
  'For Endorsement': 'Your documents are verified and the Admissions Office has sent your application to your Department Chair for endorsement. No action is needed from you right now.',
  Endorsed: 'Your application is in the endorsement phase. The Department Chair has endorsed it, and the Admissions Office will schedule your interview with a panel from your school next.',
  Interview: 'Your interview is scheduled. Open the application for the date, time, and location or meeting link, and add it to your calendar.',
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
  if (['For Verification', 'For Endorsement', 'Endorsed'].includes(status)) return 'warning';
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
  'admin-calendar',
  'admin-interviews',
  'admin-catalog',
  'admin-release',
  'admin-announcements',
  'review',
  'chair-calendar',
  'chair-interviews',
  'profile',
  'settings',
];

// The Admissions Office Staff review queue: everything that still needs a staff
// or Department Chair action. `Recommended` is excluded because approval now
// belongs to the Admissions Office Head, and `Approved` moves to the Head's
// release queue.
export const ADMISSIONS_REVIEW_EXCLUDED_STATUSES = ['Draft', 'Approved', 'Released', 'Rejected'];
export const ADMISSIONS_STAFF_EXCLUDED_STATUSES = [...ADMISSIONS_REVIEW_EXCLUDED_STATUSES, 'Recommended'];

// The role-aware "applications to review" count shown on the dashboard.
//   - Student: their own live applications (not Rejected or Approved).
//   - Admissions Office Staff: every application awaiting a staff or Chair action
//     (the same filter as the staff review queue route).
//   - Admissions Office Head: the approval and release decisions the Head owns.
//   - Department Chair: applications from their department awaiting chair action.
export const countApplicationsToReview = (applications = [], { role, studentId, department } = {}) => {
  const list = Array.isArray(applications) ? applications : [];

  if (isAdmissionsStaffRole(role)) {
    return list.filter((entry) => !ADMISSIONS_STAFF_EXCLUDED_STATUSES.includes(entry.status)).length;
  }

  if (isAdmissionsHeadRole(role)) {
    return list.filter((entry) => ADMISSIONS_APPROVAL_STATUSES.includes(entry.status)).length;
  }

  if (role === 'department_chair') {
    return list.filter((entry) => (
      (entry.studentDepartment || '') === (department || '')
      && ['Submitted', 'Under Review', 'For Endorsement'].includes(entry.status)
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
  // Photo-specific reasons, phrased against the guide a student sees before
  // capturing or uploading a photo (src/lib/photoGuide.js).
  { value: 'photo-quality', label: 'Photo is blurry, poorly lit, or the face is partly hidden' },
  { value: 'not-recent', label: 'Photo is not recent or does not clearly show the applicant' },
  { value: 'other', label: 'Other', requiresNotes: true },
];

// The rejection reasons that only apply to a photo. The review modal omits them
// when a non-photo file is being rejected.
export const photoRejectionReasonValues = ['photo-quality', 'not-recent'];

// Profile-attribute verification states. An attribute is verified when the
// Admissions Office verifies a Document Vault file that declares it as proof
// (see src/lib/verification.js). The state is derived per attribute from the
// linked documents, so it is distinct from a document's own verificationStatus.
// An answer that needs no proof names its reason: `Not applicable` (not read for
// the student's year standing), `No proof needed` (the recorded answer claims
// nothing), or `Not answered` (the optional answer is still "Not specified").
// `Not needed` is the single neutral state used before those reasons were
// separated; new derivations never produce it, but a profile snapshot submitted
// earlier keeps rendering the badge it was frozen with.
export const attributeVerificationStatuses = [
  'Unverified', 'Pending', 'Verified', 'Rejected', 'Outdated',
  'Not applicable', 'No proof needed', 'Not answered', 'Not needed',
];

// Standard Procedure submission types (step 2 required documents) plus the
// generic fallbacks. These are the types offered when a vault file is a general
// application document rather than proof for a profile attribute.
export const generalDocumentTypeOptions = [
  { value: 'Application Form', label: 'Application Form' },
  // A recent photo of the applicant, captured with the camera or uploaded from
  // the device. Required by every in-scope AdDU track and verified by the
  // Admissions Office like any other vault file.
  { value: 'Applicant Photo', label: '2x2 ID Photo' },
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

// Document types a student can produce with a camera. The vault, the application
// workspace, and the rejected-file replacement offer a camera for these types
// and show the matching photo guide (src/lib/photoGuide.js). `Applicant Photo` is
// a portrait, square-framed ID photo; `Photos of Residence` is a set of scene
// photos that keep the camera's aspect ratio.
export const photoDocumentTypes = ['Applicant Photo', 'Photos of Residence'];
export const isPhotoDocumentType = (value) => photoDocumentTypes.includes(value);

// The rejection-reason list for one file: photo-specific reasons are offered
// only for the two camera-capable types, and the declared-value mismatch is not
// offered for a photo, which proves no profile answer.
export const getDocumentRejectionReasons = (documentType) => (
  isPhotoDocumentType(documentType)
    ? documentRejectionReasons.filter((reason) => reason.value !== 'value-mismatch')
    : documentRejectionReasons.filter((reason) => !photoRejectionReasonValues.includes(reason.value))
);

export const getDocumentTypeLabel = (value) => (
  documentTypeOptions.find((option) => option.value === value)?.label || value
);

