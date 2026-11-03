// Calendar markers shared by the staff and Chair calendars. The student calendar
// keeps its own deadline logic; these helpers exist so the staff calendars read
// one label vocabulary and one Manila-safe date key.
import { isAdduInternalProgram } from './eligibility';
import { getInterviewDateKey } from './interview';

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
  decision: (count) => `${count} recorded decision${count === 1 ? '' : 's'}`,
  office: (count) => `${count} office ${count === 1 ? 'entry' : 'entries'}`,
  reminder: (count) => `${count} reminder${count === 1 ? '' : 's'}`,
  custom: (count) => `${count} reminder${count === 1 ? '' : 's'}`,
};

// The office calendar's own planning entries. The Admissions Office Admin
// publishes them; both office lanes and Department Chairs read them. They carry
// a date only, so they are work-planning markers, not reminder deliveries.
export const OFFICE_ENTRY_KIND_LABELS = {
  office: 'Office work',
  deadline: 'Office deadline',
  meeting: 'Meeting',
};

export const OFFICE_ENTRY_KINDS = Object.keys(OFFICE_ENTRY_KIND_LABELS);

export const getOfficeEntryKindLabel = (kind) => OFFICE_ENTRY_KIND_LABELS[kind] || OFFICE_ENTRY_KIND_LABELS.office;

// The stages whose recorded decision belongs on the office calendar: the
// Admissions Office Admin's endorsement (SOP step 4), the sub-committee
// recommendation, approval, and the release of results (SOP steps 6-8). The
// hand-off (`For Endorsement`) is an open queue state, not a decision, so it
// stays off this layer.
export const DECISION_STAGES = ['Endorsed', 'Recommended', 'Approved', 'Released'];


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
// and the Working Scholar Program).
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

// ---------------------------------------------------------------------------
// Recorded stage decisions (SOP steps 4-8)
// ---------------------------------------------------------------------------
// Status events are ISO instants, so the mark is filed under the Manila day the
// office recorded it; a browser-local day would move an evening decision to the
// wrong cell. The append-only status log is the trustworthy record, with the
// browser timeline as the fallback for rows that predate it (the same precedence
// getRecentApplicationActivity() uses).
const toManilaDateKey = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return getInterviewDateKey(date.toISOString());
};

const flattenStageEvents = (applications = [], stages = DECISION_STAGES) => {
  const allowed = Array.isArray(stages) && stages.length ? new Set(stages) : null;
  const events = [];
  (Array.isArray(applications) ? applications : []).forEach((application) => {
    if (!application) return;
    const log = Array.isArray(application.statusLog) ? application.statusLog : [];
    const timeline = Array.isArray(application.timeline) ? application.timeline : [];
    (log.length ? log : timeline).forEach((event) => {
      const stage = event?.toStatus || event?.stage;
      if (!stage || (allowed && !allowed.has(stage))) return;
      const at = event.at || event.date || '';
      const dateKey = toManilaDateKey(at);
      if (!dateKey) return;
      events.push({
        id: event.id || `${application.id}-${stage}-${at}`,
        application,
        applicationId: application.id,
        stage,
        at,
        dateKey,
        note: event.reason || event.note || '',
      });
    });
  });
  return events.sort((left, right) => new Date(right.at) - new Date(left.at));
};

export const getStageEvents = (applications = [], { stages = DECISION_STAGES } = {}) => (
  flattenStageEvents(applications, stages)
);

export const getStageEventsForDate = (applications = [], dateKey = '', { stages = DECISION_STAGES } = {}) => (
  dateKey ? flattenStageEvents(applications, stages).filter((event) => event.dateKey === dateKey) : []
);

export const getStageMarksByDate = (applications = [], { stages = DECISION_STAGES } = {}) => {
  const marks = new Map();
  flattenStageEvents(applications, stages).forEach((event) => {
    const list = marks.get(event.dateKey) || [];
    list.push({ kind: 'decision', count: 1 });
    marks.set(event.dateKey, list);
  });
  return Object.fromEntries([...marks.entries()].map(([dateKey, list]) => [dateKey, aggregateCalendarMarks(list)]));
};

// ---------------------------------------------------------------------------
// Office planning entries
// ---------------------------------------------------------------------------
// The Admissions Office publishes these through the office calendar; they carry
// a date only, so they read like a catalog deadline rather than a timestamp.
const getOfficeEntryDateKey = (entry) => getDeadlineDateKey(entry?.entryDate || entry?.deadline);

export const getOfficeEntryMarksByDate = (entries = []) => {
  const marks = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const dateKey = getOfficeEntryDateKey(entry);
    if (!dateKey) return;
    const list = marks.get(dateKey) || [];
    list.push({ kind: 'office', count: 1 });
    marks.set(dateKey, list);
  });
  return Object.fromEntries([...marks.entries()].map(([dateKey, list]) => [dateKey, aggregateCalendarMarks(list)]));
};

export const getOfficeEntriesForDate = (entries = [], dateKey = '') => (
  dateKey
    ? (Array.isArray(entries) ? entries : []).filter((entry) => entry && getOfficeEntryDateKey(entry) === dateKey)
    : []
);

// The upcoming office entries, soonest first, for the list beside the grid.
export const getUpcomingOfficeEntries = (entries = [], { todayKey = '' } = {}) => (
  (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && (!todayKey || getOfficeEntryDateKey(entry) >= todayKey))
    .sort((left, right) => getOfficeEntryDateKey(left).localeCompare(getOfficeEntryDateKey(right)))
);

