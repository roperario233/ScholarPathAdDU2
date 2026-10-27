import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminIntakePool from '../src/pages/admin/AdminIntakePool';
import AdminReviewQueue from '../src/pages/admin/AdminReviewQueue';
import ApplicationReviewModal from '../src/components/ApplicationReviewModal';

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'Submitted',
  studentName: 'Ada Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  scholarshipId: 'scholarship-1',
  studentProgram: 'BS Computer Science',
  studentDepartment: 'College of Computer Studies (CCS)',
  studentQpi: 3.4,
  studentHouseholdIncome: 120000,
  statement: 'I am applying for financial assistance.',
  submittedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  attachedDocuments: [],
  timeline: [],
  statusLog: [],
  ...overrides,
});

const caseOfficer = (overrides = {}) => ({
  id: 'co-1',
  applicationId: 'app-1',
  officerId: 'officer-a',
  officerName: 'Ana Reyes',
  officerRole: 'admissions_office',
  joinedAt: '2026-10-02T00:00:00.000Z',
  leftAt: null,
  ...overrides,
});

const scholarship = {
  id: 'scholarship-1',
  title: 'Grant-in-Aid (GIA)',
  ruleFamily: 'general-pool',
  minimumQpi: 2.5,
  maximumIncome: 250000,
  isActive: true,
  isMatchable: true,
};

const other = application({
  id: 'app-2',
  studentName: 'Mia Santos',
  submittedAt: '2026-10-03T00:00:00.000Z',
});

describe('AdminIntakePool', () => {
  it('lists only the unclaimed cases by default, with the pickup action', () => {
    const html = renderToStaticMarkup(
      <AdminIntakePool
        applications={[application(), other]}
        caseOfficers={[caseOfficer({ applicationId: 'app-2', officerId: 'officer-b', officerName: 'Ben Reyes' })]}
        currentUserId="officer-a"
        role="admissions_office"
      />,
    );

    expect(html).toContain('Application intake pool');
    expect(html).toContain('Ada Cruz');
    // A taken case stays out of the default view; the coverage filter finds it.
    expect(html).not.toContain('Mia Santos');
    expect(html).toContain('Pick up for review');
    expect(html).not.toContain('Open case');
    expect(html).toContain('Unclaimed submissions');
    expect(html).toContain('With officers');
  });

  it('keeps taken cases discoverable and reports officer workload to the Head', () => {
    const html = renderToStaticMarkup(
      <AdminIntakePool
        applications={[application(), other]}
        caseOfficers={[caseOfficer({ applicationId: 'app-2', officerId: 'officer-b', officerName: 'Ben Reyes' })]}
        currentUserId="officer-a"
        role="admissions_head"
      />,
    );

    expect(html).toContain('Officer workload');
    expect(html).toContain('Ben Reyes');
    expect(html).toContain('1 open case');
  });

  it('says so when the case-officer roster is unavailable', () => {
    const html = renderToStaticMarkup(
      <AdminIntakePool applications={[application()]} caseOfficersReady={false} role="admissions_office" />,
    );

    expect(html).toContain('case-officer roster is unavailable');
  });
});

describe('AdminReviewQueue', () => {
  it('lists only the cases the signed-in officer opened', () => {
    const html = renderToStaticMarkup(
      <AdminReviewQueue
        applications={[application(), other]}
        caseOfficers={[
          caseOfficer({ applicationId: 'app-1', officerId: 'officer-a' }),
          caseOfficer({ id: 'co-2', applicationId: 'app-2', officerId: 'officer-b', officerName: 'Ben Reyes' }),
        ]}
        currentUserId="officer-a"
        role="admissions_office"
      />,
    );

    expect(html).toContain('Review queue');
    expect(html).toContain('Ada Cruz');
    expect(html).not.toContain('Mia Santos');
    expect(html).toContain('In my review queue');
    expect(html).toContain('Unclaimed submissions');
  });

  it('points an empty queue at the intake pool', () => {
    const html = renderToStaticMarkup(
      <AdminReviewQueue applications={[application()]} role="admissions_office" currentUserId="officer-a" onOpenWorkspace={() => undefined} />,
    );

    expect(html).toContain('No cases in your review queue yet');
    expect(html).toContain('Open intake pool');
  });
});

describe('ApplicationReviewModal case officers', () => {
  const renderModal = (overrides = {}) => renderToStaticMarkup(
    <ApplicationReviewModal
      application={application({ status: 'Under Review' })}
      scholarship={scholarship}
      documents={[]}
      role="admissions_office"
      currentUserId="officer-a"
      onClose={() => undefined}
      onStatusChange={() => ({ ok: true })}
      onLeaveCase={() => ({ ok: true })}
      {...overrides}
    />,
  );

  it('names the officers on the case and lets the officer leave it', () => {
    const html = renderModal({ caseOfficers: [caseOfficer()] });

    expect(html).toContain('Case officers');
    expect(html).toContain('You');
    expect(html).toContain('Admissions Office Staff · joined');
    expect(html).toContain('Leave case');
  });

  it('reports a case that only another officer opened', () => {
    const html = renderModal({ caseOfficers: [caseOfficer({ officerId: 'officer-b', officerName: 'Ben Reyes' })] });

    expect(html).toContain('1 case officer');
    expect(html).toContain('Ben Reyes');
    expect(html).not.toContain('Leave case');
  });

  it('keeps the roster out of the Department Chair view', () => {
    const html = renderModal({ role: 'department_chair', caseOfficers: [caseOfficer()] });

    expect(html).not.toContain('Case officers');
    expect(html).not.toContain('Leave case');
  });
});
