/**
 * Shared deadline-reminder computation logic.
 *
 * This module is intentionally dependency-free, plain JavaScript so it can be
 * imported by both the Supabase Edge Function (Deno) and the vitest test suite.
 * It mirrors the client-side reminder behavior in src/App.jsx
 * (reminderDateKey + syncDeadlineReminders) so server-side reminders stay
 * consistent with in-app reminders.
 */

export const REMINDER_OFFSETS = {
  oneWeekBefore: 7,
  threeDaysBefore: 3,
  dayBefore: 1,
};

const pad = (part) => String(part).padStart(2, '0');

export const dateKey = (value) => {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const reminderDateKey = (deadline, daysBefore) => {
  const reminderDate = new Date(`${deadline}T00:00:00`);
  reminderDate.setDate(reminderDate.getDate() - daysBefore);
  return dateKey(reminderDate);
};

/**
 * Computes the deadline reminders that are due "today".
 *
 * @param {object} options
 * @param {string} options.today - Today's date key (YYYY-MM-DD).
 * @param {Array<{id: string, title: string, deadline: string, kind?: string}>} options.items
 *   Deadline sources (scholarships, applications, persisted custom deadlines).
 * @param {object} [options.reminderPreferences] - Enabled offsets, e.g. { oneWeekBefore: true }.
 * @param {Set<string>} [options.existingKeys] - sourceKeys already delivered/logged.
 * @returns {Array<{sourceKey: string, itemId: string, itemTitle: string, kind: string, daysBefore: number, title: string}>}
 */
export const computeDueReminders = ({ today, items, reminderPreferences = {}, existingKeys }) => {
  const alreadySent = existingKeys ?? new Set();
  const due = [];

  for (const item of items ?? []) {
    if (!item?.id || !item?.deadline || !item?.title) {
      continue;
    }

    for (const [prefKey, daysBefore] of Object.entries(REMINDER_OFFSETS)) {
      if (reminderPreferences[prefKey] === false) {
        continue;
      }

      const sourceKey = `deadline-reminder-${item.id}-${daysBefore}`;
      if (alreadySent.has(sourceKey)) {
        continue;
      }

      const reminderDate = reminderDateKey(item.deadline, daysBefore);
      // Same window rule as the client: skip if the reminder date has not
      // arrived yet, or if the deadline itself has already passed.
      if (reminderDate > today || today > item.deadline) {
        continue;
      }

      const dayLabel = daysBefore === 1 ? 'day' : 'days';
      due.push({
        sourceKey,
        itemId: item.id,
        itemTitle: item.title,
        kind: item.kind ?? 'deadline',
        daysBefore,
        title: `Reminder: "${item.title}" due in ${daysBefore} ${dayLabel}`,
      });
    }
  }

  return due;
};

/**
 * Date key for a fixed UTC+8 offset (Asia/Manila).
 *
 * The reminder rule is evaluated against the Manila calendar because that is
 * the calendar students see and the schedule runs at 07:00 PHT. Calling
 * `toISOString()` on the raw UTC clock would resolve to the previous day when
 * the job fires at 23:00 UTC.
 */
export const manilaDateKey = (now = new Date()) => {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
};
