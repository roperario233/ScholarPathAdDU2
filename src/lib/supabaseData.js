import { hasSupabaseConfig, supabase } from './supabaseClient';
import { isHierarchyProgram } from './academicPrograms';
import { isReviewerRole } from './reviewScope';
import { DOCUMENT_BUCKET, buildDocumentStoragePath } from './documentStorage';
import { AVATAR_BUCKET, buildAvatarStoragePath } from './avatarStorage';

const toScholarship = (row) => ({
  ...row,
  minimumQpi: row.minimum_qpi,
  minimumShsAverage: row.minimum_shs_average,
  maximumIncome: row.maximum_income,
  eligibleDegrees: row.eligible_degrees || [],
  allowsMultipleGrants: row.allows_multiple_grants,
  departmentScope: row.department_scope,
  isActive: row.is_active,
  coverageType: row.coverage_type,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ruleFamily: row.rule_family,
  govProgram: row.gov_program,
  isMatchable: row.is_matchable,
  applicationRoute: row.application_route,
  isExternal: row.is_external,
  appendixNumber: row.appendix_number,
  requiredDocuments: Array.isArray(row.required_documents) ? row.required_documents : [],
});

const toDocument = (row) => ({
  ...row,
  ownerId: row.owner_id,
  fileName: row.file_name,
  documentType: row.document_type,
  verificationStatus: row.verification_status,
  rejectionReason: row.rejection_reason ?? '',
  linkedAttributes: row.linked_attributes || [],
  attestedValues: row.attested_values || {},
  storagePath: row.storage_path,
  sharedWith: row.shared_with || [],
  uploadedAt: row.uploaded_at,
  // The current review decision: when it was made and which Admissions Office
  // account recorded it (stamped by the trigger, see
  // 20261027000000_add_document_decision_actor.sql). A Pending file carries no
  // decision; a file decided before that migration carries none either.
  decidedAt: row.verification_decided_at ?? null,
  reviewedBy: row.reviewed_by ?? null,
  reviewedByRole: row.reviewed_by_role ?? null,
});

const toApplication = (row, scholarshipById, documentIdsByApplication, studentById = {}, statusLogByApplication = {}) => {
  const student = studentById[row.student_id] || {};
  return {
    ...row,
    studentId: row.student_id,
    scholarshipId: row.scholarship_id,
    scholarshipTitle: scholarshipById[row.scholarship_id]?.title || 'Scholarship application',
    documentStatus: row.document_status,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    attachedDocuments: documentIdsByApplication[row.id] || [],
    studentName: student.full_name || 'Student applicant',
    studentProgram: student.degree_program || '',
    // The profile's stored school. The academic department and cluster are derived
    // from the program through the taxonomy (src/lib/reviewScope.js), so a student
    // who changes program changes department without a second column to keep in step.
    studentSchool: student.department || '',
    studentQpi: student.qpi ?? null,
    studentHouseholdIncome: student.household_income ?? null,
    endorsement: row.endorsement ?? null,
    interview: row.interview ?? null,
    deliberation: row.deliberation ?? null,
    release: row.release ?? null,
    timeline: Array.isArray(row.timeline) ? row.timeline : [],
    statement: row.statement ?? '',
    profileSnapshot: row.profile_snapshot ?? null,
    certifiedAt: row.certified_at ?? null,
    // The append-only audit history (application_status_log). Empty when the
    // migration is pending or no status change has been logged yet.
    statusLog: statusLogByApplication[row.id] || [],
  };
};

// School -> Cluster -> Department -> Degree program. `school` is the value
// `profiles.department` stores and `department` is what the reviewer scope ladder
// resolves against, so both must survive the row mapping.
const toAcademicProgram = (row) => ({
  id: row.id,
  value: row.value,
  label: row.label,
  school: row.school || '',
  cluster: row.cluster || '',
  department: row.department || '',
});

const toAnnouncement = (row) => ({ ...row, createdAt: row.created_at });
const toCustomDeadline = (row) => ({
  id: row.id,
  title: row.title,
  deadline: row.deadline,
  createdAt: row.created_at,
});
// Office planning entries on the Admissions Office calendar. The Head publishes
// them; both office lanes and Department Chairs read them, and a student session
// never loads them.
const toOfficeCalendarEntry = (row) => ({
  id: row.id,
  title: row.title,
  entryDate: row.entry_date,
  kind: row.kind || 'office',
  notes: row.notes || '',
  createdBy: row.created_by ?? null,
  createdAt: row.created_at,
});
// SOP step 7 routing: which ladder level approves for a school or cluster
// (20261050000000_interviewer_role_and_approval_routing.sql).
const toApprovalLevel = (row) => ({
  id: row.id,
  school: row.school,
  cluster: row.cluster || '',
  approverRole: row.approver_role,
  updatedAt: row.updated_at,
});
// One batch release of a scholarship's results (20261050000002_add_results_releases.sql).
const toResultsRelease = (row) => ({
  id: row.id,
  scholarshipId: row.scholarship_id,
  releasedAt: row.released_at,
  releasedBy: row.released_by ?? null,
  applicantCount: row.applicant_count ?? 0,
  acceptedCount: row.accepted_count ?? 0,
  applicationIds: Array.isArray(row.application_ids) ? row.application_ids : [],
});
const toNotification = (row) => ({ ...row, profileId: row.profile_id, createdAt: row.created_at });
const toDepartmentReview = (row) => ({
  ...row,
  applicationId: row.application_id,
  studentName: row.student_name,
  householdIncome: row.household_income,
  createdAt: row.created_at,
});

