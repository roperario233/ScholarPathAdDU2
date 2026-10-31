// The reviewer scope ladder, mirroring `public.reviewer_scopes_to_student()` in
// supabase/migrations/20261042000001_reviewer_scope_ladder.sql.
//
// AdDU's reviewer roles each own one level of the academic hierarchy:
//
//   Dean            -> a School    (every cluster and department in it)
//   Assistant Dean  -> a Cluster   (every department in it)
//   Chairperson     -> a Department (and the degree programs under it)
//   Interviewer     -> whichever one level the account holds (Consultation 2:
//                      e.g. the Computer Studies cluster of SAS); applications
//                      reach it automatically through this same scope.
//
// A reviewer's scope is stored on their profile (`reviewSchool`, `reviewCluster`,
// `reviewDepartment`; exactly one is set, enforced by a database check). The
// applicant's level is resolved from their degree program through the taxonomy, so
// adding a program next year needs no scope edit here.
//
// The two implementations must agree: this module decides what a page shows, and
// the SQL predicate decides what the row-level policies allow. A divergence makes a
// queue list a case the reviewer cannot open.

import { findAcademicProgram } from './academicPrograms';

// The academic ladder: the levels that can approve for a school (SOP step 7).
export const LADDER_ROLES = ['dean', 'assistant_dean', 'department_chair'];
export const INTERVIEWER_ROLE = 'interviewer';

// Every account scoped to the academic hierarchy: the ladder plus the
// interviewer. Either central Admissions Office lane reads every case, so it is
// never checked against the hierarchy.
export const REVIEWER_ROLES = [...LADDER_ROLES, INTERVIEWER_ROLE];

export const isReviewerRole = (role) => REVIEWER_ROLES.includes(role);
export const isLadderRole = (role) => LADDER_ROLES.includes(role);
export const isInterviewerRole = (role) => role === INTERVIEWER_ROLE;

// How each level is named in the interface.
export const REVIEW_ROLE_LABELS = {
  dean: 'Dean',
  assistant_dean: 'Assistant Dean',
  department_chair: 'Chairperson',
  interviewer: 'Interviewer',
};

// The review route is one page for all three levels; only its title changes.
export const getReviewPageLabel = (role) => (
  role === 'dean' ? 'School Review'
    : role === 'assistant_dean' ? 'Cluster Review'
      : role === INTERVIEWER_ROLE ? 'Interview Queue'
        : 'Department Review'
);

// A reviewer's scope, normalised to the level they own. A Chairperson keeps the
// school label too, because the legacy school-wide fallback below compares it.
export const getReviewerScope = (profile = {}) => {
  const role = profile.role || profile.viewerRole || '';
  const school = String(profile.reviewSchool || '').trim();
  const cluster = String(profile.reviewCluster || '').trim();
  const department = String(profile.reviewDepartment || '').trim();
  const legacySchool = String(profile.department || '').trim();
  if (role === 'dean') return { level: 'school', role, school, cluster: '', department: '', legacySchool };
  if (role === 'assistant_dean') return { level: 'cluster', role, school, cluster, department: '', legacySchool };
  if (role === 'department_chair') return { level: 'department', role, school, cluster: '', department, legacySchool };
  // An interviewer owns the narrowest level it holds. An account with no level
  // yet reads nothing rather than a whole school.
  if (role === INTERVIEWER_ROLE) {
    if (department) return { level: 'department', role, school, cluster: '', department, legacySchool: '' };
    if (cluster && school) return { level: 'cluster', role, school, cluster, department: '', legacySchool: '' };
    if (school) return { level: 'school', role, school, cluster: '', department: '', legacySchool: '' };
  }
  return { level: '', role, school: '', cluster: '', department: '', legacySchool };
};

// The one line a reviewer's page header shows: the narrowest level they own, with
// the wider one in front of it so "Computer Studies" never reads out of context.
export const getReviewScopeLabel = (profile = {}) => {
  const scope = getReviewerScope(profile);
  if (scope.level === 'school') return scope.school;
  if (scope.level === 'cluster') return [scope.school, scope.cluster].filter(Boolean).join(' · ');
  if (scope.level === 'department') return scope.department;
  return '';
};

