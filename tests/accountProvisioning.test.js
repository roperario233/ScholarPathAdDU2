import { describe, expect, it } from 'vitest';
import {
  EMPTY_INVITATION_DRAFT,
  buildAccountRows,
  buildInvitationArguments,
  buildScopeArguments,
  describeProvisioningEvent,
  filterAccountRows,
  getAccountActions,
  getAccountScopeLabel,
  getDraftFromAccount,
  getHierarchyOptions,
  getInvitationStatus,
  getScopeFields,
  summarizeAccounts,
  validateInvitationDraft,
} from '../src/lib/accountProvisioning';
import { academicPrograms } from '../src/lib/academicPrograms';
import { pageViewKeys } from '../src/lib/constants';

const SAS = 'School of Arts and Sciences (SAS)';
const SEA = 'School of Engineering and Architecture (SEA)';
const NOW = new Date('2026-10-29T00:00:00.000Z').getTime();

const draft = (overrides = {}) => ({ ...EMPTY_INVITATION_DRAFT, email: 'faculty@example.com', ...overrides });

describe('getScopeFields', () => {
  it('asks each role for exactly the levels it owns', () => {
    expect(getScopeFields('admissions_office')).toEqual([]);
    expect(getScopeFields('admissions_head')).toEqual([]);
    expect(getScopeFields('dean')).toEqual(['school']);
    expect(getScopeFields('assistant_dean')).toEqual(['school', 'cluster']);
    expect(getScopeFields('department_chair')).toEqual(['school', 'department']);
  });

  it('lets an interviewer hold one level, chosen by the form', () => {
    expect(getScopeFields('interviewer', 'school')).toEqual(['school']);
    expect(getScopeFields('interviewer', 'cluster')).toEqual(['school', 'cluster']);
    expect(getScopeFields('interviewer', 'department')).toEqual(['school', 'department']);
  });
});

describe('getHierarchyOptions', () => {
  const hierarchy = getHierarchyOptions(academicPrograms);

  it('lists the schools with their own clusters and departments', () => {
    expect(hierarchy.schools).toContain(SAS);
    expect(hierarchy.clustersBySchool[SAS]).toContain('Computer Studies');
    expect(hierarchy.departmentsBySchool[SAS]).toContain('Computer Science Department');
  });

  it('gives a direct-under school no clusters', () => {
    expect(hierarchy.clustersBySchool[SEA]).toEqual([]);
    expect(hierarchy.departmentsBySchool[SEA].length).toBeGreaterThan(0);
  });
});

describe('validateInvitationDraft', () => {
  it('requires an email and a role', () => {
    const { errors, valid } = validateInvitationDraft(EMPTY_INVITATION_DRAFT, academicPrograms);
    expect(valid).toBe(false);
    expect(errors.email).toBeTruthy();
    expect(errors.role).toBeTruthy();
  });

  it('rejects a malformed email', () => {
    const { errors } = validateInvitationDraft(draft({ email: 'not-an-email', role: 'admissions_office' }), academicPrograms);
    expect(errors.email).toMatch(/valid email/i);
  });

  it('needs no scope for either Admissions Office lane', () => {
    expect(validateInvitationDraft(draft({ role: 'admissions_office' }), academicPrograms).valid).toBe(true);
    expect(validateInvitationDraft(draft({ role: 'admissions_head' }), academicPrograms).valid).toBe(true);
  });

  it('requires the cluster for an Assistant Dean and checks it belongs to the school', () => {
    expect(validateInvitationDraft(draft({ role: 'assistant_dean', school: SAS }), academicPrograms).errors.cluster).toBeTruthy();
    expect(validateInvitationDraft(draft({ role: 'assistant_dean', school: SAS, cluster: 'Accountancy' }), academicPrograms).errors.cluster).toMatch(/does not belong/i);
    expect(validateInvitationDraft(draft({ role: 'assistant_dean', school: SAS, cluster: 'Computer Studies' }), academicPrograms).valid).toBe(true);
  });

  it('requires a department of the chosen school for a Chairperson', () => {
    expect(validateInvitationDraft(draft({ role: 'department_chair', school: SAS }), academicPrograms).errors.department).toBeTruthy();
    expect(validateInvitationDraft(draft({ role: 'department_chair', school: SAS, department: 'Architecture Department' }), academicPrograms).errors.department).toMatch(/does not belong/i);
    expect(validateInvitationDraft(draft({ role: 'department_chair', school: SAS, department: 'Computer Science Department' }), academicPrograms).valid).toBe(true);
  });

  it('accepts a school-level interviewer and rejects a cluster-level one with no cluster', () => {
    expect(validateInvitationDraft(draft({ role: 'interviewer', interviewerLevel: 'school', school: SEA }), academicPrograms).valid).toBe(true);
    expect(validateInvitationDraft(draft({ role: 'interviewer', interviewerLevel: 'cluster', school: SAS }), academicPrograms).errors.cluster).toBeTruthy();
  });
});

