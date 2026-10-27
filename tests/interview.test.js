import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INTERVIEW_INSTRUCTIONS,
  INTERVIEW_RECOMMENDATION_LEVELS,
  buildCancelledInterview,
  buildGoogleCalendarTemplateUrl,
  buildInterviewIcs,
  buildInterviewRecord,
  createInterviewDraft,
  describeInterviewForStudent,
  findInterviewConflicts,
  findRosterConflicts,
  formatInterviewWhen,
  getEligiblePanelists,
  getInterviewDateKey,
  getInterviewRecommendationLevelLabel,
  getInterviewReminderKey,
  getLatestPanelRecommendation,
  isInterviewLive,
  isoToManilaInputs,
  manilaInputToIso,
  needsInterviewCalendarRepair,
  summarizeInterview,
  validateInterviewSchedule,
} from '../src/lib/interview';
import {
  buildGoogleInterviewEvent,
  cancelGoogleInterviewEvent,
  extractMeetLink,
  getGoogleCalendarConfig,
  upsertGoogleInterviewEvent,
} from '../supabase/functions/_shared/googleCalendar.js';
import { describeApplicationStatusUpdate, renderApplicationStatusEmail, renderInterviewReminderEmail, renderInterviewUpdateEmail } from '../supabase/functions/_shared/email.js';
import { renderApplicationStatusSms, renderInterviewReminderSms, renderInterviewUpdateSms } from '../supabase/functions/_shared/sms.js';

const SEA = 'School of Engineering and Architecture (SEA)';
const CAS = 'College of Arts and Sciences (CAS)';
const NOW = new Date('2026-11-01T00:00:00.000Z');

const staffDirectory = [
  { userId: 'chair-sea', fullName: 'Ana Reyes', role: 'department_chair', department: SEA },
  { userId: 'chair-sea-2', fullName: 'Ben Cruz', role: 'department_chair', department: SEA },
  { userId: 'chair-cas', fullName: 'Carla Lim', role: 'department_chair', department: CAS },
  { userId: 'staff-1', fullName: 'Dana Uy', role: 'admissions_office', department: 'Office of Admissions' },
];

const validDraft = (overrides = {}) => ({
  mode: 'onsite',
  date: '2026-11-03',
  time: '09:00',
  durationMinutes: 30,
  locationId: 'loc-1',
  meetingUrl: '',
  instructions: DEFAULT_INTERVIEW_INSTRUCTIONS.onsite,
  panel: [{ profileId: 'chair-sea', isLead: true }],
  ...overrides,
});

const location = { id: 'loc-1', name: 'Interview Room A', building: 'Finster Hall', room: 'F213' };

describe('Manila time helpers', () => {
  it('converts the form date and time to one instant and back', () => {
    const iso = manilaInputToIso('2026-11-03', '09:00');
    expect(iso).toBe('2026-11-03T01:00:00.000Z');
    expect(isoToManilaInputs(iso)).toEqual({ date: '2026-11-03', time: '09:00' });
  });

  it('rejects an incomplete date or time', () => {
    expect(manilaInputToIso('2026-11-03', '')).toBe('');
    expect(manilaInputToIso('', '09:00')).toBe('');
  });

  it('formats the interview window in Philippine time, independent of the machine time zone', () => {
    expect(formatInterviewWhen('2026-11-03T01:00:00.000Z', 30)).toBe('Tue, Nov 3, 2026 · 9:00 AM – 9:30 AM (Philippine time)');
    expect(formatInterviewWhen('2026-11-03T04:30:00.000Z', 60)).toBe('Tue, Nov 3, 2026 · 12:30 PM – 1:30 PM (Philippine time)');
  });

  it('keys the interview on its Manila calendar day', () => {
    // 11:30 PM UTC on Nov 2 is already Nov 3 in Manila.
    expect(getInterviewDateKey('2026-11-02T23:30:00.000Z')).toBe('2026-11-03');
  });
});

