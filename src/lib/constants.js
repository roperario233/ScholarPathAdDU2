import { buildProgramScopeIndex, getReviewerScope, isApplicationInReviewerScope, isInterviewerRole, isReviewerRole } from './reviewScope';

export const coverageTypes = ['all', 'Full Tuition', 'Partial Tuition', 'Allowance'];
export const applicationStatuses = ['Draft', 'Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected'];

// Standard Procedure for Scholarship Applications stage sequence (SOP steps 3-8),
// as the Admissions Office runs it since Consultation 2. Step 2 (Submission) maps
// to `Submitted`, step 3 (Document Verification) to `For Verification`, the
// Head's forward to the interviewer (the former step-4 endorsement) to `Endorsed`
// (shown "For Interview"), step 5 (Interview) to `Interview`, the interviewer's
// recommendation to `Recommended`, the school's approval to `Approved`, and the
// Head's release to `Released`. `For Endorsement` survives only on rows handed
// off before the change; sopStageIndex() places it with verification.
export const sopStages = ['Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'];

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

// Stage authority follows the process the Admissions Office described at
// Consultation 2 (Oct 27): the Head verifies every file and forwards the case to
// the interviewer, an interviewer (or a ladder account in scope that runs the
// interview itself) schedules and recommends, the school's approving level
// approves, and the Head does the final check and releases. Staff keep a
// read-only office view. App.jsx's changeApplicationStatus guard, the review
// modal's action bar, and the database trigger
// (20261050000001_lane_transitions_by_flow_role.sql) all read this one map.
export const ADMISSIONS_OFFICE_ROLES = ['admissions_office', 'admissions_head'];

// The Head's own decisions: the final check before release (Approved), plus the
// legacy endorsement rows still waiting at For Endorsement.
export const ADMISSIONS_APPROVAL_STATUSES = ['Approved'];
export const ADMISSIONS_HEAD_DECISION_STATUSES = ['Submitted', 'Under Review', 'For Verification', 'For Endorsement', ...ADMISSIONS_APPROVAL_STATUSES];

export const isAdmissionsStaffRole = (role) => role === 'admissions_office';
export const isAdmissionsHeadRole = (role) => role === 'admissions_head';
export const isAdmissionsReviewerRole = (role) => ADMISSIONS_OFFICE_ROLES.includes(role);

const roleNextStatusMap = {
  // Read-only: Staff are not part of the application process any more.
  admissions_office: {},
  admissions_head: {
    Submitted: ['Under Review', 'For Verification', 'Rejected'],
    'Under Review': ['For Verification', 'Rejected'],
    // Once every file is Verified the Head forwards the case straight to the
    // interviewer; the separate endorsement hand-off is retired.
    'For Verification': ['Endorsed', 'Rejected'],
    // Legacy rows handed off before the change can still leave the stage.
    'For Endorsement': ['Endorsed', 'Rejected'],
    // Superset override on the interview and approval moves.
    Endorsed: ['Interview', 'Rejected'],
    Interview: ['Recommended', 'Rejected'],
    Recommended: ['Approved', 'Rejected'],
    // The final check before release: a sibling already on a grant or a pending
    // case ends the application here.
    Approved: ['Released', 'Rejected'],
  },
};

// A scoped reviewer's moves depend on the case, not only the role: any reviewer
// in scope may schedule, only a panel member recommends, and only the approving
// level approves. `context` carries those two facts (App.jsx `stageContextFor`).
const reviewerNextStatuses = (status, role, { isPanelist = false, isApprover = false } = {}) => {
  if (status === 'Endorsed') return ['Interview'];
  if (status === 'Interview') return isPanelist ? ['Recommended'] : [];
  if (status === 'Recommended' && role !== 'interviewer' && isApprover) return ['Approved', 'Rejected'];
  return [];
};

