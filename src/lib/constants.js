import { buildProgramScopeIndex, getReviewerScope, isApplicationInReviewerScope, isInterviewerRole, isReviewerRole } from './reviewScope';

export const coverageTypes = ['all', 'Full Tuition', 'Partial Tuition', 'Allowance'];
export const applicationStatuses = ['Draft', 'Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Waitlisted', 'Released', 'Declined', 'Rejected'];

// Standard Procedure for Scholarship Applications stage sequence (SOP steps 3-8),
// as the Admissions Office runs it since Consultation 2. Step 2 (Submission) maps
// to `Submitted`, step 3 (Document Verification) to `For Verification`, the
// Admin's forward to the interviewer (the former step-4 endorsement) to `Endorsed`
// (shown "For Interview"), step 5 (Interview) to `Interview`, the interviewer's
// recommendation to `Recommended`, the school's approval to `Approved`, and the
// Admin's release to `Released`. `For Endorsement` survives only on rows handed
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
  Recommended: ['Approved', 'Waitlisted', 'Rejected'],
  Approved: ['Released'],
  // The waitlist, a promotion, and a recorded decline are the Admin's moves
  // (roleNextStatusMap); a student answers an offer only through the RPCs.
  Waitlisted: [],
  Released: [],
  Declined: [],
  Rejected: [],
};

// Stage authority follows the process the Admissions Office described at
// Consultation 2 (Oct 27): the Admin verifies every file and forwards the case to
// the interviewer, an interviewer (or a ladder account in scope that runs the
// interview itself) schedules and recommends, the school's approving level
// approves, and the Admin does the final check and releases. Staff keep a
// read-only office view. App.jsx's changeApplicationStatus guard, the review
// modal's action bar, and the database trigger
// (20261050000001_lane_transitions_by_flow_role.sql) all read this one map.
export const ADMISSIONS_OFFICE_ROLES = ['admissions_office', 'admissions_admin'];

// The Admin's own decisions: the final check before release (Approved), plus the
// legacy endorsement rows still waiting at For Endorsement.
export const ADMISSIONS_APPROVAL_STATUSES = ['Approved'];
export const ADMISSIONS_ADMIN_DECISION_STATUSES = ['Submitted', 'Under Review', 'For Verification', 'For Endorsement', ...ADMISSIONS_APPROVAL_STATUSES];

export const isAdmissionsStaffRole = (role) => role === 'admissions_office';
export const isAdmissionsAdminRole = (role) => role === 'admissions_admin';
export const isAdmissionsReviewerRole = (role) => ADMISSIONS_OFFICE_ROLES.includes(role);

const roleNextStatusMap = {
  // Read-only: Staff are not part of the application process any more.
  admissions_office: {},
  admissions_admin: {
    Submitted: ['Under Review', 'For Verification', 'Rejected'],
    'Under Review': ['For Verification', 'Rejected'],
    // Once every file is Verified the Admin forwards the case straight to the
    // interviewer; the separate endorsement hand-off is retired.
    'For Verification': ['Endorsed', 'Rejected'],
    // Legacy rows handed off before the change can still leave the stage.
    'For Endorsement': ['Endorsed', 'Rejected'],
    // Superset override on the interview and approval moves.
    Endorsed: ['Interview', 'Rejected'],
    Interview: ['Recommended', 'Rejected'],
    Recommended: ['Approved', 'Waitlisted', 'Rejected'],
    // The final check before release: a sibling already on a grant or a pending
    // case ends the application here.
    Approved: ['Released', 'Rejected'],
    // The waitlist after the offers are released: "Offer to next" promotes the
    // top-ranked case (Released), the Admin can close one as Not accepted, and a
    // student's withdrawal given outside the app is recorded as Declined. All
    // three run from the release page (RESULTS_LANE_STATUSES), never the modal.
    Waitlisted: ['Released', 'Rejected', 'Declined'],
    // An accepted applicant who turns the award down.
    Released: ['Declined'],
  },
};

// Moves that belong to the Admin's release page (offers, promotions, recorded
// responses) and are therefore never rendered in the review modal's action bar.
export const RESULTS_LANE_STATUSES = ['Released', 'Declined'];