describe('invitation arguments', () => {
  it('sends only the levels the role owns', () => {
    const args = buildScopeArguments(draft({
      role: 'dean', school: SAS, cluster: 'Computer Studies', department: 'Computer Science Department',
    }));
    expect(args).toEqual({ p_role: 'dean', p_school: SAS, p_cluster: null, p_department: null });
  });

  it('keeps the narrowest level for an interviewer and drops the stale ones', () => {
    const args = buildScopeArguments(draft({
      role: 'interviewer', interviewerLevel: 'cluster', school: SAS, cluster: 'Computer Studies', department: 'Computer Science Department',
    }));
    expect(args).toEqual({ p_role: 'interviewer', p_school: SAS, p_cluster: 'Computer Studies', p_department: null });
  });

  it('normalizes the email and leaves an empty name null', () => {
    const args = buildInvitationArguments(draft({ email: '  Faculty@Example.COM ', fullName: '  ', role: 'admissions_office' }));
    expect(args.p_email).toBe('faculty@example.com');
    expect(args.p_full_name).toBeNull();
    expect(args.p_school).toBeNull();
  });
});

describe('getDraftFromAccount', () => {
  it('reopens an interviewer on the narrowest level it holds', () => {
    const result = getDraftFromAccount({ role: 'interviewer', reviewSchool: SAS, reviewCluster: 'Computer Studies', email: 'a@b.co' });
    expect(result).toMatchObject({ role: 'interviewer', interviewerLevel: 'cluster', school: SAS, cluster: 'Computer Studies' });
  });

  it('reads a Chairperson school from the legacy department label', () => {
    const result = getDraftFromAccount({ role: 'department_chair', department: SAS, reviewDepartment: 'Computer Science Department' });
    expect(result).toMatchObject({ school: SAS, department: 'Computer Science Department' });
  });
});

describe('getAccountScopeLabel', () => {
  it('labels the office lanes and each reviewer level', () => {
    expect(getAccountScopeLabel({ role: 'admissions_head' })).toBe('Central office');
    expect(getAccountScopeLabel({ role: 'dean', reviewSchool: SAS })).toBe(SAS);
    expect(getAccountScopeLabel({ role: 'assistant_dean', reviewSchool: SAS, reviewCluster: 'Computer Studies' })).toBe(`${SAS} · Computer Studies`);
    expect(getAccountScopeLabel({ role: 'department_chair', reviewDepartment: 'Computer Science Department' })).toBe('Computer Science Department');
  });

  it('says so when a Chairperson was never scoped', () => {
    expect(getAccountScopeLabel({ role: 'department_chair', department: SAS })).toMatch(/school-wide/);
    expect(getAccountScopeLabel({ role: 'dean' })).toBe('Scope not set');
  });
});

describe('getInvitationStatus', () => {
  const base = { expiresAt: '2026-11-15T00:00:00.000Z' };

  it('is invited while open and expired once the date passes', () => {
    expect(getInvitationStatus(base, NOW)).toBe('invited');
    expect(getInvitationStatus({ expiresAt: '2026-10-01T00:00:00.000Z' }, NOW)).toBe('expired');
  });

  it('treats claimed and revoked as closed before expiry', () => {
    expect(getInvitationStatus({ ...base, claimedAt: '2026-10-20T00:00:00.000Z' }, NOW)).toBe('claimed');
    expect(getInvitationStatus({ ...base, revokedAt: '2026-10-20T00:00:00.000Z' }, NOW)).toBe('revoked');
  });
});