// The internal reviewer thread for one application (application_review_comments).
// Students never receive these rows; the RLS policies scope staff access.
const toReviewComment = (row) => ({
  id: row.id,
  applicationId: row.application_id,
  authorId: row.author_id,
  authorRole: row.author_role,
  authorName: row.author_name,
  body: row.body,
  createdAt: row.created_at,
});

// The Admissions Office case-officer roster (application_case_officers). Staff
// only: the student never learns which officer opened their application, so these
// rows are never merged into an application object.
const toCaseOfficer = (row) => ({
  id: row.id,
  applicationId: row.application_id,
  officerId: row.officer_id || null,
  officerName: row.officer_name || 'Admissions Office reviewer',
  officerRole: row.officer_role || '',
  joinedAt: row.joined_at,
  leftAt: row.left_at || null,
  leftReason: row.left_reason || '',
});

// SOP step 5 (20261029000000_overhaul_interview_stage.sql). Locations are read by
// the Admissions Office; panel membership and evaluation notes are staff-only,
// and the RLS policies scope a Department Chair to their own department.
const toInterviewLocation = (row) => ({
  id: row.id,
  name: row.name,
  building: row.building || '',
  room: row.room || '',
  notes: row.notes || '',
  isActive: row.is_active !== false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toInterviewPanelist = (row, nameById = {}) => ({
  id: row.id,
  applicationId: row.application_id,
  profileId: row.profile_id || null,
  guestName: row.guest_name || '',
  guestEmail: row.guest_email || '',
  isLead: Boolean(row.is_lead),
  removedAt: row.removed_at || null,
  name: row.profile_id ? (nameById[row.profile_id] || 'Department Chair') : (row.guest_name || 'Faculty guest'),
});

const toInterviewNote = (row, nameById = {}) => ({
  id: row.id,
  applicationId: row.application_id,
  authorId: row.author_id,
  authorRole: row.author_role,
  authorName: nameById[row.author_id] || null,
  // The panel's recommendation (SOP step 6 input). `rating` stays for notes
  // recorded before recommendation levels existed.
  recommendationLevel: row.recommendation_level ?? null,
  rating: row.rating ?? null,
  body: row.body,
  createdAt: row.created_at,
});

// Reviewer accounts read a scoped slice of the office workflow. The academic
// ladder (Dean, Assistant Dean, Chairperson) and the interviewer are scoped to the
// hierarchy; the two Admissions Office lanes read every case.
const STAFF_ROLES = ['admissions_office', 'admissions_head', 'dean', 'assistant_dean', 'department_chair', 'interviewer'];

const ensureReady = () => hasSupabaseConfig && supabase;

export const loadSupabaseWorkspace = async ({ role, userId, department }) => {
  if (!ensureReady()) return { success: false, fallback: true };

  const [scholarshipsResult, applicationsResult, documentsResult, announcementsResult, notificationsResult, reviewsResult, deadlinesResult, profilesResult, officeEntriesResult, approvalLevelsResult, resultsReleasesResult] = await Promise.all([
    supabase.from('scholarships').select('*').order('deadline', { ascending: true }),
    supabase.from('applications').select('*').order('updated_at', { ascending: false }),
    supabase.from('documents').select('*').order('uploaded_at', { ascending: false }),
    supabase.from('announcements').select('*').order('created_at', { ascending: false }),
    supabase.from('notifications').select('*').eq('profile_id', userId).order('created_at', { ascending: false }),
    isReviewerRole(role)
      ? supabase.from('department_reviews').select('*').eq('department', department).order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from('custom_deadlines').select('id, title, deadline, created_at').eq('owner_id', userId),
    // Staff queues need applicant context. students_read is limited to their own
    // profile by RLS, so this select is safe for every role.
    supabase.from('profiles').select('user_id, full_name, role, department, degree_program, qpi, household_income, review_school, review_cluster, review_department'),
    // Office calendar planning entries are a staff-only slice. A student session
    // never asks for them, so they cannot leak into the student calendar.
    role === 'student'
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('office_calendar_entries').select('*').order('entry_date', { ascending: true }),
    // SOP step 7 routing, read by every staff role so a page lists exactly the
    // recommendations its account may approve.
    role === 'student'
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('approval_levels').select('*').order('school', { ascending: true }),
    // Every role reads the releases: a student's held result is unmasked by the
    // release that covers it, and the Head's release lane counts them.
    supabase.from('results_releases').select('*').order('released_at', { ascending: true }),
  ]);
  const failed = [scholarshipsResult, applicationsResult, documentsResult, announcementsResult, notificationsResult, reviewsResult, profilesResult].find((result) => result.error);
  if (failed) return { success: false, fallback: false, message: failed.error.message };

  // Pending-migration tolerance: an unavailable custom_deadlines table yields no
  // server-side deadlines rather than failing the whole workspace, so the
  // prototype still hydrates if the frontend ships ahead of the migration.
  const serverDeadlines = !deadlinesResult.error && Array.isArray(deadlinesResult.data)
    ? deadlinesResult.data.map(toCustomDeadline)
    : [];

  const scholarships = (scholarshipsResult.data || []).map(toScholarship);
  const scholarshipById = Object.fromEntries(scholarships.map((entry) => [entry.id, entry]));
  const documents = (documentsResult.data || []).map(toDocument);

  const studentById = Object.fromEntries((profilesResult.data || []).map((entry) => [entry.user_id, entry]));
  // Compact directory for staff views: enough to resolve a Document Vault
  // owner's name and school, and the declared values staff compare a proof file
  // against, without shipping the whole profile row.
  const students = Object.fromEntries((profilesResult.data || []).map((entry) => [entry.user_id, {
    fullName: entry.full_name || 'Student applicant',
    department: entry.department || '',
    degreeProgram: entry.degree_program || '',
    qpi: entry.qpi ?? null,
    householdIncome: entry.household_income ?? null,
  }]));
  const documentsWithOwners = documents.map((entry) => ({
    ...entry,
    ownerName: studentById[entry.ownerId]?.full_name || 'Student applicant',
    ownerDepartment: studentById[entry.ownerId]?.department || '',
    // The reviewer's name resolves for staff (staff_read_profiles) but not for a
    // student, whose profile read is scoped to their own row; the UI then falls
    // back to the recorded role, never the name.
    reviewedByName: studentById[entry.reviewedBy]?.full_name || null,
  }));
  const documentIdsByApplication = {};
  const applicationIds = (applicationsResult.data || []).map((entry) => entry.id);
  if (applicationIds.length) {
    const linksResult = await supabase.from('application_documents').select('application_id, document_id').in('application_id', applicationIds);
    if (linksResult.error) return { success: false, fallback: false, message: linksResult.error.message };
    (linksResult.data || []).forEach((link) => {
      documentIdsByApplication[link.application_id] = [...(documentIdsByApplication[link.application_id] || []), link.document_id];
    });
  }

  // The append-only status log is the audit history the review modal shows
  // (application_status_log, from 20261014000002). A pending migration yields no
  // rows rather than failing the whole workspace.
  const statusLogByApplication = {};
  if (applicationIds.length) {
    const logResult = await supabase
      .from('application_status_log')
      .select('id, application_id, from_status, to_status, actor_id, actor_role, reason, created_at')
      .in('application_id', applicationIds)
      .order('created_at', { ascending: true });
    if (!logResult.error) {
      (logResult.data || []).forEach((row) => {
        statusLogByApplication[row.application_id] = [
          ...(statusLogByApplication[row.application_id] || []),
          {
            id: row.id,
            applicationId: row.application_id,
            fromStatus: row.from_status,
            toStatus: row.to_status,
            actorId: row.actor_id,
            actorRole: row.actor_role,
            // Resolved from the profiles visible to the caller; a student sees
            // only their own profile, so the modal falls back to the role.
            actorName: studentById[row.actor_id]?.full_name || null,
            reason: row.reason,
            at: row.created_at,
          },
        ];
      });
    }
  }

  // The internal endorsement thread (application_review_comments, from
  // 20261023000000). Staff only: a student has no policy on the table. A pending
  // migration yields no rows rather than failing the whole workspace.
  let reviewComments = [];
  if (role !== 'student' && applicationIds.length) {
    const commentsResult = await supabase
      .from('application_review_comments')
      .select('id, application_id, author_id, author_role, author_name, kind, body, created_at')
      .in('application_id', applicationIds)
      .order('created_at', { ascending: true });
    if (!commentsResult.error) {
      reviewComments = (commentsResult.data || []).map(toReviewComment);
    }
  }

  // The Admissions Office case-officer roster (application_case_officers, from
  // 20261027043147). Admissions Office sessions only: the student and the
  // Department Chair never receive these rows. The roster is what splits the
  // shared intake pool from each officer's own review queue. A pending migration
  // yields no rows and reports caseOfficersReady: false, so the workspace can say
  // so instead of quietly treating every case as unopened.
  let caseOfficers = [];
  let caseOfficersReady = true;
  if (role !== 'student' && !isReviewerRole(role)) {
    const caseOfficersResult = await supabase
      .from('application_case_officers')
      .select('*')
      .is('left_at', null)
      .order('joined_at', { ascending: true });
    if (caseOfficersResult.error) {
      caseOfficersReady = false;
    } else {
      caseOfficers = (caseOfficersResult.data || []).map(toCaseOfficer);
    }
  }

  // SOP step 5 interview data. Staff only; a pending migration yields empty
  // lists rather than failing the whole workspace.
  const nameById = Object.fromEntries((profilesResult.data || []).map((entry) => [entry.user_id, entry.full_name || '']));
  // The staff accounts visible to this session: the interview panel picker draws the
  // Dean, Assistant Dean, and Chairperson whose scope covers the applicant from it
  // (SOP 5a), so each entry carries its review scope as well as its school.
  const staffDirectory = (profilesResult.data || [])
    .filter((entry) => STAFF_ROLES.includes(entry.role))
    .map((entry) => ({
      userId: entry.user_id,
      fullName: entry.full_name || 'Staff member',
      role: entry.role,
      department: entry.department || '',
      reviewSchool: entry.review_school || '',
      reviewCluster: entry.review_cluster || '',
      reviewDepartment: entry.review_department || '',
    }));
  let interviewLocations = [];
  let interviewPanelists = [];
  let interviewNotes = [];
  if (role !== 'student') {
    const [locationsResult, panelistsResult, notesResult] = await Promise.all([
      // Interviewers and ladder accounts schedule their own interviews, so they
      // read the saved venues too (Head-managed). Before the routing migration a
      // reviewer read is refused and the list stays empty; the typed location
      // field still works.
      supabase.from('interview_locations').select('*').order('name', { ascending: true }),
      applicationIds.length
        ? supabase.from('application_interview_panelists').select('*').in('application_id', applicationIds).is('removed_at', null)
        : Promise.resolve({ data: [], error: null }),
      applicationIds.length
        ? supabase.from('application_interview_notes').select('*').in('application_id', applicationIds).order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (!locationsResult.error) interviewLocations = (locationsResult.data || []).map(toInterviewLocation);
    if (!panelistsResult.error) interviewPanelists = (panelistsResult.data || []).map((row) => toInterviewPanelist(row, nameById));
    if (!notesResult.error) interviewNotes = (notesResult.data || []).map((row) => toInterviewNote(row, nameById));
  }

  return {
    success: true,
    fallback: false,
    scholarships,
    applications: (applicationsResult.data || []).map((entry) => toApplication(entry, scholarshipById, documentIdsByApplication, studentById, statusLogByApplication)),
    documents: documentsWithOwners,
    students,
    announcements: (announcementsResult.data || []).map(toAnnouncement),
    notifications: (notificationsResult.data || []).map(toNotification),
    departmentReviews: (reviewsResult.data || []).map(toDepartmentReview),
    reviewComments,
    staffDirectory,
    // Staff-only case-officer roster: which Admissions Office accounts have
    // opened which application. Empty for a student or Department Chair session.
    caseOfficers,
    caseOfficersReady,
    interviewLocations,
    interviewPanelists,
    interviewNotes,
    customDeadlines: serverDeadlines,
    // Pending-migration tolerance: without the routing migration the approval
    // levels are empty (every school defaults to the Chairperson) and no release
    // is recorded. `resultsReleasesReady` lets the student surfaces stop holding
    // results the project cannot release yet.
    approvalLevels: !approvalLevelsResult.error && Array.isArray(approvalLevelsResult.data)
      ? approvalLevelsResult.data.map(toApprovalLevel)
      : [],
    resultsReleases: !resultsReleasesResult.error && Array.isArray(resultsReleasesResult.data)
      ? resultsReleasesResult.data.map(toResultsRelease)
      : [],
    resultsReleasesReady: !resultsReleasesResult.error,
    // Pending-migration tolerance, like custom_deadlines: an unavailable table
    // yields an empty office calendar instead of failing the whole workspace.
    officeCalendarEntries: !officeEntriesResult.error && Array.isArray(officeEntriesResult.data)
      ? officeEntriesResult.data.map(toOfficeCalendarEntry)
      : [],
  };
};

export const loadSupabaseAcademicPrograms = async () => {
  if (!ensureReady()) return { success: false, fallback: true };

  const result = await supabase.from('academic_programs').select('*').order('sort_order', { ascending: true });
  if (result.error) return { success: false, fallback: false, message: result.error.message };

  const academicPrograms = (result.data || []).map(toAcademicProgram);
  // Pending-migration tolerance: a project whose `academic_programs` table has not
  // been migrated to the four-level hierarchy returns rows with no `school` or
  // `department`. Falling back to the bundled catalog keeps the academic profile
  // readable instead of painting empty school and department lines.
  if (academicPrograms.length && !academicPrograms.every(isHierarchyProgram)) {
    return { success: false, fallback: true };
  }

  return { success: true, fallback: false, academicPrograms };
};

export const createSupabaseScholarship = async (scholarship) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.from('scholarships').insert(scholarshipToRow(scholarship)).select('*').single();
  return { ...result, data: result.data ? toScholarship(result.data) : null };
};

export const updateSupabaseScholarship = async (scholarshipId, scholarship) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.from('scholarships').update({
    ...scholarshipToRow(scholarship),
    updated_at: new Date().toISOString(),
  }).eq('id', scholarshipId).select('*').single();
  return { ...result, data: result.data ? toScholarship(result.data) : null };
};

const scholarshipToRow = (scholarship) => ({
  title: scholarship.title,
  category: scholarship.category,
  origin: scholarship.origin || 'AdDU',
  coverage_type: scholarship.coverageType,
  coverage: scholarship.coverage,
  minimum_qpi: scholarship.minimumQpi == null || scholarship.minimumQpi === '' ? null : Number(scholarship.minimumQpi),
  minimum_shs_average: scholarship.minimumShsAverage == null || scholarship.minimumShsAverage === '' ? null : Number(scholarship.minimumShsAverage),
  maximum_income: scholarship.maximumIncome == null || scholarship.maximumIncome === '' ? null : Number(scholarship.maximumIncome),
  eligible_degrees: Array.isArray(scholarship.eligibleDegrees) ? scholarship.eligibleDegrees : [],
  allows_multiple_grants: scholarship.allowsMultipleGrants !== false,
  department_scope: scholarship.departmentScope || null,
  deadline: scholarship.deadline || null,
  is_active: scholarship.isActive !== false,
  tags: Array.isArray(scholarship.tags) ? scholarship.tags : [],
  rule_family: scholarship.ruleFamily,
  gov_program: scholarship.govProgram || null,
  is_matchable: scholarship.isMatchable !== false,
  application_route: scholarship.applicationRoute || null,
  is_external: false,
  appendix_number: scholarship.appendixNumber ?? null,
  required_documents: Array.isArray(scholarship.requiredDocuments) ? scholarship.requiredDocuments : [],
});

export const updateSupabaseApplicationStatus = (applicationId, status, timeline, stagePatch = {}) => (
  ensureReady() ? supabase.from('applications').update({
    ...stagePatch,
    status,
    updated_at: new Date().toISOString(),
    ...(Array.isArray(timeline) ? { timeline } : {}),
  }).eq('id', applicationId).then(({ error }) => ({ error })) : Promise.resolve({ error: null })
);

// Persists an SOP stage payload (endorsement, interview, deliberation, release)
// alongside the application status and timeline.
export const updateSupabaseApplicationStage = (applicationId, status, stagePatch = {}) => (
  ensureReady()
    ? supabase.from('applications').update({ status, updated_at: new Date().toISOString(), ...stagePatch }).eq('id', applicationId).then(({ error }) => ({ error }))
    : Promise.resolve({ error: null })
);

// The Admissions Office case-officer roster. Re-read after a join so the client
// sees every officer on the case, not only this tab's own write.
export const loadSupabaseApplicationCaseOfficers = async () => {
  if (!ensureReady()) {
    return { caseOfficers: [], error: { message: 'Supabase is not configured.' } };
  }
  const result = await supabase
    .from('application_case_officers')
    .select('*')
    .is('left_at', null)
    .order('joined_at', { ascending: true });
  return {
    caseOfficers: result.error ? [] : (result.data || []).map(toCaseOfficer),
    error: result.error,
  };
};

// join_application_review (20261027043147): joins the signed-in Admissions Office
// account to the case and starts the review when the application is still
// Submitted. Idempotent, so re-opening a case writes nothing. Returns the updated
// application row.
export const joinSupabaseApplicationReview = (applicationId) => (
  ensureReady()
    ? supabase.rpc('join_application_review', { p_application_id: applicationId })
    : Promise.resolve({ data: null, error: { message: 'Supabase is not configured.' } })
);

// leave_application_review: removes the signed-in officer from the roster with a
// recorded reason. The application keeps its status.
export const leaveSupabaseApplicationReview = (applicationId, reason) => (
  ensureReady()
    ? supabase.rpc('leave_application_review', { p_application_id: applicationId, p_reason: reason }).then(({ error }) => ({ error }))
    : Promise.resolve({ error: { message: 'Supabase is not configured.' } })
);

// The internal endorsement thread. The Admissions Office and the Department
// Chair write into one append-only case file per application; RLS rejects a
// student and a Chair outside their department, so the browser never decides who
// may read the thread.
export const createSupabaseReviewComment = async ({ applicationId, authorId, authorRole, authorName, body }) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.from('application_review_comments').insert({
    application_id: applicationId,
    author_id: authorId,
    author_role: authorRole,
    author_name: authorName || 'Reviewer',
    body,
  }).select('*').single();
  return { ...result, data: result.data ? toReviewComment(result.data) : null };
};

// Interview locations are managed by the Admissions Office Head; RLS refuses
// every other role. Archiving (isActive false) replaces deletion.
export const saveSupabaseInterviewLocation = async (location) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const row = {
    name: String(location.name || '').trim(),
    building: String(location.building || '').trim() || null,
    room: String(location.room || '').trim() || null,
    notes: String(location.notes || '').trim() || null,
    is_active: location.isActive !== false,
  };
  const query = location.id
    ? supabase.from('interview_locations').update({ ...row, updated_at: new Date().toISOString() }).eq('id', location.id)
    : supabase.from('interview_locations').insert(row);
  const result = await query.select('*').single();
  return { ...result, data: result.data ? toInterviewLocation(result.data) : null };
};

