import { hasSupabaseConfig, supabase } from './supabaseClient';
import { isHierarchyProgram } from './academicPrograms';
import { isReviewerRole } from './reviewScope';
import { DOCUMENT_BUCKET, buildDocumentStoragePath } from './documentStorage';
import { AVATAR_BUCKET, buildAvatarStoragePath } from './avatarStorage';
import { fetchKeysetRows, fetchPagedRows, fetchRowsInBatches } from './supabasePaging';
import { classifySupabaseError } from './errorKinds';

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
  updatedAt: row.updated_at,
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
    // Set only when the Admissions Office Admin opened the Draft as an
    // eligibility exception (open_application_for_student); the reason is staff-only.
    openedByOfficeAt: row.opened_by_office_at ?? null,
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
const toSupportThread = (row) => ({
  id: row.id,
  studentId: row.student_id,
  status: row.status,
  escalatedAt: row.escalated_at || null,
  resolvedAt: row.resolved_at || null,
  resolvedBy: row.resolved_by || null,
  studentViewFrom: row.student_view_from || null,
  assistantEnabled: row.assistant_enabled !== false,
  lastMessageAt: row.last_message_at,
  lastMessageBy: row.last_message_by,
  studentLastReadAt: row.student_last_read_at,
  officeLastReadAt: row.office_last_read_at,
  studentUnreadCount: row.student_unread_count || 0,
  officeUnreadCount: row.office_unread_count || 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const toSupportMessage = (row) => ({
  id: row.id,
  threadId: row.thread_id,
  senderId: row.sender_id,
  senderRole: row.sender_role,
  body: row.body,
  replyingToId: row.replying_to_id || '',
  createdAt: row.created_at,
});
const toCustomDeadline = (row) => ({
  id: row.id,
  title: row.title,
  deadline: row.deadline,
  createdAt: row.created_at,
});
// Office planning entries on the Admissions Office calendar. The Admin publishes
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
  // 'offers' releases the accepted and waitlisted applicants, 'closing' sends the
  // Not accepted letters; rows recorded before the waitlist read 'legacy'.
  kind: row.kind || 'legacy',
});
// An accepted applicant's offer and their answer to it (scholarship_offers, from
// 20261061000000). RLS: the owning student, the office, and the scoped ladder.
const toScholarshipOffer = (row) => ({
  applicationId: row.application_id,
  scholarshipId: row.scholarship_id,
  studentId: row.student_id,
  offeredAt: row.offered_at,
  confirmBy: row.confirm_by || null,
  origin: row.origin || 'release',
  response: row.response || 'pending',
  respondedAt: row.responded_at || null,
  respondedBy: row.responded_by || null,
  respondedByRole: row.responded_by_role || '',
  declineReason: row.decline_reason || '',
});
// The Admin's waitlist order (application_waitlist_ranks). Office sessions only.
const toWaitlistRank = (row) => ({
  applicationId: row.application_id,
  scholarshipId: row.scholarship_id,
  rank: Number(row.rank) || 0,
  updatedAt: row.updated_at,
});
// An additional-documents request (application_document_requests). The note is
// shown to the student, so it is carried as-is; there is no staff-only text here.
const toDocumentRequest = (row) => ({
  id: row.id,
  applicationId: row.application_id,
  kind: row.kind,
  requirementId: row.requirement_id || null,
  documentTypes: Array.isArray(row.document_types) ? row.document_types : [],
  label: row.label || '',
  note: row.note || '',
  minFiles: Number(row.min_files) || 1,
  status: row.status || 'Open',
  requestedBy: row.requested_by || null,
  requestedByRole: row.requested_by_role || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  fulfilledAt: row.fulfilled_at || null,
  cancelReason: row.cancel_reason || '',
});
const toNotification = (row) => ({ ...row, profileId: row.profile_id, createdAt: row.created_at, updatedAt: row.updated_at });
const toDepartmentReview = (row) => ({
  ...row,
  applicationId: row.application_id,
  studentName: row.student_name,
  householdIncome: row.household_income,
  createdAt: row.created_at,
});

// One append-only status-log row (application_status_log). The actor's name
// resolves from the profiles visible to the caller; a student sees only their
// own profile, so the modal falls back to the recorded role.
const toStatusLogEntry = (row, studentById = {}) => ({
  id: row.id,
  applicationId: row.application_id,
  fromStatus: row.from_status,
  toStatus: row.to_status,
  actorId: row.actor_id,
  actorRole: row.actor_role,
  actorName: studentById[row.actor_id]?.full_name || null,
  reason: row.reason,
  at: row.created_at,
});

const STATUS_LOG_COLUMNS = 'id, application_id, from_status, to_status, actor_id, actor_role, reason, created_at';
const REVIEW_COMMENT_COLUMNS = 'id, application_id, author_id, author_role, author_name, kind, body, created_at';

const groupStatusLog = (rows, studentById) => {
  const grouped = {};
  (rows || []).forEach((row) => {
    (grouped[row.application_id] ||= []).push(toStatusLogEntry(row, studentById));
  });
  return grouped;
};

// A rejected read must never be mistaken for "no rows": the loaders return the
// error object, and a thrown fetch failure is folded into the same shape.
const settle = (promise) => Promise.resolve(promise).then((result) => result, (error) => ({ data: null, error }));

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

// The recorded grant amount of one application (application_grant_amounts). It is
// a separate table because a student reads their own `applications` row in full:
// the student policy only returns the row once a results release covers it.
const toGrantAmount = (row) => ({
  applicationId: row.application_id,
  coveragePercent: row.coverage_percent === null || row.coverage_percent === undefined ? null : Number(row.coverage_percent),
  amountPerSemester: row.amount_per_semester === null || row.amount_per_semester === undefined ? null : Number(row.amount_per_semester),
  note: row.note || '',
  setBy: row.set_by || null,
  setByRole: row.set_by_role || '',
  updatedAt: row.updated_at,
});
const uniqueBy = (rows, key) => [...new Map((rows || []).map((row) => [row[key], row])).values()];

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
  updatedAt: row.updated_at,
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
  updatedAt: row.updated_at,
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
const STAFF_ROLES = ['admissions_office', 'admissions_admin', 'dean', 'assistant_dean', 'department_chair', 'interviewer'];