describe('getEligiblePanelists (SOP 5a)', () => {
  it('lists the Department Chairs of the applicant’s school first', () => {
    const panel = getEligiblePanelists(staffDirectory, { studentDepartment: SEA });
    expect(panel.map((entry) => entry.userId)).toEqual(['chair-sea', 'chair-sea-2', 'staff-1']);
  });

  it('still offers the Admissions Office when the applicant’s school is unknown', () => {
    const panel = getEligiblePanelists(staffDirectory, { studentDepartment: '' });
    expect(panel.map((entry) => entry.userId)).toEqual(['staff-1']);
  });

  it('offers Admissions Office accounts on any panel', () => {
    const panel = getEligiblePanelists(staffDirectory, { studentDepartment: CAS });
    expect(panel.map((entry) => entry.userId)).toEqual(['chair-cas', 'staff-1']);
  });
});

describe('validateInterviewSchedule', () => {
  it('accepts a complete on-site schedule', () => {
    expect(validateInterviewSchedule(validDraft(), { now: NOW, activeLocationIds: ['loc-1'] })).toEqual({});
  });

  it('requires a future start and a location, and allows an empty panel', () => {
    const errors = validateInterviewSchedule(validDraft({ date: '2026-10-30', locationId: '', panel: [] }), { now: NOW });
    expect(errors.time).toMatch(/future/);
    expect(errors.locationId).toMatch(/location/);
    expect(errors.panel).toBeUndefined();
  });

  it('refuses an archived location', () => {
    const errors = validateInterviewSchedule(validDraft(), { now: NOW, activeLocationIds: ['loc-2'] });
    expect(errors.locationId).toMatch(/archived/);
  });

  it('accepts a typed location when no saved venue is used', () => {
    const typed = validDraft({ locationId: '', locationLabel: 'Finster Hall, F213' });
    expect(validateInterviewSchedule(typed, { now: NOW, activeLocationIds: ['loc-1'] })).toEqual({});
  });

  it('requires exactly one lead interviewer', () => {
    const none = validateInterviewSchedule(validDraft({ panel: [{ profileId: 'chair-sea', isLead: false }] }), { now: NOW });
    const two = validateInterviewSchedule(validDraft({ panel: [{ profileId: 'chair-sea', isLead: true }, { profileId: 'chair-sea-2', isLead: true }] }), { now: NOW });
    expect(none.panel).toMatch(/exactly one/);
    expect(two.panel).toMatch(/exactly one/);
  });

  it('checks faculty guests', () => {
    const noName = validateInterviewSchedule(validDraft({ panel: [{ guestName: '', guestEmail: '', isLead: true }] }), { now: NOW });
    const badEmail = validateInterviewSchedule(validDraft({ panel: [{ guestName: 'Prof. Santos', guestEmail: 'not-an-email', isLead: true }] }), { now: NOW });
    const ok = validateInterviewSchedule(validDraft({ panel: [{ guestName: 'Prof. Santos', guestEmail: 'santos@addu.edu.ph', isLead: true }] }), { now: NOW });
    expect(noName.panel).toMatch(/name/);
    expect(badEmail.panel).toMatch(/email/);
    expect(ok).toEqual({});
  });

  it('needs a meeting link online unless Google Meet generates one', () => {
    const online = validDraft({ mode: 'online', locationId: '' });
    expect(validateInterviewSchedule(online, { now: NOW }).meetingUrl).toMatch(/meeting link/);
    expect(validateInterviewSchedule(online, { now: NOW, autoMeeting: true })).toEqual({});
    expect(validateInterviewSchedule({ ...online, meetingUrl: 'http://meet.example' }, { now: NOW }).meetingUrl).toMatch(/https/);
    expect(validateInterviewSchedule({ ...online, meetingUrl: 'https://meet.google.com/abc-defg-hij' }, { now: NOW })).toEqual({});
  });
});