// Replaces an application's interview panel. The previous members are
// soft-removed (removed_at) rather than deleted, so who sat on an earlier panel
// stays on record; the database checks each account panelist against the
// applicant's school (validate_interview_panelist, SOP 5a).
export const replaceSupabaseInterviewPanel = async (applicationId, panel = [], nameById = {}) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const removed = await supabase
    .from('application_interview_panelists')
    .update({ removed_at: new Date().toISOString() })
    .eq('application_id', applicationId)
    .is('removed_at', null);
  if (removed.error) return { data: null, error: removed.error };
  if (!panel.length) return { data: [], error: null };
  const inserted = await supabase
    .from('application_interview_panelists')
    .insert(panel.map((member) => ({
      application_id: applicationId,
      profile_id: member.profileId || null,
      guest_name: member.profileId ? null : (member.guestName || null),
      guest_email: member.profileId ? null : (member.guestEmail || null),
      is_lead: Boolean(member.isLead),
    })))
    .select('*');
  return { data: (inserted.data || []).map((row) => toInterviewPanelist(row, nameById)), error: inserted.error };
};

export const createSupabaseInterviewNote = async ({ applicationId, authorId, authorRole, authorName, recommendationLevel = null, rating = null, body }) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.from('application_interview_notes').insert({
    application_id: applicationId,
    author_id: authorId,
    author_role: authorRole,
    recommendation_level: recommendationLevel ?? null,
    rating: rating ?? null,
    body,
  }).select('*').single();
  return { ...result, data: result.data ? toInterviewNote(result.data, { [authorId]: authorName }) : null };
};

