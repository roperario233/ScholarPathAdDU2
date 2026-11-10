import { describe, expect, it } from 'vitest';
import { findStageCountMismatch, mergeWorkspaceDetails, mergeWorkspaceRefresh, WORKSPACE_FULL_RECONCILE_INTERVAL_MS, WORKSPACE_REFRESH_INTERVAL_MS, WORKSPACE_REFRESH_JITTER_MS } from '../src/lib/workspaceRefresh';

const state = (overrides = {}) => ({
  ownerId: 'student-1',
  viewerRole: 'student',
  applications: [{ id: 'app-1', status: 'Submitted' }],
  notifications: [],
  customDeadlines: [],
  reviewComments: [],
  interviewNotes: [],
  interviewPanelists: [],
  theme: 'dark',
  ...overrides,
});

const workspace = (overrides = {}) => ({
  success: true,
  applications: [{ id: 'app-1', status: 'Interview', interview: { state: 'scheduled' } }],
  notifications: [{ id: 'notice-1', title: 'Application update' }],
  customDeadlines: [],
  reviewComments: [{ id: 'comment-1', applicationId: 'app-1', body: 'Internal' }],
  interviewNotes: [{ id: 'note-1', applicationId: 'app-1', body: 'Panel note' }],
  interviewPanelists: [{ id: 'panel-1', applicationId: 'app-1' }],
  ...overrides,
});

describe('workspace refresh', () => {
  it('refreshes server-backed application and staff data without losing local preferences/reminders', () => {
    const previous = state({
      notifications: [{ id: 'local-reminder', title: 'Deadline reminder', sourceKey: 'deadline-app-1', ownerId: 'student-1' }],
      customDeadlines: [
        { id: 'custom-local', title: 'Local unsynced', ownerId: 'student-1' },
        { id: 'custom-other', title: 'Other account', ownerId: 'student-2' },
      ],
    });
    const refreshed = mergeWorkspaceRefresh(previous, workspace({
      customDeadlines: [{ id: 'custom-server', title: 'Server deadline' }],
    }), 'student-1');

    expect(refreshed.applications[0].status).toBe('Interview');
    expect(refreshed.notifications.map((entry) => entry.id)).toContain('local-reminder');
    expect(refreshed.notifications.map((entry) => entry.id)).toContain('notice-1');
    expect(refreshed.customDeadlines.map((entry) => entry.id)).toEqual(['custom-server', 'custom-local']);
    expect(refreshed.theme).toBe('dark');
  });

  it('never exposes reviewer comments, panel notes, or staff records to student state', () => {
    const refreshed = mergeWorkspaceRefresh(state(), workspace({
      departmentReviews: [{ id: 'review-1' }],
      staffDirectory: [{ id: 'staff-1' }],
      interviewLocations: [{ id: 'location-1' }],
      officeCalendarEntries: [{ id: 'office-event-1' }],
      approvalLevels: [{ id: 'approval-1' }],
    }), 'student-1');

    expect(refreshed.reviewComments).toEqual([]);
    expect(refreshed.interviewNotes).toEqual([]);
    expect(refreshed.interviewPanelists).toEqual([]);
    expect(refreshed.departmentReviews).toEqual([]);
    expect(refreshed.staffDirectory).toEqual([]);
    expect(refreshed.interviewLocations).toEqual([]);
    expect(refreshed.officeCalendarEntries).toEqual([]);
    expect(refreshed.approvalLevels).toEqual([]);
  });

  it('accepts staff notes for staff state and ignores failed or stale-account responses', () => {
    const staffState = state({ ownerId: 'reviewer-1', viewerRole: 'interviewer' });
    const refreshed = mergeWorkspaceRefresh(staffState, workspace(), 'reviewer-1');
    const otherOwnerState = state();
    expect(refreshed.reviewComments).toHaveLength(1);
    expect(refreshed.interviewNotes).toHaveLength(1);
    expect(mergeWorkspaceRefresh(otherOwnerState, workspace(), 'someone-else')).toBe(otherOwnerState);
    expect(mergeWorkspaceRefresh(staffState, { success: false }, 'reviewer-1')).toBe(staffState);
  });

  it('uses a lightweight refresh interval', () => {
    expect(WORKSPACE_REFRESH_INTERVAL_MS).toBe(15_000);
    expect(WORKSPACE_REFRESH_JITTER_MS).toBe(5_000);
    expect(WORKSPACE_FULL_RECONCILE_INTERVAL_MS).toBe(300_000);
  });

  it('merges changed-row refreshes without dropping untouched rows or local reminders', () => {
    const previous = state({
      viewerRole: 'admissions_admin',
      applications: [{ id: 'app-1', status: 'Submitted' }, { id: 'app-2', status: 'Interview' }],
      documents: [{ id: 'doc-1', verificationStatus: 'Pending' }],
      notifications: [
        { id: 'remote-1', status: 'Unread', createdAt: '2026-11-04T00:00:00Z' },
        { id: 'local-1', sourceKey: 'deadline-1', ownerId: 'student-1' },
      ],
      students: { 'student-1': { fullName: 'Old name' } },
      caseOfficers: [{ id: 'officer-1', applicationId: 'app-1', leftAt: null }],
      resultsReleases: [{ id: 'release-1', applicationIds: ['app-1'] }],
    });
    const refreshed = mergeWorkspaceRefresh(previous, {
      success: true,
      refreshMode: 'delta',
      applications: [{ id: 'app-1', status: 'For Verification' }],
      documents: [{ id: 'doc-1', verificationStatus: 'Verified' }],
      notifications: [
        { id: 'remote-1', status: 'Read', createdAt: '2026-11-04T00:00:00Z' },
        { id: 'remote-2', status: 'Unread', createdAt: '2026-11-05T00:00:00Z' },
      ],
      students: { 'student-1': { fullName: 'New name' } },
      caseOfficers: [{ id: 'officer-1', applicationId: 'app-1', leftAt: '2026-11-05T00:00:00Z' }],
      resultsReleases: [{ id: 'release-2', applicationIds: ['app-2'] }],
    }, 'student-1');

    expect(refreshed.applications.map(({ id, status }) => [id, status])).toEqual([
      ['app-1', 'For Verification'],
      ['app-2', 'Interview'],
    ]);
    expect(refreshed.documents[0].verificationStatus).toBe('Verified');
    expect(refreshed.notifications.find((entry) => entry.id === 'remote-1').status).toBe('Read');
    expect(refreshed.notifications.map((entry) => entry.id)).toContain('local-1');
    expect(refreshed.notifications.map((entry) => entry.id)).toContain('remote-2');
    expect(refreshed.students['student-1'].fullName).toBe('New name');
    expect(refreshed.caseOfficers[0].leftAt).toBe('2026-11-05T00:00:00Z');
    expect(refreshed.resultsReleases.map((entry) => entry.id)).toEqual(['release-1', 'release-2']);
  });
});

