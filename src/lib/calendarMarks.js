// Calendar markers shared by the staff and Chair calendars. The student calendar
// keeps its own deadline logic; these helpers exist so the two new calendars read
// one label vocabulary and one Manila-safe date key.
import { isAdduInternalProgram } from './eligibility';

const pad = (value) => String(value).padStart(2, '0');

// A calendar cell day → the YYYY-MM-DD key the marks are filed under. The day is
// already a wall-clock day, so no timezone conversion belongs here.
export const toCalendarDateKey = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;

// A scholarship deadline is stored as a date string. Reading its first ten
// characters avoids the UTC-midnight shift that `new Date('2026-11-03')` causes
// west of Greenwich.
const getDeadlineDateKey = (value) => {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return toCalendarDateKey(date.getFullYear(), date.getMonth(), date.getDate());
};

const MARK_LABELS = {
  interview: (count) => `${count} interview${count === 1 ? '' : 's'}`,
  'your-panel': (count) => `${count} on your panel`,
  'department-interview': (count) => `${count} department interview${count === 1 ? '' : 's'}`,
  deadline: (count) => `${count} scholarship deadline${count === 1 ? '' : 's'}`,
  reminder: (count) => `${count} reminder${count === 1 ? '' : 's'}`,
  custom: (count) => `${count} reminder${count === 1 ? '' : 's'}`,
};

export const describeCalendarMark = (kind, count = 1) => (
  MARK_LABELS[kind] ? MARK_LABELS[kind](count) : `${count} item${count === 1 ? '' : 's'}`
);

// One mark per kind per day (`{ kind, count, label }`), so a day with three
// interviews reads "3 interviews" instead of three identical dots.
export const aggregateCalendarMarks = (marks = []) => {
  const counts = new Map();
  (Array.isArray(marks) ? marks : []).forEach((mark) => {
    if (!mark?.kind) return;
    counts.set(mark.kind, (counts.get(mark.kind) || 0) + (Number(mark.count) || 1));
  });
  return [...counts.entries()].map(([kind, count]) => ({ kind, count, label: describeCalendarMark(kind, count) }));
};

// AdDU internal catalog deadlines, the windows the Admissions Office publishes.
// `onlyInScope` keeps the calendar aligned with the catalog route (GIA, Jubilee,
// and the Student Assistant program).
export const getDeadlineMarksByDate = (scholarships = [], { onlyInScope = false } = {}) => {
  const marks = new Map();
  (Array.isArray(scholarships) ? scholarships : [])
    .filter((entry) => entry && (!onlyInScope || isAdduInternalProgram(entry)))
    .forEach((entry) => {
      const dateKey = getDeadlineDateKey(entry.deadline);
      if (!dateKey) return;
      const list = marks.get(dateKey) || [];
      list.push({ kind: 'deadline', count: 1 });
      marks.set(dateKey, list);
    });
  return Object.fromEntries([...marks.entries()].map(([dateKey, list]) => [dateKey, aggregateCalendarMarks(list)]));
};

export const mergeMarksByDate = (...maps) => {
  const merged = new Map();
  maps.forEach((map) => {
    Object.entries(map || {}).forEach(([dateKey, marks]) => {
      merged.set(dateKey, [...(merged.get(dateKey) || []), ...(Array.isArray(marks) ? marks : [])]);
    });
  });
  return Object.fromEntries([...merged.entries()].map(([dateKey, marks]) => [dateKey, aggregateCalendarMarks(marks)]));
};

// The deadline rows for one calendar day, used by the day agenda under the grid.
export const getDeadlinesForDate = (scholarships = [], dateKey = '', { onlyInScope = false } = {}) => (
  (Array.isArray(scholarships) ? scholarships : [])
    .filter((entry) => entry && (!onlyInScope || isAdduInternalProgram(entry)))
    .filter((entry) => getDeadlineDateKey(entry.deadline) === dateKey)
);