// Department review records mirror historical Department Chair decisions for
// schema-level auditing. Endorsement is now the Admissions Office Head's
// decision and is recorded on the application itself, so nothing writes here for
// a new case. Kept async so it always returns a real Promise: a Postgrest builder
// is only a thenable (no .catch/.finally), and a fire-and-forget caller needs
// .catch.
export const upsertSupabaseDepartmentReview = async ({ applicationId, reviewerId, studentName, department, qpi, householdIncome, status, recommendation }) => {
  if (!ensureReady()) return { data: null, error: null };
  return supabase.from('department_reviews').upsert({
    application_id: applicationId,
    reviewer_id: reviewerId,
    student_name: studentName || 'Student applicant',
    department: department || 'Unassigned',
    qpi: qpi ?? 0,
    household_income: householdIncome ?? 0,
    status,
    recommendation: recommendation || recommendationNote(status),
  }, { onConflict: 'application_id,reviewer_id' }).select().single();
};

const recommendationNote = (status) => (
  status === 'Endorsed'
    ? 'Endorsed by the Office of Admissions & Aid.'
    : 'Returned for central document validation.'
);

// The client generates the application id (a real uuid, like vault documents)
// so the local row, the Supabase row, and its document links share it from the
// start and a submit right after creation targets the right row.
export const createSupabaseApplication = async ({ id, studentId, scholarshipId, documentStatus, attachedDocuments, notes, statement }) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.from('applications').insert({
    id,
    student_id: studentId,
    scholarship_id: scholarshipId,
    document_status: documentStatus,
    notes,
    statement: statement || null,
  }).select().single();
  if (result.error || !result.data || !attachedDocuments?.length) return result;
  const links = await supabase.from('application_documents').insert(attachedDocuments.map((documentId) => ({ application_id: result.data.id, document_id: documentId })));
  return links.error ? { data: result.data, error: links.error } : result;
};