const ensureReady = () => hasSupabaseConfig && supabase;

// `includeDetails` controls the three append-only per-case streams (status log,
// internal comments, interview notes). A student reads only their own rows, so
// they hydrate with the workspace. A staff session would download every case's
// history before the first screen; there they are loaded afterwards by
// loadSupabaseWorkspaceDetails() and per opened case by loadSupabaseCaseDetails().
export const loadSupabaseWorkspace = async ({ role, userId, department, signal, includeDetails = role === 'student' }) => {
  if (!ensureReady()) return { success: false, fallback: true };

  const [scholarshipsResult, applicationsResult, documentsResult, announcementsResult, notificationsResult, reviewsResult, deadlinesResult, profilesResult, officeEntriesResult, approvalLevelsResult, resultsReleasesResult] = await Promise.all([
    fetchPagedRows(() => supabase.from('scholarships').select('*').order('deadline', { ascending: true }).order('id', { ascending: true })),
    // The two tables that change while a hydration is under way are read by
    // keyset, so a row updated between pages is neither skipped nor repeated.
    fetchKeysetRows(() => supabase.from('applications').select('*'), { orderColumn: 'updated_at', ascending: false, signal }),
    fetchKeysetRows(() => supabase.from('documents').select('*'), { orderColumn: 'uploaded_at', ascending: false, signal }),
    fetchPagedRows(() => supabase.from('announcements').select('*').order('created_at', { ascending: false }).order('id', { ascending: false })),
    fetchPagedRows(() => supabase.from('notifications').select('*').eq('profile_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false })),
    isReviewerRole(role)
      ? fetchPagedRows(() => supabase.from('department_reviews').select('*').eq('department', department).order('created_at', { ascending: false }).order('id', { ascending: false }))
      : Promise.resolve({ data: [], error: null }),
    fetchPagedRows(() => supabase.from('custom_deadlines').select('id, title, deadline, created_at').eq('owner_id', userId).order('id', { ascending: true })),
    // Staff queues need applicant context. students_read is limited to their own
    // profile by RLS, so this select is safe for every role.
    fetchPagedRows(() => supabase.from('profiles').select('user_id, full_name, role, department, degree_program, qpi, household_income, review_school, review_cluster, review_department').order('user_id', { ascending: true })),
    // Office calendar planning entries are a staff-only slice. A student session
    // never asks for them, so they cannot leak into the student calendar.
    role === 'student'
      ? Promise.resolve({ data: [], error: null })
      : fetchPagedRows(() => supabase.from('office_calendar_entries').select('*').order('entry_date', { ascending: true }).order('id', { ascending: true })),
    // SOP step 7 routing, read by every staff role so a page lists exactly the
    // recommendations its account may approve.
    role === 'student'
      ? Promise.resolve({ data: [], error: null })
      : fetchPagedRows(() => supabase.from('approval_levels').select('*').order('school', { ascending: true }).order('id', { ascending: true })),
    // Release coverage is role-filtered in the RPC because a release row's raw
    // application_ids array would disclose other applicants' IDs to a student.
    fetchPagedRows(() => supabase.rpc('get_scoped_results_releases')),
  ].map(settle));
  if (signal?.aborted) return { success: false, fallback: false, cancelled: true };
  const failed = [scholarshipsResult, applicationsResult, documentsResult, announcementsResult, notificationsResult, reviewsResult, profilesResult].find((result) => result.error);
  if (failed) return { success: false, fallback: false, message: failed.error.message, errorKind: classifySupabaseError(failed.error) };

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
    role: entry.role || '',
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
    const linksResult = await fetchRowsInBatches(applicationIds, (ids) => supabase.from('application_documents').select('application_id, document_id').in('application_id', ids));
    if (linksResult.error) return { success: false, fallback: false, message: linksResult.error.message, errorKind: classifySupabaseError(linksResult.error) };
    (linksResult.data || []).forEach((link) => {
      documentIdsByApplication[link.application_id] = [...(documentIdsByApplication[link.application_id] || []), link.document_id];
    });
  }

  // The append-only status log is the audit history the review modal shows
  // (application_status_log, from 20261014000002), and the internal endorsement
  // thread (application_review_comments, from 20261023000000) is staff only.
  // A student's own rows load here; a staff session loads them afterwards
  // (loadSupabaseWorkspaceDetails). A pending migration yields no rows rather
  // than failing the whole workspace.
  let statusLogByApplication = {};
  let reviewComments = [];
  if (includeDetails && applicationIds.length) {
    const [logResult, commentsResult] = await Promise.all([
      settle(fetchRowsInBatches(applicationIds, (ids) => supabase
        .from('application_status_log')
        .select(STATUS_LOG_COLUMNS)
        .in('application_id', ids)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }), { signal })),
      role !== 'student'
        ? settle(fetchRowsInBatches(applicationIds, (ids) => supabase
          .from('application_review_comments')
          .select(REVIEW_COMMENT_COLUMNS)
          .in('application_id', ids)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }), { signal }))
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (!logResult.error) statusLogByApplication = groupStatusLog(logResult.data, studentById);
    if (!commentsResult.error) reviewComments = (commentsResult.data || []).map(toReviewComment);
  }

  // Recorded grant amounts (application_grant_amounts, from 20261059000000). RLS
  // decides the rows: the Admissions Office and the scoped approving level read
  // them, and a student only receives the row of a released application. A pending
  // migration yields no rows rather than failing the whole workspace.
  let grantAmounts = [];
  if (applicationIds.length) {
    const grantAmountsResult = await fetchRowsInBatches(applicationIds, (ids) => supabase.from('application_grant_amounts').select('*').in('application_id', ids));
    if (!grantAmountsResult.error) {
      grantAmounts = (grantAmountsResult.data || []).map(toGrantAmount);
    }
  }

  // Offers and their answers (scholarship_offers, from 20261061000000). Every
  // role reads them through RLS: the student their own, the office all, the
  // ladder its scope. The waitlist order is office-only. A pending migration
  // yields no rows and reports scholarshipOffersReady: false.
  let scholarshipOffers = [];
  let scholarshipOffersReady = true;
  let waitlistRanks = [];
  if (applicationIds.length) {
    const offersResult = await fetchRowsInBatches(applicationIds, (ids) => supabase.from('scholarship_offers').select('*').in('application_id', ids));
    if (offersResult.error) scholarshipOffersReady = false;
    else scholarshipOffers = (offersResult.data || []).map(toScholarshipOffer);
  }
  if (role === 'admissions_office' || role === 'admissions_admin') {
    const ranksResult = await fetchPagedRows(() => supabase.from('application_waitlist_ranks').select('*').order('rank', { ascending: true }).order('application_id', { ascending: true }));
    if (!ranksResult.error) waitlistRanks = (ranksResult.data || []).map(toWaitlistRank);
  }

  // Additional-document requests (application_document_requests, from
  // 20261114000000). Every role reads them through RLS: the student their own, the
  // office all, the ladder its scope. A pending migration yields no rows and reports
  // documentRequestsReady: false.
  let documentRequests = [];
  let documentRequestsReady = true;
  if (applicationIds.length) {
    const requestsResult = await fetchRowsInBatches(applicationIds, (ids) => supabase
      .from('application_document_requests')
      .select('*')
      .in('application_id', ids)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }));
    if (requestsResult.error) documentRequestsReady = false;
    else documentRequests = (requestsResult.data || []).map(toDocumentRequest);
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
    const caseOfficersResult = await fetchPagedRows(() => supabase
      .from('application_case_officers')
      .select('*')
      .is('left_at', null)
      .order('joined_at', { ascending: true })
      .order('id', { ascending: true }));
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
      // read the saved venues too (Admin-managed). Before the routing migration a
      // reviewer read is refused and the list stays empty; the typed location
      // field still works.
      fetchPagedRows(() => supabase.from('interview_locations').select('*').order('name', { ascending: true }).order('id', { ascending: true })),
      applicationIds.length
        ? fetchRowsInBatches(applicationIds, (ids) => supabase.from('application_interview_panelists').select('*').in('application_id', ids).is('removed_at', null))
        : Promise.resolve({ data: [], error: null }),
      includeDetails && applicationIds.length
        ? fetchRowsInBatches(applicationIds, (ids) => supabase.from('application_interview_notes').select('*').in('application_id', ids).order('created_at', { ascending: true }).order('id', { ascending: true }))
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
    grantAmounts,
    scholarshipOffers,
    scholarshipOffersReady,
    waitlistRanks,
    documentRequests,
    documentRequestsReady,
    staffDirectory,
    // Staff-only case-officer roster: which Admissions Office accounts have
    // opened which application. Empty for a student or Department Chair session.
    caseOfficers,
    caseOfficersReady,
    interviewLocations,
    interviewPanelists,
    interviewNotes,
    // True while the per-case streams (status log, internal comments, interview
    // notes) have not been read for this session; the caller loads them next with
    // loadSupabaseWorkspaceDetails() and merges them in.
    detailsDeferred: !includeDetails,
    workspaceDetailsReady: includeDetails,
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
    // The separate support inbox hydrates after the base workspace and tolerates
    // its migration being applied later than the app build.
    // Pending-migration tolerance, like custom_deadlines: an unavailable table
    // yields an empty office calendar instead of failing the whole workspace.
    officeCalendarEntries: !officeEntriesResult.error && Array.isArray(officeEntriesResult.data)
      ? officeEntriesResult.data.map(toOfficeCalendarEntry)
      : [],
  };
};

