/**
 * Helpers for keeping locally created calendar reminders in step with Supabase.
 *
 * Custom deadlines live in localStorage so the Calendar still works in demo
 * mode, but the scheduled reminder function can only email deadlines that exist
 * in the `custom_deadlines` table. These helpers decide which local reminders
 * still need to be pushed to the server.
 */

// Supabase auth ids are UUIDs. Demo-mode ids (demoUsers.*.id) are not, so they
// must never be sent to the database, where owner_id is a uuid column.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isRealUserId = (value) => UUID_PATTERN.test(String(value ?? '').trim());

/**
 * Whether a deadline still lies on or after the given day key (YYYY-MM-DD).
 *
 * The Calendar only offers future-facing reminders, so a deadline that has
 * already passed is skipped when syncing to the server: it can never produce a
 * reminder, and syncing it would only add a row that never fires.
 */
export const isFutureDeadline = (deadline, todayKey) => {
  const value = String(deadline ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !todayKey) return false;
  return value >= todayKey;
};

/**
 * Returns the local deadlines that do not exist on the server yet.
 *
 * Used both to report a failed save and to backfill reminders that were created
 * before server persistence existed, while offline, or in demo mode.
 *
 * @param {Array<{id?: string}>} localDeadlines - Deadlines held in localStorage.
 * @param {Array<{id?: string}>} serverDeadlines - Deadlines returned by Supabase.
 * @returns {Array<{id: string}>} Local entries whose id is absent from the server.
 */
export const findDeadlinesMissingFromServer = (localDeadlines, serverDeadlines) => {
  const local = Array.isArray(localDeadlines) ? localDeadlines : [];
  const server = Array.isArray(serverDeadlines) ? serverDeadlines : [];
  const serverIds = new Set(server.map((entry) => entry?.id).filter(Boolean));

  return local.filter((entry) => entry?.id && !serverIds.has(entry.id));
};