// A scoped reviewer's moves depend on the case, not only the role: any reviewer
// in scope may schedule, only a panel member recommends, and only the approving
// level approves. `context` carries those two facts (App.jsx `stageContextFor`).
const reviewerNextStatuses = (status, role, { isPanelist = false, isApprover = false } = {}) => {
  if (status === 'Endorsed') return ['Interview'];
  if (status === 'Interview') return isPanelist ? ['Recommended'] : [];
  if (status === 'Recommended' && role !== 'interviewer' && isApprover) return ['Approved', 'Waitlisted', 'Rejected'];
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
// Admissions Office workspace joins the Admin to the case, and joining is the one
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
  // The Admin forwards a verified case to the interviewers of its scope.
  Endorsed: 'Forward to interview',
  Interview: 'Schedule interview',
  Recommended: 'Recommend for approval',
  Approved: 'Approve',
  Waitlisted: 'Waitlist…',
  Released: 'Release results',
  Declined: 'Record declined',
  Rejected: 'Mark not accepted…',
};

// Scheduling and the recommendation belong to the interviewers of the applicant's
// scope, and the approval to the school's approving level (Consultation 2). The
// Admin can still make those moves, so the Admin's button says it is an override
// rather than the usual next step. Authority is unchanged.
const adminOverrideLabels = {
  Interview: 'Schedule as Admin (override)',
  Recommended: 'Recommend as Admin (override)',
  Approved: 'Approve as Admin (override)',
  Waitlisted: 'Waitlist as Admin (override)…',
};

export const isAdminOverrideAction = (status, role) => (
  role === 'admissions_admin' && Object.prototype.hasOwnProperty.call(adminOverrideLabels, status)
);

export const getStageActionLabel = (status, role) => (
  isAdminOverrideAction(status, role) ? adminOverrideLabels[status] : stageActionLabels[status] || status
);

// The one sentence a student is told when an application is rejected (FORM
// 230-SCH affidavit clause 6: the results and the minutes of the deliberations
// are confidential), and the prefix that files the recorded reason in the
// staff-only `application_review_comments` thread instead. The reason never
// reaches a student-readable column, so the timeline note and the status log's
// derived reason both carry this notice. Document resubmission reasons stay
// student-visible: they tell the student what to correct.
export const APPLICATION_REJECTION_NOTICE = 'Application not accepted.';
export const APPLICATION_REJECTION_REASON_PREFIX = 'Rejection reason — ';

// The waitlist works the same way: the timeline carries this fixed notice and the
// approver's optional note is filed in the staff-only thread with this prefix.
export const APPLICATION_WAITLIST_NOTICE = 'Placed on the waitlist.';
export const APPLICATION_WAITLIST_NOTE_PREFIX = 'Waitlist note — ';

// An application the Admissions Office Admin opens for a student who does not
// meet a qualification rule (open_application_for_student). The reason is filed
// in the same staff-only thread with this prefix; the student sees only that the
// office opened the application. Keep the prefix identical to the RPC's.
export const APPLICATION_ELIGIBILITY_EXCEPTION_PREFIX = 'Eligibility exception — ';
export const ELIGIBILITY_EXCEPTION_REASONS = [
  { value: 'recommended', label: 'Recommended by faculty or the department' },
  { value: 'borderline', label: 'Borderline academic standing' },
  { value: 'financial-need', label: 'Financial need warrants review' },
  { value: 'other', label: 'Other', requiresNotes: true },
];

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
  // The held results never reach a student before release
  // (getStudentFacingStatus): "Under deliberation" or "Processed" stands in.
  'Under deliberation': 'Your school and the Admissions Office are deciding. Results are released to every applicant at the same time.',
  Processed: 'The Admissions Office has finished processing this application. Results are released to every applicant of this scholarship at the same time.',
  Approved: 'Approved and awaiting release of results.',
  Waitlisted: 'You are on the waitlist. You may still be offered this scholarship if a slot opens, and you will be notified if it does.',
  Released: 'You were accepted. Open the application to confirm or decline the award.',
  Declined: 'You declined this scholarship. No further action is needed.',
  Rejected: 'The application was not accepted for this application period. No further action is needed.',
};