describe('interview records', () => {
  it('builds the public record without panel identities', () => {
    const record = buildInterviewRecord({ draft: validDraft(), location, school: SEA, actorId: 'staff-1', now: NOW });
    expect(record).toMatchObject({
      version: 2,
      state: 'scheduled',
      revision: 1,
      mode: 'onsite',
      startsAt: '2026-11-03T01:00:00.000Z',
      locationLabel: 'Interview Room A (Finster Hall, F213)',
      meetingUrl: '',
      school: SEA,
      history: [],
    });
    expect(JSON.stringify(record)).not.toContain('chair-sea');
  });

  it('bumps the revision and keeps the replaced schedule on reschedule', () => {
    const first = buildInterviewRecord({ draft: validDraft(), location, school: SEA, actorId: 'staff-1', now: NOW });
    const second = buildInterviewRecord({
      draft: validDraft({ mode: 'online', meetingUrl: 'https://meet.google.com/abc-defg-hij', time: '14:00' }),
      previous: first,
      actorId: 'staff-1',
      reason: 'Panel conflict',
      now: NOW,
    });
    expect(second.revision).toBe(2);
    expect(second.locationLabel).toBe('');
    expect(second.history).toHaveLength(1);
    expect(second.history[0]).toMatchObject({ revision: 1, mode: 'onsite', reason: 'Panel conflict', startsAt: first.startsAt });
  });

  it('records a cancellation as a new revision', () => {
    const first = buildInterviewRecord({ draft: validDraft(), location, school: SEA, now: NOW });
    const cancelled = buildCancelledInterview({ previous: first, actorId: 'staff-1', reason: 'Applicant request', now: NOW });
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.revision).toBe(2);
    expect(cancelled.history.at(-1)).toMatchObject({ cancelled: true, reason: 'Applicant request' });
  });

  it('prefills the draft from a record and its panel', () => {
    const record = buildInterviewRecord({ draft: validDraft(), location, school: SEA, now: NOW });
    const draft = createInterviewDraft({ interview: record }, [{ profileId: 'chair-sea', isLead: true }]);
    expect(draft).toMatchObject({ mode: 'onsite', date: '2026-11-03', time: '09:00', durationMinutes: 30, locationId: 'loc-1' });
    expect(draft.panel).toEqual([{ profileId: 'chair-sea', guestName: '', guestEmail: '', isLead: true }]);
  });

  it('keeps a typed location on the record and in the edit draft', () => {
    const record = buildInterviewRecord({
      draft: validDraft({ locationId: '', locationLabel: 'Finster Hall, F213' }),
      school: SEA,
      now: NOW,
    });
    expect(record.locationId).toBeNull();
    expect(record.locationLabel).toBe('Finster Hall, F213');
    expect(createInterviewDraft({ interview: record }, []).locationLabel).toBe('Finster Hall, F213');
    // A saved venue's label is derived from the venue, so the draft leaves the
    // typed field empty instead of echoing it.
    const venueRecord = buildInterviewRecord({ draft: validDraft(), location, school: SEA, now: NOW });
    expect(createInterviewDraft({ interview: venueRecord }, []).locationLabel).toBe('');
  });
});

describe('the interview record', () => {
  // The interview stage records a schedule only. Attendance is not tracked, so a
  // `scheduled` record is the only live work and the recommendation is what
  // closes the stage.
  it('treats only a scheduled interview as live work', () => {
    const record = buildInterviewRecord({ draft: validDraft(), location, now: NOW });
    expect(isInterviewLive(record)).toBe(true);
    expect(isInterviewLive({ ...record, state: 'completed' })).toBe(false);
    expect(isInterviewLive({ ...record, state: 'no_show' })).toBe(false);
    expect(isInterviewLive({ ...record, state: 'cancelled' })).toBe(false);
    expect(isInterviewLive({ scheduledAt: '2026-10-01', panel: 'SEA Scholarship Panel' })).toBe(false);
    expect(isInterviewLive(null)).toBe(false);
  });

  it('does not record an attendance outcome on a new schedule', () => {
    const record = buildInterviewRecord({ draft: validDraft(), location, now: NOW });
    expect(record).not.toHaveProperty('outcomeRecordedAt');
    expect(record).not.toHaveProperty('outcomeRecordedBy');
    expect(record).not.toHaveProperty('outcomeRecordedRole');
    expect(record.state).toBe('scheduled');
  });
});