describe('deferred per-case details (staff sessions)', () => {
  const staff = (overrides = {}) => state({
    ownerId: 'admin-1',
    viewerRole: 'admissions_admin',
    workspaceDetailsReady: false,
    applications: [
      { id: 'app-1', status: 'Interview', statusLog: [] },
      { id: 'app-2', status: 'Submitted', statusLog: [] },
    ],
    reviewComments: [],
    interviewNotes: [],
    ...overrides,
  });
  const logEntry = (id, applicationId, at) => ({ id, applicationId, toStatus: 'Submitted', at });

  it('merges the whole history in once and marks the details ready', () => {
    const merged = mergeWorkspaceDetails(staff(), {
      success: true,
      scope: 'all',
      statusLogs: { 'app-1': [logEntry('l1', 'app-1', '2026-11-01'), logEntry('l2', 'app-1', '2026-11-02')], 'app-2': [logEntry('l3', 'app-2', '2026-11-03')] },
      reviewComments: [{ id: 'c1', applicationId: 'app-1', createdAt: '2026-11-02' }],
      interviewNotes: [{ id: 'n1', applicationId: 'app-1', createdAt: '2026-11-02' }],
    }, 'admin-1');

    expect(merged.workspaceDetailsReady).toBe(true);
    expect(merged.applications[0].statusLog.map((entry) => entry.id)).toEqual(['l1', 'l2']);
    expect(merged.applications[1].statusLog).toHaveLength(1);
    expect(merged.reviewComments).toHaveLength(1);
    expect(merged.interviewNotes).toHaveLength(1);
  });

  it('a single opened case fills that case without claiming the whole history is loaded', () => {
    const merged = mergeWorkspaceDetails(staff(), {
      success: true,
      scope: 'cases',
      applicationIds: ['app-2'],
      statusLogs: { 'app-2': [logEntry('l3', 'app-2', '2026-11-03')] },
    }, 'admin-1');

    expect(merged.workspaceDetailsReady).toBe(false);
    expect(merged.applications[0].statusLog).toEqual([]);
    expect(merged.applications[1].statusLog).toHaveLength(1);
  });

  it('never rolls back a newer row delivered by a refresh, and keeps unchanged objects identical', () => {
    const newer = logEntry('l9', 'app-1', '2026-11-09');
    const previous = staff({ applications: [{ id: 'app-1', status: 'Recommended', statusLog: [newer] }, { id: 'app-2', statusLog: [] }] });
    const merged = mergeWorkspaceDetails(previous, {
      success: true,
      scope: 'all',
      statusLogs: { 'app-1': [logEntry('l1', 'app-1', '2026-11-01'), newer] },
    }, 'admin-1');

    expect(merged.applications[0].statusLog.map((entry) => entry.id)).toEqual(['l1', 'l9']);
    expect(merged.applications[1]).toBe(previous.applications[1]);

    const again = mergeWorkspaceDetails(merged, { success: true, scope: 'all', statusLogs: { 'app-1': [logEntry('l1', 'app-1', '2026-11-01')] } }, 'admin-1');
    expect(again).toBe(merged);
  });

  it('ignores a response for another account and never touches a student session', () => {
    const details = { success: true, scope: 'all', statusLogs: { 'app-1': [logEntry('l1', 'app-1', '2026-11-01')] } };
    const previous = staff();
    expect(mergeWorkspaceDetails(previous, details, 'someone-else')).toBe(previous);
    const student = state();
    expect(mergeWorkspaceDetails(student, details, 'student-1')).toBe(student);
    expect(mergeWorkspaceDetails(previous, { success: false }, 'admin-1')).toBe(previous);
  });

  it('a full reconcile that skips the history keeps the logs already in memory', () => {
    const previous = staff({
      workspaceDetailsReady: true,
      applications: [{ id: 'app-1', status: 'Interview', statusLog: [logEntry('l1', 'app-1', '2026-11-01')] }],
    });
    const refreshed = mergeWorkspaceRefresh(previous, {
      success: true,
      detailsDeferred: true,
      applications: [{ id: 'app-1', status: 'Interview', statusLog: [] }, { id: 'app-new', status: 'Submitted', statusLog: [] }],
      notifications: [],
      customDeadlines: [],
    }, 'admin-1');

    expect(refreshed.applications[0].statusLog.map((entry) => entry.id)).toEqual(['l1']);
    expect(refreshed.applications[1].statusLog).toEqual([]);
    expect(refreshed.workspaceDetailsReady).toBe(true);
    expect('detailsDeferred' in refreshed).toBe(false);
  });

  it('a full read that includes the history marks it ready', () => {
    const refreshed = mergeWorkspaceRefresh(staff(), { success: true, applications: [], notifications: [], customDeadlines: [], workspaceDetailsReady: true }, 'admin-1');
    expect(refreshed.workspaceDetailsReady).toBe(true);
  });
});

