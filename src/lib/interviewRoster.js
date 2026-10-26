// Interview workspace selectors (SOP step 5) shared by the Admissions Office and
// Department Chair calendar and interview pages. Everything here is a pure
// derivation over data the workspace already loads; the pages never write.
//
// Two rules are encoded once:
//   - Grouping uses the Manila calendar day (getInterviewDateKey), never the
//     browser's local date, so a page read outside Asia/Manila still matches the
//     schedule the office recorded.
//   - Only structured v2 records are scheduled work. A record without a version
//     predates structured scheduling; it is readable history, not a slot.
import {
  DEFAULT_INTERVIEW_DURATION,
  getInterviewDateKey,
  getInterviewEndsAt,
  isStructuredInterview,
  isoToManilaInputs,
} from './interview';
import { aggregateCalendarMarks } from './calendarMarks';

const asList = (value) => (Array.isArray(value) ? value : []);

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const byStart = (left, right) => (left.startsAtDate?.getTime() || 0) - (right.startsAtDate?.getTime() || 0);

// The Manila day key for "now", used by the today metrics and the calendar's
// initial selection.
export const getManilaTodayKey = (now = new Date()) => {
  const date = toDate(now) || new Date();
  return getInterviewDateKey(date.toISOString());
};

// Every scheduled-work record, normalized for a roster row. Cancelled records
// stay in the list (they explain a gap and can be scheduled again); the calendar
// drops them on purpose.
export const getInterviewEntries = (applications = []) => asList(applications)
  .filter((entry) => entry && isStructuredInterview(entry.interview))
  .map((entry) => {
    const interview = entry.interview;
    const startsAtDate = toDate(interview.startsAt);
    return {
      application: entry,
      applicationId: entry.id,
      interview,
      status: entry.status,
      // A saved record can stay `scheduled` after the application is rejected;
      // only an application still at Interview has live scheduling work.
      live: entry.status === 'Interview',
      state: interview.state || 'scheduled',
      mode: interview.mode === 'online' ? 'online' : 'onsite',
      revision: Number(interview.revision) || 1,
      startsAt: interview.startsAt,
      startsAtDate,
      endsAt: getInterviewEndsAt(interview),
      dateKey: startsAtDate ? getInterviewDateKey(interview.startsAt) : '',
      durationMinutes: Number(interview.durationMinutes) || DEFAULT_INTERVIEW_DURATION,
      studentName: entry.studentName || 'Applicant',
      studentProgram: entry.studentProgram || '',
      studentDepartment: entry.studentDepartment || '',
      scholarshipTitle: entry.scholarshipTitle || 'Scholarship',
      locationLabel: interview.mode === 'online'
        ? ''
        : (interview.locationLabel || 'Location to be announced'),
      meetingUrl: interview.mode === 'online' ? (interview.meetingUrl || '') : '',
    };
  })
  .filter((entry) => entry.startsAtDate)
  .sort(byStart);

// The applications where the signed-in account sits on the panel. Panel rows are
// soft-removed, so a replaced member no longer counts.
export const getPanelApplicationIds = (panelists = [], viewerId = '') => new Set(
  asList(panelists)
    .filter((row) => !row.removedAt && row.profileId && row.profileId === viewerId)
    .map((row) => row.applicationId),
);

export const getPanelForApplication = (panelists = [], applicationId = '') => asList(panelists)
  .filter((row) => row.applicationId === applicationId && !row.removedAt);

export const getNoteCountForApplication = (notes = [], applicationId = '') => asList(notes)
  .filter((note) => note.applicationId === applicationId).length;


// An endorsed application is the Admissions Office's next scheduling job. A
// scheduled record (including one being rescheduled) keeps it out of this list.
export const getInterviewsNeedingSchedule = (applications = []) => asList(applications)
  .filter((entry) => (
    entry?.status === 'Endorsed'
    && !(isStructuredInterview(entry.interview) && entry.interview.state === 'scheduled')
  ))
  .sort((left, right) => new Date(left.updatedAt || 0) - new Date(right.updatedAt || 0));

// Cancelled interviews need a new schedule from the office. `no_show` is a
// legacy state from before attendance tracking was removed; those rows are still
// recoverable here.
export const getInterviewsNeedingReschedule = (applications = []) => getInterviewEntries(applications)
  .filter((entry) => entry.status === 'Interview' && ['cancelled', 'no_show'].includes(entry.state));

// Scheduled interviews whose window has not ended yet (an interview that started
// ten minutes ago is still upcoming for the office).
export const getUpcomingInterviews = (applications = [], { now = new Date(), days = null } = {}) => {
  const start = toDate(now);
  if (!start) return [];
  const limit = days ? new Date(start.getTime() + Number(days) * 86400000) : null;
  return getInterviewEntries(applications)
    .filter((entry) => entry.live && entry.state === 'scheduled' && entry.endsAt && entry.endsAt >= start
      && (!limit || entry.startsAtDate <= limit));
};

export const getInterviewsForDate = (entries = [], dateKey = '') => asList(entries)
  .filter((entry) => entry.dateKey && entry.dateKey === dateKey)
  .sort(byStart);

// "9:00 AM – 9:30 AM" in Manila, computed from the same fixed-offset parts the
// shared helpers use, so it cannot drift with the machine time zone.
const manilaClock = (date) => {
  const { time } = isoToManilaInputs(date.toISOString());
  const [hours, minutes] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

export const formatInterviewTimeRange = (entry) => {
  if (!entry?.startsAtDate || !entry?.endsAt) return '';
  return `${manilaClock(entry.startsAtDate)} – ${manilaClock(entry.endsAt)}`;
};

// Groups a roster by Manila day, newest day last. Only entries with a date are
// grouped, so legacy history is listed separately.
export const groupInterviewsByDate = (entries = []) => {
  const groups = new Map();
  asList(entries).forEach((entry) => {
    if (!entry.dateKey) return;
    if (!groups.has(entry.dateKey)) groups.set(entry.dateKey, []);
    groups.get(entry.dateKey).push(entry);
  });
  return [...groups.entries()]
    .map(([dateKey, dayEntries]) => ({ dateKey, entries: dayEntries.sort(byStart) }))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
};

// The calendar markers. `panelApplicationIds` switches the view from the office
// (every interview is an interview) to a Chair (their panel vs the rest of the
// department). Cancelled records are intentionally absent: they no longer hold a
// slot.
export const getInterviewMarksByDate = (applications = [], { panelApplicationIds = null } = {}) => {
  const marks = new Map();
  getInterviewEntries(applications).forEach((entry) => {
    if (!entry.live || entry.state !== 'scheduled' || !entry.dateKey) return;
    const kind = panelApplicationIds
      ? (panelApplicationIds.has(entry.applicationId) ? 'your-panel' : 'department-interview')
      : 'interview';
    const list = marks.get(entry.dateKey) || [];
    list.push({ kind, count: 1 });
    marks.set(entry.dateKey, list);
  });
  return Object.fromEntries([...marks.entries()].map(([dateKey, list]) => [dateKey, aggregateCalendarMarks(list)]));
};