// A lookup from degree-program `value` to the taxonomy levels it sits in.
export const buildProgramScopeIndex = (programs = []) => new Map(
  (Array.isArray(programs) ? programs : [])
    .filter((program) => program?.value)
    .map((program) => [
      program.value,
      { school: program.school || '', cluster: program.cluster || '', department: program.department || '' },
    ]),
);

// The hierarchy levels an application belongs to. `studentSchool` is the profile's
// stored school; the cluster and department come from the program, so a student who
// changes program changes department without a second write.
export const getApplicationScope = (application = {}, programIndex = new Map()) => {
  const resolved = programIndex.get(application.studentProgram) || findAcademicProgram(application.studentProgram);
  return {
    school: resolved?.school || String(application.studentSchool || '').trim(),
    cluster: resolved?.cluster || '',
    department: resolved?.department || '',
  };
};

// Does a reviewer's scope include this applicant? Mirrors the SQL predicate,
// including its legacy fallback: a Chairperson with no assigned department keeps the
// old school-wide read, so an account an operator has not scoped yet is never
// locked out of its own queue.
export const isApplicationInReviewerScope = (application, scope, programIndex) => {
  if (!scope?.level) return false;
  const target = getApplicationScope(application, programIndex);
  if (!target.school) return false;
  if (scope.level === 'school') return scope.school === target.school;
  if (scope.level === 'cluster') {
    if (scope.school !== target.school) return false;
    if (scope.role === INTERVIEWER_ROLE) return scope.cluster === target.cluster;
    return !scope.cluster || scope.cluster === target.cluster;
  }
  // department: an assigned department is the whole scope; otherwise fall back to
  // the school the account used to own.
  if (scope.department) return scope.department === target.department;
  return scope.legacySchool === target.school;
};

// The Department Review queue, its calendar, and its interview list all read this,
// so one reviewer at any level gets a correctly sized queue.
export const getScopedQueue = (applications = [], profile = {}, programs = []) => {
  const scope = getReviewerScope(profile);
  if (!scope.level) return [];
  const programIndex = buildProgramScopeIndex(programs);
  return (Array.isArray(applications) ? applications : [])
    .filter((application) => isApplicationInReviewerScope(application, scope, programIndex));
};

// Which level a reviewer would draw a panelist from, or null when the applicant is
// outside their scope. Used by `getEligiblePanelists()` to rank panel suggestions
// (SOP 5a): the Chair of the applicant's own department is the most relevant
// reviewer, the Dean of its school the least.
export const getPanelCandidateLevel = (staffEntry = {}, application = {}, programIndex = new Map()) => {
  const role = staffEntry.role || '';
  if (role === 'admissions_office' || role === 'admissions_admin') return 'office';
  if (!isReviewerRole(role)) return null;
  const scope = getReviewerScope(staffEntry);
  if (!isApplicationInReviewerScope(application, scope, programIndex)) return null;
  return scope.level;
};

// Narrowest first, then the Admissions Office lanes.
export const PANEL_LEVEL_ORDER = ['department', 'cluster', 'school', 'office'];

// SOP step 7: which ladder level approves for the applicant's school or cluster.
// Mirrors `public.approver_role_for_student()`
// (20261050000000_interviewer_role_and_approval_routing.sql): the cluster row,
// then the school row, else the Chairperson.
export const DEFAULT_APPROVER_ROLE = 'department_chair';

export const getApproverRoleForApplication = (application = {}, approvalLevels = [], programIndex = new Map()) => {
  const target = getApplicationScope(application, programIndex);
  const levels = Array.isArray(approvalLevels) ? approvalLevels : [];
  if (target.school) {
    const clusterRow = target.cluster
      ? levels.find((entry) => entry.school === target.school && entry.cluster && entry.cluster === target.cluster)
      : null;
    if (clusterRow) return clusterRow.approverRole;
    const schoolRow = levels.find((entry) => entry.school === target.school && !entry.cluster);
    if (schoolRow) return schoolRow.approverRole;
  }
  return DEFAULT_APPROVER_ROLE;
};

// Is this signed-in reviewer the approver for the application? Scope first, then
// the configured level.
export const isApproverForApplication = (application, profile = {}, approvalLevels = [], programIndex = new Map()) => {
  const scope = getReviewerScope(profile);
  if (!isLadderRole(scope.role)) return false;
  if (!isApplicationInReviewerScope(application, scope, programIndex)) return false;
  return getApproverRoleForApplication(application, approvalLevels, programIndex) === scope.role;
};