// Draft-only document links; RLS refuses them once the application is submitted.
export const attachSupabaseApplicationDocument = (applicationId, documentId) => (
  ensureReady()
    ? supabase.from('application_documents').upsert({ application_id: applicationId, document_id: documentId }, { onConflict: 'application_id,document_id', ignoreDuplicates: true }).then(({ error }) => ({ error }))
    : Promise.resolve({ error: { message: 'Supabase is not configured.' } })
);

// Swaps a Rejected file on a submitted, pre-endorsement application for another
// vault file (replace_rejected_application_document, 20261021000000). The
// server re-checks ownership, status, and the document type.
export const replaceSupabaseApplicationDocument = (applicationId, oldDocumentId, newDocumentId) => (
  ensureReady()
    ? supabase.rpc('replace_rejected_application_document', {
        p_application_id: applicationId,
        p_old_document_id: oldDocumentId,
        p_new_document_id: newDocumentId,
      }).then(({ error }) => ({ error }))
    : Promise.resolve({ error: { message: 'Supabase is not configured.' } })
);

export const detachSupabaseApplicationDocument = (applicationId, documentId) => (
  ensureReady()
    ? supabase.from('application_documents').delete().eq('application_id', applicationId).eq('document_id', documentId).then(({ error }) => ({ error }))
    : Promise.resolve({ error: { message: 'Supabase is not configured.' } })
);

