// SOP step 5 — Interview of applicants. Shared, dependency-free helpers for the
// interview schedule so the app (src/lib/interview.js re-exports this module),
// the Edge Functions, and the vitest suite read one definition.
//
// SOP 5a: "Interviewing body / panel are from the school where the applicant's
// program belongs." The Admissions Office coordinates the interview (mode,
// location, time, meeting link, reschedules) and owns the status moves; the
// panel is drawn from the applicant's school (the profile `department`, which in
// this codebase is the school: SEA, CAS, CCS, ...).
//
// `applications.interview` is readable by the student, so it holds only the
// public schedule. Panelist identities live in the staff-only
// application_interview_panelists table and evaluation notes in
// application_interview_notes (20261029000000_overhaul_interview_stage.sql).

export const INTERVIEW_RECORD_VERSION = 2;
export const INTERVIEW_TIME_ZONE = 'Asia/Manila';
// Asia/Manila has no daylight saving time, so a fixed offset is exact.
const MANILA_OFFSET_MINUTES = 8 * 60;

export const INTERVIEW_MODES = [
  { value: 'onsite', label: 'On-site' },
  { value: 'online', label: 'Online' },
];
export const INTERVIEW_DURATIONS = [15, 30, 45, 60];
export const DEFAULT_INTERVIEW_DURATION = 30;

export const INTERVIEW_STATE_LABELS = {
  scheduled: 'Scheduled',
  completed: 'Attended',
  no_show: 'Did not attend',
  cancelled: 'Cancelled',
};

export const DEFAULT_INTERVIEW_INSTRUCTIONS = {
  onsite: 'Bring a valid school or government ID and arrive at least 10 minutes before your schedule.',
  online: 'Join from a quiet place with a stable connection, keep your camera on, and have a valid school or government ID ready.',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pad = (value) => String(value).padStart(2, '0');

export const getInterviewModeLabel = (mode) => INTERVIEW_MODES.find((entry) => entry.value === mode)?.label || 'Interview';
export const getInterviewStateLabel = (state) => INTERVIEW_STATE_LABELS[state] || 'Scheduled';

// A v2 record carries a version; an interview scheduled before this overhaul
// stored only `{ scheduledAt, panel, school }` and stays readable as legacy.
export const isStructuredInterview = (interview) => Boolean(interview && Number(interview.version) >= INTERVIEW_RECORD_VERSION);

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Manila wall-clock parts of an instant, computed without Intl so the output
// is identical in Deno, Node, and every browser.
const manilaParts = (value) => {
  const date = toDate(value);
  if (!date) return null;
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MINUTES * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
};

// The schedule form edits a Manila date (YYYY-MM-DD) and time (HH:MM); the
// record stores one ISO instant.
export const manilaInputToIso = (date, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^\d{2}:\d{2}$/.test(String(time || ''))) return '';
  const parsed = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};

export const isoToManilaInputs = (value) => {
  const parts = manilaParts(value);
  if (!parts) return { date: '', time: '' };
  return {
    date: `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}`,
    time: `${pad(parts.hours)}:${pad(parts.minutes)}`,
  };
};