describe('stage count integrity check', () => {
  const apps = (statuses) => statuses.map((status, index) => ({ id: `app-${index}`, status }));

  it('agrees when the database totals match the cases in memory', () => {
    expect(findStageCountMismatch(apps(['Submitted', 'Submitted', 'Released']), { total: 3, byStatus: { Submitted: 2, Released: 1 } })).toBeNull();
  });

  it('flags a case the database no longer has (a deletion a delta refresh cannot see)', () => {
    expect(findStageCountMismatch(apps(['Submitted', 'Released']), { total: 1, byStatus: { Submitted: 1 } }))
      .toEqual({ kind: 'total', local: 2, server: 1 });
  });

  it('flags a case held in the wrong stage even when the total matches', () => {
    const mismatch = findStageCountMismatch(apps(['Interview', 'Submitted']), { total: 2, byStatus: { Recommended: 1, Submitted: 1 } });
    expect(mismatch?.kind).toBe('stage');
    expect(['Interview', 'Recommended']).toContain(mismatch.status);
  });

  it('does not run when the database count is unavailable (migration pending or read failed)', () => {
    expect(findStageCountMismatch(apps(['Submitted']), null)).toBeNull();
    expect(findStageCountMismatch(apps(['Submitted']), {})).toBeNull();
  });

  it('never merges the counts into state', () => {
    const merged = mergeWorkspaceRefresh(state(), {
      success: true,
      refreshMode: 'delta',
      stageCounts: { total: 1, byStatus: { Submitted: 1 } },
      applications: [],
    }, 'student-1');
    expect('stageCounts' in merged).toBe(false);
  });
});
