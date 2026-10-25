import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ApplicationReviewModal from '../src/components/ApplicationReviewModal';
import StudentInterviewCard from '../src/components/StudentInterviewCard';

const SEA = 'School of Engineering and Architecture (SEA)';

const pastInterview = {
  version: 2,
  state: 'scheduled',
  revision: 1,
  mode: 'onsite',
  startsAt: '2026-01-05T01:00:00.000Z',
  durationMinutes: 30,
  locationId: 'loc-1',
  locationLabel: 'Interview Room A (Finster Hall, F213)',
  meetingUrl: '',
  school: SEA,
  calendar: null,
  instructions: 'Bring a valid ID.',
  history: [],
};

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'Endorsed',
  studentName: 'Ada Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  scholarshipId: 'scholarship-1',
  studentProgram: 'BS Computer Engineering',
  studentDepartment: SEA,
  statement: 'Statement.',
  attachedDocuments: ['doc-1'],
  timeline: [],
  statusLog: [],
  ...overrides,
});

const scholarship = { id: 'scholarship-1', title: 'Grant-in-Aid (GIA)', ruleFamily: 'general-pool', isActive: true, isMatchable: true };
const documents = [{ id: 'doc-1', verificationStatus: 'Verified' }];

const workspace = (overrides = {}) => ({
  viewerId: 'staff-1',
  staffDirectory: [
    { userId: 'chair-sea', fullName: 'Ana Reyes', role: 'department_chair', department: SEA },
    { userId: 'chair-cas', fullName: 'Carla Lim', role: 'department_chair', department: 'College of Arts and Sciences (CAS)' },
  ],
  locations: [{ id: 'loc-1', name: 'Interview Room A', building: 'Finster Hall', room: 'F213', isActive: true }],
  panelists: [],
  notes: [],
  applications: [],
  calendarConfigured: false,
  onSchedule: () => ({ ok: true }),
  onReschedule: () => ({ ok: true }),
  onCancel: () => ({ ok: true }),
  onRecordOutcome: () => ({ ok: true }),
  onAddNote: () => ({ ok: true }),
  ...overrides,
});

const render = (props) => renderToStaticMarkup(
  <ApplicationReviewModal
    scholarship={scholarship}
    documents={documents}
    onClose={() => undefined}
    onStatusChange={() => ({ ok: true })}
    {...props}
  />,
);

const buttonLabels = (html) => [...html.matchAll(/>([^<>]+)<\/button>/g)].map((match) => match[1].trim());

describe('ApplicationReviewModal default tab', () => {
  const selectedTab = (html) => (html.match(/id="review-tab-([a-z]+)"[^>]*aria-selected="true"/) || [])[1];

  it('opens on the tab for the stage the application is in', () => {
    expect(selectedTab(render({ application: application({ status: 'For Verification' }), role: 'admissions_office' })))
      .toBe('documents');
    expect(selectedTab(render({ application: application({ status: 'For Endorsement' }), role: 'admissions_office' })))
      .toBe('endorsement');
    expect(selectedTab(render({ application: application({ status: 'Endorsed' }), role: 'admissions_office', interviewWorkspace: workspace() })))
      .toBe('interview');
    expect(selectedTab(render({
      application: application({ status: 'Interview', interview: pastInterview }),
      role: 'admissions_office',
      interviewWorkspace: workspace(),
    }))).toBe('interview');
    expect(selectedTab(render({ application: application({ status: 'Submitted' }), role: 'admissions_office' })))
      .toBe('overview');
  });

  it('keeps an explicitly requested tab over the stage default', () => {
    expect(selectedTab(render({
      application: application({ status: 'For Endorsement' }),
      role: 'admissions_office',
      initialTab: 'overview',
    }))).toBe('overview');
  });
});

