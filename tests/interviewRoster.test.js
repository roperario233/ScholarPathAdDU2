import { describe, expect, it } from 'vitest';
import {
  getInterviewEntries,
  getInterviewMarksByDate,
  getInterviewsNeedingReschedule,
  getInterviewsNeedingSchedule,
  getInterviewsForDate,
  getManilaTodayKey,
  getPanelApplicationIds,
  getPanelForApplication,
  getUpcomingInterviews,
  groupInterviewsByDate,
} from '../src/lib/interviewRoster';
import { getDeadlineMarksByDate, mergeMarksByDate, toCalendarDateKey } from '../src/lib/calendarMarks';

const SEA = 'School of Engineering and Architecture (SEA)';
// 8:00 AM in Manila on 3 November 2026.
const NOW = new Date('2026-11-03T00:00:00.000Z');

const interview = (overrides = {}) => ({
  version: 2,
  state: 'scheduled',
  revision: 1,
  mode: 'onsite',
  startsAt: '2026-11-03T01:00:00.000Z',
  durationMinutes: 30,
  locationId: 'loc-1',
  locationLabel: 'Interview Room A (Finster Hall, F213)',
  meetingUrl: '',
  school: SEA,
  calendar: { eventId: 'evt-1', htmlLink: '' },
  instructions: '',
  history: [],
  ...overrides,
});

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'Interview',
  studentName: 'Ada Cruz',
  studentProgram: 'BS Computer Engineering',
  studentDepartment: SEA,
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  updatedAt: '2026-11-01',
  interview: interview(),
  ...overrides,
});

describe('interview roster entries', () => {
  it('keys every interview on its Manila day, not the machine time zone', () => {
    const [entry] = getInterviewEntries([application({ interview: interview({ startsAt: '2026-11-02T16:30:00.000Z' }) })]);
    expect(entry.dateKey).toBe('2026-11-03');
    expect(entry.startsAtDate.toISOString()).toBe('2026-11-02T16:30:00.000Z');
  });

  it('accepts only applicants the signed-in Chair sits on the panel for', () => {
    const panelists = [
      { applicationId: 'app-1', profileId: 'chair-sea', removedAt: null },
      { applicationId: 'app-2', profileId: 'chair-sea', removedAt: '2026-11-01T00:00:00.000Z' },
    ];
    expect([...getPanelApplicationIds(panelists, 'chair-sea')]).toEqual(['app-1']);
    expect(getPanelForApplication(panelists, 'app-1')).toHaveLength(1);
  });
});

describe('the work lists', () => {
  it('asks for a schedule only while an endorsed application has none', () => {
    const waiting = application({ id: 'app-waiting', status: 'Endorsed', interview: null });
    const booked = application({ id: 'app-booked', status: 'Endorsed' });
    const cancelled = application({
      id: 'app-cancelled-endorsed',
      status: 'Endorsed',
      interview: interview({ state: 'cancelled' }),
    });
    expect(getInterviewsNeedingSchedule([waiting, booked, cancelled]).map((entry) => entry.id))
      .toEqual(['app-waiting', 'app-cancelled-endorsed']);
  });

  it('treats an ongoing interview as upcoming and a cancelled one as needing a reschedule', () => {
    const ongoing = application({ id: 'app-ongoing', interview: interview({ startsAt: '2026-11-02T23:45:00.000Z' }) });
    const upcoming = application({ id: 'app-upcoming' });
    const cancelled = application({ id: 'app-cancelled', interview: interview({ state: 'cancelled' }) });
    const noShow = application({ id: 'app-no-show', interview: interview({ state: 'no_show' }) });
    expect(getUpcomingInterviews([ongoing, upcoming, cancelled], { now: NOW }).map((entry) => entry.applicationId))
      .toEqual(['app-ongoing', 'app-upcoming']);
    expect(getInterviewsNeedingReschedule([cancelled, noShow]).map((entry) => entry.state).sort())
      .toEqual(['cancelled', 'no_show']);
  });

  it('groups a day and filters it', () => {
    const applications = [
      application({ id: 'app-2', interview: interview({ startsAt: '2026-11-03T03:00:00.000Z' }) }),
      application({ id: 'app-1' }),
    ];
    const entries = getInterviewEntries(applications);
    expect(getInterviewsForDate(entries, '2026-11-03').map((entry) => entry.applicationId)).toEqual(['app-1', 'app-2']);
    const [group] = groupInterviewsByDate(entries);
    expect(group.dateKey).toBe('2026-11-03');
    expect(group.entries).toHaveLength(2);
  });

  it('treats a closed application as history, not upcoming work', () => {
    const rejected = application({ id: 'app-rejected', status: 'Rejected' });
    const [entry] = getInterviewEntries([rejected]);
    expect(entry.live).toBe(false);
    expect(getUpcomingInterviews([rejected], { now: NOW })).toEqual([]);
    expect(getInterviewMarksByDate([rejected])['2026-11-03']).toBeUndefined();
  });
});

describe('calendar marks', () => {
  it('marks the office schedule and keeps cancelled interviews off the grid', () => {
    const applications = [
      application(),
      application({ id: 'app-cancelled', interview: interview({ state: 'cancelled' }) }),
    ];
    const marks = getInterviewMarksByDate(applications);
    expect(marks['2026-11-03']).toEqual([{ kind: 'interview', count: 1, label: '1 interview' }]);
  });

  it('separates a Chair’s panel from the rest of the department', () => {
    const applications = [
      application(),
      application({ id: 'app-2', interview: interview({ startsAt: '2026-11-04T01:00:00.000Z' }) }),
    ];
    const marks = getInterviewMarksByDate(applications, {
      panelApplicationIds: new Set(['app-1']),
    });
    expect(marks['2026-11-03'][0]).toMatchObject({ kind: 'your-panel', label: '1 on your panel' });
    expect(marks['2026-11-04'][0]).toMatchObject({ kind: 'department-interview', label: '1 department interview' });
  });

  it('files scholarship deadlines on their calendar day and honors the in-scope filter', () => {
    const scholarships = [
      { title: 'Grant-in-Aid (GIA)', deadline: '2026-11-03' },
      { title: 'Jubilee Scholarship Fund', deadline: '2026-11-05T00:00:00+08:00' },
      { title: 'External Grant', deadline: '2026-11-07' },
    ];
    expect(getDeadlineMarksByDate(scholarships)['2026-11-05'][0].label).toBe('1 scholarship deadline');
    expect(getDeadlineMarksByDate(scholarships, { onlyInScope: true })['2026-11-07']).toBeUndefined();
    expect(toCalendarDateKey(2026, 10, 3)).toBe('2026-11-03');
  });

  it('merges interview and deadline marks on one day', () => {
    const merged = mergeMarksByDate(
      { '2026-11-03': [{ kind: 'interview', label: '1 interview' }] },
      { '2026-11-03': [{ kind: 'deadline', label: '2 scholarship deadlines' }] },
    );
    expect(merged['2026-11-03'].map((mark) => mark.kind)).toEqual(['interview', 'deadline']);
  });
});

describe('Manila day key', () => {
  it('reads today from the Manila calendar, not the machine time zone', () => {
    expect(getManilaTodayKey(NOW)).toBe('2026-11-03');
    expect(getManilaTodayKey(new Date('2026-11-02T16:30:00.000Z'))).toBe('2026-11-03');
  });
});
