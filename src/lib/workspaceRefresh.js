import { mergeNotifications } from './notificationMerge';
import { filterLocalDeadlinesForOwner } from './deadlineSync';

export const WORKSPACE_REFRESH_INTERVAL_MS = 15_000;

const mergeAppendOnlyRows = (currentRows, refreshedRows) => {
  const rows = Array.isArray(refreshedRows) ? refreshedRows : [];
  const ids = new Set(rows.map((entry) => entry?.id).filter(Boolean));
  return [
    ...rows,
    ...(Array.isArray(currentRows) ? currentRows : []).filter((entry) => entry?.id && !ids.has(entry.id)),
  ];
};

// Keep device/session state and locally-created calendar reminders intact while
// replacing the server-backed workspace slices with the latest Supabase rows.
// The owner check prevents a slow response from a previous session being applied
// after an account switch.
export const mergeWorkspaceRefresh = (previous, workspace, ownerId) => {
  if (!workspace?.success || !ownerId || previous?.ownerId !== ownerId) return previous;

  const localDeadlines = filterLocalDeadlinesForOwner(previous.customDeadlines, ownerId);
  const serverDeadlines = Array.isArray(workspace.customDeadlines) ? workspace.customDeadlines : [];
  const serverDeadlineIds = new Set(serverDeadlines.map((entry) => entry.id));
  const isStudent = previous.viewerRole === 'student';

  return {
    ...previous,
    ...workspace,
    // Both staff note streams are append-only. Retaining a locally inserted row
    // avoids a short race where a refresh that began before the insert commits
    // could otherwise make the newly added note disappear temporarily.
    ...(!isStudent ? {
      reviewComments: mergeAppendOnlyRows(previous.reviewComments, workspace.reviewComments),
      interviewNotes: mergeAppendOnlyRows(previous.interviewNotes, workspace.interviewNotes),
    } : {}),
    notifications: mergeNotifications(previous.notifications, workspace.notifications, { ownerId }),
    customDeadlines: [
      ...serverDeadlines,
      ...localDeadlines.filter((entry) => !serverDeadlineIds.has(entry.id)),
    ],
    // These collections have no student-facing purpose. Keep them empty even if
    // a future loader accidentally returns staff rows for a student session.
    ...(isStudent ? {
      departmentReviews: [],
      reviewComments: [],
      caseOfficers: [],
      staffDirectory: [],
      interviewLocations: [],
      interviewPanelists: [],
      interviewNotes: [],
      officeCalendarEntries: [],
      approvalLevels: [],
    } : {}),
  };
};
