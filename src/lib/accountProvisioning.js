// Account provisioning (the Admissions Office Admin's Accounts page).
//
// The Admin invites a staff or reviewer account by email; the database assigns the
// role when a confirmed account with that address signs in
// (supabase/migrations/20261051000000_account_provisioning.sql). This module is the
// browser side of that: which scope fields a role needs, the draft validation that
// mirrors `normalize_provisioned_scope()`, and the derivations behind the account
// list. The SQL decides what is allowed; this module decides what the form asks for.

import { getReviewScopeLabel, REVIEW_ROLE_LABELS } from './reviewScope';

export const ACCOUNT_ROLE_LABELS = {
  admissions_office: 'Admissions Office Staff',
  admissions_admin: 'Admissions Office Admin',
  ...REVIEW_ROLE_LABELS,
};

// Interviewers hold exactly one level; the form asks which one.
export const INTERVIEWER_SCOPE_LEVELS = [
  { value: 'school', label: 'A whole school' },
  { value: 'cluster', label: 'A cluster' },
  { value: 'department', label: 'A department' },
];

// The roles the Admin can provision, in the order the picker lists them. `levels`
// are the hierarchy fields the role needs; the interviewer's depend on its level.
export const PROVISIONABLE_ROLES = [
  {
    value: 'admissions_office',
    label: ACCOUNT_ROLE_LABELS.admissions_office,
    summary: 'Read-only view of the intake pool, interviews, and calendar. Does not verify, forward, approve, or release.',
  },
  {
    value: 'admissions_admin',
    label: ACCOUNT_ROLE_LABELS.admissions_admin,
    summary: 'Verifies documents, forwards cases to interview, does the final check, releases results, and manages the catalog and accounts.',
  },
  {
    value: 'dean',
    label: ACCOUNT_ROLE_LABELS.dean,
    summary: 'Owns a school: every cluster and department in it. Approves where the school routes approval to the Dean.',
  },
  {
    value: 'assistant_dean',
    label: ACCOUNT_ROLE_LABELS.assistant_dean,
    summary: 'Owns a cluster inside a school. Approves where the cluster routes approval to the Assistant Dean.',
  },
  {
    value: 'department_chair',
    label: ACCOUNT_ROLE_LABELS.department_chair,
    summary: 'Owns a department and its degree programs. Approves by default when no other level is configured.',
  },
  {
    value: 'interviewer',
    label: ACCOUNT_ROLE_LABELS.interviewer,
    summary: 'Faculty who schedule and run interviews and record the recommendation for applicants in one school, cluster, or department.',
  },
];

export const isOfficeAccountRole = (role) => role === 'admissions_office' || role === 'admissions_admin';

export const getProvisionableRole = (role) => PROVISIONABLE_ROLES.find((entry) => entry.value === role) || null;

// The hierarchy fields a role needs, widest first. Mirrors the shapes
// `normalize_provisioned_scope()` returns.
export const getScopeFields = (role, interviewerLevel = 'school') => {
  if (role === 'dean') return ['school'];
  if (role === 'assistant_dean') return ['school', 'cluster'];
  if (role === 'department_chair') return ['school', 'department'];
  if (role === 'interviewer') {
    if (interviewerLevel === 'department') return ['school', 'department'];
    if (interviewerLevel === 'cluster') return ['school', 'cluster'];
    return ['school'];
  }
  return [];
};

const uniqueSorted = (values) => [...new Set(values.filter(Boolean))];

// Schools, and the clusters and departments under each, from the program catalog
// (the Supabase `academic_programs` rows, or the offline reference list). Order
// follows the taxonomy, so the picker matches the rest of the app.
export const getHierarchyOptions = (programs = []) => {
  const list = Array.isArray(programs) ? programs : [];
  const schools = uniqueSorted(list.map((program) => program?.school));
  const clustersBySchool = {};
  const departmentsBySchool = {};
  schools.forEach((school) => {
    const inSchool = list.filter((program) => program?.school === school);
    clustersBySchool[school] = uniqueSorted(inSchool.map((program) => program.cluster));
    departmentsBySchool[school] = uniqueSorted(inSchool.map((program) => program.department));
  });
  return { schools, clustersBySchool, departmentsBySchool };
};

