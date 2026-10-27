import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminEndorsement from '../src/pages/admin/AdminEndorsement';

const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();

const handoffLog = (at = daysAgo(10)) => [
  {
    id: 'log-verification',
    toStatus: 'For Verification',
    actorRole: 'admissions_office',
    actorName: 'Ben Reyes',
    reason: 'Continued to document verification.',
    at: daysAgo(12),
  },
  {
    id: 'log-handoff',
    toStatus: 'For Endorsement',
    actorRole: 'admissions_office',
    actorName: 'Ben Reyes',
    reason: 'Documents are verified and consistent with the submission.',
    at,
  },
];

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'For Endorsement',
  studentName: 'Ada Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  scholarshipId: 'scholarship-1',
  studentProgram: 'BS Computer Science',
  studentDepartment: 'College of Computer Studies (CCS)',
  studentQpi: 3.4,
  studentHouseholdIncome: 120000,
  attachedDocuments: ['doc-1', 'doc-2'],
  submittedAt: daysAgo(15),
  updatedAt: daysAgo(10),
  timeline: [],
  statusLog: handoffLog(),
  ...overrides,
});

const document = (id) => ({
  id,
  title: 'Latest grade report',
  documentType: 'Grade Report',
  verificationStatus: 'Verified',
});

const caseOfficer = {
  id: 'co-1',
  applicationId: 'app-1',
  officerId: 'officer-a',
  officerName: 'Ana Reyes',
  officerRole: 'admissions_office',
  joinedAt: daysAgo(14),
  leftAt: null,
};

const endorsedApplication = application({
  id: 'app-2',
  status: 'Endorsed',
  studentName: 'Mia Santos',
  endorsement: {
    reviewedBy: 'Mia Santos',
    decision: 'Endorsed',
    note: 'Endorsed after central review.',
    decidedAt: daysAgo(2).slice(0, 10),
  },
  statusLog: [
    ...handoffLog(daysAgo(5)),
    {
      id: 'log-endorsed',
      toStatus: 'Endorsed',
      actorRole: 'admissions_head',
      actorName: 'Mia Santos',
      reason: 'Endorsed after central review.',
      at: daysAgo(2),
    },
  ],
});

describe('AdminEndorsement', () => {
  it('lists the cases the Staff handed over, with the hand-off and document state', () => {
    const html = renderToStaticMarkup(
      <AdminEndorsement
        applications={[application()]}
        documents={[document('doc-1'), document('doc-2')]}
        caseOfficers={[caseOfficer]}
        currentUserId="officer-a"
        role="admissions_head"
      />,
    );

    expect(html).toContain('Endorsement');
    expect(html).toContain('Awaiting your decision');
    expect(html).toContain('Ada Cruz');
    expect(html).toContain('Grant-in-Aid (GIA)');
    expect(html).toContain('Sent by Ben Reyes');
    expect(html).toContain('2 of 2 documents verified');
    expect(html).toContain('past the 5-day target');
    expect(html).toContain('Prepared by You');
    expect(html).toContain('Review and endorse');
  });

  it('keeps cases that have not reached endorsement out of the queue', () => {
    const html = renderToStaticMarkup(
      <AdminEndorsement
        applications={[
          application(),
          application({ id: 'app-3', status: 'For Verification', studentName: 'Jose Rizal' }),
          application({ id: 'app-4', status: 'Interview', studentName: 'Andres Bonifacio' }),
        ]}
        documents={[document('doc-1'), document('doc-2')]}
        role="admissions_head"
      />,
    );

    expect(html).toContain('Ada Cruz');
    expect(html).not.toContain('Jose Rizal');
    expect(html).not.toContain('Andres Bonifacio');
  });

  it('shows the recorded decision in the history view', () => {
    const html = renderToStaticMarkup(
      <AdminEndorsement
        applications={[endorsedApplication]}
        documents={[document('doc-1'), document('doc-2')]}
        role="admissions_head"
        initialView="recorded"
      />,
    );

    expect(html).toContain('Endorsement decisions');
    expect(html).toContain('Mia Santos');
    expect(html).toContain('Endorsed');
    expect(html).toContain('Endorsed after central review.');
    expect(html).toContain('Open case');
    expect(html).not.toContain('Ada Cruz');
  });

  it('points an empty queue at the intake pool', () => {
    const html = renderToStaticMarkup(
      <AdminEndorsement applications={[]} role="admissions_head" onOpenWorkspace={() => undefined} />,
    );

    expect(html).toContain('No case is awaiting your endorsement');
    expect(html).toContain('Open intake pool');
  });
});
