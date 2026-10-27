import { describe, expect, it } from 'vitest';
import {
  DECISION_STAGES,
  getDeadlineMarksByDate,
  getOfficeEntriesForDate,
  getOfficeEntryKindLabel,
  getOfficeEntryMarksByDate,
  getStageEventsForDate,
  getStageMarksByDate,
  getUpcomingOfficeEntries,
  mergeMarksByDate,
  toCalendarDateKey,
} from '../src/lib/calendarMarks';

const application = (overrides = {}) => ({
  id: 'app-1',
  studentName: 'Ada Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  status: 'Released',
  timeline: [],
  ...overrides,
});

// The recorded-decision layer reads timestamps, not date-only strings, so it has
// to file each event on the Manila day the office recorded it.
describe('getStageMarksByDate', () => {
  it('files an evening UTC decision on the next Manila day', () => {
    const marks = getStageMarksByDate([
      application({ statusLog: [{ id: 'log-1', toStatus: 'Released', at: '2026-11-03T17:30:00.000Z' }] }),
    ]);
    expect(marks['2026-11-04']).toEqual([{ kind: 'decision', count: 1, label: '1 recorded decision' }]);
    expect(marks['2026-11-03']).toBeUndefined();
  });

  it('counts every recorded decision on one day', () => {
    const marks = getStageMarksByDate([
      application({
        statusLog: [
          { id: 'log-1', toStatus: 'Endorsed', at: '2026-11-04T01:00:00.000Z' },
          { id: 'log-2', toStatus: 'Recommended', at: '2026-11-04T02:00:00.000Z' },
        ],
      }),
    ]);
    expect(marks['2026-11-04']).toEqual([{ kind: 'decision', count: 2, label: '2 recorded decisions' }]);
  });

  it('keeps the hand-off to endorsement out of the decision layer', () => {
    const marks = getStageMarksByDate([
      application({
        status: 'For Endorsement',
        statusLog: [{ id: 'log-1', toStatus: 'For Endorsement', at: '2026-11-04T01:00:00.000Z' }],
      }),
    ]);
    expect(marks).toEqual({});
    expect(DECISION_STAGES).not.toContain('For Endorsement');
  });

  it('falls back to the browser timeline when no status log was loaded', () => {
    const marks = getStageMarksByDate([
      application({ timeline: [{ stage: 'Approved', at: '2026-11-05T01:00:00.000Z' }] }),
    ]);
    expect(marks['2026-11-05']).toEqual([{ kind: 'decision', count: 1, label: '1 recorded decision' }]);
  });

  it('exposes the events behind a day, newest first', () => {
    const first = application({
      id: 'app-1',
      statusLog: [
        { id: 'log-1', toStatus: 'Endorsed', at: '2026-11-04T01:00:00.000Z' },
        { id: 'log-2', toStatus: 'Recommended', at: '2026-11-04T03:00:00.000Z' },
      ],
    });
    const events = getStageEventsForDate([first], '2026-11-04');
    expect(events.map((event) => event.stage)).toEqual(['Recommended', 'Endorsed']);
    expect(events[0].application.studentName).toBe('Ada Cruz');
  });
});

describe('office planning entries', () => {
  const entries = [
    { id: 'office-2', title: 'Release target date', entryDate: '2026-11-10', kind: 'deadline' },
    { id: 'office-1', title: 'Verification window closes', entryDate: '2026-11-10', kind: 'office', notes: 'Queued files' },
    { id: 'office-3', title: 'Past window', entryDate: '2026-11-01', kind: 'meeting' },
  ];

  it('counts the entries filed on one day', () => {
    const marks = getOfficeEntryMarksByDate(entries);
    expect(marks['2026-11-10']).toEqual([{ kind: 'office', count: 2, label: '2 office entries' }]);
    expect(marks['2026-11-01']).toEqual([{ kind: 'office', count: 1, label: '1 office entry' }]);
  });

  it('returns the rows for the day agenda', () => {
    expect(getOfficeEntriesForDate(entries, '2026-11-10').map((entry) => entry.id)).toEqual(['office-2', 'office-1']);
    expect(getOfficeEntriesForDate(entries, '')).toEqual([]);
  });

  it('lists only the upcoming entries, soonest first', () => {
    expect(getUpcomingOfficeEntries(entries, { todayKey: '2026-11-05' }).map((entry) => entry.id)).toEqual(['office-2', 'office-1']);
  });

  it('labels the entry kinds the office can publish', () => {
    expect(getOfficeEntryKindLabel('deadline')).toBe('Office deadline');
    expect(getOfficeEntryKindLabel('meeting')).toBe('Meeting');
    expect(getOfficeEntryKindLabel('unknown')).toBe('Office work');
  });
});

describe('mergeMarksByDate', () => {
  it('keeps every layer on a shared day instead of collapsing them', () => {
    const merged = mergeMarksByDate(
      getOfficeEntryMarksByDate([{ id: 'office-1', title: 'Window', entryDate: '2026-11-10', kind: 'office' }]),
      getDeadlineMarksByDate([{ id: 's-1', title: 'Grant-in-Aid (GIA)', deadline: '2026-11-10', ruleFamily: 'general-pool' }], { onlyInScope: true }),
    );
    expect(merged['2026-11-10'].map((mark) => mark.kind).sort()).toEqual(['deadline', 'office']);
    expect(toCalendarDateKey(2026, 10, 10)).toBe('2026-11-10');
  });
});