// The per-case streams of a staff session, read after the first screen is up.
// With no `applicationIds` it reads the whole visible history by keyset (RLS
// scopes it to the account); with ids it reads just those cases in bounded
// batches, which is how an opened case gets its history immediately.
// `students` is the compact profile directory already in memory, used to name the
// actors without another profiles query.
export const loadSupabaseWorkspaceDetails = async ({ role, students = {}, applicationIds = null, signal } = {}) => {
  if (!ensureReady()) return { success: false, fallback: true };
  const isStaff = role !== 'student';
  const profileLike = Object.fromEntries(Object.entries(students).map(([id, entry]) => [id, { full_name: entry.fullName }]));
  const nameById = Object.fromEntries(Object.entries(students).map(([id, entry]) => [id, entry.fullName || '']));
  const scoped = Array.isArray(applicationIds);
  if (scoped && !applicationIds.length) {
    return { success: true, scope: 'cases', applicationIds: [], statusLogs: {}, reviewComments: [], interviewNotes: [] };
  }

  const read = (table, columns, orderColumn) => (scoped
    ? fetchRowsInBatches(applicationIds, (ids) => supabase.from(table).select(columns).in('application_id', ids).order(orderColumn, { ascending: true }).order('id', { ascending: true }), { signal })
    : fetchKeysetRows(() => supabase.from(table).select(columns), { orderColumn, ascending: true, signal }));

  const [logResult, commentsResult, notesResult] = await Promise.all([
    settle(read('application_status_log', STATUS_LOG_COLUMNS, 'created_at')),
    isStaff ? settle(read('application_review_comments', REVIEW_COMMENT_COLUMNS, 'created_at')) : Promise.resolve({ data: [], error: null }),
    isStaff ? settle(read('application_interview_notes', '*', 'created_at')) : Promise.resolve({ data: [], error: null }),
  ]);
  if (signal?.aborted) return { success: false, fallback: false, cancelled: true };
  // The status log is the audit trail every other stream hangs off; if it cannot
  // be read the caller keeps what it has and reports the failure. The two note
  // streams are optional (a pending migration yields nothing).
  if (logResult.error) {
    return { success: false, fallback: false, message: logResult.error.message, errorKind: classifySupabaseError(logResult.error) };
  }
  return {
    success: true,
    scope: scoped ? 'cases' : 'all',
    applicationIds: scoped ? applicationIds : null,
    statusLogs: groupStatusLog(logResult.data, profileLike),
    ...(commentsResult.error ? {} : { reviewComments: (commentsResult.data || []).map(toReviewComment) }),
    ...(notesResult.error ? {} : { interviewNotes: (notesResult.data || []).map((row) => toInterviewNote(row, nameById)) }),
  };
};