describe('findInterviewConflicts', () => {
  const booked = (overrides = {}) => ({
    id: 'app-2',
    status: 'Interview',
    studentName: 'Eli Tan',
    interview: buildInterviewRecord({ draft: validDraft({ time: '09:15' }), location, now: NOW }),
    ...overrides,
  });
  const panelists = [{ applicationId: 'app-2', profileId: 'chair-sea', name: 'Ana Reyes', removedAt: null }];

  it('flags an overlapping booking for the same Chair and the same room', () => {
    const conflicts = findInterviewConflicts(validDraft(), { applications: [booked()], panelists, excludeApplicationId: 'app-1' });
    expect(conflicts.map((entry) => entry.kind).sort()).toEqual(['location', 'panelist']);
  });

  it('ignores cancelled interviews, the application itself, and back-to-back slots', () => {
    const cancelled = booked({ interview: { ...booked().interview, state: 'cancelled' } });
    expect(findInterviewConflicts(validDraft(), { applications: [cancelled], panelists })).toEqual([]);
    expect(findInterviewConflicts(validDraft(), { applications: [booked()], panelists, excludeApplicationId: 'app-2' })).toEqual([]);
    expect(findInterviewConflicts(validDraft({ time: '08:45', durationMinutes: 30 }), { applications: [booked()], panelists })).toEqual([]);
  });

  it('does not treat an online interview as a room booking', () => {
    const conflicts = findInterviewConflicts(validDraft({ mode: 'online', locationId: '', panel: [{ profileId: 'chair-cas', isLead: true }] }), { applications: [booked()], panelists });
    expect(conflicts).toEqual([]);
  });
});

describe('findRosterConflicts', () => {
  const scheduled = (overrides = {}) => ({
    id: 'app-1',
    status: 'Interview',
    studentName: 'Ada Cruz',
    interview: buildInterviewRecord({ draft: validDraft(), location, school: SEA, now: NOW }),
    ...overrides,
  });
  const overlapping = (overrides = {}) => scheduled({
    id: 'app-2',
    studentName: 'Eli Tan',
    interview: buildInterviewRecord({ draft: validDraft({ time: '09:15' }), location, school: SEA, now: NOW }),
    ...overrides,
  });
  const panelists = [
    { applicationId: 'app-1', profileId: 'chair-sea', name: 'Ana Reyes', removedAt: null },
    { applicationId: 'app-2', profileId: 'chair-sea', name: 'Ana Reyes', removedAt: null },
  ];

  it('flags the same Chair and the same room across two scheduled interviews', () => {
    const conflicts = findRosterConflicts([scheduled(), overlapping()], panelists);
    expect(conflicts.map((entry) => entry.kind).sort()).toEqual(['location', 'panelist']);
    expect(conflicts[0].applicationIds.sort()).toEqual(['app-1', 'app-2']);
  });

  it('ignores back-to-back slots, online rooms, and removed panel members', () => {
    const backToBack = scheduled({
      id: 'app-3',
      interview: buildInterviewRecord({ draft: validDraft({ time: '09:30' }), location, school: SEA, now: NOW }),
    });
    expect(findRosterConflicts([scheduled(), backToBack], panelists)).toEqual([]);

    const online = overlapping({
      interview: buildInterviewRecord({
        draft: validDraft({ mode: 'online', locationId: '', meetingUrl: 'https://meet.google.com/abc-defg-hij', time: '09:15' }),
        school: SEA,
        now: NOW,
      }),
    });
    expect(findRosterConflicts([scheduled(), online], panelists).map((entry) => entry.kind)).toEqual(['panelist']);

    const removed = panelists.map((row) => (row.applicationId === 'app-2' ? { ...row, removedAt: '2026-11-01T00:00:00.000Z' } : row));
    expect(findRosterConflicts([scheduled(), overlapping()], removed).map((entry) => entry.kind)).toEqual(['location']);
  });

  it('counts only scheduled interviews', () => {
    const cancelled = overlapping({ interview: { ...overlapping().interview, state: 'cancelled' } });
    expect(findRosterConflicts([scheduled(), cancelled], panelists)).toEqual([]);
  });
});