// Results reach every applicant of a scholarship together (Consultation 2, #8
// and #13), in two waves: the Admissions Office Admin first releases the
// accepted and waitlisted applicants (results_releases.kind = 'offers'), and
// sends the Not accepted letters only when it closes the round once the accepted
// applicants have confirmed (kind = 'closing'; rows recorded before the
// waitlist are 'legacy' and behave like a closing). Until then a held outcome
// reads "Under deliberation" on the student's own surfaces, or "Processed" for a
// case the office closed before the interview, and no notice is sent. This is a
// display hold: the stored status stays the authority for every staff surface
// and policy.
export const STUDENT_DELIBERATION_STATUS = 'Under deliberation';
export const STUDENT_PROCESSED_STATUS = 'Processed';

// The stages a case closed "early" can leave from: the office ended it before
// the interview (an incomplete or ineligible application), not the school after
// deliberation.
const EARLY_CLOSURE_FROM_STATUSES = ['Draft', 'Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed'];

const releaseKindOf = (release) => release?.kind || 'legacy';
const releasesCovering = (application, resultsReleases) => (
  (Array.isArray(resultsReleases) ? resultsReleases : [])
    .filter((release) => Array.isArray(release?.applicationIds) && release.applicationIds.includes(application?.id))
);

// True once a release of the given kinds covers the application. With no kinds,
// any release counts.
export const isApplicationResultReleased = (application = {}, resultsReleases = [], kinds = null) => (
  releasesCovering(application, resultsReleases)
    .some((release) => !kinds || kinds.includes(releaseKindOf(release)))
);

// A Not accepted letter goes out with a closing (or pre-waitlist legacy) release;
// the offers release never covers a Rejected case.
export const isNotAcceptedReleased = (application, resultsReleases) => (
  isApplicationResultReleased(application, resultsReleases, ['closing', 'legacy'])
);

export const isWaitlistReleased = (application, resultsReleases) => (
  isApplicationResultReleased(application, resultsReleases, ['offers'])
);

// The stage the case was at when it was closed as Not accepted: the status log
// when it is loaded, otherwise the timeline entry before the closing one.
export const getNotAcceptedFromStatus = (application = {}) => {
  const log = Array.isArray(application?.statusLog) ? application.statusLog : [];
  for (let index = log.length - 1; index >= 0; index -= 1) {
    if (log[index]?.toStatus === 'Rejected') return log[index].fromStatus || null;
  }
  const timeline = Array.isArray(application?.timeline) ? application.timeline : [];
  for (let index = timeline.length - 1; index > 0; index -= 1) {
    if (timeline[index]?.stage === 'Rejected') return timeline[index - 1]?.stage || null;
  }
  return null;
};

export const isEarlyClosure = (application) => EARLY_CLOSURE_FROM_STATUSES.includes(getNotAcceptedFromStatus(application));

export const getStudentFacingStatus = (application = {}, resultsReleases = []) => {
  const status = application?.status;
  if (status === 'Approved') return STUDENT_DELIBERATION_STATUS;
  if (status === 'Waitlisted') {
    return isWaitlistReleased(application, resultsReleases) ? 'Waitlisted' : STUDENT_DELIBERATION_STATUS;
  }
  if (status === 'Rejected' && !isNotAcceptedReleased(application, resultsReleases)) {
    // A waitlisted student whose place the Admin closed keeps reading
    // "Waitlisted" until the round closes and the letters go out.
    if (getNotAcceptedFromStatus(application) === 'Waitlisted' && isWaitlistReleased(application, resultsReleases)) return 'Waitlisted';
    return isEarlyClosure(application) ? STUDENT_PROCESSED_STATUS : STUDENT_DELIBERATION_STATUS;
  }
  return status;
};