export const updateSupabaseApplicationDraft = (applicationId, { statement }) => (
  ensureReady()
    ? supabase.from('applications').update({ statement, updated_at: new Date().toISOString() }).eq('id', applicationId).then(({ error }) => ({ error }))
    : Promise.resolve({ error: { message: 'Supabase is not configured.' } })
);

// Submission writes the status, timeline, statement, frozen profile snapshot,
// and certification in one update so the server-side submit gate
// (enforce_student_application_update) evaluates the complete row.
export const submitSupabaseApplication = (applicationId, { timeline, statement, profileSnapshot, certifiedAt } = {}) => (
  ensureReady()
    ? supabase.from('applications').update({
        status: 'Submitted',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        statement,
        profile_snapshot: profileSnapshot,
        certified_at: certifiedAt,
        ...(Array.isArray(timeline) ? { timeline } : {}),
      }).eq('id', applicationId)
        .then(({ error }) => ({ error }))
    : Promise.resolve({ error: { message: 'Supabase is not configured.' } })
);

export const createSupabaseDocument = async ({ id, ownerId, title, fileName, documentType, linkedAttributes, attestedValues, file }) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const storagePath = buildDocumentStoragePath({ ownerId, documentId: id, fileName });
  const upload = await supabase.storage.from(DOCUMENT_BUCKET).upload(storagePath, file, { contentType: file?.type || undefined, upsert: false });
  if (upload.error) return { data: null, error: upload.error };
  const row = {
    id,
    owner_id: ownerId,
    title,
    file_name: fileName,
    document_type: documentType,
    linked_attributes: Array.isArray(linkedAttributes) ? linkedAttributes : [],
    attested_values: attestedValues && typeof attestedValues === 'object' ? attestedValues : {},
    storage_path: storagePath,
  };
  let result = await supabase.from('documents').insert(row).select().single();
  // A project with the attested-values migration pending has no such column;
  // keep the upload working without it (the proof then counts as current).
  if (result.error && (result.error.code === 'PGRST204' || /attested_values/.test(result.error.message || ''))) {
    const { attested_values: _omitted, ...legacyRow } = row;
    result = await supabase.from('documents').insert(legacyRow).select().single();
  }
  // Roll back the orphaned object if the metadata row could not be written.
  if (result.error) await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
  return result;
};

// Short-lived signed URL for a private-bucket object (RLS-checked per caller).
export const getSupabaseDocumentUrl = async (storagePath, expiresIn = 3600) => {
  if (!ensureReady() || !storagePath) return { url: null, error: null };
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(storagePath, expiresIn);
  return { url: data?.signedUrl || null, error };
};

// Delete the row first: the server refuses to delete a file a submitted
// application relies on, and the stored object must survive that refusal.
export const deleteSupabaseDocument = async (documentId, storagePath) => {
  if (!ensureReady()) return { error: null };
  const result = await supabase.from('documents').delete().eq('id', documentId);
  if (result.error) return { error: result.error };
  if (storagePath) await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
  return { error: null };
};