describe('ApplicationReviewModal Interview tab', () => {
  it('opens the schedule form for the Admissions Office at Endorsed, with the panel limited to the applicant’s school', () => {
    const html = render({ application: application(), role: 'admissions_office', interviewWorkspace: workspace() });
    expect(html).toContain('id="review-tab-interview"');
    expect(html).toContain('Schedule due');
    expect(html).toContain('Schedule the interview');
    // Plain-language panel rule, with each Chair's school named in the picker.
    expect(html).toContain('Applicants are interviewed by a panel from the school that offers their program — <strong class="text-app-text">School of Engineering and Architecture (SEA)</strong>.');
    expect(html).not.toContain('SOP 5a');
    expect(html).toMatch(/<option value="chair-sea">Ana Reyes · School of Engineering and Architecture \(SEA\)<\/option>/);
    expect(html).toContain('Ana Reyes');
    expect(html).not.toContain('Carla Lim');
    // The old footer fields are gone; the action bar keeps one Schedule button.
    expect(html).not.toContain('Panel / school');
    expect(buttonLabels(html).filter((label) => label === 'Schedule interview')).toHaveLength(1);
  });

  it('names the first program choice for an incoming first-year applicant', () => {
    const html = render({
      application: application({
        profileSnapshot: { version: 2, yearStanding: 'incoming-1st', yearStandingLabel: 'Incoming 1st year', department: SEA },
      }),
      role: 'admissions_office',
      interviewWorkspace: workspace(),
    });
    expect(html).toContain('a panel from the school that offers their first program choice');
    expect(html).not.toContain('a panel from the school that offers their program —');
  });

  it('shows the Department Chair a read-only tab before the interview is scheduled', () => {
    const html = render({
      application: application(),
      role: 'department_chair',
      initialTab: 'interview',
      interviewWorkspace: workspace({ viewerId: 'chair-sea' }),
    });
    expect(html).toContain('id="review-tab-interview"');
    expect(html).toContain('has not scheduled the interview yet');
    expect(html).not.toContain('Schedule the interview');
    expect(buttonLabels(html)).not.toContain('Schedule interview');
  });

  it('is not shown before endorsement or without interview data', () => {
    expect(render({ application: application({ status: 'For Endorsement' }), role: 'admissions_office', interviewWorkspace: workspace() }))
      .not.toContain('id="review-tab-interview"');
    expect(render({ application: application(), role: 'admissions_office' })).not.toContain('id="review-tab-interview"');
  });

  it('lets a Chair on the panel record attendance and notes', () => {
    const html = render({
      application: application({ status: 'Interview', interview: pastInterview }),
      role: 'department_chair',
      initialTab: 'interview',
      interviewWorkspace: workspace({
        viewerId: 'chair-sea',
        panelists: [{ id: 'p-1', applicationId: 'app-1', profileId: 'chair-sea', name: 'Ana Reyes', isLead: true, removedAt: null }],
      }),
    });
    expect(html).toContain('Outcome due');
    expect(buttonLabels(html)).toEqual(expect.arrayContaining(['Mark attended', 'Mark did not attend', 'Add note']));
    expect(buttonLabels(html)).not.toContain('Reschedule');
  });

  it('keeps a Chair who is not on the panel read-only', () => {
    const html = render({
      application: application({ status: 'Interview', interview: pastInterview }),
      role: 'department_chair',
      initialTab: 'interview',
      interviewWorkspace: workspace({
        viewerId: 'chair-other',
        notes: [{ id: 'n-1', applicationId: 'app-1', authorName: 'Ana Reyes', authorRole: 'department_chair', rating: 4, body: 'Clear goals.', createdAt: '2026-01-05T02:00:00.000Z' }],
      }),
    });
    expect(html).toContain('Clear goals.');
    expect(buttonLabels(html)).not.toContain('Mark attended');
    expect(buttonLabels(html)).not.toContain('Add note');
  });

  it('blocks the recommendation until the panel records attendance', () => {
    const html = render({
      application: application({ status: 'Interview', interview: pastInterview }),
      role: 'admissions_office',
      interviewWorkspace: workspace(),
    });
    expect(html).toContain('must record the applicant as attended before the sub-committee recommendation');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="The interview panel must record the applicant as attended first"[^>]*>Recommend for approval<\/button>/);

    const attended = render({
      application: application({ status: 'Interview', interview: { ...pastInterview, state: 'completed' } }),
      role: 'admissions_office',
      interviewWorkspace: workspace(),
    });
    expect(attended).not.toContain('must record the applicant as attended before');
    expect(attended).toMatch(/<button(?![^>]*disabled="")[^>]*>Recommend for approval<\/button>/);
  });
});

describe('StudentInterviewCard', () => {
  it('shows the schedule and the school, never the panel members', () => {
    const html = renderToStaticMarkup(
      <StudentInterviewCard
        application={application({ status: 'Interview', interview: { ...pastInterview, startsAt: '2099-01-05T01:00:00.000Z' } })}
        scholarshipTitle="Grant-in-Aid (GIA)"
      />,
    );
    expect(html).toContain('Interview Room A');
    expect(html).toContain(`Interview panel from ${SEA}`);
    expect(html).toContain('Add to Google Calendar');
    expect(html).toContain('Bring a valid ID.');
    expect(html).not.toContain('Ana Reyes');
  });

  it('explains a cancelled interview without calendar actions', () => {
    const html = renderToStaticMarkup(
      <StudentInterviewCard application={application({ status: 'Interview', interview: { ...pastInterview, state: 'cancelled', revision: 2 } })} />,
    );
    expect(html).toContain('This interview was cancelled.');
    expect(html).not.toContain('Add to Google Calendar');
  });
});
