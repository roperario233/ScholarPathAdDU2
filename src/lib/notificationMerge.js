/**
 * Merge helper for the notification center.
 *
 * Locally generated deadline reminders live only in localStorage, while other
 * notifications come from the Supabase `notifications` table. When the Supabase
 * workspace is hydrated it must not wipe locally generated reminders, so
 * reminders (entries carrying a `sourceKey`) are preserved unless the same
 * reminder is already present server-side (matched by title, since the
 * server-side row does not carry the sourceKey).
 *
 * Non-reminder local entries are intentionally dropped: the Supabase workspace
 * is the source of truth for everything else. This holds even when the remote
 * list is empty, so signing in as a user with no server notifications never
 * inherits the previous user's local entries.
 *
 * Reminders are additionally scoped to the signed-in user: an entry carrying an
 * `ownerId` that is not the current user (a shared-browser account switch) is
 * dropped.
 */
export const isLocalReminder = (notification) => Boolean(notification?.sourceKey);

// Whether a local entry belongs to the signed-in user. Entries without an
// ownerId are kept for backward compatibility with records written before the
// field existed; an entry explicitly owned by someone else is dropped, so a
// shared browser never carries one user's reminders into the next session.
const isOwnedByUser = (entry, ownerId) => (
  !ownerId || !entry?.ownerId || entry.ownerId === ownerId
);

export const mergeNotifications = (localNotifications, remoteNotifications, options = {}) => {
  const { ownerId } = options;
  const remote = Array.isArray(remoteNotifications) ? remoteNotifications : [];
  const local = Array.isArray(localNotifications) ? localNotifications : [];

  const remoteIds = new Set(remote.map((entry) => entry?.id).filter(Boolean));
  const remoteTitles = new Set(remote.map((entry) => entry?.title).filter(Boolean));
  const preserved = [];
  const seenSourceKeys = new Set();

  // Only locally generated reminders this user owns survive a hydration. This
  // also covers an empty remote list: a fresh session must not inherit the
  // previous user's non-reminder local entries.
  for (const entry of local) {
    if (!isLocalReminder(entry)) {
      continue;
    }
    if (!isOwnedByUser(entry, ownerId)) {
      continue;
    }
    if (remoteIds.has(entry.id) || remoteTitles.has(entry.title)) {
      continue;
    }
    if (seenSourceKeys.has(entry.sourceKey)) {
      continue;
    }
    seenSourceKeys.add(entry.sourceKey);
    preserved.push(entry);
  }

  return preserved.length ? [...preserved, ...remote] : remote;
};
