import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InterviewRosterRow, formatInterviewDay } from '../src/components/InterviewRoster';
import AdminCalendar from '../src/pages/admin/AdminCalendar';
import AdminInterviews from '../src/pages/admin/AdminInterviews';
import DepartmentCalendarView from '../src/pages/DepartmentCalendarView';
import DepartmentInterviewsView from '../src/pages/DepartmentInterviewsView';
import { getInterviewEntries } from '../src/lib/interviewRoster';

const SEA = 'School of Engineering and Architecture (SEA)';
const NOW = Date.now();
const UPCOMING = new Date(NOW + 2 * 86400000).toISOString();
const DUE = new Date(NOW - 60 * 60 * 1000).toISOString();

const todayKey = (() => {
  const date = new Date(NOW + 8 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
})();

const interview = (overrides = {}) => ({
  version: 2,
  state: 'scheduled',
  revision: 1,
  mode: 'onsite',
  startsAt: UPCOMING,
  durationMinutes: 30,
  locationId: 'loc-1',
  locationLabel: 'Interview Room A (Finster Hall, F213)',
  meetingUrl: '',
  school: SEA,
  calendar: { eventId: 'evt-1' },
  instructions: '',
  history: [],
  ...overrides,
});

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'Interview',
  studentName: 'Ada Cruz',
  studentProgram: 'BS Computer Engineering',
  studentSchool: SEA,
  studentDepartment: 'Computer Engineering Department',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  scholarshipId: 'scholarship-1',
  updatedAt: '2026-11-01',
  interview: interview(),
  timeline: [],
  ...overrides,
});

const panelists = [
  { id: 'p-1', applicationId: 'app-1', profileId: 'chair-sea', name: 'Ana Reyes', isLead: true, removedAt: null },
  { id: 'p-2', applicationId: 'app-due', profileId: 'chair-sea', name: 'Ana Reyes', isLead: true, removedAt: null },
];

const workspace = (overrides = {}) => ({
  viewerId: 'staff-1',
  staffDirectory: [
    { userId: 'chair-sea', fullName: 'Ana Reyes', role: 'department_chair', department: SEA, reviewDepartment: 'Computer Engineering Department' },
    { userId: 'staff-1', fullName: 'Dana Uy', role: 'admissions_office', department: 'Office of Admissions' },
  ],
  locations: [{ id: 'loc-1', name: 'Interview Room A', building: 'Finster Hall', room: 'F213', isActive: true }],
  panelists,
  notes: [],
  calendarConfigured: true,
  calendarChecking: false,
  calendarReauthRequired: false,
  calendarSummary: 'ScholarPath Interviews',
  calendarReason: '',
  ...overrides,
});

const scholarship = {
  id: 'scholarship-1',
  title: 'Grant-in-Aid (GIA)',
  deadline: todayKey,
  ruleFamily: 'general-pool',
  isActive: true,
  isMatchable: true,
};

const applications = () => [
  application(),
  application({ id: 'app-due', interview: interview({ startsAt: DUE }) }),
  application({ id: 'app-endorsed', status: 'Endorsed', interview: null }),
];

// One office planning entry on the Manila today, so the "Office next" list and the
// calendar mark both render without depending on the machine's month.
const officeEntries = () => [
  { id: 'office-1', title: 'Verification window closes', entryDate: todayKey, kind: 'deadline', notes: 'Finish queued files.' },
];

// A case the Head released today, so the recorded-decision layer has one event on
// the Manila day the calendar opens on.
const decisionLogged = () => [
  ...applications(),
  application({
    id: 'app-released',
    status: 'Released',
    interview: null,
    statusLog: [{ id: 'log-1', toStatus: 'Released', actorRole: 'admissions_head', at: `${todayKey}T02:00:00.000Z` }],
  }),
];

const officeProps = (overrides = {}) => ({
  applications: applications(),
  documents: [],
  students: {},
  scholarships: [scholarship],
  role: 'admissions_office',
  reviewerName: 'Dana Uy',
  reviewComments: [],
  interviewWorkspace: workspace(),
  ...overrides,
});

const chairProps = (overrides = {}) => ({
  profile: { department: SEA, role: 'department_chair', reviewDepartment: 'Computer Engineering Department' },
  queue: applications(),
  documents: [],
  scholarships: [scholarship],
  reviewComments: [],
  interviewWorkspace: workspace({ viewerId: 'chair-sea' }),
  ...overrides,
});