describe('needsInterviewCalendarRepair', () => {
  it('asks for a repair only when Google and the record disagree', () => {
    const record = buildInterviewRecord({ draft: validDraft(), location, school: SEA, now: NOW, calendar: { eventId: 'evt-1', htmlLink: 'https://calendar.example/evt-1' } });
    expect(needsInterviewCalendarRepair(record)).toBe(false);
    expect(needsInterviewCalendarRepair({ ...record, calendar: null })).toBe(true);
    expect(needsInterviewCalendarRepair({ ...record, state: 'cancelled', calendar: { eventId: 'evt-1', removedAt: null } })).toBe(true);
    expect(needsInterviewCalendarRepair({ ...record, state: 'cancelled', calendar: { eventId: 'evt-1', removedAt: '2026-11-02T00:00:00.000Z' } })).toBe(false);
    expect(needsInterviewCalendarRepair({ ...record, mode: 'online', meetingUrl: '', calendar: { eventId: 'evt-1' } })).toBe(true);
    expect(needsInterviewCalendarRepair(null)).toBe(false);
  });
});

describe('student view, calendar files, and reminders', () => {
  const record = buildInterviewRecord({
    draft: validDraft({ mode: 'online', locationId: '', meetingUrl: 'https://meet.google.com/abc-defg-hij' }),
    school: SEA,
    now: NOW,
  });

  it('describes the panel by school only', () => {
    const view = describeInterviewForStudent(record);
    expect(view).toMatchObject({ stateLabel: 'Scheduled', modeLabel: 'Online', meetingUrl: 'https://meet.google.com/abc-defg-hij' });
    expect(view.panel).toBe(`Interview panel from ${SEA}`);
    expect(summarizeInterview(record)).toContain('https://meet.google.com/abc-defg-hij');
  });

  it('builds an .ics file in UTC with CRLF line endings', () => {
    const ics = buildInterviewIcs({ interview: record, scholarshipTitle: 'Grant-in-Aid (GIA)', uid: 'app-1-1', now: NOW });
    expect(ics).toContain('DTSTART:20261103T010000Z\r\n');
    expect(ics).toContain('DTEND:20261103T013000Z\r\n');
    expect(ics).toContain('URL:https://meet.google.com/abc-defg-hij');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(buildInterviewIcs({ interview: { ...record, state: 'cancelled' }, uid: 'x', now: NOW })).toContain('STATUS:CANCELLED');
  });

  it('builds the Google Calendar template link', () => {
    const url = new URL(buildGoogleCalendarTemplateUrl({ interview: record, scholarshipTitle: 'Grant-in-Aid (GIA)' }));
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261103T010000Z/20261103T013000Z');
    expect(url.searchParams.get('ctz')).toBe('Asia/Manila');
  });

  it('gives each revision its own reminder key', () => {
    expect(getInterviewReminderKey('app-1', 1)).toBe('interview-reminder-app-1-1-1');
    expect(getInterviewReminderKey('app-1', 3)).toBe('interview-reminder-app-1-3-1');
  });
});