// Stage totals for the cases the caller may see, counted by the database through
// row-level security (20261105000005). Returns null when the migration is not
// applied or the read failed: the integrity check then simply does not run.
export const loadSupabaseStageCounts = async ({ signal } = {}) => {
  if (!ensureReady()) return null;
  let query = supabase.rpc('get_application_stage_counts');
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal);
  const { data, error } = await settle(query);
  if (error || !Array.isArray(data)) return null;
  const byStatus = {};
  let total = 0;
  data.forEach((row) => {
    const count = Number(row.application_count) || 0;
    byStatus[row.status] = (byStatus[row.status] || 0) + count;
    total += count;
  });
  return { total, byStatus };
};

// Periodic refreshes fetch only rows changed since the last successful check.
// The full loader remains the reconciliation path on sign-in and session return.
export const loadSupabaseWorkspaceChanges = async ({
  role,
  userId,
  department,
  since,
  knownScholarships = [],
  knownStudents = {},
  signal,
}) => {
  if (!ensureReady() || !since) return { success: false, fallback: true };

  const isOffice = role === 'admissions_office' || role === 'admissions_admin';
  const isStaff = role !== 'student';
  const isReviewer = isReviewerRole(role);
  const sinceIso = new Date(since).toISOString();
  const emptyResult = { data: [], error: null };
  const [applicationsResult, documentsResult, notificationsResult, profilesResult, scholarshipsResult,
    linkChangesResult, commentsResult, notesResult, panelistsResult, caseOfficersResult,
    grantAmountsResult, waitlistRanksResult, offersResult, releasesResult, officeEntriesResult,
    approvalLevelsResult, interviewLocationsResult, announcementsResult, deadlinesResult, reviewsResult,
    documentRequestsResult] = await Promise.all([
    fetchPagedRows(() => supabase.from('applications').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('id', { ascending: true }), { signal }),
    fetchPagedRows(() => supabase.from('documents').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('id', { ascending: true }), { signal }),
    fetchPagedRows(() => supabase.from('notifications').select('*').eq('profile_id', userId).gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('id', { ascending: true })),
    fetchPagedRows(() => supabase.from('profiles').select('user_id, full_name, role, department, degree_program, qpi, household_income, review_school, review_cluster, review_department, updated_at').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('user_id', { ascending: true })),
    fetchPagedRows(() => supabase.from('scholarships').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('id', { ascending: true })),
    fetchPagedRows(() => supabase.from('application_documents').select('application_id, document_id, created_at').gt('created_at', sinceIso).order('created_at', { ascending: true }).order('application_id', { ascending: true })),
    isStaff
      ? fetchPagedRows(() => supabase.from('application_review_comments').select('id, application_id, author_id, author_role, author_name, kind, body, created_at').gt('created_at', sinceIso).order('created_at', { ascending: true }).order('id', { ascending: true }))
      : Promise.resolve(emptyResult),
    isStaff
      ? fetchPagedRows(() => supabase.from('application_interview_notes').select('*').gt('created_at', sinceIso).order('created_at', { ascending: true }).order('id', { ascending: true }))
      : Promise.resolve(emptyResult),
    isStaff
      ? fetchPagedRows(() => supabase.from('application_interview_panelists').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('id', { ascending: true }))
      : Promise.resolve(emptyResult),
    isOffice
      ? fetchPagedRows(() => supabase.from('application_case_officers').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('id', { ascending: true }))
      : Promise.resolve(emptyResult),
    fetchPagedRows(() => supabase.from('application_grant_amounts').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('application_id', { ascending: true })),
    isOffice
      ? fetchPagedRows(() => supabase.from('application_waitlist_ranks').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('application_id', { ascending: true }))
      : Promise.resolve(emptyResult),
    fetchPagedRows(() => supabase.from('scholarship_offers').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('application_id', { ascending: true })),
    fetchPagedRows(() => supabase.rpc('get_scoped_results_releases', { p_since: sinceIso })),
    isStaff
      ? fetchPagedRows(() => supabase.from('office_calendar_entries').select('*').gt('created_at', sinceIso).order('created_at', { ascending: true }).order('id', { ascending: true }))
      : Promise.resolve(emptyResult),
    isStaff
      ? fetchPagedRows(() => supabase.from('approval_levels').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('id', { ascending: true }))
      : Promise.resolve(emptyResult),
    isStaff
      ? fetchPagedRows(() => supabase.from('interview_locations').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('id', { ascending: true }))
      : Promise.resolve(emptyResult),
    fetchPagedRows(() => supabase.from('announcements').select('*').gt('created_at', sinceIso).order('created_at', { ascending: true }).order('id', { ascending: true })),
    fetchPagedRows(() => supabase.from('custom_deadlines').select('id, title, deadline, created_at').eq('owner_id', userId).gt('created_at', sinceIso).order('created_at', { ascending: true }).order('id', { ascending: true })),
    isReviewer
      ? fetchPagedRows(() => supabase.from('department_reviews').select('*').eq('department', department).gt('created_at', sinceIso).order('created_at', { ascending: true }).order('id', { ascending: true }))
      : Promise.resolve(emptyResult),
    fetchPagedRows(() => supabase.from('application_document_requests').select('*').gt('updated_at', sinceIso).order('updated_at', { ascending: true }).order('id', { ascending: true })),
  ]);

  if (signal?.aborted) return { success: false, fallback: false, cancelled: true };
  const stageCounts = await loadSupabaseStageCounts({ signal });
  const required = [applicationsResult, documentsResult, notificationsResult, profilesResult, scholarshipsResult];
  const failed = required.find((result) => result.error);
  if (failed) return { success: false, fallback: false, message: failed.error.message, errorKind: classifySupabaseError(failed.error) };

  const changedProfiles = profilesResult.data || [];
  const students = Object.fromEntries(changedProfiles.map((entry) => [entry.user_id, {
    fullName: entry.full_name || 'Student applicant',
    role: entry.role || '',
    department: entry.department || '',
    degreeProgram: entry.degree_program || '',
    qpi: entry.qpi ?? null,
    householdIncome: entry.household_income ?? null,
  }]));
  const studentById = Object.fromEntries(Object.entries(knownStudents).map(([id, entry]) => [id, {
    full_name: entry.fullName,
    role: entry.role,
    department: entry.department,
    degree_program: entry.degreeProgram,
    qpi: entry.qpi,
    household_income: entry.householdIncome,
  }]));
  changedProfiles.forEach((entry) => { studentById[entry.user_id] = entry; });

  const scholarshipById = Object.fromEntries(knownScholarships.map((entry) => [entry.id, entry]));
  const scholarships = (scholarshipsResult.data || []).map(toScholarship);
  scholarships.forEach((entry) => { scholarshipById[entry.id] = entry; });

  const appIds = new Set((applicationsResult.data || []).map((entry) => entry.id));
  const ownerIds = changedProfiles.map((entry) => entry.user_id);
  const changedScholarshipIds = scholarships.map((entry) => entry.id);
  const linkChanges = Array.isArray(linkChangesResult.data) ? linkChangesResult.data : [];
  linkChanges.forEach((entry) => appIds.add(entry.application_id));
  const additionalAppResults = await Promise.all([
    ownerIds.length
      ? fetchRowsInBatches(ownerIds, (ids) => supabase.from('applications').select('*').in('student_id', ids).order('updated_at', { ascending: false }).order('id', { ascending: false }))
      : Promise.resolve(emptyResult),
    changedScholarshipIds.length
      ? fetchRowsInBatches(changedScholarshipIds, (ids) => supabase.from('applications').select('*').in('scholarship_id', ids).order('updated_at', { ascending: false }).order('id', { ascending: false }))
      : Promise.resolve(emptyResult),
    linkChanges.length
      ? fetchRowsInBatches([...new Set(linkChanges.map((entry) => entry.application_id))], (ids) => supabase.from('applications').select('*').in('id', ids).order('updated_at', { ascending: false }).order('id', { ascending: false }))
      : Promise.resolve(emptyResult),
  ]);
  const applicationRowsById = new Map((applicationsResult.data || []).map((entry) => [entry.id, entry]));
  additionalAppResults.forEach((result) => (result.data || []).forEach((entry) => {
    applicationRowsById.set(entry.id, entry);
    appIds.add(entry.id);
  }));
  const applicationIds = [...appIds];

  const [linksResult, statusLogResult, relatedGrantResult, relatedOffersResult, relatedPanelistsResult, relatedRanksResult] = await Promise.all([
    applicationIds.length
      ? fetchRowsInBatches(applicationIds, (ids) => supabase.from('application_documents').select('application_id, document_id').in('application_id', ids).order('application_id', { ascending: true }).order('document_id', { ascending: true }))
      : Promise.resolve(emptyResult),
    applicationIds.length
      ? fetchRowsInBatches(applicationIds, (ids) => supabase.from('application_status_log').select('id, application_id, from_status, to_status, actor_id, actor_role, reason, created_at').in('application_id', ids).order('created_at', { ascending: true }).order('id', { ascending: true }))
      : Promise.resolve(emptyResult),
    applicationIds.length
      ? fetchRowsInBatches(applicationIds, (ids) => supabase.from('application_grant_amounts').select('*').in('application_id', ids))
      : Promise.resolve(emptyResult),
    applicationIds.length
      ? fetchRowsInBatches(applicationIds, (ids) => supabase.from('scholarship_offers').select('*').in('application_id', ids))
      : Promise.resolve(emptyResult),
    isStaff && applicationIds.length
      ? fetchRowsInBatches(applicationIds, (ids) => supabase.from('application_interview_panelists').select('*').in('application_id', ids))
      : Promise.resolve(emptyResult),
    isOffice && applicationIds.length
      ? fetchRowsInBatches(applicationIds, (ids) => supabase.from('application_waitlist_ranks').select('*').in('application_id', ids))
      : Promise.resolve(emptyResult),
  ]);
  if (applicationIds.length && (linksResult.error || statusLogResult.error)) {
    const error = linksResult.error || statusLogResult.error;
    return { success: false, fallback: false, message: error.message };
  }

  const documentIdsByApplication = {};
  (linksResult.data || []).forEach((link) => {
    documentIdsByApplication[link.application_id] = [...(documentIdsByApplication[link.application_id] || []), link.document_id];
  });
  const statusLogByApplication = groupStatusLog(statusLogResult.data, studentById);
  const applications = [...applicationRowsById.values()].map((entry) => toApplication(entry, scholarshipById, documentIdsByApplication, studentById, statusLogByApplication));
  const documents = (documentsResult.data || []).map((row) => {
    const document = toDocument(row);
    const owner = studentById[document.ownerId] || {};
    return {
      ...document,
      ownerName: owner.full_name || 'Student applicant',
      ownerDepartment: owner.department || '',
      reviewedByName: studentById[document.reviewedBy]?.full_name || null,
    };
  });

  const staffDirectory = changedProfiles.filter((entry) => STAFF_ROLES.includes(entry.role)).map((entry) => ({
    userId: entry.user_id,
    fullName: entry.full_name || 'Staff member',
    role: entry.role,
    department: entry.department || '',
    reviewSchool: entry.review_school || '',
    reviewCluster: entry.review_cluster || '',
    reviewDepartment: entry.review_department || '',
  }));
  const staffDirectoryRemovedUserIds = changedProfiles.filter((entry) => !STAFF_ROLES.includes(entry.role)).map((entry) => entry.user_id);
  const nameById = Object.fromEntries(Object.entries(studentById).map(([id, entry]) => [id, entry.full_name || '']));
  const grantAmounts = uniqueBy([...(grantAmountsResult.data || []), ...(relatedGrantResult.data || [])], 'application_id').map(toGrantAmount);
  const waitlistRanks = uniqueBy([...(waitlistRanksResult.data || []), ...(relatedRanksResult.data || [])], 'application_id').map(toWaitlistRank);
  const scholarshipOffers = uniqueBy([...(offersResult.data || []), ...(relatedOffersResult.data || [])], 'application_id').map(toScholarshipOffer);
  const interviewPanelists = uniqueBy([...(panelistsResult.data || []), ...(relatedPanelistsResult.data || [])], 'id').map((row) => toInterviewPanelist(row, nameById));

  const commentsReady = !commentsResult.error;
  const notesReady = !notesResult.error;
  const resultsReleasesReady = !releasesResult.error;
  return {
    success: true,
    refreshMode: 'delta',
    // The database's own stage totals for this caller, read after the changed rows
    // so the two are as close in time as one refresh allows. Consumed by the
    // integrity check; never merged into state.
    stageCounts,
    applications,
    documents,
    students,
    scholarships,
    notifications: (notificationsResult.data || []).map(toNotification),
    announcements: (announcementsResult.data || []).map(toAnnouncement),
    customDeadlines: !deadlinesResult.error ? (deadlinesResult.data || []).map(toCustomDeadline) : [],
    departmentReviews: !reviewsResult.error ? (reviewsResult.data || []).map(toDepartmentReview) : [],
    ...(commentsReady ? { reviewComments: (commentsResult.data || []).map(toReviewComment) } : {}),
    ...(notesReady ? { interviewNotes: (notesResult.data || []).map((row) => toInterviewNote(row, nameById)) } : {}),
    ...(grantAmountsResult.error || relatedGrantResult.error ? {} : { grantAmounts }),
    ...(waitlistRanksResult.error || relatedRanksResult.error ? {} : { waitlistRanks }),
    ...(documentRequestsResult.error ? {} : { documentRequests: (documentRequestsResult.data || []).map(toDocumentRequest), documentRequestsReady: true }),
    ...(offersResult.error || relatedOffersResult.error ? {} : { scholarshipOffers, scholarshipOffersReady: true }),
    ...(panelistsResult.error || relatedPanelistsResult.error ? {} : { interviewPanelists }),
    ...(caseOfficersResult.error ? {} : { caseOfficers: (caseOfficersResult.data || []).map(toCaseOfficer), caseOfficersReady: true }),
    ...(releasesResult.error ? {} : { resultsReleases: (releasesResult.data || []).map(toResultsRelease), resultsReleasesReady }),
    ...(officeEntriesResult.error ? {} : { officeCalendarEntries: (officeEntriesResult.data || []).map(toOfficeCalendarEntry) }),
    ...(approvalLevelsResult.error ? {} : { approvalLevels: (approvalLevelsResult.data || []).map(toApprovalLevel) }),
    ...(interviewLocationsResult.error ? {} : { interviewLocations: (interviewLocationsResult.data || []).map(toInterviewLocation) }),
    staffDirectory,
    staffDirectoryRemovedUserIds,
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

// The approving level records the grant amount through a security definer RPC
// that re-checks the caller, the scope, and the stage; the table has no client
// write policy.
export const saveSupabaseGrantAmount = async ({ applicationId, coveragePercent, amountPerSemester, note }) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.rpc('set_application_grant_amount', {
    p_application_id: applicationId,
    p_coverage_percent: coveragePercent,
    p_amount: amountPerSemester,
    p_note: note || null,
  });
  if (result.error) return { data: null, error: result.error };
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return { data: row ? toGrantAmount(row) : null, error: null };
};

// Student support conversations. The database policies determine the visible
// rows; caller-provided ids are only filters, never an authorization boundary.
export const loadSupabaseSupportInbox = async ({ role, userId, selectedThreadId = '', markRead = false, includeMessages = true }) => {
  if (!ensureReady()) return { success: false, ready: false, error: { message: 'Supabase is not configured.' } };
  const isOffice = role === 'admissions_office' || role === 'admissions_admin';
  if (!isOffice && role !== 'student') return { success: false, ready: true, threads: [], messages: [], students: {} };

  const threadQuery = supabase.from('support_threads').select('*')
    .order('last_message_at', { ascending: true, nullsFirst: true });
  const threadResult = isOffice ? await threadQuery : await threadQuery.eq('student_id', userId).maybeSingle();
  if (threadResult.error) {
    return { success: false, ready: false, error: threadResult.error };
  }
  const rows = isOffice ? (threadResult.data || []) : (threadResult.data ? [threadResult.data] : []);
  const threads = rows.map(toSupportThread);
  const ids = threads.map((thread) => thread.id);
  const visibleThreadId = selectedThreadId && ids.includes(selectedThreadId)
    ? selectedThreadId
    : (ids[0] || '');

  let messages = includeMessages ? [] : null;
  if (includeMessages && visibleThreadId) {
    const messageQuery = supabase.from('support_messages').select('*').eq('thread_id', visibleThreadId).order('created_at', { ascending: true });
    const messageResult = await messageQuery;
    if (messageResult.error) return { success: false, ready: true, error: messageResult.error, threads, messages: [], students: {} };
    messages = (messageResult.data || []).map(toSupportMessage);
  }

  if (includeMessages && markRead && visibleThreadId) {
    const readResult = await supabase.rpc('mark_support_thread_read', { p_thread_id: visibleThreadId });
    if (!readResult.error) {
      const now = new Date().toISOString();
      const readThread = threads.find((thread) => thread.id === visibleThreadId);
      if (readThread) {
        if (isOffice) {
          readThread.officeLastReadAt = now;
          readThread.officeUnreadCount = 0;
        } else {
          readThread.studentLastReadAt = now;
          readThread.studentUnreadCount = 0;
        }
      }
    }
  }

  let students = {};
  if (isOffice && rows.length) {
    const studentIds = [...new Set(rows.map((row) => row.student_id))];
    const profilesResult = await supabase.from('profiles').select('user_id, full_name, degree_program, department').in('user_id', studentIds);
    if (!profilesResult.error) {
      students = Object.fromEntries((profilesResult.data || []).map((profile) => [profile.user_id, {
        fullName: profile.full_name || 'Student',
        degreeProgram: profile.degree_program || '',
        department: profile.department || '',
      }]));
    }
  }

  return { success: true, ready: true, threads, messages, students, selectedThreadId: visibleThreadId };
};

export const sendSupabaseSupportMessage = async ({ threadId, body }) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  let targetThreadId = threadId;
  if (!targetThreadId) {
    const threadResult = await supabase.rpc('get_or_create_support_thread');
    if (threadResult.error) return { data: null, error: threadResult.error };
    targetThreadId = threadResult.data?.id;
  }
  if (!targetThreadId) return { data: null, error: { message: 'Your support thread could not be opened.' } };
  const result = await supabase.from('support_messages').insert({ thread_id: targetThreadId, body }).select('*').single();
  return { data: result.data ? toSupportMessage(result.data) : null, threadId: targetThreadId, error: result.error };
};