describe('account rows', () => {
  const profiles = [
    { userId: 'student-1', role: 'student', fullName: 'Student', email: 's@example.com' },
    { userId: 'head-1', role: 'admissions_head', fullName: 'Head Reyes', email: 'head@example.com' },
    { userId: 'dean-1', role: 'dean', fullName: 'Dean Cruz', email: 'dean@example.com', reviewSchool: SAS },
    { userId: 'chair-1', role: 'department_chair', fullName: 'Chair Lim', email: 'chair@example.com', department: SAS, reviewDepartment: 'Computer Science Department', deactivatedAt: '2026-10-10T00:00:00.000Z' },
  ];
  const invitations = [
    { id: 'inv-open', email: 'open@example.com', role: 'interviewer', reviewSchool: SAS, reviewCluster: 'Computer Studies', expiresAt: '2026-11-15T00:00:00.000Z' },
    { id: 'inv-old', email: 'old@example.com', role: 'admissions_office', expiresAt: '2026-10-01T00:00:00.000Z' },
    { id: 'inv-claimed', email: 'done@example.com', role: 'dean', claimedAt: '2026-10-02T00:00:00.000Z', expiresAt: '2026-11-15T00:00:00.000Z' },
    { id: 'inv-revoked', email: 'gone@example.com', role: 'dean', revokedAt: '2026-10-02T00:00:00.000Z', expiresAt: '2026-11-15T00:00:00.000Z' },
  ];
  const rows = buildAccountRows({ profiles, invitations, now: NOW });

  it('lists staff and open invitations only, never students or closed invitations', () => {
    expect(rows.map((row) => row.id).sort()).toEqual(['chair-1', 'dean-1', 'head-1', 'inv-old', 'inv-open']);
  });

  it('orders active, then invited, then expired, then deactivated', () => {
    expect(rows.map((row) => row.status)).toEqual(['active', 'active', 'invited', 'expired', 'deactivated']);
  });

  it('summarizes and filters the rows', () => {
    expect(summarizeAccounts(rows)).toEqual({ active: 2, invited: 1, expired: 1, deactivated: 1 });
    expect(filterAccountRows(rows, { role: 'dean' }).map((row) => row.id)).toEqual(['dean-1']);
    expect(filterAccountRows(rows, { status: 'expired' }).map((row) => row.id)).toEqual(['inv-old']);
    expect(filterAccountRows(rows, { query: 'computer studies' }).map((row) => row.id)).toEqual(['inv-open']);
  });

  it('offers actions that fit each row and never lets the Head act on themselves', () => {
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(getAccountActions(byId['inv-open'], { currentUserId: 'head-1' })).toEqual(['renew', 'revoke']);
    expect(getAccountActions(byId['dean-1'], { currentUserId: 'head-1' })).toEqual(['change', 'deactivate']);
    expect(getAccountActions(byId['chair-1'], { currentUserId: 'head-1' })).toEqual(['reactivate']);
    expect(getAccountActions(byId['head-1'], { currentUserId: 'head-1' })).toEqual([]);
  });
});

describe('describeProvisioningEvent', () => {
  it('phrases each action as a sentence', () => {
    expect(describeProvisioningEvent({ action: 'invited', targetEmail: 'a@b.co', role: 'dean' })).toBe('Invited a@b.co as Dean');
    expect(describeProvisioningEvent({ action: 'invitation_claimed', targetEmail: 'a@b.co', role: 'interviewer' })).toBe('a@b.co signed in and took the Interviewer role');
    expect(describeProvisioningEvent({ action: 'deactivated', targetEmail: 'a@b.co' })).toBe('Deactivated a@b.co');
  });
});

describe('routing', () => {
  it('registers the Accounts route so a saved view resolves', () => {
    expect(pageViewKeys).toContain('admin-accounts');
  });
});
