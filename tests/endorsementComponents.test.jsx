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

// The stage action lives in the review modal's sticky action bar, so the tab
// must never render a second decision button of its own.
const buttonLabels = (html) => [...html.matchAll(/>([^<>]+)<\/button>/g)].map((match) => match[1].trim());

describe('EndorsementCasePanel', () => {
  it('shows the record and readiness to the Department Chair as read-only', () => {
    const html = renderToStaticMarkup(
      <EndorsementCasePanel
        application={application()}
        documents={documents}
        role="department_chair"
        onAddComment={() => ({ ok: true })}
      />,
    );

    expect(html).toContain('Endorsement record');
    expect(html).toContain('Sent to endorsement');
    expect(html).toContain('Internal comments');
    // Endorsement belongs to the Office of Admissions & Aid, so the Chair is
    // pointed at no action of its own.
    expect(html).not.toContain('Record the endorsement from the action bar below.');
    expect(html).toContain('1 of 1 attached documents verified');
    expect(buttonLabels(html)).not.toContain('Endorse');
    expect(html).not.toContain('Endorsement checklist');
  });

  it('points the Admissions Office at the action bar instead of rendering the hand-off button', () => {
    const html = renderToStaticMarkup(
      <EndorsementCasePanel
        application={application({ status: 'For Verification', statusLog: [] })}
        documents={documents}
        role="admissions_office"
      />,
    );

    expect(html).toContain('Send the application for endorsement from the action bar below.');
    expect(html).toContain('1 of 1 attached documents verified');
    expect(buttonLabels(html)).not.toContain('Send to endorsement');
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
  it('opens the Endorsement tab with the simplified record and thread for the Head', () => {
    const html = renderToStaticMarkup(
      <ApplicationReviewModal
        application={application()}
        scholarship={scholarship}
        documents={documents}
        role="admissions_head"
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
    // One action surface only: the Head's Endorse button renders once.
    expect(buttonLabels(html).filter((label) => label === 'Endorse')).toHaveLength(1);
  });

  it('gives the Department Chair no endorsement action', () => {
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
      />,
    );

    expect(html).toContain('id="review-tab-endorsement"');
    expect(buttonLabels(html).filter((label) => label === 'Endorse')).toHaveLength(0);
    // The endorsement decision is the Office of Admissions & Aid's, so the Chair
    // is told who holds it rather than offered a button.
    expect(html).toContain('This application is awaiting the endorsement decision of the Office of Admissions &amp; Aid.');
  });

  it('keeps the Endorsement tab hidden until the case reaches endorsement', () => {
    const html = renderToStaticMarkup(
      <ApplicationReviewModal
        application={application({ status: 'For Verification', statusLog: [] })}
        scholarship={scholarship}
        documents={documents}
        role="admissions_office"
        initialTab="endorsement"
        onClose={() => undefined}
        onStatusChange={() => ({ ok: true })}
      />,
    );

    // SOP step 4 starts at the hand-off, so the tab cannot be opened while the
    // case is still with the Admissions Office for document verification.
    expect(html).not.toContain('id="review-tab-endorsement"');
    expect(html).toContain('id="review-panel-overview"');
  });

  it('shows the recorded hand-off to the Admissions Office once it is with the Chair', () => {
    const html = renderToStaticMarkup(
      <ApplicationReviewModal
        application={application()}
        scholarship={scholarship}
        documents={documents}
        role="admissions_office"
        initialTab="endorsement"
        onClose={() => undefined}
        onStatusChange={() => ({ ok: true })}
      />,
    );

    expect(html).toContain('id="review-tab-endorsement"');
    expect(html).toContain('Endorsement record');
    expect(html).toContain('Sent to endorsement');
    // The hand-off is done, so the office has no hand-off button to show twice.
    expect(buttonLabels(html).filter((label) => label === 'Send to endorsement')).toHaveLength(0);
  });
});