const formatClock = ({ hours, minutes }) => {
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad(minutes)} ${suffix}`;
};

export const getInterviewEndsAt = (interview) => {
  const start = toDate(interview?.startsAt);
  if (!start) return null;
  const minutes = Number(interview?.durationMinutes) || DEFAULT_INTERVIEW_DURATION;
  return new Date(start.getTime() + minutes * 60000);
};

// "Tue, Nov 3, 2026 · 9:00 AM – 9:30 AM (Philippine time)"
export const formatInterviewWhen = (startsAt, durationMinutes = DEFAULT_INTERVIEW_DURATION) => {
  const start = manilaParts(startsAt);
  if (!start) return 'Schedule to be announced';
  const end = manilaParts(getInterviewEndsAt({ startsAt, durationMinutes }));
  return `${WEEKDAYS[start.weekday]}, ${MONTHS[start.month]} ${start.day}, ${start.year} · ${formatClock(start)} – ${formatClock(end)} (Philippine time)`;
};

export const formatInterviewDateShort = (startsAt) => {
  const start = manilaParts(startsAt);
  if (!start) return '';
  return `${MONTHS[start.month]} ${start.day}, ${start.year} · ${formatClock(start)}`;
};

// The Manila calendar day of the interview (YYYY-MM-DD), used by the deadline
// calendar and the day-before reminder.
export const getInterviewDateKey = (startsAt) => isoToManilaInputs(startsAt).date;

export const isSafeMeetingUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:';
  } catch {
    return false;
  }
};

// Department Chair accounts from the applicant's school (SOP 5a). The database
// repeats the rule in validate_interview_panelist().
/**
 * Who can sit on the panel. SOP 5a draws the Department Chairs from the school
 * where the applicant's program belongs, and the Admissions Office coordinates
 * the interview (SOP step 5), so its two lanes may join any panel. Either kind of
 * member can be the lead.
 */
export const getEligiblePanelists = (staffDirectory = [], application = {}) => {
  const school = String(application?.studentDepartment || '').trim();
  const entries = Array.isArray(staffDirectory) ? staffDirectory : [];
  const byName = (a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''));
  const chairs = entries.filter((entry) => entry?.role === 'department_chair'
    && school
    && String(entry.department || '').trim() === school);
  const office = entries.filter((entry) => entry?.role === 'admissions_office' || entry?.role === 'admissions_head');
  return [...chairs.sort(byName), ...office.sort(byName)];
};

// A panel member in the schedule form: an account (`profileId`) or a typed
// faculty guest (`guestName`, `guestEmail`).
export const normalizePanelMember = (member = {}) => ({
  profileId: member.profileId || null,
  guestName: member.profileId ? '' : String(member.guestName || '').trim(),
  guestEmail: member.profileId ? '' : String(member.guestEmail || '').trim(),
  isLead: Boolean(member.isLead),
});

export const createInterviewDraft = (application = {}, panelists = []) => {
  const interview = isStructuredInterview(application?.interview) ? application.interview : null;
  const { date, time } = isoToManilaInputs(interview?.startsAt);
  const mode = interview?.mode || 'onsite';
  return {
    mode,
    date,
    time,
    durationMinutes: Number(interview?.durationMinutes) || DEFAULT_INTERVIEW_DURATION,
    locationId: interview?.locationId || '',
    // A typed location is kept only when no saved venue was chosen, so editing a
    // room-based interview does not duplicate the venue's own label.
    locationLabel: interview?.locationId ? '' : (interview?.locationLabel || ''),
    meetingUrl: interview?.meetingUrl || '',
    instructions: interview?.instructions ?? DEFAULT_INTERVIEW_INSTRUCTIONS[mode],
    panel: (Array.isArray(panelists) ? panelists : []).map(normalizePanelMember),
  };
};

/**
 * Validates the schedule form. Returns `{ field: message }`; an empty object
 * means the draft can be saved.
 *
 * `autoMeeting` is true when the Google Calendar integration will generate the
 * Meet link, so an online interview needs no pasted link.
 */
export const validateInterviewSchedule = (draft = {}, { now = new Date(), autoMeeting = false, activeLocationIds = null } = {}) => {
  const errors = {};
  if (!INTERVIEW_MODES.some((entry) => entry.value === draft.mode)) errors.mode = 'Choose on-site or online.';
  if (!draft.date) errors.date = 'Choose the interview date.';
  if (!draft.time) errors.time = 'Choose the start time.';
  const startsAt = manilaInputToIso(draft.date, draft.time);
  if (draft.date && draft.time && !startsAt) errors.date = 'Enter a valid date and time.';
  if (startsAt && new Date(startsAt).getTime() <= toDate(now).getTime()) errors.time = 'The interview must be scheduled in the future.';
  if (!INTERVIEW_DURATIONS.includes(Number(draft.durationMinutes))) errors.durationMinutes = 'Choose the interview length.';

  if (draft.mode === 'onsite') {
    const typedLocation = String(draft.locationLabel || '').trim();
    if (!draft.locationId && !typedLocation) errors.locationId = 'Add the interview location.';
    else if (draft.locationId && Array.isArray(activeLocationIds) && !activeLocationIds.includes(draft.locationId)) errors.locationId = 'That location is archived. Choose an active location.';
  }
  if (draft.mode === 'online') {
    const link = String(draft.meetingUrl || '').trim();
    if (link && !isSafeMeetingUrl(link)) errors.meetingUrl = 'Enter a full https:// meeting link.';
    else if (!link && !autoMeeting) errors.meetingUrl = 'Paste the meeting link for the online interview.';
  }

  // The panel is optional: an interview can be scheduled before the office has
  // settled who sits on it. When members are listed, exactly one is the lead, and
  // any of them — Department Chair, Admissions Office account, or faculty guest —
  // may hold that role.
  const panel = (Array.isArray(draft.panel) ? draft.panel : []).map(normalizePanelMember);
  if (panel.length) {
    const leads = panel.filter((member) => member.isLead).length;
    const accountIds = panel.map((member) => member.profileId).filter(Boolean);
    if (leads !== 1) errors.panel = 'Mark exactly one panel member as the lead interviewer.';
    else if (new Set(accountIds).size !== accountIds.length) errors.panel = 'A panel member is listed twice.';
    else if (panel.some((member) => !member.profileId && !member.guestName)) errors.panel = 'Enter the name of each faculty guest.';
    else if (panel.some((member) => !member.profileId && member.guestEmail && !EMAIL_PATTERN.test(member.guestEmail))) errors.panel = 'Enter a valid email address for each faculty guest.';
  }
  return errors;
};

/**
 * Overlapping interviews for the same account panelist or, on-site, the same
 * room. Only scheduled interviews count; the application itself is ignored.
 * Faculty guests have no account, so they are not checked.
 */
export const findInterviewConflicts = (draft = {}, { applications = [], panelists = [], excludeApplicationId = null } = {}) => {
  const startsAt = draft.startsAt || manilaInputToIso(draft.date, draft.time);
  const start = toDate(startsAt);
  if (!start) return [];
  const end = getInterviewEndsAt({ startsAt, durationMinutes: draft.durationMinutes });
  const accountIds = new Set((draft.panel || []).map((member) => member.profileId).filter(Boolean));
  const conflicts = [];

  (Array.isArray(applications) ? applications : []).forEach((entry) => {
    if (!entry || entry.id === excludeApplicationId || entry.status !== 'Interview') return;
    const other = entry.interview;
    if (!isStructuredInterview(other) || other.state !== 'scheduled') return;
    const otherStart = toDate(other.startsAt);
    const otherEnd = getInterviewEndsAt(other);
    if (!otherStart || !(start < otherEnd && otherStart < end)) return;

    const shared = (Array.isArray(panelists) ? panelists : []).filter((row) => (
      row.applicationId === entry.id && !row.removedAt && row.profileId && accountIds.has(row.profileId)
    ));
    shared.forEach((row) => conflicts.push({
      applicationId: entry.id,
      kind: 'panelist',
      profileId: row.profileId,
      name: row.name || 'A panel member',
      studentName: entry.studentName || 'another applicant',
      startsAt: other.startsAt,
    }));
    if (draft.mode === 'onsite' && other.mode === 'onsite' && draft.locationId && other.locationId === draft.locationId) {
      conflicts.push({
        applicationId: entry.id,
        kind: 'location',
        name: other.locationLabel || 'This location',
        studentName: entry.studentName || 'another applicant',
        startsAt: other.startsAt,
      });
    }
  });
  return conflicts;
};

export const describeInterviewConflict = (conflict) => (
  conflict.kind === 'location'
    ? `${conflict.name} is already booked for ${conflict.studentName} (${formatInterviewDateShort(conflict.startsAt)}).`
    : `${conflict.name} is already on the panel for ${conflict.studentName} (${formatInterviewDateShort(conflict.startsAt)}).`
);

/**
 * Roster-level conflicts for the interview workspace pages. findInterviewConflicts
 * checks one draft against the rest; this scans every scheduled interview against
 * every other one, so the office can see a double-booked panelist or room before
 * opening a case. Only scheduled interviews count, and faculty guests have no
 * account, so they are not checked.
 */
export const findRosterConflicts = (applications = [], panelists = []) => {
  const scheduled = (Array.isArray(applications) ? applications : [])
    .filter((entry) => (
      entry?.status === 'Interview'
      && isStructuredInterview(entry.interview)
      && entry.interview.state === 'scheduled'
    ))
    .map((entry) => ({
      entry,
      start: toDate(entry.interview.startsAt),
      end: getInterviewEndsAt(entry.interview),
    }))
    .filter((row) => row.start && row.end);

  const activePanel = (applicationId) => (Array.isArray(panelists) ? panelists : [])
    .filter((row) => row.applicationId === applicationId && !row.removedAt && row.profileId);

  const conflicts = [];
  for (let index = 0; index < scheduled.length; index += 1) {
    const left = scheduled[index];
    for (let next = index + 1; next < scheduled.length; next += 1) {
      const right = scheduled[next];
      if (!(left.start < right.end && right.start < left.end)) continue;
      const rightPanelIds = new Set(activePanel(right.entry.id).map((row) => row.profileId));
      activePanel(left.entry.id).forEach((row) => {
        if (!rightPanelIds.has(row.profileId)) return;
        conflicts.push({
          kind: 'panelist',
          profileId: row.profileId,
          name: row.name || 'A panel member',
          startsAt: left.entry.interview.startsAt,
          applicationIds: [left.entry.id, right.entry.id],
          studentNames: [left.entry.studentName || 'an applicant', right.entry.studentName || 'an applicant'],
        });
      });
      if (
        left.entry.interview.mode === 'onsite'
        && right.entry.interview.mode === 'onsite'
        && left.entry.interview.locationId
        && left.entry.interview.locationId === right.entry.interview.locationId
      ) {
        conflicts.push({
          kind: 'location',
          name: left.entry.interview.locationLabel || 'This location',
          startsAt: left.entry.interview.startsAt,
          applicationIds: [left.entry.id, right.entry.id],
          studentNames: [left.entry.studentName || 'an applicant', right.entry.studentName || 'an applicant'],
        });
      }
    }
  }
  return conflicts;
};

export const formatLocationLabel = (location) => {
  if (!location) return '';
  const place = [location.building, location.room].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
  return place ? `${location.name} (${place})` : String(location.name || '');
};

/**
 * Builds the student-readable `applications.interview` record from the form.
 * `previous` is the current record when rescheduling: its revision is bumped and
 * its schedule is pushed onto `history` with the recorded reason.
 */
export const buildInterviewRecord = ({ draft, previous = null, location = null, school = '', actorId = null, reason = '', calendar = null, now = new Date() }) => {
  const prior = isStructuredInterview(previous) ? previous : null;
  const mode = draft.mode === 'online' ? 'online' : 'onsite';
  const at = toDate(now).toISOString();
  const history = prior
    ? [...(Array.isArray(prior.history) ? prior.history : []), {
      revision: prior.revision || 1,
      state: prior.state,
      startsAt: prior.startsAt,
      mode: prior.mode,
      locationLabel: prior.locationLabel || '',
      meetingUrl: prior.meetingUrl || '',
      changedAt: at,
      changedBy: actorId,
      reason: String(reason || '').trim(),
    }]
    : [];
  return {
    version: INTERVIEW_RECORD_VERSION,
    state: 'scheduled',
    revision: prior ? (Number(prior.revision) || 1) + 1 : 1,
    mode,
    startsAt: manilaInputToIso(draft.date, draft.time),
    durationMinutes: Number(draft.durationMinutes) || DEFAULT_INTERVIEW_DURATION,
    locationId: mode === 'onsite' ? (draft.locationId || null) : null,
    locationLabel: mode === 'onsite'
      ? (formatLocationLabel(location) || String(draft.locationLabel || '').trim())
      : '',
    meetingUrl: mode === 'online' ? String(draft.meetingUrl || '').trim() : '',
    school: school || prior?.school || '',
    calendar: calendar ?? prior?.calendar ?? null,
    instructions: String(draft.instructions || '').trim(),
    scheduledBy: actorId,
    scheduledAt: at,
    outcomeRecordedAt: null,
    outcomeRecordedBy: null,
    outcomeRecordedRole: null,
    history,
  };
};

export const buildCancelledInterview = ({ previous, actorId = null, reason = '', now = new Date() }) => {
  const at = toDate(now).toISOString();
  return {
    ...previous,
    state: 'cancelled',
    revision: (Number(previous?.revision) || 1) + 1,
    history: [...(Array.isArray(previous?.history) ? previous.history : []), {
      revision: previous?.revision || 1,
      state: previous?.state,
      startsAt: previous?.startsAt,
      mode: previous?.mode,
      locationLabel: previous?.locationLabel || '',
      meetingUrl: previous?.meetingUrl || '',
      changedAt: at,
      changedBy: actorId,
      reason: String(reason || '').trim(),
      cancelled: true,
    }],
  };
};

// The Recommend gate (SOP step 5 → 6). An interview scheduled before this
// overhaul has no attendance record and is grandfathered, exactly like the
// database gate in enforce_interview_outcome_before_recommendation().
export const isInterviewComplete = (interview) => {
  if (!interview) return false;
  if (!isStructuredInterview(interview)) return true;
  return interview.state === 'completed';
};

// A structured interview that still holds a slot and a calendar invitation.
// A completed, cancelled, or no-show record is history, not live work.
export const isInterviewLive = (interview) => isStructuredInterview(interview) && interview.state === 'scheduled';

/**
 * The waiver description behind the review surface's warning dialog (SOP step
 * 5 → 6). The recommendation normally follows an attended interview; the
 * Admissions Office may record it without one, after the live schedule is
 * cancelled. One description feeds the dialog copy, the recorded cancellation
 * reason, and the timeline note, so they cannot disagree. The reviewer's reason
 * is captured by the dialog itself (it is required), not by this helper.
 */
export const describeInterviewWaiver = (interview) => {
  const state = isStructuredInterview(interview) ? interview.state : '';
  const live = isInterviewLive(interview);
  return {
    needed: !isInterviewComplete(interview),
    live,
    state,
    cancels: live,
    when: live ? formatInterviewWhen(interview.startsAt, interview.durationMinutes) : '',
    where: live ? getInterviewWhere(interview) : '',
    headline: 'Record the recommendation without an interview?',
    detail: live
      ? 'The scheduled interview will be cancelled, its calendar invitation removed, and the applicant and the panel will be notified.'
      : state === 'no_show'
        ? 'The panel recorded the applicant as not attending. No live schedule remains to cancel.'
        : 'No interview outcome has been recorded for this application.',
  };
};

export const isInterviewOutcomeDue = (interview, now = new Date()) => {
  if (!isStructuredInterview(interview) || interview.state !== 'scheduled') return false;
  const start = toDate(interview.startsAt);
  return Boolean(start) && start.getTime() <= toDate(now).getTime();
};

/**
 * The saved record and Google disagree: a cancelled interview whose event
 * survived, a scheduled interview with no event, or an online interview whose
 * event carries no link. This is the single predicate behind the Interview tab's
 * recovery action and the interview workspace pages, so they cannot disagree.
 */
export const needsInterviewCalendarRepair = (interview) => {
  if (!interview) return false;
  const calendar = interview.calendar || null;
  return (interview.state === 'cancelled' && Boolean(calendar?.eventId) && !calendar?.removedAt)
    || (interview.state === 'scheduled' && (!calendar?.eventId || (interview.mode === 'online' && !interview.meetingUrl)));
};

export const getInterviewWhere = (interview) => {
  if (!interview) return '';
  if (interview.mode === 'online') return interview.meetingUrl ? `Online · ${interview.meetingUrl}` : 'Online · meeting link to follow';
  return interview.locationLabel || 'Location to be announced';
};

/**
 * The student-facing description of the interview. It never names the panel
 * members, matching how document decisions never name the reviewer.
 */
export const describeInterviewForStudent = (interview) => {
  if (!interview) return null;
  if (!isStructuredInterview(interview)) {
    return {
      legacy: true,
      state: 'scheduled',
      stateLabel: 'Scheduled',
      modeLabel: 'Interview',
      when: interview.scheduledAt ? `Scheduled ${String(interview.scheduledAt).slice(0, 10)}` : 'Schedule to be announced',
      where: '',
      meetingUrl: '',
      instructions: '',
      panel: interview.school ? `Panel from ${interview.school}` : '',
      rescheduled: false,
    };
  }
  return {
    legacy: false,
    state: interview.state,
    stateLabel: getInterviewStateLabel(interview.state),
    modeLabel: getInterviewModeLabel(interview.mode),
    when: formatInterviewWhen(interview.startsAt, interview.durationMinutes),
    where: interview.mode === 'online' ? 'Online meeting' : (interview.locationLabel || 'Location to be announced'),
    meetingUrl: interview.mode === 'online' ? (interview.meetingUrl || '') : '',
    instructions: interview.instructions || '',
    panel: interview.school ? `Interview panel from ${interview.school}` : 'Interview panel from your school',
    rescheduled: (Number(interview.revision) || 1) > 1 && interview.state === 'scheduled',
  };
};

// One line for emails, SMS, and the text export.
export const summarizeInterview = (interview) => {
  const view = describeInterviewForStudent(interview);
  if (!view) return '';
  if (view.legacy) return [view.when, view.panel].filter(Boolean).join(' · ');
  return [view.modeLabel, view.when, interview.mode === 'online' ? (view.meetingUrl || 'meeting link to follow') : view.where].filter(Boolean).join(' · ');
};

const icsEscape = (value) => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

const icsStamp = (value) => {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
};

const buildEventDetails = (interview, scholarshipTitle) => [
  `ScholarPath AdDU scholarship interview${scholarshipTitle ? ` for ${scholarshipTitle}` : ''}.`,
  interview.school ? `Interview panel from ${interview.school}.` : '',
  interview.mode === 'online' && interview.meetingUrl ? `Join: ${interview.meetingUrl}` : '',
  interview.instructions || '',
].filter(Boolean).join('\n');

/**
 * An iCalendar (.ics) file for the interview, so a student or a faculty guest
 * can add it to any calendar app when the Google Calendar integration is not
 * configured.
 *
 * `uid` must be stable per application (pass the application id, never the
 * revision): with a stable UID and the revision as SEQUENCE, a reschedule updates
 * the existing calendar entry instead of adding a second one, and a cancellation
 * removes it.
 *
 * `recipientEmail` renders exactly one ATTENDEE. Each recipient gets their own
 * file, because a file shared between the applicant and the panel would show the
 * applicant every panel member's address — the same thing the Google invitation
 * hides with `guestsCanSeeOtherGuests: false`.
 */
export const buildInterviewIcs = ({
  interview,
  scholarshipTitle = '',
  uid = '',
  recipientEmail = '',
  organizerEmail = '',
  now = new Date(),
}) => {
  if (!isStructuredInterview(interview)) return '';
  const cancelled = interview.state === 'cancelled';
  const attendee = String(recipientEmail || '').trim();
  const organizer = String(organizerEmail || '').trim();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ScholarPath AdDU//Scholarship Interview//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${icsEscape(uid || `interview-${interview.startsAt}`)}@scholarpath-addu`,
    `SEQUENCE:${Number(interview.revision) || 1}`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(interview.startsAt)}`,
    `DTEND:${icsStamp(getInterviewEndsAt(interview))}`,
    `SUMMARY:${icsEscape(`Scholarship interview${scholarshipTitle ? ` · ${scholarshipTitle}` : ''}`)}`,
    `DESCRIPTION:${icsEscape(buildEventDetails(interview, scholarshipTitle))}`,
    `LOCATION:${icsEscape(interview.mode === 'online' ? (interview.meetingUrl || 'Online') : (interview.locationLabel || ''))}`,
    ...(interview.mode === 'online' && isSafeMeetingUrl(interview.meetingUrl) ? [`URL:${interview.meetingUrl}`] : []),
    ...(organizer ? [`ORGANIZER;CN=ScholarPath AdDU:mailto:${organizer}`] : []),
    ...(attendee ? [`ATTENDEE;CN=${icsEscape(attendee)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee}`] : []),
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
};

// "Add to Google Calendar" without any API: Google's public event-template URL.
export const buildGoogleCalendarTemplateUrl = ({ interview, scholarshipTitle = '' }) => {
  if (!isStructuredInterview(interview) || !interview.startsAt) return '';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Scholarship interview${scholarshipTitle ? ` · ${scholarshipTitle}` : ''}`,
    dates: `${icsStamp(interview.startsAt)}/${icsStamp(getInterviewEndsAt(interview))}`,
    details: buildEventDetails(interview, scholarshipTitle),
    location: interview.mode === 'online' ? (interview.meetingUrl || 'Online') : (interview.locationLabel || ''),
    ctz: INTERVIEW_TIME_ZONE,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

// Stable key for the day-before reminder; a reschedule bumps the revision, so
// the new date gets its own reminder.
export const getInterviewReminderKey = (applicationId, revision) => `interview-reminder-${applicationId}-${Number(revision) || 1}-1`;