export const EMPTY_INVITATION_DRAFT = {
  email: '',
  fullName: '',
  role: '',
  interviewerLevel: 'school',
  school: '',
  cluster: '',
  department: '',
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Mirrors the checks in `invite_account()` / `normalize_provisioned_scope()`, so the
// Admin sees the problem next to the field instead of as a database error.
export const validateInvitationDraft = (draft = {}, programs = []) => {
  const errors = {};
  const email = String(draft.email || '').trim();
  if (!email) errors.email = 'Enter the email address the person will sign in with.';
  else if (!EMAIL_PATTERN.test(email) || email.length > 320) errors.email = 'Enter a valid email address.';

  if (!getProvisionableRole(draft.role)) errors.role = 'Choose a role for this account.';

  const fields = getScopeFields(draft.role, draft.interviewerLevel);
  const hierarchy = getHierarchyOptions(programs);
  if (fields.includes('school')) {
    if (!draft.school) errors.school = 'Choose the school this role belongs to.';
    else if (!hierarchy.schools.includes(draft.school)) errors.school = 'Choose a school from the list.';
  }
  if (fields.includes('cluster')) {
    if (!draft.cluster) errors.cluster = 'Choose the cluster.';
    else if (draft.school && !(hierarchy.clustersBySchool[draft.school] || []).includes(draft.cluster)) {
      errors.cluster = 'That cluster does not belong to the chosen school.';
    }
  }
  if (fields.includes('department')) {
    if (!draft.department) errors.department = 'Choose the department.';
    else if (draft.school && !(hierarchy.departmentsBySchool[draft.school] || []).includes(draft.department)) {
      errors.department = 'That department does not belong to the chosen school.';
    }
  }
  return { errors, valid: Object.keys(errors).length === 0 };
};

// The arguments for `invite_account()` / `update_account_scope()`: only the levels
// the role owns are sent, so a stale cluster left in the form never rides along.
export const buildScopeArguments = (draft = {}) => {
  const fields = getScopeFields(draft.role, draft.interviewerLevel);
  return {
    p_role: draft.role,
    p_school: fields.includes('school') ? draft.school || null : null,
    p_cluster: fields.includes('cluster') ? draft.cluster || null : null,
    p_department: fields.includes('department') ? draft.department || null : null,
  };
};

export const buildInvitationArguments = (draft = {}) => ({
  p_email: String(draft.email || '').trim().toLowerCase(),
  p_full_name: String(draft.fullName || '').trim() || null,
  ...buildScopeArguments(draft),
});

// A form draft for an existing account, so "Change role or scope" opens on what the
// account holds now. An interviewer's level is the narrowest one it has.
export const getDraftFromAccount = (account = {}) => {
  const role = account.role || '';
  const interviewerLevel = account.reviewDepartment ? 'department' : account.reviewCluster ? 'cluster' : 'school';
  const school = account.reviewSchool || account.department || '';
  return {
    ...EMPTY_INVITATION_DRAFT,
    email: account.email || '',
    fullName: account.fullName || '',
    role,
    interviewerLevel,
    school,
    cluster: account.reviewCluster || '',
    department: account.reviewDepartment || '',
  };
};

// The scope as one line: "School of Arts and Sciences (SAS) · Computer Studies".
export const getAccountScopeLabel = (account = {}) => {
  if (isOfficeAccountRole(account.role)) return 'Central office';
  const label = getReviewScopeLabel({
    role: account.role,
    reviewSchool: account.reviewSchool,
    reviewCluster: account.reviewCluster,
    reviewDepartment: account.reviewDepartment,
  });
  if (label) return label;
  // A Chairperson an operator never scoped keeps the legacy school-wide read.
  return account.department ? `${account.department} (school-wide, no department set)` : 'Scope not set';
};

export const INVITATION_LIFETIME_DAYS = 30;

// open: waiting to be claimed; expired: unclaimed past `expiresAt`; claimed and
// revoked are closed and only appear in the provisioning log.
export const getInvitationStatus = (invitation = {}, now = Date.now()) => {
  if (invitation.claimedAt) return 'claimed';
  if (invitation.revokedAt) return 'revoked';
  const expires = invitation.expiresAt ? new Date(invitation.expiresAt).getTime() : NaN;
  if (Number.isFinite(expires) && expires <= now) return 'expired';
  return 'invited';
};

export const ACCOUNT_STATUS_META = {
  active: { label: 'Active', tone: 'success', order: 0 },
  invited: { label: 'Invited', tone: 'info', order: 1 },
  expired: { label: 'Invitation expired', tone: 'warning', order: 2 },
  deactivated: { label: 'Deactivated', tone: 'neutral', order: 3 },
};

// One list for the page: every staff and reviewer account plus the invitations still
// waiting to be claimed. Students never appear.
export const buildAccountRows = ({ profiles = [], invitations = [], now = Date.now() } = {}) => {
  const accountRows = (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => profile?.role && profile.role !== 'student')
    .map((profile) => ({
      kind: 'account',
      id: profile.userId,
      name: profile.fullName || '',
      email: profile.email || '',
      role: profile.role,
      roleLabel: ACCOUNT_ROLE_LABELS[profile.role] || profile.role,
      scopeLabel: getAccountScopeLabel(profile),
      status: profile.deactivatedAt ? 'deactivated' : 'active',
      source: profile,
    }));

  const invitationRows = (Array.isArray(invitations) ? invitations : [])
    .map((invitation) => ({ invitation, status: getInvitationStatus(invitation, now) }))
    .filter(({ status }) => status === 'invited' || status === 'expired')
    .map(({ invitation, status }) => ({
      kind: 'invitation',
      id: invitation.id,
      name: invitation.fullName || '',
      email: invitation.email || '',
      role: invitation.role,
      roleLabel: ACCOUNT_ROLE_LABELS[invitation.role] || invitation.role,
      scopeLabel: getAccountScopeLabel(invitation),
      status,
      expiresAt: invitation.expiresAt,
      invitedAt: invitation.invitedAt,
      source: invitation,
    }));

  const byName = (left, right) => (left.name || left.email).localeCompare(right.name || right.email);
  return [...accountRows, ...invitationRows].sort((left, right) => (
    ACCOUNT_STATUS_META[left.status].order - ACCOUNT_STATUS_META[right.status].order || byName(left, right)
  ));
};

export const summarizeAccounts = (rows = []) => ({
  active: rows.filter((row) => row.status === 'active').length,
  invited: rows.filter((row) => row.status === 'invited').length,
  expired: rows.filter((row) => row.status === 'expired').length,
  deactivated: rows.filter((row) => row.status === 'deactivated').length,
});

export const filterAccountRows = (rows = [], { query = '', role = '', status = '' } = {}) => {
  const needle = String(query || '').trim().toLowerCase();
  return rows.filter((row) => {
    if (role && row.role !== role) return false;
    if (status && row.status !== status) return false;
    if (!needle) return true;
    return [row.name, row.email, row.roleLabel, row.scopeLabel].some((value) => String(value || '').toLowerCase().includes(needle));
  });
};

// Which actions an account row offers the signed-in Admin. The Admin cannot change or
// deactivate their own account (the database refuses it too).
export const getAccountActions = (row, { currentUserId } = {}) => {
  if (row.kind === 'invitation') return ['renew', 'revoke'];
  if (row.id === currentUserId) return [];
  return row.status === 'deactivated' ? ['reactivate'] : ['change', 'deactivate'];
};

export const ACCOUNT_ACTION_LABELS = {
  renew: 'Renew invitation',
  revoke: 'Revoke invitation',
  change: 'Change role or scope',
  deactivate: 'Deactivate',
  reactivate: 'Reactivate',
};

// The provisioning log reads as sentences.
export const describeProvisioningEvent = (entry = {}) => {
  const who = entry.targetEmail || 'an account';
  const role = ACCOUNT_ROLE_LABELS[entry.role] || '';
  switch (entry.action) {
    case 'invited': return `Invited ${who}${role ? ` as ${role}` : ''}`;
    case 'invitation_renewed': return `Renewed the invitation for ${who}`;
    case 'invitation_revoked': return `Revoked the invitation for ${who}`;
    case 'invitation_claimed': return `${who} signed in and took the ${role || 'invited'} role`;
    case 'scope_changed': return `Changed ${who} to ${role || 'a new role'}`;
    case 'deactivated': return `Deactivated ${who}`;
    case 'reactivated': return `Reactivated ${who}`;
    default: return `${who}: ${entry.action || 'updated'}`;
  }
};
