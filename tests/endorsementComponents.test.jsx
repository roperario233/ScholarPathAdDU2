import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EndorsementCasePanel from '../src/components/EndorsementCasePanel';
import ApplicationReviewModal from '../src/components/ApplicationReviewModal';

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
  statement: 'I am applying for financial assistance.',
  certifiedAt: '2026-10-01T00:00:00.000Z',
  attachedDocuments: ['doc-1'],
  timeline: [],
  statusLog: [{
    id: 'log-handoff',
    toStatus: 'For Endorsement',
    actorRole: 'admissions_office',
    actorName: 'Ben Reyes',
    reason: 'Sent to endorsement.',
    at: '2026-10-01T00:00:00.000Z',
  }],
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

const documents = [{ id: 'doc-1', verificationStatus: 'Verified' }];

describe('EndorsementCasePanel', () => {
  it('shows the record, comments, and Endorse action to the Department Chair', () => {
    const html = renderToStaticMarkup(
      <EndorsementCasePanel
        application={application()}
        documents={documents}
        role="department_chair"
        onAddComment={() => ({ ok: true })}
        onRequestDecision={() => undefined}
      />,
    );

    expect(html).toContain('Endorsement record');
    expect(html).toContain('Sent to endorsement');
    expect(html).toContain('Internal comments');
    expect(html).toContain('Endorse');
    expect(html).not.toContain('Endorsement checklist');
  });

  it('shows the hand-off action to the Admissions Office at verification', () => {
    const html = renderToStaticMarkup(
      <EndorsementCasePanel
        application={application({ status: 'For Verification', statusLog: [] })}
        documents={documents}
        role="admissions_office"
        onRequestDecision={() => undefined}
      />,
    );

    expect(html).toContain('Send to endorsement');
    expect(html).toContain('1 of 1 attached documents verified');
  });

  it('shows the recorded decision after endorsement', () => {
    const html = renderToStaticMarkup(
      <EndorsementCasePanel
        application={application({
          status: 'Endorsed',
          endorsement: {
            reviewedBy: 'Mia Santos',
            decision: 'Endorsed',
            note: 'Meets the criteria.',
            decidedAt: '2026-10-04',
          },
        })}
        documents={documents}
        role="department_chair"
      />,
    );

    expect(html).toContain('Endorsed');
    expect(html).toContain('Meets the criteria.');
  });
});

describe('ApplicationReviewModal endorsement tab', () => {
  it('opens the Endorsement tab with the simplified record and thread', () => {
    const html = renderToStaticMarkup(
      <ApplicationReviewModal
        application={application()}
        scholarship={scholarship}
        documents={documents}
        role="department_chair"
        initialTab="endorsement"
        onClose={() => undefined}
        onStatusChange={() => ({ ok: true })}
        onEndorse={() => ({ ok: true })}
        reviewComments={[{
          id: 'comment-1',
          applicationId: 'app-1',
          authorName: 'Ben Reyes',
          authorRole: 'admissions_office',
          body: 'All attached files are verified.',
          createdAt: '2026-10-02T00:00:00.000Z',
        }]}
        onAddComment={() => ({ ok: true })}
      />,
    );

    expect(html).toContain('id="review-tab-endorsement"');
    expect(html).toContain('Endorsement record');
    expect(html).toContain('All attached files are verified.');
    expect(html).not.toContain('Endorsement checklist');
  });
});
