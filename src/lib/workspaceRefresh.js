import { mergeNotifications } from './notificationMerge';
import { filterLocalDeadlinesForOwner } from './deadlineSync';

export const WORKSPACE_REFRESH_INTERVAL_MS = 15_000;
export const WORKSPACE_REFRESH_JITTER_MS = 5_000;
export const WORKSPACE_FULL_RECONCILE_INTERVAL_MS = 5 * 60_000;

const mergeAppendOnlyRows = (currentRows, refreshedRows) => {
  const rows = Array.isArray(refreshedRows) ? refreshedRows : [];
  const ids = new Set(rows.map((entry) => entry?.id).filter(Boolean));
  return [
    ...rows,
    ...(Array.isArray(currentRows) ? currentRows : []).filter((entry) => entry?.id && !ids.has(entry.id)),
  ];
};

const mergeChangedRows = (currentRows, changedRows, key = 'id') => {
  if (!Array.isArray(changedRows) || changedRows.length === 0) return Array.isArray(currentRows) ? currentRows : [];
  const rows = new Map((Array.isArray(currentRows) ? currentRows : []).map((entry) => [entry?.[key], entry]).filter(([id]) => id));
  (Array.isArray(changedRows) ? changedRows : []).forEach((entry) => {
    if (entry?.[key]) rows.set(entry[key], { ...rows.get(entry[key]), ...entry });
  });
  return [...rows.values()];
};

const mergeSortedRows = (currentRows, changedRows, key, compare) => {
  const merged = mergeChangedRows(currentRows, changedRows, key);
  return merged === currentRows ? merged : merged.sort(compare);
};

const byCreatedThenId = (left, right) => (
  String(left?.createdAt ?? left?.at ?? '').localeCompare(String(right?.createdAt ?? right?.at ?? ''))
  || String(left?.id ?? '').localeCompare(String(right?.id ?? ''))
);

// Union by id, incoming rows winning, oldest first. Returns `current` itself when
// nothing new arrived, so an unrelated refresh keeps every memo downstream valid.
const unionById = (current, incoming) => {
  const base = Array.isArray(current) ? current : [];
  if (!Array.isArray(incoming) || incoming.length === 0) return base;
  const known = new Set(base.map((entry) => entry?.id));
  if (incoming.every((entry) => known.has(entry?.id))) return base;
  const rows = new Map(base.map((entry) => [entry?.id, entry]));
  incoming.forEach((entry) => { if (entry?.id) rows.set(entry.id, entry); });
  return [...rows.values()].sort(byCreatedThenId);
};

// Per-case history (status log, internal comments, interview notes) for a staff
// session arrives after the first screen (loadSupabaseWorkspaceDetails), and for a
// single opened case on demand. Rows are unioned by id, so a delta refresh that
// already delivered a newer row for a case is never rolled back by an older read.
export const mergeWorkspaceDetails = (previous, details, ownerId) => {
  if (!details?.success || !ownerId || previous?.ownerId !== ownerId) return previous;
  if (previous.viewerRole === 'student') return previous;

  const logs = details.statusLogs || {};
  let applicationsChanged = false;
  const applications = (previous.applications || []).map((application) => {
    const incoming = logs[application.id];
    if (!incoming?.length) return application;
    const statusLog = unionById(application.statusLog, incoming);
    if (statusLog === application.statusLog) return application;
    applicationsChanged = true;
    return { ...application, statusLog };
  });

  const reviewComments = unionById(previous.reviewComments, details.reviewComments);
  const interviewNotes = unionById(previous.interviewNotes, details.interviewNotes);
  const workspaceDetailsReady = details.scope === 'all' ? true : Boolean(previous.workspaceDetailsReady);
  if (!applicationsChanged
    && reviewComments === previous.reviewComments
    && interviewNotes === previous.interviewNotes
    && workspaceDetailsReady === previous.workspaceDetailsReady) {
    return previous;
  }
  return {
    ...previous,
    applications: applicationsChanged ? applications : previous.applications,
    reviewComments,
    interviewNotes,
    workspaceDetailsReady,
  };
};