export const postSupabaseAssistantSupportMessage = async ({ threadId, body, replyingToId }) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const { data, error } = await supabase.rpc('post_assistant_support_message', {
    p_thread_id: threadId,
    p_body: body,
    p_replying_to_id: replyingToId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row ? toSupportMessage(row) : null, error };
};

export const escalateSupabaseSupportThread = async (threadId, note = '') => {
  if (!ensureReady()) return { error: { message: 'Supabase is not configured.' } };
  const { error } = await supabase.rpc('escalate_support_thread', { p_thread_id: threadId, p_note: note || null });
  return { error };
};

export const resolveSupabaseSupportThread = async (threadId) => {
  if (!ensureReady()) return { error: { message: 'Supabase is not configured.' } };
  const { error } = await supabase.rpc('resolve_support_thread', { p_thread_id: threadId });
  return { error };
};

export const startNewSupabaseSupportTopic = async (threadId) => {
  if (!ensureReady()) return { error: { message: 'Supabase is not configured.' } };
  const { error } = await supabase.rpc('start_new_support_topic', { p_thread_id: threadId });
  return { error };
};

export const getOrCreateSupabaseSupportThread = async () => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const { data, error } = await supabase.rpc('get_or_create_support_thread');
  return { data: data ? toSupportThread(data) : null, error };
};