describe('interview notification copy', () => {
  const record = buildInterviewRecord({ draft: validDraft(), location, school: SEA, now: NOW });

  it('puts the schedule in the Interview status message', () => {
    const message = describeApplicationStatusUpdate('Interview', 'the Admissions Office Staff', { interview: record });
    expect(message).toContain('Your interview is scheduled');
    expect(message).toContain('Interview Room A');
    const email = renderApplicationStatusEmail({ subject: 'Application status: Interview', body: message, scholarshipTitle: 'GIA', status: 'Interview', siteUrl: 'https://example.test/', interview: record });
    expect(email.text).toContain(`Panel: Interview panel from ${SEA}`);
    expect(email.text).not.toContain('Ana Reyes');
  });

  it('texts the interview date with the status', () => {
    expect(renderApplicationStatusSms({ scholarshipTitle: 'GIA', status: 'Interview', interview: record }).message)
      .toBe('ScholarPath AdDU: your GIA interview is on Nov 3, 2026 · 9:00 AM (on-site). Sign in for the details.');
  });

  it('renders reschedule, cancellation, panel, and reminder messages', () => {
    const student = renderInterviewUpdateEmail({ audience: 'student', kind: 'rescheduled', interview: record, scholarshipTitle: 'GIA', reason: 'Room unavailable', siteUrl: 'https://example.test/' });
    expect(student.subject).toBe('Your scholarship interview was rescheduled');
    expect(student.text).toContain('Reason: Room unavailable');
    const panel = renderInterviewUpdateEmail({ audience: 'panelist', kind: 'scheduled', interview: record, scholarshipTitle: 'GIA', applicantName: 'Ada Cruz', siteUrl: 'https://example.test/' });
    expect(panel.subject).toBe('Interview panel assignment: Ada Cruz');
    expect(panel.text).toContain('add your evaluation');
    // The panelist email states the task in plain language, without the SOP code.
    expect(panel.text).not.toContain('SOP 5a');
    expect(renderInterviewUpdateSms({ kind: 'cancelled', interview: record, scholarshipTitle: 'GIA' }).message).toContain('was cancelled');
    expect(renderInterviewReminderEmail({ interview: record, scholarshipTitle: 'GIA', siteUrl: 'https://example.test/' }).subject).toBe('Reminder: your GIA interview is tomorrow');
    expect(renderInterviewReminderSms({ interview: record, scholarshipTitle: 'GIA' }).message).toContain('is tomorrow');
  });
});