export const getNextApplicationStatuses = (status, role, context = {}) => {
  if (isReviewerRole(role)) return reviewerNextStatuses(status, role, context);
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

// The stages that can still take a case officer. Opening an application in the
// Admissions Office workspace joins the Head to the case, and joining is the one
// status move that can start the review (Submitted -> Under Review). Routing to
// interviewers is derived from the applicant's scope, so the roster is only the
// office's own record of who opened a case. Mirrors the status list in
// public.join_application_review().
export const CASE_OFFICER_JOINABLE_STATUSES = [
  'Submitted',
  'Under Review',
  'For Verification',
  'For Endorsement',
  'Endorsed',
  'Interview',
];

// The labels every surface shows for a stored application status. Kept in the
// shared Edge Function module so the emails and SMS use the same words as the
// app (for example `Endorsed` is shown as "For Interview").
export { getApplicationStatusLabel } from '../../supabase/functions/_shared/applicationStatus.js';

// The verb a reviewer sees for each transition in the review modal's action
// bar. Authority still comes only from getNextApplicationStatuses; this maps a
// permitted target status to its button label.
const stageActionLabels = {
  Submitted: 'Submit',
  'Under Review': 'Mark under review',
  'For Verification': 'Continue to verification',
  'For Endorsement': 'Send to endorsement',
  // The Head forwards a verified case to the interviewers of its scope.
  Endorsed: 'Forward to interview',
  Interview: 'Schedule interview',
  Recommended: 'Recommend for approval',
  Approved: 'Approve',
  Released: 'Release results',
  Rejected: 'Reject…',
};

export const getStageActionLabel = (status) => stageActionLabels[status] || status;

// The one sentence a student is told when an application is rejected (FORM
// 230-SCH affidavit clause 6: the results and the minutes of the deliberations
// are confidential), and the prefix that files the recorded reason in the
// staff-only `application_review_comments` thread instead. The reason never
// reaches a student-readable column, so the timeline note and the status log's
// derived reason both carry this notice. Document resubmission reasons stay
// student-visible: they tell the student what to correct.
export const APPLICATION_REJECTION_NOTICE = 'Application not accepted.';
export const APPLICATION_REJECTION_REASON_PREFIX = 'Rejection reason — ';

// Student-facing next-step copy for the application workspace. The card and
// the detail modal show this instead of the static creation note, so a student
// always knows what the current stage means and whether they need to act.
const applicationStatusGuidance = {
  Draft: 'Attach the required documents, write your statement, then certify and submit.',
  Submitted: 'Waiting for the Admissions Office to begin review.',
  'Under Review': 'The Admissions Office is reviewing your application.',
  'For Verification': 'Your documents are with the Admissions Office for verification. You will be notified if a replacement is needed.',
  'For Endorsement': 'Documents verified. No action needed.',
  Endorsed: 'Documents verified. An interviewer from your school will schedule your interview next.',
  Interview: 'Your interview is scheduled. Open the application for the details.',
  Recommended: 'Your interviewer has sent a recommendation to your school for its decision.',
  // Approved and Rejected are never shown to a student before the results are
  // released (getStudentFacingStatus); "Under deliberation" stands in for both.
  'Under deliberation': 'Your school and the Admissions Office are deciding. Results are released to every applicant at the same time.',
  Approved: 'Approved and awaiting release of results.',
  Released: 'Results released. Open the application to review the outcome.',
  Rejected: 'The application was not accepted. No further action is needed for this application period.',
};

// Results reach every applicant of a scholarship at the same time (Consultation
// 2, #8 and #13): until the Admissions Office Head releases them, an Approved
// application and a Rejected one both read "Under deliberation" on the student's
// own surfaces, and no notice is sent. A Rejected application is unmasked once a
// `results_releases` row covers it. This is a display hold: the stored status
// stays the authority for every staff surface and policy.
export const STUDENT_DELIBERATION_STATUS = 'Under deliberation';

export const isApplicationResultReleased = (application = {}, resultsReleases = []) => (
  (Array.isArray(resultsReleases) ? resultsReleases : [])
    .some((release) => Array.isArray(release?.applicationIds) && release.applicationIds.includes(application.id))
);

export const getStudentFacingStatus = (application = {}, resultsReleases = []) => {
  const status = application?.status;
  if (status === 'Approved') return STUDENT_DELIBERATION_STATUS;
  if (status === 'Rejected' && !isApplicationResultReleased(application, resultsReleases)) return STUDENT_DELIBERATION_STATUS;
  return status;
};

// The student's own copy of an application while its result is held: the
// status reads "Under deliberation" and the held Approved/Rejected entries drop
// out of the timeline and the status log, so no surface built on the record can
// reveal the outcome early. A released result passes through unchanged.
const HELD_RESULT_STATUSES = ['Approved', 'Rejected'];

export const maskApplicationForStudent = (application, resultsReleases = []) => {
  if (!application) return application;
  const status = getStudentFacingStatus(application, resultsReleases);
  if (status === application.status) return application;
  return {
    ...application,
    status,
    statusLog: (Array.isArray(application.statusLog) ? application.statusLog : [])
      .filter((entry) => !HELD_RESULT_STATUSES.includes(entry?.toStatus)),
    timeline: (Array.isArray(application.timeline) ? application.timeline : [])
      .filter((entry) => !HELD_RESULT_STATUSES.includes(entry?.stage)),
  };
};

export const getApplicationStatusGuidance = (status) => applicationStatusGuidance[status] || '';

// The StatusBadge tone used wherever an application status is displayed in the
// Admissions Office workspace.
export const getStatusTone = (status) => {
  if (status === 'Rejected') return 'danger';
  if (['Released', 'Approved'].includes(status)) return 'success';
  if (['For Verification', 'For Endorsement', 'Endorsed', 'Under deliberation'].includes(status)) return 'warning';
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
  'admin-intake',
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

// The open office queue. Staff read it without acting; `Recommended` waits on the
// school's approver and `Approved` sits in the Head's release lane.
export const ADMISSIONS_REVIEW_EXCLUDED_STATUSES = ['Draft', 'Approved', 'Released', 'Rejected'];
export const ADMISSIONS_STAFF_EXCLUDED_STATUSES = [...ADMISSIONS_REVIEW_EXCLUDED_STATUSES, 'Recommended'];

// The role-aware "applications to review" count shown on the dashboard.
//   - Student: their own live applications (not Rejected or Approved).
//   - Admissions Office Staff: the open office queue, read-only.
//   - Admissions Office Head: verification, legacy endorsement, and the final
//     check before release.
//   - Interviewer: the in-scope cases waiting for, or in, the interview.
//   - Chairperson / Assistant Dean / Dean: the in-scope interview work plus the
//     recommendations waiting for a decision.
export const countApplicationsToReview = (applications = [], { role, studentId, department, reviewScope, programs } = {}) => {
  const list = Array.isArray(applications) ? applications : [];

  if (isAdmissionsStaffRole(role)) {
    return list.filter((entry) => !ADMISSIONS_STAFF_EXCLUDED_STATUSES.includes(entry.status)).length;
  }

  if (isAdmissionsHeadRole(role)) {
    return list.filter((entry) => ADMISSIONS_HEAD_DECISION_STATUSES.includes(entry.status)).length;
  }

  if (isReviewerRole(role)) {
    // `reviewScope` may be the already-normalised scope (with a `level`) or the
    // reviewer's profile fields; normalise the latter here.
    const scope = reviewScope?.level ? reviewScope : getReviewerScope({ role, department, ...(reviewScope || {}) });
    const programIndex = buildProgramScopeIndex(programs);
    const statuses = isInterviewerRole(role) ? ['Endorsed', 'Interview'] : ['Endorsed', 'Interview', 'Recommended'];
    return list.filter((entry) => (
      isApplicationInReviewerScope(entry, scope, programIndex)
      && statuses.includes(entry.status)
    )).length;
  }

  return list.filter((entry) => (
    entry.studentId === studentId
    && entry.status !== 'Rejected'
    && entry.status !== 'Approved'
  )).length;
};

export const sopStageIndex = (status) => {
  const index = sopStages.indexOf(status === 'For Endorsement' ? 'For Verification' : status);
  return index === -1 ? null : index;
};

export const departmentReviewStatuses = ['For Endorsement', 'Pending Documents', 'Endorsed', 'Returned'];

export const verificationStatuses = ['Pending', 'Verified', 'Rejected'];

// How a Document Vault decision reads on screen. The stored value stays
// `Rejected` — the check constraint, the replace-in-place RPC, the verification
// gate, and every trigger read it — and only the label translates, exactly as
// `Endorsed` is displayed as "For Interview". "Reverted for resubmission" is the
// office's own wording for the decision (Consultation 2, request #3), and the
// recorded reason stays visible because it tells the student what to correct.
export const documentStatusLabels = { Rejected: 'Reverted for resubmission' };
export const getDocumentStatusLabel = (status) => documentStatusLabels[status] || status;

// Statuses in which a student may replace a Rejected file on a submitted
// application. After For Verification every attached file is Verified, so a
// rejected file cannot exist there. Mirrors replace_rejected_application_document
// (20261021000000).
export const DOCUMENT_REPLACEMENT_STATUSES = ['Submitted', 'Under Review', 'For Verification'];

// Preset reasons the Admissions Office picks from when reverting a Document
// Vault file for resubmission. "Other" carries no preset text, so its note is
// required. The stored decision stays `Rejected`.
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
  // The two pages of the application that must stay on paper: printed from
  // Print application form, signed, then uploaded.
  { value: 'Barangay Residence Certification', label: 'Barangay Certification of Residence' },
  { value: 'Signed Affidavit of Agreement', label: 'Signed Affidavit of Agreement' },
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
  // Proof of the address and family answers. Both are asked for by every
  // in-scope track (DEFAULT_REQUIRED_DOCUMENTS in src/lib/applicationRequirements.js);
  // the barangay certificate answers both groups at once, which is why it is
  // listed under each of them in the vault's picker.
  { value: 'Proof of Billing', label: 'Proof of Billing' },
  { value: 'Certificate of Residency', label: 'Certificate of Residency (Barangay)' },
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