export const touchSupabaseOfficeSupportPresence = async () => {
  if (!ensureReady()) return { error: { message: 'Supabase is not configured.' } };
  const { error } = await supabase.rpc('touch_office_support_presence');
  return { error };
};

export const getSupabaseAdmissionsOfficeAvailability = async () => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const { data, error } = await supabase.rpc('get_admissions_office_availability');
  return { data: data || null, error };
};

export const markSupabaseSupportThreadRead = async (threadId) => {
  if (!ensureReady()) return { error: { message: 'Supabase is not configured.' } };
  const { error } = await supabase.rpc('mark_support_thread_read', { p_thread_id: threadId });
  return { error };
};

export const loadSupabaseNotifications = async (userId) => {
  if (!ensureReady() || !userId) return { notifications: [], error: { message: 'Supabase is not configured.' } };
  const { data, error } = await supabase.from('notifications').select('*').eq('profile_id', userId).order('created_at', { ascending: false });
  return { notifications: error ? [] : (data || []).map(toNotification), error };
};

export const setSupabaseSupportThreadStatus = async (threadId, status) => {
  if (!ensureReady()) return { error: { message: 'Supabase is not configured.' } };
  const { error } = await supabase.rpc('set_support_thread_status', { p_thread_id: threadId, p_status: status });
  return { error };
};