describe('Google Calendar client', () => {
  const config = getGoogleCalendarConfig({ GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', GOOGLE_CALENDAR_REFRESH_TOKEN: 'refresh' });
  const schedule = { mode: 'online', startsAt: '2026-11-03T01:00:00.000Z', durationMinutes: 30, meetingUrl: '', instructions: 'Bring an ID.' };

  it('reports configured only when every secret is set', () => {
    expect(config).toMatchObject({ configured: true, calendarId: 'primary' });
    expect(getGoogleCalendarConfig({ GOOGLE_OAUTH_CLIENT_ID: 'id' }).configured).toBe(false);
  });

  it('requests a Meet link for an online interview and hides the guest list', () => {
    const event = buildGoogleInterviewEvent({ schedule, scholarshipTitle: 'GIA', attendees: [{ email: 'student@example.test' }, { email: '' }], requestId: 'req-1' });
    expect(event.conferenceData.createRequest).toEqual({ requestId: 'req-1', conferenceSolutionKey: { type: 'hangoutsMeet' } });
    expect(event.guestsCanSeeOtherGuests).toBe(false);
    expect(event.attendees).toEqual([{ email: 'student@example.test' }]);
    expect(event.end.dateTime).toBe('2026-11-03T01:30:00.000Z');
  });

  it('keeps a pasted link instead of generating a new Meet', () => {
    const event = buildGoogleInterviewEvent({ schedule: { ...schedule, meetingUrl: 'https://zoom.us/j/1' }, requestId: 'req-1' });
    expect(event.conferenceData).toBeUndefined();
    expect(event.location).toBe('https://zoom.us/j/1');
  });

  it('creates the event and returns the Meet link', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'evt-1', htmlLink: 'https://calendar.google.com/event?eid=1', hangoutLink: 'https://meet.google.com/xyz-abcd-efg' }),
    });
    const result = await upsertGoogleInterviewEvent({ config, accessToken: 'token', event: { summary: 'x' }, fetchImpl });
    expect(result).toEqual({ ok: true, eventId: 'evt-1', htmlLink: 'https://calendar.google.com/event?eid=1', meetingUrl: 'https://meet.google.com/xyz-abcd-efg' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all');
    expect(init.method).toBe('POST');
  });

  it('treats an already-deleted event as cancelled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 410, json: async () => ({}) });
    expect(await cancelGoogleInterviewEvent({ config, accessToken: 'token', eventId: 'evt-1', fetchImpl })).toEqual({ ok: true });
  });

  it('keeps one calendar entry across reschedules and renders a single recipient', () => {
    const icsInterview = {
      version: 2,
      state: 'scheduled',
      revision: 1,
      mode: 'online',
      startsAt: '2026-11-03T01:00:00.000Z',
      durationMinutes: 30,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      school: SEA,
      locationLabel: '',
      instructions: '',
    };
    const icsNow = new Date('2026-10-23T00:00:00.000Z');
    const first = buildInterviewIcs({ interview: icsInterview, scholarshipTitle: 'GIA', uid: 'app-1', recipientEmail: 'student@example.test', now: icsNow });
    const second = buildInterviewIcs({
      interview: { ...icsInterview, revision: 2, startsAt: '2026-11-04T01:00:00.000Z' },
      scholarshipTitle: 'GIA',
      uid: 'app-1',
      recipientEmail: 'student@example.test',
      now: icsNow,
    });
    // Same UID, higher SEQUENCE: the calendar client updates the entry in place.
    expect(first).toContain('UID:app-1@scholarpath-addu');
    expect(second).toContain('UID:app-1@scholarpath-addu');
    expect(second).toContain('SEQUENCE:2');
    expect(second).toContain('METHOD:REQUEST');
    // One attendee per file, so a shared file never exposes the panel.
    expect(second.match(/ATTENDEE/g)).toHaveLength(1);
    expect(second).toContain('ATTENDEE;CN=student@example.test');
    expect(second).not.toContain('chair@');
    expect(buildInterviewIcs({ interview: { ...icsInterview, state: 'cancelled', revision: 3 }, uid: 'app-1', now: icsNow })).toContain('METHOD:CANCEL');
  });

  it('reads the Meet link from the conference entry points', () => {
    expect(extractMeetLink({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }, { entryPointType: 'video', uri: 'https://meet.google.com/a' }] } })).toBe('https://meet.google.com/a');
  });
});

// Consultation 2, request #7: the panel recommends instead of rating 1-5, and
// the deliberation reads the panel's latest level.
describe('interview recommendation levels', () => {
  it('lists the five levels the database accepts', () => {
    expect(INTERVIEW_RECOMMENDATION_LEVELS.map((entry) => entry.value)).toEqual([
      'highly_recommended',
      'recommended',
      'recommended_with_reservation',
      'not_recommended',
      'deferred',
    ]);
    expect(getInterviewRecommendationLevelLabel('recommended_with_reservation')).toBe('Recommended with reservation');
    expect(getInterviewRecommendationLevelLabel('not-a-level')).toBe('');
    expect(getInterviewRecommendationLevelLabel('')).toBe('');
  });

  it('reads the newest note that states a level', () => {
    const latest = getLatestPanelRecommendation([
      { id: 'n-1', recommendationLevel: 'recommended', authorName: 'Ana Reyes', createdAt: '2026-01-05T02:00:00.000Z' },
      { id: 'n-2', authorName: 'Carlo Uy', createdAt: '2026-01-06T02:00:00.000Z' },
      { id: 'n-3', recommendationLevel: 'not_recommended', authorName: 'Carla Lim', createdAt: '2026-01-07T02:00:00.000Z' },
    ]);
    expect(latest).toMatchObject({
      level: 'not_recommended',
      label: 'Not recommended',
      authorName: 'Carla Lim',
      createdAt: '2026-01-07T02:00:00.000Z',
    });
  });

  it('says nothing when the panel only recorded observations', () => {
    expect(getLatestPanelRecommendation([{ id: 'n-1', rating: 4, body: 'Clear goals.' }])).toBeNull();
    expect(getLatestPanelRecommendation()).toBeNull();
  });
});
