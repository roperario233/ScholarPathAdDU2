import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarView from '../src/pages/CalendarView';

// The student calendar now renders through the shared MonthCalendar. This test
// protects its existing behavior: the month grid, its single deadline dot, the
// scholarship agenda, and the scheduled interview list.
// The grid opens on the current month, so a plain `now + n days` fixture leaves
// the rendered month late in a month (on the 29th, a 20-day deadline is in the
// next month) and the deadline-dot assertion then fails for a reason that has
// nothing to do with the calendar. These dates stay inside the displayed month
// and in the future, so the mark always lands on a rendered cell.
const now = new Date();
const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const laterThisMonth = (days) => new Date(
  now.getFullYear(),
  now.getMonth(),
  Math.min(now.getDate() + days, daysInMonth),
  23,
  59,
).toISOString();

const scholarship = {
  id: 'scholarship-1',
  title: 'Grant-in-Aid (GIA)',
  deadline: laterThisMonth(20).slice(0, 10),
};

const interviewApplication = {
  id: 'app-1',
  status: 'Interview',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  interview: {
    version: 2,
    state: 'scheduled',
    revision: 1,
    mode: 'onsite',
    startsAt: laterThisMonth(3),
    durationMinutes: 30,
    locationId: 'loc-1',
    locationLabel: 'Interview Room A',
    meetingUrl: '',
    school: 'School of Engineering and Architecture (SEA)',
    calendar: null,
    instructions: '',
    history: [],
  },
};

describe('student CalendarView', () => {
  it('keeps the shared month grid, its dot, and the deadline agenda', () => {
    const html = renderToStaticMarkup(
      <CalendarView
        scholarships={[scholarship]}
        customDeadlines={[]}
        interviews={[interviewApplication]}
        onAddCustomDeadline={() => undefined}
        onDeleteCustomDeadline={() => undefined}
      />,
    );
    expect(html).toContain('Deadline calendar');
    expect(html).toContain('Scholarship deadlines and personal reminders');
    expect(html).toContain('calendar-cell');
    expect(html).toContain('deadline-dot');
    expect(html).toContain('Grant-in-Aid (GIA)');
    expect(html).toContain('Add Reminder');
    expect(html).toContain('Interview · Grant-in-Aid (GIA)');
  });
});
