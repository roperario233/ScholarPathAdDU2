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
  studentDepartment: SEA,
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
    { userId: 'chair-sea', fullName: 'Ana Reyes', role: 'department_chair', department: SEA },
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
  onRecordOutcome: () => ({ ok: true }),
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
  profile: { department: SEA, role: 'department_chair' },
  queue: applications(),
  documents: [],
  scholarships: [scholarship],
  reviewComments: [],
  interviewWorkspace: workspace({ viewerId: 'chair-sea' }),
  ...overrides,
});

describe('InterviewRosterRow', () => {
  const entryFor = (app) => getInterviewEntries([app])[0];

  it('shows the office the attendance action once the interview has started', () => {
    const html = renderToStaticMarkup(
      <InterviewRosterRow entry={entryFor(application({ id: 'app-due', interview: interview({ startsAt: DUE }) }))} panel={panelists.slice(1, 2)} canRecordOutcome />,
    );
    expect(html).toContain('Mark attended');
    expect(html).toContain('Mark did not attend');
    expect(html).toContain('Ana Reyes');
    expect(html).not.toContain('You are the lead');
  });

  it('keeps a Chair who is not on the panel read-only', () => {
    const html = renderToStaticMarkup(
      <InterviewRosterRow entry={entryFor(application({ id: 'app-due', interview: interview({ startsAt: DUE }) }))} panel={panelists.slice(1, 2)} yourRole="observer" openLabel="View interview" />,
    );
    expect(html).toContain('View only');
    expect(html).toContain('View interview');
    expect(html).not.toContain('Mark attended');
  });

  it('gives a Chair on the panel the attendance action and names their role', () => {
    const html = renderToStaticMarkup(
      <InterviewRosterRow entry={entryFor(application({ id: 'app-due', interview: interview({ startsAt: DUE }) }))} panel={panelists.slice(1, 2)} yourRole="lead" canRecordOutcome />,
    );
    expect(html).toContain('>Lead</span>');
    expect(html).toContain('Mark attended');
  });

  it('formats the day heading from the Manila date key', () => {
    expect(formatInterviewDay('2026-11-03')).toContain('November 3, 2026');
  });
});


describe('AdminInterviews', () => {
  it('places endorsed applicants in the scheduling list', () => {
    const html = renderToStaticMarkup(<AdminInterviews {...officeProps()} initialFilter="needs-scheduling" />);
    expect(html).toContain('Needs schedule');
    expect(html).toContain('Schedule interview');
    expect(html).toContain('Ada Cruz');
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
  it('marks interviews and catalog deadlines on the month grid', () => {
    const html = renderToStaticMarkup(<AdminCalendar {...officeProps()} />);
    expect(html).toContain('Interview calendar');
    expect(html).toContain('Scholarship deadline');
    expect(html).toContain('1 scholarship deadline');
    expect(html).toContain('1 interview');
    expect(html).toContain('Next up');
  });

  it('shows only the month view and the day agenda', () => {
    const html = renderToStaticMarkup(<AdminCalendar {...officeProps()} />);
    expect(html).toContain('Office schedule');
    expect(html).toContain('Next up');
    expect(html).not.toContain('To schedule');
    expect(html).not.toContain('Attendance to record');
  });

  it('reserves venue management for the Admissions Office Head', () => {
    const staff = renderToStaticMarkup(<AdminCalendar {...officeProps()} />);
    expect(staff).not.toContain('>Venues<');
    const head = renderToStaticMarkup(
      <AdminCalendar {...officeProps({ role: 'admissions_head', interviewWorkspace: workspace({ onSaveLocation: () => ({ ok: true }) }) })} />,
    );
    expect(head).toContain('>Venues<');
  });
});

describe('DepartmentInterviewsView', () => {
  it('shows the Chair their panel work without scheduling controls', () => {
    const html = renderToStaticMarkup(<DepartmentInterviewsView {...chairProps()} />);
    expect(html).toContain('Department Chair interviews');
    expect(html).toContain('Lead');
    expect(html).toContain('Mark attended');
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
    expect(html).toContain('Department Chair calendar');
    expect(html).toContain('On your panel');
    expect(html).toContain('Your next interviews');
    expect(html).not.toContain('Awaiting your endorsement');
  });
});