// Interview locations are managed by the Admissions Office Admin; RLS refuses
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
// schema-level auditing. Endorsement is now the Admissions Office Admin's
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

// open_application_for_student: the Admissions Office Admin opens a Draft for a
// student as an eligibility exception. The RPC re-checks the role, the student,
// the track, the deadline, and duplicates, files the reason in the staff-only
// review thread, and notifies the student without the reason.
export const openSupabaseApplicationForStudent = ({ id, studentId, scholarshipId, reason }) => (
  ensureReady()
    ? supabase.rpc('open_application_for_student', {
      p_application_id: id,
      p_student_id: studentId,
      p_scholarship_id: scholarshipId,
      p_reason: reason,
    }).then(({ data, error }) => ({ data, error }))
    : Promise.resolve({ data: null, error: { message: 'Supabase is not configured.' } })
);

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

// Additional-document requests (20261114000000). Each RPC re-checks the caller:
// the Admin raises and cancels a request, the owning student answers it.
const documentRequestResult = ({ data, error }) => (
  error ? { error } : { request: toDocumentRequest(Array.isArray(data) ? data[0] : data) }
);
const supabaseNotConfigured = () => Promise.resolve({ error: { message: 'Supabase is not configured.' } });

export const requestSupabaseApplicationDocuments = (applicationId, {
  kind, requirementId = null, documentTypes = [], label, note, minFiles = 1,
} = {}) => (
  ensureReady()
    ? supabase.rpc('request_application_documents', {
        p_application_id: applicationId,
        p_kind: kind,
        p_requirement_id: requirementId,
        p_document_types: documentTypes,
        p_label: label,
        p_note: note,
        p_min_files: minFiles,
      }).then(documentRequestResult)
    : supabaseNotConfigured()
);

export const cancelSupabaseDocumentRequest = (requestId, reason) => (
  ensureReady()
    ? supabase.rpc('cancel_document_request', { p_request_id: requestId, p_reason: reason }).then(documentRequestResult)
    : supabaseNotConfigured()
);