describe('InterviewRosterRow', () => {
  const entryFor = (app) => getInterviewEntries([app])[0];

  it('renders the schedule, the panel, and one open action without attendance controls', () => {
    const html = renderToStaticMarkup(
      <InterviewRosterRow entry={entryFor(application({ id: 'app-due', interview: interview({ startsAt: DUE }) }))} panel={panelists.slice(1, 2)} />,
    );
    expect(html).toContain('Ana Reyes');
    expect(html).toContain('Open interview');
    expect(html).not.toContain('Mark attended');
    expect(html).not.toContain('Mark did not attend');
    expect(html).not.toContain('Attendance due');
  });

  it('keeps a Chair who is not on the panel read-only', () => {
    const html = renderToStaticMarkup(
      <InterviewRosterRow entry={entryFor(application({ id: 'app-due', interview: interview({ startsAt: DUE }) }))} panel={panelists.slice(1, 2)} yourRole="observer" openLabel="View interview" />,
    );
    expect(html).toContain('View only');
    expect(html).toContain('View interview');
    expect(html).not.toContain('Mark attended');
  });

  it('names the role a Chair holds on the panel', () => {
    const html = renderToStaticMarkup(
      <InterviewRosterRow entry={entryFor(application({ id: 'app-due', interview: interview({ startsAt: DUE }) }))} panel={panelists.slice(1, 2)} yourRole="lead" />,
    );
    expect(html).toContain('>Lead</span>');
    expect(html).not.toContain('Mark attended');
  });

  it('formats the day heading from the Manila date key', () => {
    expect(formatInterviewDay('2026-11-03')).toContain('November 3, 2026');
  });
});


describe('AdminInterviews', () => {
  it('places endorsed applicants in the scheduling list', () => {
    const html = renderToStaticMarkup(<AdminInterviews {...officeProps()} initialFilter="needs-scheduling" />);
    expect(html).toContain('Awaiting schedule');
    expect(html).toContain('To be scheduled by');
    expect(html).toContain('Read-only for Admissions Office Staff');
    expect(html).toContain('View case');
    expect(html).not.toContain('Schedule as Head');
    expect(html).toContain('Ada Cruz');
  });

  it('offers the Head the override and shows a count on every category', () => {
    const html = renderToStaticMarkup(<AdminInterviews {...officeProps({ role: 'admissions_head' })} initialFilter="needs-scheduling" />);
    expect(html).toContain('Schedule as Head');
    ['Upcoming', 'Needs scheduling', 'Cancelled', 'All interviews'].forEach((label) => {
      expect(html).toMatch(new RegExp(`${label}<span[^>]*>\\d+</span>`));
    });
  });

  it('opens on the first category that has something in it', () => {
    const html = renderToStaticMarkup(<AdminInterviews {...officeProps({ applications: applications().filter((entry) => entry.status === 'Endorsed') })} />);
    expect(html).toContain('Awaiting schedule');
    expect(html).not.toContain('No upcoming interviews');
  });

  it('shows the upcoming roster with its filter and panel', () => {
    const html = renderToStaticMarkup(<AdminInterviews {...officeProps()} />);
    expect(html).toContain('Interview schedule');
    expect(html).toContain('Ana Reyes');
    expect(html).toContain('Filter interviews');
    expect(html).toContain('Open interview');
  });

  it('renders no stat-card grid and no long SOP description', () => {
    const html = renderToStaticMarkup(<AdminInterviews {...officeProps()} />);
    expect(html).not.toContain('Coordinate SOP step 5');
    expect(html).not.toContain('page-metric');
  });
});