// The student's own copy of an application while its result is held: the
// status reads the stand-in above and the held entries drop out of the timeline
// and the status log, so no surface built on the record can reveal the outcome
// early. A released result passes through unchanged.
const HELD_RESULT_STATUSES = ['Approved', 'Waitlisted', 'Rejected'];

export const maskApplicationForStudent = (application, resultsReleases = []) => {
  if (!application) return application;
  const status = getStudentFacingStatus(application, resultsReleases);
  if (status === application.status) return application;
  // A released waitlist entry stays in the history; everything held drops out.
  const keep = (value) => !HELD_RESULT_STATUSES.includes(value) || (value === 'Waitlisted' && status === 'Waitlisted');
  return {
    ...application,
    status,
    statusLog: (Array.isArray(application.statusLog) ? application.statusLog : [])
      .filter((entry) => keep(entry?.toStatus)),
    timeline: (Array.isArray(application.timeline) ? application.timeline : [])
      .filter((entry) => keep(entry?.stage)),
  };
};

// The label a student reads for their own (masked) application status:
// "Accepted" for a released result and "Not accepted" for a released
// non-acceptance; never the stored word.
export { getStudentApplicationStatusLabel } from '../../supabase/functions/_shared/applicationStatus.js';

// The status values a student can see on their own applications, in pipeline
// order, for the Applications filter. Approved never reaches a student.
export const studentApplicationStatuses = [
  'Draft', 'Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended',
  STUDENT_DELIBERATION_STATUS, STUDENT_PROCESSED_STATUS, 'Waitlisted', 'Released', 'Declined', 'Rejected',
];

export const getApplicationStatusGuidance = (status) => applicationStatusGuidance[status] || '';

// The StatusBadge tone used wherever an application status is displayed in the
// Admissions Office workspace.
export const getStatusTone = (status) => {
  if (status === 'Rejected') return 'danger';
  if (status === 'Declined') return 'neutral';
  if (['Released', 'Approved'].includes(status)) return 'success';
  if (['For Verification', 'For Endorsement', 'Endorsed', 'Under deliberation', 'Waitlisted'].includes(status)) return 'warning';
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
  'admin-statistics',
  'admin-announcements',
  'admin-accounts',
  'review',
  'chair-calendar',
  'chair-interviews',
  'chair-statistics',
  'profile',
  'settings',
];

// The open office queue. Staff read it without acting; `Recommended` waits on the
// school's approver and `Approved` sits in the Admin's release lane.
export const ADMISSIONS_REVIEW_EXCLUDED_STATUSES = ['Draft', 'Approved', 'Released', 'Rejected'];
export const ADMISSIONS_STAFF_EXCLUDED_STATUSES = [...ADMISSIONS_REVIEW_EXCLUDED_STATUSES, 'Recommended'];

// The role-aware "applications to review" count shown on the dashboard.
//   - Student: their own live applications (not Rejected or Approved).
//   - Admissions Office Staff: the open office queue, read-only.
//   - Admissions Office Admin: verification, legacy endorsement, and the final
//     check before release.
//   - Interviewer: the in-scope cases waiting for, or in, the interview.
//   - Chairperson / Assistant Dean / Dean: the in-scope interview work plus the
//     recommendations waiting for a decision.
export const countApplicationsToReview = (applications = [], { role, studentId, department, reviewScope, programs } = {}) => {
  const list = Array.isArray(applications) ? applications : [];

  if (isAdmissionsStaffRole(role)) {
    return list.filter((entry) => !ADMISSIONS_STAFF_EXCLUDED_STATUSES.includes(entry.status)).length;
  }

  if (isAdmissionsAdminRole(role)) {
    return list.filter((entry) => ADMISSIONS_ADMIN_DECISION_STATUSES.includes(entry.status)).length;
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

// `For Endorsement` sits with verification, and a waitlisted case has reached
// the school's decision, so it sits with Approved. Declined, like Not accepted,
// has left the pipeline.
const SOP_STAGE_ALIASES = { 'For Endorsement': 'For Verification', Waitlisted: 'Approved' };

export const sopStageIndex = (status) => {
  const index = sopStages.indexOf(SOP_STAGE_ALIASES[status] || status);
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

