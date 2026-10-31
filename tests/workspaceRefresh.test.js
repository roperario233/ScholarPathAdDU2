import { describe, expect, it } from 'vitest';
import { mergeWorkspaceRefresh, WORKSPACE_REFRESH_INTERVAL_MS } from '../src/lib/workspaceRefresh';

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
  });
});