describe('AdminCalendar', () => {
  it('marks interviews, catalog deadlines, recorded decisions, and office entries', () => {
    const html = renderToStaticMarkup(
      <AdminCalendar {...officeProps({ applications: decisionLogged(), officeCalendarEntries: officeEntries() })} />,
    );
    expect(html).toContain('Office calendar');
    expect(html).toContain('Scholarship deadline');
    expect(html).toContain('Recorded decision');
    expect(html).toContain('Office entry');
    expect(html).toContain('1 scholarship deadline');
    expect(html).toContain('1 recorded decision');
    expect(html).toContain('1 office entry');
    expect(html).toContain('Next up');
  });

  it('shows only the month view and the day agenda', () => {
    const html = renderToStaticMarkup(<AdminCalendar {...officeProps()} />);
    expect(html).toContain('Office schedule');
    expect(html).toContain('Next up');
    expect(html).not.toContain('To schedule');
    expect(html).not.toContain('Attendance to record');
  });

  it('offers the mark filters and a Today jump', () => {
    const html = renderToStaticMarkup(<AdminCalendar {...officeProps()} />);
    expect(html).toContain('>Decisions<');
    expect(html).toContain('>Deadlines<');
    expect(html).toContain('>Today<');
  });

  it('lists the upcoming office entries beside the interviews', () => {
    const html = renderToStaticMarkup(<AdminCalendar {...officeProps({ officeCalendarEntries: officeEntries() })} />);
    expect(html).toContain('Office next');
    expect(html).toContain('Verification window closes');
  });

  it('reserves venue management for the Admissions Office Head', () => {
    const staff = renderToStaticMarkup(<AdminCalendar {...officeProps()} />);
    expect(staff).not.toContain('>Venues<');
    const head = renderToStaticMarkup(
      <AdminCalendar {...officeProps({ role: 'admissions_head', interviewWorkspace: workspace({ onSaveLocation: () => ({ ok: true }) }) })} />,
    );
    expect(head).toContain('>Venues<');
  });

  it('reserves office planning entries for the Admissions Office Head', () => {
    const staff = renderToStaticMarkup(<AdminCalendar {...officeProps({ officeCalendarEntries: officeEntries() })} />);
    expect(staff).not.toContain('Office planning entries');
    expect(staff).not.toContain('Add office entry');
    const head = renderToStaticMarkup(
      <AdminCalendar
        {...officeProps({
          role: 'admissions_head',
          officeCalendarEntries: officeEntries(),
          onAddOfficeEntry: () => ({ ok: true }),
          onDeleteOfficeEntry: () => ({ ok: true }),
        })}
      />,
    );
    expect(head).toContain('Office planning entries');
    // The entry form opens in a dialog from this button.
    expect(head).toContain('>Add office entry<');
    expect(head).not.toContain('Add to calendar');
    expect(head).toContain('Upcoming entries');
  });
});

describe('DepartmentInterviewsView', () => {
  it('shows the Chair their panel work without scheduling controls', () => {
    const html = renderToStaticMarkup(<DepartmentInterviewsView {...chairProps()} />);
    expect(html).toContain('Chairperson interviews');
    expect(html).toContain('Lead');
    // Attendance is not tracked, so the Chair page offers no outcome action and
    // no scheduling control.
    expect(html).not.toContain('Mark attended');
    expect(html).not.toContain('Mark did not attend');
    expect(html).not.toContain('Attendance due');
    expect(html).not.toContain('Schedule interview');
    expect(html).not.toContain('Reschedule');
  });

  it('keeps the department view available beside the panel view', () => {
    const queue = [
      ...applications(),
      application({
        id: 'app-other-panel',
        studentName: 'Eli Tan',
        interview: interview({ startsAt: UPCOMING }),
      }),
    ];
    const html = renderToStaticMarkup(
      <DepartmentInterviewsView {...chairProps({ queue })} />,
    );
    expect(html).toContain('Department');
    expect(html).toContain('Your panel');
  });
});

describe('DepartmentCalendarView', () => {
  it('shows the department month view and the panel agenda', () => {
    const html = renderToStaticMarkup(<DepartmentCalendarView {...chairProps()} />);
    expect(html).toContain('Chairperson calendar');
    expect(html).toContain('On your panel');
    expect(html).toContain('Your next interviews');
    expect(html).not.toContain('Awaiting your endorsement');
  });

  it('adds the recorded decisions and office planning dates read-only', () => {
    const html = renderToStaticMarkup(
      <DepartmentCalendarView {...chairProps({
        queue: decisionLogged(),
        officeCalendarEntries: officeEntries(),
      })} />,
    );
    expect(html).toContain('Recorded decision');
    expect(html).toContain('Office entry');
    expect(html).toContain('1 recorded decision');
    expect(html).toContain('1 office entry');
    expect(html).toContain('Office next');
    expect(html).not.toContain('Schedule interview');
    expect(html).not.toContain('Add to calendar');
  });
});