export const fulfillSupabaseDocumentRequest = (requestId, documentIds) => (
  ensureReady()
    ? supabase.rpc('fulfill_document_request', { p_request_id: requestId, p_document_ids: documentIds }).then(documentRequestResult)
    : supabaseNotConfigured()
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
// Admissions Office Admin; both office lanes and Department Chairs read them.
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

// The Admin's approval-level settings (SOP step 7 routing). One row per school,
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

export const releaseSupabaseScholarshipResults = async (scholarshipId, confirmBy, requestId) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.rpc('release_scholarship_results', {
    p_scholarship_id: scholarshipId,
    p_confirm_by: confirmBy || null,
    p_request_id: requestId,
  });
  if (result.error) return { data: null, error: result.error };
  const row = result.data?.release;
  return {
    error: null,
    data: row ? {
      release: toResultsRelease(row),
      releasedApplicationIds: Array.isArray(result.data.releasedApplicationIds) ? result.data.releasedApplicationIds : [],
      applications: Array.isArray(result.data.applications) ? result.data.applications.map((application) => ({
        id: application.id,
        updatedAt: application.updated_at,
        release: application.release,
        timeline: application.timeline || [],
      })) : [],
      replayed: Boolean(result.data.replayed),
    } : null,
  };
};

// The second wave of a scholarship's results (close_results_round, Admin only):
// the applicants still waitlisted become Not accepted and the closing release's
// insert trigger sends every Not accepted applicant the general letter.
export const closeSupabaseResultsRound = async (scholarshipId) => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.rpc('close_results_round', { p_scholarship_id: scholarshipId });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return { error: result.error, data: row ? toResultsRelease(row) : null };
};

// The Admin's waitlist order for one scholarship, highest first.
export const setSupabaseWaitlistOrder = async (scholarshipId, applicationIds) => {
  if (!ensureReady()) return { error: { message: 'Supabase is not configured.' } };
  return supabase.rpc('set_waitlist_order', { p_scholarship_id: scholarshipId, p_application_ids: applicationIds });
};

// An accepted applicant's answer to the offer, or the Admin recording one given
// outside the app. A decline moves the application to Declined in the same call.
export const respondSupabaseScholarshipOffer = async (applicationId, response, reason = '') => {
  if (!ensureReady()) return { data: null, error: { message: 'Supabase is not configured.' } };
  const result = await supabase.rpc('respond_to_scholarship_offer', {
    p_application_id: applicationId,
    p_response: response,
    p_reason: reason || null,
  });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return { error: result.error, data: row ? toScholarshipOffer(row) : null };
};

// A waitlisted applicant leaving the waitlist (or the Admin recording it).
export const withdrawSupabaseFromWaitlist = async (applicationId, reason = '') => {
  if (!ensureReady()) return { error: { message: 'Supabase is not configured.' } };
  return supabase.rpc('withdraw_from_waitlist', { p_application_id: applicationId, p_reason: reason || null });
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
// Account provisioning (the Admissions Office Admin's Accounts page; see
// 20261051000000_account_provisioning.sql). Every write is an RPC that re-checks
// the caller, so a non-Admin session is refused by the database, not just the UI.
// A project that has not applied the migration answers `missing: true`.
const toAccountProfile = (row) => ({
  userId: row.user_id,
  fullName: row.full_name || '',
  email: row.email || '',
  role: row.role,
  department: row.department || '',
  reviewSchool: row.review_school || '',
  reviewCluster: row.review_cluster || '',
  reviewDepartment: row.review_department || '',
  deactivatedAt: row.deactivated_at || null,
  createdAt: row.created_at || null,
});

const toAccountInvitation = (row) => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name || '',
  role: row.role,
  reviewSchool: row.review_school || '',
  reviewCluster: row.review_cluster || '',
  reviewDepartment: row.review_department || '',
  homeSchool: row.home_school || '',
  invitedAt: row.invited_at,
  expiresAt: row.expires_at,
  claimedAt: row.claimed_at || null,
  revokedAt: row.revoked_at || null,
});

const toProvisioningLogEntry = (row) => ({
  id: row.id,
  action: row.action,
  actorId: row.actor_id || null,
  actorRole: row.actor_role || '',
  targetUserId: row.target_user_id || null,
  targetEmail: row.target_email || '',
  role: row.role || '',
  reason: row.reason || '',
  createdAt: row.created_at,
});

export const loadSupabaseAccounts = async () => {
  if (!ensureReady()) return { success: false, missing: false, error: { message: 'Supabase is not configured.' } };
  const [profiles, invitations, log] = await Promise.all([
    supabase
      .from('profiles')
      .select('user_id, full_name, email, role, department, review_school, review_cluster, review_department, deactivated_at, created_at')
      .neq('role', 'student')
      .order('full_name', { ascending: true }),
    supabase.from('account_invitations').select('*').order('invited_at', { ascending: false }),
    supabase.from('account_provisioning_log').select('*').order('created_at', { ascending: false }).limit(25),
  ]);
  const failure = profiles.error || invitations.error || log.error;
  if (failure) return { success: false, missing: isMissingTableError(failure) || failure.code === '42703', error: failure };
  return {
    success: true,
    missing: false,
    profiles: (profiles.data || []).map(toAccountProfile),
    invitations: (invitations.data || []).map(toAccountInvitation),
    log: (log.data || []).map(toProvisioningLogEntry),
  };
};

const runAccountRpc = async (name, args) => {
  if (!ensureReady()) return { error: { message: 'Supabase is not configured.' } };
  const { error } = await supabase.rpc(name, args);
  return { error: error || null };
};

export const inviteSupabaseAccount = (args) => runAccountRpc('invite_account', args);
export const renewSupabaseAccountInvitation = (invitationId) => runAccountRpc('renew_account_invitation', { p_invitation_id: invitationId });
export const revokeSupabaseAccountInvitation = (invitationId, reason) => runAccountRpc('revoke_account_invitation', { p_invitation_id: invitationId, p_reason: reason });
export const updateSupabaseAccountScope = (userId, args) => runAccountRpc('update_account_scope', { p_user_id: userId, ...args });
export const deactivateSupabaseAccount = (userId, reason) => runAccountRpc('deactivate_account', { p_user_id: userId, p_reason: reason });
export const reactivateSupabaseAccount = (userId) => runAccountRpc('reactivate_account', { p_user_id: userId });