// Profile photos live in their own private bucket, keyed by the owner's user id
// (`<ownerId>/<timestamp>-<file>`) so the owner-only policy scopes the object
// without a documents row. The caller deletes the previous object only after the
// profiles.avatar_path write succeeds, so a failed save never loses the old
// photo.
export const uploadSupabaseAvatar = async ({ ownerId, file }) => {
  if (!ensureReady()) return { path: null, error: { message: 'Supabase is not configured.' } };
  if (!ownerId || !file) return { path: null, error: { message: 'Choose a photo to upload.' } };
  const storagePath = buildAvatarStoragePath({ ownerId, fileName: file.name || 'avatar.jpg' });
  const upload = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(storagePath, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (upload.error) return { path: null, error: upload.error };
  return { path: storagePath, error: null };
};

// Short-lived signed URL for the private avatar object. The app keeps it in
// memory only; an expired URL falls back to the initials avatar.
export const getSupabaseAvatarUrl = async (storagePath, expiresIn = 3600) => {
  if (!ensureReady() || !storagePath) return { url: null, error: null };
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(storagePath, expiresIn);
  return { url: data?.signedUrl || null, error };
};

export const deleteSupabaseAvatar = async (storagePath) => {
  if (!ensureReady() || !storagePath) return { error: null };
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([storagePath]);
  return { error };
};

// A rejection carries its required reason; any other status clears it.
export const updateSupabaseDocumentStatus = async (documentId, verificationStatus, rejectionReason = '') => {
  if (!ensureReady()) return { error: null };
  const patch = {
    verification_status: verificationStatus,
    rejection_reason: verificationStatus === 'Rejected' ? rejectionReason : null,
  };
  const result = await supabase.from('documents').update(patch).eq('id', documentId);
  // A project with the rejection-reason migration pending has no such column.
  // Verifying or resetting still works without it, but a rejection is refused
  // so its reason is never silently dropped.
  if (result.error && verificationStatus !== 'Rejected'
    && (result.error.code === 'PGRST204' || /rejection_reason/.test(result.error.message || ''))) {
    return supabase.from('documents').update({ verification_status: verificationStatus }).eq('id', documentId);
  }
  return result;
};

export const createSupabaseAnnouncement = ({ title, body, audience, createdBy }) => (
  ensureReady() ? supabase.from('announcements').insert({ title, body, audience, created_by: createdBy }).select().single() : Promise.resolve({ data: null, error: null })
);

export const markSupabaseNotificationRead = (notificationId) => (
  ensureReady() ? supabase.from('notifications').update({ status: 'Read' }).eq('id', notificationId) : Promise.resolve({ error: null })
);

// Persists the notification channel and reminder-timing settings so the
// scheduled Edge Function can honor them server-side. Mirrors the localStorage
// `notificationPreferences` shape verbatim so the two never drift.
export const updateSupabaseNotificationPreferences = (userId, preferences) => (
  ensureReady()
    ? supabase
        .from('profiles')
        .update({ notification_preferences: preferences, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
    : Promise.resolve({ error: null })
);

// Custom calendar deadlines are persisted so server-side reminders can email
// them. The client-generated `custom-<uuid>` id is stored verbatim so the
// `deadline-reminder-<id>-<days>` sourceKey matches on both sides, which is
// also what lets notificationMerge collapse the duplicate in-app rows.
export const createSupabaseCustomDeadline = ({ id, ownerId, title, deadline }) => (
  ensureReady()
    ? supabase
        .from('custom_deadlines')
        .upsert({ id, owner_id: ownerId, title, deadline }, { onConflict: 'id' })
    : Promise.resolve({ error: null })
);

export const deleteSupabaseCustomDeadline = (id) => (
  ensureReady() ? supabase.from('custom_deadlines').delete().eq('id', id) : Promise.resolve({ error: null })
);

// Office planning dates on the Admissions Office calendar. The client generates
// `office-<uuid>` ids so an entry keeps one identity on the calendar and in the
// database. The database policies keep publishing and removing them to the
// Admissions Office Head; both office lanes and Department Chairs read them.
export const createSupabaseOfficeCalendarEntry = ({ id, title, entryDate, kind, notes, createdBy }) => (
  ensureReady()
    ? supabase
        .from('office_calendar_entries')
        .upsert(
          { id, title, entry_date: entryDate, kind, notes, created_by: createdBy },
          { onConflict: 'id' },
        )
        .select('*')
        .single()
    : Promise.resolve({ data: null, error: null })
);

export const deleteSupabaseOfficeCalendarEntry = (id) => (
  ensureReady() ? supabase.from('office_calendar_entries').delete().eq('id', id) : Promise.resolve({ data: null, error: null })
);

// The Head's approval-level settings (SOP step 7 routing). One row per school,
// or per cluster inside a school; an unset scope defaults to the Chairperson.
export const saveSupabaseApprovalLevel = async ({ id, school, cluster, approverRole }) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const row = { school, cluster: cluster || null, approver_role: approverRole, updated_at: new Date().toISOString() };
  const result = id
    ? await supabase.from('approval_levels').update(row).eq('id', id).select('*').single()
    : await supabase.from('approval_levels').insert(row).select('*').single();
  return { ...result, data: result.data ? toApprovalLevel(result.data) : null };
};

export const deleteSupabaseApprovalLevel = (id) => (
  ensureReady() ? supabase.from('approval_levels').delete().eq('id', id) : Promise.resolve({ data: null, error: null })
);

// Records a scholarship's batch release (record_results_release, Head only). The
// row's insert trigger sends the non-acceptance letters; the browser call below
// is the retry for the in-app and email channels.
export const recordSupabaseResultsRelease = async (scholarshipId) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.rpc('record_results_release', { p_scholarship_id: scholarshipId });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return { error: result.error, data: row ? toResultsRelease(row) : null };
};

// FORM 230-SCH financial details live in two office-only tables (see
// 20261036000000_add_application_financial_details.sql). A project that has not
// applied the migration answers with `missing: true` so the app says so instead
// of failing the whole workspace.
const isMissingTableError = (error) => ['42P01', 'PGRST205'].includes(error?.code);

const financialResult = ({ data, error }, pick) => {
  if (error) return { success: false, missing: isMissingTableError(error), error };
  return { success: true, missing: false, ...pick(data) };
};

export const loadSupabaseFinancialProfile = async (studentId) => {
  if (!ensureReady() || !studentId) return { success: true, missing: false, details: null };
  const response = await supabase
    .from('student_financial_profiles')
    .select('details')
    .eq('student_id', studentId)
    .maybeSingle();
  return financialResult(response, (data) => ({ details: data?.details || null }));
};

export const saveSupabaseFinancialProfile = async (studentId, details) => {
  if (!ensureReady() || !studentId) return { success: true, missing: false };
  const response = await supabase
    .from('student_financial_profiles')
    .upsert({ student_id: studentId, details, updated_at: new Date().toISOString() }, { onConflict: 'student_id' })
    .select('details')
    .single();
  return financialResult(response, (data) => ({ details: data?.details || details }));
};

// The signed-in student's per-application answers and the financial profile
// frozen at submission, each keyed by application id.
export const loadSupabaseFinancialAnswers = async () => {
  if (!ensureReady()) return { success: true, missing: false, answersByApplication: {}, snapshotsByApplication: {} };
  const response = await supabase
    .from('application_financial_details')
    .select('application_id, answers, financial_snapshot');
  return financialResult(response, (data) => ({
    answersByApplication: Object.fromEntries((data || []).map((row) => [row.application_id, row.answers || {}])),
    snapshotsByApplication: Object.fromEntries((data || []).filter((row) => row.financial_snapshot).map((row) => [row.application_id, row.financial_snapshot])),
  }));
};

export const saveSupabaseFinancialAnswers = async ({ applicationId, studentId, answers }) => {
  if (!ensureReady() || !applicationId || !studentId) return { success: true, missing: false };
  const response = await supabase
    .from('application_financial_details')
    .upsert(
      { application_id: applicationId, student_id: studentId, answers, updated_at: new Date().toISOString() },
      { onConflict: 'application_id' },
    )
    .select('answers')
    .single();
  return financialResult(response, (data) => ({ answers: data?.answers || answers }));
};

// Admissions Office only: one application's answers and the financial profile
// the database froze when it was submitted. RLS returns nothing to a Chair.
export const loadSupabaseApplicationFinancialDetails = async (applicationId) => {
  if (!ensureReady() || !applicationId) return { success: true, missing: false, answers: null, financialSnapshot: null };
  const response = await supabase
    .from('application_financial_details')
    .select('answers, financial_snapshot')
    .eq('application_id', applicationId)
    .maybeSingle();
  return financialResult(response, (data) => ({
    answers: data?.answers || null,
    financialSnapshot: data?.financial_snapshot || null,
  }));
};

// A non-2xx answer still carries the function's own explanation: every function
// reports a refused caller, a missing channel, or a Google failure as
// `{ error }` or `{ code, reason }`. supabase-js throws a `FunctionsHttpError`
// whose message is only "Edge Function returned a non-2xx status code" and leaves
// the untouched `Response` in `error.context`, so the body is read back here.
// Without it a role-gate 403 and an expired Google token read identically to the
// caller (the Interview tab could only say "non-2xx" and ask for a pasted link).
const readFunctionErrorBody = async (error) => {
  try {
    const response = error?.context;
    if (!response || typeof response.json !== 'function') return null;
    const body = await response.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
};

// Both email Edge Functions answer with a normalized shape so the UI can report
// real delivery feedback instead of assuming success.
const invokeEmailFunction = async (functionName, body = {}) => {
  if (!ensureReady()) {
    return { ok: false, sent: false, skipped: true, reason: 'Supabase is not configured.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body });
    if (error) {
      const detail = await readFunctionErrorBody(error);
      return {
        ok: false,
        sent: false,
        skipped: false,
        code: detail?.code || '',
        reason: detail?.reason || detail?.error || error.message || 'Unable to reach the email service.',
      };
    }
    return data ?? { ok: false, sent: false, skipped: false, reason: 'The email service returned no response.' };
  } catch (error) {
    return { ok: false, sent: false, skipped: false, reason: error?.message || 'Unable to reach the email service.' };
  }
};

export const sendSupabaseTestEmail = () => invokeEmailFunction('send-test-email');

// Same invoker and normalized response shape as the email test, backed by the
// send-test-sms Edge Function (recipient is always the caller's own number).
export const sendSupabaseTestSms = () => invokeEmailFunction('send-test-sms');

export const notifySupabaseApplicationStatus = (applicationId) => invokeEmailFunction('notify-application-status', { applicationId });

// Browser retry for a batch results release; the results_releases insert trigger
// is the primary sender and owns the SMS channel.
export const notifySupabaseResultsRelease = (releaseId) => invokeEmailFunction('notify-application-status', { mode: 'results-release', releaseId });

// Browser retry for the interview schedule notification; the database trigger
// (20261029000001) is the primary sender and owns the SMS channel.
export const notifySupabaseInterviewUpdate = (applicationId) => invokeEmailFunction('notify-interview-update', { applicationId });

// Optional Google Calendar and Meet integration (manage-interview-event). It
// answers { configured: false } when the office Google account is not set up,
// so the schedule form falls back to a pasted meeting link.
export const invokeSupabaseInterviewEvent = (body) => invokeEmailFunction('manage-interview-event', body);

// Browser retry for the document-verification notification; the database
// trigger (20261021000001) is the primary sender and owns the SMS channel.
export const notifySupabaseDocumentVerification = (documentId) => invokeEmailFunction('notify-document-verification', { documentId });