const mergeWorkspaceDelta = (previous, workspace, ownerId) => {
  const { refreshMode: _refreshMode, stageCounts: _stageCounts, staffDirectoryRemovedUserIds = [], ...changes } = workspace;
  const isStudent = previous.viewerRole === 'student';
  const staffDirectory = mergeChangedRows(previous.staffDirectory, changes.staffDirectory, 'userId');
  const notificationRows = mergeChangedRows(previous.notifications, changes.notifications);
  const notifications = notificationRows === previous.notifications
    ? notificationRows
    : notificationRows
      .filter((entry) => !entry?.sourceKey || !entry.ownerId || entry.ownerId === ownerId)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  const merged = {
    ...previous,
    ...changes,
    applications: mergeSortedRows(previous.applications, changes.applications, 'id', (left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))),
    documents: mergeSortedRows(previous.documents, changes.documents, 'id', (left, right) => String(right.uploadedAt || '').localeCompare(String(left.uploadedAt || ''))),
    notifications,
    students: Object.keys(changes.students || {}).length
      ? { ...(previous.students || {}), ...(changes.students || {}) }
      : previous.students,
    scholarships: mergeChangedRows(previous.scholarships, changes.scholarships),
    announcements: mergeSortedRows(previous.announcements, changes.announcements, 'id', (left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))),
    customDeadlines: mergeChangedRows(previous.customDeadlines, changes.customDeadlines),
    departmentReviews: mergeChangedRows(previous.departmentReviews, changes.departmentReviews),
    reviewComments: mergeChangedRows(previous.reviewComments, changes.reviewComments),
    grantAmounts: mergeChangedRows(previous.grantAmounts, changes.grantAmounts, 'applicationId'),
    scholarshipOffers: mergeChangedRows(previous.scholarshipOffers, changes.scholarshipOffers, 'applicationId'),
    waitlistRanks: mergeChangedRows(previous.waitlistRanks, changes.waitlistRanks, 'applicationId'),
    documentRequests: mergeChangedRows(previous.documentRequests, changes.documentRequests),
    staffDirectory: staffDirectoryRemovedUserIds.length
      ? staffDirectory.filter((entry) => !staffDirectoryRemovedUserIds.includes(entry.userId))
      : staffDirectory,
    caseOfficers: mergeChangedRows(previous.caseOfficers, changes.caseOfficers),
    interviewLocations: mergeChangedRows(previous.interviewLocations, changes.interviewLocations),
    interviewPanelists: mergeChangedRows(previous.interviewPanelists, changes.interviewPanelists),
    interviewNotes: mergeChangedRows(previous.interviewNotes, changes.interviewNotes),
    officeCalendarEntries: mergeChangedRows(previous.officeCalendarEntries, changes.officeCalendarEntries),
    approvalLevels: mergeChangedRows(previous.approvalLevels, changes.approvalLevels),
    resultsReleases: mergeChangedRows(previous.resultsReleases, changes.resultsReleases),
  };
  if (isStudent) {
    merged.departmentReviews = [];
    merged.reviewComments = [];
    merged.caseOfficers = [];
    merged.staffDirectory = [];
    merged.interviewLocations = [];
    merged.interviewPanelists = [];
    merged.interviewNotes = [];
    merged.officeCalendarEntries = [];
    merged.approvalLevels = [];
    merged.waitlistRanks = [];
  }
  return merged;
};

// Keep device/session state and locally-created calendar reminders intact while
// replacing the server-backed workspace slices with the latest Supabase rows.
// The owner check prevents a slow response from a previous session being applied
// after an account switch.
export const mergeWorkspaceRefresh = (previous, workspace, ownerId) => {
  if (!workspace?.success || !ownerId || previous?.ownerId !== ownerId) return previous;
  if (workspace.refreshMode === 'delta') return mergeWorkspaceDelta(previous, workspace, ownerId);

  const localDeadlines = filterLocalDeadlinesForOwner(previous.customDeadlines, ownerId);
  const serverDeadlines = Array.isArray(workspace.customDeadlines) ? workspace.customDeadlines : [];
  const serverDeadlineIds = new Set(serverDeadlines.map((entry) => entry.id));
  const isStudent = previous.viewerRole === 'student';

  // A staff session reconciles without re-reading the per-case history (it is
  // kept current by the delta refresh and the on-demand case loads), so the
  // application rows arrive with empty logs. Carry the logs already in memory
  // over onto the fresh rows instead of blanking them.
  const detailsDeferred = Boolean(workspace.detailsDeferred) && !isStudent;
  const previousLogs = detailsDeferred
    ? new Map((previous.applications || []).map((application) => [application.id, application.statusLog]))
    : null;
  const applications = detailsDeferred && Array.isArray(workspace.applications)
    ? workspace.applications.map((application) => {
      const kept = previousLogs.get(application.id);
      return kept?.length && !application.statusLog?.length ? { ...application, statusLog: kept } : application;
    })
    : workspace.applications;

  const { detailsDeferred: _detailsDeferred, ...workspaceRows } = workspace;
  return {
    ...previous,
    ...workspaceRows,
    ...(detailsDeferred ? { applications, workspaceDetailsReady: Boolean(previous.workspaceDetailsReady) } : { workspaceDetailsReady: true }),
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
      waitlistRanks: [],
    } : {}),
  };
};

export const countApplicationsByStatus = (applications) => {
  const counts = {};
  (Array.isArray(applications) ? applications : []).forEach((application) => {
    counts[application?.status] = (counts[application?.status] || 0) + 1;
  });
  return counts;
};

// Compares the cases held in memory with the database's own stage totals for the
// same caller. A delta refresh can add and change rows but cannot see a deletion,
// and a missed update leaves a case in the wrong stage; either shows up here as a
// differing total or stage count. Returns null when they agree (or when the
// database count is unavailable) and the first disagreement otherwise.
export const findStageCountMismatch = (applications, stageCounts) => {
  if (!stageCounts || !stageCounts.byStatus) return null;
  const local = countApplicationsByStatus(applications);
  const localTotal = Array.isArray(applications) ? applications.length : 0;
  if (localTotal !== stageCounts.total) return { kind: 'total', local: localTotal, server: stageCounts.total };
  const statuses = new Set([...Object.keys(local), ...Object.keys(stageCounts.byStatus)]);
  for (const status of statuses) {
    if ((local[status] || 0) !== (stageCounts.byStatus[status] || 0)) {
      return { kind: 'stage', status, local: local[status] || 0, server: stageCounts.byStatus[status] || 0 };
    }
  }
  return null;
};
